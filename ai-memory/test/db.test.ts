import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    initDb,
    closeDb,
    getDb,
    getOrCreateProject,
    insertObservation,
    searchObservations,
    insertMemory,
    searchMemories,
    listMemories,
    deleteMemory,
    listTags,
    enqueueObservation,
    dequeueObservation,
    completeObservationQueue,
    enqueueMemorySynthesis,
    dequeueMemorySynthesis,
    completeMemoryQueue,
    countUnprocessedObservations,
    markObservationsProcessed,
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
    deleteProject,
    updateProjectMeta,
    forceDeleteDomain,
    forceDeleteCategory,
    listProjects,
    getStats,
    getProjectSummaryState,
    updateProjectSummary,
    getMemoriesForHashing,
    getProjectArchitecture,
    updateProjectArchitecture,
    getProjectArchitectureSummary,
    deleteEmptyProjects,
    batchDeleteProjects,
} from '../src/db.js';

const TMP_DIR = join(import.meta.dirname, '.');
let dbPath: string;

function cleanupDb(p: string) {
    for (const suffix of ['', '-wal', '-shm']) {
        const f = p + suffix;
        if (existsSync(f)) unlinkSync(f);
    }
}

beforeEach(() => {
    dbPath = join(TMP_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

describe('projects', () => {
    it('getOrCreateProject creates new project and returns existing on second call', () => {
        const p1 = getOrCreateProject('/my/project');
        expect(p1.path).toBe('/my/project');
        expect(p1.name).toBe('project');
        expect(typeof p1.id).toBe('number');

        const p2 = getOrCreateProject('/my/project');
        expect(p2.id).toBe(p1.id);
    });

    it('_global project exists after init', () => {
        const db = getDb();
        const row = db.prepare("SELECT id, path, name FROM projects WHERE path = '_global'").get() as any;
        expect(row).toBeTruthy();
        expect(row.name).toBe('global');
    });

    it('listProjects excludes empty projects but always includes _global', () => {
        // _global starts empty but should always be included
        const projects = listProjects();
        expect(projects.some((p: any) => p.path === '_global')).toBe(true);

        // Create an empty project — should NOT appear
        getOrCreateProject('/empty/project');
        const projects2 = listProjects();
        expect(projects2.some((p: any) => p.path === '/empty/project')).toBe(false);

        // Create a project with a memory — should appear
        const withMem = getOrCreateProject('/has/memories');
        insertMemory(withMem.id, 'test', 'tag', 'fact', 3, '');
        const projects3 = listProjects();
        expect(projects3.some((p: any) => p.path === '/has/memories')).toBe(true);

        // Create a project with only observations — should appear
        const withObs = getOrCreateProject('/has/observations');
        insertObservation(withObs.id, 'test obs', 'src');
        const projects4 = listProjects();
        expect(projects4.some((p: any) => p.path === '/has/observations')).toBe(true);
    });

    it('deleteEmptyProjects removes old empty projects but keeps _global and non-empty', () => {
        const db = getDb();

        // Create a project with memories — should survive
        const withMem = getOrCreateProject('/has/stuff');
        insertMemory(withMem.id, 'important', 'tag', 'fact', 3, '');

        // Create an empty project and backdate its created_at
        const empty = getOrCreateProject('/empty/old');
        db.prepare("UPDATE projects SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours') WHERE id = ?").run(empty.id);

        // Create a recent empty project (should NOT be deleted — too new)
        getOrCreateProject('/empty/new');

        const deleted = deleteEmptyProjects();
        expect(deleted).toBe(1);

        // Verify the right project was deleted
        const remaining = db.prepare('SELECT path FROM projects').all() as any[];
        const paths = remaining.map((r: any) => r.path);
        expect(paths).toContain('_global');
        expect(paths).toContain('/has/stuff');
        expect(paths).toContain('/empty/new');
        expect(paths).not.toContain('/empty/old');
    });

    it('batchDeleteProjects deletes multiple projects and cascades', () => {
        const p1 = getOrCreateProject('/batch/a');
        const p2 = getOrCreateProject('/batch/b');
        insertMemory(p1.id, 'mem1', 'tag', 'fact', 3, '');
        insertMemory(p1.id, 'mem2', 'tag', 'fact', 3, '');
        insertObservation(p2.id, 'obs1', 'src');

        const result = batchDeleteProjects([p1.id, p2.id]);
        expect(result.deleted).toBe(2);
        expect(result.totalMemories).toBe(2);
        expect(result.totalObservations).toBe(1);

        // Verify they're gone
        const db = getDb();
        const remaining = db.prepare('SELECT path FROM projects WHERE path IN (?, ?)').all('/batch/a', '/batch/b');
        expect(remaining.length).toBe(0);
    });

    it('batchDeleteProjects skips _global', () => {
        const db = getDb();
        const globalId = (db.prepare("SELECT id FROM projects WHERE path = '_global'").get() as any).id;
        const result = batchDeleteProjects([globalId]);
        expect(result.deleted).toBe(0);

        // _global still exists
        const row = db.prepare("SELECT id FROM projects WHERE path = '_global'").get();
        expect(row).toBeTruthy();
    });
});

describe('observations', () => {
    it('insertObservation + searchObservations with FTS5', () => {
        const proj = getOrCreateProject('/test/obs');
        const id = insertObservation(proj.id, 'The webpack bundler is slow on large projects', 'chat summary');
        expect(id).toBeGreaterThan(0);

        const results = searchObservations('webpack bundler');
        expect(results.length).toBe(1);
        expect(results[0].content).toContain('webpack');
    });

    it('countUnprocessedObservations + markObservationsProcessed', () => {
        const proj = getOrCreateProject('/test/count');
        const id1 = insertObservation(proj.id, 'obs one', 'src');
        const id2 = insertObservation(proj.id, 'obs two', 'src');

        expect(countUnprocessedObservations(proj.id)).toBe(2);

        markObservationsProcessed([id1, id2]);
        expect(countUnprocessedObservations(proj.id)).toBe(0);
    });
});

describe('memories', () => {
    it('insertMemory + searchMemories with FTS5', () => {
        const proj = getOrCreateProject('/test/mem');
        const id = insertMemory(proj.id, 'Always use pnpm for package management', 'pnpm,tooling', 'preference', 4, '');
        expect(id).toBeGreaterThan(0);

        const results = searchMemories('pnpm package');
        expect(results.length).toBe(1);
        expect(results[0].category).toBe('preference');
    });

    it('listMemories filters by project, tag, category', () => {
        const p1 = getOrCreateProject('/proj/a');
        const p2 = getOrCreateProject('/proj/b');

        insertMemory(p1.id, 'memory alpha', 'config,setup', 'fact', 3, '');
        insertMemory(p1.id, 'memory beta', 'debug', 'solution', 5, '');
        insertMemory(p2.id, 'memory gamma', 'config', 'fact', 2, '');

        // filter by project
        const byProj = listMemories('/proj/a');
        expect(byProj.length).toBe(2);

        // filter by tag
        const byTag = listMemories(undefined, 'config');
        expect(byTag.length).toBe(2);

        // filter by category
        const byCat = listMemories(undefined, undefined, 'solution');
        expect(byCat.length).toBe(1);
        expect(byCat[0].content).toBe('memory beta');
    });

    it('deleteMemory removes from table and FTS is cleaned by trigger', () => {
        const proj = getOrCreateProject('/test/del');
        const id = insertMemory(proj.id, 'ephemeral knowledge about rust borrow checker', 'rust', 'fact', 3, '');

        expect(deleteMemory(id)).toBe(true);
        expect(deleteMemory(id)).toBe(false);

        const results = searchMemories('rust borrow');
        expect(results.length).toBe(0);
    });
});

describe('tags', () => {
    it('listTags counts comma-separated tags correctly', () => {
        const proj = getOrCreateProject('/test/tags');
        insertMemory(proj.id, 'mem1', 'typescript,testing', 'fact', 3, '');
        insertMemory(proj.id, 'mem2', 'typescript,docker', 'fact', 3, '');
        insertMemory(proj.id, 'mem3', 'docker', 'fact', 3, '');

        const tags = listTags();
        const tsTag = tags.find((t) => t.tag === 'typescript');
        const dockerTag = tags.find((t) => t.tag === 'docker');
        const testTag = tags.find((t) => t.tag === 'testing');

        expect(tsTag?.count).toBe(2);
        expect(dockerTag?.count).toBe(2);
        expect(testTag?.count).toBe(1);
    });
});

describe('observation queue', () => {
    it('enqueue, dequeue (status changes to processing), complete', () => {
        const proj = getOrCreateProject('/test/oq');
        const qid = enqueueObservation(proj.id, '{"text":"hello"}');
        expect(qid).toBeGreaterThan(0);

        const item = dequeueObservation();
        expect(item).toBeTruthy();
        expect(item.id).toBe(qid);
        expect(item.payload).toBe('{"text":"hello"}');

        // Verify status is now processing (no more pending items)
        const next = dequeueObservation();
        expect(next).toBeNull();

        completeObservationQueue(qid, 'done');
        const db = getDb();
        const row = db.prepare('SELECT status FROM observation_queue WHERE id = ?').get(qid) as any;
        expect(row.status).toBe('done');
    });
});

describe('memory queue', () => {
    it('enqueue, dequeue, complete', () => {
        const proj = getOrCreateProject('/test/mq');
        const qid = enqueueMemorySynthesis(proj.id);
        expect(qid).toBeGreaterThan(0);

        const item = dequeueMemorySynthesis();
        expect(item).toBeTruthy();
        expect(item.id).toBe(qid);

        const next = dequeueMemorySynthesis();
        expect(next).toBeNull();

        completeMemoryQueue(qid, 'done');
        const db = getDb();
        const row = db.prepare('SELECT status FROM memory_queue WHERE id = ?').get(qid) as any;
        expect(row.status).toBe('done');
    });
});

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
        db.prepare(
            "INSERT INTO observations (project_id, content, source_summary, processed, created_at) VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 hours'))"
        ).run(proj.id, 'old obs', 'src');
        const result = getProjectsWithStaleObservations(60000);
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

describe('deleteProject', () => {
    it('deletes a project and all its data', () => {
        const proj = getOrCreateProject('/test/delete-me');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        insertObservation(proj.id, 'obs', 'src');
        const result = deleteProject(proj.id);
        expect(result.memories).toBe(1);
        expect(result.observations).toBe(1);
        const all = listProjects();
        expect(all.find((p: any) => p.path === '/test/delete-me')).toBeUndefined();
    });

    it('throws when deleting _global', () => {
        const proj = getOrCreateProject('_global');
        expect(() => deleteProject(proj.id)).toThrow('Cannot delete the global project');
    });
});

describe('forceDeleteDomain', () => {
    it('removes domain and deletes memories', () => {
        insertDomain('temp-dom', 'temp', 'fa-folder');
        const proj = getOrCreateProject('/test/force-dom');
        insertMemory(proj.id, 'test', '', 'fact', 3, '', 'temp-dom');
        const cleared = forceDeleteDomain('temp-dom');
        expect(cleared).toBe(1);
        const doms = listDomainsRaw();
        expect(doms.find(d => d.name === 'temp-dom')).toBeUndefined();
    });
});

describe('forceDeleteCategory', () => {
    it('removes category and deletes memories', () => {
        insertCategory('temp-cat', 'temp', 'fa-folder');
        const proj = getOrCreateProject('/test/force-cat');
        insertMemory(proj.id, 'test', '', 'temp-cat', 3, '');
        const cleared = forceDeleteCategory('temp-cat');
        expect(cleared).toBe(1);
        const cats = listCategoriesRaw();
        expect(cats.find(c => c.name === 'temp-cat')).toBeUndefined();
    });
});

describe('domain validation in insertMemory/updateMemory', () => {
    it('insertMemory rejects invalid domain', () => {
        const proj = getOrCreateProject('/test/dom-val');
        expect(() => insertMemory(proj.id, 'test', '', 'fact', 3, '', 'nonexistent-domain')).toThrow('Invalid domain');
    });

    it('insertMemory accepts valid domain', () => {
        const proj = getOrCreateProject('/test/dom-val2');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '', 'frontend');
        expect(id).toBeGreaterThan(0);
    });

    it('insertMemory accepts undefined domain (null in DB)', () => {
        const proj = getOrCreateProject('/test/dom-val3');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '', undefined);
        expect(id).toBeGreaterThan(0);
    });
});

describe('memory reason', () => {
    it('stores and retrieves reason', () => {
        const proj = getOrCreateProject('/test/reason');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '1,2', undefined, 'Synthesized from 2 observations about routing');
        const mems = listMemories('/test/reason');
        const mem = mems.find((m: any) => m.id === id);
        expect(mem.reason).toBe('Synthesized from 2 observations about routing');
    });
});

