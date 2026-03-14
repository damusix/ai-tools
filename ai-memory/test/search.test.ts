import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    initDb,
    closeDb,
    getDb,
    getOrCreateProject,
    insertMemory,
    searchMemories,
    listMemories,
    searchObservations,
    insertObservation,
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
    dbPath = join(TMP_DIR, `test-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

describe('Trigram FTS5', () => {
    it('memories_trigram table is created during initSchema', () => {
        const db = getDb();
        const tables = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_trigram'"
        ).all();
        expect(tables).toHaveLength(1);
    });

    it('trigram triggers sync on insert', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/trigram');
        insertMemory(proj.id, 'websocket connection handling', 'websocket,networking', 'fact', 3, '', 'backend');
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(count).toBe(1);
    });

    it('trigram triggers sync on delete', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/trigram');
        insertMemory(proj.id, 'websocket test', 'ws', 'fact', 3, '', 'backend');
        db.prepare('DELETE FROM memories WHERE content = ?').run('websocket test');
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(count).toBe(0);
    });

    it('backfill populates trigram table from existing memories', () => {
        const db = getDb();
        const proj = getOrCreateProject('/test/backfill');
        insertMemory(proj.id, 'memory one', 'tag1', 'fact', 3, '', 'general');
        insertMemory(proj.id, 'memory two', 'tag2', 'fact', 3, '', 'general');

        // Manually clear trigram table to simulate pre-migration state
        db.exec('DELETE FROM memories_trigram');
        const before = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(before).toBe(0);

        // Re-run initSchema — backfill should repopulate
        closeDb();
        initDb(dbPath);
        const after = (getDb().prepare('SELECT COUNT(*) as c FROM memories_trigram').get() as any).c;
        expect(after).toBe(2);
    });
});

describe('limit=0 (unlimited)', () => {
    it('searchMemories with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit');
        for (let i = 0; i < 25; i++) {
            insertMemory(proj.id, `memory ${i}`, `tag${i}`, 'fact', 3, '', 'general');
        }
        const limited = searchMemories('memory*', '/test/limit', undefined, undefined, 5);
        expect(limited).toHaveLength(5);
        const unlimited = searchMemories('memory*', '/test/limit', undefined, undefined, 0);
        expect(unlimited).toHaveLength(25);
    });

    it('listMemories with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit2');
        for (let i = 0; i < 25; i++) {
            insertMemory(proj.id, `list item ${i}`, '', 'fact', 3, '', 'general');
        }
        const limited = listMemories('/test/limit2', undefined, undefined, 5);
        expect(limited).toHaveLength(5);
        const unlimited = listMemories('/test/limit2', undefined, undefined, 0);
        expect(unlimited).toHaveLength(25);
    });

    it('searchObservations with limit=0 returns all results', () => {
        const proj = getOrCreateProject('/test/limit3');
        for (let i = 0; i < 25; i++) {
            insertObservation(proj.id, `obs ${i}`, 'test');
        }
        const limited = searchObservations('obs*', '/test/limit3', 5);
        expect(limited).toHaveLength(5);
        const unlimited = searchObservations('obs*', '/test/limit3', 0);
        expect(unlimited).toHaveLength(25);
    });
});
