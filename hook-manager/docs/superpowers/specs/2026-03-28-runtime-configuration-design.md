# Runtime Configuration

Configure which installed programs execute scripts by file extension.


## Problem

`DefaultRuntime()` in `executor.go` uses a hardcoded switch to map file extensions to runtime binaries. Users cannot control which runtime runs their scripts, cannot add custom extensions, and have no visibility into what's installed on their machine.


## Decisions

- **Only installed runtimes are selectable** — the UI dropdown is scoped to detected binaries, preventing misconfiguration (Decision C).
- **Everything in `config.yaml`** — detected runtimes and extension mappings live alongside server/hooks config. One file, one source of truth.
- **Custom binaries are validated** — when adding a custom extension→runtime pair, the binary must exist on the system.
- **Unavailable = warning, not auto-fix** — if a recheck finds a previously-selected runtime is gone, the mapping stays but gets an "unavailable" badge. The user fixes it manually (Decision B).
- **JS/TS selection bias** — default preference is `bun` first, `node` (v22+) fallback.


## Data Model

### New types in `internal/config/types.go`

```go
type RuntimeInfo struct {
    Name      string    `yaml:"name"`
    Version   string    `yaml:"version"`
    Path      string    `yaml:"path"`
    CheckedAt time.Time `yaml:"checked_at"`
}

type ExtMapping struct {
    Ext     string `yaml:"ext"`
    Runtime string `yaml:"runtime"`
    Custom  bool   `yaml:"custom,omitempty"`
}

type RuntimesConfig struct {
    Detected    []RuntimeInfo `yaml:"detected"`
    ExtMappings []ExtMapping  `yaml:"ext_mappings"`
}
```

### Config struct change

```go
type Config struct {
    Server   ServerConfig         `yaml:"server"`
    Runtimes RuntimesConfig       `yaml:"runtimes"`
    Hooks    map[string][]HookDef `yaml:"hooks"`
}
```

### YAML shape

```yaml
server:
    port: 47821
    log_level: info
runtimes:
    detected:
        - name: bun
          version: "1.2.5"
          path: /opt/homebrew/bin/bun
          checked_at: 2026-03-28T10:00:00Z
        - name: node
          version: "22.14.0"
          path: /opt/homebrew/bin/node
          checked_at: 2026-03-28T10:00:00Z
        - name: python3
          version: "3.12.1"
          path: /opt/homebrew/bin/python3
          checked_at: 2026-03-28T10:00:00Z
        - name: bash
          version: "5.2.37"
          path: /bin/bash
          checked_at: 2026-03-28T10:00:00Z
        - name: ruby
          version: "3.3.0"
          path: /usr/bin/ruby
          checked_at: 2026-03-28T10:00:00Z
        - name: go
          version: "1.23.0"
          path: /opt/homebrew/bin/go
          checked_at: 2026-03-28T10:00:00Z
    ext_mappings:
        - ext: .ts
          runtime: bun
        - ext: .js
          runtime: node
        - ext: .py
          runtime: python3
        - ext: .sh
          runtime: bash
        - ext: .bash
          runtime: bash
        - ext: .rb
          runtime: ruby
        - ext: .go
          runtime: go run
hooks:
    # ...existing hook definitions...
```


## Runtime Detection

### New package: `internal/runtime/`

Single file `detect.go` with a `Detect()` function.

### Known binaries to probe

| Binary | Version command | Version regex | Notes |
|--------|----------------|---------------|-------|
| `bun` | `bun --version` | `(\d+\.\d+\.\d+)` | Outputs just the version number |
| `node` | `node --version` | `v(\d+\.\d+\.\d+)` | Must be v22+; skip if below |
| `python3` | `python3 --version` | `Python (\d+\.\d+\.\d+)` | |
| `bash` | `bash --version` | `version (\d+\.\d+\.\d+)` | |
| `ruby` | `ruby --version` | `ruby (\d+\.\d+\.\d+)` | |
| `go` | `go version` | `go(\d+\.\d+\.\d+)` | |
| `perl` | `perl --version` | `v(\d+\.\d+\.\d+)` | |
| `deno` | `deno --version` | `deno (\d+\.\d+\.\d+)` | |

### Detection flow

For each binary:

1. Run `which <binary>` — if not found, skip
2. Run `<binary> <version_command>` — parse version with regex
3. For `node`: compare major version >= 22. If below, skip.
4. Record `RuntimeInfo{Name, Version, Path, CheckedAt: time.Now()}`

All probes run with a 3-second timeout per binary to avoid hanging on broken installations.

### Default extension mappings

Applied once when no `ext_mappings` exist in config (first run):

| Extension | Preference order |
|-----------|-----------------|
| `.ts` | bun > node |
| `.js` | bun > node |
| `.py` | python3 |
| `.sh` | bash |
| `.bash` | bash |
| `.rb` | ruby |
| `.go` | go run |

If the preferred runtime isn't detected, fall to the next. If none are detected for an extension, omit the mapping (scripts fall back to hashbang execution).


