# Runtime Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure which installed programs execute their hook scripts, per file extension, with auto-detection of installed runtimes.

**Architecture:** New `internal/runtime/` package handles detection. Config types extended with `RuntimesConfig`. Executor's `DefaultRuntime()` replaced with config-based lookup. Settings page gets a new Runtimes card with JS-driven interactions. Background goroutine refreshes detection hourly.

**Tech Stack:** Go stdlib, `gopkg.in/yaml.v3`, vanilla JS, HTMX (existing), Go `html/template`

**Spec:** `docs/superpowers/specs/2026-03-28-runtime-configuration-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `internal/runtime/detect.go` | Runtime detection: probe binaries, parse versions, build `[]RuntimeInfo` |
| `internal/runtime/detect_test.go` | Tests for detection logic (version parsing, node v22 gate) |
| `internal/api/runtimes.go` | HTTP handlers: GET/POST/PUT/DELETE for runtimes and mappings |

### Modified files

| File | Changes |
|------|---------|
| `internal/config/types.go` | Add `RuntimeInfo`, `ExtMapping`, `RuntimesConfig`; add `Runtimes` field to `Config` |
| `internal/executor/executor.go` | Replace hardcoded `DefaultRuntime()` with config-based `RuntimeFor()` method |
| `internal/executor/executor_test.go` | Update tests for new `RuntimeFor()` signature |
| `internal/api/api.go` | No changes needed — handlers already have `store` access |
| `internal/api/scripts.go` | Replace `executor.DefaultRuntime()` call with config-based lookup |
| `internal/api/config.go` | Replace `executor.DefaultRuntime()` call in `TestHook` with config-based lookup |
| `internal/hooks/handler.go` | Replace `executor.DefaultRuntime()` (called implicitly via `executor.Run`) — no changes needed since executor handles it |
| `cmd/server/main.go` | Register runtime routes, initial detection on startup, hourly refresh ticker |
| `internal/ui/ui.go` | Pass runtime data to `ConfigEditor` template |
| `web/templates/config_editor.html` | Add Runtimes card with JS interactions |

---

### Task 1: Config Types

**Files:**
- Modify: `internal/config/types.go`

- [ ] **Step 1: Add runtime types to config**

Add these types and update the `Config` struct in `internal/config/types.go`:

```go
package config

import "time"

// RuntimeInfo describes a detected runtime binary on the user's machine.
type RuntimeInfo struct {
	Name      string    `yaml:"name"       json:"name"`
	Version   string    `yaml:"version"    json:"version"`
	Path      string    `yaml:"path"       json:"path"`
	CheckedAt time.Time `yaml:"checked_at" json:"checked_at"`
}

// ExtMapping maps a file extension to a runtime binary.
type ExtMapping struct {
	Ext     string `yaml:"ext"              json:"ext"`
	Runtime string `yaml:"runtime"          json:"runtime"`
	Custom  bool   `yaml:"custom,omitempty" json:"custom"`
}

