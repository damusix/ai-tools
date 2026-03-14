# Search Improvements — Design Spec


## Context

The ai-memory search system currently uses word-based FTS5 with no prefix wildcards, no substring matching, and no taxonomy awareness for the LLM. This creates vocabulary mismatches where searches like "auth" fail to match memories containing "authentication", and substring queries like "socket" can't find "websocket".

This spec covers dual-index search (word FTS5 + trigram FTS5), prefix wildcards, a combined search API endpoint, taxonomy injection for LLM search quality, `limit=0` support, and a dashboard search bar.


## Approach

Dual-index architecture: word-based FTS5 for precision (ranked first), trigram FTS5 for substring fallback. Both tables index the same `memories` data. The `/api/search` endpoint queries both and deduplicates results.


## Scope

**In scope:**
- Trigram FTS5 table, triggers, and backfill
- `searchMemoriesFuzzy()` function
- Prefix wildcards in `/api/recall`
- `/api/search` endpoint (combined word + trigram)
- `/api/taxonomy-summary` endpoint
- `limit=0` support across query functions and MCP tools
- Domain/category lists in startup context
- `PreToolUse` hook for `search_memories`
- Dashboard search bar UI

**Out of scope:**
- Clickable domain/category filter icons in the dashboard (covered in `docs/handoff-ui-enhancements.md`)
- Branding changes
- Settings UX polish
- URL-based routing


## Files to Modify

| File | Changes |
|------|---------|
| `src/db.ts` | Trigram table + triggers + backfill in `initSchema()`, `searchMemoriesFuzzy()`, conditional `LIMIT` in `searchMemories()`, `listMemories()`, `searchObservations()` |
| `src/app.ts` | Prefix wildcards in `/api/recall`, new `/api/search`, new `/api/taxonomy-summary` |
| `src/tools.ts` | `list_memories` default limit 50→500, document `limit=0` |
| `src/context.ts` | Add "Available Domains" and "Available Categories" sections to `buildStartupContext()` |
| `hooks/hooks.json` | Add `PreToolUse` matcher for `mcp__ai-memory__search_memories` |
| `hooks/scripts/search-context.sh` | New script: fetch taxonomy summary, return as `additionalContext` |
| `src/ui/App.tsx` | Search bar input, search results signal, flat results view |
| `test/` | Tests for trigram search, prefix wildcards, limit=0, `/api/search`, `/api/taxonomy-summary` |

---


## Section 1: Backend


### 1a. Trigram FTS5 Table

Add to `initSchema()` in `src/db.ts` after the existing FTS triggers (after line 136):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
    USING fts5(content, tags, content=memories, content_rowid=id, tokenize="trigram");
