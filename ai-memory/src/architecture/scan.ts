import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tree } from 'tree-node-cli';
import {
    ARCHITECTURE_SCHEMA_VERSION,
    type ArchitectureCi,
    type ArchitectureFacts,
    type ManifestSnippet,
    type ScanOptions,
} from './types.js';
import { collectSignalsRegex } from './signals-regex.js';

const MANIFEST_BASENAMES = new Set([
    'package.json',
    'pnpm-workspace.yaml',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'Gemfile',
    'Gemfile.lock',
    'pyproject.toml',
    'requirements.txt',
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle.kts',
    'mix.exs',
    'composer.json',
    'composer.lock',
    'pom.xml',
    'tsconfig.json',
    'tsconfig.build.json',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'Makefile',
    'CMakeLists.txt',
    'Pipfile',
    'setup.py',
    'setup.cfg',
    'manage.py',
    'artisan',
]);

const MANIFEST_EXTENSIONS = new Set(['.csproj', '.fsproj', '.vbproj', '.sln', '.gemspec']);

const SKIP_DIR_NAMES = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    'target',
    '.turbo',
    '.vite',
    '__pycache__',
    'venv',
    '.venv',
]);

const TREE_EXCLUDE: RegExp[] = [
    /node_modules/,
    /\.git(\/|$)/,
    /\bdist\b/,
    /\bbuild\b/,
    /\.next\b/,
    /\bcoverage\b/,
    /\btarget\b/,
    /\.turbo\b/,
    /\/\.vite\//,
];

function collectManifests(root: string, options: ScanOptions): ManifestSnippet[] {

    const rootAbs = resolve(root);
    const out: ManifestSnippet[] = [];
    let totalChars = 0;

    function walk(dir: string, depth: number): void {

        if (out.length >= options.manifestMaxFiles || totalChars >= options.manifestMaxTotalChars) {

            return;
        }

        if (depth > options.manifestMaxDepth) {

            return;
        }

        let entries;
        try {

            entries = readdirSync(dir, { withFileTypes: true });
        } catch {

            return;
        }

        for (const ent of entries) {

            if (out.length >= options.manifestMaxFiles || totalChars >= options.manifestMaxTotalChars) {

                break;
            }

            const name = ent.name;
            if (name === '.' || name === '..') continue;

            const full = join(dir, name);

            if (ent.isDirectory()) {

                if (SKIP_DIR_NAMES.has(name)) continue;
                walk(full, depth + 1);
                continue;
            }

            if (!MANIFEST_BASENAMES.has(name)) {
                const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
                if (!MANIFEST_EXTENSIONS.has(ext)) continue;
            }

            let content: string;
            try {

                content = readFileSync(full, 'utf8');
            } catch {

                continue;
            }

            if (content.length > options.manifestMaxCharsPerFile) {
                content = `${content.slice(0, options.manifestMaxCharsPerFile)}\n… [truncated]`;
            }

            const rel = relative(rootAbs, full).replace(/\\/g, '/');
            totalChars += content.length;
            out.push({ path: rel, content });
        }
    }

    walk(rootAbs, 0);
    return out;
}

function collectCi(root: string): ArchitectureCi {

    const workflowsDir = join(resolve(root), '.github', 'workflows');
    if (!existsSync(workflowsDir)) {

        return { workflows: [] };
    }

    let names: string[] = [];
    try {

        names = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    } catch {

        return { workflows: [] };
    }

    return { workflows: names.slice(0, 40) };
}

export function scanProjectArchitectureBase(absPath: string, options: ScanOptions): ArchitectureFacts {

    const scannedAt = new Date().toISOString();
    const resolved = resolve(absPath);

    if (!existsSync(resolved)) {

        return {
            schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
            scannedAt,
            tree: '',
            manifests: [],
            ci: { workflows: [] },
            signals: [],
            error: 'not_found',
        };
    }

    let st;
    try {

        st = statSync(resolved);
    } catch {

        return {
            schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
            scannedAt,
            tree: '',
            manifests: [],
            ci: { workflows: [] },
            signals: [],
            error: 'not_found',
        };
    }

    if (!st.isDirectory()) {

        return {
            schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
            scannedAt,
            tree: '',
            manifests: [],
            ci: { workflows: [] },
            signals: [],
            error: 'not_a_directory',
        };
    }

    let treeText = '';
    try {

        treeText = tree(resolved, {
            maxDepth: options.treeMaxDepth,
            gitignore: true,
            exclude: TREE_EXCLUDE,
        });
    } catch {

        treeText = '';
    }

    const manifests = collectManifests(resolved, options);
    const ci = collectCi(resolved);
    const signals = collectSignalsRegex(manifests, treeText);

    return {
        schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
        scannedAt,
        tree: treeText,
        manifests,
        ci,
        signals,
    };
}
