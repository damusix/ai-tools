import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    initDb, closeDb, getDb, getOrCreateProject, insertMemory,
    enqueueDistillation, dequeueDistillation, completeDistillationQueue,
    checkDistillationEligibility, softDeleteMemory, purgeDeletedMemories,
    restoreMemory, listDeletedMemories,
    listMemories, searchMemories, searchMemoriesFuzzy,
    incrementDistillationMemoryCount, resetDistillationState,
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

describe('distillation queue', () => {
    it('enqueue, dequeue, complete lifecycle', () => {
        const project = getOrCreateProject('/test/distill');
        const id = enqueueDistillation(project.id);
        expect(id).toBeGreaterThan(0);

        const item = dequeueDistillation();
        expect(item).not.toBeNull();
        expect(item!.project_id).toBe(project.id);

        completeDistillationQueue(item!.id, 'done');
        const next = dequeueDistillation();
        expect(next).toBeNull();
    });

    it('does not enqueue duplicate pending entries for same project', () => {
        const project = getOrCreateProject('/test/distill');
        enqueueDistillation(project.id);
        enqueueDistillation(project.id);
        const db = getDb();
        const count = (db.prepare(
            "SELECT COUNT(*) as c FROM distillation_queue WHERE project_id = ? AND status = 'pending'"
        ).get(project.id) as any).c;
        expect(count).toBe(1);
    });
});

describe('soft-delete', () => {
    it('softDeleteMemory sets deleted_at and deleted_reason', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'stale memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'file no longer exists');
        const db = getDb();
        const row = db.prepare('SELECT deleted_at, deleted_reason FROM memories WHERE id = ?').get(id) as any;
        expect(row.deleted_at).not.toBe('');
        expect(row.deleted_reason).toBe('file no longer exists');
    });

    it('listMemories excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'active memory', '', 'fact', 3, '', 'general');
        const deletedId = insertMemory(project.id, 'stale memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(deletedId, 'outdated');

        const memories = listMemories('/test/distill');
        expect(memories.length).toBe(1);
        expect(memories[0].content).toBe('active memory');
    });

    it('searchMemories excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'findable memory about react', 'react', 'fact', 3, '', 'frontend');
        const deletedId = insertMemory(project.id, 'deleted memory about react', 'react', 'fact', 3, '', 'frontend');
        softDeleteMemory(deletedId, 'outdated');

        const results = searchMemories('react', '/test/distill');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('findable memory about react');
    });

    it('searchMemoriesFuzzy excludes soft-deleted memories', () => {
        const project = getOrCreateProject('/test/distill');
        insertMemory(project.id, 'findable memory about zustand', 'zustand', 'fact', 3, '', 'frontend');
        const deletedId = insertMemory(project.id, 'deleted memory about zustand', 'zustand', 'fact', 3, '', 'frontend');
        softDeleteMemory(deletedId, 'outdated');

        const results = searchMemoriesFuzzy('zustand', '/test/distill');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('findable memory about zustand');
    });
});

describe('purge', () => {
    it('purgeDeletedMemories removes memories past grace period', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'old deleted memory', '', 'fact', 3, '', 'general');

        const db = getDb();
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare('UPDATE memories SET deleted_at = ?, deleted_reason = ? WHERE id = ?')
            .run(eightDaysAgo, 'test reason', id);

        const purged = purgeDeletedMemories();
        expect(purged).toBe(1);

        const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
        expect(row).toBeUndefined();
    });

    it('purgeDeletedMemories does not remove memories within grace period', () => {
        const project = getOrCreateProject('/test/distill');
        const id = insertMemory(project.id, 'recently deleted memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'maybe stale');

        const purged = purgeDeletedMemories();
        expect(purged).toBe(0);

        const db = getDb();
        const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
        expect(row).toBeDefined();
    });
});

