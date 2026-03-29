package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type aiRequest struct {
	Prompt   string   `json:"prompt"`
	Model    string   `json:"model"`
	Context  string   `json:"context"`
	Filename string   `json:"filename"`
	Mode     string   `json:"mode"`
	Event    string   `json:"event"`
	Events   []string `json:"events"` // selected hook events for script generation
}

type aiResponse struct {
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
}

var modelIDs = map[string]string{
	"haiku":  "claude-haiku-4-5-20251001",
	"sonnet": "claude-sonnet-4-6",
	"opus":   "claude-opus-4-6",
}

func langFromExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	langs := map[string]string{
		".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
		".sh": "Bash", ".bash": "Bash", ".rb": "Ruby", ".go": "Go",
	}
	if lang, ok := langs[ext]; ok {
		return lang
	}
	return "shell script"
}

func stripCodeFences(s string) string {
	re := regexp.MustCompile("(?s)^\\s*```[a-zA-Z]*\\s*\n?(.*?)\\s*```\\s*$")
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return m[1]
	}
	return s
}

// eventSchemas maps each hook event to a TypeScript-style type definition
// with property explanations. Expressed in TS for brevity as the user requested.
var eventSchemas = map[string]string{
	"PreToolUse": `// Fires BEFORE a tool executes. Can block or modify the action.
interface PreToolUsePayload {
    hook_event_name: "PreToolUse";
    session_id: string;          // Current session ID
    cwd: string;                 // Working directory
    permission_mode: string;     // "default" | "plan" | "acceptEdits" | "auto" | "dontAsk"
    tool_name: string;           // "Bash" | "Edit" | "Write" | "Read" | "Glob" | "Grep" | "Agent" | "WebFetch" | "WebSearch" | "mcp__*"
    tool_input: {                // Tool-specific input (varies by tool)
        command?: string;        // Bash: the shell command
        file_path?: string;      // Write/Edit/Read: target file
        content?: string;        // Write: file content
        old_string?: string;     // Edit: text to replace
        new_string?: string;     // Edit: replacement text
        pattern?: string;        // Glob/Grep: search pattern
        description?: string;    // Bash: command description
    };
    tool_use_id: string;         // Unique tool invocation ID
}
// Response: { hookSpecificOutput: { permissionDecision: "allow"|"deny"|"ask", permissionDecisionReason?: string, updatedInput?: object, additionalContext?: string } }`,

	"PostToolUse": `// Fires AFTER a tool succeeds. Inspect results, inject context.
interface PostToolUsePayload {
    hook_event_name: "PostToolUse";
    session_id: string;
    cwd: string;
    permission_mode: string;
    tool_name: string;           // Same tool names as PreToolUse
    tool_input: object;          // Original input sent to the tool
    tool_response: {             // Tool's return value
        filePath?: string;       // Write/Edit: affected file
        success?: boolean;       // Operation success flag
        content?: string;        // Read: file content
        [key: string]: any;
    };
    tool_use_id: string;
}
// Response: { hookSpecificOutput: { additionalContext?: string } }`,

	"PostToolUseFailure": `// Fires when a tool execution fails. Handle errors or add context.
interface PostToolUseFailurePayload {
    hook_event_name: "PostToolUseFailure";
    session_id: string;
    cwd: string;
    permission_mode: string;
    tool_name: string;
    tool_input: object;
    tool_use_id: string;
    error: string;               // Error message from the tool
    is_interrupt: boolean;       // Whether the user interrupted execution
}
// Response: { hookSpecificOutput: { additionalContext?: string } }`,

	"UserPromptSubmit": `// Fires when the user submits a prompt. Can block or add context.
interface UserPromptSubmitPayload {
    hook_event_name: "UserPromptSubmit";
    session_id: string;
    cwd: string;
    permission_mode: string;
    prompt: string;              // The user's input text
}
// Response: { decision?: "block", reason?: string, hookSpecificOutput?: { additionalContext?: string } }
// Plain text stdout is also added as context automatically.`,

	"PermissionRequest": `// Fires when a permission dialog appears. Auto-allow or deny.
interface PermissionRequestPayload {
    hook_event_name: "PermissionRequest";
    session_id: string;
    cwd: string;
    permission_mode: string;
    tool_name: string;
    tool_input: object;
    permission_suggestions: Array<{
        type: "addRules";
        rules: Array<{ toolName: string; ruleContent: string }>;
        behavior: "allow" | "deny";
        destination: "localSettings" | "projectSettings" | "userSettings";
    }>;
}
// Response: { hookSpecificOutput: { decision: { behavior: "allow"|"deny", message?: string, updatedInput?: object } } }`,

	"Stop": `// Fires when the main agent finishes. Can force it to continue.
interface StopPayload {
    hook_event_name: "Stop";
    session_id: string;
    cwd: string;
    permission_mode: string;
    stop_hook_active: boolean;   // Whether stop hooks are currently active
    last_assistant_message: string; // The agent's final message
}
// Response: { decision?: "block", reason?: string } — "block" forces the agent to continue`,

	"StopFailure": `// Fires on API error during response (rate limits, auth, etc).
interface StopFailurePayload {
    hook_event_name: "StopFailure";
    session_id: string;
    cwd: string;
    error: "rate_limit" | "authentication_failed" | "billing_error" | "invalid_request" | "server_error" | "max_output_tokens" | "unknown";
    error_details: string;       // Human-readable error description
    last_assistant_message: string;
}
// Response: side-effect only, cannot block`,

	"SubagentStart": `// Fires when a subagent is spawned. Add context to subagents.
interface SubagentStartPayload {
    hook_event_name: "SubagentStart";
    session_id: string;
    cwd: string;
    agent_id: string;            // Unique agent instance ID
    agent_type: string;          // "Explore" | "Bash" | "Plan" | custom agent name
}
// Response: { hookSpecificOutput: { additionalContext?: string } }`,

	"SubagentStop": `// Fires when a subagent finishes. Can force it to continue.
interface SubagentStopPayload {
    hook_event_name: "SubagentStop";
    session_id: string;
    cwd: string;
    permission_mode: string;
    stop_hook_active: boolean;
    agent_id: string;
    agent_type: string;
    agent_transcript_path: string; // Path to subagent's transcript JSONL
    last_assistant_message: string;
}
// Response: { decision?: "block", reason?: string }`,

	"SessionStart": `// Fires when a session begins or resumes. Setup, context injection.
interface SessionStartPayload {
    hook_event_name: "SessionStart";
    session_id: string;
    transcript_path: string;     // Path to session transcript
    cwd: string;
    source: "startup" | "resume" | "clear" | "compact";
    model: string;               // e.g., "claude-sonnet-4-6"
}
// Response: { hookSpecificOutput: { additionalContext?: string } }`,

	"SessionEnd": `// Fires when a session terminates. Cleanup, save state.
interface SessionEndPayload {
    hook_event_name: "SessionEnd";
    session_id: string;
    cwd: string;
    reason: "clear" | "resume" | "logout" | "prompt_input_exit" | "bypass_permissions_disabled" | "other";
}
// Response: side-effect only`,

	"Notification": `// Fires when a system notification is sent.
interface NotificationPayload {
    hook_event_name: "Notification";
    session_id: string;
    cwd: string;
    notification_type: "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog";
    message: string;
    title: string;
}
// Response: side-effect only`,

	"InstructionsLoaded": `// Fires when CLAUDE.md or instruction files are loaded.
interface InstructionsLoadedPayload {
    hook_event_name: "InstructionsLoaded";
    session_id: string;
    cwd: string;
    file_path: string;           // Path to the loaded file
    memory_type: "User" | "Project" | "Local" | "Managed";
    load_reason: "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact";
    globs?: string[];            // Glob patterns that triggered load
    trigger_file_path?: string;
    parent_file_path?: string;
}
// Response: side-effect only`,

	"ConfigChange": `// Fires when a config file changes. Can block the change.
interface ConfigChangePayload {
    hook_event_name: "ConfigChange";
    session_id: string;
    cwd: string;
    source: "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills";
    file_path: string;
}
// Response: { decision?: "block", reason?: string }`,

	"CwdChanged": `// Fires when the working directory changes.
interface CwdChangedPayload {
    hook_event_name: "CwdChanged";
    session_id: string;
    cwd: string;                 // Same as new_cwd
    old_cwd: string;
    new_cwd: string;
}
// Response: { hookSpecificOutput?: { watchPaths?: string[] } }`,

	"FileChanged": `// Fires when a watched file changes on disk.
interface FileChangedPayload {
    hook_event_name: "FileChanged";
    session_id: string;
    cwd: string;
    file_path: string;           // Absolute path to the changed file
    event: "change" | "add" | "unlink";
}
// Response: { hookSpecificOutput?: { watchPaths?: string[] } }`,

	"TeammateIdle": `// Fires when a team teammate is going idle. Can keep it working.
interface TeammateIdlePayload {
    hook_event_name: "TeammateIdle";
    session_id: string;
    cwd: string;
    permission_mode: string;
    teammate_name: string;
    team_name: string;
}
// Response: { continue?: false, stopReason?: string }`,

	"TaskCompleted": `// Fires when a task is marked complete. Can reject completion.
interface TaskCompletedPayload {
    hook_event_name: "TaskCompleted";
    session_id: string;
    cwd: string;
    permission_mode: string;
    task_id: string;
    task_subject: string;
    task_description: string;
    teammate_name: string;
    team_name: string;
}
// Response: { continue?: false, stopReason?: string }`,

	"WorktreeCreate": `// Fires when a git worktree is created.
interface WorktreeCreatePayload {
    hook_event_name: "WorktreeCreate";
    session_id: string;
    cwd: string;
    name: string;                // Worktree/branch name
}
// Response: return worktree path in stdout, or non-2xx to block`,

	"WorktreeRemove": `// Fires when a git worktree is removed.
interface WorktreeRemovePayload {
    hook_event_name: "WorktreeRemove";
    session_id: string;
    cwd: string;
    name: string;
    path: string;                // Absolute path to the worktree
}
// Response: side-effect only`,

	"PreCompact": `// Fires before context compaction. Save important context.
interface PreCompactPayload {
    hook_event_name: "PreCompact";
    session_id: string;
    cwd: string;
}
// Response: side-effect only`,

	"PostCompact": `// Fires after context compaction. Restore or inject context.
interface PostCompactPayload {
    hook_event_name: "PostCompact";
    session_id: string;
    cwd: string;
}
// Response: side-effect only`,

	"Elicitation": `// Fires when an MCP server requests user input. Auto-fill or block.
interface ElicitationPayload {
    hook_event_name: "Elicitation";
    session_id: string;
    cwd: string;
    mcp_server: string;          // MCP server name
    tool_name: string;           // e.g., "mcp__memory__save"
    form: {
        fields: Array<{
            name: string;
            type: "text" | "select";
            label: string;
            required: boolean;
        }>;
    };
}
// Response: { hookSpecificOutput: { action: "accept"|"decline"|"cancel", content?: object } }`,

	"ElicitationResult": `// Fires when the user responds to an MCP elicitation.
interface ElicitationResultPayload {
    hook_event_name: "ElicitationResult";
    session_id: string;
    cwd: string;
    mcp_server: string;
    tool_name: string;
    form: object;                // Same form definition as Elicitation
    content: { [key: string]: any }; // User's responses
}
// Response: { hookSpecificOutput: { action: "accept"|"decline"|"cancel", content?: object } }`,
}

