# Hook Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that orchestrates user-defined hooks via a Go HTTP server with an HTMX web UI.

**Architecture:** A long-running Go server boots on SessionStart, receives all 24 hook events via HTTP, fans out to user scripts configured in YAML, aggregates results, and returns JSON to Claude Code. An HTMX UI provides hook management, a script editor (Monaco), log viewer, and test bench.

**Tech Stack:** Go 1.25, `net/http` stdlib, `gopkg.in/yaml.v3`, `html/template`, HTMX (embedded), Monaco Editor / PrismJS / Tailwind CSS (CDN)

**Spec:** `docs/superpowers/specs/2026-03-26-hook-manager-design.md`

---

## Phase 1: Core Server + Plugin Shell

The core server handles hook execution, script management, and logging. No UI — just the HTTP API. This phase produces a fully functional hook orchestrator testable via curl.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `hook-manager/go.mod`
- Create: `hook-manager/go.sum`
- Create: `hook-manager/cmd/server/main.go`
- Create: `hook-manager/.claude-plugin/plugin.json`
- Create: `hook-manager/hooks/hooks.json`
- Create: `hook-manager/hooks/scripts/start.sh`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Initialize Go module**

```bash
cd hook-manager
go mod init github.com/damusix/hook-manager
```

- [ ] **Step 2: Add YAML dependency**

```bash
cd hook-manager
go get gopkg.in/yaml.v3
```

- [ ] **Step 3: Create minimal main.go**

```go
package main

import (
    "fmt"
    "os"
)

var (
    version   = "dev"
    commit    = "unknown"
    buildDate = "unknown"
)

func main() {
    if len(os.Args) > 1 && os.Args[1] == "version" {
        fmt.Printf("hook-manager %s (%s) built %s\n", version, commit, buildDate)
        os.Exit(0)
    }
    fmt.Fprintln(os.Stderr, "hook-manager server starting...")
    os.Exit(0)
}
```

- [ ] **Step 4: Create plugin.json**

```json
{
    "name": "hook-manager",
    "version": "0.1.0",
    "description": "Universal hook orchestrator with web UI — manage Claude Code hooks without writing plugins",
    "author": { "name": "Danilo Alonso" }
}
```

- [ ] **Step 5: Create hooks.json with all 24 events**

SessionStart as `command` hook, all 23 others as `http` hooks on port 47821. Events with matchers use `".*"`, events without matchers omit the field. See spec lines 175-204 for which events support matchers and what they match against.

```json
{
    "hooks": {
        "SessionStart": [{
            "hooks": [{
                "type": "command",
                "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/start.sh\"",
                "timeout": 10
            }]
        }],
        "SessionEnd": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/SessionEnd", "timeout": 10 }]
        }],
        "UserPromptSubmit": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/UserPromptSubmit", "timeout": 10 }]
        }],
        "PreToolUse": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PreToolUse", "timeout": 10 }]
        }],
        "PostToolUse": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PostToolUse", "timeout": 10 }]
        }],
        "PostToolUseFailure": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PostToolUseFailure", "timeout": 10 }]
        }],
        "PermissionRequest": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PermissionRequest", "timeout": 10 }]
        }],
        "Stop": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/Stop", "timeout": 10 }]
        }],
        "StopFailure": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/StopFailure", "timeout": 10 }]
        }],
        "SubagentStart": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/SubagentStart", "timeout": 10 }]
        }],
        "SubagentStop": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/SubagentStop", "timeout": 10 }]
        }],
        "Notification": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/Notification", "timeout": 10 }]
        }],
        "TeammateIdle": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/TeammateIdle", "timeout": 10 }]
        }],
        "TaskCompleted": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/TaskCompleted", "timeout": 10 }]
        }],
        "InstructionsLoaded": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/InstructionsLoaded", "timeout": 10 }]
        }],
        "ConfigChange": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/ConfigChange", "timeout": 10 }]
        }],
        "CwdChanged": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/CwdChanged", "timeout": 10 }]
        }],
        "FileChanged": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/FileChanged", "timeout": 10 }]
        }],
        "WorktreeCreate": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/WorktreeCreate", "timeout": 10 }]
        }],
        "WorktreeRemove": [{
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/WorktreeRemove", "timeout": 10 }]
        }],
        "PreCompact": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PreCompact", "timeout": 10 }]
        }],
        "PostCompact": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/PostCompact", "timeout": 10 }]
        }],
        "Elicitation": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/Elicitation", "timeout": 10 }]
        }],
        "ElicitationResult": [{
            "matcher": ".*",
            "hooks": [{ "type": "http", "url": "http://localhost:47821/hook/ElicitationResult", "timeout": 10 }]
        }]
    }
}
```

- [ ] **Step 6: Create placeholder start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "hook-manager start.sh placeholder" >&2
exit 0
```

Make executable: `chmod +x hook-manager/hooks/scripts/start.sh`

- [ ] **Step 7: Register in marketplace.json**

Add to the `plugins` array in `.claude-plugin/marketplace.json`:

```json
{
    "name": "hook-manager",
    "version": "0.1.0",
    "source": "./hook-manager",
    "description": "Universal hook orchestrator with web UI",
    "author": { "name": "Danilo Alonso" },
    "keywords": ["hooks", "orchestrator", "ui", "management"]
}
```

- [ ] **Step 8: Add to pnpm-workspace.yaml**

Add `- hook-manager` to the `packages` list.

- [ ] **Step 9: Verify build**

```bash
cd hook-manager
go build -o /dev/null ./cmd/server
```

Expected: clean build, exit 0.

- [ ] **Step 10: Commit**

```bash
git add hook-manager/ .claude-plugin/marketplace.json pnpm-workspace.yaml
git commit -m "feat(hook-manager): scaffold Go project with plugin registration"
```

---

### Task 2: Config Package

**Files:**
- Create: `hook-manager/internal/config/types.go`
- Create: `hook-manager/internal/config/loader.go`
- Create: `hook-manager/internal/config/loader_test.go`

This package handles loading, validating, and hot-reloading `~/.ai-hooks/config.yaml`.

- [ ] **Step 1: Write types.go**

```go
package config

// Config is the top-level config structure for ~/.ai-hooks/config.yaml
type Config struct {
    Server ServerConfig          `yaml:"server"`
    Hooks  map[string][]HookDef  `yaml:"hooks"` // key = event name
}

type ServerConfig struct {
    Port     int    `yaml:"port"`
    LogLevel string `yaml:"log_level"`
}

