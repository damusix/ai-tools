import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, closeDb, getOrCreateProject, getDb, insertObservation, insertMemory } from '../src/db.js';
import { createApp } from '../src/app.js';

const TMP_DIR = join(import.meta.dirname, '.');
let dbPath: string;

function cleanupDb(p: string) {
    for (const suffix of ['', '-wal', '-shm']) {
        const f = p + suffix;
        if (existsSync(f)) unlinkSync(f);
    }
}

beforeEach(() => {
    dbPath = join(TMP_DIR, `test-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

function makeApp() {
    return createApp();
}

async function req(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(path, init);
}

describe('API', () => {
    it('GET /health returns 200 with status ok', async () => {
        const app = makeApp();
        const res = await app.request('/health');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe('ok');
    });

    it('POST /enqueue with project + payload returns queued: true', async () => {
        const app = makeApp();
        const res = await req(app, 'POST', '/enqueue', {
            project: '_global',
            payload: { text: 'user said something' },
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.queued).toBe(true);
        expect(typeof json.id).toBe('number');
    });

    it('POST /context with project returns systemMessage with <memory-context>', async () => {
        const app = makeApp();
        const res = await req(app, 'POST', '/context', { project: '_global' });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.systemMessage).toContain('<memory-context');
    });

    it('GET /api/projects returns array including _global', async () => {
        const app = makeApp();
        const res = await app.request('/api/projects');
        expect(res.status).toBe(200);
        const json: any[] = await res.json();
        expect(Array.isArray(json)).toBe(true);
        const paths = json.map((p: any) => p.path);
        expect(paths).toContain('_global');
    });

    it('GET /api/memories returns array (empty initially)', async () => {
        const app = makeApp();
        const res = await app.request('/api/memories');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(0);
    });

    it('DELETE /api/memories/:id removes memory', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('_global');
        const memId = insertMemory(proj.id, 'test memory', 'tag1', 'fact', 3, '');

        const res = await req(app, 'DELETE', `/api/memories/${memId}`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deleted).toBe(true);

        // Verify it's gone
        const res2 = await req(app, 'DELETE', `/api/memories/${memId}`);
        const json2 = await res2.json();
        expect(json2.deleted).toBe(false);
    });

    it('GET /api/observations lists observations', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('_global');
        insertObservation(proj.id, 'test observation content', 'test source');

        const res = await app.request('/api/observations');
        expect(res.status).toBe(200);
        const json: any[] = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json.length).toBe(1);
        expect(json[0].content).toBe('test observation content');
    });

    it('DELETE /api/observations/:id removes observation', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('_global');
        const obsId = insertObservation(proj.id, 'ephemeral obs', 'src');

        const res = await req(app, 'DELETE', `/api/observations/${obsId}`);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deleted).toBe(true);

        // Verify it's gone
        const res2 = await req(app, 'DELETE', `/api/observations/${obsId}`);
        const json2 = await res2.json();
        expect(json2.deleted).toBe(false);
    });

    it('GET /api/memories/:id returns a memory', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'test content', 'tag1,tag2', 'fact', 3, '1,2', 'frontend');
        const res = await app.request(`/api/memories/${memId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.content).toBe('test content');
        expect(data.observation_ids).toBe('1,2');
        expect(data.project_path).toBe('test-proj');
    });

    it('GET /api/memories/:id returns 404 for missing memory', async () => {
        const app = makeApp();
        const res = await app.request('/api/memories/99999');
        expect(res.status).toBe(404);
    });

    it('GET /api/memories/:id returns 400 for invalid ID', async () => {
        const app = makeApp();
        const res = await app.request('/api/memories/abc');
        expect(res.status).toBe(400);
    });

    it('PUT /api/memories/:id updates fields', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'old content', 'old-tag', 'fact', 2, '1', 'frontend');
        const res = await req(app, 'PUT', `/api/memories/${memId}`, {
            content: 'new content',
            tags: 'new-tag',
            importance: 5,
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.content).toBe('new content');
        expect(data.tags).toBe('new-tag');
        expect(data.importance).toBe(5);
        expect(data.category).toBe('fact');
        expect(data.observation_ids).toBe('1');
    });

    it('PUT /api/memories/:id returns 404 for missing memory', async () => {
        const app = makeApp();
        const res = await req(app, 'PUT', '/api/memories/99999', { content: 'x' });
        expect(res.status).toBe(404);
    });

    it('PUT /api/memories/:id returns 400 for invalid category', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('test-proj');
        const memId = insertMemory(proj.id, 'content', '', 'fact', 3, '');
        const res = await req(app, 'PUT', `/api/memories/${memId}`, { category: 'nonexistent' });
        expect(res.status).toBe(400);
    });

    it('GET /api/stats returns total counts', async () => {
        const app = makeApp();
        const proj = getOrCreateProject('_global');
        insertMemory(proj.id, 'test memory', '', 'fact', 3, '');
        insertObservation(proj.id, 'test obs', 'src');

        const res = await app.request('/api/stats');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.memories).toBe(1);
        expect(json.observations).toBe(1);
    });

    it('GET /api/stats?project=X returns scoped counts', async () => {
        const app = makeApp();
        const p1 = getOrCreateProject('/proj/a');
        const p2 = getOrCreateProject('/proj/b');
        insertMemory(p1.id, 'mem1', '', 'fact', 3, '');
        insertMemory(p2.id, 'mem2', '', 'fact', 3, '');

        const res = await app.request('/api/stats?project=%2Fproj%2Fa');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.memories).toBe(1);
    });

    it('DELETE /api/projects/batch deletes multiple projects', async () => {
        const app = makeApp();
        const p1 = getOrCreateProject('/batch/a');
        const p2 = getOrCreateProject('/batch/b');
        insertMemory(p1.id, 'mem', 'tag', 'fact', 3, '');
        insertObservation(p2.id, 'obs', 'src');

        const res = await req(app, 'DELETE', '/api/projects/batch', { projectIds: [p1.id, p2.id] });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deleted).toBe(2);
        expect(json.totalMemories).toBe(1);
        expect(json.totalObservations).toBe(1);
    });

    it('DELETE /api/projects/batch returns 400 with no projectIds', async () => {
        const app = makeApp();
        const res = await req(app, 'DELETE', '/api/projects/batch', {});
        expect(res.status).toBe(400);
    });

    it('POST /api/projects/cleanup-empty removes old empty projects', async () => {
        const app = makeApp();
        const db = getDb();

        // Create an empty project and backdate it
        const empty = getOrCreateProject('/cleanup/empty');
        db.prepare("UPDATE projects SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours') WHERE id = ?").run(empty.id);

        const res = await req(app, 'POST', '/api/projects/cleanup-empty');
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.deleted).toBe(1);
    });

    it('GET /api/projects excludes empty projects but includes _global', async () => {
        const app = makeApp();

        // Create an empty project (no memories or observations)
        getOrCreateProject('/empty/project');

        // Create a project with content
        const withMem = getOrCreateProject('/with/memories');
        insertMemory(withMem.id, 'test', 'tag', 'fact', 3, '');

        const res = await app.request('/api/projects');
        const json: any[] = await res.json();
        const paths = json.map((p: any) => p.path);

        expect(paths).toContain('_global');
        expect(paths).toContain('/with/memories');
        expect(paths).not.toContain('/empty/project');
    });
});