// RuntimesConfig holds detected runtimes and extension-to-runtime mappings.
type RuntimesConfig struct {
	Detected    []RuntimeInfo `yaml:"detected"     json:"detected"`
	ExtMappings []ExtMapping  `yaml:"ext_mappings" json:"ext_mappings"`
}
```

Update the existing `Config` struct to include the `Runtimes` field:

```go
type Config struct {
	Server   ServerConfig         `yaml:"server"`
	Runtimes RuntimesConfig       `yaml:"runtimes"`
	Hooks    map[string][]HookDef `yaml:"hooks"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd hook-manager && go build ./...`
Expected: Clean compile (no errors)

- [ ] **Step 3: Commit**

```bash
git add internal/config/types.go
git commit -m "feat(runtime): add RuntimeInfo, ExtMapping, RuntimesConfig types to config"
```

---

### Task 2: Runtime Detection Package

**Files:**
- Create: `internal/runtime/detect.go`
- Create: `internal/runtime/detect_test.go`

- [ ] **Step 1: Write the test for version parsing**

Create `internal/runtime/detect_test.go`:

```go
package runtime

import "testing"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		name    string
		binary  string
		output  string
		want    string
	}{
		{"bun plain", "bun", "1.2.5\n", "1.2.5"},
		{"node prefixed", "node", "v22.14.0\n", "22.14.0"},
		{"python3 labeled", "python3", "Python 3.12.1\n", "3.12.1"},
		{"bash verbose", "bash", "GNU bash, version 5.2.37(1)-release (aarch64-apple-darwin24.0.0)\n", "5.2.37"},
		{"ruby labeled", "ruby", "ruby 3.3.0 (2024-12-25 revision 5765383050) [arm64-darwin24]\n", "3.3.0"},
		{"go prefixed", "go", "go version go1.23.0 darwin/arm64\n", "1.23.0"},
		{"perl v-prefix", "perl", "This is perl 5, version 40, subversion 0 (v5.40.0) built for darwin-2level\n", "5.40.0"},
		{"deno labeled", "deno", "deno 2.1.4 (stable, release, aarch64-apple-darwin)\n", "2.1.4"},
		{"no match", "unknown", "something weird", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseVersion(tt.binary, tt.output)
			if got != tt.want {
				t.Errorf("parseVersion(%q, %q) = %q, want %q", tt.binary, tt.output, got, tt.want)
			}
		})
	}
}

func TestNodeVersionGate(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{"22.14.0", true},
		{"22.0.0", true},
		{"23.1.0", true},
		{"21.9.0", false},
		{"20.0.0", false},
		{"18.17.1", false},
	}

	for _, tt := range tests {
		t.Run(tt.version, func(t *testing.T) {
			got := nodeVersionOK(tt.version)
			if got != tt.want {
				t.Errorf("nodeVersionOK(%q) = %v, want %v", tt.version, got, tt.want)
			}
		})
	}
}

func TestDefaultExtMappings(t *testing.T) {
	// Simulate: bun and node both available
	detected := []string{"bun", "node", "python3", "bash", "ruby"}
	mappings := DefaultExtMappings(detected)

	// Build lookup
	byExt := map[string]string{}
	for _, m := range mappings {
		byExt[m.Ext] = m.Runtime
	}

	// .ts and .js should prefer bun
	if byExt[".ts"] != "bun" {
		t.Errorf(".ts runtime = %q, want bun", byExt[".ts"])
	}
	if byExt[".js"] != "bun" {
		t.Errorf(".js runtime = %q, want bun", byExt[".js"])
	}
	if byExt[".py"] != "python3" {
		t.Errorf(".py runtime = %q, want python3", byExt[".py"])
	}
	if byExt[".sh"] != "bash" {
		t.Errorf(".sh runtime = %q, want bash", byExt[".sh"])
	}

	// Simulate: only node available (no bun)
	detected2 := []string{"node", "python3"}
	mappings2 := DefaultExtMappings(detected2)
	byExt2 := map[string]string{}
	for _, m := range mappings2 {
		byExt2[m.Ext] = m.Runtime
	}
	if byExt2[".ts"] != "node" {
		t.Errorf(".ts runtime = %q, want node (fallback)", byExt2[".ts"])
	}
	if byExt2[".js"] != "node" {
		t.Errorf(".js runtime = %q, want node (fallback)", byExt2[".js"])
	}

	// Simulate: neither bun nor node
	detected3 := []string{"python3"}
	mappings3 := DefaultExtMappings(detected3)
	byExt3 := map[string]string{}
	for _, m := range mappings3 {
		byExt3[m.Ext] = m.Runtime
	}
	if _, ok := byExt3[".ts"]; ok {
		t.Error(".ts should not be mapped when no JS runtime available")
	}
	if _, ok := byExt3[".js"]; ok {
		t.Error(".js should not be mapped when no JS runtime available")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd hook-manager && go test ./internal/runtime/ -v`
Expected: Compilation error — package doesn't exist yet

- [ ] **Step 3: Write the detection implementation**

Create `internal/runtime/detect.go`:

```go
package runtime

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/damusix/hook-manager/internal/config"
)

// knownBinary describes how to detect a specific runtime.
type knownBinary struct {
	Name       string
	VersionCmd []string // e.g. ["--version"]
	Pattern    *regexp.Regexp
}

var knownBinaries = []knownBinary{
	{"bun", []string{"--version"}, regexp.MustCompile(`(\d+\.\d+\.\d+)`)},
	{"node", []string{"--version"}, regexp.MustCompile(`v(\d+\.\d+\.\d+)`)},
	{"python3", []string{"--version"}, regexp.MustCompile(`Python (\d+\.\d+\.\d+)`)},
	{"bash", []string{"--version"}, regexp.MustCompile(`version (\d+\.\d+\.\d+)`)},
	{"ruby", []string{"--version"}, regexp.MustCompile(`ruby (\d+\.\d+\.\d+)`)},
	{"go", []string{"version"}, regexp.MustCompile(`go(\d+\.\d+\.\d+)`)},
	{"perl", []string{"-e", "print $^V"}, regexp.MustCompile(`v(\d+\.\d+\.\d+)`)},
	{"deno", []string{"--version"}, regexp.MustCompile(`deno (\d+\.\d+\.\d+)`)},
}

// Detect probes the system for known runtime binaries and returns info for each found.
func Detect() []config.RuntimeInfo {
	var results []config.RuntimeInfo
	now := time.Now()

	for _, kb := range knownBinaries {
		path, err := exec.LookPath(kb.Name)
		if err != nil {
			continue
		}

		out, err := exec.Command(kb.Name, kb.VersionCmd...).CombinedOutput()
		if err != nil {
			continue
		}

		version := parseVersion(kb.Name, string(out))
		if version == "" {
			continue
		}

		// Node must be v22+
		if kb.Name == "node" && !nodeVersionOK(version) {
			continue
		}

		results = append(results, config.RuntimeInfo{
			Name:      kb.Name,
			Version:   version,
			Path:      path,
			CheckedAt: now,
		})
	}

	return results
}

// ProbeCustom checks if a single binary exists and returns its path, or an error.
func ProbeCustom(binary string) (string, error) {
	// Handle multi-word runtimes like "go run"
	name := strings.Fields(binary)[0]
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("binary %q not found in PATH", name)
	}
	return path, nil
}

// parseVersion extracts a semver string from command output for a given binary.
func parseVersion(binary, output string) string {
	for _, kb := range knownBinaries {
		if kb.Name == binary {
			matches := kb.Pattern.FindStringSubmatch(output)
			if len(matches) >= 2 {
				return matches[1]
			}
			return ""
		}
	}
	// Generic fallback
	generic := regexp.MustCompile(`(\d+\.\d+\.\d+)`)
	matches := generic.FindStringSubmatch(output)
	if len(matches) >= 2 {
		return matches[1]
	}
	return ""
}

// nodeVersionOK returns true if the node version is >= 22.
func nodeVersionOK(version string) bool {
	parts := strings.SplitN(version, ".", 3)
	if len(parts) < 1 {
		return false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return false
	}
	return major >= 22
}

// DefaultExtMappings builds the initial extension-to-runtime mapping
// based on which runtimes were detected. JS/TS prefers bun over node.
func DefaultExtMappings(detectedNames []string) []config.ExtMapping {
	has := make(map[string]bool, len(detectedNames))
	for _, name := range detectedNames {
		has[name] = true
	}

	type pref struct {
		ext      string
		runtimes []string // preference order
	}

	prefs := []pref{
		{".ts", []string{"bun", "node"}},
		{".js", []string{"bun", "node"}},
		{".py", []string{"python3"}},
		{".sh", []string{"bash"}},
		{".bash", []string{"bash"}},
		{".rb", []string{"ruby"}},
		{".go", []string{"go run"}},
	}

	var mappings []config.ExtMapping
	for _, p := range prefs {
		for _, rt := range p.runtimes {
			// "go run" -> check "go" binary
			checkName := strings.Fields(rt)[0]
			if has[checkName] {
				mappings = append(mappings, config.ExtMapping{
					Ext:     p.ext,
					Runtime: rt,
				})
				break
			}
		}
	}

	return mappings
}

// DetectedNames returns a string slice of runtime names from a RuntimeInfo slice.
func DetectedNames(detected []config.RuntimeInfo) []string {
	names := make([]string, len(detected))
	for i, r := range detected {
		names[i] = r.Name
	}
	return names
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hook-manager && go test ./internal/runtime/ -v`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add internal/runtime/detect.go internal/runtime/detect_test.go
git commit -m "feat(runtime): add runtime detection package with version parsing and default mappings"
```

---

### Task 3: Executor Config-Based Runtime Lookup

**Files:**
- Modify: `internal/executor/executor.go`
- Modify: `internal/executor/executor_test.go`

- [ ] **Step 1: Write the failing test for RuntimeFor**

Add to `internal/executor/executor_test.go`:

```go
func TestRuntimeFor(t *testing.T) {
	mappings := []config.ExtMapping{
		{Ext: ".ts", Runtime: "bun"},
		{Ext: ".js", Runtime: "node"},
		{Ext: ".py", Runtime: "python3"},
		{Ext: ".sh", Runtime: "bash"},
	}

	tests := []struct {
		filename string
		want     string
	}{
		{"script.ts", "bun"},
		{"script.js", "node"},
		{"test.py", "python3"},
		{"run.sh", "bash"},
		{"unknown.xyz", ""},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			got := RuntimeFor(tt.filename, mappings)
			if got != tt.want {
				t.Errorf("RuntimeFor(%q) = %q, want %q", tt.filename, got, tt.want)
			}
		})
	}
}
```

Add the import for `config` at the top of the test file:

```go
import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/damusix/hook-manager/internal/config"
)
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `cd hook-manager && go test ./internal/executor/ -v -run TestRuntimeFor`
Expected: Compilation error — `RuntimeFor` doesn't exist

