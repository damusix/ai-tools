package ui

import (
	"bufio"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/logger"
	"github.com/damusix/hook-manager/web"
)

// EventInfo holds a hook event name and its description.
type EventInfo struct {
	Name string
	Desc string
}

// allEvents lists all Claude Code hook events with descriptions.
var allEvents = []EventInfo{
	{"PreToolUse", "Before a tool executes — can block or modify the action"},
	{"PostToolUse", "After a tool succeeds — inspect or react to results"},
	{"PostToolUseFailure", "After a tool fails — handle errors or retry logic"},
	{"UserPromptSubmit", "When the user submits a prompt — can block or add context"},
	{"Stop", "When the main agent finishes — can force it to continue"},
	{"StopFailure", "On API error during response — rate limits, auth failures"},
	{"SubagentStart", "When a subagent is spawned — add context to subagents"},
	{"SubagentStop", "When a subagent finishes — can force it to continue"},
	{"SessionStart", "Session begins or resumes — setup, context injection"},
	{"SessionEnd", "Session terminates — cleanup, save state"},
	{"PermissionRequest", "Permission dialog appears — auto-allow or deny actions"},
	{"Notification", "System notification sent — permission prompts, idle alerts"},
	{"InstructionsLoaded", "CLAUDE.md or rules loaded — modify or validate instructions"},
	{"ConfigChange", "Config file changes — can block config modifications"},
	{"FileChanged", "A watched file changes on disk — react to external edits"},
	{"TeammateIdle", "Team teammate going idle — keep it working or let it stop"},
	{"TaskCompleted", "A task is marked complete — validate or reject completion"},
	{"WorktreeCreate", "Git worktree created — customize worktree setup"},
	{"WorktreeRemove", "Git worktree removed — cleanup after worktree"},
	{"PreCompact", "Before context compaction — save important context"},
	{"PostCompact", "After context compaction — restore or inject context"},
	{"Elicitation", "MCP server requests user input — auto-fill or block"},
	{"ElicitationResult", "User responds to MCP elicitation — modify or block"},
	{"CwdChanged", "Working directory changes — update file watchers"},
}

// annotatedDefaultConfig is shown in the Advanced YAML section when the config file is empty.
const annotatedDefaultConfig = `# Hook Manager Configuration
# Location: ~/.ai-hooks/config.yaml

# ─── Server Settings ───────────────────────────────

server:
  # Port the Hook Manager HTTP server listens on.
  # This must match the port in hooks.json URLs.
  port: 47821

  # Log level: debug | info | warn | error
  # debug = verbose (includes payload details)
  # info  = normal (hook executions and results)
  # warn  = quiet (only warnings and errors)
  # error = silent (only errors)
  log_level: info

# ─── Hook Definitions ──────────────────────────────
# Hooks are grouped by Claude Code event name.
# Each hook has a name, type, and configuration.
#
# Two hook types:
#
#   command  — runs an arbitrary shell command
#   managed  — runs a script from ~/.ai-hooks/scripts/
#              with a specified runtime (python3, bun, etc.)
#
# Common fields:
#   name:     unique identifier within the event
#   matcher:  regex to filter (e.g., "Bash|Write"). Omit to match all.
#   enabled:  true/false (default: true)
#   timeout:  seconds before the script is killed (default: 10)

hooks:
  # Example: log all tool usage
  # PostToolUse:
  #   - name: log-tools
  #     type: command
  #     command: "echo '{\"systemMessage\":\"tool was used\"}'"
  #     timeout: 5

  # Example: block dangerous commands
  # PreToolUse:
  #   - name: block-rm-rf
  #     type: managed
  #     file: safety-check.py
  #     runtime: python3
  #     matcher: "Bash"
  #     timeout: 5

  # Example: inject context on session start
  # SessionStart:
  #   - name: load-context
  #     type: command
  #     command: "cat ~/.ai-hooks/scripts/context.sh"
  #     timeout: 3
`

// extToLanguage maps file extensions to Monaco editor language identifiers.
var extToLanguage = map[string]string{
	".py":   "python",
	".js":   "javascript",
	".ts":   "typescript",
	".sh":   "shell",
	".bash": "shell",
	".go":   "go",
	".rb":   "ruby",
	".yaml": "yaml",
	".yml":  "yaml",
}

type UI struct {
	pages      map[string]*template.Template // per-page template sets
	partials   *template.Template            // standalone partials (logs_table)
	staticFS   fs.FS
	store      *config.Store
	logPath    string
	configPath string
	scriptsDir string
}

// pageFiles lists page template filenames (in templates/) that each define
// their own "title" and "content" blocks. Each is combined with the base
// templates (layout.html, nav.html) into its own template set.
var pageFiles = []string{
	"dashboard.html",
	"hooks.html",
	"hook_detail.html",
	"scripts.html",
	"script_editor.html",
	"config_editor.html",
	"logs.html",
	"capture.html",
	"test_bench.html",
}

