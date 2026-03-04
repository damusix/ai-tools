# Configurable Taxonomy & Time-based Synthesis Implementation Plan


> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add time-based synthesis fallback so short-session observations don't get orphaned, and make domains + categories fully user-manageable through a new Taxonomy dashboard page with Font Awesome icon selection.

**Architecture:** Three features layered bottom-up: (1) config + DB schema changes, (2) CRUD API + MCP tools, (3) dashboard UI. Categories move from a SQLite CHECK constraint to app-level validation backed by a new `categories` table. Domains get an `icon` column. A new poll-loop check triggers synthesis for stale observations. A new Taxonomy page lets users add/edit/delete domains and categories with Font Awesome icon pickers.

**Tech Stack:** TypeScript, Hono, better-sqlite3 (WAL), SolidJS, Tailwind CSS, Zod, Font Awesome (local files), Vitest

---


### Task 1: Add `synthesisTimeoutMs` to config schema

**Files:**
- Modify: `src/config.ts:7-20`

**Step 1: Add the field to workerSchema**

In `src/config.ts`, add after line 9 (`observationSynthesisThreshold`):

```typescript
synthesisTimeoutMs: z.number().min(0).default(1800000),
```

**Step 2: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add synthesisTimeoutMs config for time-based synthesis fallback"
```

---


### Task 2: Add `categories` table and `icon` column to domains

**Files:**
- Modify: `src/db.ts:42-178` (initSchema)

**Step 1: Add categories table in initSchema CREATE block**

After the `domains` table definition (line 122), add:

```sql
CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'fa-bookmark'
);
```

**Step 2: Add icon migration for domains table**

After the existing `skipped_count` migration (line 143), add an idempotent migration:

```typescript
// Migration: add icon column to domains (idempotent)
const domCols = db.prepare("PRAGMA table_info(domains)").all() as { name: string }[];
if (!domCols.some(c => c.name === 'icon')) {
    db.exec("ALTER TABLE domains ADD COLUMN icon TEXT NOT NULL DEFAULT 'fa-folder'");
}
```

**Step 3: Remove CHECK constraint from memories table**

Change line 65-66 from:

```sql
category TEXT NOT NULL DEFAULT 'fact'
    CHECK(category IN ('decision','pattern','preference','fact','solution')),
```

To:

```sql
category TEXT NOT NULL DEFAULT 'fact',
```

**Step 4: Update domain seed with Font Awesome icons**

Replace the `domainSeed` array (lines 146-166) with a triple-element tuple including icons:

```typescript
const domainSeed: [string, string, string][] = [
    ['frontend', 'UI components, routing, state management, browser APIs, DOM', 'fa-display'],
    ['styling', 'CSS, themes, layouts, responsive design, animations', 'fa-palette'],
    ['backend', 'Server logic, business rules, middleware, request handling', 'fa-server'],
    ['api', 'API design, REST/GraphQL contracts, versioning, endpoints', 'fa-globe'],
    ['data', 'Database, schemas, queries, migrations, ORMs, caching', 'fa-database'],
    ['auth', 'Authentication, authorization, sessions, tokens, RBAC', 'fa-key'],
    ['testing', 'Test frameworks, strategies, fixtures, mocking, coverage', 'fa-vial'],
    ['performance', 'Optimization, caching, profiling, lazy loading, bundle size', 'fa-gauge-high'],
    ['security', 'Vulnerabilities, hardening, input validation, OWASP', 'fa-shield-halved'],
    ['accessibility', 'a11y, WCAG, screen readers, keyboard navigation', 'fa-universal-access'],
    ['infrastructure', 'Deployment, hosting, cloud, Docker, serverless', 'fa-cloud'],
    ['devops', 'CI/CD, pipelines, environments, release process', 'fa-code-branch'],
    ['monitoring', 'Logging, alerting, observability, error tracking', 'fa-chart-line'],
    ['tooling', 'Build tools, linters, formatters, bundlers, dev environment', 'fa-wrench'],
    ['git', 'Version control, branching strategy, hooks, workflows', 'fa-code-branch'],
    ['dependencies', 'Package management, upgrades, compatibility, vendoring', 'fa-cubes'],
    ['architecture', 'System design, patterns, module structure, conventions', 'fa-sitemap'],
    ['integrations', 'Third-party services, SDKs, webhooks, external APIs', 'fa-plug'],
    ['general', 'Cross-cutting concerns that don\'t fit elsewhere', 'fa-folder'],
];
const insertDomain = db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)');
for (const [name, desc, icon] of domainSeed) {
    insertDomain.run(name, desc, icon);
}
```

**Step 5: Add category seed after domain seed**

```typescript
// Seed default categories
const categorySeed: [string, string, string][] = [
    ['decision', 'A choice made between options, with rationale', 'fa-gavel'],
    ['pattern', 'A recurring approach established for the codebase', 'fa-repeat'],
    ['preference', 'A user style or workflow preference', 'fa-sliders'],
    ['fact', 'A discovered truth about the system or environment', 'fa-bookmark'],
    ['solution', 'A working fix for a non-obvious problem', 'fa-puzzle-piece'],
];
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)');
for (const [name, desc, icon] of categorySeed) {
    insertCategory.run(name, desc, icon);
}
```

**Step 6: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 7: Commit**

```bash
git add src/db.ts
git commit -m "feat: add categories table, icon column to domains, remove CHECK constraint"
```

---


### Task 3: Add CRUD DB functions for domains, categories, and stale observations

**Files:**
- Modify: `src/db.ts` (after existing domain queries, ~line 410)

**Step 1: Write the failing tests**

Add to `test/db.test.ts`:

```typescript
import {
    // ... existing imports ...
    listDomainsRaw,
    listDomains,
    insertDomain,
    updateDomain,
    deleteDomain,
    listCategoriesRaw,
    listCategories,
    insertCategory,
    updateCategory,
    deleteCategory,
    getProjectsWithStaleObservations,
} from '../src/db.js';

