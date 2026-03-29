package hooks

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/damusix/hook-manager/internal/aggregator"
	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/logger"
)

// helper: create a config.Store from a Config struct
func tempStore(t *testing.T, cfg config.Config) *config.Store {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	s, err := config.NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := s.Save(cfg); err != nil {
		t.Fatalf("Save: %v", err)
	}
	return s
}

// helper: create a logger writing to a temp file
func tempLogger(t *testing.T) *logger.Logger {
	t.Helper()
	dir := t.TempDir()
	l, err := logger.New(filepath.Join(dir, "hook.log"), 1<<20, 3)
	if err != nil {
		t.Fatalf("logger.New: %v", err)
	}
	t.Cleanup(func() { l.Close() })
	return l
}

func boolPtr(b bool) *bool { return &b }

func TestHandler_NoHooksConfigured(t *testing.T) {
	store := tempStore(t, config.DefaultConfig())
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, t.TempDir(), shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"ls"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	respBody, _ := io.ReadAll(resp.Body)
	if len(respBody) != 0 {
		t.Errorf("expected empty body, got %q", string(respBody))
	}
}

func TestHandler_MatchingHookExecutes(t *testing.T) {
	// Create a managed script that echoes JSON
	scriptsDir := t.TempDir()
	scriptPath := filepath.Join(scriptsDir, "greet.sh")
	os.WriteFile(scriptPath, []byte(`#!/bin/sh
echo '{"systemMessage":"hello from hook"}'
`), 0755)

	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "greet",
			Type:    "managed",
			File:    "greet.sh",
			Runtime: "sh",
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, scriptsDir, shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"ls"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, string(respBody))
	}
	msg, ok := result["systemMessage"].(string)
	if !ok || msg != "hello from hook" {
		t.Errorf("expected systemMessage='hello from hook', got %v", result)
	}
}

func TestHandler_NonMatchingHookSkipped(t *testing.T) {
	scriptsDir := t.TempDir()
	scriptPath := filepath.Join(scriptsDir, "skip.sh")
	os.WriteFile(scriptPath, []byte(`#!/bin/sh
echo '{"systemMessage":"should not appear"}'
`), 0755)

	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "skip",
			Type:    "managed",
			File:    "skip.sh",
			Runtime: "sh",
			Matcher: "^Write$", // only matches Write, not Bash
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, scriptsDir, shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"ls"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	respBody, _ := io.ReadAll(resp.Body)
	if len(respBody) != 0 {
		t.Errorf("expected empty body when matcher doesn't match, got %q", string(respBody))
	}
}

func TestHandler_HookExitCode2_BlockResponse(t *testing.T) {
	scriptsDir := t.TempDir()
	scriptPath := filepath.Join(scriptsDir, "blocker.sh")
	os.WriteFile(scriptPath, []byte(`#!/bin/sh
echo "dangerous command detected"
exit 2
`), 0755)

	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "blocker",
			Type:    "managed",
			File:    "blocker.sh",
			Runtime: "sh",
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, scriptsDir, shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"rm -rf /"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for PreToolUse block, got %d", resp.StatusCode)
	}
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, string(respBody))
	}
	hook, ok := result["hookSpecificOutput"].(map[string]any)
	if !ok {
		t.Fatalf("expected hookSpecificOutput in response, got %v", result)
	}
	if hook["permissionDecision"] != "deny" {
		t.Errorf("expected permissionDecision=deny, got %v", hook["permissionDecision"])
	}
}

func TestHandler_MultipleHooksAggregated(t *testing.T) {
	scriptsDir := t.TempDir()

	os.WriteFile(filepath.Join(scriptsDir, "hook1.sh"), []byte(`#!/bin/sh
echo '{"systemMessage":"from hook1"}'
`), 0755)

	os.WriteFile(filepath.Join(scriptsDir, "hook2.sh"), []byte(`#!/bin/sh
echo '{"extraField":"from hook2"}'
`), 0755)

	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "hook1",
			Type:    "managed",
			File:    "hook1.sh",
			Runtime: "sh",
			Timeout: 5,
		},
		{
			Name:    "hook2",
			Type:    "managed",
			File:    "hook2.sh",
			Runtime: "sh",
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, scriptsDir, shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"ls"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, string(respBody))
	}
	if result["systemMessage"] != "from hook1" {
		t.Errorf("expected systemMessage='from hook1', got %v", result["systemMessage"])
	}
	if result["extraField"] != "from hook2" {
		t.Errorf("expected extraField='from hook2', got %v", result["extraField"])
	}
}

func TestHandler_SessionEndTriggersShutdown(t *testing.T) {
	cfg := config.DefaultConfig()
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, t.TempDir(), shutdownCh, nil)

	body := `{"reason":"user_quit"}`
	req := httptest.NewRequest(http.MethodPost, "/hook/SessionEnd", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	select {
	case <-shutdownCh:
		// expected
	case <-time.After(2 * time.Second):
		t.Error("shutdown channel was not closed after SessionEnd")
	}
}

func TestHandler_DisabledHookSkipped(t *testing.T) {
	scriptsDir := t.TempDir()
	os.WriteFile(filepath.Join(scriptsDir, "disabled.sh"), []byte(`#!/bin/sh
echo '{"systemMessage":"should not appear"}'
`), 0755)

	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "disabled",
			Type:    "managed",
			File:    "disabled.sh",
			Runtime: "sh",
			Enabled: boolPtr(false),
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, scriptsDir, shutdownCh, nil)

	body := `{"tool_name":"Bash"}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	respBody, _ := io.ReadAll(resp.Body)
	if len(respBody) != 0 {
		t.Errorf("expected empty body for disabled hook, got %q", string(respBody))
	}
}

func TestHandler_CommandTypeHook(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "cmd-hook",
			Type:    "command",
			Command: `echo '{"systemMessage":"from command"}'`,
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, t.TempDir(), shutdownCh, nil)

	body := `{"tool_name":"Bash","input":{"command":"ls"}}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, string(respBody))
	}
	if result["systemMessage"] != "from command" {
		t.Errorf("expected systemMessage='from command', got %v", result["systemMessage"])
	}
}