## Auto-Refresh

### Triggers

1. **Server startup** — detect runtimes, merge with saved config
2. **Hourly background goroutine** — `time.Ticker` in `cmd/server/main.go`, calls detect + save
3. **Manual refresh** — `POST /api/runtimes/refresh`

### Merge logic on re-detect

- Replace `detected` list entirely with fresh results
- Walk `ext_mappings`: if a mapping's `runtime` is no longer in `detected`, keep the mapping (UI will show "unavailable" badge)
- Do not add new default mappings for extensions that already have a mapping
- Save updated config to disk


## API Endpoints

### `GET /api/runtimes`

Returns current runtimes state.

```json
{
    "detected": [
        {"name": "bun", "version": "1.2.5", "path": "/opt/homebrew/bin/bun", "checked_at": "2026-03-28T10:00:00Z"},
        {"name": "node", "version": "22.14.0", "path": "/opt/homebrew/bin/node", "checked_at": "2026-03-28T10:00:00Z"}
    ],
    "ext_mappings": [
        {"ext": ".ts", "runtime": "bun", "custom": false},
        {"ext": ".js", "runtime": "node", "custom": false}
    ]
}
```

### `POST /api/runtimes/refresh`

Re-runs detection. Returns same shape as GET with updated results.

### `PUT /api/runtimes/mappings`

Bulk update extension mappings. Body is the full `ext_mappings` array. Validates:

- Each `runtime` in a non-custom mapping must exist in `detected`
- Each `runtime` in a custom mapping must pass a `which` check
- Extensions must start with `.`

Returns 200 with updated mappings or 400 with validation error.

### `POST /api/runtimes/mappings`

Add a single custom mapping. Body:

```json
{"ext": ".pl", "runtime": "perl"}
```

Validates:

- Extension not already mapped
- Binary exists (`which <runtime>` succeeds)
- Extension starts with `.`

Returns 201 with the new mapping or 400/409.

### `DELETE /api/runtimes/mappings/{ext}`

Remove a custom mapping only. Returns 400 if the mapping is not custom (built-in mappings cannot be deleted). The `{ext}` path param includes the dot (URL-encoded as `%2E` or just `.`).


## Executor Integration

### Changes to `internal/executor/`

The `Run()` function currently calls `DefaultRuntime()` as a free function. Changes:

1. `DefaultRuntime()` gains a `store *config.Store` parameter (or becomes a method on a new `RuntimeResolver` that holds the store reference)
2. Lookup flow:
    - Get `ext` from filename
    - Search `config.Runtimes.ExtMappings` for matching ext
    - If found, return the mapped runtime
    - If not found, return `""` (hashbang fallback)
3. The hardcoded switch statement is removed entirely — all mappings come from config

### Wiring

`cmd/server/main.go` already creates the `config.Store`. Pass it (or a resolver wrapping it) to the API handlers and hook handler so they can resolve runtimes from config.


## Frontend

### Settings page changes (`config_editor.html`)

New **Runtimes** card inserted between the Server and Storage cards. Matches the approved mockup:

- **Header**: purple icon, "Runtimes" title, "Checked Xm ago" timestamp, Refresh button
- **Detected runtimes**: horizontal green chips showing `name version`
- **Extension mappings table**: rows with extension code, runtime dropdown (options = detected runtimes), binary path display
- **Unavailable badge**: red pill on rows where the mapped runtime isn't in the detected list
- **Add custom extension**: dashed button at bottom, expands inline form with ext input + runtime input
- **Delete (×)**: only visible on custom mappings

### JavaScript behavior

- On page load: `GET /api/runtimes` to populate the card
- Refresh button: `POST /api/runtimes/refresh`, re-render chips and table
- Dropdown change: collect all mappings, `PUT /api/runtimes/mappings`
- Add custom: `POST /api/runtimes/mappings` with validation feedback
- Delete custom: `DELETE /api/runtimes/mappings/{ext}`
- Toast notifications for success/error (reuse existing toast system)

### Template data

The `ui.ConfigEditor()` handler passes runtimes data alongside existing `Port`, `LogLevel`, etc. The template can render initial state server-side, then JS handles interactions.


## Files to Create/Modify

### New files

- `internal/runtime/detect.go` — runtime detection logic

### Modified files

- `internal/config/types.go` — add `RuntimeInfo`, `ExtMapping`, `RuntimesConfig`, update `Config`
- `internal/config/loader.go` — no structural changes needed (YAML unmarshaling handles new fields automatically)
- `internal/executor/executor.go` — replace hardcoded `DefaultRuntime()` with config-based lookup
- `internal/api/api.go` — add runtime API handler methods
- `internal/api/config.go` — add runtime endpoints (or new file `internal/api/runtimes.go`)
- `internal/ui/ui.go` — pass runtime data to config template
- `cmd/server/main.go` — register runtime routes, start hourly refresh goroutine, run initial detection on startup
- `web/templates/config_editor.html` — add Runtimes card with JS interactions
