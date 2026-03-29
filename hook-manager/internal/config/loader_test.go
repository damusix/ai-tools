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
