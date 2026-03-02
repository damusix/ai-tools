import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, closeDb, getOrCreateProject, insertObservation, insertMemory } from '../src/db.js';
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
});
