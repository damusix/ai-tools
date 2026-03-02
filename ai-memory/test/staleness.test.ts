import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    initDb,
    closeDb,
    getDb,
    getOrCreateProject,
    insertObservation,
    markObservationsProcessed,
    purgeStaleObservations,
    incrementSkippedCount,
    deleteOverSkippedObservations,
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

describe('TTL for processed observations', () => {
    it('deletes processed observations older than 14 days', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();

        // Insert a processed observation with old timestamp
        const id = insertObservation(project.id, 'old processed obs', 'test');
        markObservationsProcessed([id]);
        db.prepare("UPDATE observations SET created_at = datetime('now', '-15 days') WHERE id = ?").run(id);

        const purged = purgeStaleObservations();
        expect(purged).toBe(1);

        const remaining = db.prepare('SELECT COUNT(*) as c FROM observations WHERE id = ?').get(id) as any;
        expect(remaining.c).toBe(0);
    });

    it('keeps processed observations younger than 14 days', () => {
        const project = getOrCreateProject('/test/staleness');
        const id = insertObservation(project.id, 'recent processed obs', 'test');
        markObservationsProcessed([id]);

        const purged = purgeStaleObservations();
        expect(purged).toBe(0);
    });

    it('does not delete unprocessed observations regardless of age', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();

        const id = insertObservation(project.id, 'old unprocessed obs', 'test');
        db.prepare("UPDATE observations SET created_at = datetime('now', '-30 days') WHERE id = ?").run(id);

        const purged = purgeStaleObservations();
        expect(purged).toBe(0);
    });
});

describe('Strike counter for ignored observations', () => {
    it('skipped_count column defaults to 0', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();
        const id = insertObservation(project.id, 'new obs', 'test');
        const row = db.prepare('SELECT skipped_count FROM observations WHERE id = ?').get(id) as any;
        expect(row.skipped_count).toBe(0);
    });

    it('incrementSkippedCount increments the counter', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();
        const id = insertObservation(project.id, 'skipped obs', 'test');

        incrementSkippedCount([id]);
        let row = db.prepare('SELECT skipped_count FROM observations WHERE id = ?').get(id) as any;
        expect(row.skipped_count).toBe(1);

        incrementSkippedCount([id]);
        row = db.prepare('SELECT skipped_count FROM observations WHERE id = ?').get(id) as any;
        expect(row.skipped_count).toBe(2);
    });

    it('deleteOverSkippedObservations removes observations with skipped_count >= 3', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();

        const id1 = insertObservation(project.id, 'will be deleted', 'test');
        const id2 = insertObservation(project.id, 'will survive', 'test');

        // Manually set skipped_count
        db.prepare('UPDATE observations SET skipped_count = 3 WHERE id = ?').run(id1);
        db.prepare('UPDATE observations SET skipped_count = 2 WHERE id = ?').run(id2);

        const deleted = deleteOverSkippedObservations();
        expect(deleted).toBe(1);

        const remaining = db.prepare('SELECT id FROM observations WHERE project_id = ?').all(project.id) as any[];
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe(id2);
    });

    it('full strike flow: 3 increments triggers deletion', () => {
        const project = getOrCreateProject('/test/staleness');
        const db = getDb();
        const id = insertObservation(project.id, 'repeatedly ignored', 'test');

        for (let i = 0; i < 3; i++) {
            incrementSkippedCount([id]);
        }

        const deleted = deleteOverSkippedObservations();
        expect(deleted).toBe(1);

        const row = db.prepare('SELECT COUNT(*) as c FROM observations WHERE id = ?').get(id) as any;
        expect(row.c).toBe(0);
    });
});
