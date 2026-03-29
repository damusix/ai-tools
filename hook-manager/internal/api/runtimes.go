package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/damusix/hook-manager/internal/config"
	"github.com/damusix/hook-manager/internal/runtime"
)

// GetRuntimes handles GET /api/runtimes
// Returns detected runtimes and extension mappings.
func (a *API) GetRuntimes(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Runtimes)
}

// RefreshRuntimes handles POST /api/runtimes/refresh
// Re-runs runtime detection and saves results.
func (a *API) RefreshRuntimes(w http.ResponseWriter, r *http.Request) {
	cfg := a.store.Get()

	detected := runtime.Detect()
	cfg.Runtimes.Detected = detected

	// On first run (no mappings yet), generate defaults
	if len(cfg.Runtimes.ExtMappings) == 0 {
		names := runtime.DetectedNames(detected)
		cfg.Runtimes.ExtMappings = runtime.DefaultExtMappings(names)
	}

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Runtimes)
}

// PutMappings handles PUT /api/runtimes/mappings
// Bulk-updates extension mappings.
func (a *API) PutMappings(w http.ResponseWriter, r *http.Request) {
	var mappings []config.ExtMapping
	if err := json.NewDecoder(r.Body).Decode(&mappings); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg := a.store.Get()

	// Build set of detected runtime names
	detectedSet := make(map[string]bool, len(cfg.Runtimes.Detected))
	for _, d := range cfg.Runtimes.Detected {
		detectedSet[d.Name] = true
	}

	// Validate each mapping
	for _, m := range mappings {
		if !strings.HasPrefix(m.Ext, ".") {
			http.Error(w, "extension must start with '.': "+m.Ext, http.StatusBadRequest)
			return
		}
		if m.Custom {
			// Custom: validate binary exists on system
			if _, err := runtime.ProbeCustom(m.Runtime); err != nil {
				http.Error(w, "custom runtime not found: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
		// Non-custom: allow even if not in detected (shows "unavailable" badge)
	}

	cfg.Runtimes.ExtMappings = mappings

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mappings)
}

// PostMapping handles POST /api/runtimes/mappings
// Adds a single custom extension mapping.
func (a *API) PostMapping(w http.ResponseWriter, r *http.Request) {
	var m config.ExtMapping
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	if !strings.HasPrefix(m.Ext, ".") {
		http.Error(w, "extension must start with '.'", http.StatusBadRequest)
		return
	}

	// Check for duplicate
	cfg := a.store.Get()
	for _, existing := range cfg.Runtimes.ExtMappings {
		if existing.Ext == m.Ext {
			http.Error(w, "extension already mapped: "+m.Ext, http.StatusConflict)
			return
		}
	}

	// Validate binary exists
	if _, err := runtime.ProbeCustom(m.Runtime); err != nil {
		http.Error(w, "runtime not found: "+err.Error(), http.StatusBadRequest)
		return
	}

	m.Custom = true
	cfg.Runtimes.ExtMappings = append(cfg.Runtimes.ExtMappings, m)

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(m)
}

// DeleteMapping handles DELETE /api/runtimes/mappings/{ext}
// Removes a custom mapping only.
func (a *API) DeleteMapping(w http.ResponseWriter, r *http.Request) {
	ext := strings.TrimPrefix(r.URL.Path, "/api/runtimes/mappings/")
	if ext == "" {
		http.Error(w, "extension is required", http.StatusBadRequest)
		return
	}
	// Ensure dot prefix (URL might have it already or not)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	cfg := a.store.Get()
	newMappings := cfg.Runtimes.ExtMappings[:0:0]
	found := false
	for _, m := range cfg.Runtimes.ExtMappings {
		if m.Ext == ext {
			if !m.Custom {
				http.Error(w, "cannot delete built-in mapping: "+ext, http.StatusBadRequest)
				return
			}
			found = true
			continue
		}
		newMappings = append(newMappings, m)
	}

	if !found {
		http.Error(w, "mapping not found: "+ext, http.StatusNotFound)
		return
	}

	cfg.Runtimes.ExtMappings = newMappings

	if err := a.store.Save(cfg); err != nil {
		http.Error(w, "failed to save config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
