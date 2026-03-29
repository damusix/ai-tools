package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/damusix/hook-manager/internal/capture"
	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/logger"
)

// API holds shared dependencies for all API handlers.
type API struct {
	store      *config.Store
	scriptsDir string
	logPath    string
	capture    *capture.Buffer
	logger     *logger.Logger
	shutdownCh chan struct{}
	restartCh  chan struct{}
}

// New creates a new API instance.
func New(store *config.Store, scriptsDir, logPath string, cap *capture.Buffer, log *logger.Logger, shutdownCh, restartCh chan struct{}) *API {
	return &API{
		store:      store,
		scriptsDir: scriptsDir,
		logPath:    logPath,
		capture:    cap,
		logger:     log,
		shutdownCh: shutdownCh,
		restartCh:  restartCh,
	}
}

// StopServer handles POST /api/server/stop
func (a *API) StopServer(w http.ResponseWriter, r *http.Request) {
	a.logger.Warn("server stop requested")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopping"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		close(a.shutdownCh)
	}()
}

// RestartServer handles POST /api/server/restart
func (a *API) RestartServer(w http.ResponseWriter, r *http.Request) {
	a.logger.Warn("server restart requested")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "restarting"})

	go func() {
		time.Sleep(100 * time.Millisecond)
		close(a.restartCh)
	}()
}
