# Architecture Snapshot Gap Fixes — Implementation Plan


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all gaps left by the initial architecture snapshot implementation: expand manifest + signal coverage (PHP, Java, .NET, Docker, Python frameworks, Vue, Svelte, Angular, Elixir, TypeScript), add deterministic-scan MCP tool, fix startup timing, wire dead config, add logging, add `architecture_full` truncation, update README.

**Architecture:** All changes are additive edits to existing modules. Scanner gets a `MANIFEST_EXTENSIONS` set alongside `MANIFEST_BASENAMES` for variable-name files (`.csproj`, `.sln`). Signal rules grow from 10 to ~30. Pipeline gets logging via existing `log`/`warn` helpers. New MCP tool calls the scanner directly without LLM passes. Worker tick condition changes from `pollCount % 4 === 0` to `pollCount <= 1 || pollCount % 4 === 0`.

**Tech Stack:** TypeScript, Vitest, existing `src/logger.ts` (`log`, `warn`), existing `src/tokens.ts` (`countTokens`).

**Spec:** `docs/superpowers/specs/2026-03-20-project-architecture-snapshot-design.md`

---

## File map


| Area     | Modify                                                         |
| -------- | -------------------------------------------------------------- |
| Scanner  | `src/architecture/scan.ts`                                     |
| Signals  | `src/architecture/signals-regex.ts`                            |
| LLM      | `src/architecture/llm.ts`                                      |
| Pipeline | `src/architecture/pipeline.ts`                                 |
| Worker   | `src/worker.ts`                                                |
| MCP      | `src/tools.ts`                                                 |
| Tests    | `test/architecture-scan.test.ts`                               |
| Fixtures | `test/fixtures/architecture/simple-pnpm/tsconfig.json` (create)|
| Fixtures | `test/fixtures/architecture/php-laravel/` (create)             |
| README   | `README.md`                                                    |

---

### Task 1: Expand manifest allowlist + extension matching

**Files:**

- Modify: `src/architecture/scan.ts`

- [ ] **Step 1: Add new basenames to `MANIFEST_BASENAMES`**

Add these entries to the existing `MANIFEST_BASENAMES` Set:

```typescript
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
```

- [ ] **Step 2: Add `MANIFEST_EXTENSIONS` set and update `collectManifests`**

Add after `MANIFEST_BASENAMES`:

```typescript
const MANIFEST_EXTENSIONS = new Set(['.csproj', '.fsproj', '.vbproj', '.sln']);
```

In `collectManifests`, change the filter line from:

```typescript
if (!MANIFEST_BASENAMES.has(name)) continue;
```

to:

```typescript
if (!MANIFEST_BASENAMES.has(name)) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (!MANIFEST_EXTENSIONS.has(ext)) continue;
}
```

- [ ] **Step 3: Run tests**

Run: `cd ai-memory && pnpm vitest run test/architecture-scan.test.ts`
Expected: PASS (existing tests unaffected — no new basenames in fixture)

- [ ] **Step 4: Commit**

```bash
git add src/architecture/scan.ts
git commit -m "feat(ai-memory): expand manifest allowlist with PHP, Java, .NET, Docker, Python"
```

---

### Task 2: Expand signal rules

**Files:**

- Modify: `src/architecture/signals-regex.ts`

- [ ] **Step 1: Replace the `RULES` array with expanded coverage**

Replace the entire `RULES` array with:

```typescript
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
```

Note: the old `phoenix` rule required `mix.exs && /phoenix/i`. Now `elixir` fires for any `mix.exs`, and `phoenix` fires when content also matches `/phoenix/i`. Both can fire for the same file — the dedup uses `kind:path` so they produce separate signals.

- [ ] **Step 2: Run tests**

Run: `cd ai-memory && pnpm vitest run test/architecture-scan.test.ts`
Expected: PASS (fixture has `package.json` with `next` + `react`, `pnpm-workspace.yaml`)

- [ ] **Step 3: Commit**

```bash
git add src/architecture/signals-regex.ts
git commit -m "feat(ai-memory): expand signal rules — PHP, Java, .NET, Vue, Svelte, Angular, Django, Flask, FastAPI, Docker"
```

---

### Task 3: Test fixtures for new signals

**Files:**

- Create: `test/fixtures/architecture/simple-pnpm/tsconfig.json`
- Create: `test/fixtures/architecture/php-laravel/composer.json`
- Create: `test/fixtures/architecture/php-laravel/artisan`
- Modify: `test/architecture-scan.test.ts`