```

Uses content-sync mode (`content=memories, content_rowid=id`) matching the existing `memories_fts` table at line 111. This avoids doubling storage by reading content from the `memories` table on retrieval rather than storing a separate copy. SQLite 3.34.0+ required for the trigram tokenizer. The bundled better-sqlite3 ships SQLite 3.45+, so this is safe.

Three sync triggers following the existing pattern at lines 127-136:

```sql
CREATE TRIGGER IF NOT EXISTS memories_trigram_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags)
        VALUES ('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags)
        VALUES ('delete', old.id, old.content, old.tags);
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
```

Idempotent backfill at the end of `initSchema()`, wrapped in a transaction to prevent trigger-based duplicates during concurrent writes:

```typescript
const trigramCount = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
if (trigramCount < memoryCount) {
    db.transaction(() => {
        db.exec('DELETE FROM memories_trigram');
        db.exec(
            'INSERT INTO memories_trigram(rowid, content, tags) SELECT id, content, tags FROM memories',
        );
    })();
}
```


### 1b. searchMemoriesFuzzy()

New function in `src/db.ts` with the same signature as `searchMemories()`:

```typescript
export function searchMemoriesFuzzy(
    query: string,
    projectPath?: string,
    tag?: string,
    category?: string,
    limit = 20,
    domain?: string,
): any[]
```

Queries `memories_trigram` instead of `memories_fts`. Same filter logic (projectPath, tag LIKE, category, domain). Orders by FTS5 `rank` ascending (FTS5 rank values are negative — more negative = better match), then `importance DESC` as tiebreaker: `ORDER BY rank, m.importance DESC`. This is a deliberate difference from `searchMemories()` which orders by `importance DESC, created_at DESC` — for trigram fallback results, relevance ranking is more useful than importance since matches are approximate. Applies conditional `LIMIT` (see 1f).

**Important:** The FTS5 trigram tokenizer does NOT support the `*` prefix operator. The query passed to `searchMemoriesFuzzy()` must use raw words without `*` suffix — the trigram tokenizer breaks input into 3-character grams and matches substrings natively without needing wildcards. The `/api/search` endpoint (1d) must strip `*` from query terms before passing them to this function.


### 1c. Prefix Wildcards in /api/recall

In `src/app.ts` at line 316, change:

```typescript
const ftsQuery = unique.join(' OR ');
```

to:

```typescript
const filtered = unique.filter(w => w.length >= 2);
if (filtered.length === 0) return c.json({ memories: [] });
const ftsQuery = filtered.map(w => w + '*').join(' OR ');
```

FTS5 natively supports the `*` prefix operator. This makes "auth" match "authentication", "authorize", etc. The `w.length >= 2` filter prevents single-character wildcards (e.g., `a*`) which would match too broadly and cause slow queries. The explicit empty-check guard prevents passing an empty string to FTS5 MATCH, which would throw a syntax error.


### 1d. /api/search Endpoint

New `GET /api/search` in `src/app.ts`:

**Query params:** `q` (required), `project`, `domain`, `category`, `tag`, `limit` (default 20)

**Logic:**
1. Return `{ results: [] }` if `q` is empty or missing
2. Extract words from `q` (same word extraction + stop word filtering + `length >= 2` as `/api/recall`)
3. Build prefix-wildcard query: `words.map(w => w + '*').join(' OR ')` — for word-based FTS
4. Query word-based `searchMemories()` with the wildcard query — these are the precision results
5. If result count < limit, build a raw query (no `*` suffix): `words.join(' OR ')` — trigram tokenizer does not support `*`
6. Query `searchMemoriesFuzzy()` with the raw query for remaining slots
7. Deduplicate by memory `id` using a `Set<number>` — word-based results take priority
8. Return `{ results: [...] }`

**Error handling:** Wrap in try/catch following the `/api/recall` pattern. Return `{ results: [] }` on FTS5 query syntax errors or other failures. Validate `limit` — treat negative values as the default (20).


### 1e. /api/taxonomy-summary Endpoint

New `GET /api/taxonomy-summary` in `src/app.ts`:

**Query params:** `project` (optional)

**Logic:**
1. Call existing `listDomains(project)`, `listCategories(project)`, `listTags(project)`
2. Filter to items with `count > 0`
3. Limit tags to top 20 by count
4. Return JSON with a `summary` text field for hook consumption:
    ```json
    {
        "summary": "Domains: frontend(12), backend(8), ...\nCategories: fact(20), solution(15), ...\nTop tags: typescript(5), api(3), ..."
    }
    ```


### 1f. limit=0 Support

In three functions in `src/db.ts`:
- `searchMemories()` (line 389)
- `listMemories()` (line 424)
- `searchObservations()` (line 273)

Change from unconditionally appending `LIMIT ?` to:

```typescript
if (limit > 0) {
    sql += ' LIMIT ?';
    params.push(limit);
}
```

In `src/tools.ts`:
- `list_memories` tool: change default from `z.number().default(50)` to `z.number().default(500)`
- Add `.describe('Result limit. 0 = no limit.')` to limit fields on both `search_memories` and `list_memories`

---


## Section 2: Hooks & Context Injection


### 2a. Domains + Categories in Startup Context

In `src/context.ts`, `buildStartupContext()`, after the tags section (after line 99):

```typescript
import { listDomainsRaw, listCategoriesRaw } from './db.js';

// After tags section, before the tip:
const allDomains = listDomainsRaw();
if (allDomains.length > 0) {
    lines.push(`\n## Available Domains\n${allDomains.map(d => d.name).join(', ')}`);
}

const allCategories = listCategoriesRaw();
if (allCategories.length > 0) {
    lines.push(
        `\n## Available Categories\n${allCategories.map(c => `${c.name}: ${c.description}`).join('\n')}`,
    );
}
```

This gives the LLM vocabulary for constructing precise `search_memories` calls with correct domain/category filter values.

**Note:** The running server currently emits these sections (visible in session startup context), but the source code in `context.ts` does not contain this logic — the running binary appears to be from a stale build that predates the source being cleaned up. Adding this code ensures the behavior persists after the next `pnpm build`.


### 2b. PreToolUse Hook for search_memories

Add as a **second element** in the `PreToolUse` array in `hooks/hooks.json` (the first element is the existing `save_memory` dedup-check matcher — do not replace it):

```json
{
    "matcher": "mcp__ai-memory__search_memories",
    "hooks": [
        {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/search-context.sh\"",
            "timeout": 3
        }
    ]
}
```

This is necessary because `/clear` wipes conversation context without re-firing `SessionStart`. Without this hook, the LLM loses taxonomy awareness mid-session and constructs imprecise search queries.


### 2c. search-context.sh

New script at `hooks/scripts/search-context.sh`. Follows existing hook patterns (port parsing from YAML config, curl API call, JSON output via python3):

1. Parse port from `~/.ai-memory/config.yaml` (same logic as `startup.sh` lines 4-11)
2. Call `GET http://localhost:$PORT/api/taxonomy-summary?project=$PWD`
3. Output: `{"additionalContext": "[ai-memory] Available taxonomy for filtering:\n<summary>"}`
4. Silent failure (exit 0, no output) on network error

---


## Section 3: Frontend


### 3a. Search Bar

Add a text input at the top of the `<main>` memory panel in `src/ui/App.tsx`.

- Styled consistently with existing inputs: `bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm`
- Submit on Enter
- Calls `GET /api/search?q=...&project=...` (using current project from state)
- Clear button (x icon) appears when search is active
- Search input placeholder: `"Search memories..."`


### 3b. Search Results View

New signals in `src/ui/App.tsx`:

```typescript
const [searchQuery, setSearchQuery] = createSignal('');
const [searchResults, setSearchResults] = createSignal<Memory[] | null>(null);
```

When `searchResults()` is not null:
- Render a flat list of `MemoryCard` components instead of the normal domain-grouped view
- Show a results header: `"N results for 'query'"`
- Clear search resets `searchResults` to null and restores the grouped view

When `searchResults()` is null:
- Normal domain-grouped rendering (existing behavior, unchanged)


### 3c. Scope Boundary

The clickable domain/category filter icons from the original spec (Task 3) are NOT part of this work. They are covered in `docs/handoff-ui-enhancements.md` as a separate feature.

---


## Execution Phases

**Phase 1 (independent, parallel):**
- 1a: Trigram table + triggers + backfill
- 1c: Prefix wildcards in `/api/recall`
- 1e: `/api/taxonomy-summary` endpoint
- 1f: `limit=0` support
- 2a: Domains/categories in startup context

**Phase 2 (depends on Phase 1):**
- 1b: `searchMemoriesFuzzy()` (depends on 1a)
- 2b + 2c: PreToolUse hook + script (depends on 1e)

**Phase 3 (depends on Phase 2):**
- 1d: `/api/search` endpoint (depends on 1b)

**Phase 4 (depends on Phase 3):**
- 3a + 3b: Search bar UI (depends on 1d)


## Verification

1. **Tests:** `pnpm vitest run test/` — all pass including new tests for:
    - Trigram table creation and trigger sync
    - `searchMemoriesFuzzy()` returns substring matches (e.g., "socket" matches "websocket")
    - Prefix wildcards in `/api/recall` (e.g., "auth" matches "authentication")
    - `limit=0` returns all results
    - `/api/search` merges word + trigram results without duplicates
    - `/api/taxonomy-summary` returns domain/category/tag summaries
2. **Build:** `pnpm build` succeeds with no errors
3. **Dashboard:** Open http://localhost:24636
    - Search bar appears at top of memory panel
    - Typing a query and pressing Enter shows results
    - Clear button restores grouped view
4. **MCP:** Test `search_memories` via MCP — verify PreToolUse hook injects taxonomy context
5. **Context:** Start new session — verify "Available Domains" and "Available Categories" sections appear in startup context
