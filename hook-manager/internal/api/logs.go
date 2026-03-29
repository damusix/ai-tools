package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/damusix/hook-manager/internal/logger"
)

// GetLogs handles GET /api/logs
// Reads NDJSON log file, filters by query params, returns JSON array.
// Query params: event, hook, limit (default 100), offset (default 0).
func (a *API) GetLogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filterCategory := q.Get("category")
	filterEvent := q.Get("event")
	filterHook := q.Get("hook")
	limit := 100
	offset := 0

	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	f, err := os.Open(a.logPath)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]logger.Entry{})
			return
		}
		http.Error(w, "failed to open log file: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()

	var all []logger.Entry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var entry logger.Entry
		if err := json.Unmarshal(line, &entry); err != nil {
			continue
		}

		// Backfill category for entries written before the category field existed
		if entry.Category == "" {
			entry.Category = "hook"
		}
		if filterCategory != "" && entry.Category != filterCategory {
			continue
		}
		if filterEvent != "" && entry.Event != filterEvent {
			continue
		}
		if filterHook != "" && entry.Hook != filterHook {
			continue
		}
		all = append(all, entry)
	}

	// Tail mode: return last N entries in chronological order
	if q.Get("tail") != "" {
		if len(all) > limit {
			all = all[len(all)-limit:]
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(all)
		return
	}

	// Apply offset and limit
	start := offset
	if start > len(all) {
		start = len(all)
	}
	end := start + limit
	if end > len(all) {
		end = len(all)
	}
	page := all[start:end]
	if page == nil {
		page = []logger.Entry{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

// StreamLogs handles GET /api/logs/stream
// SSE endpoint: seeks to end of log file, watches for new NDJSON lines.
func (a *API) StreamLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	f, err := os.Open(a.logPath)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, "failed to open log file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Seek to end so we only send new entries
	if f != nil {
		f.Seek(0, 2)
	}

	ctx := r.Context()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()

	var buf []byte
	for {
		select {
		case <-ctx.Done():
			if f != nil {
				f.Close()
			}
			return
		case <-ticker.C:
			// If file was not open (did not exist at start), try again
			if f == nil {
				f, err = os.Open(a.logPath)
				if err != nil {
					continue
				}
				f.Seek(0, 2)
			}

			tmp := make([]byte, 4096)
			n, _ := f.Read(tmp)
			if n > 0 {
				buf = append(buf, tmp[:n]...)
			}

			// Flush complete lines as SSE events
			for {
				idx := -1
				for i, b := range buf {
					if b == '\n' {
						idx = i
						break
					}
				}
				if idx == -1 {
					break
				}
				line := buf[:idx]
				buf = buf[idx+1:]
				if len(line) == 0 {
					continue
				}
				fmt.Fprintf(w, "data: %s\n\n", line)
				flusher.Flush()
			}
		}
	}
}
