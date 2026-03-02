import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    initDb, closeDb, getDb, getOrCreateProject,
    insertMemory, updateMemory, listMemories, searchMemories, listDomains, listDomainsRaw,
} from '../src/db.js';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const TEST_DIR = join(import.meta.dirname, '..', 'tmp', 'test-db');
const TEST_DB = join(TEST_DIR, 'test.db');

beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('domains table', () => {
    it('should create domains table with seeded data', () => {
        initDb(TEST_DB);
        const db = getDb();
        const domains = db.prepare('SELECT name, description FROM domains ORDER BY name').all() as { name: string; description: string }[];
        expect(domains.length).toBe(19);
        expect(domains.find(d => d.name === 'frontend')?.description).toContain('UI');
    });

    it('should add domain column to memories table', () => {
        initDb(TEST_DB);
        const db = getDb();
        const columns = db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
        expect(columns.some(c => c.name === 'domain')).toBe(true);
    });

    it('should enforce FK from memories.domain to domains.name', () => {
        initDb(TEST_DB);
        const db = getDb();
        db.prepare("INSERT INTO projects (path, name) VALUES ('test', 'test')").run();
        expect(() => {
            db.prepare("INSERT INTO memories (project_id, content, domain) VALUES (1, 'test', 'nonexistent')").run();
        }).toThrow();
    });
});

describe('domain query functions', () => {
    it('insertMemory should accept domain parameter', () => {
        initDb(TEST_DB);
        const proj = getOrCreateProject('test-proj');
        const id = insertMemory(proj.id, 'test memory', 'tag1', 'fact', 3, '', 'frontend');
        const db = getDb();
        const row = db.prepare('SELECT domain FROM memories WHERE id = ?').get(id) as { domain: string };
        expect(row.domain).toBe('frontend');
    });

    it('updateMemory should update domain', () => {
        initDb(TEST_DB);
        const proj = getOrCreateProject('test-proj');
        const id = insertMemory(proj.id, 'test', '', 'fact', 3, '', 'frontend');
        updateMemory(id, 'updated', '', 'fact', 3, '', 'backend');
        const db = getDb();
        const row = db.prepare('SELECT domain FROM memories WHERE id = ?').get(id) as { domain: string };
        expect(row.domain).toBe('backend');
    });

    it('listMemories should filter by domain', () => {
        initDb(TEST_DB);
        const proj = getOrCreateProject('test-proj');
        insertMemory(proj.id, 'fe memory', '', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'be memory', '', 'fact', 3, '', 'backend');
        const results = listMemories('test-proj', undefined, undefined, 50, 'frontend');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('fe memory');
    });

    it('listDomains should return domains with counts', () => {
        initDb(TEST_DB);
        const proj = getOrCreateProject('test-proj');
        insertMemory(proj.id, 'mem1', '', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'mem2', '', 'fact', 3, '', 'frontend');
        insertMemory(proj.id, 'mem3', '', 'fact', 3, '', 'backend');
        const domains = listDomains('test-proj');
        const fe = domains.find(d => d.name === 'frontend');
        expect(fe?.count).toBe(2);
    });

    it('listDomainsRaw should return name+description pairs', () => {
        initDb(TEST_DB);
        const domains = listDomainsRaw();
        expect(domains.length).toBe(19);
        expect(domains[0]).toHaveProperty('name');
        expect(domains[0]).toHaveProperty('description');
    });
});