// allEventNames in display order.
var allEventNames = []string{
	"PreToolUse", "PostToolUse", "PostToolUseFailure",
	"UserPromptSubmit", "PermissionRequest",
	"Stop", "StopFailure", "SubagentStart", "SubagentStop",
	"SessionStart", "SessionEnd",
	"Notification", "InstructionsLoaded", "ConfigChange",
	"CwdChanged", "FileChanged",
	"TeammateIdle", "TaskCompleted",
	"WorktreeCreate", "WorktreeRemove",
	"PreCompact", "PostCompact",
	"Elicitation", "ElicitationResult",
}

func buildScriptPrompt(req aiRequest) string {
	lang := langFromExt(req.Filename)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(`You are generating a %s hook script for Claude Code's Hook Manager.

HOOK SCRIPT CONTRACT:
- The script receives a JSON payload on STDIN
- Write JSON to STDOUT to influence Claude Code's behavior
- Write logs/debug to STDERR (captured in hooks.log)
- Exit code 0 = allow/success
- Exit code 2 = block the action
- Any other non-zero exit = error

STDOUT RESPONSE FORMAT (JSON, all fields optional):
- "systemMessage": string — Inject a system message into the conversation
- "hookSpecificOutput": object — Event-specific response (see per-event docs below)
- "continue": boolean — For Stop/SubagentStop: false to stop, true to continue
- "decision": "block" — For blockable events: block the action
- "reason": string — Reason for blocking
- "suppressOutput": boolean — Hide hook output from verbose logs

`, lang))

	// Inject selected event schemas
	events := req.Events
	if len(events) == 0 {
		// "All hooks" — inject everything
		events = allEventNames
	}

	sb.WriteString("EVENT PAYLOAD TYPES (TypeScript for brevity):\n\n")
	for _, ev := range events {
		if schema, ok := eventSchemas[ev]; ok {
			sb.WriteString(schema)
			sb.WriteString("\n\n")
		}
	}

	if req.Context != "" {
		sb.WriteString(fmt.Sprintf("CURRENT SCRIPT CONTENT:\n```\n%s\n```\nThe user may want to update this script or start fresh based on their request.\n\n", req.Context))
	}

	sb.WriteString(fmt.Sprintf("IMPORTANT: Output ONLY the %s script code. No markdown fences. No explanations. The output goes directly into a file.\n\n", lang))
	sb.WriteString(fmt.Sprintf("USER REQUEST:\n%s", req.Prompt))

	return sb.String()
}

