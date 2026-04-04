package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/damusix/hook-manager/internal/executor"
	"github.com/damusix/hook-manager/internal/logger"
)

// ScriptInfo is returned by GET /api/scripts — filename + description.
type ScriptInfo struct {
	Filename    string `json:"filename"`
	Description string `json:"description"`
}

// scriptMeta is the per-script metadata stored in .metadata.json.
type scriptMeta struct {
	Description string `json:"description"`
}

func (a *API) metadataPath() string {
	return filepath.Join(a.scriptsDir, ".metadata.json")
}

func (a *API) loadMetadata() map[string]scriptMeta {
	meta := make(map[string]scriptMeta)
	data, err := os.ReadFile(a.metadataPath())
	if err != nil {
		return meta
	}
	json.Unmarshal(data, &meta)
	return meta
}

func (a *API) saveMetadata(meta map[string]scriptMeta) error {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.metadataPath(), data, 0644)
}

// GetScripts handles GET /api/scripts
// Lists all files with their descriptions.
func (a *API) GetScripts(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(a.scriptsDir)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]ScriptInfo{})
			return
		}
		http.Error(w, "failed to read scripts dir: "+err.Error(), http.StatusInternalServerError)
		return
	}

	meta := a.loadMetadata()
	scripts := make([]ScriptInfo, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && e.Name() != ".metadata.json" {
			info := ScriptInfo{Filename: e.Name()}
			if m, ok := meta[e.Name()]; ok {
				info.Description = m.Description
			}
			scripts = append(scripts, info)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scripts)
}

