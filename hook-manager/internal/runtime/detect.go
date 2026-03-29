package runtime

import (
	"context"
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
	{"elixir", []string{"--version"}, regexp.MustCompile(`Elixir (\d+\.\d+\.\d+)`)},
	{"php", []string{"--version"}, regexp.MustCompile(`PHP (\d+\.\d+\.\d+)`)},
	{"zsh", []string{"--version"}, regexp.MustCompile(`zsh (\d+\.\d+(?:\.\d+)?)`)},
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

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		out, err := exec.CommandContext(ctx, kb.Name, kb.VersionCmd...).CombinedOutput()
		cancel()
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
	parts := strings.Fields(binary)
	if len(parts) == 0 {
		return "", fmt.Errorf("binary name is empty")
	}
	name := parts[0]
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
		{".ex", []string{"elixir"}},
		{".exs", []string{"elixir"}},
		{".php", []string{"php"}},
		{".zsh", []string{"zsh"}},
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
