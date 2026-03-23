# Project Architecture Snapshot


## Problem

ai-memory injects **conversation-derived memories** at session start and uses them in periodic **LLM cleanup**, but it does not maintain a **deterministic, repo-grounded picture** of each project: layout, stacks, manifests, and similar facts that can be read from disk without inferring from chat.

Without that layer:

- Models repeat trivial facts in memories (“this is a pnpm monorepo”) that belong in a stable snapshot.
- Cleanup cannot distinguish **static redundancy** (already implied by the repo) from **durable knowledge** (decisions, patterns, preferences).
- Session context starts from synthesized history instead of **physical context first**, which is how humans orient themselves in a codebase.


## Goals

1. **Extract deterministic facts** from the project directory (and optionally lightweight git signals) with clear limits (depth, ignores, caps) so scans are reproducible and bounded.
2. **Persist** a structured record per project, including:
   - **Facts** (JSON or equivalent) — source of truth from the scanner.
   - **`architecture_full`** — shallow, Haiku-generated **interpretation** of those facts (surface-level: what folders are for, major boundaries, domains). Not deep file-by-file analysis; cap depth and tokens.
   - **`architecture_summary`** — short text suitable for **always-on injection** at the start of `<memory-context>`: preserves a coarse tree feel, names key stacks and roots, under a strict token cap (e.g. ≤500 tokens, validated with existing `countTokens` / project token tooling).
3. **Inject `architecture_summary` first**, then existing memory content (deterministic memory list, or cached **Project Summary** when over budget, per current `context.ts` behavior).
4. **Extend the existing periodic LLM cleanup job** (`cleanupWithLLM` + `cleanup.md`) so the curator sees `architecture_summary` and may remove items that are **only** redundant with that snapshot (with strict rules so decisions/patterns are not dropped).
5. **Rescan policy** — combine:
   - **Time-based:** at most once per week per project (configurable), for repos that are idle.
   - **User-initiated:** MCP tool (and optionally dashboard) to force rescan.
   - **Change-based:** compare a **cheap deterministic fingerprint** (manifest hashes, top-level structure, lockfile fingerprints, etc.) to the last stored fingerprint; if over a threshold, queue a rescan. Do **not** rely on an LLM alone to detect “major changes.”


## Non-goals (v1)

- Full AST indexing, call graphs, or semantic “architecture” across every file.
- Real-time filesystem watching as the **only** trigger (optional later).
- Perfect stack detection: signals may be **heuristic with provenance** (e.g. “`package.json` lists `next`”) rather than a single boolean “is Next.js app.”
- Replacing **Project Summary** of memories — architecture answers **where / what stacks**; memory summary answers **what we decided and remember**.


## Concepts

### Deterministic layer vs interpretation

| Layer | Role | Trust |
|-------|------|--------|
| **Facts (JSON)** | Tree/manifest fingerprints, workspace roots, dependency names, CI hints | Ground truth for diffing and for regenerating text |
| **`architecture_full`** | Haiku labels groupings, names subsystems, ties facts to plain language | Useful but subordinate to facts; regenerate when facts change |
| **`architecture_summary`** | Condensed string for injection + cleanup | Must stay within token budget; derived from facts + optionally trimmed from full |

If interpretation conflicts with facts, **facts win**; prompts should state this for any future editor UI.


### Redundancy in cleanup

**Safe to treat as redundant** with `architecture_summary`:

- Memories that **only** restate static layout, stack, or obvious directory presence already covered by the summary.

**Not redundant** merely because the topic overlaps:

- **decision**, **pattern**, **preference**, **solution** — rationales, ADRs, “we chose X because…”, non-obvious conventions.
- Anything that adds **why** or **how we work here** beyond what a filesystem scan shows.

**When `architecture_summary` is empty** (not scanned yet or project path invalid): cleanup **must not** apply the architecture-redundancy rule; other cleanup rules unchanged.


### `_global` project

The `_global` pseudo-project has **no meaningful repo root**. v1: **do not** run filesystem architecture scans for `path = '_global'`; leave architecture fields empty. Injection and cleanup behave as today for global-only scope.


## Data model

Add columns on `projects` (exact names can be adjusted in implementation; semantics are fixed):