- [ ] **Step 3: Replace DefaultRuntime with RuntimeFor**

In `internal/executor/executor.go`, replace the `DefaultRuntime` function (lines 94-114) with:

```go
// RuntimeFor looks up the runtime for a filename from the user's extension mappings.
// Returns empty string if no mapping found (caller should try direct execution via hashbang).
func RuntimeFor(filename string, mappings []config.ExtMapping) string {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, m := range mappings {
		if m.Ext == ext {
			return m.Runtime
		}
	}
	return ""
}

// DefaultRuntime is a hardcoded fallback used when no config mappings are available.
// Deprecated: prefer RuntimeFor with config-based mappings.
func DefaultRuntime(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".py":
		return "python3"
	case ".js":
		return "node"
	case ".ts":
		return "bun"
	case ".sh", ".bash":
		return "bash"
	case ".rb":
		return "ruby"
	case ".go":
		return "go run"
	default:
		return ""
	}
}
```

Add the `config` import to `executor.go`:

```go
import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/damusix/hook-manager/internal/config"
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd hook-manager && go test ./internal/executor/ -v`
Expected: All tests pass (both old and new)

- [ ] **Step 5: Commit**

```bash
git add internal/executor/executor.go internal/executor/executor_test.go
git commit -m "feat(runtime): add RuntimeFor config-based lookup, keep DefaultRuntime as fallback"
```

