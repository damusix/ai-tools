import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, insertMemory } from '../src/db.js';
import { buildStartupContext } from '../src/context.js';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const TEST_DIR = join(import.meta.dirname, '..', 'tmp', 'test-context');
const TEST_DB = join(TEST_DIR, 'test.db');

beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    initDb(TEST_DB);
});

afterEach(() => {
    closeDb();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('domain-grouped context', () => {
    it('should group memories by domain with headers', () => {
        const proj = getOrCreateProject('test-proj');
        insertMemory(proj.id, 'router quirk', 'router', 'fact', 5, '', 'frontend');
        insertMemory(proj.id, 'focus trap', 'a11y', 'pattern', 4, '', 'frontend');
        insertMemory(proj.id, 'hono middleware', 'api', 'decision', 5, '', 'backend');

        const context = buildStartupContext('test-proj');
        expect(context).toContain('### Frontend');
        expect(context).toContain('### Backend');
        expect(context).toContain('router quirk');
        expect(context).toContain('hono middleware');
    });

    it('should include ungrouped memories under General if no domain', () => {
        const proj = getOrCreateProject('test-proj');
        insertMemory(proj.id, 'old memory no domain', '', 'fact', 3, '');

        const context = buildStartupContext('test-proj');
        expect(context).toContain('old memory no domain');
    });

    it('should ensure each domain gets at least top-1 memory', () => {
        const proj = getOrCreateProject('test-proj');
        insertMemory(proj.id, 'fe mem', '', 'fact', 1, '', 'frontend');
        insertMemory(proj.id, 'be mem', '', 'fact', 1, '', 'backend');
        insertMemory(proj.id, 'data mem', '', 'fact', 1, '', 'data');
        insertMemory(proj.id, 'critical be', '', 'fact', 5, '', 'backend');

        const context = buildStartupContext('test-proj');
        expect(context).toContain('fe mem');
        expect(context).toContain('be mem');
        expect(context).toContain('data mem');
    });
});
