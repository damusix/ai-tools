package hooks

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/logger"
)

// integrationSetup builds a Handler from a YAML config string.
// It returns the handler and a cleanup-registered logger.
func integrationSetup(t *testing.T, yamlCfg string) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(yamlCfg), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	store, err := config.NewStore(configPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	lg, err := logger.New(filepath.Join(dir, "hooks.log"), 1024*1024, 1)
	if err != nil {
		t.Fatalf("logger.New: %v", err)
	}
	t.Cleanup(func() { lg.Close() })
	shutdownCh := make(chan struct{})
	handler := NewHandler(store, lg, filepath.Join(dir, "scripts"), shutdownCh, nil)
	return handler, dir
}

// postHook sends a POST /hook/{event} to the handler and returns the recorder.
func postHook(t *testing.T, h *Handler, event, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/hook/"+event, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// TestIntegration_HookExecutesAndReturnsOutput verifies that a command hook
// that outputs JSON is executed and the response contains the expected field.
func TestIntegration_HookExecutesAndReturnsOutput(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: test-hook
      type: command
      command: "echo '{\"systemMessage\":\"hello\"}'"
      timeout: 5
`)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash","tool_input":{"command":"ls"}}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(w.Body.String(), "hello") {
		t.Errorf("response missing systemMessage: %s", w.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, w.Body.String())
	}
	if result["systemMessage"] != "hello" {
		t.Errorf("expected systemMessage=hello, got %v", result["systemMessage"])
	}
}

// TestIntegration_HookExit2ReturnsDenyResponse verifies that a hook exiting
// with code 2 causes the handler to return a permissionDecision=deny response.
func TestIntegration_HookExit2ReturnsDenyResponse(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: blocker
      type: command
      command: "echo blocked >&2; exit 2"
      timeout: 5
`)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, w.Body.String())
	}
	hookOutput, ok := result["hookSpecificOutput"].(map[string]any)
	if !ok {
		t.Fatalf("expected hookSpecificOutput in response, got %v", result)
	}
	if hookOutput["permissionDecision"] != "deny" {
		t.Errorf("expected permissionDecision=deny, got %v", hookOutput["permissionDecision"])
	}
}

// TestIntegration_MultipleHooksAggregated verifies that outputs from multiple
// command hooks are merged into a single JSON response.
func TestIntegration_MultipleHooksAggregated(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: hook-a
      type: command
      command: "echo '{\"a\":1}'"
      timeout: 5
    - name: hook-b
      type: command
      command: "echo '{\"b\":2}'"
      timeout: 5
`)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, w.Body.String())
	}

	// Both fields must be present in the merged output
	aVal, aOk := result["a"]
	bVal, bOk := result["b"]
	if !aOk || !bOk {
		t.Fatalf("expected both a and b in merged response, got %v", result)
	}
	// JSON numbers unmarshal as float64
	if aVal != float64(1) {
		t.Errorf("expected a=1, got %v", aVal)
	}
	if bVal != float64(2) {
		t.Errorf("expected b=2, got %v", bVal)
	}
}

// TestIntegration_NonMatchingMatcherSkipsHook verifies that a hook whose
// matcher does not match the tool_name is not executed.
func TestIntegration_NonMatchingMatcherSkipsHook(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: write-only
      type: command
      command: "echo '{\"systemMessage\":\"should not appear\"}'"
      matcher: "^Write$"
      timeout: 5
`)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Errorf("expected empty response when matcher does not match, got: %s", w.Body.String())
	}
}

// TestIntegration_ManagedScriptExecution verifies that a managed hook correctly
// runs a script file via the specified runtime.
func TestIntegration_ManagedScriptExecution(t *testing.T) {
	dir := t.TempDir()
	scriptsDir := filepath.Join(dir, "scripts")
	if err := os.MkdirAll(scriptsDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	scriptPath := filepath.Join(scriptsDir, "greet.sh")
	if err := os.WriteFile(scriptPath, []byte(`#!/bin/sh
echo '{"systemMessage":"managed hook ran"}'
`), 0755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(`
hooks:
  PreToolUse:
    - name: managed-greet
      type: managed
      file: greet.sh
      runtime: sh
      timeout: 5
`), 0644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	store, err := config.NewStore(configPath)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	lg, err := logger.New(filepath.Join(dir, "hooks.log"), 1024*1024, 1)
	if err != nil {
		t.Fatalf("logger.New: %v", err)
	}
	defer lg.Close()

	shutdownCh := make(chan struct{})
	handler := NewHandler(store, lg, scriptsDir, shutdownCh, nil)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response not valid JSON: %v (body: %s)", err, w.Body.String())
	}
	if result["systemMessage"] != "managed hook ran" {
		t.Errorf("expected systemMessage='managed hook ran', got %v", result["systemMessage"])
	}
}

// TestIntegration_HookTimeoutHandledGracefully verifies that a hook that runs
// forever is interrupted by its timeout and the handler returns promptly.
func TestIntegration_HookTimeoutHandledGracefully(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: sleeper
      type: command
      command: "sleep 9999"
      timeout: 1
`)

	// The handler must return within a reasonable time (well under 9999s).
	// We use httptest.NewRecorder so we can call ServeHTTP synchronously;
	// the executor's timeout context will cancel the sleep.
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash"}`)
		done <- w
	}()

	select {
	case w := <-done:
		// Handler returned. The timed-out hook produces no useful output so
		// the response is empty with status 200.
		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", w.Code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not return within 5s — timeout not working")
	}
}

// TestIntegration_DisabledHookSkipped verifies that a hook with enabled=false
// is not executed and the response is empty.
func TestIntegration_DisabledHookSkipped(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: disabled-hook
      type: command
      command: "echo '{\"systemMessage\":\"should not appear\"}'"
      enabled: false
      timeout: 5
`)

	w := postHook(t, handler, "PreToolUse", `{"tool_name":"Bash"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Errorf("expected empty response for disabled hook, got: %s", w.Body.String())
	}
}

// TestIntegration_HttptestServer verifies the handler works correctly when
// wrapped in httptest.NewServer (real HTTP round-trip).
func TestIntegration_HttptestServer(t *testing.T) {
	handler, _ := integrationSetup(t, `
hooks:
  PreToolUse:
    - name: server-test
      type: command
      command: "echo '{\"systemMessage\":\"via server\"}'"
      timeout: 5
`)

	srv := httptest.NewServer(handler)
	defer srv.Close()

	body := `{"tool_name":"Bash","tool_input":{"command":"ls"}}`
	resp, err := http.Post(srv.URL+"/hook/PreToolUse", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if result["systemMessage"] != "via server" {
		t.Errorf("expected systemMessage='via server', got %v", result["systemMessage"])
	}
}