---

### Task 4: Runtime API Endpoints

**Files:**
- Create: `internal/api/runtimes.go`

- [ ] **Step 1: Create the runtime API handlers**

Create `internal/api/runtimes.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/runtime"
)

// GetRuntimes handles GET /api/runtimes
// Returns detected runtimes and extension mappings.
func (a *API) GetRuntimes(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Runtimes)
}

// RefreshRuntimes handles POST /api/runtimes/refresh
// Re-runs runtime detection and saves results.
func (a *API) RefreshRuntimes(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()

	detected := runtime.Detect()
	cfg.Runtimes.Detected = detected

	// On first run (no mappings yet), generate defaults
	if len(cfg.Runtimes.ExtMappings) == 0 {
		names := runtime.DetectedNames(detected)
		cfg.Runtimes.ExtMappings = runtime.DefaultExtMappings(names)
	}

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Runtimes)
}

// PutMappings handles PUT /api/runtimes/mappings
// Bulk-updates extension mappings.
func (a *API) PutMappings(w http.ResponseWriter, r *http.Request) {
	var mappings []config.ExtMapping
	if err := json.NewDecoder(r.Body).Decode(&mappings); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()

	// Build set of detected runtime names
	detectedSet := make(map[string]bool, len(cfg.Runtimes.Detected))
	for _, d := range cfg.Runtimes.Detected {
		detectedSet[d.Name] = true
	}

	// Validate each mapping
	for _, m := range mappings {
		if !strings.HasPrefix(m.Ext, ".") {
			http.Error(w, "extension must start with '.': "+m.Ext, http.StatusBadRequest)
			return
		}
		if m.Custom {
			// Custom: validate binary exists on system
			if _, err := runtime.ProbeCustom(m.Runtime); err != nil {
				http.Error(w, "custom runtime not found: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
		// Non-custom: allow even if not in detected (shows "unavailable" badge)
	}

	cfg.Runtimes.ExtMappings = mappings

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mappings)
}

// PostMapping handles POST /api/runtimes/mappings
// Adds a single custom extension mapping.
func (a *API) PostMapping(w http.ResponseWriter, r *http.Request) {
	var m config.ExtMapping
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	if !strings.HasPrefix(m.Ext, ".") {
		http.Error(w, "extension must start with '.'", http.StatusBadRequest)
		return
	}

	// Check for duplicate
	cfg := a.store.Get()
	for _, existing := range cfg.Runtimes.ExtMappings {
		if existing.Ext == m.Ext {
			http.Error(w, "extension already mapped: "+m.Ext, http.StatusConflict)
			return
		}
	}

	// Validate binary exists
	if _, err := runtime.ProbeCustom(m.Runtime); err != nil {
		http.Error(w, "runtime not found: "+err.Error(), http.StatusBadRequest)
		return
	}

	m.Custom = true
	cfg.Runtimes.ExtMappings = append(cfg.Runtimes.ExtMappings, m)

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(m)
}

// DeleteMapping handles DELETE /api/runtimes/mappings/{ext}
// Removes a custom mapping only.
func (a *API) DeleteMapping(w http.ResponseWriter, r *http.Request) {
	ext := strings.TrimPrefix(r.URL.Path, "/api/runtimes/mappings/")
	if ext == "" {
		http.Error(w, "extension is required", http.StatusBadRequest)
		return
	}
	// Ensure dot prefix (URL might have it already or not)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	cfg := a.store.Get()
	newMappings := cfg.Runtimes.ExtMappings[:0:0]
	found := false
	for _, m := range cfg.Runtimes.ExtMappings {
		if m.Ext == ext {
			if !m.Custom {
				http.Error(w, "cannot delete built-in mapping: "+ext, http.StatusBadRequest)
				return
			}
			found = true
			continue
		}
		newMappings = append(newMappings, m)
	}

	if !found {
		http.Error(w, "mapping not found: "+ext, http.StatusNotFound)
		return
	}

	cfg.Runtimes.ExtMappings = newMappings

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd hook-manager && go build ./...`
Expected: Clean compile

