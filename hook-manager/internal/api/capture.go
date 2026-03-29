package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/damusix/hook-manager/internal/capture"
)

// GetCaptureEvents handles GET /api/capture/events
// Returns captured events, optionally filtered by project.
func (a *API) GetCaptureEvents(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	limit := 500
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	events := a.capture.Events(project, limit)
	if events == nil {
		events = []capture.Event{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// GetCaptureProjects handles GET /api/capture/projects
// Returns a summary of all projects with captured events.
func (a *API) GetCaptureProjects(w http.ResponseWriter, r *http.Request) {
	projects := a.capture.Projects()
	if projects == nil {
		projects = []capture.ProjectInfo{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(projects)
}

// StreamCapture handles GET /api/capture/stream
// SSE endpoint that streams captured events in real-time.
func (a *API) StreamCapture(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	id, ch := a.capture.Subscribe()
	defer a.capture.Unsubscribe(id)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(e)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// ClearCapture handles DELETE /api/capture/events
// Removes all captured events from the buffer.
func (a *API) ClearCapture(w http.ResponseWriter, r *http.Request) {
	a.capture.Clear()
	w.WriteHeader(http.StatusNoContent)
}
