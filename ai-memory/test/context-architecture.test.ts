import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, updateProjectArchitecture, insertMemory } from '../src/db.js';
import { buildStartupContext } from '../src/context.js';
import { loadConfig } from '../src/config.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

let TEST_DIR: string;
let TEST_DB: string;

beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'ai-memory-arch-ctx-'));
    TEST_DB = join(TEST_DIR, 'test.db');
    initDb(TEST_DB);
    loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('architecture in startup context', () => {
    it('injects Project architecture before memories when summary exists', () => {
        const proj = getOrCreateProject('/ctx/arch');
        updateProjectArchitecture(proj.id, {
            facts: '{}',
            full: '',
            summary: 'Top-level apps/ and packages/ monorepo.',
            fingerprint: 'x',
            scannedAt: '2026-01-01T00:00:00Z',
        });

        insertMemory(proj.id, 'some memory', '', 'fact', 3, '', 'general');

        const ctx = buildStartupContext('/ctx/arch');
        const archIdx = ctx.indexOf('## Project architecture');
        const memIdx = ctx.indexOf('## Memories');
        expect(archIdx).toBeGreaterThan(-1);
        expect(memIdx).toBeGreaterThan(-1);
        expect(archIdx).toBeLessThan(memIdx);
        expect(ctx).toContain('Top-level apps/');
    });
});