- [ ] **Step 4: Run all tests**

Run: `cd hook-manager && go test ./... -v`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add internal/api/runtimes.go
git commit -m "feat(runtime): add REST API endpoints for runtimes and extension mappings"
```

---

### Task 5: Wire Routes and Startup Detection in main.go

**Files:**
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Add runtime import and startup detection**

In `cmd/server/main.go`, add the import:

```go
"github.com/damusix/hook-manager/internal/runtime"
```

After the `uiServer` creation (after line 74), add runtime detection on startup:

```go
	// Detect runtimes on startup
	cfg := store.Get()
	detected := runtime.Detect()
	cfg.Runtimes.Detected = detected
	if len(cfg.Runtimes.ExtMappings) == 0 {
		names := runtime.DetectedNames(detected)
		cfg.Runtimes.ExtMappings = runtime.DefaultExtMappings(names)
	}
	store.Save(cfg)
```

Note: The existing `cfg := store.Get()` on line 211 (for reading port) needs to be moved or the variable renamed. Since the startup detection block also uses `cfg`, place it before the routes block and rename the later port-reading to reuse the same `cfg` or re-fetch.

- [ ] **Step 2: Add runtime API routes**

After the existing `/api/logs` route block (around line 208), add:

```go
	// Runtime routes
	mux.HandleFunc("/api/runtimes/refresh", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.RefreshRuntimes(w, r)
	})

	mux.HandleFunc("/api/runtimes/mappings/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.DeleteMapping(w, r)
	})

	mux.HandleFunc("/api/runtimes/mappings", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut:
			apiHandler.PutMappings(w, r)
		case http.MethodPost:
			apiHandler.PostMapping(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/runtimes", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetRuntimes(w, r)
	})
```

**Important:** The `/api/runtimes/refresh` and `/api/runtimes/mappings/` routes MUST be registered before `/api/runtimes/mappings` and `/api/runtimes` because Go's `ServeMux` matches the longest prefix first for patterns ending in `/`, but for exact patterns the more specific must come first.

- [ ] **Step 3: Add the hourly refresh ticker**

In the goroutine that handles shutdown (around line 222), add a ticker. Replace the existing shutdown goroutine with:

```go
	// Hourly runtime refresh ticker
	refreshTicker := time.NewTicker(1 * time.Hour)
	defer refreshTicker.Stop()

	go func() {
		for {
			select {
			case <-sigCtx.Done():
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				server.Shutdown(shutdownCtx)
				os.Remove(portPath)
				return
			case <-shutdownCh:
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				server.Shutdown(shutdownCtx)
				os.Remove(portPath)
				return
			case <-refreshTicker.C:
				c := store.Get()
				c.Runtimes.Detected = runtime.Detect()
				store.Save(c)
			}
		}
	}()
```

- [ ] **Step 4: Verify it compiles and runs**

Run: `cd hook-manager && go build ./cmd/server/`
Expected: Clean compile

- [ ] **Step 5: Commit**

```bash
git add cmd/server/main.go
git commit -m "feat(runtime): wire runtime routes, startup detection, and hourly refresh"
```

---

### Task 6: Update Executor Callers to Use Config Mappings

**Files:**
- Modify: `internal/api/scripts.go`
- Modify: `internal/api/config.go`
- Modify: `internal/hooks/handler.go`

- [ ] **Step 1: Update TestScript in scripts.go**

In `internal/api/scripts.go`, around line 157-159, replace:

```go
	if req.Runtime == "" {
		req.Runtime = executor.DefaultRuntime(path)
	}
```

With:

```go
	if req.Runtime == "" {
		cfg := a.store.Get()
		req.Runtime = executor.RuntimeFor(path, cfg.Runtimes.ExtMappings)
	}
```

- [ ] **Step 2: Update TestHook in config.go**

In `internal/api/config.go`, the `TestHook` handler at line 249 creates `executor.Params` with `Runtime: found.Runtime`. When `found.Runtime` is empty, the executor calls `DefaultRuntime()`. Update the params section (around lines 249-256) to use config mappings:

Replace:

```go
	params := executor.Params{
		Type:    found.Type,
		Command: found.Command,
		Runtime: found.Runtime,
		Stdin:   payloadBytes,
		Timeout: timeout,
	}
```

With:

```go
	rt := found.Runtime
	if rt == "" && found.Type == "managed" {
		cfg := a.store.Get()
		rt = executor.RuntimeFor(found.File, cfg.Runtimes.ExtMappings)
	}

	params := executor.Params{
		Type:    found.Type,
		Command: found.Command,
		Runtime: rt,
		Stdin:   payloadBytes,
		Timeout: timeout,
	}
