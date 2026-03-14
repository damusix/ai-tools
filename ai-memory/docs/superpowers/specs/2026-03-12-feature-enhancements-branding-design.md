# Feature Enhancements + Branding — Implementation Plan

## Context

The ai-memory dashboard has 4 feature gaps identified by the user: domain headers lack memory counts, there's no way to filter/retrieve all memories per domain or type, FTS search has poor recall and no UI, and the branding is minimal (just a brain icon + text). This plan addresses all four in a single batch, ordered by dependency.

## Features

1. **Stats per domain** — Add memory count to domain header bars
2. **Retrieve all per domain/type** — Clickable domain/category filters in UI + raise MCP limits
3. **FTS search improvement** — Prefix wildcards + trigram index + search bar UI + PreToolUse hook for taxonomy injection + expanded SessionStart context
4. **Branding** — Blue brain + yellow sparkles stacked logo + favicon

---

## Files to Modify

| File | Tasks |
|------|-------|
| `src/ui/App.tsx` | T1 (domain stats), T3 (filters), T7 (search bar), T11 (logo) |
| `src/db.ts` | T2 (limit=0 support), T5 (trigram table), T6 (fuzzy search) |
| `src/app.ts` | T4 (prefix wildcards), T6 (search endpoint), T8 (taxonomy summary) |
| `src/tools.ts` | T2 (raise list_memories default) |
| `src/context.ts` | T10 (add domains/categories to context) |
| `hooks/hooks.json` | T9 (add search_memories PreToolUse) |
| `hooks/scripts/search-context.sh` | T9 (new script) |
| `src/ui/components/BrandLogo.tsx` | T11 (new component) |
| `src/ui/index.html` | T12 (favicon) |
| `test/db.test.ts` | T2, T5, T6 |
| `test/api.test.ts` | T6, T8 |

---

## Task 1: Stats per domain (frontend)

**File:** `src/ui/App.tsx` ~line 544

Add memory count after domain name in domain header button. Count is derived from `domGroup.categories.reduce((n, cat) => n + cat.memories.length, 0)` — same pattern already used for project-level counts on line 511.

Add a `<span>` after `{domGroup.domain}`:
```tsx
<span class="text-neutral-600 font-normal">
    ({domGroup.categories.reduce((n, cat) => n + cat.memories.length, 0)})
</span>
```

---

## Task 2: MCP limit change (backend)

**Files:** `src/db.ts`, `src/tools.ts`

In `db.ts` `listMemories()` (~line 416): Support `limit <= 0` as "no limit" — conditionally append `LIMIT ?` only when `limit > 0`. Same for `searchMemories()` (~line 389).

In `tools.ts` `list_memories` tool (~line 105): Change `z.number().default(50)` to `z.number().default(500)`.

**Test:** Add test in `test/db.test.ts` for `listMemories` with `limit=0`.

---

## Task 3: UI filter for domain/category (frontend)

**File:** `src/ui/App.tsx`

Add `filter` signal: `{ domain?: string; category?: string } | null`.

Modify memories resource to include `domain` and `category` query params from filter when set. Remove the `limit=100` cap when filtering (use `limit=0` or `limit=500`).

Add a filter bar between memories header and content showing active filter with clear button. Add small filter icon buttons on domain/category headers (`e.stopPropagation()` to avoid toggling). Clear filter on project change via `createEffect`.

The existing `/api/memories?domain=X&category=Y` already supports these params — no backend changes needed.

---

## Task 4: FTS prefix wildcards (backend)

**File:** `src/app.ts` ~line 316

Change: `const ftsQuery = unique.join(' OR ');`
To: `const ftsQuery = unique.map(w => w.endsWith('*') ? w : w + '*').join(' OR ');`

This makes "auth" match "authentication", "web" match "webpack", etc. FTS5 natively supports the `*` prefix operator.

---

## Task 5: Trigram FTS table + migration (backend)

**File:** `src/db.ts` `initSchema()`

Add after existing FTS triggers (~line 136):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
    USING fts5(content, tags, tokenize="trigram");

-- Sync triggers (same pattern as memories_fts)
CREATE TRIGGER IF NOT EXISTS memories_trigram_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_trigram_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
    INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