- [ ] **Step 1: Create tsconfig fixture**

```bash
echo '{ "compilerOptions": { "strict": true } }' > test/fixtures/architecture/simple-pnpm/tsconfig.json
```

- [ ] **Step 2: Create PHP/Laravel fixture**

```bash
mkdir -p test/fixtures/architecture/php-laravel
```

Write `test/fixtures/architecture/php-laravel/composer.json`:

```json
{
    "name": "fixture/laravel-app",
    "require": {
        "php": "^8.2",
        "laravel/framework": "^11.0"
    }
}
```

Write `test/fixtures/architecture/php-laravel/artisan` (empty file is fine — presence is the signal):

```
#!/usr/bin/env php
```

- [ ] **Step 3: Add tests**

Add to `test/architecture-scan.test.ts`:

```typescript
it('detects typescript signal from tsconfig.json', () => {
    const facts = scanProjectArchitectureBase(FIXTURE, scanOpts);
    expect(facts.manifests.some((m) => m.path === 'tsconfig.json')).toBe(true);
    expect(facts.signals.some((s) => s.kind === 'typescript')).toBe(true);
});

const PHP_FIXTURE = join(__dirname, 'fixtures', 'architecture', 'php-laravel');

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
```

- [ ] **Step 4: Run tests**

Run: `cd ai-memory && pnpm vitest run test/architecture-scan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/architecture/ test/architecture-scan.test.ts
git commit -m "test(ai-memory): add fixtures and tests for PHP/Laravel and TypeScript signals"
```

---

### Task 4: Add deterministic-scan MCP tool

**Files:**

- Modify: `src/tools.ts`
- Modify: `src/architecture/pipeline.ts` (export a thin helper)

- [ ] **Step 1: Export deterministic scan helper from pipeline**

Add to `src/architecture/pipeline.ts`, after the existing `runArchitectureScanForProject`:

```typescript
/**
 * Runs ONLY the deterministic scan (tree + manifests + signals + fingerprint).
 * No Haiku calls. Returns raw facts JSON + fingerprint + whether fingerprint changed.
 */
export function runDeterministicScan(
    projectId: number,
): { facts: ArchitectureFacts; fingerprint: string; changed: boolean } | { error: string } {
    const cfg = getConfig().architecture;
    const projectPath = getProjectPathById(projectId);
    if (!projectPath || projectPath === '_global') return { error: '_global or missing path' };

    const base = scanProjectArchitectureBase(projectPath, scanOptionsFromConfig());
    if (base.error) return { error: base.error };

    const fp = fingerprintDeterministic(base);
    const stored = getProjectArchitecture(projectId);
    return { facts: base, fingerprint: fp, changed: fp !== stored.fingerprint };
}
```

- [ ] **Step 2: Register `scan_project_architecture` MCP tool**

Add to `src/tools.ts`, before the `return server;` line. Import `runDeterministicScan` from `./architecture/pipeline.js`:

```typescript
server.registerTool(
    'scan_project_architecture',
    {
        description:
            'Run the deterministic filesystem scan only (tree + raw manifests + regex signals + fingerprint). No LLM calls. Returns raw facts JSON. Use rescan_project_architecture for the full pipeline with Haiku interpretation.',
        inputSchema: z.object({
            project: z
                .string()
                .optional()
                .describe("Absolute project path. Defaults to PWD. Cannot use '_global'."),
        }),
    },
    async ({ project }) => {
        const projectPath = project || process.env.PWD || '_global';
        if (projectPath === '_global') {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ok: false,
                            error: 'Architecture scan applies to real project paths only, not _global.',
                        }),
                    },
                ],
            };
        }
        const proj = getOrCreateProject(projectPath);
        const result = runDeterministicScan(proj.id);
        log('mcp', `scan_project_architecture: project=${projectPath} result=${'error' in result ? result.error : 'ok'}`);
        if ('error' in result) {
            return {
                content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }) }],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        ok: true,
                        fingerprint: result.fingerprint,
                        changed: result.changed,
                        facts: result.facts,
                    }),
                },
            ],
        };
    },
);
```

