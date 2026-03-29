package api

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/executor"
	"gopkg.in/yaml.v3"
)

// GetConfig handles GET /api/config
// Returns current config as JSON.
func (a *API) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

// PutConfig handles PUT /api/config
// Accepts YAML (text/yaml) or JSON (application/json) body.
func (a *API) PutConfig(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var cfg config.Config
	ct := r.Header.Get("Content-Type")
	if strings.Contains(ct, "application/json") {
		// JSON: only update server settings, preserve hooks
		var incoming struct {
			Server config.ServerConfig `json:"server"`
		}
		if err := json.Unmarshal(body, &incoming); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		cfg = a.store.Get()
		cfg.Server = incoming.Server
	} else {
		// YAML: full config replacement
		if err := yaml.Unmarshal(body, &cfg); err != nil {
			http.Error(w, "invalid YAML: "+err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Apply defaults
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 47821
	}
	if cfg.Server.LogLevel == "" {
		cfg.Server.LogLevel = "info"
	}
	if cfg.Hooks == nil {
		cfg.Hooks = make(map[string][]config.HookDef)
	}

	if err := a.store.Save(cfg); err != nil {
		a.logger.Error("config save failed: " + err.Error())
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.logger.Info("config updated")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

// GetHooks handles GET /api/hooks
// Returns all hooks grouped by event as JSON.
func (a *API) GetHooks(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Hooks)
}

type createHookRequest struct {
	Event string         `json:"event"`
	Hook  config.HookDef `json:"hook"`
}

// PostHook handles POST /api/hooks
// Creates a hook under the given event.
func (a *API) PostHook(w http.ResponseWriter, r *http.Request) {
	var req createHookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Event == "" {
		http.Error(w, "event is required", http.StatusBadRequest)
		return
	}
	if req.Hook.Name == "" {
		http.Error(w, "hook.name is required", http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()
	if cfg.Hooks == nil {
		cfg.Hooks = make(map[string][]config.HookDef)
	}
	cfg.Hooks[req.Event] = append(cfg.Hooks[req.Event], req.Hook)

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.logger.Info("hook created: " + req.Event + "/" + req.Hook.Name)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req.Hook)
}

// PutHook handles PUT /api/hooks/{event}/{name}
// Finds a hook by event+name and replaces it.
func (a *API) PutHook(w http.ResponseWriter, r *http.Request) {
	event, name := pathSegments(r.URL.Path, "/api/hooks/")
	if event == "" || name == "" {
		http.Error(w, "event and name are required", http.StatusBadRequest)
		return
	}

	var hookDef config.HookDef
	if err := json.NewDecoder(r.Body).Decode(&hookDef); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()
	hooks := cfg.Hooks[event]
	found := false
	for i, h := range hooks {
		if h.Name == name {
			hooks[i] = hookDef
			found = true
			break
		}
	}
	if !found {
		http.Error(w, "hook not found", http.StatusNotFound)
		return
	}
	cfg.Hooks[event] = hooks

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.logger.Info("hook updated: " + event + "/" + name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(hookDef)
}

// DeleteHook handles DELETE /api/hooks/{event}/{name}
// Removes a hook by event+name.
func (a *API) DeleteHook(w http.ResponseWriter, r *http.Request) {
	event, name := pathSegments(r.URL.Path, "/api/hooks/")
	if event == "" || name == "" {
		http.Error(w, "event and name are required", http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()
	hooks := cfg.Hooks[event]
	newHooks := hooks[:0:0]
	found := false
	for _, h := range hooks {
		if h.Name == name {
			found = true
			continue
		}
		newHooks = append(newHooks, h)
	}
	if !found {
		http.Error(w, "hook not found", http.StatusNotFound)
		return
	}
	cfg.Hooks[event] = newHooks

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.logger.Info("hook deleted: " + event + "/" + name)
	w.WriteHeader(http.StatusNoContent)
}

type testHookRequest struct {
	Payload map[string]any `json:"payload"`
}

type testHookResponse struct {
	Stdout   string  `json:"stdout"`
	Stderr   string  `json:"stderr"`
	ExitCode int     `json:"exit_code"`
	TimedOut bool    `json:"timed_out"`
	DurationMs int64 `json:"duration_ms"`
}

// TestHook handles POST /api/hooks/{event}/{name}/test
// Runs a hook with a sample payload and returns the result.
func (a *API) TestHook(w http.ResponseWriter, r *http.Request) {
	// path: /api/hooks/{event}/{name}/test
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/hooks/")
	trimmed = strings.TrimSuffix(trimmed, "/test")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.Error(w, "event and name are required", http.StatusBadRequest)
		return
	}
	event, name := parts[0], parts[1]

	var req testHookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()
	hooks := cfg.Hooks[event]
	var found *config.HookDef
	for i := range hooks {
		if hooks[i].Name == name {
			found = &hooks[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "hook not found", http.StatusNotFound)
		return
	}

	payloadBytes, err := json.Marshal(req.Payload)
	if err != nil {
		payloadBytes = []byte("{}")
	}

	timeout := time.Duration(found.Timeout) * time.Second
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	rt := found.Runtime
	if rt == "" && found.Type == "managed" {
		rt = executor.RuntimeFor(found.File, cfg.Runtimes.ExtMappings)
	}

	params := executor.Params{
		Type:    found.Type,
		Command: found.Command,
		Runtime: rt,
		Stdin:   payloadBytes,
		Timeout: timeout,
	}
	if found.Type == "managed" {
		params.ScriptPath = filepath.Join(a.scriptsDir, found.File)
	}

	result, err := executor.Run(r.Context(), params)
	if err != nil {
		http.Error(w, "execution error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := testHookResponse{
		Stdout:     string(result.Stdout),
		Stderr:     string(result.Stderr),
		ExitCode:   result.ExitCode,
		TimedOut:   result.TimedOut,
		DurationMs: result.Duration.Milliseconds(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// pathSegments strips a prefix and splits the remaining path into two segments.
// e.g., pathSegments("/api/hooks/PreToolUse/my-hook", "/api/hooks/") -> "PreToolUse", "my-hook"
func pathSegments(path, prefix string) (string, string) {
	trimmed := strings.TrimPrefix(path, prefix)
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return "", ""
}