type HookDef struct {
    Name    string `yaml:"name"`
    Type    string `yaml:"type"`    // "managed" or "command"
    Command string `yaml:"command"` // for type=command
    File    string `yaml:"file"`    // for type=managed
    Runtime string `yaml:"runtime"` // for type=managed
    Matcher string `yaml:"matcher"` // regex, optional
    Enabled *bool  `yaml:"enabled"` // pointer so we can detect omission (default true)
    Timeout int    `yaml:"timeout"` // seconds
}

// IsEnabled returns true if the hook is enabled (default true if omitted)
func (h HookDef) IsEnabled() bool {
    if h.Enabled == nil {
        return true
    }
    return *h.Enabled
}

// DefaultConfig returns a config with sensible defaults
func DefaultConfig() Config {
    return Config{
        Server: ServerConfig{
            Port:     47821,
            LogLevel: "info",
        },
        Hooks: make(map[string][]HookDef),
    }
}
```

- [ ] **Step 2: Write failing tests for loader**

Create `loader_test.go` with tests for:
- Loading a valid config file
- Default values when fields are omitted
- Missing file creates default config + state directory
- Invalid YAML returns error
- Hook with `enabled: false` reports as disabled
- Hook with omitted `enabled` reports as enabled

```go
package config

import (
    "os"
    "path/filepath"
    "testing"
)

func TestLoadValidConfig(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "config.yaml")
    os.WriteFile(path, []byte(`
server:
  port: 9999
  log_level: debug
hooks:
  PreToolUse:
    - name: test-hook
      type: command
      command: echo hello
      matcher: "Bash"
      timeout: 5
`), 0644)

    cfg, err := Load(path)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if cfg.Server.Port != 9999 {
        t.Errorf("port = %d, want 9999", cfg.Server.Port)
    }
    if cfg.Server.LogLevel != "debug" {
        t.Errorf("log_level = %s, want debug", cfg.Server.LogLevel)
    }
    hooks := cfg.Hooks["PreToolUse"]
    if len(hooks) != 1 {
        t.Fatalf("PreToolUse hooks = %d, want 1", len(hooks))
    }
    if hooks[0].Name != "test-hook" {
        t.Errorf("name = %s, want test-hook", hooks[0].Name)
    }
}

func TestLoadMissingFileReturnsDefault(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "nonexistent.yaml")

    cfg, err := Load(path)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if cfg.Server.Port != 47821 {
        t.Errorf("default port = %d, want 47821", cfg.Server.Port)
    }
}

func TestLoadInvalidYAML(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "config.yaml")
    os.WriteFile(path, []byte(`{{{invalid`), 0644)

    _, err := Load(path)
    if err == nil {
        t.Fatal("expected error for invalid YAML")
    }
}