```

Note: `cfg` is already used earlier in this function (line 225). Rename the new one or reuse:

```go
	rt := found.Runtime
	if rt == "" && found.Type == "managed" {
		rt = executor.RuntimeFor(found.File, cfg.Runtimes.ExtMappings)
	}
```

This works since `cfg` is already in scope from line 225.

- [ ] **Step 3: Update executeHooks in handler.go**

In `internal/hooks/handler.go`, the `executeHooks` method (line 168) passes `hook.Runtime` directly to `executor.Params`. Update it to resolve from config when empty.

In the goroutine (around line 182-189), replace:

```go
			params := executor.Params{
				Type:    hook.Type,
				Command: hook.Command,
				Runtime: hook.Runtime,
				Stdin:   stdin,
				Timeout: timeout,
				Env:     env,
			}
```

With:

```go
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
```

Add the executor import if not present (it's already imported in handler.go).

- [ ] **Step 4: Verify it compiles and all tests pass**

Run: `cd hook-manager && go build ./...`
Run: `cd hook-manager && go test ./... -v`
Expected: Clean compile, all tests pass

- [ ] **Step 5: Commit**

```bash
git add internal/api/scripts.go internal/api/config.go internal/hooks/handler.go
git commit -m "refactor(runtime): replace DefaultRuntime calls with config-based RuntimeFor lookups"
```

---

### Task 7: Update Config Editor UI — Template Data

**Files:**
- Modify: `internal/ui/ui.go`

- [ ] **Step 1: Pass runtimes data to config template**

In `internal/ui/ui.go`, update the `ConfigEditor` method (around line 349-376). Add runtimes data to the template data map.

After `"ConfigPath": u.configPath,` (line 374), add:

```go
		"Runtimes": cfg.Runtimes,
```

The full `tplData` map becomes:

```go
	tplData := map[string]any{
		"Page":       "config",
		"Port":       cfg.Server.Port,
		"LogLevel":   cfg.Server.LogLevel,
		"ConfigYAML": yamlContent,
		"TotalHooks": totalHooks,
		"ConfigPath": u.configPath,
		"Runtimes":   cfg.Runtimes,
	}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd hook-manager && go build ./...`
Expected: Clean compile

- [ ] **Step 3: Commit**

```bash
git add internal/ui/ui.go
git commit -m "feat(runtime): pass runtimes data to config editor template"
```

---

### Task 8: Config Editor Frontend — Runtimes Card

**Files:**
- Modify: `web/templates/config_editor.html`

- [ ] **Step 1: Add the Runtimes card HTML**

In `web/templates/config_editor.html`, after the closing `</div>` of the Server card (line 42) and before the Storage card (line 44), insert the Runtimes card.

Replace the content between the Server card's closing `</div>` (line 42) and the Storage card opening `<div class="surface"` (line 45) with:

```html

        <!-- Runtimes Card -->
        <div class="surface" style="padding: 0; overflow: hidden;">
            <div class="card-header" style="justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="card-header-icon" style="background: rgba(139,92,246,0.12);">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                    <div>
                        <div class="card-header-title">Runtimes</div>
                        <div class="card-header-subtitle">Which programs execute your scripts</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="rt-checked-ago" style="color: var(--text-muted); font-size: 10px;"></span>
                    <button type="button" id="rt-refresh-btn" onclick="refreshRuntimes()" style="background: var(--bg-raised); border: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; padding: 4px 10px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 10px;">&#8635;</span> Refresh
                    </button>
                </div>
            </div>

            <!-- Detected runtimes chips -->
            <div id="rt-detected" style="padding: 12px 18px; border-bottom: 1px solid var(--border-subtle);"></div>

            <!-- Extension mappings table -->
            <div id="rt-mappings"></div>

            <!-- Add custom extension -->
            <div style="padding: 10px 18px; border-top: 1px solid var(--border-subtle);">
                <div id="rt-add-row" style="display: none; margin-bottom: 8px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="rt-new-ext" placeholder=".ext" class="input" style="width: 70px; font-size: 12px;">
                        <input type="text" id="rt-new-runtime" placeholder="binary name" class="input" style="width: 140px; font-size: 12px;">
                        <button type="button" onclick="addCustomMapping()" class="btn-primary" style="font-size: 11px; padding: 4px 10px;">Add</button>
                        <button type="button" onclick="cancelAddMapping()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px;">Cancel</button>
                    </div>
                    <div id="rt-add-error" style="color: var(--error); font-size: 11px; margin-top: 4px; display: none;"></div>
                </div>
                <button type="button" id="rt-add-btn" onclick="showAddRow()" style="background: none; border: 1px dashed var(--border); color: var(--text-muted); font-size: 11px; padding: 6px 12px; border-radius: 5px; cursor: pointer; width: 100%; text-align: center;">
                    + Add custom extension
                </button>
            </div>
        </div>
