import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { scanProjectArchitectureBase } from '../src/architecture/scan.js';
import { fingerprintDeterministic } from '../src/architecture/fingerprint.js';
import type { ScanOptions } from '../src/architecture/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'architecture', 'simple-pnpm');

const scanOpts: ScanOptions = {
    treeMaxDepth: 5,
    manifestMaxDepth: 5,
    manifestMaxFiles: 24,
    manifestMaxCharsPerFile: 8000,
    manifestMaxTotalChars: 80000,
};

const PHP_FIXTURE = join(__dirname, 'fixtures', 'architecture', 'php-laravel');

describe('scanProjectArchitectureBase', () => {
    it('captures tree, raw manifests, and regex signals', () => {
        const facts = scanProjectArchitectureBase(FIXTURE, scanOpts);
        expect(facts.error).toBeUndefined();
        expect(facts.tree.length).toBeGreaterThan(0);
        expect(facts.tree).toContain('packages');
        const pkgRoot = facts.manifests.find((m) => m.path === 'package.json');
        expect(pkgRoot).toBeDefined();
        expect(pkgRoot?.content).toContain('"next"');
        expect(facts.signals.some((s) => s.kind === 'nextjs')).toBe(true);
        expect(facts.signals.some((s) => s.kind === 'pnpm-workspace')).toBe(true);
    });

    it('skips node_modules in tree output', () => {
        const nm = join(FIXTURE, 'node_modules', 'ghost');
        mkdirSync(nm, { recursive: true });
        writeFileSync(join(nm, 'package.json'), '{"name":"ghost"}');
        const facts = scanProjectArchitectureBase(FIXTURE, scanOpts);
        expect(facts.tree).not.toContain('ghost');
    });

    it('returns error for missing path', () => {
        const facts = scanProjectArchitectureBase(join(FIXTURE, 'nope'), scanOpts);
        expect(facts.error).toBe('not_found');
    });

    it('detects typescript signal from tsconfig.json', () => {
        const facts = scanProjectArchitectureBase(FIXTURE, scanOpts);
        expect(facts.manifests.some((m) => m.path === 'tsconfig.json')).toBe(true);
        expect(facts.signals.some((s) => s.kind === 'typescript')).toBe(true);
    });
});

describe('fingerprintDeterministic', () => {
    it('changes when tree changes', () => {
        const facts = scanProjectArchitectureBase(FIXTURE, scanOpts);
        const a = fingerprintDeterministic(facts);
        const b = fingerprintDeterministic({ ...facts, tree: `${facts.tree}\n` });
        expect(a).not.toBe(b);
    });
});

describe('PHP/Laravel fixture', () => {
    it('detects php and laravel signals from composer.json', () => {
        const facts = scanProjectArchitectureBase(PHP_FIXTURE, scanOpts);
        expect(facts.error).toBeUndefined();
        expect(facts.manifests.some((m) => m.path === 'composer.json')).toBe(true);
        expect(facts.signals.some((s) => s.kind === 'php')).toBe(true);
        expect(facts.signals.some((s) => s.kind === 'laravel')).toBe(true);
    });

    it('detects artisan file in manifests', () => {
        const facts = scanProjectArchitectureBase(PHP_FIXTURE, scanOpts);
        expect(facts.manifests.some((m) => m.path === 'artisan')).toBe(true);
    });
});
