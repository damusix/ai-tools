# Data Model


All state is stored in a single SQLite database at `~/.ai-memory/memory.db`. The database uses WAL journaling, `NORMAL` synchronous mode, and enforces foreign keys.


## Tables


### projects

Tracks each distinct project directory that ai-memory has seen. A special `_global` row is seeded on first init for cross-project memories.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal identifier |
| path | TEXT | UNIQUE NOT NULL | Absolute path to the project directory, or `_global` |
| name | TEXT | NOT NULL | Display name, derived from the last path segment |
| icon | TEXT | NOT NULL, default | Font Awesome icon class (dashboard) |
| description | TEXT | NOT NULL, default '' | Short project description |
| summary | TEXT | NOT NULL, default '' | Cached LLM synthesis of memories (large-context path) |
| summary_hash | TEXT | NOT NULL, default '' | Memory-set hash for summary invalidation |
| summary_snapshot | TEXT | NOT NULL, default '' | Per-memory content hashes at last summary |
| summary_incremental_count | INTEGER | NOT NULL, default 0 | Incremental summary cycle counter |
| architecture_facts | TEXT | NOT NULL, default '' | JSON: tree text, raw manifest snippets, CI filenames, signals |
| architecture_full | TEXT | NOT NULL, default '' | Haiku prose interpretation of facts |
| architecture_summary | TEXT | NOT NULL, default '' | Short summary injected first in session context; used in cleanup |
| architecture_fingerprint | TEXT | NOT NULL, default '' | SHA-256 of deterministic facts subset for rescan gating |
| architecture_scanned_at | TEXT | NOT NULL, default '' | ISO 8601 of last successful architecture scan |
| created_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of first encounter |


### observations

Atomic facts extracted from conversation turns. Each row is a single piece of information — a decision, pattern, preference, or fact — waiting to be synthesized into a memory.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal identifier |
| project_id | INTEGER | NOT NULL, FK → projects(id) | Which project this observation belongs to |
| content | TEXT | NOT NULL | The observation text (1-2 sentences) |
| source_summary | TEXT | NOT NULL | Brief description of where this came from (e.g., "discussion about auth flow") |
| processed | INTEGER | NOT NULL, default 0 | `0` = awaiting synthesis, `1` = already synthesized into a memory |
| skipped_count | INTEGER | NOT NULL, default 0 | Strike counter: incremented each time synthesis ignores this observation. Deleted at >= 3. Added via migration. |
| created_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of extraction |


### memories

Synthesized, categorized knowledge derived from observations. These are what get injected into session context.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal identifier |
| project_id | INTEGER | NOT NULL, FK → projects(id) | Which project this memory belongs to |
| content | TEXT | NOT NULL | The memory text (1-3 sentences) |
| tags | TEXT | NOT NULL, default '' | Comma-separated freeform labels for search (e.g., `routing,react,auth`) |
| category | TEXT | NOT NULL, default 'fact' | One of: `decision`, `pattern`, `preference`, `fact`, `solution`. CHECK constraint enforced. |
| importance | INTEGER | NOT NULL, default 3 | 1-5 scale. CHECK constraint: BETWEEN 1 AND 5. Higher = more likely to be injected into context. |
| observation_ids | TEXT | NOT NULL, default '' | Comma-separated observation IDs that contributed to this memory. Audit trail only. |
| domain | TEXT | FK → domains(name), nullable | Development domain this memory belongs to. Added via migration. |
| created_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of creation |
| updated_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of last update |

**Category meanings:**

| Category | When to use |
|----------|-------------|
| decision | A choice was made between options, with rationale |
| pattern | A recurring approach was established for the codebase |
| preference | A user style or workflow preference was expressed |
| fact | A truth about the system or environment was discovered |
| solution | A working fix for a non-obvious problem was found |

**Importance scale:**

| Value | Label | Meaning |
|-------|-------|---------|
| 1 | Trivia | Nice to know, no impact if forgotten |
| 2 | Useful | Helpful context, minor inconvenience if forgotten |
| 3 | Normal | Standard knowledge, default for most memories |
| 4 | Important | Confusion or wasted effort if forgotten |
| 5 | Critical | Bugs or hours wasted if forgotten |


### domains

Predefined development domains used to classify memories. 19 rows seeded on init.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| name | TEXT | PRIMARY KEY | Domain identifier (e.g., `frontend`, `backend`, `data`) |
| description | TEXT | NOT NULL, default '' | Human-readable description of what the domain covers |

**Seeded domains:**