| Column | Type | Purpose |
|--------|------|---------|
| `architecture_facts` | TEXT NOT NULL DEFAULT `''` | JSON string: `tree` (from tree-node-cli), raw `manifests` `{path,content}[]`, `ci`, optional `signals` (regex and/or LLM), `schemaVersion`, `scannedAt` |
| `architecture_full` | TEXT NOT NULL DEFAULT `''` | Haiku interpretation; shallow, bounded tokens |
| `architecture_summary` | TEXT NOT NULL DEFAULT `''` | Injected + passed to cleanup; ≤ configured max tokens |
| `architecture_fingerprint` | TEXT NOT NULL DEFAULT `''` | Hash of **deterministic** inputs (`tree` + manifests + `ci`; exclude LLM-only `signals`) |
| `architecture_scanned_at` | TEXT NOT NULL DEFAULT `''` | Last successful scan timestamp |

**Idempotency:** migrations follow existing `PRAGMA table_info` pattern in `src/db.ts`.

**Optional later:** separate `architecture_snapshots` history table for audit/diff UI — not required for v1.


## Scanner (deterministic + bounded I/O)

**Inputs:** absolute project path (must exist and be a directory; skip otherwise).

**Outputs:** JSON in `architecture_facts` including at minimum:

- `schemaVersion` — integer for forward compatibility.
- `scannedAt` — ISO8601.
- `roots` — optional in v1; if omitted, workspace/package roots are inferred by the LLM from `tree` + workspace manifest **filenames** and raw snippets (no dedicated monorepo parser required).
- `tree` — **directory layout via [tree-node-cli](https://www.npmjs.com/package/tree-node-cli)** (or equivalent maintained `tree`-style Node API). Use max depth (`-L`), respect `.gitignore` (package default), and extra exclude patterns (`node_modules`, `dist`, `.git`, etc.) so output stays bounded. Prefer the library’s **programmatic API** if exposed; otherwise spawn the CLI with documented flags. (Upstream CLI binary is often `treee` to avoid colliding with system `tree`.)
- `manifests` — **simple, not parsed per format.** Collect a small allowlist of paths (e.g. `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pyproject.toml`, `requirements.txt`, lockfiles) when present. For each file: `{ "path": "<relative path>", "content": "<utf-8 text, truncated per-file and total caps>" }`. **Do not** implement parsers for every ecosystem; the **filename + raw snippet** is fed to the LLM so it can interpret stacks and dependencies. Caps prevent huge lockfiles from blowing the prompt.
- `signals` — structured hints `{ kind, evidence }[]` (e.g. `{ "kind": "next", "evidence": ["package.json"] }`). Produced by **either**:
  - **Regex / heuristics** over raw manifest text and paths (cheap, deterministic, good enough for many repos), **or**
  - A **Claude Agent SDK** (`query`, Haiku, no tools) call that takes `tree` + `manifests` and returns **only** JSON signals, **or**
  - **Both:** regex baseline plus an optional LLM pass when config requests richer signals.
  Fingerprinting for “what changed on disk” should depend on **`tree` + manifest `path`/`content`**, not on LLM-only signal text, so rescans stay tied to filesystem drift.
- `ci` — lightweight: list `.github/workflows` filenames (or small tree of `.github`), no need to inline large YAML unless desired and capped.

**Performance:** single-threaded; hard caps on tree depth, manifest count, bytes per manifest, total manifest bytes; fail soft (`error` field) rather than blocking the worker indefinitely.

**Implementation location:** `src/architecture/scan.ts` (and helpers), `package.json` dependency on `tree-node-cli`; worker / MCP call sites unchanged at the boundary.


## LLM passes

1. **Full (Haiku):** input = JSON facts including **raw `tree` string** and **`manifests` (path + content snippets)**; output = prose `architecture_full` with strict max tokens. Instructions: shallow layers only, do not invent paths not present in `tree`/manifests, treat filenames as strong hints for stack detection, cite uncertainty if needed.
2. **Optional signals pass (Haiku / SDK):** if not using regex-only signals, a small structured-output call can run **before** or **merged into** the full pass — same input budget discipline.
3. **Summary:** input = facts + optional `architecture_full`; output = `architecture_summary` within hard token limit; preserve coarse tree / key roots in short form.

Validation: reject or trim if `countTokens(architecture_summary) > architectureSummaryTokenBudget` (config default aligns with “~500 tokens” — exact number in config).


## Context injection (`src/context.ts`)

Order inside `<memory-context>`:

1. **`## Project architecture`** (or similar fixed heading) — `architecture_summary` when non-empty; if empty, omit section or one-line “No architecture snapshot yet.”
2. **Existing memory block** — unchanged priority: deterministic memories vs Project Summary vs truncated deterministic, as today.
3. **Tags, domains, categories, tip, dashboard** — unchanged unless token budget requires documenting interaction.

**Token budget:**

- Introduce **`architectureSummaryTokenBudget`** (or reuse a single `startupContextTokenBudget` with documented split). Architecture is **reserved first**; **remaining** budget goes to memories/summary so adding architecture does not silently zero out memories without config visibility.

Document defaults in `src/config.ts` and `README.md`.


## Cleanup (`src/worker.ts` + `src/prompts/cleanup.md`)

- Pass **`architecture_summary`** into the cleanup prompt as `{{ARCHITECTURE_SUMMARY}}` (empty string when none).
- Extend deletion criteria in `cleanup.md`:
  - **Architecture-redundant:** only when summary is non-empty; only for items that duplicate **static** information fully covered by the summary.
  - Explicitly **keep** decisions, patterns, preferences, solutions unless they are true duplicates of **another memory**, not merely related to architecture.

Periodic behavior unchanged: `runCleanup` iterates projects; no second job.


## Rescan triggers

| Trigger | Behavior |
|---------|----------|
| Weekly | If `now - architecture_scanned_at > config.architectureScanIntervalDays` and path exists, queue scan |
| MCP | Tool e.g. `rescan_project_architecture` with project path or current project |
| Fingerprint delta | On session start or worker tick, optional lightweight check: if fingerprint differs materially from stored, queue scan (debounce to avoid thrashing) |

**LLM “major change” detection** is **out of scope** as a primary signal; optional hint only if we add it later.


## Configuration

New keys in `config.yaml` / Zod (names illustrative):

- `architecture.summaryTokenBudget` — default ~500
- `architecture.scanIntervalDays` — default 7
- `architecture.enabled` — default true (false disables injection and scanner)

Exact names follow existing `context.memoryTokenBudget` style.


## Testing

- Unit tests: scanner on fixture directories (minimal fake trees in `test/fixtures/`).
- DB migration: new columns appear idempotently.
- `buildStartupContext`: ordering and omission when summary empty (snapshot tests or string assertions).
- Cleanup prompt: mock or integration test that **empty** `ARCHITECTURE_SUMMARY` does not delete memory flagged only for architecture (manual review of prompt + optional golden test for JSON shape).

LLM calls may stay integration-tested via worker patterns (consistent with existing synthesis/cleanup tests).


## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Stale summary deletes good memories | Cleanup rule only when summary non-empty; prefer category guards; optional “max age” for redundancy rule |
| Token blowup | Hard caps + config + `countTokens` validation |
| Wrong stack inference | Store **signals + evidence** in facts JSON; summary wording cautious |
| Large monorepos | Strict caps, workspace-aware roots, summarize large dirs |


## Open questions (resolve before implementation)

1. Exact **default token budgets** for architecture vs memories (numbers and whether one global cap splits 80/20).
2. Whether **`architecture_full`** is user-visible in dashboard v1 or worker-only until polished.
3. **Fingerprint** exact formula (hash of normalized JSON facts vs separate file hashes).
4. **`signals` mode** — **Resolved in implementation plan:** default `regex`; config `signalsMode`: `regex` \| `llm` \| `both`; separate token cap for signals-only SDK call when needed.


## Relationship to existing specs

- **Summary-based context injection** (`2026-03-15-summary-based-context-injection-design.md`): Project Summary of **memories** remains; **architecture summary** is a **new first section** and does not replace memory summarization.
- This spec should be read together with `docs/data-model.md` when updating the `projects` table documentation.


---

**Status:** Spec approved for implementation. **Plan:** `docs/superpowers/plans/2026-03-20-project-architecture-snapshot.md` (resolves open questions: token defaults, `architecture_full` v1 visibility, fingerprint algorithm).
