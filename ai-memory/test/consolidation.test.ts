import { describe, it, expect, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('git detection', () => {
    const tmp = join(tmpdir(), `ai-memory-test-git-${Date.now()}`);
    const subdir = join(tmp, 'packages', 'sub');

    beforeEach(() => {
        rmSync(tmp, { recursive: true, force: true });
        mkdirSync(subdir, { recursive: true });
        execSync('git init', { cwd: tmp });
        execSync('git config user.email "test@test.com"', { cwd: tmp });
        execSync('git config user.name "Test"', { cwd: tmp });
        writeFileSync(join(tmp, 'file.txt'), 'hello');
        execSync('git add . && git commit -m "init"', { cwd: tmp });
    });

    it('detects git root from subdirectory', async () => {
        const { $ } = await import('zx');
        const result = await $({ quiet: true, nothrow: true, cwd: subdir })`git rev-parse --show-toplevel`;
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(realpathSync(tmp));
    });

    it('returns non-zero exit for non-git directory', async () => {
        const nonGit = join(tmpdir(), `ai-memory-test-nongit-${Date.now()}`);
        mkdirSync(nonGit, { recursive: true });
        const { $ } = await import('zx');
        const result = await $({ quiet: true, nothrow: true, cwd: nonGit })`git rev-parse --show-toplevel`;
        expect(result.exitCode).not.toBe(0);
        rmSync(nonGit, { recursive: true, force: true });
    });
});

describe('consolidateProject', () => {
    it('moves memories with subpath tag and deletes source', async () => {
        const { getDb } = await import('../src/db.js');
        const db = getDb();

        // Use unique paths to avoid UNIQUE constraint conflicts across runs
        const uid = Date.now();
        // Create two projects
        const rootId = Number(db.prepare("INSERT INTO projects (path, name) VALUES (?, 'root')").run(`/tmp/test-root-${uid}`).lastInsertRowid);
        const subId = Number(db.prepare("INSERT INTO projects (path, name) VALUES (?, 'sub')").run(`/tmp/test-root-${uid}/sub`).lastInsertRowid);

        // Add a memory to the sub project
        db.prepare("INSERT INTO memories (project_id, content, tags) VALUES (?, 'test memory', 'existing-tag')").run(subId);

        const { consolidateProject } = await import('../src/db.js');
        const result = consolidateProject(subId, rootId, 'subpath:sub');

        expect(result.memories).toBe(1);

        // Verify memory moved to root with subpath tag
        const mem = db.prepare('SELECT * FROM memories WHERE project_id = ?').get(rootId) as any;
        expect(mem.content).toBe('test memory');
        expect(mem.tags).toContain('subpath:sub');
        expect(mem.tags).toContain('existing-tag');

        // Verify sub project deleted
        const sub = db.prepare('SELECT * FROM projects WHERE id = ?').get(subId);
        expect(sub).toBeUndefined();
    });
});