// PutScriptMeta handles PUT /api/scripts/{file}/meta
// Updates the description for a script.
func (a *API) PutScriptMeta(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/api/scripts/")
	filename = strings.TrimSuffix(filename, "/meta")
	if filename == "" || strings.Contains(filename, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	var req struct {
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	meta := a.loadMetadata()
	meta[filename] = scriptMeta{Description: req.Description}
	if err := a.saveMetadata(meta); err != nil {
		http.Error(w, "failed to save metadata", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type createScriptRequest struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	Description string `json:"description"`
}

// PostScript handles POST /api/scripts
// Creates a new script file.
func (a *API) PostScript(w http.ResponseWriter, r *http.Request) {
	var req createScriptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Filename == "" {
		http.Error(w, "filename is required", http.StatusBadRequest)
		return
	}
	if strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	// If content is empty, populate with a language-specific starter template
	if req.Content == "" {
		req.Content = starterTemplate(req.Filename)
	}

	dest := filepath.Join(a.scriptsDir, req.Filename)
	if err := os.WriteFile(dest, []byte(req.Content), 0755); err != nil {
		http.Error(w, "failed to write file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Save description if provided
	if req.Description != "" {
		meta := a.loadMetadata()
		meta[req.Filename] = scriptMeta{Description: req.Description}
		a.saveMetadata(meta)
	}

	a.logger.Info("script created: " + req.Filename)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(ScriptInfo{Filename: req.Filename, Description: req.Description})
}

// GetScript handles GET /api/scripts/{file}
// Returns script content as plain text.
func (a *API) GetScript(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/api/scripts/")
	if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	data, err := os.ReadFile(filepath.Join(a.scriptsDir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to read file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// PutScript handles PUT /api/scripts/{file}
// Writes raw text body to the script file.
func (a *API) PutScript(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/api/scripts/")
	if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	dest := filepath.Join(a.scriptsDir, filename)
	if err := os.WriteFile(dest, body, 0755); err != nil {
		http.Error(w, "failed to write file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	a.logger.Info("script updated: " + filename)
	w.WriteHeader(http.StatusNoContent)
}

// TestScript handles POST /api/scripts/{file}/test
// Executes the script with a JSON payload on stdin and returns the result.
func (a *API) TestScript(w http.ResponseWriter, r *http.Request) {
	// Extract filename: strip "/api/scripts/" prefix and "/test" suffix
	path := strings.TrimPrefix(r.URL.Path, "/api/scripts/")
	path = strings.TrimSuffix(path, "/test")
	if path == "" || strings.Contains(path, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	var req struct {
		Runtime string `json:"runtime"`
		Payload any    `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	scriptPath := filepath.Join(a.scriptsDir, path)
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		http.Error(w, "script not found", http.StatusNotFound)
		return
	}

	// Default runtime based on extension if not provided
	if req.Runtime == "" {
		cfg := a.store.Get()
		req.Runtime = executor.RuntimeFor(path, cfg.Runtimes.ExtMappings)
	}

	payloadBytes, _ := json.Marshal(req.Payload)

	result, err := executor.Run(context.Background(), executor.Params{
		Type:       "managed",
		Runtime:    req.Runtime,
		ScriptPath: scriptPath,
		Stdin:      payloadBytes,
		Timeout:    10 * time.Second,
	})
	if err != nil {
		a.logger.Log(logger.Entry{
			Category: "hook",
			Level:    "error",
			Event:    "test",
			Hook:     path,
			Message:  "execution error: " + err.Error(),
		})
		http.Error(w, "execution error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log all test runs so failures are visible on the logs page
	stdoutPreview := string(result.Stdout)
	if len(stdoutPreview) > 200 {
		stdoutPreview = stdoutPreview[:200]
	}
	level := "info"
	if result.TimedOut || result.ExitCode != 0 {
		level = "error"
	}
	a.logger.Log(logger.Entry{
		Event:         "test",
		Hook:          path,
		ExitCode:      result.ExitCode,
		DurationMs:    result.Duration.Milliseconds(),
		StdoutPreview: stdoutPreview,
		Stderr:        string(result.Stderr),
		Level:         level,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"exit_code":   result.ExitCode,
		"stdout":      string(result.Stdout),
		"stderr":      string(result.Stderr),
		"duration_ms": result.Duration.Milliseconds(),
		"timed_out":   result.TimedOut,
	})
}

// starterTemplate returns a language-specific boilerplate based on file extension.
// Shows how to read the hook JSON payload from stdin and write a response to stdout.
func starterTemplate(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".py":
		return `#!/usr/bin/env python3
"""
Hook Manager Script
-------------------
This script receives the hook event payload as JSON on stdin.
Write JSON to stdout to influence Claude Code's behavior.
Write logs/debug output to stderr (captured in hooks.log).
Exit code 0 = success, exit code 2 = block the action.
"""

import sys
import json

# Read the hook payload from stdin
payload = json.load(sys.stdin)

# Access common fields
event = payload.get("hook_event_name", "")
cwd = payload.get("cwd", "")

# For tool events (PreToolUse, PostToolUse, etc.)
tool_name = payload.get("tool_name", "")
tool_input = payload.get("tool_input", {})

# --- Your logic here ---

# Example: log to stderr (appears in hooks.log)
print(f"Hook fired: {event} / {tool_name}", file=sys.stderr)

# Example: return a system message to Claude
response = {
    "systemMessage": "Hook script executed successfully"
}
json.dump(response, sys.stdout)

# Exit 0 = success, exit 2 = block the action
# sys.exit(2)  # Uncomment to block
`
	case ".js":
		return `#!/usr/bin/env node
/**
 * Hook Manager Script
 * -------------------
 * This script receives the hook event payload as JSON on stdin.
 * Write JSON to stdout to influence Claude Code's behavior.
 * Write logs/debug output to stderr (captured in hooks.log).
 * Exit code 0 = success, exit code 2 = block the action.
 */

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const payload = JSON.parse(input);

    // Access common fields
    const event = payload.hook_event_name || '';
    const cwd = payload.cwd || '';

    // For tool events (PreToolUse, PostToolUse, etc.)
    const toolName = payload.tool_name || '';
    const toolInput = payload.tool_input || {};

    // --- Your logic here ---

    // Example: log to stderr (appears in hooks.log)
    console.error(` + "`Hook fired: ${event} / ${toolName}`" + `);

    // Example: return a system message to Claude
    const response = {
        systemMessage: 'Hook script executed successfully'
    };
    process.stdout.write(JSON.stringify(response));

    // Exit 0 = success, exit 2 = block the action
    // process.exit(2);  // Uncomment to block
});
`
	case ".ts":
		return `#!/usr/bin/env bun
/**
 * Hook Manager Script (TypeScript)
 * ---------------------------------
 * This script receives the hook event payload as JSON on stdin.
 * Write JSON to stdout to influence Claude Code's behavior.
 * Write logs/debug output to stderr (captured in hooks.log).
 * Exit code 0 = success, exit code 2 = block the action.
 *
 * Run with: bun, deno, or ts-node
 */

interface HookPayload {
    hook_event_name?: string;
    session_id?: string;
    cwd?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: Record<string, unknown>;
    [key: string]: unknown;
}

const input = await Bun.stdin.text();
const payload: HookPayload = JSON.parse(input);

// Access common fields
const event = payload.hook_event_name ?? '';
const cwd = payload.cwd ?? '';

// For tool events (PreToolUse, PostToolUse, etc.)
const toolName = payload.tool_name ?? '';
const toolInput = payload.tool_input ?? {};

// --- Your logic here ---

// Example: log to stderr (appears in hooks.log)
console.error(` + "`Hook fired: ${event} / ${toolName}`" + `);

// Example: return a system message to Claude
const response = {
    systemMessage: 'Hook script executed successfully'
};
process.stdout.write(JSON.stringify(response));

// Exit 0 = success, exit 2 = block the action
// process.exit(2);  // Uncomment to block
`
	case ".sh", ".bash":
		return `#!/usr/bin/env bash
# Hook Manager Script
# -------------------
# This script receives the hook event payload as JSON on stdin.
# Write JSON to stdout to influence Claude Code's behavior.
# Write logs/debug output to stderr (captured in hooks.log).
# Exit code 0 = success, exit code 2 = block the action.

set -euo pipefail

# Read the hook payload from stdin
PAYLOAD=$(cat)

# Parse fields with jq (install: brew install jq)
EVENT=$(echo "$PAYLOAD" | jq -r '.hook_event_name // ""')
CWD=$(echo "$PAYLOAD" | jq -r '.cwd // ""')

# For tool events (PreToolUse, PostToolUse, etc.)
TOOL_NAME=$(echo "$PAYLOAD" | jq -r '.tool_name // ""')

# --- Your logic here ---

# Example: log to stderr (appears in hooks.log)
echo "Hook fired: $EVENT / $TOOL_NAME" >&2

# Example: return a system message to Claude
echo '{"systemMessage":"Hook script executed successfully"}'

# Exit 0 = success, exit 2 = block the action
# exit 2  # Uncomment to block
`
	case ".rb":
		return `#!/usr/bin/env ruby
# Hook Manager Script
# -------------------
# This script receives the hook event payload as JSON on stdin.
# Write JSON to stdout to influence Claude Code's behavior.
# Write logs/debug output to stderr (captured in hooks.log).
# Exit code 0 = success, exit code 2 = block the action.

require 'json'

# Read the hook payload from stdin
payload = JSON.parse($stdin.read)

# Access common fields
event = payload['hook_event_name'] || ''
cwd = payload['cwd'] || ''

# For tool events (PreToolUse, PostToolUse, etc.)
tool_name = payload['tool_name'] || ''
tool_input = payload['tool_input'] || {}

# --- Your logic here ---

# Example: log to stderr (appears in hooks.log)
$stderr.puts "Hook fired: #{event} / #{tool_name}"

# Example: return a system message to Claude
response = { systemMessage: 'Hook script executed successfully' }
$stdout.write(response.to_json)

# Exit 0 = success, exit 2 = block the action
# exit 2  # Uncomment to block
`
	case ".go":
		return `//go:build ignore

package main

// Hook Manager Script
// -------------------
// This script receives the hook event payload as JSON on stdin.
// Write JSON to stdout to influence Claude Code's behavior.
// Write logs/debug output to stderr (captured in hooks.log).
// Exit code 0 = success, exit code 2 = block the action.
//
// Run with: go run script.go

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	// Read the hook payload from stdin
	var payload map[string]any
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse payload: %v\n", err)
		os.Exit(1)
	}

	// Access common fields
	event, _ := payload["hook_event_name"].(string)
	toolName, _ := payload["tool_name"].(string)

	// --- Your logic here ---

	// Example: log to stderr (appears in hooks.log)
	fmt.Fprintf(os.Stderr, "Hook fired: %s / %s\n", event, toolName)

	// Example: return a system message to Claude
	response := map[string]any{
		"systemMessage": "Hook script executed successfully",
	}
	json.NewEncoder(os.Stdout).Encode(response)

	// os.Exit(2) // Uncomment to block the action
}
`
	default:
		return `# Hook Manager Script
# -------------------
# This script receives the hook event payload as JSON on stdin.
# Write JSON to stdout to influence Claude Code's behavior.
# Write logs/debug output to stderr (captured in hooks.log).
# Exit code 0 = success, exit code 2 = block the action.
#
# The JSON payload contains fields like:
#   hook_event_name  - The event that fired (e.g., "PreToolUse")
#   session_id       - The Claude Code session ID
#   cwd              - Current working directory
#   tool_name        - Tool being used (for tool events)
#   tool_input       - Tool input parameters (for tool events)
`
	}
}

// DeleteScript handles DELETE /api/scripts/{file}
// Deletes the script file.
func (a *API) DeleteScript(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/api/scripts/")
	if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	dest := filepath.Join(a.scriptsDir, filename)
	if err := os.Remove(dest); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "file not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to delete file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Clean up metadata
	meta := a.loadMetadata()
	delete(meta, filename)
	a.saveMetadata(meta)

	a.logger.Info("script deleted: " + filename)
	w.WriteHeader(http.StatusNoContent)
}
