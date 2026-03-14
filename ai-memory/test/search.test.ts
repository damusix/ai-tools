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
    searchMemoriesFuzzy,
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

describe('searchMemoriesFuzzy (trigram)', () => {
    it('finds substring matches that word-based search misses', () => {
        const proj = getOrCreateProject('/test/fuzzy');
        insertMemory(proj.id, 'websocket connection handling', 'websocket,networking', 'fact', 3, '', 'backend');
        insertMemory(proj.id, 'REST API authentication flow', 'auth,api', 'solution', 4, '', 'backend');

        // Word-based search: "socket" does NOT match "websocket" (no prefix)
        const wordResults = searchMemories('socket', '/test/fuzzy');
        expect(wordResults).toHaveLength(0);

        // Trigram search: "socket" DOES match "websocket" (substring)
        const trigramResults = searchMemoriesFuzzy('socket', '/test/fuzzy');
        expect(trigramResults.length).toBeGreaterThan(0);
        expect(trigramResults[0].content).toContain('websocket');
    });

    it('respects domain filter', () => {
        const proj = getOrCreateProject('/test/fuzzy2');
        insertMemory(proj.id, 'websocket in frontend', 'ws', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'websocket in backend', 'ws', 'fact', 3, '', 'backend');

        const results = searchMemoriesFuzzy('socket', '/test/fuzzy2', undefined, undefined, 20, 'frontend');
        expect(results).toHaveLength(1);
        expect(results[0].domain).toBe('frontend');
    });

    it('does not use * prefix operator (trigram does not support it)', () => {
        const proj = getOrCreateProject('/test/fuzzy3');
        insertMemory(proj.id, 'authentication system design', 'auth', 'solution', 4, '', 'backend');

        // Raw word without *, trigram should still match substring "auth" within "authentication"
        const results = searchMemoriesFuzzy('auth', '/test/fuzzy3');
        expect(results.length).toBeGreaterThan(0);
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