func TestHandler_PlainTextOutput(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Hooks["PreToolUse"] = []config.HookDef{
		{
			Name:    "text-hook",
			Type:    "command",
			Command: `echo "plain text output"`,
			Timeout: 5,
		},
	}
	store := tempStore(t, cfg)
	log := tempLogger(t)
	shutdownCh := make(chan struct{})

	h := NewHandler(store, log, t.TempDir(), shutdownCh, nil)

	body := `{"tool_name":"Bash"}`
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	resp := w.Result()
	respBody, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(respBody), "plain text output") {
		t.Errorf("expected plain text in response, got %q", string(respBody))
	}
}

// Test matcher.go
func TestMatcherField(t *testing.T) {
	cases := []struct {
		event string
		field string
	}{
		{"PreToolUse", "tool_name"},
		{"PostToolUse", "tool_name"},
		{"PostToolUseFailure", "tool_name"},
		{"PermissionRequest", "tool_name"},
		{"SessionStart", "source"},
		{"SessionEnd", "reason"},
		{"StopFailure", "error"},
		{"SubagentStart", "agent_type"},
		{"SubagentStop", "agent_type"},
		{"Notification", "notification_type"},
		{"InstructionsLoaded", "load_reason"},
		{"ConfigChange", "source"},
		{"FileChanged", "file_path"},
		{"Elicitation", "mcp_server"},
		{"ElicitationResult", "mcp_server"},
		{"UnknownEvent", ""},
	}
	for _, tc := range cases {
		got := MatcherField(tc.event)
		if got != tc.field {
			t.Errorf("MatcherField(%q) = %q, want %q", tc.event, got, tc.field)
		}
	}
}

func TestMatches(t *testing.T) {
	cases := []struct {
		pattern string
		value   string
		want    bool
	}{
		{"", "anything", true},             // empty matches all
		{"^Bash$", "Bash", true},           // exact match
		{"^Bash$", "BashTool", false},      // anchored, no match
		{"Bash|Write", "Bash", true},       // alternation
		{"Bash|Write", "Write", true},      // alternation
		{"Bash|Write", "Read", false},      // no match
		{"[invalid", "test", false},        // invalid regex => false
	}
	for _, tc := range cases {
		got := Matches(tc.pattern, tc.value)
		if got != tc.want {
			t.Errorf("Matches(%q, %q) = %v, want %v", tc.pattern, tc.value, got, tc.want)
		}
	}
}

// Test enricher.go
func TestExtractHeaderEnv(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", nil)
	req.Header.Set("X-Claude-Session-Id", "abc123")
	req.Header.Set("X-Claude-Cwd", "/tmp/project")
	req.Header.Set("Content-Type", "application/json")

	env := ExtractHeaderEnv(req)

	if env["CLAUDE_SESSION_ID"] != "abc123" {
		t.Errorf("expected CLAUDE_SESSION_ID=abc123, got %q", env["CLAUDE_SESSION_ID"])
	}
	if env["CLAUDE_CWD"] != "/tmp/project" {
		t.Errorf("expected CLAUDE_CWD=/tmp/project, got %q", env["CLAUDE_CWD"])
	}
	// Non X-Claude- headers should not be included
	if _, ok := env["CONTENT_TYPE"]; ok {
		t.Error("non X-Claude- header should not be in env")
	}
}

func TestFindClaudeMDFiles(t *testing.T) {
	dir := t.TempDir()
	// Create a nested directory structure with CLAUDE.md at root
	sub := filepath.Join(dir, "a", "b")
	os.MkdirAll(sub, 0755)
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("# instructions"), 0644)
	os.WriteFile(filepath.Join(dir, "a", "AGENTS.md"), []byte("# agents"), 0644)

	paths := FindClaudeMDFiles(sub)

	foundClaude := false
	foundAgents := false
	for _, p := range paths {
		if strings.HasSuffix(p, "CLAUDE.md") {
			foundClaude = true
		}
		if strings.HasSuffix(p, "AGENTS.md") {
			foundAgents = true
		}
	}
	if !foundClaude {
		t.Errorf("expected to find CLAUDE.md, got %v", paths)
	}
	if !foundAgents {
		t.Errorf("expected to find AGENTS.md, got %v", paths)
	}
}

func TestEnrichPayload(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("# test"), 0644)

	input := map[string]any{
		"tool_name": "Bash",
		"cwd":       dir,
	}
	req := httptest.NewRequest(http.MethodPost, "/hook/PreToolUse", nil)
	req.Header.Set("X-Claude-Session-Id", "sess-001")

	env := EnrichPayload(input, req)

	if env["CLAUDE_SESSION_ID"] != "sess-001" {
		t.Errorf("expected CLAUDE_SESSION_ID=sess-001, got %q", env["CLAUDE_SESSION_ID"])
	}

	// CLAUDE_MD_PATHS should be set because cwd has a CLAUDE.md ancestor
	if _, ok := env["CLAUDE_MD_PATHS"]; !ok {
		t.Error("expected CLAUDE_MD_PATHS to be set")
	}
}

// Ensure the aggregator import is used to avoid compiler error
var _ = aggregator.ScriptOutput{}
