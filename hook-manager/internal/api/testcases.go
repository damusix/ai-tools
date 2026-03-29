package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type testCase struct {
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Event       string `json:"event"`
	Payload     any    `json:"payload"`
	CreatedAt   string `json:"created_at"`
	Filename    string `json:"filename,omitempty"`
}

// testsDir returns the tests directory path derived from scriptsDir.
// scriptsDir is ~/.ai-hooks/scripts, so tests dir is ~/.ai-hooks/tests
func (a *API) testsDir() string {
	return filepath.Join(filepath.Dir(a.scriptsDir), "tests")
}

// slugify converts a title to a filesystem-safe slug.
func slugify(title string) string {
	s := strings.ToLower(title)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 50 {
		s = s[:50]
	}
	if s == "" {
		s = "test"
	}
	return s
}

// parseTestCasePath extracts script, event, and optional filename from the URL path.
// Path format: /api/testcases/{script}/{event}[/{filename}]
func parseTestCasePath(path string) (script, event, filename string, ok bool) {
	trimmed := strings.TrimPrefix(path, "/api/testcases/")
	if trimmed == "" || trimmed == path {
		return "", "", "", false
	}
	parts := strings.SplitN(trimmed, "/", 3)
	if len(parts) < 2 {
		return "", "", "", false
	}
	script = parts[0]
	event = parts[1]
	if len(parts) == 3 && parts[2] != "" {
		filename = parts[2]
	}
	return script, event, filename, true
}

// GetTestCases handles GET /api/testcases/{script}/{event}
func (a *API) GetTestCases(w http.ResponseWriter, r *http.Request) {
	script, event, filename, ok := parseTestCasePath(r.URL.Path)
	if !ok || script == "" || event == "" {
		http.Error(w, "invalid path: expected /api/testcases/{script}/{event}", http.StatusBadRequest)
		return
	}

	// If a specific filename is requested, return that single test case
	if filename != "" {
		a.getSingleTestCase(w, script, event, filename)
		return
	}

	dir := filepath.Join(a.testsDir(), script, event)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]any{})
			return
		}
		http.Error(w, "failed to read tests dir: "+err.Error(), http.StatusInternalServerError)
		return
	}

	cases := make([]testCase, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var tc testCase
		if err := json.Unmarshal(data, &tc); err != nil {
			continue
		}
		tc.Filename = e.Name()
		cases = append(cases, tc)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cases)
}

// getSingleTestCase returns a single test case by filename.
func (a *API) getSingleTestCase(w http.ResponseWriter, script, event, filename string) {
	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	path := filepath.Join(a.testsDir(), script, event, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "test case not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to read test case: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var tc testCase
	if err := json.Unmarshal(data, &tc); err != nil {
		http.Error(w, "failed to parse test case: "+err.Error(), http.StatusInternalServerError)
		return
	}
	tc.Filename = filename

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tc)
}

// PostTestCase handles POST /api/testcases/{script}/{event}
func (a *API) PostTestCase(w http.ResponseWriter, r *http.Request) {
	script, event, _, ok := parseTestCasePath(r.URL.Path)
	if !ok || script == "" || event == "" {
		http.Error(w, "invalid path: expected /api/testcases/{script}/{event}", http.StatusBadRequest)
		return
	}

	// Validate script/event don't have path traversal
	if strings.Contains(script, "..") || strings.Contains(event, "..") {
		http.Error(w, "invalid path components", http.StatusBadRequest)
		return
	}

	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Payload     any    `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Title == "" {
		http.Error(w, "title is required", http.StatusBadRequest)
		return
	}

	dir := filepath.Join(a.testsDir(), script, event)
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, "failed to create tests dir: "+err.Error(), http.StatusInternalServerError)
		return
	}

	slug := slugify(req.Title)
	filename := slug + ".json"

	// Ensure unique filename
	base := slug
	counter := 1
	for {
		path := filepath.Join(dir, filename)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			break
		}
		counter++
		filename = fmt.Sprintf("%s-%d.json", base, counter)
	}

	tc := testCase{
		Title:       req.Title,
		Description: req.Description,
		Event:       event,
		Payload:     req.Payload,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(tc, "", "    ")
	if err != nil {
		http.Error(w, "failed to marshal test case: "+err.Error(), http.StatusInternalServerError)
		return
	}

	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, data, 0644); err != nil {
		http.Error(w, "failed to write test case: "+err.Error(), http.StatusInternalServerError)
		return
	}

	tc.Filename = filename
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tc)
}

// DeleteTestCase handles DELETE /api/testcases/{script}/{event}/{filename}
func (a *API) DeleteTestCase(w http.ResponseWriter, r *http.Request) {
	script, event, filename, ok := parseTestCasePath(r.URL.Path)
	if !ok || script == "" || event == "" || filename == "" {
		http.Error(w, "invalid path: expected /api/testcases/{script}/{event}/{filename}", http.StatusBadRequest)
		return
	}

	if strings.Contains(filename, "..") || strings.Contains(filename, "/") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	path := filepath.Join(a.testsDir(), script, event, filename)
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "test case not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to delete test case: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