```

- [ ] **Step 2: Add the JavaScript for the Runtimes card**

At the bottom of the `<script>` block in `config_editor.html`, after the existing form submit handler (before `</script>`), add:

```javascript
// ─── Runtimes ───────────────────────────────────────────────

var rtState = { detected: [], ext_mappings: [] };

function loadRuntimes() {
    fetch('/api/runtimes').then(function(r) { return r.json(); }).then(function(data) {
        rtState = data;
        renderRuntimes();
    });
}

function refreshRuntimes() {
    var btn = document.getElementById('rt-refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Checking...';
    fetch('/api/runtimes/refresh', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(data) {
        rtState = data;
        renderRuntimes();
        showToast('Runtimes refreshed', false);
    }).catch(function(err) {
        showToast('Refresh failed: ' + err, true);
    }).finally(function() {
        btn.disabled = false;
        btn.innerHTML = '<span style="font-size:10px">&#8635;</span> Refresh';
    });
}

function renderRuntimes() {
    // Detected chips
    var detEl = document.getElementById('rt-detected');
    if (!rtState.detected || rtState.detected.length === 0) {
        detEl.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">No runtimes detected. Click Refresh.</span>';
    } else {
        var label = '<div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Detected on this machine</div>';
        var chips = rtState.detected.map(function(d) {
            return '<span style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.2);color:#4ade80;font-size:11px;padding:3px 8px;border-radius:4px;display:inline-block;margin:2px;">' + d.name + ' ' + d.version + '</span>';
        }).join('');
        detEl.innerHTML = label + '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + chips + '</div>';

        // Update "checked ago"
        if (rtState.detected.length > 0) {
            var checked = new Date(rtState.detected[0].checked_at);
            var ago = Math.round((Date.now() - checked.getTime()) / 60000);
            var agoText = ago < 1 ? 'just now' : ago + 'm ago';
            document.getElementById('rt-checked-ago').textContent = 'Checked ' + agoText;
        }
    }

    // Build set of detected names for availability check
    var detectedSet = {};
    (rtState.detected || []).forEach(function(d) { detectedSet[d.name] = d; });

    // Mappings table
    var mapEl = document.getElementById('rt-mappings');
    if (!rtState.ext_mappings || rtState.ext_mappings.length === 0) {
        mapEl.innerHTML = '<div style="padding:12px 18px;color:var(--text-muted);font-size:12px;">No mappings configured.</div>';
        return;
    }

    var header = '<div style="padding:12px 18px 8px;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">Extension Mappings</div>';
    var colHeader = '<div style="display:grid;grid-template-columns:80px 1fr 40px;padding:6px 18px;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:0.3px;"><span>Ext</span><span>Runtime</span><span></span></div>';

    var rows = rtState.ext_mappings.map(function(m, i) {
        var extCode = '<code style="color:var(--accent);font-size:12px;background:rgba(245,158,11,0.08);padding:2px 6px;border-radius:3px;">' + m.ext + '</code>';

        // Check the base binary name for availability
        var baseName = m.runtime.split(' ')[0];
        var isAvailable = !!detectedSet[baseName];

        var runtimeCell = '';
        if (m.custom) {
            // Custom: show name with availability badge
            runtimeCell = '<span style="font-size:12px;color:var(--text-primary);">' + m.runtime + '</span>';
            if (!isAvailable) {
                runtimeCell += ' <span style="background:rgba(239,68,68,0.15);color:#f87171;font-size:10px;padding:2px 6px;border-radius:3px;">unavailable</span>';
            }
        } else {
            // Built-in: dropdown of detected runtimes
            var options = (rtState.detected || []).map(function(d) {
                // For "go run", match on "go"
                var selected = (m.runtime === d.name || m.runtime === d.name + ' run') ? ' selected' : '';
                return '<option value="' + d.name + '"' + selected + '>' + d.name + '</option>';
            }).join('');
            // Also add "go run" option if go is detected
            runtimeCell = '<select onchange="updateMapping(' + i + ',this.value)" style="background:var(--bg-raised);border:1px solid var(--border);color:var(--text-primary);font-size:12px;padding:4px 8px;border-radius:4px;width:140px;">' + options + '</select>';
            // Show path
            var pathInfo = detectedSet[baseName];
            if (pathInfo) {
                runtimeCell += ' <span style="color:var(--text-muted);font-size:10px;">' + pathInfo.path + '</span>';
            } else {
                runtimeCell += ' <span style="background:rgba(239,68,68,0.15);color:#f87171;font-size:10px;padding:2px 6px;border-radius:3px;">unavailable</span>';
            }
        }

        var deleteBtn = '';
        if (m.custom) {
            deleteBtn = '<button type="button" onclick="deleteMapping(\'' + m.ext + '\')" style="background:none;border:none;color:var(--text-muted);font-size:14px;cursor:pointer;padding:2px 6px;">&times;</button>';
        }

        var rowBg = (!isAvailable && m.custom) ? 'background:rgba(239,68,68,0.04);' : '';
        return '<div style="display:grid;grid-template-columns:80px 1fr 40px;padding:8px 18px;border-top:1px solid var(--border-subtle);align-items:center;' + rowBg + '">' + extCode + '<div style="display:flex;align-items:center;gap:6px;">' + runtimeCell + '</div>' + deleteBtn + '</div>';
    }).join('');

    mapEl.innerHTML = header + colHeader + rows;
}

function updateMapping(index, newRuntime) {
    rtState.ext_mappings[index].runtime = newRuntime;
    fetch('/api/runtimes/mappings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rtState.ext_mappings)
    }).then(function(r) {
        if (r.ok) {
            showToast('Mapping updated', false);
        } else {
            r.text().then(function(t) { showToast('Error: ' + t, true); });
        }
    });
}

