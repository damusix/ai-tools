package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/damusix/hook-manager/internal/api"
	"github.com/damusix/hook-manager/internal/capture"
	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/hooks"
	"github.com/damusix/hook-manager/internal/logger"
	"github.com/damusix/hook-manager/internal/runtime"
	"github.com/damusix/hook-manager/internal/ui"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Printf("hook-manager %s (%s) built %s\n", version, commit, buildDate)
		os.Exit(0)
	}
	os.Exit(run())
}

func run() int {
	homeDir, _ := os.UserHomeDir()
	stateDir := filepath.Join(homeDir, ".ai-hooks")
	configPath := filepath.Join(stateDir, "config.yaml")
	logPath := filepath.Join(stateDir, "hooks.log")
	portPath := filepath.Join(stateDir, ".port")
	scriptsDir := filepath.Join(stateDir, "scripts")

	// Ensure state directories exist
	os.MkdirAll(stateDir, 0755)
	os.MkdirAll(scriptsDir, 0755)

	// Load config
	store, err := config.NewStore(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hook-manager: config error: %v\n", err)
		return 1
	}

	// Init logger
	hookLogger, err := logger.New(logPath, 5*1024*1024, 3)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hook-manager: logger error: %v\n", err)
		return 1
	}
	defer hookLogger.Close()

	// Build handler with shutdown channel
	shutdownCh := make(chan struct{})
	restartCh := make(chan struct{})
	captureBuf := capture.NewBuffer(1000)
	hookHandler := hooks.NewHandler(store, hookLogger, scriptsDir, shutdownCh, captureBuf)

	// API handlers
	apiHandler := api.New(store, scriptsDir, logPath, captureBuf, hookLogger, shutdownCh, restartCh)

	// UI
	uiServer, err := ui.New(store, logPath, configPath, scriptsDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "hook-manager: ui error: %v\n", err)
		return 1
	}

	// Detect runtimes on startup
	{
		c := store.Get()
		detected := runtime.Detect()
		c.Runtimes.Detected = detected
		if len(c.Runtimes.ExtMappings) == 0 {
			names := runtime.DetectedNames(detected)
			c.Runtimes.ExtMappings = runtime.DefaultExtMappings(names)
		}
		store.Save(c)
	}

	// Routes
	mux := http.NewServeMux()
	mux.Handle("/static/", uiServer.StaticHandler())
	mux.HandleFunc("/", uiServer.Dashboard)
	mux.HandleFunc("/ui/logs-partial", uiServer.LogsPartial)

	// UI page routes
	mux.HandleFunc("/hooks", uiServer.HookList)
	mux.HandleFunc("/hooks/", uiServer.HookDetail)
	mux.HandleFunc("/scripts", uiServer.ScriptList)
	mux.HandleFunc("/scripts/", uiServer.ScriptEditor)
	mux.HandleFunc("/config", uiServer.ConfigEditor)
	mux.HandleFunc("/logs", uiServer.LogViewer)
	mux.HandleFunc("/capture", uiServer.CaptureView)
	mux.HandleFunc("/test", uiServer.TestBench)

	mux.Handle("/hook/", hookHandler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Config routes
	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetConfig(w, r)
		case http.MethodPut:
			apiHandler.PutConfig(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Hooks routes — order matters: more specific patterns first
	mux.HandleFunc("/api/hooks/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// POST /api/hooks/{event}/{name}/test
		if r.Method == http.MethodPost && len(path) > len("/api/hooks/") && hasTrailing(path, "/test") {
			apiHandler.TestHook(w, r)
			return
		}
		// PUT /api/hooks/{event}/{name} or DELETE /api/hooks/{event}/{name}
		segs := countSegments(path, "/api/hooks/")
		switch {
		case r.Method == http.MethodPut && segs == 2:
			apiHandler.PutHook(w, r)
		case r.Method == http.MethodDelete && segs == 2:
			apiHandler.DeleteHook(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/hooks", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetHooks(w, r)
		case http.MethodPost:
			apiHandler.PostHook(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Scripts routes
	mux.HandleFunc("/api/scripts/", func(w http.ResponseWriter, r *http.Request) {
		// POST /api/scripts/{file}/test
		if r.Method == http.MethodPost && hasTrailing(r.URL.Path, "/test") {
			apiHandler.TestScript(w, r)
			return
		}
		// PUT /api/scripts/{file}/meta
		if r.Method == http.MethodPut && hasTrailing(r.URL.Path, "/meta") {
			apiHandler.PutScriptMeta(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetScript(w, r)
		case http.MethodPut:
			apiHandler.PutScript(w, r)
		case http.MethodDelete:
			apiHandler.DeleteScript(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/scripts", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetScripts(w, r)
		case http.MethodPost:
			apiHandler.PostScript(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// AI generation
	mux.HandleFunc("/api/ai/generate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GenerateAI(w, r)
	})

	// Test cases
	mux.HandleFunc("/api/testcases/", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetTestCases(w, r)
		case http.MethodPost:
			apiHandler.PostTestCase(w, r)
		case http.MethodDelete:
			apiHandler.DeleteTestCase(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Logs routes
	mux.HandleFunc("/api/logs/stream", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.StreamLogs(w, r)
	})

	mux.HandleFunc("/api/logs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetLogs(w, r)
	})

	// Capture routes
	mux.HandleFunc("/api/capture/stream", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.StreamCapture(w, r)
	})

	mux.HandleFunc("/api/capture/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetCaptureProjects(w, r)
	})

	mux.HandleFunc("/api/capture/events", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			apiHandler.GetCaptureEvents(w, r)
		case http.MethodDelete:
			apiHandler.ClearCapture(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Server control routes
	mux.HandleFunc("/api/server/stop", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.StopServer(w, r)
	})

	mux.HandleFunc("/api/server/restart", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.RestartServer(w, r)
	})

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

	// TypeScript definitions for editor IntelliSense
	mux.HandleFunc("/api/types/hooks", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		apiHandler.GetHookTypes(w, r)
	})

	// Start server
	cfg := store.Get()
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	server := &http.Server{Addr: addr, Handler: requestLogger(hookLogger, mux)}

	// Write port file
	os.WriteFile(portPath, []byte(fmt.Sprintf("%d", cfg.Server.Port)), 0644)

	// Graceful shutdown on SIGTERM/SIGINT or SessionEnd
	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// Hourly runtime refresh ticker
	refreshTicker := time.NewTicker(1 * time.Hour)
	defer refreshTicker.Stop()

	doRestart := false

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
			case <-restartCh:
				doRestart = true
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

	hookLogger.Info("server started on " + addr)
	log.Printf("hook-manager listening on %s\n", addr)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "hook-manager: server error: %v\n", err)
		return 1
	}

	hookLogger.Info("server stopped")

	if doRestart {
		exe, err := os.Executable()
		if err != nil {
			fmt.Fprintf(os.Stderr, "hook-manager: cannot find executable: %v\n", err)
			return 1
		}
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		if err := cmd.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "hook-manager: restart failed: %v\n", err)
			return 1
		}
		log.Printf("hook-manager restarted as pid %d\n", cmd.Process.Pid)
	}

	return 0
}

// hasTrailing returns true if path ends with the given suffix.
func hasTrailing(path, suffix string) bool {
	return len(path) >= len(suffix) && path[len(path)-len(suffix):] == suffix
}

// statusRecorder wraps http.ResponseWriter to capture the status code.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wrote {
		r.status = 200
		r.wrote = true
	}
	return r.ResponseWriter.Write(b)
}

// Unwrap returns the underlying ResponseWriter so http.Flusher etc. still work.
func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

// Flush implements http.Flusher for SSE support.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// requestLogger returns middleware that logs HTTP requests to the hook logger.
// Skips noisy paths like static files, SSE streams, and the logs endpoints.
func requestLogger(l *logger.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Skip: static assets, SSE streams, log reads (avoid feedback loops), health
		if strings.HasPrefix(path, "/static/") ||
			strings.HasSuffix(path, "/stream") ||
			path == "/health" ||
			path == "/api/logs" ||
			path == "/ui/logs-partial" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		l.Request(r.Method, path, rec.status, time.Since(start).Milliseconds())
	})
}

// countSegments counts the number of path segments after the given prefix.
// e.g., countSegments("/api/hooks/Foo/Bar", "/api/hooks/") == 2
func countSegments(path, prefix string) int {
	trimmed := path[len(prefix):]
	if trimmed == "" {
		return 0
	}
	count := 0
	inSeg := false
	for _, c := range trimmed {
		if c == '/' {
			inSeg = false
		} else {
			if !inSeg {
				count++
				inSeg = true
			}
		}
	}
	return count
}
