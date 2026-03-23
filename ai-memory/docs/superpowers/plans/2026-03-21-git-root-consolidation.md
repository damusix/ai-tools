# Git-Root Project Consolidation — Implementation Plan


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically detect git roots for projects and optionally consolidate subfolder projects into their git root project, with global + per-project config.

**Architecture:** A worker task runs periodically, detects git root/URL via `zx` shell calls, and merges subfolder projects into their root using a transactional DB operation. Config is global default + per-project DB column override. Dashboard gets a consolidation toggle.

**Tech Stack:** TypeScript, `zx` (shell commands), better-sqlite3, SolidJS, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-21-git-root-consolidation-design.md`

---

## File map


| Area    | File                              | Change |
| ------- | --------------------------------- | ------ |
| Deps    | `package.json`                    | Add `zx` dependency |
| Config  | `src/config.ts`                   | Add `projectsSchema` with consolidation keys |
| DB      | `src/db.ts`                       | Add 3 column migrations, git info helpers, consolidation merge function, update `listProjects()` |
| Worker  | `src/consolidation.ts`            | Create: git detection + consolidation worker logic |
| Worker  | `src/worker.ts`                   | Add `checkGitConsolidation()` call on interval |
| API     | `src/app.ts`                      | Add `PUT /api/projects/:id/consolidate` endpoint |
| UI      | `src/ui/App.tsx`                  | Extend `Project` type, add consolidation toggle + git info display |
| Test    | `test/consolidation.test.ts`      | Create: git detection + consolidation merge tests |

---

### Task 1: Add `zx` dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install zx**

```bash
cd ai-memory && pnpm add zx@8.8.5
```

- [ ] **Step 2: Verify build**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(ai-memory): add zx dependency for shell command execution"
```

---

### Task 2: Config schema

**Files:**

- Modify: `src/config.ts`

- [ ] **Step 1: Add `projectsSchema`**

After the existing `architectureSchema` (line 47), add:

```typescript
const projectsSchema = z.object({
    consolidateToGitRoot: z.boolean().default(false),
    consolidateIntervalMs: z.number().min(10000).default(60000),
});
```

- [ ] **Step 2: Add to `configSchema`**

In the `configSchema` object, after `api: apiSchema.default({})`, add:

```typescript
    projects: projectsSchema.default({}),
```

- [ ] **Step 3: Update `applyDefaults`**

In `applyDefaults()`, after `const api = apiSchema.parse(raw.api ?? {});`, add:

```typescript
    const projects = projectsSchema.parse(raw.projects ?? {});
```

Change the return from:

```typescript
    return { worker, context, architecture, server, api };
```

to:

```typescript
    return { worker, context, architecture, server, api, projects };
```

- [ ] **Step 4: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat(ai-memory): add projects config schema with consolidation keys"
```

---

### Task 3: DB migrations and helpers

**Files:**

- Modify: `src/db.ts`

- [ ] **Step 1: Add column migrations**

After the existing `architecture_scanned_at` migration (line 232), add:

```typescript
    if (!projectColNames['git_root']) {
        db.exec("ALTER TABLE projects ADD COLUMN git_root TEXT NOT NULL DEFAULT ''");
    }
    if (!projectColNames['git_url']) {
        db.exec("ALTER TABLE projects ADD COLUMN git_url TEXT NOT NULL DEFAULT ''");
    }
    if (!projectColNames['consolidate']) {
        db.exec("ALTER TABLE projects ADD COLUMN consolidate TEXT NOT NULL DEFAULT ''");
    }
```

- [ ] **Step 2: Update `listProjects()` SELECT**

In `listProjects()`, add the new columns to the SELECT. Change:

```sql
p.architecture_summary, p.architecture_facts, p.architecture_full, p.architecture_scanned_at,
```

to:

```sql
p.architecture_summary, p.architecture_facts, p.architecture_full, p.architecture_scanned_at,
p.git_root, p.git_url, p.consolidate,
```

- [ ] **Step 3: Add DB helper functions**

After the existing `updateProjectArchitecture` function, add:

```typescript
export function updateProjectGitInfo(projectId: number, gitRoot: string, gitUrl: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET git_root = ?, git_url = ? WHERE id = ?').run(gitRoot, gitUrl, projectId);
}

