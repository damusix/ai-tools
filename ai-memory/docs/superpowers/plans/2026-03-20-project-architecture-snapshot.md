# Project Architecture Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic repo snapshots (`architecture_facts`), Haiku-derived `architecture_full` and token-capped `architecture_summary`, inject summary first in session context, extend periodic cleanup with architecture-aware redundancy rules, and rescan via worker (weekly + fingerprint) plus MCP (and optional dashboard API).

**Architecture:** `tree-node-cli` produces bounded `tree` text; scanner collects **raw manifest file snippets** (path + truncated content, no per-format parsers); **signals** via **regex** and/or a small **Claude SDK** JSON pass; fingerprint hashes **deterministic** payload only (`tree` + manifests + `ci`, not LLM-derived signals); then Haiku **full** + **summary** → SQLite `projects` columns. Worker poll loop runs architecture checks on an interval derived from config (similar to `checkProjectSummaries`). No filesystem watchers in v1.

**Tech Stack:** TypeScript, better-sqlite3, [`tree-node-cli`](https://www.npmjs.com/package/tree-node-cli), existing `@anthropic-ai/claude-agent-sdk` Haiku usage, Vitest, Zod config (extend `src/config.ts`).

**Spec:** `docs/superpowers/specs/2026-03-20-project-architecture-snapshot-design.md`

---

## File map


| Area    | Create                                                                                                                                                             | Modify                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| DB      | —                                                                                                                                                                  | `src/db.ts` (migrations, `getProjectArchitecture`*, `updateProjectArchitecture`)              |
| Config  | —                                                                                                                                                                  | `src/config.ts`                                                                               |
| Deps    | —                                                                                                                                                                  | `ai-memory/package.json` (`tree-node-cli`)                                                    |
| Scanner | `src/architecture/types.ts`, `src/architecture/scan.ts`, `src/architecture/fingerprint.ts`, optional `src/architecture/signals-regex.ts`, `src/architecture/signals-llm.ts` | —                                                                                             |
| LLM     | `src/prompts/architecture-full.md`, `src/prompts/architecture-summary.md`                                                                                          | —                                                                                             |
| Worker  | —                                                                                                                                                                  | `src/worker.ts`                                                                               |
| Context | —                                                                                                                                                                  | `src/context.ts`                                                                              |
| Cleanup | —                                                                                                                                                                  | `src/prompts/cleanup.md`, `src/worker.ts` (`cleanupWithLLM`)                                  |
| MCP     | —                                                                                                                                                                  | `src/tools.ts`                                                                                |
| HTTP    | —                                                                                                                                                                  | `src/app.ts` (optional `POST /api/projects/:id/architecture` mirroring summary route)         |
| Tests   | `test/fixtures/architecture/*` (minimal trees), `test/architecture-scan.test.ts`, extend `test/context-domains.test.ts` or new `test/context-architecture.test.ts` | `test/config.test.ts` if architecture keys need coverage                                      |
| Docs    | —                                                                                                                                                                  | `docs/data-model.md`, `README.md`, `docs/lifecycle.md`, `CLAUDE.md` (short pointer if needed) |


**Resolved spec open questions (this plan):**

1. **Token budgets:** `architecture.summaryTokenBudget` default **500**. Existing `context.memoryTokenBudget` stays **1000** — v1 does *not* subtract architecture from memory budget (total injected size can grow by up to the summary cap; document in README).
2. **`architecture_full` visibility:** **Worker-only** in v1 (stored in DB, no dashboard panel).
3. **Fingerprint:** `sha256` hex of **canonical JSON** (sorted keys recursively) of **deterministic** payload only: `{ schemaVersion, tree, manifests, ci }` — omit `scannedAt`; omit **`signals`** when any portion is LLM-derived (or omit signals from hash whenever `signalsMode` is `llm` or `both`). Regex-only signals may be included optionally. LLM signals must not be the sole change detector.
4. **Signals default:** `signalsMode: 'regex'`; LLM signals opt-in via `llm` or `both`.

---

### Task 1: Database migrations and accessors

**Files:**

- Modify: `src/db.ts`
- **Step 1:** After existing `projects` column migrations, add idempotent checks for: `architecture_facts`, `architecture_full`, `architecture_summary`, `architecture_fingerprint`, `architecture_scanned_at` (all `TEXT NOT NULL DEFAULT ''`).
- **Step 2:** Export `getProjectArchitecture(projectId: number)` returning `{ facts, full, summary, fingerprint, scannedAt }` (or separate getters if you prefer smaller API surface — one row read is fine).
- **Step 3:** Export `updateProjectArchitecture(projectId, { factsJson, full, summary, fingerprint, scannedAt })` (single `UPDATE`).
- **Step 4:** Run `cd ai-memory && pnpm vitest run test/db.test.ts` — expect PASS (extend `db.test.ts` with one test that opens DB and asserts new columns exist via `PRAGMA table_info` or a write/read round-trip).
- **Step 5:** Commit: `feat(ai-memory): add projects architecture columns and accessors`

---

### Task 2: Configuration

**Files:**

- Modify: `src/config.ts`
- **Step 1:** Add Zod schema `architectureSchema`: `enabled` (boolean, default `true`), `summaryTokenBudget` (number, min 50, default `500`), `scanIntervalDays` (number, min 1, default `7`), `fullMaxTokens` (number, default e.g. `2000` — cap Haiku output for `architecture_full`), `signalsMode` (`'regex' | 'llm' | 'both'`, default `'regex'`), `signalsLlmMaxTokens` (number, default e.g. `1500` — cap Haiku output for structured signals when `llm` or `both`), `treeMaxDepth` (number, default e.g. `5`), `manifestMaxFiles` (number), `manifestMaxCharsPerFile` (number), `manifestMaxTotalChars` (number).
- **Step 2:** Nest under `config.architecture`; extend `configSchema` and `applyDefaults` the same way as `worker.summary`.
- **Step 3:** Document keys in `README.md` (config section).
- **Step 4:** Run `pnpm vitest run test/config.test.ts` if present; adjust or add assertion for nested default.
- **Step 5:** Commit: `feat(ai-memory): add architecture config schema`

---

### Task 3: Scanner (tree + raw manifests + signals)

**Files:**

- Create: `src/architecture/types.ts` — TypeScript interfaces (`ArchitectureFacts`, `ManifestSnippet`, `Signal`, etc.).
- Create: `src/architecture/scan.ts` — `scanProjectArchitecture(absPath: string): Promise<ArchitectureFacts>` or sync if tree API is sync — match `tree-node-cli` API.
- Modify: `ai-memory/package.json` — add dependency **`tree-node-cli`**; `pnpm install` at repo root for `ai-memory`.

- **Step 1:** **Tree:** Use [`tree-node-cli`](https://www.npmjs.com/package/tree-node-cli) programmatic API **or** spawn `treee` / documented binary with flags: max depth from config (`-L`), `.gitignore` respected (library default), add `-I` / exclude patterns for heavy dirs if needed. Capture stdout as a **string** `facts.tree`. On failure, set `facts.error` and empty `tree`.

- **Step 2:** **Manifests:** Glob or walk **only** a fixed allowlist of **relative filenames** (e.g. `package.json`, `pnpm-workspace.yaml`, `package-lock.json`, `pnpm-lock.yaml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pyproject.toml`, `requirements.txt`, `build.gradle`, `settings.gradle.kts` — keep list short and documented). For each file that exists: read UTF-8, truncate to `manifestMaxCharsPerFile`, stop when `manifestMaxFiles` or `manifestMaxTotalChars` exceeded. Store `{ path, content }[]`. **No** `JSON.parse` of `package.json` for architecture purposes (optional parse only if needed for tests — prefer not).

- **Step 3:** **Signals:** Implement `collectSignalsRegex(manifests, treeText): Signal[]` — regex/heuristics over **raw** manifest text and known paths (e.g. `/"next"/` in package.json content, `phoenix` in mix.exs if that file is in allowlist). Keep rules maintainable in one module.

- **Step 4:** **Signals (LLM):** If `config.architecture.signalsMode` is `llm` or `both`, add `collectSignalsLlm(tree, manifests): Promise<Signal[]>` using `@anthropic-ai/claude-agent-sdk` `query` (Haiku, `allowedTools: []`), prompt returns **only** a JSON array of `{ kind, evidence[] }`. Merge: if `both`, union regex + LLM (dedupe by `kind`). If `regex` only, skip SDK call.

- **Step 5:** **ci:** `readdir` / small tree for `.github/workflows` → list filenames (capped).

- **Step 6:** On missing path or non-directory, return facts with `error: 'not_found'` and empty sections (caller skips downstream LLM **full/summary**; signals LLM skipped too).

- **Step 7:** Commit: `feat(ai-memory): add architecture scanner with tree-node-cli and raw manifests`

---

### Task 4: Scanner unit tests

**Files:**

- Create: `test/fixtures/architecture/simple-pnpm/` — `package.json` (include `"next"` in dependencies string), `pnpm-workspace.yaml`, `packages/a/package.json`, minimal `src/index.ts`.
- Create: `test/architecture-scan.test.ts`
- **Step 1:** Test: `facts.tree` is non-empty and contains expected directory names (fixture `packages` or `src`).
- **Step 2:** Test: `facts.manifests` includes `package.json` with **raw** content substring (e.g. `"next"`).
- **Step 3:** Test: regex `signals` includes expected `kind` when `signalsMode` is `regex` (no SDK mock required).
- **Step 4:** Test: `node_modules` under fixture not listed in tree output (tree-node-cli + gitignore/excludes).
- **Step 5:** Run `pnpm vitest run test/architecture-scan.test.ts` — PASS.
- **Step 6:** Commit: `test(ai-memory): cover architecture scanner fixtures`

---

### Task 5: Fingerprint

**Files:**

- Create: `src/architecture/fingerprint.ts` — `fingerprintFacts(facts: ArchitectureFacts): string`
- **Step 1:** Build payload `{ schemaVersion, tree, manifests, ci }` only (optionally include **regex-only** `signals` if you want lockstep with heuristic drift — default **omit** `signals` from hash when `signalsMode` is `llm` or `both`).
- **Step 2:** `JSON.stringify` with `sortKeysDeep`, then `createHash('sha256').update(utf8).digest('hex')`.
- **Step 3:** Unit test: same fixture → same hash; append a character to a fixture `package.json` → different hash.
- **Step 4:** Commit: `feat(ai-memory): add architecture fingerprint helper`

---

### Task 6: LLM prompts and pipeline

**Files:**

- Create: `src/prompts/architecture-full.md` — placeholders: `{{FACTS_JSON}}`, `{{MAX_TOKENS}}`. Instruct: `FACTS_JSON` includes **literal `tree` text** and **`manifests` with filenames**; use them as primary evidence; shallow layers only; no invented paths; output **plain prose** for `architecture_full`.
- Create: `src/prompts/architecture-summary.md` — placeholders: `{{FACTS_JSON}}`, `{{ARCHITECTURE_FULL}}`, `{{MAX_TOKENS}}`. Instruct: coarse tree, key stacks, stay under token budget.
- Optional: `src/prompts/architecture-signals.md` — if signals LLM is a **separate** call from full (otherwise fold signal instructions into full prompt when mode is `llm` only).
- Modify: `src/worker.ts` — add `loadPrompt` calls (reuse existing `loadPrompt` helper pattern).
- **Step 1:** Pipeline order: `scanProjectArchitecture` → (optional) `collectSignalsLlm` per config → serialize **complete** facts (including `signals`) → `generateArchitectureFull` → `generateArchitectureSummary`.
- **Step 2:** Call Haiku for full then summary; if `countTokens(summary) > config.architecture.summaryTokenBudget`, log warning + truncate per `tokens.ts`.
- **Step 3:** Commit: `feat(ai-memory): add architecture Haiku prompts and generator`

---

### Task 7: Worker — scan orchestration and triggers

**Files:**

- Modify: `src/worker.ts`
- **Step 1:** Add `async function scanAndPersistArchitecture(projectId: number, opts?: { force?: boolean }): Promise<boolean>`: load `projects.path`; if `_global` or path missing on disk → return false; if `!config.architecture.enabled` → return false; `await scanProjectArchitecture` (tree + manifests + ci + regex signals) then optional `collectSignalsLlm` per config; compute **fingerprint** from deterministic subset; if `!force` and fingerprint === stored and scan interval not elapsed → return false (see Step 2).
- **Step 2:** **Weekly:** parse `architecture_scanned_at` (ISO); if empty or older than `scanIntervalDays`, allow scan. **Fingerprint:** if fingerprint !== stored `architecture_fingerprint`, allow scan regardless of week (immediate refresh on change). If both unchanged and within week, skip.
- **Step 3:** On success: `updateProjectArchitecture` with JSON stringified facts (include `scannedAt`), full, summary, fingerprint, `scanned_at` now.
- **Step 4:** In `startWorker` interval (after existing work or alongside `checkProjectSummaries`), every N polls call `checkArchitectureScans()` iterating `listProjects()` where `path != '_global'` — cap projects per tick (e.g. max 3) to avoid stalls.
- **Step 5:** Log and `broadcast` on success (reuse pattern `broadcast('counts:updated')` or new event if UI needs it later).
- **Step 6:** Commit: `feat(ai-memory): wire architecture scan into worker loop`

---

### Task 8: Context injection

**Files:**

- Modify: `src/context.ts`
- **Step 1:** After `<memory-context project="...">` open tag, if `getConfig().architecture.enabled`, fetch `architecture_summary` for project id; if non-empty, append `## Project architecture` section + summary text + short legend line that this is filesystem-derived.
- **Step 2:** If enabled but empty, omit section (spec allowed one-line “not yet” — **prefer omit** to save tokens unless you want explicit hint; if omit, no extra line).
- **Step 3:** Add test in `test/context-architecture.test.ts`: seed DB with `architecture_summary`, call `buildStartupContext`, expect section appears **before** `## Memories` or `## Project Summary`.
- **Step 4:** Run `pnpm vitest run test/context-architecture.test.ts test/context-domains.test.ts`.
- **Step 5:** Commit: `feat(ai-memory): inject architecture summary first in startup context`

---

### Task 9: Cleanup prompt and variables

**Files:**

- Modify: `src/prompts/cleanup.md`
- Modify: `src/worker.ts` (`cleanupWithLLM`)
- **Step 1:** Add block `PROJECT ARCHITECTURE SUMMARY (may be empty):` + `{{ARCHITECTURE_SUMMARY}}`.
- **Step 2:** Document **Architecture-redundant** rule and **empty summary** = do not use that rule; keep decisions/patterns/preferences/solutions.
- **Step 3:** In `cleanupWithLLM`, `getProjectArchitecture(projectId).summary` passed as `ARCHITECTURE_SUMMARY` (empty string when none).
- **Step 4:** Commit: `feat(ai-memory): pass architecture summary into LLM cleanup`

---

### Task 10: MCP tool (and optional HTTP)

**Files:**

- Modify: `src/tools.ts`
- Modify (optional): `src/app.ts`
- **Step 1:** Register `rescan_project_architecture` with input `project` optional (default `PWD`), `force` optional boolean. Resolve project, call exported `runArchitectureRescan(projectId, { force })` from worker module (export a thin public API from `worker.ts` to avoid circular imports — if needed put orchestration in `src/architecture/run-scan.ts` imported by worker and tools).
- **Step 2:** Return JSON `{ ok, scanned, message }`.
- **Step 3 (optional):** `POST /api/projects/:id/architecture` same as summary route — triggers rescan with `force: true`.
- **Step 4:** Update `skills/memory-management/SKILL.md` or MCP tool list in README if tools are documented.
- **Step 5:** Commit: `feat(ai-memory): add MCP rescan_project_architecture tool`

---

### Task 11: Documentation

**Files:**

- Modify: `docs/data-model.md` — extend `projects` table with new columns.
- Modify: `docs/lifecycle.md` — cleanup section mentions architecture summary input; new short subsection on architecture scan cadence.
- Modify: `README.md` — feature blurb + config keys.
- **Step 1:** Update design spec footer **Status** to reference this plan as approved for implementation (optional one-line edit to spec file).
- **Step 2:** Commit: `docs(ai-memory): document architecture snapshot feature`

---

### Task 12: Final verification

- **Step 1:** `cd ai-memory && pnpm build`
- **Step 2:** `pnpm vitest run test/`
- **Step 3:** Commit any fixes: `fix(ai-memory): …` if needed

---

## Plan review (optional)

After implementation, optionally dispatch a focused review of this plan vs delivered code (drift check). Max three review iterations per superpowers guidance.

---

## Execution handoff

Plan complete and saved to `ai-memory/docs/superpowers/plans/2026-03-20-project-architecture-snapshot.md`.

**1. Subagent-driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline execution** — run tasks sequentially in this session with checkpoints.

Which approach do you want for implementation?