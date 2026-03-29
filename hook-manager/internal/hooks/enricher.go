package hooks

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ExtractHeaderEnv extracts HTTP headers starting with "X-Claude-" and
// converts them to environment variable format.
// E.g. "X-Claude-Session-Id" becomes "CLAUDE_SESSION_ID".
func ExtractHeaderEnv(r *http.Request) map[string]string {
	env := make(map[string]string)
	for name, values := range r.Header {
		if strings.HasPrefix(name, "X-Claude-") {
			// Strip "X-" prefix, uppercase, replace "-" with "_"
			key := strings.TrimPrefix(name, "X-")
			key = strings.ReplaceAll(key, "-", "_")
			key = strings.ToUpper(key)
			if len(values) > 0 {
				env[key] = values[0]
			}
		}
	}
	return env
}

// FindClaudeMDFiles walks up from dir looking for CLAUDE.md and AGENTS.md files.
// Returns all found paths ordered from deepest to shallowest directory.
func FindClaudeMDFiles(dir string) []string {
	var paths []string
	targets := []string{"CLAUDE.md", "AGENTS.md"}

	current := dir
	for {
		for _, target := range targets {
			p := filepath.Join(current, target)
			if _, err := os.Stat(p); err == nil {
				paths = append(paths, p)
			}
		}

		parent := filepath.Dir(current)
		if parent == current {
			break // reached filesystem root
		}
		current = parent
	}

	return paths
}

// EnrichPayload extracts environment variables from HTTP headers and
// resolves CLAUDE.md/AGENTS.md paths from the working directory.
// Returns a map of environment variables to set for hook execution.
func EnrichPayload(input map[string]any, r *http.Request) map[string]string {
	env := ExtractHeaderEnv(r)

	// Extract cwd from the JSON body if present
	cwd, _ := input["cwd"].(string)
	if cwd == "" {
		// Fall back to X-Claude-Cwd header
		cwd = env["CLAUDE_CWD"]
	}

	if cwd != "" {
		mdPaths := FindClaudeMDFiles(cwd)
		if len(mdPaths) > 0 {
			env["CLAUDE_MD_PATHS"] = strings.Join(mdPaths, string(os.PathListSeparator))
		}
	}

	return env
}
