package hooks

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/damusix/hook-manager/internal/aggregator"
	"github.com/damusix/hook-manager/internal/capture"
	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/executor"
	"github.com/damusix/hook-manager/internal/logger"
)

// hookResult pairs a script execution result with the hook definition that produced it.
type hookResult struct {
	result executor.Result
	hook   config.HookDef
	err    error
}

// Handler serves POST /hook/{event} requests.
type Handler struct {
	store      *config.Store
	logger     *logger.Logger
	scriptsDir string
	shutdownCh chan struct{}
	capture    *capture.Buffer
}

// NewHandler creates a new hook handler.
func NewHandler(store *config.Store, logger *logger.Logger, scriptsDir string, shutdownCh chan struct{}, cap *capture.Buffer) *Handler {
	return &Handler{
		store:      store,
		logger:     logger,
		scriptsDir: scriptsDir,
		shutdownCh: shutdownCh,
		capture:    cap,
	}
}

// ServeHTTP handles POST /hook/{event}.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract event name from URL path: /hook/PreToolUse -> PreToolUse
	event := strings.TrimPrefix(r.URL.Path, "/hook/")
	if event == "" {
		http.Error(w, "missing event name", http.StatusBadRequest)
		return
	}

	// Read JSON body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	var input map[string]any
	if len(body) > 0 {
		if err := json.Unmarshal(body, &input); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
	}
	if input == nil {
		input = make(map[string]any)
	}

	// Enrich payload with headers and CLAUDE.md paths
	env := EnrichPayload(input, r)

	// Capture raw event for the live capture feed
	if h.capture != nil {
		project := ""
		if cwd, ok := input["cwd"].(string); ok {
			project = cwd
		} else if cwdEnv, ok := env["CLAUDE_CWD"]; ok {
			project = cwdEnv
		}
		h.capture.Record(event, project, env["CLAUDE_SESSION_ID"], input)
	}

	// Determine matcher field value from JSON
	matcherFieldValue := ""
	field := MatcherField(event)
	if field != "" {
		if v, ok := input[field]; ok {
			matcherFieldValue, _ = v.(string)
		}
	}

	// Get hooks for this event from config
	cfg := h.store.Get()
	eventHooks := cfg.Hooks[event]

	// Filter: enabled hooks whose matchers match
	var matching []config.HookDef
	for _, hk := range eventHooks {
		if !hk.IsEnabled() {
			continue
		}
		if !Matches(hk.Matcher, matcherFieldValue) {
			continue
		}
		matching = append(matching, hk)
	}

	// If no hooks match, return empty 200
	if len(matching) == 0 {
		h.handleSessionEnd(event, w)
		return
	}

	// Execute matching hooks concurrently
	results := h.executeHooks(r.Context(), event, matching, body, env)

	// Check for exit code 2 (block) - first blocker wins
	for _, hr := range results {
		if hr.err != nil {
			continue
		}
		if hr.result.ExitCode == 2 {
			reason := strings.TrimSpace(string(hr.result.Stdout))
			if reason == "" {
				reason = "blocked by hook: " + hr.hook.Name
			}
			blockResp := BlockResponse(event, reason)
			if blockResp.Body != nil {
				w.Header().Set("Content-Type", "application/json")
				if blockResp.UseHTTPError {
					w.WriteHeader(http.StatusForbidden)
				}
				json.NewEncoder(w).Encode(blockResp.Body)
			} else if blockResp.UseHTTPError {
				w.WriteHeader(http.StatusForbidden)
			}
			h.handleSessionEnd(event, w)
			return
		}
	}

	// Build script outputs for aggregation
	var outputs []aggregator.ScriptOutput
	for _, hr := range results {
		if hr.err != nil || len(hr.result.Stdout) == 0 {
			continue
		}
		stdout := hr.result.Stdout
		isJSON := json.Valid(stdout) && len(stdout) > 0 && stdout[0] == '{'
		outputs = append(outputs, aggregator.ScriptOutput{
			Stdout: stdout,
			IsJSON: isJSON,
		})
	}

	// Aggregate outputs
	agg := aggregator.Aggregate(outputs)

	// Build response
	if agg.JSON != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(agg.JSON)
	} else if agg.Text != "" {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(agg.Text))
	}

	h.handleSessionEnd(event, w)
}

// executeHooks runs all matching hooks concurrently and returns results in order.
func (h *Handler) executeHooks(ctx context.Context, eventName string, hooks []config.HookDef, stdin []byte, env map[string]string) []hookResult {
	results := make([]hookResult, len(hooks))
	var wg sync.WaitGroup

	for i, hk := range hooks {
		wg.Add(1)
		go func(idx int, hook config.HookDef) {
			defer wg.Done()

			timeout := time.Duration(hook.Timeout) * time.Second
			if timeout == 0 {
				timeout = 10 * time.Second
			}

			rt := hook.Runtime
			if rt == "" && hook.Type == "managed" {
				cfg := h.store.Get()
				rt = executor.RuntimeFor(hook.File, cfg.Runtimes.ExtMappings)
			}

			params := executor.Params{
				Type:    hook.Type,
				Command: hook.Command,
				Runtime: rt,
				Stdin:   stdin,
				Timeout: timeout,
				Env:     env,
			}

			if hook.Type == "managed" {
				params.ScriptPath = filepath.Join(h.scriptsDir, hook.File)
			}

			result, err := executor.Run(ctx, params)
			results[idx] = hookResult{result: result, hook: hook, err: err}

			// Log execution
			stdoutPreview := string(result.Stdout)
			if len(stdoutPreview) > 200 {
				stdoutPreview = stdoutPreview[:200]
			}
			h.logger.Log(logger.Entry{
				Event:         eventName,
				Hook:          hook.Name,
				Matcher:       hook.Matcher,
				ExitCode:      result.ExitCode,
				DurationMs:    result.Duration.Milliseconds(),
				StdoutPreview: stdoutPreview,
				Stderr:        string(result.Stderr),
			})
		}(i, hk)
	}

	wg.Wait()
	return results
}

// handleSessionEnd flushes the response if the event is SessionEnd.
func (h *Handler) handleSessionEnd(event string, w http.ResponseWriter) {
	if event == "SessionEnd" {
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
}
