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