function showAddRow() {
    document.getElementById('rt-add-row').style.display = 'block';
    document.getElementById('rt-add-btn').style.display = 'none';
    document.getElementById('rt-new-ext').focus();
}

function cancelAddMapping() {
    document.getElementById('rt-add-row').style.display = 'none';
    document.getElementById('rt-add-btn').style.display = 'block';
    document.getElementById('rt-add-error').style.display = 'none';
    document.getElementById('rt-new-ext').value = '';
    document.getElementById('rt-new-runtime').value = '';
}

function addCustomMapping() {
    var ext = document.getElementById('rt-new-ext').value.trim();
    var rt = document.getElementById('rt-new-runtime').value.trim();
    var errEl = document.getElementById('rt-add-error');

    if (!ext.startsWith('.')) ext = '.' + ext;
    if (!rt) {
        errEl.textContent = 'Runtime binary is required';
        errEl.style.display = 'block';
        return;
    }

    fetch('/api/runtimes/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext: ext, runtime: rt })
    }).then(function(r) {
        if (r.ok) {
            return r.json().then(function(m) {
                rtState.ext_mappings.push(m);
                renderRuntimes();
                cancelAddMapping();
                showToast('Custom mapping added', false);
            });
        } else {
            return r.text().then(function(t) {
                errEl.textContent = t;
                errEl.style.display = 'block';
            });
        }
    });
}

function deleteMapping(ext) {
    fetch('/api/runtimes/mappings/' + ext, { method: 'DELETE' }).then(function(r) {
        if (r.ok) {
            rtState.ext_mappings = rtState.ext_mappings.filter(function(m) { return m.ext !== ext; });
            renderRuntimes();
            showToast('Mapping removed', false);
        } else {
            r.text().then(function(t) { showToast('Error: ' + t, true); });
        }
    });
}

// Load on page ready
loadRuntimes();
```

- [ ] **Step 3: Verify the server builds and starts**

Run: `cd hook-manager && go build ./cmd/server/`
Expected: Clean compile

- [ ] **Step 4: Manual verification**

Start the server and visit `http://localhost:47821/config`. Verify:
- Runtimes card appears between Server and Storage cards
- Detected runtimes show as green chips
- Extension mapping table renders with dropdowns
- Refresh button triggers re-detection
- Dropdown changes save immediately
- "Add custom extension" flow works
- Delete (×) works on custom mappings

- [ ] **Step 5: Commit**

```bash
git add web/templates/config_editor.html internal/ui/ui.go
git commit -m "feat(runtime): add runtimes card to settings page with detection, mappings, and custom extensions"
```

---

### Task 9: Final Integration and Cleanup

**Files:**
- Modify: `internal/executor/executor.go` (cleanup)

- [ ] **Step 1: Remove deprecated DefaultRuntime if all callers updated**

Verify no remaining callers of `DefaultRuntime`:

Run: `cd hook-manager && grep -r "DefaultRuntime" --include="*.go" .`

If the only references are the function definition itself and the test, remove `DefaultRuntime` from `executor.go` entirely. Update `executor_test.go` to remove any tests that reference it (the `TestDefaultRuntime` test if it exists — currently it doesn't, only `TestManagedScript` which uses `Runtime: "bash"` directly).

If `DefaultRuntime` is still referenced somewhere, leave it and add a `// Deprecated` comment.

- [ ] **Step 2: Run the full test suite**

Run: `cd hook-manager && go test ./... -v`
Expected: All tests pass

- [ ] **Step 3: Build the final binary**

Run: `cd hook-manager && go build -o /tmp/hook-manager ./cmd/server/`
Expected: Binary builds successfully

- [ ] **Step 4: Commit cleanup**

```bash
git add internal/executor/executor.go
git commit -m "refactor(runtime): remove deprecated DefaultRuntime function"
```