func buildTestPrompt(req aiRequest) string {
	var sb strings.Builder
	sb.WriteString(`You generate JSON test payloads. You ONLY output raw JSON. Never markdown. Never explanations. Never code fences. Just a single JSON object.

`)

	if req.Event != "" {
		if schema, ok := eventSchemas[req.Event]; ok {
			sb.WriteString(fmt.Sprintf("Target event: %s\n\n%s\n\n", req.Event, schema))
		}
	}

	if req.Context != "" {
		sb.WriteString(fmt.Sprintf("Script being tested:\n%s\n\n", req.Context))
	}

	sb.WriteString(fmt.Sprintf("Generate ONE JSON payload object for this scenario: %s\n\nRemember: raw JSON only. No text before or after.", req.Prompt))

	return sb.String()
}

// extractJSON tries to find the first valid JSON object in a string,
// handling cases where the model wraps it in markdown or adds explanation.
func extractJSON(s string) string {
	s = strings.TrimSpace(s)

	// Strip markdown fences first
	s = stripCodeFences(s)
	s = strings.TrimSpace(s)

	// If it starts with {, try to find the matching }
	if len(s) > 0 && s[0] == '{' {
		depth := 0
		inString := false
		escape := false
		for i, ch := range s {
			if escape {
				escape = false
				continue
			}
			if ch == '\\' && inString {
				escape = true
				continue
			}
			if ch == '"' {
				inString = !inString
				continue
			}
			if inString {
				continue
			}
			if ch == '{' {
				depth++
			} else if ch == '}' {
				depth--
				if depth == 0 {
					return s[:i+1]
				}
			}
		}
	}

	// Fallback: look for first { and last }
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return s[start : end+1]
	}

	return s
}

