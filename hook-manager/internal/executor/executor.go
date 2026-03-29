package executor

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
		runtime := p.Runtime
		if runtime == "" {
			runtime = DefaultRuntime(p.ScriptPath)
		}
		if runtime == "" {
			// No runtime detected — try running directly (relies on hashbang + chmod +x)
			cmdStr = p.ScriptPath
		} else {
			cmdStr = fmt.Sprintf("%s %s", runtime, p.ScriptPath)
		}
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

// Deprecated: prefer RuntimeFor with config-based mappings.
// DefaultRuntime guesses the runtime from a script's file extension.
// Returns empty string if unknown (caller should try direct execution via hashbang).
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

func mapToEnv(m map[string]string) []string {
	env := make([]string, 0, len(m))
	for k, v := range m {
		env = append(env, k+"="+v)
	}
	return env
}
