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
