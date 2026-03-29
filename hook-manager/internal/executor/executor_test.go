package executor

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/damusix/hook-manager/internal/config"
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
