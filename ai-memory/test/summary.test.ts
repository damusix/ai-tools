import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, insertMemory, getDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import {
    computeMemoryHash,
    computeMemorySnapshot,
    computeSummaryDelta,
} from '../src/summary.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadClaudeMdChain } from '../src/summary.js';

let TEST_DIR: string;
let TEST_DB: string;

beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'ai-memory-summary-'));
    TEST_DB = join(TEST_DIR, 'test.db');
    initDb(TEST_DB);
    // Ensure config is loaded with defaults (hermetic — no real config file dependency)
    loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('computeMemoryHash', () => {
    it('returns a hex string', () => {
        const proj = getOrCreateProject('/test/hash');
        insertMemory(proj.id, 'test', '', 'fact', 3, '');
        const hash = computeMemoryHash(proj.id);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns same hash for same data', () => {
        const proj = getOrCreateProject('/test/hash-stable');
        insertMemory(proj.id, 'test', 'tag', 'fact', 3, '', 'frontend');
        const h1 = computeMemoryHash(proj.id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).toBe(h2);
    });

    it('returns different hash when memory content changes', () => {
        const proj = getOrCreateProject('/test/hash-diff');
        const id = insertMemory(proj.id, 'original', '', 'fact', 3, '');
        const h1 = computeMemoryHash(proj.id);

        const db = getDb();
        db.prepare("UPDATE memories SET content = 'modified' WHERE id = ?").run(id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).not.toBe(h2);
    });

    it('returns different hash when importance changes', () => {
        const proj = getOrCreateProject('/test/hash-imp');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '');
        const h1 = computeMemoryHash(proj.id);

        const db = getDb();
        db.prepare('UPDATE memories SET importance = 5 WHERE id = ?').run(id);
        const h2 = computeMemoryHash(proj.id);
        expect(h1).not.toBe(h2);
    });

    it('returns empty hash for project with no memories', () => {
        const proj = getOrCreateProject('/test/hash-empty');
        const hash = computeMemoryHash(proj.id);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('computeMemorySnapshot', () => {
    it('returns map of id to hash', () => {
        const proj = getOrCreateProject('/test/snap');
        const id1 = insertMemory(proj.id, 'mem1', 'tag', 'fact', 3, '', 'frontend');
        const id2 = insertMemory(proj.id, 'mem2', '', 'decision', 5, '', 'backend');

        const snap = computeMemorySnapshot(proj.id);
        expect(Object.keys(snap).length).toBe(2);
        expect(snap[id1]).toMatch(/^[a-f0-9]{64}$/);
        expect(snap[id2]).toMatch(/^[a-f0-9]{64}$/);
        expect(snap[id1]).not.toBe(snap[id2]);
    });
});

describe('computeSummaryDelta', () => {
    it('detects additions', () => {
        const current = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([3]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([]);
    });

    it('detects deletions', () => {
        const current = { 1: 'aaa' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([2]);
    });

    it('detects updates', () => {
        const current = { 1: 'aaa', 2: 'changed' };
        const snapshot = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([2]);
        expect(delta.deleted).toEqual([]);
    });

    it('detects mixed changes', () => {
        const current = { 1: 'aaa', 2: 'changed', 4: 'new' };
        const snapshot = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
        const delta = computeSummaryDelta(current, snapshot);
        expect(delta.added).toEqual([4]);
        expect(delta.updated).toEqual([2]);
        expect(delta.deleted).toEqual([3]);
    });

    it('returns empty delta when nothing changed', () => {
        const state = { 1: 'aaa', 2: 'bbb' };
        const delta = computeSummaryDelta(state, state);
        expect(delta.added).toEqual([]);
        expect(delta.updated).toEqual([]);
        expect(delta.deleted).toEqual([]);
    });
});

describe('loadClaudeMdChain', () => {
    it('returns empty string for _global', () => {
        expect(loadClaudeMdChain('_global')).toBe('');
    });

    it('returns empty string for non-existent path', () => {
        expect(loadClaudeMdChain('/nonexistent/path/abc123')).toBe('');
    });

    it('reads CLAUDE.md from project directory', () => {
        const projDir = join(TEST_DIR, 'proj-claude');
        mkdirSync(projDir, { recursive: true });
        writeFileSync(join(projDir, 'CLAUDE.md'), '# Project Rules\nUse pnpm');

        const chain = loadClaudeMdChain(projDir);
        expect(chain).toContain('# Project Rules');
        expect(chain).toContain('Use pnpm');
    });

    it('walks up to git root collecting CLAUDE.md files', () => {
        const root = join(TEST_DIR, 'repo');
        const sub = join(root, 'packages', 'app');
        mkdirSync(sub, { recursive: true });
        mkdirSync(join(root, '.git')); // fake git root
        writeFileSync(join(root, 'CLAUDE.md'), 'root rules');
        writeFileSync(join(sub, 'CLAUDE.md'), 'app rules');

        const chain = loadClaudeMdChain(sub);
        expect(chain).toContain('root rules');
        expect(chain).toContain('app rules');
        // Root should come before sub
        expect(chain.indexOf('root rules')).toBeLessThan(chain.indexOf('app rules'));
    });

    it('stops walking at git root', () => {
        const outer = join(TEST_DIR, 'outer');
        const inner = join(outer, 'inner');
        mkdirSync(inner, { recursive: true });
        mkdirSync(join(inner, '.git'));
        writeFileSync(join(outer, 'CLAUDE.md'), 'outer rules');
        writeFileSync(join(inner, 'CLAUDE.md'), 'inner rules');

        const chain = loadClaudeMdChain(inner);
        expect(chain).toContain('inner rules');
        expect(chain).not.toContain('outer rules');
    });
});
