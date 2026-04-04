import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, closeDb, getDb, getOrCreateProject, insertMemory } from '../src/db.js';

const TMP_DIR = join(import.meta.dirname, '.');
let dbPath: string;

function cleanupDb(p: string) {
    for (const suffix of ['', '-wal', '-shm']) {
        const f = p + suffix;
        if (existsSync(f)) unlinkSync(f);
    }
}

beforeEach(() => {
    dbPath = join(TMP_DIR, `test-distill-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    initDb(dbPath);
});

afterEach(() => {
    closeDb();
    cleanupDb(dbPath);
});

describe('distillation migrations', () => {
    it('projects table has distillation columns', () => {
        const db = getDb();
        const cols = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[];
        const colNames: Record<string, true> = {};
        for (const c of cols) colNames[c.name] = true;

        expect(colNames['distillation_at']).toBe(true);
        expect(colNames['distillation_memories_since']).toBe(true);
    });

    it('memories table has deleted_at and deleted_reason columns', () => {
        const db = getDb();
        const cols = db.prepare("PRAGMA table_info('memories')").all() as { name: string }[];
        const colNames: Record<string, true> = {};
        for (const c of cols) colNames[c.name] = true;

        expect(colNames['deleted_at']).toBe(true);
        expect(colNames['deleted_reason']).toBe(true);
    });

    it('distillation_queue table exists', () => {
        const db = getDb();
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='distillation_queue'").all();
        expect(tables.length).toBe(1);
    });

    it('new memories have empty deleted_at by default', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'test memory', 'tag1', 'fact', 3, '', 'general');
        const db = getDb();
        const row = db.prepare('SELECT deleted_at, deleted_reason FROM memories WHERE id = ?').get(id) as any;
        expect(row.deleted_at).toBe('');
        expect(row.deleted_reason).toBe('');
    });

    it('new projects have distillation defaults', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_at).toBe('');
        expect(row.distillation_memories_since).toBe(0);
    });
});