func New(store *config.Store, logPath, configPath, scriptsDir string) (*UI, error) {
	sub, err := fs.Sub(web.StaticFS, "static")
	if err != nil {
		return nil, err
	}

	// Read base templates (layout + nav) once
	baseFiles := []string{"templates/layout.html", "templates/nav.html"}
	base, err := template.ParseFS(web.TemplateFS, baseFiles...)
	if err != nil {
		return nil, fmt.Errorf("parsing base templates: %w", err)
	}

	// Build per-page template sets: clone base + add page file
	pages := make(map[string]*template.Template, len(pageFiles))
	for _, pf := range pageFiles {
		clone, err := base.Clone()
		if err != nil {
			return nil, fmt.Errorf("cloning base for %s: %w", pf, err)
		}
		_, err = clone.ParseFS(web.TemplateFS, "templates/"+pf)
		if err != nil {
			return nil, fmt.Errorf("parsing page template %s: %w", pf, err)
		}
		pages[pf] = clone
	}

	// Parse partials separately for fragment responses (e.g. logs_table)
	partials, err := template.ParseFS(web.TemplateFS, "templates/partials/*.html")
	if err != nil {
		return nil, fmt.Errorf("parsing partials: %w", err)
	}

	return &UI{
		pages:      pages,
		partials:   partials,
		staticFS:   sub,
		store:      store,
		logPath:    logPath,
		configPath: configPath,
		scriptsDir: scriptsDir,
	}, nil
}

// render executes the named page template with layout.html as the entry point.
func (u *UI) render(w http.ResponseWriter, page string, data any) {
	tmpl, ok := u.pages[page]
	if !ok {
		http.Error(w, "template not found: "+page, http.StatusInternalServerError)
		return
	}
	if err := tmpl.ExecuteTemplate(w, "layout.html", data); err != nil {
		http.Error(w, "template error: "+err.Error(), http.StatusInternalServerError)
	}
}

func (u *UI) StaticHandler() http.Handler {
	return http.StripPrefix("/static/", http.FileServer(http.FS(u.staticFS)))
}

func (u *UI) Dashboard(w http.ResponseWriter, r *http.Request) {
	cfg := u.store.Get()
	data := map[string]any{
		"Page":       "dashboard",
		"HookCounts": cfg.Hooks,
	}
	u.render(w, "dashboard.html", data)
}

// LogsPartial handles GET /ui/logs-partial
// Returns an HTML table fragment rendered from recent NDJSON log entries.
func (u *UI) LogsPartial(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	filterCategory := r.URL.Query().Get("category")
	filterEvent := r.URL.Query().Get("event")
	filterHook := r.URL.Query().Get("hook")

	entries := readLastLogs(u.logPath, limit, filterCategory, filterEvent, filterHook)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := u.partials.ExecuteTemplate(w, "logs_table", entries); err != nil {
		http.Error(w, "template error: "+err.Error(), http.StatusInternalServerError)
	}
}

// HookList handles GET /hooks — lists all hooks grouped by event.
func (u *UI) HookList(w http.ResponseWriter, r *http.Request) {
	cfg := u.store.Get()

	data := map[string]any{
		"Page":    "hooks",
		"Hooks":   cfg.Hooks,
		"Events":  allEvents,
		"Scripts": u.loadScriptInfos(),
	}
	u.render(w, "hooks.html", data)
}

// HookDetail handles GET /hooks/{event}/{name} — edit a single hook.
func (u *UI) HookDetail(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/hooks/")
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.Redirect(w, r, "/hooks", http.StatusFound)
		return
	}
	event, name := parts[0], parts[1]

	cfg := u.store.Get()
	hooks := cfg.Hooks[event]
	var found *config.HookDef
	for i := range hooks {
		if hooks[i].Name == name {
			found = &hooks[i]
			break
		}
	}
	if found == nil {
		http.Redirect(w, r, "/hooks", http.StatusFound)
		return
	}

	samplePayload := samplePayloadForEvent(event)

	data := map[string]any{
		"Page":          "hooks",
		"Event":         event,
		"Hook":          found,
		"SamplePayload": samplePayload,
	}
	u.render(w, "hook_detail.html", data)
}

// ScriptList handles GET /scripts — lists all managed scripts.
type scriptInfo struct {
	Filename    string
	Description string
}

func (u *UI) loadScriptInfos() []scriptInfo {
	entries, err := os.ReadDir(u.scriptsDir)
	if err != nil {
		return nil
	}

	// Load metadata
	meta := make(map[string]struct{ Description string })
	metaPath := filepath.Join(u.scriptsDir, ".metadata.json")
	if data, err := os.ReadFile(metaPath); err == nil {
		json.Unmarshal(data, &meta)
	}

	var scripts []scriptInfo
	for _, e := range entries {
		if !e.IsDir() && e.Name() != ".metadata.json" {
			info := scriptInfo{Filename: e.Name()}
			if m, ok := meta[e.Name()]; ok {
				info.Description = m.Description
			}
			scripts = append(scripts, info)
		}
	}
	return scripts
}