describe('domains CRUD', () => {
    it('insertDomain adds a new domain', () => {
        insertDomain('ml', 'Machine learning, training, inference', 'fa-brain');
        const all = listDomainsRaw();
        const ml = all.find(d => d.name === 'ml');
        expect(ml).toBeTruthy();
        expect(ml!.description).toBe('Machine learning, training, inference');
    });

    it('insertDomain is idempotent (INSERT OR IGNORE)', () => {
        insertDomain('ml', 'desc1', 'fa-brain');
        insertDomain('ml', 'desc2', 'fa-robot');
        const all = listDomainsRaw();
        const ml = all.find(d => d.name === 'ml');
        expect(ml!.description).toBe('desc1');
    });

    it('updateDomain changes description and icon', () => {
        insertDomain('ml', 'old desc', 'fa-brain');
        updateDomain('ml', 'new desc', 'fa-robot');
        const all = listDomainsRaw();
        const ml = all.find(d => d.name === 'ml');
        expect(ml!.description).toBe('new desc');
    });

    it('deleteDomain removes unused domain', () => {
        insertDomain('ml', 'desc', 'fa-brain');
        deleteDomain('ml');
        const all = listDomainsRaw();
        expect(all.find(d => d.name === 'ml')).toBeUndefined();
    });

    it('deleteDomain throws if domain has memories', () => {
        const proj = getOrCreateProject('/test/dom-del');
        insertMemory(proj.id, 'test', '', 'fact', 3, '', 'frontend');
        expect(() => deleteDomain('frontend')).toThrow();
    });

    it('listDomains includes icon field', () => {
        const all = listDomains();
        expect(all[0]).toHaveProperty('icon');
    });
});

describe('categories CRUD', () => {
    it('default categories seeded', () => {
        const all = listCategoriesRaw();
        expect(all.length).toBe(5);
        expect(all.find(c => c.name === 'decision')).toBeTruthy();
    });

    it('insertCategory adds a new category', () => {
        insertCategory('bug', 'A confirmed bug or defect', 'fa-bug');
        const all = listCategoriesRaw();
        expect(all.find(c => c.name === 'bug')).toBeTruthy();
    });

    it('updateCategory changes description and icon', () => {
        updateCategory('fact', 'Updated description', 'fa-circle-info');
        const all = listCategoriesRaw();
        expect(all.find(c => c.name === 'fact')!.description).toBe('Updated description');
    });

    it('deleteCategory removes unused category', () => {
        insertCategory('temp', 'temporary', 'fa-clock');
        deleteCategory('temp');
        const all = listCategoriesRaw();
        expect(all.find(c => c.name === 'temp')).toBeUndefined();
    });

    it('deleteCategory throws if category has memories', () => {
        const proj = getOrCreateProject('/test/cat-del');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        expect(() => deleteCategory('fact')).toThrow();
    });

    it('listCategories includes count and icon', () => {
        const proj = getOrCreateProject('/test/cat-count');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        const all = listCategories();
        const fact = all.find(c => c.name === 'fact');
        expect(fact!.count).toBeGreaterThan(0);
        expect(fact).toHaveProperty('icon');
    });
});

