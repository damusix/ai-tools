package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

type Entry struct {
	Timestamp time.Time `json:"timestamp"`
	Category  string    `json:"category"` // "hook", "request", "server"
	Level     string    `json:"level,omitempty"` // "info", "warn", "error"

	// Hook execution fields (category: "hook")
	Event         string `json:"event,omitempty"`
	Hook          string `json:"hook,omitempty"`
	Matcher       string `json:"matcher,omitempty"`
	ExitCode      int    `json:"exit_code"`
	DurationMs    int64  `json:"duration_ms"`
	StdoutPreview string `json:"stdout_preview,omitempty"`
	Stderr        string `json:"stderr,omitempty"`

	// HTTP request fields (category: "request")
	Method string `json:"method,omitempty"`
	Path   string `json:"path,omitempty"`
	Status int    `json:"status,omitempty"`

	// General message (category: "server" or error detail)
	Message string `json:"message,omitempty"`
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
	if e.Category == "" {
		e.Category = "hook"
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

// Info logs a server-level info event.
func (l *Logger) Info(msg string) {
	l.Log(Entry{Category: "server", Level: "info", Message: msg})
}

// Warn logs a server-level warning event.
func (l *Logger) Warn(msg string) {
	l.Log(Entry{Category: "server", Level: "warn", Message: msg})
}

// Error logs a server-level error event.
func (l *Logger) Error(msg string) {
	l.Log(Entry{Category: "server", Level: "error", Message: msg})
}

// Request logs an HTTP request completion.
func (l *Logger) Request(method, path string, status int, durationMs int64) {
	level := "info"
	if status >= 500 {
		level = "error"
	} else if status >= 400 {
		level = "warn"
	}
	l.Log(Entry{
		Category:   "request",
		Level:      level,
		Method:     method,
		Path:       path,
		Status:     status,
		DurationMs: durationMs,
	})
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