describe('project enrichment', () => {
    it('updateProjectMeta sets icon and description', () => {
        const proj = getOrCreateProject('/test/enrich');
        // Add a memory so the project appears in listProjects (empty projects are filtered)
        insertMemory(proj.id, 'placeholder', '', 'fact', 3, '');
        updateProjectMeta(proj.id, 'fa-rocket', 'A rocket science project');
        const all = listProjects();
        const p = all.find((pr: any) => pr.path === '/test/enrich');
        expect(p.icon).toBe('fa-rocket');
        expect(p.description).toBe('A rocket science project');
    });
});

describe('project summary state', () => {
    it('getProjectSummaryState returns defaults for new project', () => {
        const proj = getOrCreateProject('/test/summary');
        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('');
        expect(state.summary_hash).toBe('');
        expect(state.summary_snapshot).toBe('');
        expect(state.summary_incremental_count).toBe(0);
    });

    it('updateProjectSummary stores and retrieves state', () => {
        const proj = getOrCreateProject('/test/summary2');
        const snapshot = JSON.stringify({ 1: 'abc', 2: 'def' });
        updateProjectSummary(proj.id, 'Test summary text', 'hash123', snapshot, 3);

        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('Test summary text');
        expect(state.summary_hash).toBe('hash123');
        expect(state.summary_snapshot).toBe(snapshot);
        expect(state.summary_incremental_count).toBe(3);
    });

    it('updateProjectSummary overwrites previous state', () => {
        const proj = getOrCreateProject('/test/summary3');
        updateProjectSummary(proj.id, 'old', 'h1', '{}', 5);
        updateProjectSummary(proj.id, 'new', 'h2', '{"3":"x"}', 0);

        const state = getProjectSummaryState(proj.id);
        expect(state.summary).toBe('new');
        expect(state.summary_hash).toBe('h2');
        expect(state.summary_incremental_count).toBe(0);
    });
});