| Name | Description |
|------|-------------|
| frontend | UI components, routing, state management, browser APIs, DOM |
| styling | CSS, themes, layouts, responsive design, animations |
| backend | Server logic, business rules, middleware, request handling |
| api | API design, REST/GraphQL contracts, versioning, endpoints |
| data | Database, schemas, queries, migrations, ORMs, caching |
| auth | Authentication, authorization, sessions, tokens, RBAC |
| testing | Test frameworks, strategies, fixtures, mocking, coverage |
| performance | Optimization, caching, profiling, lazy loading, bundle size |
| security | Vulnerabilities, hardening, input validation, OWASP |
| accessibility | a11y, WCAG, screen readers, keyboard navigation |
| infrastructure | Deployment, hosting, cloud, Docker, serverless |
| devops | CI/CD, pipelines, environments, release process |
| monitoring | Logging, alerting, observability, error tracking |
| tooling | Build tools, linters, formatters, bundlers, dev environment |
| git | Version control, branching strategy, hooks, workflows |
| dependencies | Package management, upgrades, compatibility, vendoring |
| architecture | System design, patterns, module structure, conventions |
| integrations | Third-party services, SDKs, webhooks, external APIs |
| general | Cross-cutting concerns that don't fit elsewhere |


### observation_queue

Async queue for conversation payloads waiting to have observations extracted by the LLM worker.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal identifier |
| project_id | INTEGER | NOT NULL, FK → projects(id) | Which project this conversation came from |
| payload | TEXT | NOT NULL | JSON-serialized conversation data from the Stop hook |
| status | TEXT | NOT NULL, default 'pending' | Queue state: `pending` → `processing` → `done` or `failed` |
| created_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of enqueue |


### memory_queue

Async queue for triggering memory synthesis runs. Created when unprocessed observations reach the threshold (10).

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Internal identifier |
| project_id | INTEGER | NOT NULL, FK → projects(id) | Which project to synthesize memories for |
| status | TEXT | NOT NULL, default 'pending' | Queue state: `pending` → `processing` → `done` or `failed` |
| created_at | TEXT | NOT NULL, default now | ISO 8601 timestamp of enqueue |


## Full-Text Search


### observations_fts

FTS5 virtual table backed by `observations`. Indexes the `content` column.

| Indexed column | Source |
|----------------|--------|
| content | observations.content |

**Sync triggers:** `observations_ai` (insert), `observations_ad` (delete), `observations_au` (update). The update trigger deletes the old entry and inserts the new one to keep the index consistent.


### memories_fts

FTS5 virtual table backed by `memories`. Indexes `content` and `tags`.

| Indexed column | Source |
|----------------|--------|
| content | memories.content |
| tags | memories.tags |

**Sync triggers:** `memories_ai` (insert), `memories_ad` (delete), `memories_au` (update). Same delete-then-insert pattern on update.

**Query syntax** (SQLite FTS5):
- `"exact phrase"` — phrase match
- `term*` — prefix match
- `term1 OR term2` — disjunction
- `term1 AND term2` — conjunction (default behavior when space-separated)
- `NOT term` — exclusion


## Indexes

| Index | Table | Column(s) | Purpose |
|-------|-------|-----------|---------|
| idx_observations_project | observations | project_id | Filter observations by project |
| idx_observations_processed | observations | processed | Find unprocessed observations for synthesis |
| idx_memories_project | memories | project_id | Filter memories by project |
| idx_memories_importance | memories | importance DESC | Sort memories by importance for context injection |
| idx_memories_domain | memories | domain | Filter memories by domain |
| idx_obs_queue_status | observation_queue | status | Dequeue pending observation jobs |
| idx_mem_queue_status | memory_queue | status | Dequeue pending synthesis jobs |


## Migrations

Migrations are idempotent and run on every `initDb()` call. They use `PRAGMA table_info` to check if a column exists before issuing `ALTER TABLE`.

| Migration | Column added | Table | Purpose |
|-----------|-------------|-------|---------|
| domain | domain TEXT FK → domains(name) | memories | Classify memories by development domain |
| skipped_count | skipped_count INTEGER default 0 | observations | Track how many synthesis runs ignored this observation |
| architecture_* | architecture_facts, architecture_full, architecture_summary, architecture_fingerprint, architecture_scanned_at | projects | Filesystem snapshot + LLM layers for session context and cleanup |


## Staleness Policies

Two automatic cleanup policies keep the database from growing unbounded:

**TTL for processed observations:** Observations with `processed = 1` and `created_at` older than 14 days are deleted on every worker poll cycle. Their value has been absorbed into memories.

**Strike counter for ignored observations:** After each synthesis run, observations that were fed to the LLM but not referenced in any create or update get `skipped_count` incremented. At `skipped_count >= 3`, the observation is auto-deleted. This removes dead-weight observations that the LLM has repeatedly determined are not worth synthesizing.


## Entity Relationship Diagram

```
projects 1──∞ observations
    │              │
    │              └── observations_fts (FTS5, auto-synced)
    │
    ├──∞ memories
    │       │
    │       ├── memories_fts (FTS5, auto-synced)
    │       └──→ domains (FK: domain → name)
    │
    ├──∞ observation_queue
    └──∞ memory_queue

domains (standalone lookup, seeded on init)
```
