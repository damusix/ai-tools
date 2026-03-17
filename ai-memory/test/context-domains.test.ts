import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getOrCreateProject, insertMemory, updateProjectSummary } from '../src/db.js';
import { buildStartupContext } from '../src/context.js';
import { loadConfig } from '../src/config.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

let TEST_DIR: string;
let TEST_DB: string;

beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'ai-memory-context-'));
    TEST_DB = join(TEST_DIR, 'test.db');
    initDb(TEST_DB);
    // Reset config to defaults (budget=1000 tokens) so tests don't depend on user config
    loadConfig(join(TEST_DIR, 'nonexistent.yaml'));
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

describe('summary-based context injection', () => {
    it('uses deterministic formatter when all memories fit in budget', () => {
        const proj = getOrCreateProject('test-small');
        insertMemory(proj.id, 'short memory', '', 'fact', 3, '', 'frontend');

        const context = buildStartupContext('test-small');
        // Should use deterministic format (structured lines)
        expect(context).toContain('### Frontend');
        expect(context).toContain('short memory');
        expect(context).not.toContain('Project Summary');
    });

    it('uses cached summary when memories exceed budget and summary exists', () => {
        const proj = getOrCreateProject('test-large');
        // Insert many memories to exceed the default 1000 token budget
        for (let i = 0; i < 30; i++) {
            insertMemory(
                proj.id,
                `This is a detailed memory about topic ${i} with enough content to consume tokens. It describes an important architectural decision regarding component ${i} and how it integrates with the broader system.`,
                `tag${i},implementation`,
                'fact',
                3,
                '',
                'frontend',
            );
        }

        // Store a cached summary
        updateProjectSummary(proj.id, 'This is the cached summary about the project (#1, #2).', 'somehash', '{}', 0);

        const context = buildStartupContext('test-large');
        expect(context).toContain('Project Summary');
        expect(context).toContain('This is the cached summary about the project (#1, #2).');
        // Should NOT contain the deterministic format
        expect(context).not.toContain('### Frontend');
    });

    it('uses summary even when it exceeds memory token budget', () => {
        const proj = getOrCreateProject('test-oversized');
        // Use 60 long memories to ensure they exceed the default 1200 token tolerance
        for (let i = 0; i < 60; i++) {
            insertMemory(
                proj.id,
                `Detailed memory ${i} with substantial content for budget testing purposes and architectural descriptions that span multiple sentences about the system design.`,
                `tag${i},architecture,design`,
                'fact',
                3,
                '',
                'frontend',
            );
        }

        // Store a large summary — should still be preferred over truncated deterministic
        const largeSummary = 'This is a large summary. '.repeat(200);
        updateProjectSummary(proj.id, largeSummary, 'hash', '{}', 0);

        const context = buildStartupContext('test-oversized');
        // Summary always preferred over showing a fraction of memories
        expect(context).toContain('Project Summary');
        expect(context).toContain('This is a large summary.');
    });

    it('falls back to deterministic when no summary exists yet', () => {
        const proj = getOrCreateProject('test-nosummary');
        // Use 60 long memories to exceed budget
        for (let i = 0; i < 60; i++) {
            insertMemory(
                proj.id,
                `Another detailed memory ${i} with enough content to push past the token budget threshold for deterministic formatting and architectural decisions.`,
                `tag${i},architecture`,
                'fact',
                3,
                '',
                'frontend',
            );
        }
        // No summary stored — should use deterministic
        const context = buildStartupContext('test-nosummary');
        expect(context).not.toContain('Project Summary');
    });
});