describe('project architecture columns', () => {
    it('getProjectArchitecture returns empty defaults', () => {
        const proj = getOrCreateProject('/test/arch');
        const arch = getProjectArchitecture(proj.id);
        expect(arch.facts).toBe('');
        expect(arch.full).toBe('');
        expect(arch.summary).toBe('');
        expect(arch.fingerprint).toBe('');
        expect(arch.scannedAt).toBe('');
        expect(getProjectArchitectureSummary(proj.id)).toBe('');
    });

    it('updateProjectArchitecture round-trips', () => {
        const proj = getOrCreateProject('/test/arch2');
        updateProjectArchitecture(proj.id, {
            facts: '{"x":1}',
            full: 'full text',
            summary: 'short',
            fingerprint: 'abc',
            scannedAt: '2026-01-01T00:00:00Z',
        });
        const arch = getProjectArchitecture(proj.id);
        expect(arch.facts).toBe('{"x":1}');
        expect(arch.full).toBe('full text');
        expect(arch.summary).toBe('short');
        expect(arch.fingerprint).toBe('abc');
        expect(arch.scannedAt).toBe('2026-01-01T00:00:00Z');
        expect(getProjectArchitectureSummary(proj.id)).toBe('short');
    });
});

describe('getMemoriesForHashing', () => {
    it('returns all memories for a project ordered by id', () => {
        const proj = getOrCreateProject('/test/hash');
        insertMemory(proj.id, 'mem1', 'tag1', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'mem2', 'tag2', 'decision', 5, '', 'backend');

        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(2);
        expect(mems[0].id).toBeLessThan(mems[1].id);
        expect(mems[0]).toHaveProperty('content');
        expect(mems[0]).toHaveProperty('tags');
        expect(mems[0]).toHaveProperty('domain');
        expect(mems[0]).toHaveProperty('category');
        expect(mems[0]).toHaveProperty('importance');
    });

    it('includes _global memories when querying a specific project', () => {
        const proj = getOrCreateProject('/test/hash-global');
        const global = getOrCreateProject('_global');
        insertMemory(proj.id, 'proj mem', '', 'fact', 3, '', 'frontend');
        insertMemory(global.id, 'global mem', '', 'fact', 3, '', 'general');

        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(2);
    });

    it('returns only _global memories for _global project', () => {
        const proj = getOrCreateProject('/test/hash-global2');
        const global = getOrCreateProject('_global');
        insertMemory(proj.id, 'proj mem', '', 'fact', 3, '');
        insertMemory(global.id, 'global mem', '', 'fact', 3, '');

        const globalMems = getMemoriesForHashing(global.id);
        expect(globalMems.length).toBe(1);
        expect(globalMems[0].content).toBe('global mem');
    });

    it('returns memories with no limit', () => {
        const proj = getOrCreateProject('/test/hash-nolimit');
        for (let i = 0; i < 60; i++) {
            insertMemory(proj.id, `mem ${i}`, '', 'fact', 3, '');
        }
        const mems = getMemoriesForHashing(proj.id);
        expect(mems.length).toBe(60);
    });
});

describe('getStats', () => {
    it('returns total counts across all projects', () => {
        const p1 = getOrCreateProject('/test/stats1');
        const p2 = getOrCreateProject('/test/stats2');
        insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
        insertMemory(p1.id, 'mem2', '', 'fact', 3, '');
        insertMemory(p2.id, 'mem3', '', 'fact', 3, '');
        insertObservation(p1.id, 'obs1', 'src');

        const stats = getStats();
        expect(stats.memories).toBe(3);
        expect(stats.observations).toBe(1);
    });

    it('returns project-scoped counts', () => {
        const p1 = getOrCreateProject('/test/stats-scoped1');
        const p2 = getOrCreateProject('/test/stats-scoped2');
        insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
        insertMemory(p2.id, 'mem2', '', 'fact', 3, '');
        insertObservation(p1.id, 'obs1', 'src');
        insertObservation(p2.id, 'obs2', 'src');

        const stats = getStats('/test/stats-scoped1');
        expect(stats.memories).toBe(1);
        expect(stats.observations).toBe(1);
    });
});
