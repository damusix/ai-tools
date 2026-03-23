import type { ManifestSnippet, Signal } from './types.js';

const RULES: { kind: string; test: (text: string, path: string) => boolean }[] = [
    // ── JavaScript / TypeScript ──
    {
        kind: 'nextjs',
        test: (text, p) =>
            /"next"\s*:/.test(text) ||
            (p.endsWith('package.json') && /\bnext\b/i.test(text) && /"react"/.test(text)),
    },
    { kind: 'react', test: (text) => /"react"\s*:/.test(text) || /from ['"]react['"]/.test(text) },
    { kind: 'vue', test: (text) => /"vue"\s*:/.test(text) },
    { kind: 'svelte', test: (text) => /"svelte"\s*:/.test(text) },
    { kind: 'angular', test: (text) => /"@angular\/core"\s*:/.test(text) },
    { kind: 'vite', test: (text, p) => p.includes('vite.config') || /"vite"\s*:/.test(text) },
    {
        kind: 'typescript',
        test: (text, p) =>
            p.endsWith('tsconfig.json') ||
            p.endsWith('tsconfig.build.json') ||
            /"typescript"\s*:/.test(text),
    },

    // ── PHP ──
    { kind: 'php', test: (_text, p) => p.endsWith('composer.json') || p.endsWith('composer.lock') },
    { kind: 'laravel', test: (text, p) => (p.endsWith('composer.json') && /laravel/i.test(text)) || p.endsWith('/artisan') || p === 'artisan' },
    { kind: 'symfony', test: (text, p) => p.endsWith('composer.json') && /symfony/i.test(text) },
    { kind: 'wordpress', test: (text, p) => p.endsWith('composer.json') && /wordpress/i.test(text) },

    // ── Java / Kotlin ──
    { kind: 'java-maven', test: (_text, p) => p.endsWith('pom.xml') },
    { kind: 'java-gradle', test: (_text, p) => p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') },
    { kind: 'kotlin', test: (text, p) => (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts')) && /kotlin/i.test(text) },

    // ── .NET ──
    { kind: 'dotnet', test: (_text, p) => p.endsWith('.csproj') || p.endsWith('.fsproj') || p.endsWith('.vbproj') || p.endsWith('.sln') },

    // ── Rust ──
    { kind: 'rust', test: (_text, p) => p.endsWith('Cargo.toml') || p.endsWith('Cargo.lock') },

    // ── Go ──
    { kind: 'go', test: (_text, p) => p === 'go.mod' || p.endsWith('/go.mod') },

    // ── Ruby ──
    { kind: 'ruby', test: (_text, p) => p.endsWith('Gemfile') || p.endsWith('.gemspec') },
    { kind: 'rails', test: (text, p) => p.endsWith('Gemfile') && /\brails\b/i.test(text) },

    // ── Python ──
    {
        kind: 'python',
        test: (_text, p) =>
            p.endsWith('pyproject.toml') ||
            p.endsWith('requirements.txt') ||
            p.endsWith('Pipfile') ||
            p.endsWith('setup.py') ||
            p.endsWith('setup.cfg'),
    },
    { kind: 'django', test: (text, p) => (p.endsWith('requirements.txt') || p.endsWith('pyproject.toml') || p.endsWith('Pipfile')) && /django/i.test(text) },
    { kind: 'flask', test: (text, p) => (p.endsWith('requirements.txt') || p.endsWith('pyproject.toml') || p.endsWith('Pipfile')) && /\bflask\b/i.test(text) },
    { kind: 'fastapi', test: (text, p) => (p.endsWith('requirements.txt') || p.endsWith('pyproject.toml') || p.endsWith('Pipfile')) && /fastapi/i.test(text) },

    // ── Elixir ──
    { kind: 'elixir', test: (_text, p) => p.endsWith('mix.exs') },
    { kind: 'phoenix', test: (text, p) => p.endsWith('mix.exs') && /phoenix/i.test(text) },

    // ── C / C++ ──
    { kind: 'cmake', test: (_text, p) => p.endsWith('CMakeLists.txt') },

    // ── Docker ──
    { kind: 'docker', test: (_text, p) => p.endsWith('Dockerfile') || p.endsWith('docker-compose.yml') || p.endsWith('docker-compose.yaml') },

    // ── Monorepo / workspace ──
    { kind: 'pnpm-workspace', test: (_text, p) => p.endsWith('pnpm-workspace.yaml') },
];

export function collectSignalsRegex(manifests: ManifestSnippet[], treeText: string): Signal[] {
    const out: Signal[] = [];
    const seen = new Set<string>();

    for (const m of manifests) {
        for (const rule of RULES) {
            if (!rule.test(m.content, m.path)) continue;
            const key = `${rule.kind}:${m.path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ kind: rule.kind, evidence: [m.path] });
        }
    }

    if (treeText.includes('.github') && !out.some((s) => s.kind === 'ci-github-actions')) {
        out.push({ kind: 'ci-github-actions', evidence: ['.github/workflows'] });
    }

    return out;
}