```

Backfill after schema init (idempotent):
```typescript
const trigramCount = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
if (trigramCount < memoryCount) {
    db.exec('DELETE FROM memories_trigram');
    db.exec('INSERT INTO memories_trigram(rowid, content, tags) SELECT id, content, tags FROM memories');
}
```

SQLite 3.34.0+ required for trigram tokenizer. better-sqlite3 bundles 3.45+, so this is safe.

**Test:** Add test in `test/db.test.ts` verifying trigram search finds substring matches.

---

## Task 6: Search endpoint + fuzzy search function (backend)

**Files:** `src/db.ts`, `src/app.ts`

Add `searchMemoriesFuzzy()` in `db.ts` — queries `memories_trigram` table with same filter pattern as `searchMemories()`.

Add `GET /api/search?q=X&project=Y&domain=Z&category=W&limit=N` in `app.ts`:
1. Build prefix-wildcard FTS query from `q` and search word-based `memories_fts`
2. If results < limit, search `memories_trigram` for additional matches
3. Deduplicate by id (word-based results first, trigram fills gaps)
4. Return merged results

**Tests:** Add tests in `test/api.test.ts` for `/api/search`.

---

## Task 7: Search bar UI (frontend)

**File:** `src/ui/App.tsx`

Add signals: `searchQuery` (string), `searchResults` (Memory[] | null).

Add search input at top of `<main>` panel:
- Text input styled like TransferModal inputs: `bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm`
- Submit on Enter, calls `GET /api/search?q=...&project=...`
- Clear button appears when results are active
- When `searchResults()` is not null, render flat MemoryCard list instead of grouped view

---

## Task 8: Taxonomy summary endpoint (backend)

**File:** `src/app.ts`

Add `GET /api/taxonomy-summary?project=X`:
- Calls `listDomains()`, `listCategories()`, `listTags()` (add `listTags` to imports)
- Returns `{ summary: "Domains: frontend(12), backend(8)...\nCategories: fact(20)...\nTop tags: typescript(5)..." }`
- Filters to domains/categories with count > 0, top 20 tags

---

## Task 9: PreToolUse hook for search_memories

**Files:** `hooks/hooks.json`, new `hooks/scripts/search-context.sh`

Add to `PreToolUse` array in hooks.json:
```json
{
    "matcher": "mcp__ai-memory__search_memories",
    "hooks": [{
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/search-context.sh\"",
        "timeout": 3
    }]
}
```

`search-context.sh` follows existing hook pattern (port parsing, curl API, python3 JSON output):
- Calls `GET /api/taxonomy-summary?project=$PWD`
- Returns `{"additionalContext": "[ai-memory] Available taxonomy for filtering:\n..."}`

---

## Task 10: Expand SessionStart context

**File:** `src/context.ts`

Import `listDomainsRaw`, `listCategoriesRaw` from db.ts.

After tags section (~line 99), before the tip, add:
```typescript
const allDomains = listDomainsRaw();
if (allDomains.length > 0) {
    lines.push(`\n## Available Domains\n${allDomains.map(d => d.name).join(', ')}`);
}

const allCategories = listCategoriesRaw();
if (allCategories.length > 0) {
    lines.push(`\n## Available Categories\n${allCategories.map(c => `${c.name}: ${c.description}`).join('\n')}`);
}
```

---

## Task 11: Branding — logo component

**Files:** new `src/ui/components/BrandLogo.tsx`, modify `src/ui/App.tsx`

Create `BrandLogo` component that renders composed SVG with:
- Brain path with `fill="#38bdf8"` (sky-400/blue)
- Sparkles path with `fill="#fbbf24"` (amber-400/yellow)
- Both use same `viewBox="0 0 640 640"` so sparkles overlay naturally on brain
- Props: `size` (default 24), `class`

In `App.tsx`: Replace `<Icon name="brain" size={20} class="text-sky-400" />` with `<BrandLogo size={20} />`.

---

## Task 12: Branding — favicon

**File:** `src/ui/index.html`

Add inline SVG favicon as data URI in `<head>`:
```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='...' viewBox='0 0 640 640'><path fill='%2338bdf8' d='...' /><path fill='%23fbbf24' d='...' /></svg>" />
```

Uses URL-encoded `#` as `%23`. No extra files to serve.

---

## Execution Phases

**Phase 1 (independent, parallel):** T1, T2, T4, T5, T8, T10, T11
**Phase 2 (depends on Phase 1):** T3 (←T2), T6 (←T5), T9 (←T8), T12 (←T11)
**Phase 3 (depends on Phase 2):** T7 (←T6)

---

## Verification

1. **Tests:** `pnpm vitest run test/` — all tests pass including new ones for trigram search, /api/search, /api/taxonomy-summary, limit=0
2. **Build:** `pnpm build` — succeeds with no errors
3. **Visual:** Open dashboard at http://localhost:24636
   - Domain headers show counts
   - Search bar works with prefix + trigram matching
   - Filter icons on domain/category headers filter the view
   - New logo (brain + sparkles) in header and favicon
4. **MCP:** Test `search_memories` via MCP — verify PreToolUse hook injects taxonomy context
5. **Context:** Start new session — verify domains/categories appear in startup context