func TestHookEnabledDefault(t *testing.T) {
    h := HookDef{Name: "test"}
    if !h.IsEnabled() {
        t.Error("hook with nil Enabled should default to true")
    }

    f := false
    h2 := HookDef{Name: "test", Enabled: &f}
    if h2.IsEnabled() {
        t.Error("hook with Enabled=false should be disabled")
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd hook-manager
go test ./internal/config/ -v
```

Expected: FAIL — `Load` function not defined.

- [ ] **Step 4: Implement loader.go**

```go
package config

import (
    "fmt"
    "os"
    "path/filepath"
    "sync"

    "gopkg.in/yaml.v3"
)

// Load reads and parses a config file. If the file does not exist,
// returns DefaultConfig and creates the parent directory.
func Load(path string) (Config, error) {
    cfg := DefaultConfig()

    data, err := os.ReadFile(path)
    if err != nil {
        if os.IsNotExist(err) {
            // Ensure parent dir exists
            os.MkdirAll(filepath.Dir(path), 0755)
            return cfg, nil
        }
        return cfg, fmt.Errorf("reading config: %w", err)
    }

    if err := yaml.Unmarshal(data, &cfg); err != nil {
        return cfg, fmt.Errorf("parsing config: %w", err)
    }

    // Apply defaults for zero values
    if cfg.Server.Port == 0 {
        cfg.Server.Port = 47821
    }
    if cfg.Server.LogLevel == "" {
        cfg.Server.LogLevel = "info"
    }

    return cfg, nil
}

// Store holds the current config with safe concurrent access and hot reload.
type Store struct {
    mu   sync.RWMutex
    cfg  Config
    path string
}

// NewStore loads config from path and returns a Store.
func NewStore(path string) (*Store, error) {
    cfg, err := Load(path)
    if err != nil {
        return nil, err
    }
    return &Store{cfg: cfg, path: path}, nil
}

// Get returns the current config.
func (s *Store) Get() Config {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.cfg
}

// Reload re-reads the config file. On error, keeps the previous config.
func (s *Store) Reload() error {
    cfg, err := Load(s.path)
    if err != nil {
        return err
    }
    s.mu.Lock()
    s.cfg = cfg
    s.mu.Unlock()
    return nil
}

// Save writes the current config to disk.
func (s *Store) Save(cfg Config) error {
    data, err := yaml.Marshal(cfg)
    if err != nil {
        return fmt.Errorf("marshaling config: %w", err)
    }
    s.mu.Lock()
    s.cfg = cfg
    s.mu.Unlock()
    return os.WriteFile(s.path, data, 0644)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd hook-manager
go test ./internal/config/ -v
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add hook-manager/internal/config/
git commit -m "feat(hook-manager): config package with YAML loading, defaults, and Store"
```

---

### Task 3: Logger Package

**Files:**
- Create: `hook-manager/internal/logger/logger.go`
- Create: `hook-manager/internal/logger/logger_test.go`

NDJSON log writer with rotation at 5MB, keeping last 3 rotations.

- [ ] **Step 1: Write failing tests**

```go
package logger

import (
    "encoding/json"
    "os"
    "path/filepath"
    "strings"
    "testing"
)

func TestWriteEntry(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "hooks.log")

    l, err := New(path, 5*1024*1024, 3)
    if err != nil {
        t.Fatal(err)
    }
    defer l.Close()

    l.Log(Entry{
        Event:    "PreToolUse",
        Hook:     "test-hook",
        ExitCode: 0,
    })

    data, _ := os.ReadFile(path)
    lines := strings.TrimSpace(string(data))
    var entry Entry
    if err := json.Unmarshal([]byte(lines), &entry); err != nil {
        t.Fatalf("invalid NDJSON: %v", err)
    }
    if entry.Event != "PreToolUse" {
        t.Errorf("event = %s, want PreToolUse", entry.Event)
    }
    if entry.Timestamp.IsZero() {
        t.Error("timestamp should be set automatically")
    }
}

func TestRotation(t *testing.T) {
    dir := t.TempDir()
    path := filepath.Join(dir, "hooks.log")

    // Tiny max size to trigger rotation
    l, err := New(path, 100, 3)
    if err != nil {
        t.Fatal(err)
    }
    defer l.Close()

    // Write enough entries to exceed 100 bytes
    for i := 0; i < 10; i++ {
        l.Log(Entry{Event: "PreToolUse", Hook: "test"})
    }

    // Check that rotation file exists
    if _, err := os.Stat(path + ".1"); os.IsNotExist(err) {
        t.Error("expected hooks.log.1 to exist after rotation")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd hook-manager
go test ./internal/logger/ -v
```

- [ ] **Step 3: Implement logger.go**

The `Entry` struct, `Logger` with mutex-protected file handle, auto-timestamp on `Log()`, size-based rotation. Use `encoding/json` for NDJSON lines.

```go
package logger

import (
    "encoding/json"
    "fmt"
    "os"
    "sync"
    "time"
)

type Entry struct {
    Timestamp     time.Time `json:"timestamp"`
    Event         string    `json:"event"`
    Hook          string    `json:"hook"`
    Matcher       string    `json:"matcher,omitempty"`
    ExitCode      int       `json:"exit_code"`
    DurationMs    int64     `json:"duration_ms"`
    StdoutPreview string    `json:"stdout_preview,omitempty"`
    Stderr        string    `json:"stderr,omitempty"`
}

type Logger struct {
    mu          sync.Mutex
    file        *os.File
    path        string
    maxBytes    int64
    maxBackups  int
    currentSize int64
}

func New(path string, maxBytes int64, maxBackups int) (*Logger, error) {
    f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    if err != nil {
        return nil, err
    }
    info, _ := f.Stat()
    size := int64(0)
    if info != nil {
        size = info.Size()
    }
    return &Logger{
        file:        f,
        path:        path,
        maxBytes:    maxBytes,
        maxBackups:  maxBackups,
        currentSize: size,
    }, nil
}

func (l *Logger) Log(e Entry) {
    if e.Timestamp.IsZero() {
        e.Timestamp = time.Now().UTC()
    }
    data, err := json.Marshal(e)
    if err != nil {
        return
    }
    line := append(data, '\n')

    l.mu.Lock()
    defer l.mu.Unlock()

    if l.currentSize+int64(len(line)) > l.maxBytes {
        l.rotate()
    }
    n, _ := l.file.Write(line)
    l.currentSize += int64(n)
}

func (l *Logger) rotate() {
    l.file.Close()

    // Shift existing backups: .2 -> .3, .1 -> .2, current -> .1
    for i := l.maxBackups; i >= 1; i-- {
        src := l.path
        if i > 1 {
            src = fmt.Sprintf("%s.%d", l.path, i-1)
        }
        dst := fmt.Sprintf("%s.%d", l.path, i)
        os.Remove(dst)
        os.Rename(src, dst)
    }

    f, _ := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    l.file = f
    l.currentSize = 0
}

func (l *Logger) Close() error {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.file.Close()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd hook-manager
go test ./internal/logger/ -v
```

- [ ] **Step 5: Commit**

```bash
git add hook-manager/internal/logger/
git commit -m "feat(hook-manager): NDJSON logger with size-based rotation"
```

---

### Task 4: Executor Package

**Files:**
- Create: `hook-manager/internal/executor/executor.go`
- Create: `hook-manager/internal/executor/executor_test.go`

Runs user scripts (managed or command), captures stdout/stderr/exit code, enforces timeouts.

- [ ] **Step 1: Write failing tests**

Test cases:
- Execute a command that exits 0, capture stdout
- Execute a command that exits 2, capture stderr
- Execute a command that times out
- Execute a managed script (runtime + file)
- Pipe JSON to stdin, read it back from stdout

```go
package executor

import (
    "context"
    "os"
    "path/filepath"
    "testing"
    "time"
)

func TestCommandExitZero(t *testing.T) {
    r, err := Run(context.Background(), Params{
        Type:    "command",
        Command: "echo hello",
        Stdin:   []byte("{}"),
        Timeout: 5 * time.Second,
    })
    if err != nil {
        t.Fatal(err)
    }
    if r.ExitCode != 0 {
        t.Errorf("exit code = %d, want 0", r.ExitCode)
    }
    if string(r.Stdout) != "hello" {
        t.Errorf("stdout = %q, want %q", r.Stdout, "hello")
    }
}

func TestCommandExitTwo(t *testing.T) {
    r, err := Run(context.Background(), Params{
        Type:    "command",
        Command: "echo blocked >&2; exit 2",
        Stdin:   []byte("{}"),
        Timeout: 5 * time.Second,
    })
    if err != nil {
        t.Fatal(err)
    }
    if r.ExitCode != 2 {
        t.Errorf("exit code = %d, want 2", r.ExitCode)
    }
    if string(r.Stderr) != "blocked\n" {
        t.Errorf("stderr = %q, want %q", r.Stderr, "blocked\n")
    }
}

func TestCommandTimeout(t *testing.T) {
    r, err := Run(context.Background(), Params{
        Type:    "command",
        Command: "sleep 60",
        Stdin:   []byte("{}"),
        Timeout: 100 * time.Millisecond,
    })
    if err != nil {
        t.Fatal(err)
    }
    if !r.TimedOut {
        t.Error("expected timeout")
    }
}

func TestManagedScript(t *testing.T) {
    dir := t.TempDir()
    script := filepath.Join(dir, "test.sh")
    os.WriteFile(script, []byte("#!/bin/bash\ncat\n"), 0755)

    r, err := Run(context.Background(), Params{
        Type:       "managed",
        Runtime:    "bash",
        ScriptPath: script,
        Stdin:      []byte(`{"test":true}`),
        Timeout:    5 * time.Second,
    })
    if err != nil {
        t.Fatal(err)
    }
    if string(r.Stdout) != `{"test":true}` {
        t.Errorf("stdout = %q, want stdin passthrough", r.Stdout)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd hook-manager
go test ./internal/executor/ -v
```

- [ ] **Step 3: Implement executor.go**

```go
package executor

import (
    "bytes"
    "context"
    "fmt"
    "os/exec"
    "syscall"
    "time"
)

type Params struct {
    Type       string            // "command" or "managed"
    Command    string            // for type=command
    Runtime    string            // for type=managed
    ScriptPath string            // for type=managed
    Stdin      []byte
    Timeout    time.Duration
    Env        map[string]string // additional env vars
}

type Result struct {
    Stdout   []byte
    Stderr   []byte
    ExitCode int
    TimedOut bool
    Duration time.Duration
}

func Run(ctx context.Context, p Params) (Result, error) {
    var cmdStr string
    switch p.Type {
    case "command":
        cmdStr = p.Command
    case "managed":
        cmdStr = fmt.Sprintf("%s %s", p.Runtime, p.ScriptPath)
    default:
        return Result{}, fmt.Errorf("unknown hook type: %s", p.Type)
    }

    ctx, cancel := context.WithTimeout(ctx, p.Timeout)
    defer cancel()

    cmd := exec.CommandContext(ctx, "sh", "-c", cmdStr)
    cmd.Stdin = bytes.NewReader(p.Stdin)

    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr

    // Pass through environment plus any extras
    if len(p.Env) > 0 {
        cmd.Env = append(cmd.Environ(), mapToEnv(p.Env)...)
    }

    start := time.Now()
    err := cmd.Run()
    duration := time.Since(start)

    r := Result{
        Stdout:   bytes.TrimRight(stdout.Bytes(), "\n"),
        Stderr:   stderr.Bytes(),
        Duration: duration,
    }

    if ctx.Err() == context.DeadlineExceeded {
        r.TimedOut = true
        return r, nil
    }

    if err != nil {
        if exitErr, ok := err.(*exec.ExitError); ok {
            if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
                r.ExitCode = status.ExitStatus()
            }
        } else {
            return r, fmt.Errorf("running command: %w", err)
        }
    }

    return r, nil
}

func mapToEnv(m map[string]string) []string {
    env := make([]string, 0, len(m))
    for k, v := range m {
        env = append(env, k+"="+v)
    }
    return env
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd hook-manager
go test ./internal/executor/ -v
```

- [ ] **Step 5: Commit**

```bash
git add hook-manager/internal/executor/
git commit -m "feat(hook-manager): executor package for script execution with timeout"
```

---

### Task 5: Aggregator Package

**Files:**
- Create: `hook-manager/internal/aggregator/aggregator.go`
- Create: `hook-manager/internal/aggregator/aggregator_test.go`

Deep-merges JSON outputs, concatenates plain text, handles mixed JSON+text responses.

- [ ] **Step 1: Write failing tests**

Test cases:
- Merge two valid JSON objects
- Concatenate two plain text strings with separator
- Mixed JSON + text produces combined output
- Last-writer-wins for conflicting JSON keys
- systemMessage strings concatenated with `\n———\n`
- Empty inputs produce empty output

```go
package aggregator

import (
    "testing"
)

func TestMergeTwoJSON(t *testing.T) {
    results := []ScriptOutput{
        {Stdout: []byte(`{"a":1}`), IsJSON: true},
        {Stdout: []byte(`{"b":2}`), IsJSON: true},
    }
    out := Aggregate(results)
    // Should contain both keys
    if out.JSON == nil {
        t.Fatal("expected merged JSON")
    }
    if out.JSON["a"] != float64(1) || out.JSON["b"] != float64(2) {
        t.Errorf("merged = %v, want a=1 b=2", out.JSON)
    }
}

func TestConcatenatePlainText(t *testing.T) {
    results := []ScriptOutput{
        {Stdout: []byte("warning one"), IsJSON: false},
        {Stdout: []byte("warning two"), IsJSON: false},
    }
    out := Aggregate(results)
    expected := "warning one\n———\nwarning two"
    if out.Text != expected {
        t.Errorf("text = %q, want %q", out.Text, expected)
    }
}

func TestMixedJSONAndText(t *testing.T) {
    results := []ScriptOutput{
        {Stdout: []byte(`{"a":1}`), IsJSON: true},
        {Stdout: []byte("watch out"), IsJSON: false},
    }
    out := Aggregate(results)
    if out.JSON == nil {
        t.Fatal("expected JSON part")
    }
    if out.Text != "watch out" {
        t.Errorf("text = %q, want %q", out.Text, "watch out")
    }
}

func TestLastWriterWins(t *testing.T) {
    results := []ScriptOutput{
        {Stdout: []byte(`{"key":"first"}`), IsJSON: true},
        {Stdout: []byte(`{"key":"second"}`), IsJSON: true},
    }
    out := Aggregate(results)
    if out.JSON["key"] != "second" {
        t.Errorf("key = %v, want second", out.JSON["key"])
    }
}

func TestSystemMessageConcat(t *testing.T) {
    results := []ScriptOutput{
        {Stdout: []byte(`{"systemMessage":"msg1"}`), IsJSON: true},
        {Stdout: []byte(`{"systemMessage":"msg2"}`), IsJSON: true},
    }
    out := Aggregate(results)
    expected := "msg1\n———\nmsg2"
    sm, _ := out.JSON["systemMessage"].(string)
    if sm != expected {
        t.Errorf("systemMessage = %q, want %q", sm, expected)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd hook-manager
go test ./internal/aggregator/ -v
```

- [ ] **Step 3: Implement aggregator.go**

Types: `ScriptOutput` (stdout bytes, IsJSON flag), `AggregateResult` (merged JSON map, concatenated text). The `Aggregate` function iterates outputs, attempts JSON parse, deep-merges maps with special handling for `systemMessage` concatenation.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd hook-manager
go test ./internal/aggregator/ -v
```

- [ ] **Step 5: Commit**

```bash
git add hook-manager/internal/aggregator/
git commit -m "feat(hook-manager): aggregator for JSON merge + text concatenation"
```

---

### Task 6: Block Response Translation

**Files:**
- Create: `hook-manager/internal/hooks/blockers.go`
- Create: `hook-manager/internal/hooks/blockers_test.go`

Maps event names to the correct Claude Code JSON response for blocking.

- [ ] **Step 1: Write failing tests**

```go
package hooks

import (
    "encoding/json"
    "testing"
)

func TestBlockPreToolUse(t *testing.T) {
    resp := BlockResponse("PreToolUse", "dangerous command")
    data, _ := json.Marshal(resp)
    s := string(data)
    if !contains(s, `"permissionDecision":"deny"`) {
        t.Errorf("PreToolUse block missing permissionDecision:deny in %s", s)
    }
    if !contains(s, `"permissionDecisionReason":"dangerous command"`) {
        t.Errorf("PreToolUse block missing reason in %s", s)
    }
}

func TestBlockPermissionRequest(t *testing.T) {
    resp := BlockResponse("PermissionRequest", "not allowed")
    data, _ := json.Marshal(resp)
    s := string(data)
    // message must be inside decision object
    if !contains(s, `"decision":{"behavior":"deny","message":"not allowed"}`) {
        t.Errorf("PermissionRequest block has wrong structure: %s", s)
    }
}

func TestBlockStop(t *testing.T) {
    resp := BlockResponse("Stop", "keep going")
    data, _ := json.Marshal(resp)
    s := string(data)
    if !contains(s, `"decision":"block"`) {
        t.Errorf("Stop block missing decision:block in %s", s)
    }
}

func TestBlockNonBlockableEvent(t *testing.T) {
    resp := BlockResponse("PostToolUse", "whatever")
    if resp != nil {
        t.Errorf("non-blockable event should return nil, got %v", resp)
    }
}

func contains(s, sub string) bool {
    return strings.Contains(s, sub)
}
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement blockers.go**

Two functions:

`IsBlockable(event string) bool` — returns true for blockable events per spec table.

`BlockResponse(event, reason string) BlockResult` — returns a `BlockResult` struct:

```go
type BlockResult struct {
    // Body is the JSON response body. Nil for non-blockable events.
    Body map[string]any
    // UseHTTPError means return a non-2xx status with no body (WorktreeCreate).
    UseHTTPError bool
}
```

Switch on event name to build the correct JSON per the spec's Block Response Translation table (spec lines 263-274). For `WorktreeCreate`, return `BlockResult{UseHTTPError: true}`. For non-blockable events, return `BlockResult{}` (empty body, no HTTP error).

The handler in Task 7 checks `UseHTTPError` to write a 400 status, otherwise writes the `Body` as JSON with 200 status.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add hook-manager/internal/hooks/
git commit -m "feat(hook-manager): block response translation per Claude Code event contract"
```

---

### Task 7: Hook API Handler

**Files:**
- Create: `hook-manager/internal/hooks/handler.go`
- Create: `hook-manager/internal/hooks/handler_test.go`
- Create: `hook-manager/internal/hooks/matcher.go`
- Create: `hook-manager/internal/hooks/enricher.go`

The core handler: receives `POST /hook/{event}`, enriches the payload, matches user hooks, executes, aggregates, returns response.

Also includes `internal/hooks/enricher.go` — extracts `cwd` from the JSON body, walks up the directory tree to find `CLAUDE.md` and `AGENTS.md` files, and injects their paths plus any env vars from HTTP headers (`X-Claude-*`) into the payload before dispatching to user scripts.

- [ ] **Step 1: Write failing tests**

Test the handler as an `http.Handler` using `httptest`:
- POST to `/hook/PreToolUse` with no hooks configured → empty 200 response
- POST to `/hook/PreToolUse` with a matching hook → executes and returns output
- POST to `/hook/PreToolUse` with non-matching matcher → hook skipped
- Hook that exits 2 → block response returned
- Multiple hooks → outputs aggregated

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement matcher.go**

```go
package hooks

import "regexp"

// MatcherField returns the field name from the JSON input that the matcher
// should be compared against for a given event.
func MatcherField(event string) string {
    switch event {
    case "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest":
        return "tool_name"
    case "SessionStart":
        return "source"
    case "SessionEnd":
        return "reason"
    case "StopFailure":
        return "error"
    case "SubagentStart", "SubagentStop":
        return "agent_type"
    case "Notification":
        return "notification_type"
    case "InstructionsLoaded":
        return "load_reason"
    case "ConfigChange":
        return "source"
    case "FileChanged":
        return "file_path" // basename extracted
    case "Elicitation", "ElicitationResult":
        return "mcp_server"
    default:
        return "" // no matcher support
    }
}

// Matches returns true if the hook's matcher regex matches the input value.
// Empty matcher matches everything.
func Matches(pattern, value string) bool {
    if pattern == "" {
        return true
    }
    matched, err := regexp.MatchString(pattern, value)
    if err != nil {
        return false
    }
    return matched
}
```

- [ ] **Step 4: Implement handler.go**

The `Handler` struct holds references to `config.Store`, `executor`, `aggregator`, `logger`, and a `shutdownCh chan struct{}`. The `ServeHTTP` method:
1. Extracts event name from URL path
2. Reads JSON body
3. Enriches the payload (see enricher step below)
4. Extracts the matcher field value from JSON input
5. Filters hooks from config by event + matcher
6. Executes matching hooks concurrently via executor
7. Classifies outputs (JSON vs text, exit codes)
8. If any exit 2: builds block response via `BlockResponse()`
9. Otherwise: aggregates all outputs
10. Writes response
11. **If event is `SessionEnd`:** after writing response, signal shutdown via `close(shutdownCh)`

The `shutdownCh` is created by the caller (main.go) and passed into `NewHandler()`. Main.go listens on this channel alongside SIGTERM/SIGINT to trigger `server.Shutdown()`.

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add hook-manager/internal/hooks/
git commit -m "feat(hook-manager): hook API handler with matcher filtering and aggregation"
```

---

### Task 8: Server Main

**Files:**
- Modify: `hook-manager/cmd/server/main.go`

Wire everything together: config store, logger, hook handler, HTTP server, graceful shutdown.

- [ ] **Step 1: Implement server main**

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os"
    "os/signal"
    "path/filepath"
    "syscall"
    "time"

    "github.com/damusix/hook-manager/internal/config"
    "github.com/damusix/hook-manager/internal/hooks"
    "github.com/damusix/hook-manager/internal/logger"
)

var (
    version   = "dev"
    commit    = "unknown"
    buildDate = "unknown"
)

func main() {
    if len(os.Args) > 1 && os.Args[1] == "version" {
        fmt.Printf("hook-manager %s (%s) built %s\n", version, commit, buildDate)
        os.Exit(0)
    }
    os.Exit(run())
}

func run() int {
    homeDir, _ := os.UserHomeDir()
    stateDir := filepath.Join(homeDir, ".ai-hooks")
    configPath := filepath.Join(stateDir, "config.yaml")
    logPath := filepath.Join(stateDir, "hooks.log")
    portPath := filepath.Join(stateDir, ".port")
    scriptsDir := filepath.Join(stateDir, "scripts")

    // Ensure state directories exist
    os.MkdirAll(stateDir, 0755)
    os.MkdirAll(scriptsDir, 0755)

    // Load config
    store, err := config.NewStore(configPath)
    if err != nil {
        fmt.Fprintf(os.Stderr, "hook-manager: config error: %v\n", err)
        return 1
    }

    // Init logger
    hookLogger, err := logger.New(logPath, 5*1024*1024, 3)
    if err != nil {
        fmt.Fprintf(os.Stderr, "hook-manager: logger error: %v\n", err)
        return 1
    }
    defer hookLogger.Close()

    // Build handler with shutdown channel
    shutdownCh := make(chan struct{})
    hookHandler := hooks.NewHandler(store, hookLogger, scriptsDir, shutdownCh)

    // Routes
    mux := http.NewServeMux()
    mux.Handle("/hook/", hookHandler)
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
        w.Write([]byte(`{"status":"ok"}`))
    })

    // Start server
    cfg := store.Get()
    addr := fmt.Sprintf(":%d", cfg.Server.Port)
    server := &http.Server{Addr: addr, Handler: mux}

    // Write port file
    os.WriteFile(portPath, []byte(fmt.Sprintf("%d", cfg.Server.Port)), 0644)

    // Graceful shutdown on SIGTERM/SIGINT or SessionEnd
    sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    go func() {
        select {
        case <-sigCtx.Done():
        case <-shutdownCh: // SessionEnd event received
        }
        shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        server.Shutdown(shutdownCtx)
        os.Remove(portPath)
    }()

    log.Printf("hook-manager listening on %s\n", addr)
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        fmt.Fprintf(os.Stderr, "hook-manager: server error: %v\n", err)
        return 1
    }
    return 0
}
```

- [ ] **Step 2: Verify build**

```bash
cd hook-manager
go build -o tmp/hook-manager ./cmd/server
```

- [ ] **Step 3: Smoke test — start server, hit health, stop**

```bash
cd hook-manager
tmp/hook-manager &
SERVER_PID=$!
sleep 1
curl -s http://localhost:47821/health
kill $SERVER_PID
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add hook-manager/cmd/server/main.go
git commit -m "feat(hook-manager): HTTP server with config, logger, and hook handler wired up"
```

---

### Task 9: Start Script + Platform Wrapper

**Files:**
- Modify: `hook-manager/hooks/scripts/start.sh`
- Create: `hook-manager/hook-manager.sh` (platform wrapper)
- Create: `hook-manager/scripts/build.sh`

- [ ] **Step 1: Implement start.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$HOME/.ai-hooks"
PORT_FILE="$STATE_DIR/.port"
STDIN_DATA=$(cat)

# Start server if not already running
if ! curl -sf "http://localhost:$(cat "$PORT_FILE" 2>/dev/null || echo 47821)/health" >/dev/null 2>&1; then
    bash "$SCRIPT_DIR/hook-manager.sh" &
    disown

    # Wait for health (up to 5 seconds)
    for i in $(seq 1 50); do
        PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)
        if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
            break
        fi
        sleep 0.1
    done
fi

PORT=$(cat "$PORT_FILE" 2>/dev/null || echo 47821)

# Forward SessionStart event to server
curl -sf -X POST "http://localhost:$PORT/hook/SessionStart" \
    -H "Content-Type: application/json" \
    -d "$STDIN_DATA" 2>/dev/null || true
```

Make executable: `chmod +x hook-manager/hooks/scripts/start.sh`

- [ ] **Step 2: Implement platform wrapper (hook-manager.sh)**

Same pattern as `cc-auto-approve-fix/approve-compound-bash.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK_PATH="$SCRIPT_DIR/.hook-manager-current"

[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
Darwin) os="darwin" ;;
Linux) os="linux" ;;
*) exit 0 ;;
esac

case "$arch" in
arm64 | aarch64) arch="arm64" ;;
x86_64 | amd64) arch="amd64" ;;
*) exit 0 ;;
esac

BIN_PATH="$SCRIPT_DIR/bin/hook-manager-${os}-${arch}"
[[ -x "$BIN_PATH" ]] || exit 0

ln -sfn "$BIN_PATH" "$LINK_PATH" 2>/dev/null || true
[[ -x "$LINK_PATH" ]] && exec "$LINK_PATH" "$@"
exec "$BIN_PATH" "$@"
```

Make executable: `chmod +x hook-manager/hook-manager.sh`

- [ ] **Step 3: Implement build script**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"

VERSION="${VERSION:-dev}"
COMMIT="${COMMIT:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || printf unknown)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

mkdir -p "$BIN_DIR"

build_target() {
    local goos="$1"
    local goarch="$2"
    local output="$BIN_DIR/hook-manager-${goos}-${goarch}"

    echo "Building ${goos}/${goarch}..."
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
        -trimpath \
        -ldflags "-s -w \
            -X main.version=$VERSION \
            -X main.commit=$COMMIT \
            -X main.buildDate=$BUILD_DATE" \
        -o "$output" \
        ./cmd/server

    chmod +x "$output"
}

cd "$ROOT_DIR"
build_target darwin amd64
build_target darwin arm64
build_target linux amd64
build_target linux arm64

echo "Built binaries in $BIN_DIR"
```

Make executable: `chmod +x hook-manager/scripts/build.sh`

- [ ] **Step 4: Build binaries for local platform**

```bash
cd hook-manager
bash scripts/build.sh
```

Expected: 4 binaries in `bin/`.

- [ ] **Step 5: End-to-end test — start.sh boots server, forwards event**

```bash
echo '{"hook_event_name":"SessionStart","source":"startup"}' | bash hook-manager/hooks/scripts/start.sh
curl -s http://localhost:47821/health
# Clean up
kill $(lsof -ti :47821) 2>/dev/null || true
```

- [ ] **Step 6: Commit**

```bash
git add hook-manager/hooks/scripts/start.sh hook-manager/hook-manager.sh hook-manager/scripts/build.sh
git commit -m "feat(hook-manager): start script, platform wrapper, and cross-compilation build"
```

---

### Task 10: Config & Script REST API

**Files:**
- Create: `hook-manager/internal/api/config.go`
- Create: `hook-manager/internal/api/scripts.go`
- Create: `hook-manager/internal/api/logs.go`
- Modify: `hook-manager/cmd/server/main.go` (register routes)

These handlers power the management API (and later the UI).

- [ ] **Step 1: Implement config API handlers**

`GET /api/config` — returns config as JSON.
`PUT /api/config` — accepts raw YAML body, validates, saves, reloads store.

- [ ] **Step 2: Implement hooks CRUD handlers**

`GET /api/hooks` — returns all hooks grouped by event.
`POST /api/hooks` — creates a hook (event + hook def in JSON body).
`PUT /api/hooks/{event}/{name}` — updates a hook.
`DELETE /api/hooks/{event}/{name}` — deletes a hook.
`POST /api/hooks/{event}/{name}/test` — test-runs a hook with provided payload.

- [ ] **Step 3: Implement scripts API handlers**

`GET /api/scripts` — lists files in `~/.ai-hooks/scripts/`.
`POST /api/scripts` — creates a new file.
`GET /api/scripts/{file}` — reads file content.
`PUT /api/scripts/{file}` — writes file content.
`DELETE /api/scripts/{file}` — deletes file.

- [ ] **Step 4: Implement logs API handlers**

`GET /api/logs` — reads and filters NDJSON log file. Query params: `event`, `hook`, `limit`, `offset`.
`GET /api/logs/stream` — SSE endpoint. Tails the log file and pushes new entries as `data:` events.

- [ ] **Step 5: Register all routes in main.go**

Add all `/api/*` routes to the mux in `cmd/server/main.go`.

- [ ] **Step 6: Test API with curl**

```bash
# Start server
cd hook-manager
tmp/hook-manager &
sleep 1

# Config
curl -s http://localhost:47821/api/config | jq .

# Create a hook
curl -s -X POST http://localhost:47821/api/hooks \
    -H "Content-Type: application/json" \
    -d '{"event":"PreToolUse","hook":{"name":"test","type":"command","command":"echo hi","timeout":5}}'

# List hooks
curl -s http://localhost:47821/api/hooks | jq .

# Clean up
kill $(lsof -ti :47821) 2>/dev/null || true
```

- [ ] **Step 7: Commit**

```bash
git add hook-manager/internal/api/ hook-manager/cmd/server/main.go
git commit -m "feat(hook-manager): REST API for config, hooks, scripts, and logs"
```

---

### Task 11: Integration Tests

**Files:**
- Create: `hook-manager/internal/hooks/integration_test.go`

End-to-end tests that start the server, send hook payloads, and verify responses.

- [ ] **Step 1: Write integration tests**

Test cases:
- Start server with a config that has a command hook on PreToolUse → send PreToolUse payload → verify hook ran and output is in response
- Hook with exit 2 → verify block response matches PreToolUse format
- Multiple hooks on same event → outputs aggregated
- Hook with non-matching matcher → skipped
- Managed script execution → runtime + file path constructed correctly
- Hook timeout → non-blocking error, response still returns
- SessionEnd → server shuts down gracefully

Use `httptest.NewServer` wrapping the handler for isolated testing (no port conflicts).

- [ ] **Step 2: Run integration tests**

```bash
cd hook-manager
go test ./internal/hooks/ -v -run Integration -timeout 30s
```

- [ ] **Step 3: Commit**

```bash
git add hook-manager/internal/hooks/integration_test.go
git commit -m "test(hook-manager): integration tests for hook execution pipeline"
```

---

## Phase 2: Web UI (HTMX + Go Templates)

The UI renders server-side via Go templates with HTMX for interactivity. All JS libraries loaded from CDN except HTMX which is embedded.

---

### Task 12: Base Layout + Static Assets

**Files:**
- Create: `hook-manager/web/templates/layout.html`
- Create: `hook-manager/web/templates/nav.html`
- Create: `hook-manager/web/static/htmx.min.js` (download and embed)
- Create: `hook-manager/internal/ui/ui.go`
- Modify: `hook-manager/cmd/server/main.go` (register UI routes, embed static)

- [ ] **Step 1: Download HTMX and place in static dir**

```bash
mkdir -p hook-manager/web/static
curl -sL https://unpkg.com/htmx.org@2/dist/htmx.min.js -o hook-manager/web/static/htmx.min.js
```

- [ ] **Step 2: Create layout.html**

Base HTML template with Tailwind (CDN), HTMX (embedded), Monaco + PrismJS (CDN). Navigation bar with links to all pages. Content block for page-specific content.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Hook Manager{{block "title" .}} — Dashboard{{end}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/static/htmx.min.js"></script>
    <script src="https://unpkg.com/htmx-ext-sse@2/sse.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen">
    {{template "nav" .}}
    <main class="max-w-7xl mx-auto px-4 py-8">
        {{block "content" .}}{{end}}
    </main>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create nav.html**

```html
{{define "nav"}}
<nav class="bg-gray-800 border-b border-gray-700 px-4 py-3">
    <div class="max-w-7xl mx-auto flex items-center gap-6">
        <a href="/" class="text-lg font-bold text-white">Hook Manager</a>
        <a href="/hooks" class="text-gray-300 hover:text-white" hx-get="/hooks" hx-target="main" hx-push-url="true">Hooks</a>
        <a href="/scripts" class="text-gray-300 hover:text-white" hx-get="/scripts" hx-target="main" hx-push-url="true">Scripts</a>
        <a href="/config" class="text-gray-300 hover:text-white" hx-get="/config" hx-target="main" hx-push-url="true">Config</a>
        <a href="/logs" class="text-gray-300 hover:text-white" hx-get="/logs" hx-target="main" hx-push-url="true">Logs</a>
        <a href="/test" class="text-gray-300 hover:text-white" hx-get="/test" hx-target="main" hx-push-url="true">Test Bench</a>
    </div>
</nav>
{{end}}
```

- [ ] **Step 4: Create embed.go in cmd/server and ui.go accepting FS**

Go's `//go:embed` can only reference paths within or below the package directory. Since `web/` lives at the plugin root, the embed must live in `cmd/server/` (which can reference `../../web/`). The embedded FS is passed into the UI package as constructor args.

Create `hook-manager/cmd/server/embed.go`:

```go
package main

import "embed"

//go:embed all:../../web/templates
var templateFS embed.FS

//go:embed all:../../web/static
var staticFS embed.FS
```

Create `hook-manager/internal/ui/ui.go`:

```go
package ui

import (
    "embed"
    "html/template"
    "io/fs"
    "net/http"
)

type UI struct {
    templates *template.Template
    staticFS  embed.FS
}

func New(templateFS, staticFS embed.FS) (*UI, error) {
    tmpl, err := template.ParseFS(templateFS, "web/templates/*.html")
    if err != nil {
        return nil, err
    }
    return &UI{templates: tmpl, staticFS: staticFS}, nil
}

func (u *UI) StaticHandler() http.Handler {
    sub, _ := fs.Sub(u.staticFS, "web/static")
    return http.StripPrefix("/static/", http.FileServer(http.FS(sub)))
}
```

- [ ] **Step 5: Register UI routes and static handler in main.go**

```go
mux.Handle("/static/", ui.StaticHandler())
mux.HandleFunc("/", uiHandler.Dashboard)
mux.HandleFunc("/hooks", uiHandler.HookList)
// ... etc
```

- [ ] **Step 6: Verify layout renders**

Start server, open `http://localhost:47821/` in browser. Should see nav bar with all links.

- [ ] **Step 7: Commit**

```bash
git add hook-manager/web/ hook-manager/internal/ui/
git commit -m "feat(hook-manager): base layout with HTMX, Tailwind, nav, and embedded static assets"
```

---

### Task 13: Dashboard Page

**Files:**
- Create: `hook-manager/web/templates/dashboard.html`
- Modify: `hook-manager/internal/ui/ui.go` (add Dashboard handler)

- [ ] **Step 1: Create dashboard template**

Shows: hook count per event, recent log entries (last 20), server uptime. Uses `hx-get="/api/logs?limit=20"` for recent logs partial.

- [ ] **Step 2: Implement Dashboard handler**

Reads config for hook counts, reads last 20 log entries, renders template.

- [ ] **Step 3: Verify in browser**

- [ ] **Step 4: Commit**

```bash
git add hook-manager/web/templates/dashboard.html hook-manager/internal/ui/
git commit -m "feat(hook-manager): dashboard page with hook counts and recent logs"
```

---

### Task 14: Hook Manager + Detail Pages

**Files:**
- Create: `hook-manager/web/templates/hooks.html`
- Create: `hook-manager/web/templates/hook_detail.html`
- Create: `hook-manager/web/templates/partials/hook_row.html`
- Modify: `hook-manager/internal/ui/ui.go`

- [ ] **Step 1: Create hooks list template**

Groups hooks by event. Each hook row shows name, type, matcher, enabled toggle, delete button. "New Hook" button opens a form. Uses HTMX for enable/disable toggle (`hx-put`), delete (`hx-delete` with `hx-confirm`).

- [ ] **Step 2: Create hook detail template**

Form to edit hook fields (name, type, command/file+runtime, matcher, timeout). "Test" button fires `POST /api/hooks/{event}/{name}/test` with a sample payload textarea. Results shown inline.

- [ ] **Step 3: Implement UI handlers**

- [ ] **Step 4: Verify in browser**

- [ ] **Step 5: Commit**

```bash
git add hook-manager/web/templates/ hook-manager/internal/ui/
git commit -m "feat(hook-manager): hook manager and detail pages with CRUD"
```

---

### Task 15: Script Browser + Editor Pages

**Files:**
- Create: `hook-manager/web/templates/scripts.html`
- Create: `hook-manager/web/templates/script_editor.html`
- Modify: `hook-manager/internal/ui/ui.go`

- [ ] **Step 1: Create script browser template**

Lists files in `~/.ai-hooks/scripts/`. "New Script" button creates a new file (prompts for filename + runtime). Each row links to editor.

- [ ] **Step 2: Create script editor template**

Monaco Editor loaded from CDN. Language detection from file extension. Save button (`hx-put`), run test button. Uses:

```html
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>
<script>
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
    require(['vs/editor/editor.main'], function(monaco) {
        const editor = monaco.editor.create(document.getElementById('editor'), {
            value: {{.Content}},
            language: {{.Language}},
            theme: 'vs-dark',
            minimap: { enabled: false },
            automaticLayout: true
        });
    });
</script>
```

- [ ] **Step 3: Implement UI handlers**

- [ ] **Step 4: Verify in browser**

- [ ] **Step 5: Commit**

```bash
git add hook-manager/web/templates/ hook-manager/internal/ui/
git commit -m "feat(hook-manager): script browser and Monaco editor pages"
```

---

### Task 16: Config Editor Page

**Files:**
- Create: `hook-manager/web/templates/config_editor.html`
- Modify: `hook-manager/internal/ui/ui.go`

- [ ] **Step 1: Create config editor template**

Monaco Editor with YAML language mode. Loads current config via `GET /api/config`. Save button sends raw YAML via `PUT /api/config`. Validation errors shown inline.

- [ ] **Step 2: Implement UI handler**

- [ ] **Step 3: Verify in browser**

- [ ] **Step 4: Commit**

```bash
git add hook-manager/web/templates/config_editor.html hook-manager/internal/ui/
git commit -m "feat(hook-manager): config editor page with Monaco YAML mode"
```

---

### Task 17: Log Viewer Page

**Files:**
- Create: `hook-manager/web/templates/logs.html`
- Create: `hook-manager/web/templates/partials/log_entry.html`
- Modify: `hook-manager/internal/ui/ui.go`

- [ ] **Step 1: Create log viewer template**

Filter bar: event dropdown, hook name input, time range, exit code filter. Results table rendered via HTMX partial. Live tail toggle uses SSE:

```html
<div hx-ext="sse" sse-connect="/api/logs/stream" sse-swap="message">
    <!-- new log entries appended here -->
</div>
```

PrismJS highlights JSON payloads in the stdout/stderr columns.

- [ ] **Step 2: Implement UI handler**

- [ ] **Step 3: Verify in browser — create a test hook, fire it, see logs appear**

- [ ] **Step 4: Commit**

```bash
git add hook-manager/web/templates/ hook-manager/internal/ui/
git commit -m "feat(hook-manager): log viewer with filters and SSE live tail"
```

---

### Task 18: Test Bench Page

**Files:**
- Create: `hook-manager/web/templates/test_bench.html`
- Modify: `hook-manager/internal/ui/ui.go`

- [ ] **Step 1: Create test bench template**

Event type dropdown (all 24 events). JSON payload textarea (pre-populated with sample payload per event type — reference spec lines 175-204 for fields). "Fire" button sends `POST /hook/{event}` with the payload. Response shown in a PrismJS-highlighted JSON block below.

Sample payloads per event should be a JS object in a `<script>` tag that updates the textarea when the event dropdown changes.

- [ ] **Step 2: Implement UI handler**

- [ ] **Step 3: Verify in browser — fire a test event, see response**

- [ ] **Step 4: Commit**

```bash
git add hook-manager/web/templates/test_bench.html hook-manager/internal/ui/
git commit -m "feat(hook-manager): test bench page with sample payloads per event"
```

---

### Task 19: Final Build + Smoke Test

**Files:**
- Modify: `hook-manager/scripts/build.sh` (if needed)

- [ ] **Step 1: Build release binaries**

```bash
cd hook-manager
VERSION=0.1.0 bash scripts/build.sh
```

- [ ] **Step 2: Full smoke test**

Create a test config at `~/.ai-hooks/config.yaml`:

```yaml
server:
  port: 47821
  log_level: debug
hooks:
  PreToolUse:
    - name: echo-test
      type: command
      command: "echo '{\"systemMessage\":\"hook-manager is working\"}'"
      matcher: ".*"
      timeout: 5
```

Start the server, verify:
1. `curl localhost:47821/health` → OK
2. `curl -X POST localhost:47821/hook/PreToolUse -d '{"tool_name":"Bash"}'` → returns systemMessage
3. Open `localhost:47821` in browser → dashboard loads
4. Navigate to hooks page → echo-test visible
5. Navigate to test bench → fire PreToolUse → see response
6. Navigate to logs → see the test execution

- [ ] **Step 3: Run all tests**

```bash
cd hook-manager
go test ./... -v
```

- [ ] **Step 4: Commit**

```bash
git add hook-manager/
git commit -m "feat(hook-manager): v0.1.0 complete — core server + web UI"
```
