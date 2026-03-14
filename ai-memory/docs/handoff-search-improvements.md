# Handoff: Search Improvements


## Goal

Replace the current word-only FTS5 search with a dual-index architecture that combines word-based FTS5 (precision) with trigram FTS5 (substring/fuzzy fallback). Also add prefix wildcards to the recall endpoint and support `limit=0` for unlimited results.


## Status: NOT STARTED

No code has been written for any of these features. The design is fully spec'd in:
- Spec: `docs/superpowers/specs/2026-03-12-feature-enhancements-branding-design.md`
- Plan: `docs/superpowers/plans/2026-03-12-feature-enhancements-branding.md` (Tasks 3-5)


## Current Implementation

### FTS tables (word-based only)

`src/db.ts:108-112` — Two FTS5 virtual tables with default word tokenizer:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts
    USING fts5(content, content=observations, content_rowid=id);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(content, tags, content=memories, content_rowid=id);
```

### FTS sync triggers

`src/db.ts:114-136` — Insert/delete/update triggers keep both FTS tables in sync with their base tables. Pattern to replicate for the trigram table.

### searchMemories()

`src/db.ts:355-393` — Main search function. Accepts `query`, `projectPath`, `tag`, `category`, `limit` (default 20), `domain`. Joins `memories` to `memories_fts` via rowid, always appends `LIMIT ?`.

### searchObservations()

`src/db.ts:258-277` — Simpler version. Only filters by `projectPath`. Always appends `LIMIT ?`.

### listMemories()

`src/db.ts:395-429` — Non-FTS listing with filters. Also always appends `LIMIT ?`.

### /api/recall endpoint

`src/app.ts:287-322` — Used by the `UserPromptSubmit` hook to surface memories before the LLM responds:
- Stop words hash: `src/app.ts:287-299`
- Extracts up to 5 unique non-stop words from prompt
- Joins with `OR` (no prefix wildcards): `src/app.ts:316`
- Returns max 3 results: `src/app.ts:317`

### search_memories MCP tool

`src/tools.ts:52-75` — Description claims FTS5 syntax support including `*` for prefix, but the code passes the query as-is to `searchMemories()`. Only uses `tags[0]` despite accepting an array.

### Context injection

`src/context.ts:1-117` — `buildStartupContext()` injects domain-grouped memories at session start with a token budget. Does NOT inject available domains or categories lists (the LLM discovers taxonomy only from memory content).

### Hooks

`hooks/hooks.json` — Current hooks:
- `SessionStart` → `startup.sh` (health check, port sync)
- `Stop` → `stop.sh` (enqueue turn)
- `UserPromptSubmit` → `recall.sh` (keyword search)
- `PreToolUse[save_memory]` → `dedup-check.sh`
- `SessionEnd` → `session-end.sh`

No `PreToolUse` hook for `search_memories` exists.


## What Needs to Be Built

### 1. Trigram FTS5 table + triggers

Add to `initSchema()` in `src/db.ts` after line 136:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
    USING fts5(content, tags, tokenize="trigram");
```

Add three sync triggers (`memories_trigram_ai`, `memories_trigram_ad`, `memories_trigram_au`) matching the pattern at lines 127-136.

Add a one-time backfill at the end of `initSchema()`:
```sql
-- Only if trigram table is empty but memories exist
INSERT INTO memories_trigram(rowid, content, tags)
    SELECT id, content, tags FROM memories;
```

### 2. searchMemoriesFuzzy() function

New function in `src/db.ts` that queries `memories_trigram` using the same filter pattern as `searchMemories()` but against the trigram table. Returns results ranked by FTS5 `rank`.

### 3. /api/search endpoint

New endpoint in `src/app.ts` that:
1. Queries word-based FTS first (higher precision)
2. Queries trigram FTS as fallback
3. Merges and deduplicates results (word-based ranked first)
4. Returns combined results

### 4. /api/taxonomy-summary endpoint

New endpoint in `src/app.ts` that returns domain and category summaries for UI filtering. Uses existing `listDomains()` (`src/db.ts:465-484`) and `listCategories()`.

### 5. Prefix wildcards in /api/recall

`src/app.ts:316` — Change from:
```typescript
const ftsQuery = unique.join(' OR ');
```
to:
```typescript
const ftsQuery = unique.map(w => `${w}*`).join(' OR ');
```

This lets "auth" match "authentication", "authorize", etc.

### 6. limit=0 for unlimited results

In `searchMemories()` (`src/db.ts:389`), `listMemories()` (`src/db.ts:424`), and `searchObservations()` (`src/db.ts:273`): conditionally append `LIMIT ?` only when `limit > 0`.

Update MCP tool schemas in `src/tools.ts` to document `0 = unlimited`.

### 7. Context injection: taxonomy awareness (optional)

Add available domains and categories lists to `buildStartupContext()` output in `src/context.ts` so the LLM can make informed search filter decisions. Currently the LLM has to guess domain/category names.

### 8. PreToolUse hook for search_memories (optional)

Add a `PreToolUse` matcher for `mcp__ai-memory__search_memories` in `hooks/hooks.json` that refreshes taxonomy context before each search call. This is important because `/clear` wipes conversation context without re-firing `SessionStart`.


## Key Files

| File | What to change |
|------|---------------|
| `src/db.ts` | Trigram table, triggers, backfill, fuzzy search fn, limit=0 |
| `src/app.ts` | /api/search, /api/taxonomy-summary, prefix wildcards in recall |
| `src/tools.ts` | Update limit descriptions, potentially add search tool |
| `src/context.ts` | Inject taxonomy lists into startup context |
| `hooks/hooks.json` | Add PreToolUse matcher for search_memories |
| `hooks/scripts/` | New search-context.sh script |
| `test/` | Tests for trigram search, prefix wildcards, limit=0 |


## Testing

Run: `pnpm vitest run test/`

Existing search tests are in `test/` — add new tests for:
- Trigram table creation and trigger sync
- `searchMemoriesFuzzy()` returns substring matches
- Prefix wildcard in recall (e.g., "auth" matches "authentication")
- `limit=0` returns all results
- `/api/search` merges word + trigram results without duplicates