// GenerateAI handles POST /api/ai/generate
func (a *API) GenerateAI(w http.ResponseWriter, r *http.Request) {
	if _, err := exec.LookPath("claude"); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(aiResponse{Error: "Claude Code CLI not found in PATH"})
		return
	}

	var req aiRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(aiResponse{Error: "invalid JSON: " + err.Error()})
		return
	}

	if req.Prompt == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(aiResponse{Error: "prompt is required"})
		return
	}

	var fullPrompt string
	switch req.Mode {
	case "test":
		fullPrompt = buildTestPrompt(req)
	default:
		fullPrompt = buildScriptPrompt(req)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	// Pipe prompt via stdin to avoid ARG_MAX limits on long prompts
	args := []string{"--output-format", "text"}
	if req.Model != "" {
		if modelID, ok := modelIDs[req.Model]; ok {
			args = append(args, "--model", modelID)
		}
	}
	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Stdin = strings.NewReader(fullPrompt)
	output, err := cmd.Output()
	if err != nil {
		errMsg := fmt.Sprintf("claude command failed: %v", err)
		if exitErr, ok := err.(*exec.ExitError); ok {
			errMsg = fmt.Sprintf("claude failed (exit %d): %s", exitErr.ExitCode(), string(exitErr.Stderr))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(aiResponse{Error: errMsg})
		return
	}

	content := strings.TrimSpace(string(output))
	if req.Mode == "test" {
		content = extractJSON(content)
	} else {
		content = stripCodeFences(content)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(aiResponse{Content: content})
}