describe('restoreMemory', () => {
    it('clears deleted_at and deleted_reason', () => {
        const project = getOrCreateProject('/test/restore');
        const id = insertMemory(project.id, 'was deleted', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'outdated');
        restoreMemory(id);
        const db = getDb();
        const row = db.prepare('SELECT deleted_at, deleted_reason FROM memories WHERE id = ?').get(id) as any;
        expect(row.deleted_at).toBe('');
        expect(row.deleted_reason).toBe('');
    });

    it('restored memory appears in listMemories again', () => {
        const project = getOrCreateProject('/test/restore');
        const id = insertMemory(project.id, 'restored memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(id, 'outdated');
        const before = listMemories('/test/restore');
        expect(before.length).toBe(0);
        restoreMemory(id);
        const after = listMemories('/test/restore');
        expect(after.length).toBe(1);
        expect(after[0].content).toBe('restored memory');
    });
});

describe('listDeletedMemories', () => {
    it('returns only soft-deleted memories for a project', () => {
        const project = getOrCreateProject('/test/deleted-list');
        insertMemory(project.id, 'active memory', '', 'fact', 3, '', 'general');
        const deletedId = insertMemory(project.id, 'deleted memory', '', 'fact', 3, '', 'general');
        softDeleteMemory(deletedId, 'file removed');
        const deleted = listDeletedMemories('/test/deleted-list');
        expect(deleted.length).toBe(1);
        expect(deleted[0].content).toBe('deleted memory');
        expect(deleted[0].deleted_reason).toBe('file removed');
        expect(deleted[0].deleted_at).not.toBe('');
    });

    it('returns empty array when no deleted memories', () => {
        const project = getOrCreateProject('/test/no-deleted');
        insertMemory(project.id, 'active memory', '', 'fact', 3, '', 'general');
        const deleted = listDeletedMemories('/test/no-deleted');
        expect(deleted.length).toBe(0);
    });
});

describe('distillation counter', () => {
    it('incrementDistillationMemoryCount bumps the counter', () => {
        const project = getOrCreateProject('/test/distill');
        incrementDistillationMemoryCount(project.id);
        incrementDistillationMemoryCount(project.id);

        const db = getDb();
        const row = db.prepare('SELECT distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(2);
    });

    it('resetDistillationState resets counter and sets timestamp', () => {
        const project = getOrCreateProject('/test/distill');
        incrementDistillationMemoryCount(project.id);
        incrementDistillationMemoryCount(project.id);

        resetDistillationState(project.id);

        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(0);
        expect(row.distillation_at).not.toBe('');
    });
});

describe('checkDistillationEligibility', () => {
    it('returns false when counter is below threshold', () => {
        const project = getOrCreateProject('/test/distill');
        expect(checkDistillationEligibility(project.id)).toBe(false);
    });

    it('returns true when counter meets threshold and enough time has passed', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        db.prepare('UPDATE projects SET distillation_memories_since = 10 WHERE id = ?').run(project.id);
        expect(checkDistillationEligibility(project.id)).toBe(true);
    });

    it('returns false when distillation ran recently', () => {
        const project = getOrCreateProject('/test/distill');
        const db = getDb();
        db.prepare('UPDATE projects SET distillation_memories_since = 10, distillation_at = ? WHERE id = ?')
            .run(new Date().toISOString(), project.id);
        expect(checkDistillationEligibility(project.id)).toBe(false);
    });
});

describe('distillation integration', () => {
    it('insertMemory increments distillation counter', () => {
        const project = getOrCreateProject('/test/distill-int');
        insertMemory(project.id, 'memory 1', '', 'fact', 3, '', 'general');
        insertMemory(project.id, 'memory 2', '', 'fact', 3, '', 'general');

        const db = getDb();
        const row = db.prepare('SELECT distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(2);
    });

    it('full queue lifecycle: enqueue → dequeue → complete → reset', () => {
        const project = getOrCreateProject('/test/distill-lifecycle');
        // Add enough memories to cross the threshold
        for (let i = 0; i < 6; i++) {
            insertMemory(project.id, `memory ${i}`, '', 'fact', 3, '', 'general');
        }

        // Should be eligible now (6 >= 5 memories, never distilled)
        expect(checkDistillationEligibility(project.id)).toBe(true);

        // Enqueue
        const queueId = enqueueDistillation(project.id);
        expect(queueId).toBeGreaterThan(0);

        // Dequeue
        const item = dequeueDistillation();
        expect(item).not.toBeNull();
        expect(item!.project_id).toBe(project.id);

        // Complete
        completeDistillationQueue(item!.id, 'done');

        // Reset state
        resetDistillationState(project.id);
        const db = getDb();
        const row = db.prepare('SELECT distillation_at, distillation_memories_since FROM projects WHERE id = ?').get(project.id) as any;
        expect(row.distillation_memories_since).toBe(0);
        expect(row.distillation_at).not.toBe('');
    });
});