- [ ] **Step 3: Build to verify no type errors**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts src/architecture/pipeline.ts
git commit -m "feat(ai-memory): add scan_project_architecture MCP tool (deterministic only, no LLM)"
```

---

### Task 5: Fix startup timing

**Files:**

- Modify: `src/worker.ts`

- [ ] **Step 1: Change architecture check condition**

In `src/worker.ts`, change:

```typescript
if (pollCount % 4 === 0) {
```

to:

```typescript
if (pollCount <= 1 || pollCount % 4 === 0) {
```

This makes architecture scan run on the very first tick (pollCount=1 after increment) instead of waiting until tick 4. After that, every 4th tick as before.

- [ ] **Step 2: Run full tests**

Run: `cd ai-memory && pnpm vitest run test/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "fix(ai-memory): run architecture scan on first worker tick instead of 4th"
```

---

### Task 6: Wire `signalsLlmMaxTokens` via post-response truncation

The `@anthropic-ai/claude-agent-sdk` `query()` options do **not** include a `maxTokens` parameter. Instead, use the config value to truncate the LLM response text before JSON parsing, and pass it as a prompt instruction.

**Files:**

- Modify: `src/architecture/llm.ts`
- Modify: `src/architecture/pipeline.ts`

- [ ] **Step 1: Accept `maxTokens` parameter in `collectSignalsLlm`**

Change the function signature from:

```typescript
export async function collectSignalsLlm(factsJson: string): Promise<Signal[]> {
```

to:

```typescript
export async function collectSignalsLlm(factsJson: string, maxTokens?: number): Promise<Signal[]> {
```

Then update the prompt loading to pass `MAX_TOKENS` as a template variable (the `architecture-signals.md` prompt already has `{{MAX_TOKENS}}`):

```typescript
const prompt = loadPrompt('architecture-signals', {
    FACTS_JSON: factsJson.slice(0, 120_000),
    MAX_TOKENS: String(maxTokens ?? 1500),
});
```

After the `query` call produces `result`, add truncation before JSON parsing:

```typescript
if (maxTokens && result.length > maxTokens * 5) {
    result = result.slice(0, maxTokens * 5);
}
```

(Heuristic: ~5 chars per token as a safety cap on raw text length before parsing.)

- [ ] **Step 2: Pass config value from pipeline**

In `src/architecture/pipeline.ts`, change the `collectSignalsLlm` call from:

```typescript
const llmSignals = await collectSignalsLlm(JSON.stringify(payload));
```

to:

```typescript
const llmSignals = await collectSignalsLlm(JSON.stringify(payload), cfg.signalsLlmMaxTokens);
```

- [ ] **Step 3: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/architecture/llm.ts src/architecture/pipeline.ts
git commit -m "fix(ai-memory): wire signalsLlmMaxTokens config via prompt instruction and response truncation"
```

---

### Task 7: Add `architecture_full` truncation

**Files:**

- Modify: `src/architecture/llm.ts`

- [ ] **Step 1: Add truncation loop to `generateArchitectureFull`**

Import `warn` from `../logger.js` at the top of the file (alongside existing imports). Then change the return of `generateArchitectureFull` from:

```typescript
return result.trim();
```

to:

```typescript
let text = result.trim();
const budget = maxTokens;
if (countTokens(text) > budget) {
    warn('architecture', `architecture_full exceeded budget (${countTokens(text)} > ${budget}), truncating`);
    while (text && countTokens(text) > budget) {
        text = text.slice(0, Math.floor(text.length * 0.85)).trimEnd();
        if (text.length < 20) break;
    }
}
return text;
```

- [ ] **Step 2: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/architecture/llm.ts
git commit -m "fix(ai-memory): truncate architecture_full when it exceeds fullMaxTokens budget"
```

---

### Task 8: Add logging throughout the pipeline

**Files:**

- Modify: `src/architecture/pipeline.ts`

- [ ] **Step 1: Import `log` and `warn` from logger**

Add at the top of `src/architecture/pipeline.ts`:

```typescript
import { log, warn } from '../logger.js';
```

- [ ] **Step 2: Add log calls to `runArchitectureScanForProject`**

Replace the body of `runArchitectureScanForProject` (lines 48–91 of `pipeline.ts`) with this version that adds 4 log/warn calls at key points:

```typescript
const cfg = getConfig().architecture;
if (!cfg.enabled) return false;

const projectPath = getProjectPathById(projectId);
if (!projectPath || projectPath === '_global') return false;

const base = scanProjectArchitectureBase(projectPath, scanOptionsFromConfig());
if (base.error) {
    warn('architecture', `Scan error for project ${projectPath}: ${base.error}`);
    return false;
}

const fp = fingerprintDeterministic(base);
const stored = getProjectArchitecture(projectId);
const interval = cfg.scanIntervalDays;
const staleEnough = daysSinceScan(stored.scannedAt) >= interval;
const fingerprintChanged = fp !== stored.fingerprint;

if (!opts.force && !fingerprintChanged && !staleEnough) {
    log('architecture', `Skipped ${projectPath} (fingerprint unchanged, scan not stale)`);
    return false;
}

log('architecture', `Scanning ${projectPath} (force=${!!opts.force} fpChanged=${fingerprintChanged} stale=${staleEnough})`);

let facts: ArchitectureFacts = { ...base };
const mode = cfg.signalsMode;

if (mode === 'llm' || mode === 'both') {
    const payload =
        mode === 'llm'
            ? { ...base, signals: [] as ArchitectureFacts['signals'] }
            : base;
    const llmSignals = await collectSignalsLlm(JSON.stringify(payload), cfg.signalsLlmMaxTokens);
    facts.signals = mode === 'llm' ? llmSignals : mergeSignals(base.signals, llmSignals);
}

const factsJson = JSON.stringify(facts);
const full = await generateArchitectureFull(factsJson, cfg.fullMaxTokens);
const summary = await generateArchitectureSummary(factsJson, full, cfg.summaryTokenBudget);

updateProjectArchitecture(projectId, {
    facts: factsJson,
    full,
    summary,
    fingerprint: fp,
    scannedAt: facts.scannedAt,
});

broadcast('counts:updated', {});
log('architecture', `Wrote snapshot for ${projectPath}`);
return true;
```

Note: this also includes the `cfg.signalsLlmMaxTokens` pass-through from Task 6.

- [ ] **Step 3: Add summary truncation warning to `generateArchitectureSummary` in `llm.ts`**

In `src/architecture/llm.ts`, in `generateArchitectureSummary`, after the while loop, before the final return, add:

```typescript
if (countTokens(text) < countTokens(result.trim())) {
    warn('architecture', `architecture_summary truncated to fit budget (${budget} tokens)`);
}
```

Note: import `warn` was already added in Task 7.

- [ ] **Step 4: Build to verify**

Run: `cd ai-memory && pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/architecture/pipeline.ts src/architecture/llm.ts
git commit -m "feat(ai-memory): add architecture scan logging (start, skip, success, warnings)"
```

---

### Task 9: Update README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add feature blurb**

After the "### Background Worker" section (after step 5 "Strike counter"), add:

```markdown
### Architecture Snapshot

ai-memory automatically scans each project's directory to build a deterministic snapshot of its structure, tech stacks, and manifests. This gives Claude immediate physical context about the project — no conversation history needed.

**What gets scanned:**

- **Directory tree** via `tree-node-cli` (depth-bounded, respects `.gitignore`)
- **Manifest files** — `package.json`, `composer.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml`, `Dockerfile`, and [many more](src/architecture/scan.ts)
- **Framework signals** — regex-based detection for Next.js, Laravel, Django, Rails, Spring, .NET, Vue, Svelte, Angular, Phoenix, and others
- **CI workflows** — `.github/workflows` filenames

The raw facts are sent to Claude Haiku to produce `architecture_full` (detailed interpretation) and `architecture_summary` (token-capped, injected at session start before memories).

**Rescanning:** Happens automatically when the filesystem fingerprint changes or the scan interval elapses (default: 7 days). Force a rescan with the `rescan_project_architecture` MCP tool, or run a cheap deterministic-only scan (no LLM) with `scan_project_architecture`.
```

- [ ] **Step 2: Add tools to MCP table**

Add two rows to the MCP tools table after `transfer_project`:

```markdown
| `rescan_project_architecture` | Force rescan of project tree/manifests and regenerate architecture summary |
| `scan_project_architecture`   | Deterministic scan only (tree + manifests + signals), no LLM calls        |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(ai-memory): add architecture snapshot feature blurb and MCP tools to README"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd ai-memory && pnpm vitest run test/`
Expected: All tests PASS

- [ ] **Step 2: Build**

Run: `cd ai-memory && pnpm build`
Expected: PASS with no errors

- [ ] **Step 3: Fix any issues**

If tests or build fail, fix and commit: `fix(ai-memory): …`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-21-architecture-snapshot-gaps.md`.

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