func (u *UI) ScriptList(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"Page":    "scripts",
		"Scripts": u.loadScriptInfos(),
	}
	u.render(w, "scripts.html", data)
}

// ScriptEditor handles GET /scripts/{file} — Monaco editor for a script.
func (u *UI) ScriptEditor(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/scripts/")
	if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		http.Redirect(w, r, "/scripts", http.StatusFound)
		return
	}

	content := ""
	data, err := os.ReadFile(filepath.Join(u.scriptsDir, filename))
	if err == nil {
		content = string(data)
	}

	ext := filepath.Ext(filename)
	lang := extToLanguage[ext]
	if lang == "" {
		lang = "plaintext"
	}

	// Load description from metadata
	description := ""
	meta := make(map[string]struct{ Description string })
	metaPath := filepath.Join(u.scriptsDir, ".metadata.json")
	if md, err := os.ReadFile(metaPath); err == nil {
		json.Unmarshal(md, &meta)
	}
	if m, ok := meta[filename]; ok {
		description = m.Description
	}

	tplData := map[string]any{
		"Page":        "scripts",
		"Filename":    filename,
		"Content":     content,
		"Language":    lang,
		"Events":      allEvents,
		"Description": description,
	}
	u.render(w, "script_editor.html", tplData)
}

// ConfigEditor handles GET /config — settings form for server config.
func (u *UI) ConfigEditor(w http.ResponseWriter, r *http.Request) {
	cfg := u.store.Get()

	// Read raw YAML for the advanced section; show annotated defaults if empty/missing
	yamlContent := ""
	data, err := os.ReadFile(u.configPath)
	if err == nil && len(strings.TrimSpace(string(data))) > 0 {
		yamlContent = string(data)
	} else {
		yamlContent = annotatedDefaultConfig
	}

	// Count total hooks
	totalHooks := 0
	for _, hooks := range cfg.Hooks {
		totalHooks += len(hooks)
	}

	tplData := map[string]any{
		"Page":       "config",
		"Port":       cfg.Server.Port,
		"LogLevel":   cfg.Server.LogLevel,
		"ConfigYAML": yamlContent,
		"TotalHooks": totalHooks,
		"ConfigPath": u.configPath,
		"Runtimes":   cfg.Runtimes,
	}
	u.render(w, "config_editor.html", tplData)
}

// LogViewer handles GET /logs — full log viewer with filters and live tail.
func (u *UI) LogViewer(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"Page":   "logs",
		"Events": allEvents,
	}
	u.render(w, "logs.html", data)
}

// CaptureView handles GET /capture — live event capture feed.
func (u *UI) CaptureView(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"Page": "capture",
	}
	u.render(w, "capture.html", data)
}

// TestBench handles GET /test — fire events with custom payloads.
func (u *UI) TestBench(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"Page":   "test",
		"Events": allEvents,
	}
	u.render(w, "test_bench.html", data)
}

// readLastLogs reads up to n log entries from an NDJSON file, returning the last n lines.
// Optionally filters by category, event, and hook name.
func readLastLogs(path string, n int, filterCategory, filterEvent, filterHook string) []logger.Entry {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var all []logger.Entry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry logger.Entry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}
		// Backfill category for entries written before the category field existed
		if entry.Category == "" {
			entry.Category = "hook"
		}
		if filterCategory != "" && entry.Category != filterCategory {
			continue
		}
		if filterEvent != "" && entry.Event != filterEvent {
			continue
		}
		if filterHook != "" && entry.Hook != filterHook {
			continue
		}
		all = append(all, entry)
	}

	if len(all) <= n {
		return all
	}
	return all[len(all)-n:]
}

// samplePayloadForEvent returns a sample JSON payload string for the given event type.
func samplePayloadForEvent(event string) string {
	switch event {
	case "PreToolUse":
		return `{"tool_name":"Bash","tool_input":{"command":"ls -la"}}`
	case "PostToolUse":
		return `{"tool_name":"Write","tool_input":{"file_path":"test.txt"},"tool_response":{"success":true}}`
	case "UserPromptSubmit":
		return `{"prompt":"Hello world"}`
	case "Stop":
		return `{"last_assistant_message":"Done."}`
	case "SessionStart":
		return `{"source":"startup","model":"claude-sonnet-4-6"}`
	case "SessionEnd":
		return `{"reason":"clear"}`
	case "PermissionRequest":
		return `{"tool_name":"Bash","tool_input":{"command":"rm -rf /"},"permission_type":"bash"}`
	default:
		return `{}`
	}
}