export function setProjectConsolidate(projectId: number, value: '' | 'yes' | 'no'): void {
    const db = getDb();
    db.prepare('UPDATE projects SET consolidate = ? WHERE id = ?').run(value, projectId);
}

export function listProjectsForConsolidation(): {
    id: number; path: string; git_root: string; git_url: string; consolidate: string;
}[] {
    const db = getDb();
    return db.prepare(
        `SELECT id, path, git_root, git_url, consolidate FROM projects
         WHERE path != '_global' AND (git_root = '' OR git_root != path)`
    ).all() as any[];
}

export function consolidateProject(
    sourceId: number,
    targetId: number,
    subpathTag: string,
): { memories: number; observations: number } {
    const db = getDb();
    const merge = db.transaction(() => {
        // Tag memories with subpath provenance
        if (subpathTag) {
            db.prepare(
                `UPDATE memories SET tags = CASE
                    WHEN tags = '' THEN ?
                    ELSE tags || ',' || ?
                 END
                 WHERE project_id = ?`
            ).run(subpathTag, subpathTag, sourceId);
        }

        // Move all records to target
        db.prepare('UPDATE memories SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
        db.prepare('UPDATE observations SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
        db.prepare('UPDATE observation_queue SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);
        db.prepare('UPDATE memory_queue SET project_id = ? WHERE project_id = ?').run(targetId, sourceId);

        const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE project_id = ?').get(targetId) as any).c;
        const obsCount = (db.prepare('SELECT COUNT(*) as c FROM observations WHERE project_id = ?').get(targetId) as any).c;

        db.prepare('DELETE FROM projects WHERE id = ?').run(sourceId);
        return { memories: memCount, observations: obsCount };
    });

    return merge();
}
```

- [ ] **Step 4: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.ts
git commit -m "feat(ai-memory): add git_root, git_url, consolidate columns and merge helpers"
```

---

### Task 4: Consolidation worker module

**Files:**

- Create: `src/consolidation.ts`

- [ ] **Step 1: Write the consolidation module**

Create `src/consolidation.ts`:

```typescript
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { $ } from 'zx';
import { getConfig } from './config.js';
import {
    listProjectsForConsolidation,
    getOrCreateProject,
    updateProjectGitInfo,
    consolidateProject,
} from './db.js';
import { broadcast } from './sse.js';
import { log, warn } from './logger.js';

async function detectGitInfo(absPath: string): Promise<{ root: string; url: string } | null> {
    if (!existsSync(absPath)) return null;

    const rootResult = await $({ quiet: true, nothrow: true, cwd: absPath })`git rev-parse --show-toplevel`;
    if (rootResult.exitCode !== 0) return null;

    const root = rootResult.stdout.trim();
    const urlResult = await $({ quiet: true, nothrow: true, cwd: absPath })`git remote get-url origin`;
    const url = urlResult.exitCode === 0 ? urlResult.stdout.trim() : '';

    return { root, url };
}

function isConsolidationEnabled(projectConsolidate: string): boolean {
    if (projectConsolidate === 'yes') return true;
    if (projectConsolidate === 'no') return false;
    return getConfig().projects.consolidateToGitRoot;
}

export async function checkGitConsolidation(): Promise<void> {
    const rows = listProjectsForConsolidation();
    if (rows.length === 0) return;

    for (const proj of rows) {
        // Phase 1: detect git root if not yet populated
        if (!proj.git_root) {
            const info = await detectGitInfo(proj.path);
            if (!info) continue;
            updateProjectGitInfo(proj.id, info.root, info.url);
            proj.git_root = info.root;
            proj.git_url = info.url;
        }

        // Skip if this IS the root or not in a repo
        if (!proj.git_root || proj.git_root === proj.path) continue;

        // Phase 2: consolidate if enabled
        if (!isConsolidationEnabled(proj.consolidate)) continue;

        const rootProject = getOrCreateProject(proj.git_root);

        // Check root project's override
        const rootRow = listProjectsForConsolidation().find(r => r.id === rootProject.id);
        if (rootRow?.consolidate === 'no') continue;

        // Copy git info to root project if not already set
        updateProjectGitInfo(rootProject.id, proj.git_root, proj.git_url);

        const subpath = relative(proj.git_root, proj.path);
        const subpathTag = subpath ? `subpath:${subpath}` : '';

        const result = consolidateProject(proj.id, rootProject.id, subpathTag);
        log('consolidation', `Merged ${proj.path} → ${proj.git_root} (${result.memories} memories, ${result.observations} observations)`);
        broadcast('counts:updated', {});
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/consolidation.ts
git commit -m "feat(ai-memory): add git detection and consolidation worker module"
```

---

### Task 5: Wire consolidation into worker loop

**Files:**

- Modify: `src/worker.ts`

- [ ] **Step 1: Add import**

At the top of `src/worker.ts`, after the `checkArchitectureScans` import (line 34), add:

```typescript
import { checkGitConsolidation } from './consolidation.js';
```

- [ ] **Step 2: Add consolidation check to worker loop**

After the architecture scans block (after line 194 `}`), add:

```typescript
            const consolidateEvery = Math.max(1, Math.round(getConfig().projects.consolidateIntervalMs / getConfig().worker.pollIntervalMs));
            if (pollCount <= 1 || pollCount % consolidateEvery === 0) {
                await checkGitConsolidation();
            }
```

- [ ] **Step 3: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(ai-memory): wire git consolidation into worker loop"
```

---

### Task 6: API endpoint

**Files:**

- Modify: `src/app.ts`

- [ ] **Step 1: Add import for `setProjectConsolidate`**

Add `setProjectConsolidate` to the existing imports from `./db.js`.

- [ ] **Step 2: Add PUT endpoint**

After the existing `app.post('/api/projects/:id/architecture', ...)` block, add:

```typescript
    app.put('/api/projects/:id/consolidate', async (c) => {
        const id = Number(c.req.param('id'));
        const { consolidate } = await c.req.json();
        if (consolidate !== '' && consolidate !== 'yes' && consolidate !== 'no') {
            return c.json({ error: "consolidate must be '', 'yes', or 'no'" }, 400);
        }
        setProjectConsolidate(id, consolidate);
        log('api', `Set consolidate=${consolidate} for project ${id}`);
        return c.json({ ok: true });
    });
```

- [ ] **Step 3: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat(ai-memory): add PUT /api/projects/:id/consolidate endpoint"
```

---

### Task 7: Dashboard UI — Project type + consolidation toggle + git info

**Files:**

- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Extend Project type**

Add these fields to the `Project` type (after `architecture_scanned_at: string;`):

```typescript
    git_root: string;
    git_url: string;
    consolidate: string;
```

- [ ] **Step 2: Add consolidation toggle handler**

After the `triggerArchitectureScan` handler, add:

```typescript
    const setConsolidate = async (projectId: number, value: '' | 'yes' | 'no') => {
        try {
            const res = await fetch(`/api/projects/${projectId}/consolidate`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consolidate: value }),
            });
            if (res.ok) {
                showToast(`Consolidation set to ${value || 'default'}`);
                refresh();
            } else {
                showToast('Failed to update consolidation setting');
            }
        } catch {
            showToast('Failed to update consolidation setting');
        }
    };
```

- [ ] **Step 3: Add git info + consolidation toggle to project header area**

Find the project header area — search for the project name/icon display. Inside the project group header (where the project icon and name are rendered), add a git info row and consolidation toggle. This should appear near the project description area.

After the architecture section IIFE `})()}`, add:

```tsx
{/* Git info + consolidation */}
{(() => {
    const gitPath = projGroup.project === '_' ? project() : projGroup.project;
    if (!gitPath || gitPath === '_global') return null;
    if (projGroup.project !== '_' && collapsedProjects()[projGroup.project]) return null;
    const proj = (projects() || []).find((p: Project) => p.path === gitPath);
    if (!proj) return null;
    return (
        <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} px-4 py-2`}>
            <Show when={proj.git_root}>
                <div class="flex items-center gap-1.5 text-[10px] text-neutral-600 mb-1">
                    <i class="fa-solid fa-code-branch" style="font-size: 9px"></i>
                    <span class="font-mono truncate">{proj.git_root}</span>
                    <Show when={proj.git_url}>
                        <span class="text-neutral-700">·</span>
                        <span class="truncate">{proj.git_url}</span>
                    </Show>
                </div>
            </Show>
            <div class="flex items-center gap-2">
                <span class="text-[10px] text-neutral-500">Consolidation:</span>
                <For each={[
                    { value: '' as const, label: 'Default' },
                    { value: 'yes' as const, label: 'Always' },
                    { value: 'no' as const, label: 'Never' },
                ]}>
                    {(opt) => (
                        <button
                            class={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                proj.consolidate === opt.value
                                    ? 'bg-cyan-500/15 text-cyan-400'
                                    : 'text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800'
                            }`}
                            onClick={() => setConsolidate(proj.id, opt.value)}
                        >
                            {opt.label}
                        </button>
                    )}
                </For>
            </div>
        </div>
    );
})()}
```

- [ ] **Step 4: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ai-memory): add git info display and consolidation toggle to dashboard"
```

---

### Task 8: Tests

**Files:**

- Create: `test/consolidation.test.ts`

- [ ] **Step 1: Write tests**

Create `test/consolidation.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('git detection', () => {
    const tmp = join(tmpdir(), `ai-memory-test-git-${Date.now()}`);
    const subdir = join(tmp, 'packages', 'sub');

    beforeEach(() => {
        rmSync(tmp, { recursive: true, force: true });
        mkdirSync(subdir, { recursive: true });
        execSync('git init', { cwd: tmp });
        execSync('git config user.email "test@test.com"', { cwd: tmp });
        execSync('git config user.name "Test"', { cwd: tmp });
        writeFileSync(join(tmp, 'file.txt'), 'hello');
        execSync('git add . && git commit -m "init"', { cwd: tmp });
    });

    it('detects git root from subdirectory', async () => {
        const { $ } = await import('zx');
        const result = await $({ quiet: true, nothrow: true, cwd: subdir })`git rev-parse --show-toplevel`;
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(tmp);
    });

    it('returns non-zero exit for non-git directory', async () => {
        const nonGit = join(tmpdir(), `ai-memory-test-nongit-${Date.now()}`);
        mkdirSync(nonGit, { recursive: true });
        const { $ } = await import('zx');
        const result = await $({ quiet: true, nothrow: true, cwd: nonGit })`git rev-parse --show-toplevel`;
        expect(result.exitCode).not.toBe(0);
        rmSync(nonGit, { recursive: true, force: true });
    });
});

describe('consolidateProject', () => {
    it('moves memories with subpath tag and deletes source', async () => {
        // This test uses the real DB — import after vitest environment is set up
        const { getDb } = await import('../src/db.js');
        const db = getDb();

        // Create two projects
        const rootId = Number(db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/root', 'root')").run().lastInsertRowid);
        const subId = Number(db.prepare("INSERT INTO projects (path, name) VALUES ('/tmp/root/sub', 'sub')").run().lastInsertRowid);

        // Add a memory to the sub project
        db.prepare("INSERT INTO memories (project_id, content, tags) VALUES (?, 'test memory', 'existing-tag')").run(subId);

        const { consolidateProject } = await import('../src/db.js');
        const result = consolidateProject(subId, rootId, 'subpath:sub');

        expect(result.memories).toBe(1);

        // Verify memory moved to root with subpath tag
        const mem = db.prepare('SELECT * FROM memories WHERE project_id = ?').get(rootId) as any;
        expect(mem.content).toBe('test memory');
        expect(mem.tags).toContain('subpath:sub');
        expect(mem.tags).toContain('existing-tag');

        // Verify sub project deleted
        const sub = db.prepare('SELECT * FROM projects WHERE id = ?').get(subId);
        expect(sub).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run tests**

Run: `cd ai-memory && pnpm vitest run test/consolidation.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/consolidation.test.ts
git commit -m "test(ai-memory): add git detection and consolidation merge tests"
```

---

### Task 9: Build, deploy, and verify

- [ ] **Step 1: Run full test suite**

Run: `cd ai-memory && pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 2: Build**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Deploy to Claude cache**

```bash
CACHE_DIR=$(ls -d ~/.claude/plugins/cache/damusix-ai-tools/ai-memory/*/ | tail -1)
rsync -av --delete --exclude='node_modules' --exclude='tmp' --exclude='.mcp.json' \
    /Users/alonso/projects/claude-marketplace/ai-memory/ "$CACHE_DIR"
```

- [ ] **Step 4: Restart server**

```bash
cat ~/.ai-memory/ai-memory.pid | xargs kill 2>/dev/null
```

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-21-git-root-consolidation.md`.

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
