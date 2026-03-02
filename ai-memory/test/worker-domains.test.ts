import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, insertMemory, listMemories } from '../src/db.js';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const TEST_DIR = join(import.meta.dirname, '..', 'tmp', 'test-worker');
const TEST_DB = join(TEST_DIR, 'test.db');

beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initDb(TEST_DB);
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('worker domain integration', () => {
    it('insertMemory with domain stores correctly and shows in listMemories', () => {
        const proj = getOrCreateProject('test');
        insertMemory(proj.id, 'routing quirk', 'router', 'fact', 4, '', 'frontend');
        const mems = listMemories('test');
        expect(mems[0].domain).toBe('frontend');
    });

    it('memories without domain return domain as null', () => {
        const proj = getOrCreateProject('test');
        insertMemory(proj.id, 'old memory', '', 'fact', 3, '');
        const mems = listMemories('test');
        expect(mems[0].domain).toBeNull();
    });
});
