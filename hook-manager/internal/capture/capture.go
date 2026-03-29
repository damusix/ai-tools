package capture

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Event represents a captured Claude Code hook event.
type Event struct {
	ID        uint64         `json:"id"`
	Timestamp time.Time      `json:"timestamp"`
	EventType string         `json:"event_type"`
	Project   string         `json:"project"`
	SessionID string         `json:"session_id,omitempty"`
	Payload   map[string]any `json:"payload"`
}

// ProjectInfo summarizes captured events for a project.
type ProjectInfo struct {
	Path       string    `json:"path"`
	EventCount int       `json:"event_count"`
	LastSeen   time.Time `json:"last_seen"`
}

// Buffer stores captured events in-memory with pub/sub for live streaming.
type Buffer struct {
	mu      sync.RWMutex
	events  []Event
	maxSize int
	nextID  atomic.Uint64

	subMu     sync.Mutex
	subs      map[uint64]chan Event
	subNextID uint64
}

// NewBuffer creates a capture buffer that holds up to maxSize events.
func NewBuffer(maxSize int) *Buffer {
	return &Buffer{
		events:  make([]Event, 0, maxSize),
		maxSize: maxSize,
		subs:    make(map[uint64]chan Event),
	}
}

// Record stores an event and notifies all subscribers.
func (b *Buffer) Record(eventType, project, sessionID string, payload map[string]any) Event {
	e := Event{
		ID:        b.nextID.Add(1),
		Timestamp: time.Now().UTC(),
		EventType: eventType,
		Project:   project,
		SessionID: sessionID,
		Payload:   payload,
	}

	b.mu.Lock()
	if len(b.events) >= b.maxSize {
		b.events = b.events[1:]
	}
	b.events = append(b.events, e)
	b.mu.Unlock()

	b.subMu.Lock()
	for _, ch := range b.subs {
		select {
		case ch <- e:
		default: // drop if subscriber is slow
		}
	}
	b.subMu.Unlock()

	return e
}

// Events returns captured events, optionally filtered by project.
// Results are in chronological order (oldest first).
func (b *Buffer) Events(project string, limit int) []Event {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if limit <= 0 {
		limit = 200
	}

	var result []Event
	for i := len(b.events) - 1; i >= 0; i-- {
		if project != "" && b.events[i].Project != project {
			continue
		}
		result = append(result, b.events[i])
		if len(result) >= limit {
			break
		}
	}

	// Reverse for chronological order
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result
}

// Projects returns a summary of all projects with captured events.
func (b *Buffer) Projects() []ProjectInfo {
	b.mu.RLock()
	defer b.mu.RUnlock()

	pm := make(map[string]*ProjectInfo)
	for _, e := range b.events {
		p, ok := pm[e.Project]
		if !ok {
			p = &ProjectInfo{Path: e.Project}
			pm[e.Project] = p
		}
		p.EventCount++
		if e.Timestamp.After(p.LastSeen) {
			p.LastSeen = e.Timestamp
		}
	}

	result := make([]ProjectInfo, 0, len(pm))
	for _, p := range pm {
		result = append(result, *p)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastSeen.After(result[j].LastSeen)
	})
	return result
}

// Subscribe returns a channel that receives new events as they are captured.
func (b *Buffer) Subscribe() (uint64, chan Event) {
	ch := make(chan Event, 64)
	b.subMu.Lock()
	b.subNextID++
	id := b.subNextID
	b.subs[id] = ch
	b.subMu.Unlock()
	return id, ch
}

// Unsubscribe removes a subscriber and closes its channel.
func (b *Buffer) Unsubscribe(id uint64) {
	b.subMu.Lock()
	if ch, ok := b.subs[id]; ok {
		close(ch)
		delete(b.subs, id)
	}
	b.subMu.Unlock()
}

// Clear removes all captured events.
func (b *Buffer) Clear() {
	b.mu.Lock()
	b.events = b.events[:0]
	b.mu.Unlock()
}
