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
