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
		{"elixir labeled", "elixir", "Elixir 1.16.2 (compiled with Erlang/OTP 26)\n", "1.16.2"},
		{"php labeled", "php", "PHP 8.3.4 (cli) (built: Mar 16 2024 08:40:08)\n", "8.3.4"},
		{"zsh labeled", "zsh", "zsh 5.9 (x86_64-apple-darwin23.0)\n", "5.9"},
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