describe('stale observations', () => {
    it('returns empty when no unprocessed observations', () => {
        expect(getProjectsWithStaleObservations(60000)).toEqual([]);
    });

    it('returns empty when observations are recent', () => {
        const proj = getOrCreateProject('/test/stale');
        insertObservation(proj.id, 'fresh obs', 'src');
        expect(getProjectsWithStaleObservations(1800000)).toEqual([]);
    });

    it('returns project when observations are old enough', () => {
        const proj = getOrCreateProject('/test/stale2');
        const db = getDb();
        // Insert an observation with a timestamp 2 hours ago
        db.prepare(
            "INSERT INTO observations (project_id, content, source_summary, processed, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours'))"
        ).run(proj.id, 'old obs', 'src');
        const result = getProjectsWithStaleObservations(60000); // 1 min timeout
        expect(result).toContain(proj.id);
    });

    it('excludes projects with pending synthesis job', () => {
        const proj = getOrCreateProject('/test/stale3');
        const db = getDb();
        db.prepare(
            "INSERT INTO observations (project_id, content, source_summary, processed, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours'))"
        ).run(proj.id, 'old obs', 'src');
        enqueueMemorySynthesis(proj.id);
        const result = getProjectsWithStaleObservations(60000);
        expect(result).not.toContain(proj.id);
    });

    it('returns empty when timeoutMs is 0', () => {
        const proj = getOrCreateProject('/test/stale4');
        const db = getDb();
        db.prepare(
            "INSERT INTO observations (project_id, content, source_summary, processed, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours'))"
        ).run(proj.id, 'old obs', 'src');
        expect(getProjectsWithStaleObservations(0)).toEqual([]);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: FAIL — functions not exported yet

**Step 3: Add domain CRUD functions**

In `src/db.ts`, after `listDomainsRaw()` (~line 410), add:

```typescript
export function insertDomain(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)').run(name, description, icon);
}

export function updateDomain(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('UPDATE domains SET description = ?, icon = ? WHERE name = ?').run(description, icon, name);
}

export function deleteDomain(name: string): void {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE domain = ?').get(name) as any).c;
    if (count > 0) throw new Error(`Cannot delete domain "${name}": ${count} memories reference it`);
    db.prepare('DELETE FROM domains WHERE name = ?').run(name);
}
```

**Step 4: Update `listDomains` to include `icon`**

Change the `listDomains` function SQL to select `d.icon`:

```typescript
export function listDomains(projectPath?: string): { name: string; description: string; icon: string; count: number }[] {
    const db = getDb();
    let sql = `
        SELECT d.name, d.description, d.icon, COUNT(m.id) as count
        FROM domains d
        LEFT JOIN memories m ON m.domain = d.name
    `;
    // ... rest unchanged
```

Also update `listDomainsRaw` to include `icon`:

```typescript
export function listDomainsRaw(): { name: string; description: string; icon: string }[] {
    const db = getDb();
    return db.prepare('SELECT name, description, icon FROM domains ORDER BY name').all() as any[];
}
```

**Step 5: Add category CRUD functions**

After the domain functions, add:

```typescript
// ── Category queries ────────────────────────────────────────────

export function listCategoriesRaw(): { name: string; description: string; icon: string }[] {
    const db = getDb();
    return db.prepare('SELECT name, description, icon FROM categories ORDER BY name').all() as any[];
}

export function listCategories(projectPath?: string): { name: string; description: string; icon: string; count: number }[] {
    const db = getDb();
    let sql = `
        SELECT c.name, c.description, c.icon, COUNT(m.id) as count
        FROM categories c
        LEFT JOIN memories m ON m.category = c.name
    `;
    const params: any[] = [];

    if (projectPath) {
        sql += `
            LEFT JOIN projects p ON m.project_id = p.id
            WHERE (m.id IS NULL OR p.path = ? OR p.path = '_global')
        `;
        params.push(projectPath);
    }

    sql += ' GROUP BY c.name ORDER BY count DESC, c.name';
    return db.prepare(sql).all(...params) as any[];
}

export function insertCategory(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)').run(name, description, icon);
}

export function updateCategory(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('UPDATE categories SET description = ?, icon = ? WHERE name = ?').run(description, icon, name);
}

export function deleteCategory(name: string): void {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE category = ?').get(name) as any).c;
    if (count > 0) throw new Error(`Cannot delete category "${name}": ${count} memories reference it`);
    db.prepare('DELETE FROM categories WHERE name = ?').run(name);
}
```

**Step 6: Add app-level category validation to insertMemory and updateMemory**

At the top of `insertMemory()` (line 256), add:

```typescript
const validCats = listCategoriesRaw();
if (!validCats.some(c => c.name === category)) {
    throw new Error(`Invalid category: "${category}". Valid: ${validCats.map(c => c.name).join(', ')}`);
}
```

Same at the top of `updateMemory()` (line 278).

**Step 7: Add getProjectsWithStaleObservations**

After `deleteOverSkippedObservations()` (~line 504), add:

```typescript
export function getProjectsWithStaleObservations(timeoutMs: number): number[] {
    if (timeoutMs === 0) return [];
    const db = getDb();
    const timeoutSeconds = Math.floor(timeoutMs / 1000);
    const rows = db.prepare(`
        SELECT DISTINCT o.project_id
        FROM observations o
        WHERE o.processed = 0
          AND o.created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${timeoutSeconds} seconds')
          AND NOT EXISTS (
              SELECT 1 FROM memory_queue mq
              WHERE mq.project_id = o.project_id
                AND mq.status IN ('pending', 'processing')
          )
    `).all() as { project_id: number }[];
    return rows.map(r => r.project_id);
}
```

**Step 8: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/db.test.ts`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add src/db.ts test/db.test.ts
git commit -m "feat: add CRUD functions for domains, categories, and stale observation detection"
```

---


### Task 4: Add CRUD API endpoints for domains and categories

**Files:**
- Modify: `src/app.ts`

**Step 1: Add imports**

Add to the import block from `./db.js`:

```typescript
import {
    // ... existing ...
    insertDomain,
    updateDomain,
    deleteDomain,
    listCategories,
    insertCategory,
    updateCategory,
    deleteCategory,
} from './db.js';
```

**Step 2: Add domain CRUD endpoints**

After the existing `GET /api/domains` route (line 108), add:

```typescript
app.post('/api/domains', async (c) => {
    const { name, description, icon } = await c.req.json();
    if (!name || !description) return c.json({ error: 'name and description required' }, 400);
    insertDomain(name, description, icon || 'fa-folder');
    log('api', `Domain created: ${name}`);
    broadcast('counts:updated', {});
    return c.json({ created: true, name });
});

app.put('/api/domains/:name', async (c) => {
    const name = c.req.param('name');
    const { description, icon } = await c.req.json();
    updateDomain(name, description, icon);
    log('api', `Domain updated: ${name}`);
    return c.json({ updated: true, name });
});

app.delete('/api/domains/:name', (c) => {
    const name = c.req.param('name');
    try {
        deleteDomain(name);
        log('api', `Domain deleted: ${name}`);
        broadcast('counts:updated', {});
        return c.json({ deleted: true, name });
    } catch (err: any) {
        return c.json({ error: err.message }, 409);
    }
});
```

**Step 3: Add category endpoints**

After the domain routes:

```typescript
app.get('/api/categories', (c) => {
    const project = c.req.query('project');
    return c.json(listCategories(project));
});

app.post('/api/categories', async (c) => {
    const { name, description, icon } = await c.req.json();
    if (!name || !description) return c.json({ error: 'name and description required' }, 400);
    insertCategory(name, description, icon || 'fa-bookmark');
    log('api', `Category created: ${name}`);
    broadcast('counts:updated', {});
    return c.json({ created: true, name });
});

app.put('/api/categories/:name', async (c) => {
    const name = c.req.param('name');
    const { description, icon } = await c.req.json();
    updateCategory(name, description, icon);
    log('api', `Category updated: ${name}`);
    return c.json({ updated: true, name });
});

app.delete('/api/categories/:name', (c) => {
    const name = c.req.param('name');
    try {
        deleteCategory(name);
        log('api', `Category deleted: ${name}`);
        broadcast('counts:updated', {});
        return c.json({ deleted: true, name });
    } catch (err: any) {
        return c.json({ error: err.message }, 409);
    }
});
```

**Step 4: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 5: Commit**

```bash
git add src/app.ts
git commit -m "feat: add CRUD API endpoints for domains and categories"
```

---


### Task 5: Update MCP tools for dynamic categories and add list_categories

**Files:**
- Modify: `src/tools.ts`

**Step 1: Add imports**

```typescript
import {
    // ... existing ...
    listCategories,
} from './db.js';
```

**Step 2: Replace static z.enum with z.string for category params**

In `save_memory` (line 30), change:
```typescript
category: z.enum(['decision', 'pattern', 'preference', 'fact', 'solution']).default('fact'),
```
To:
```typescript
category: z.string().default('fact').describe('Memory category. Use list_categories to see options.'),
```

In `search_memories` (line 59), change:
```typescript
category: z.enum(['decision', 'pattern', 'preference', 'fact', 'solution']).optional(),
```
To:
```typescript
category: z.string().optional().describe('Filter by category. Use list_categories to see options.'),
```

In `list_memories` (line 102), same change:
```typescript
category: z.string().optional().describe('Filter by category. Use list_categories to see options.'),
```

**Step 3: Add list_categories tool**

After the `list_domains` tool registration (line 165), add:

```typescript
server.registerTool(
    'list_categories',
    {
        description: 'List all memory categories with usage counts.',
        inputSchema: z.object({
            project: z.string().optional().describe('Project path'),
        }),
    },
    async ({ project }) => {
        const projectPath = project || process.env.PWD || undefined;
        const categories = listCategories(projectPath);
        return {
            content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }],
        };
    },
);
```

**Step 4: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 5: Commit**

```bash
git add src/tools.ts
git commit -m "feat: dynamic category params in MCP tools, add list_categories tool"
```

---


### Task 6: Add stale observation check to worker and inject categories into prompts

**Files:**
- Modify: `src/worker.ts`
- Modify: `src/prompts/synthesize-memories.md`
- Modify: `src/prompts/cleanup.md`

**Step 1: Add imports to worker.ts**

Add to the import from `./db.js`:

```typescript
import {
    // ... existing ...
    getProjectsWithStaleObservations,
    listCategoriesRaw,
} from './db.js';
```

**Step 2: Add checkStaleObservations function**

Before `startWorker()` (~line 130), add:

```typescript
function checkStaleObservations(): void {
    const timeoutMs = getConfig().worker.synthesisTimeoutMs;
    if (timeoutMs === 0) return;
    const staleProjects = getProjectsWithStaleObservations(timeoutMs);
    for (const projectId of staleProjects) {
        enqueueMemorySynthesis(projectId);
        log('worker', `Enqueued stale synthesis for project ${projectId} (timeout: ${timeoutMs}ms)`);
    }
}
```

**Step 3: Call it in the poll loop**

In `startWorker()`, inside the `setInterval` callback (line 148), add `checkStaleObservations()` as the first line inside the `try` block:

```typescript
try {
    checkStaleObservations();
    await processObservationQueue();
    // ... rest unchanged
```

**Step 4: Inject categories into synthesizeMemories**

In `synthesizeMemories()` (~line 400), after building `domainsText`, add:

```typescript
const categories = listCategoriesRaw();
const categoriesText = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');
```

And update the `loadPrompt` call to include `CATEGORIES`:

```typescript
const prompt = loadPrompt('synthesize-memories', {
    EXISTING_MEMORIES: JSON.stringify(existingMemories.slice(0, getConfig().worker.synthesisTopSlice), null, 2),
    OBSERVATIONS: JSON.stringify(observations, null, 2),
    DOMAINS: domainsText,
    CATEGORIES: categoriesText,
});
```

**Step 5: Same for cleanupWithLLM**

In `cleanupWithLLM()` (~line 322), add categories to the prompt:

```typescript
const categories = listCategoriesRaw();
const categoriesText = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');

const prompt = loadPrompt('cleanup', {
    OBSERVATIONS: JSON.stringify(observations, null, 2),
    MEMORIES: JSON.stringify(memories, null, 2),
    CATEGORIES: categoriesText,
});
```

**Step 6: Update synthesize-memories.md prompt**

Replace `src/prompts/synthesize-memories.md` with:

```markdown
You are a memory synthesis agent. Given recent observations and existing memories, synthesize new memories or update existing ones.

DOMAINS (assign exactly one to each memory):
{{DOMAINS}}

CATEGORIES (assign exactly one to each memory):
{{CATEGORIES}}

EXISTING MEMORIES:
{{EXISTING_MEMORIES}}

UNPROCESSED OBSERVATIONS:
{{OBSERVATIONS}}

Return ONLY a JSON object like:
{
    "creates": [
        {"content": "memory text", "domain": "frontend", "tags": ["tag1", "tag2"], "category": "decision", "importance": 3, "observation_ids": [1, 2]}
    ],
    "updates": [
        {"id": 5, "content": "updated memory text", "domain": "frontend", "tags": ["tag1"], "category": "pattern", "importance": 4, "observation_ids": [3, 4]}
    ]
}

Rules:
- Merge similar observations into single memories
- If an observation refines an existing memory, update it
- Skip observations that are already captured in existing memories
- When observations relate to a domain that already has memories, prefer updating existing memories to enrich them rather than creating new ones
- Merge logically related memories within the same domain (e.g., multiple router quirks become one "frontend routing" memory)
- Only create a new memory within a domain when the topic is genuinely distinct from existing memories in that domain
- Every memory MUST have a domain from the DOMAINS list above
- Every memory MUST have a category from the CATEGORIES list above
- Importance: 1=trivia, 2=useful context, 3=normal, 4=important (confusion if forgotten), 5=critical (bugs/hours wasted if forgotten)
- Never use Arabic numerals (1, 2, 3) for lists or sequences in memory content — they will be confused with importance ratings. Use Roman numerals (i, ii, iii) or letters (a, b, c) instead.
```

**Step 7: Update cleanup.md prompt**

Replace `src/prompts/cleanup.md` with:

```markdown
You are a memory curator. Review the following observations and memories for a project and decide which ones should be deleted.

Delete items that are:
- Junk: git operations, commit hashes, file creation/deletion noise, build output
- Stale: no longer relevant, superseded by newer information
- Redundant: duplicates or near-duplicates of other items (keep the better-worded one)
- Too vague: so generic they provide no useful recall value
- Trivial: not worth remembering long-term
- Domain-redundant: multiple memories in the same domain covering overlapping topics (keep the stronger one)

Keep items that match any of these categories:
{{CATEGORIES}}

OBSERVATIONS:
{{OBSERVATIONS}}

MEMORIES:
{{MEMORIES}}

Return ONLY a JSON object:
{
    "delete_observation_ids": [1, 2, 3],
    "delete_memory_ids": [4, 5],
    "reasoning": "brief explanation of what was removed and why"
}

If nothing should be deleted, return:
{
    "delete_observation_ids": [],
    "delete_memory_ids": [],
    "reasoning": "all items are worth keeping"
}
```

**Step 8: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 9: Run all tests**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

**Step 10: Commit**

```bash
git add src/worker.ts src/prompts/synthesize-memories.md src/prompts/cleanup.md
git commit -m "feat: stale observation synthesis trigger, dynamic categories in LLM prompts"
```

---


### Task 7: Add synthesisTimeoutMs to Settings UI

**Files:**
- Modify: `src/ui/components/Settings.tsx:8-23`

**Step 1: Add the field**

In the Worker section's fields array (after `observationSynthesisThreshold` on line 12), add:

```typescript
{ key: 'synthesisTimeoutMs', label: 'Synthesis Timeout', fallback: 1800000, desc: 'ms before stale observations trigger synthesis (0 = disabled)' },
```

**Step 2: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add src/ui/components/Settings.tsx
git commit -m "feat: add synthesisTimeoutMs to settings UI"
```

---


### Task 8: Load Font Awesome via CDN

Font Awesome is loaded from cdnjs — no local files, no Vite build concerns.

**Files:**
- Modify: `src/ui/index.html`

**Step 1: Add Font Awesome CDN link to the HTML head**

In `src/ui/index.html`, add inside `<head>` after the viewport meta tag:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css" />
```

The full file becomes:

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css" />
        <title>ai-memory</title>
    </head>
    <body class="bg-neutral-950 text-neutral-200 min-h-screen font-mono">
        <div id="app"></div>
        <script type="module" src="./index.tsx"></script>
    </body>
</html>
```

**Step 2: Verify Font Awesome renders**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm dev:ui`
Open the dashboard, test with inspect element: `<i class="fa-solid fa-gavel"></i>` should render a gavel icon.

**Step 3: Commit**

```bash
git add src/ui/index.html
git commit -m "feat: load Font Awesome 7 via CDN for taxonomy icons"
```

---


### Task 9: Build the Taxonomy page component

**Files:**
- Create: `src/ui/components/Taxonomy.tsx`

**Step 1: Create the component**

Create `src/ui/components/Taxonomy.tsx` — a SolidJS component that manages domains and categories. The component should:

- Fetch from `GET /api/domains` and `GET /api/categories` on mount
- Display two sections: "Domains" and "Categories"
- Each section is a table with columns: Icon | Name | Description | Count | Actions
- "Add" button opens a form modal with name, description, and icon picker fields
- "Edit" button on each row opens the same modal pre-filled
- "Delete" button is disabled (greyed out with tooltip) when count > 0
- Delete calls the API and shows error toast on 409
- Icon picker: a searchable grid of Font Awesome solid icons (curated const array of ~120 common icon names like `fa-gavel`, `fa-server`, etc.)
- Use the same Tailwind design language as Settings.tsx (dark theme, neutral borders, sky accents)
- Refresh data after any mutation
- Listen for SSE `counts:updated` to refresh

The icon picker should be a sub-component with:
- Text search input that filters icons by name
- Grid of `<i class="fa-solid {icon}">` elements
- Click to select, highlight selected
- Curated list of ~100 common FA solid icons stored as a const array

**Step 2: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add src/ui/components/Taxonomy.tsx
git commit -m "feat: add Taxonomy management page component"
```

---


### Task 10: Wire Taxonomy into the dashboard and remove hardcoded icon maps

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/components/MemoryCard.tsx`

**Step 1: Add Taxonomy button to header**

In `App.tsx`, import the Taxonomy component and add a signal for it:

```typescript
import Taxonomy from './components/Taxonomy';

// Inside the App component:
const [taxonomyOpen, setTaxonomyOpen] = createSignal(false);
```

Add a button in the header toolbar (alongside Settings, Logs, etc.):

```typescript
<button
    onClick={() => setTaxonomyOpen(true)}
    class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
    title="Manage domains and categories"
>
    <i class="fa-solid fa-tags" style="font-size: 14px"></i>
    Taxonomy
</button>
```

Add the Taxonomy overlay render near the other overlays at the bottom:

```typescript
<Taxonomy open={taxonomyOpen()} onClose={() => setTaxonomyOpen(false)} showToast={showToast} />
```

**Step 2: Remove hardcoded icon maps from App.tsx**

Delete `domainIcons` (lines 61-65) and `categoryIcons` (lines 67-70).

Fetch domains and categories from the API and create lookup maps:

```typescript
const [domainMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/domains'));
const [categoryMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/categories'));

const domainIconMap = createMemo(() => {
    const map: Record<string, string> = {};
    for (const d of domainMeta() || []) map[d.name] = d.icon;
    return map;
});
const categoryIconMap = createMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categoryMeta() || []) map[c.name] = c.icon;
    return map;
});
```

Update domain icon usage in the memory grouping display to use Font Awesome:

```typescript
<i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 12px"></i>
```

And category icon usage:

```typescript
<i class={`fa-solid ${categoryIconMap()[catGroup.category] || 'fa-bookmark'}`} style="font-size: 12px"></i>
```

**Step 3: Update MemoryCard to accept icon maps as props**

Modify `MemoryCard.tsx`:
- Remove the hardcoded `domainIcons` and `categoryIcons` maps (lines 7-16)
- Add new props: `domainIcon?: string` and `categoryIcon?: string`
- Replace `<Icon name={categoryIcons[m.category] || 'bookmark'} size={11} />` with `<i class={`fa-solid ${props.categoryIcon || 'fa-bookmark'}`} style="font-size: 11px"></i>`
- Same for the domain icon

Update `MemoryCard` usage in `App.tsx` to pass the resolved icons:

```typescript
<MemoryCard
    memory={m}
    onDelete={(id) => setDeleteTarget({ type: 'memories', id })}
    domainIcon={domainIconMap()[m.domain || ''] || 'fa-folder'}
    categoryIcon={categoryIconMap()[m.category] || 'fa-bookmark'}
/>
```

**Step 4: Verify build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile

**Step 5: Run all tests**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/ui/App.tsx src/ui/components/MemoryCard.tsx
git commit -m "feat: wire Taxonomy page into dashboard, use dynamic icons from API"
```

---


### Task 11: Write one-off migration script for dev database

**Files:**
- Create: `tmp/migrate-remove-check.sql`

**Step 1: Write the migration**

This is NOT shipped in the source — it's for the developer's own existing database only.

```sql
-- Backup: copy ~/.ai-memory/ai-memory.db before running

BEGIN TRANSACTION;

-- Recreate memories without CHECK constraint
CREATE TABLE memories_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'fact',
    importance INTEGER NOT NULL DEFAULT 3
        CHECK(importance BETWEEN 1 AND 5),
    observation_ids TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    domain TEXT REFERENCES domains(name)
);

INSERT INTO memories_new SELECT id, project_id, content, tags, category, importance, observation_ids, created_at, updated_at, domain FROM memories;

-- Drop old FTS triggers
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;

-- Drop old FTS table
DROP TABLE IF EXISTS memories_fts;

-- Drop old table and rename
DROP TABLE memories;
ALTER TABLE memories_new RENAME TO memories;

-- Recreate FTS
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tags, content=memories, content_rowid=id);

-- Rebuild FTS index from existing data
INSERT INTO memories_fts(rowid, content, tags) SELECT id, content, tags FROM memories;

-- Recreate triggers
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
    INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
END;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories(domain);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'fa-bookmark'
);

-- Seed default categories
INSERT OR IGNORE INTO categories (name, description, icon) VALUES ('decision', 'A choice made between options, with rationale', 'fa-gavel');
INSERT OR IGNORE INTO categories (name, description, icon) VALUES ('pattern', 'A recurring approach established for the codebase', 'fa-repeat');
INSERT OR IGNORE INTO categories (name, description, icon) VALUES ('preference', 'A user style or workflow preference', 'fa-sliders');
INSERT OR IGNORE INTO categories (name, description, icon) VALUES ('fact', 'A discovered truth about the system or environment', 'fa-bookmark');
INSERT OR IGNORE INTO categories (name, description, icon) VALUES ('solution', 'A working fix for a non-obvious problem', 'fa-puzzle-piece');

-- Add icon column to domains if missing
-- (SQLite doesn't have IF NOT EXISTS for ALTER TABLE, so this may error if already present — run manually)

COMMIT;
```

**Step 2: Run it**

```bash
cp ~/.ai-memory/ai-memory.db ~/.ai-memory/ai-memory.db.bak
sqlite3 ~/.ai-memory/ai-memory.db < tmp/migrate-remove-check.sql
```

**Step 3: Verify**

```bash
sqlite3 ~/.ai-memory/ai-memory.db "SELECT COUNT(*) FROM memories;"
sqlite3 ~/.ai-memory/ai-memory.db "SELECT COUNT(*) FROM categories;"
sqlite3 ~/.ai-memory/ai-memory.db "PRAGMA table_info(memories);" | grep -v CHECK
```

**Step 4: Do NOT commit this file** — it's in `tmp/` which is gitignored.

---


### Task 12: Final verification

**Step 1: Full build**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm build`
Expected: Clean compile, no warnings

**Step 2: Full test suite**

Run: `cd /Users/alonso/projects/claude-marketplace/ai-memory && pnpm vitest run test/`
Expected: ALL PASS

**Step 3: Manual dashboard test**

Start the server and open the dashboard:
- Verify the Taxonomy button is visible in the header
- Open Taxonomy page — see domains and categories tables
- Add a custom domain (e.g., "ml" with "Machine learning" description)
- Add a custom category (e.g., "bug" with "A confirmed bug or defect")
- Verify they appear in the tables
- Try deleting a default domain with memories — verify it's blocked (409)
- Delete the custom domain/category you just added — verify it works

**Step 4: MCP tool test**

Use Claude Code to test:
- `list_categories` — should return all categories including any custom ones
- `list_domains` — should include `icon` field
- `save_memory` with a custom category name — should succeed
- `save_memory` with an invalid category name — should error

**Step 5: Synthesis timeout test**

Set `synthesisTimeoutMs: 60000` in `~/.ai-memory/config.yaml`, restart server. Create a few observations (via a short Claude session). Wait 60 seconds. Check logs for "Enqueued stale synthesis" message.
