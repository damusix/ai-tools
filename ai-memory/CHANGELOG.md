# Changelog

## 1.5.5

### Bug Fixes

- **move /api/memories/deleted route before :id param routes** [#d22cc31](https://github.com/damusix/ai-tools/commit/d22cc31d1e2a1b27d854904fcc2e92219875c0ba)
  Hono matched /api/memories/deleted as /api/memories/:id with id="deleted",
  returning "Invalid memory ID". Fixed by registering the /deleted and
  /:id/restore routes before the /:id wildcard routes.
## 1.5.4

### Bug Fixes

- **exclude soft-deleted memories from all counts and queries** [#f100a75](https://github.com/damusix/ai-tools/commit/f100a75726583608d0907bdea9d2db018325c808)
  Add deleted_at = '' filter to: listProjects memory_count, stats
  endpoint, listDomains/listCategories JOIN counts, and worker
  backfill/enrichment eligibility queries. Context builder and
  search functions were already filtered.
## 1.5.3

### Features

- **recover orphaned jobs on restart, add cancel button** [#65e2d3e](https://github.com/damusix/ai-tools/commit/65e2d3eacc4f8a99563cfe3bbf390c0d93ea0f01)
  - Reset 'processing' distillation jobs to 'pending' on worker startup
  - Add DELETE /api/projects/:id/distillation endpoint to cancel jobs
  - Show ✕ cancel button next to "Distilling..." in the dashboard
### Bug Fixes

- **replace Run Now with status when distillation is queued** [#4cc5d44](https://github.com/damusix/ai-tools/commit/4cc5d4441e7d3b9655ed349ab84db95c852f90f1)
  Query distillation_queue for pending/processing entries per project.
  Show "Distilling..." instead of the button when a job is active,
  preventing double-enqueue from the UI.
## 1.5.2

### Bug Fixes

- **use Sonnet model, Zod validation, retries, and failure status** [#a116dd8](https://github.com/damusix/ai-tools/commit/a116dd86e20a9a1cef7a4bca52b93798a50fa00a)
  - Switch from Haiku to Sonnet for reliable raw JSON output
  - Replace regex extraction with JSON.parse + Zod safeParse
  - Add configurable retry loop (maxRetries, default 2)
  - Store distillation_status and distillation_error on projects table
  - Show failure reason in red in dashboard distillation controls
  - Strengthen prompt to enforce raw JSON (no code fences)
## 1.5.1

### Features

- **show plugin version in dashboard header** [#703f1ed](https://github.com/damusix/ai-tools/commit/703f1ed9d849017cccbcabb7a6f83bb54c41754a)
## 1.5.0

### Features

- **add deleted memories sidebar, distillation controls, and modal wiring** [#47cf6b9](https://github.com/damusix/ai-tools/commit/47cf6b91f42f196ca2d9714382fc200d5f557e35)
- **add deleted mode to MemoryDetailModal** [#2f5b2c8](https://github.com/damusix/ai-tools/commit/2f5b2c8a96726437983231d7ac3ac726bce9781d)
- **add API endpoints and SSE event** [#5003f51](https://github.com/damusix/ai-tools/commit/5003f51b5a5ea65328a12db259ca80593c508d5d)
- **add settings section to dashboard** [#e28f33a](https://github.com/damusix/ai-tools/commit/e28f33a8c628df97a567d8c8dd14c5a15257e015)
- **add deleted memories help topic** [#2ac786f](https://github.com/damusix/ai-tools/commit/2ac786ffd61b332b9994bd7411d9689833559edd)
- **add restoreMemory, listDeletedMemories, distillation columns in listProjects** [#b983f32](https://github.com/damusix/ai-tools/commit/b983f32ee9940679c0730015f14524c43b0b77cc)
## 1.4.0

### Features

- **wire into worker loop and enqueue handler** [#ac62c97](https://github.com/damusix/ai-tools/commit/ac62c976d987fd577427892acfd8fc0ff748767a)
- **add orchestrator with signal gathering and LLM batching** [#61500e3](https://github.com/damusix/ai-tools/commit/61500e39d14c1cec3e6b21810a8c87f8b0694f4e)
- **add LLM prompt template** [#21f0881](https://github.com/damusix/ai-tools/commit/21f08818344a8a733f970dbeee62e1eede57ab98)
- **add queue helpers, soft-delete, and eligibility checks** [#e2e0b61](https://github.com/damusix/ai-tools/commit/e2e0b61693583cc79e65f28210b3763e1f6ec993)
  Add distillation queue (enqueue/dequeue/complete), soft-delete functions
  (softDeleteMemory, purgeDeletedMemories), distillation state management
  (increment/reset counter, eligibility check), and listActiveMemoriesByDomain.
  Filter soft-deleted memories from listMemories, searchMemories, and
  searchMemoriesFuzzy. Wire incrementDistillationMemoryCount into insertMemory.
- **add db migrations for soft-delete and queue** [#5dc58b9](https://github.com/damusix/ai-tools/commit/5dc58b94adca18e84e0c19e5d42fe45613d30560)
- **add config schema with defaults** [#7c02cab](https://github.com/damusix/ai-tools/commit/7c02cabbe70e24de99892244831b4074331da532)
## 1.3.1

### Features

- **add ralph-loop with curl-installable installer** [#daeadaf](https://github.com/damusix/ai-tools/commit/daeadaf083485dd5b0db5d37b8c03a8bf9ec1ec4)
  Add ralph-loop, an autonomous coding loop that drives AI agents through
  iterative development cycles. Includes install script for native setup
  via curl | bash, Docker environment, and test suite.
- **changelog renders commit body as structured h4 sections with GitHub commit links** [#e1503a6](https://github.com/damusix/ai-tools/commit/e1503a6b7ecf9f1ce402c60c567c1e174f6a9508)
### Bug Fixes

- **improve ai-memory mcp instructions; fix ralph loop feedback** [#8125d96](https://github.com/damusix/ai-tools/commit/8125d96f3dce70e9f33ff1a9013abeac8f9b9609)
## 1.3.0

### Features

- **architecture snapshots, git-root consolidation, dashboard overhaul** [#0985ad1](https://github.com/damusix/ai-tools/commit/0985ad1ecfbef6aa591f697d3bacc3bc19eed478)
  - **Architecture Snapshot System:**
  - Deterministic scanner: tree-node-cli + raw manifest collection + regex signal detection
  - Manifest support for 30+ file types: PHP (composer.json), Java (pom.xml, build.gradle),
    .NET (.csproj, .sln), Python (pyproject.toml, requirements.txt, Pipfile), Rust (Cargo.toml),
    Go (go.mod), Ruby (Gemfile), Elixir (mix.exs), Docker, CMake, and more
  - ~30 framework signal rules: Next.js, Laravel, Django, Rails, Flask, FastAPI, Vue, Svelte,
    Angular, Phoenix, Spring, .NET, and others
  - Extension-based matching for variable-name files (.csproj, .sln, .gemspec)
  - LLM pipeline: Haiku generates architecture_full + token-capped architecture_summary
  - Fingerprint-based change detection (SHA-256 of deterministic payload)
  - Worker scans on first tick, then every 4 ticks; logging throughout pipeline
  - architecture_summary injected at session start before memories
  - architecture_full truncation with countTokens budget enforcement
  - signalsLlmMaxTokens wired via prompt instruction + post-response truncation
  - MCP tools: rescan_project_architecture (full pipeline), scan_project_architecture (deterministic only)
  - Fix: prompts path resolution for tsup bundled output (join(__dirname, 'prompts'))
  - **Git-Root Project Consolidation:**
  - Background worker detects git root + remote URL via zx shell commands
  - Optional auto-merge of subfolder projects into git root project
  - Transactional merge: moves memories/observations/queues, tags with subpath:<relative>
  - Global config toggle (projects.consolidateToGitRoot) + per-project DB override (yes/no/default)
  - API: PUT /api/projects/:id/consolidate, POST /api/consolidate (trigger manual run)
  - New columns: git_root, git_url, consolidate on projects table
  - New dependency: zx@8.8.5
  - **Dashboard UI:**
  - Architecture section: collapsible panel below AI Summary with cyan accent, signal badges
    (deduped + sorted), regenerate button, expand button for detail modal
  - ArchitectureModal: three-tab view (Summary, Full Analysis, Raw Facts) with markdown
    rendering via remark + remark-gfm + remark-html
  - Raw Facts tab: structured sections (Tree as scrollable code block, Signals as badges
    with evidence tooltips, Manifests with path labels, CI workflows, Metadata)
  - Prose typography overhaul: system font stack, tighter heading scale, styled code/pre/table/blockquote
  - Git info display per project (branch icon + root path + remote URL)
  - Consolidation toggle: three-state (Default/Always/Never) with help drawer
  - Kobalte tooltips on all info buttons (hover for hint, click for help drawer)
  - Collapse/expand all buttons at global, project, and domain levels
  - Menu dropdown reorganized with Views/Actions/Server section labels
  - Settings: Projects section with global consolidation toggle (boolean field support)
  - Dashboard fetches all memories and observations (removed limit=100 cap)
  - Fix: observations API limit=0 now means no limit (was returning zero rows)
  - **Docs & Tests:**
  - Design specs: architecture snapshot, architecture dashboard UI, git-root consolidation
  - Implementation plans: architecture gaps, dashboard UI, git consolidation
  - Test fixtures: PHP/Laravel (composer.json + artisan), TypeScript (tsconfig.json)
  - Tests: architecture scanner, PHP/Laravel signals, TypeScript detection, fingerprint,
    git detection (zx), consolidateProject merge with subpath tags
  - README: architecture snapshot feature blurb, MCP tools table entries
  - Help content: consolidation.md explaining the feature and monorepo handling
## 1.2.1

### Features

- **empty project cleanup, bulk delete, keyboard shortcuts, and project display filtering** [#c54a178](https://github.com/damusix/ai-tools/commit/c54a17874650590e049212e87c62e37ae77c63c1)
  - Filter empty projects (0 memories + 0 observations) from listProjects SQL, always keeping _global
  - Add deleteEmptyProjects() with 3-hour grace period and auto-run in worker poll cycle
  - Add batchDeleteProjects() for transactional multi-project deletion
  - Add DELETE /api/projects/batch and POST /api/projects/cleanup-empty endpoints
  - Add Delete mode tab to TransferModal with multi-select, two-step confirmation, and total counts
  - Add "Purge empty projects" menu button
  - Add keyboard shortcuts (Ctrl+, Settings, Cmd+P Search, Cmd+Shift+P Projects, Cmd+J Logs)
  - Auto-start log streaming when logs panel opens
### Bug Fixes

- **hook JSON parsing and tiktoken-based token counting** [#3ed8a77](https://github.com/damusix/ai-tools/commit/3ed8a7702acd1bc657695dd3ad3c2d5c33a1ba6b)
  Redirect setup.sh stdout to log file so diagnostic messages don't
  pollute the JSON response, fixing SessionStart hook parsing failures.
  Replace chars/4 approximation with js-tiktoken (cl100k_base) for
  accurate token budget enforcement in context injection and summary
  generation. Always prefer cached summary over truncated deterministic
  listing when memories exceed budget.
## 1.2.0

### Features

- **summary-based context injection, memory detail modal, and merge UX improvements** [#b1de5f8](https://github.com/damusix/ai-tools/commit/b1de5f8c3b780bbacf8b9b6c96e46a87231cb2e9)
  Replace the deterministic memory formatter with LLM-generated prose summaries
  for large projects. Summaries are cached per project in the DB, regenerated
  incrementally when memories change (via hash-based change detection and delta
  computation), and deduplicated against the project's CLAUDE.md chain. Small
  projects that fit within the token budget continue using the existing
  deterministic formatter.
  - **Summary engine (src/summary.ts):**
  - computeMemoryHash() for aggregate change detection (salted with token budget)
  - computeMemorySnapshot() for per-memory content hashing
  - computeSummaryDelta() for detecting additions, updates, and deletions
  - loadClaudeMdChain() walks directories like Claude Code to collect CLAUDE.md files
  - generateSummary() calls Haiku in full or incremental mode
  - checkProjectSummaries() integrated into worker poll loop at configurable interval
  - **Context injection (src/context.ts):**
  - Three-way branch: everything fits → deterministic, cached summary exists → prose,
    fallback → truncated deterministic
  - Summary includes inline memory ID citations (#id) for traceability
  - **Dashboard:**
  - AI Summary section per project with generate/regenerate buttons and loading states
  - Collapsible with localStorage persistence, works in single-project and all-projects views
  - Memory detail modal with inline editing, dirty tracking, and URL routing (?memory=123)
  - Merge modal: regex filter input, orange highlight styling for selected sources
  - **Merge improvements:**
  - Transferred memories prefixed with [Merged from ~/path/to/source] for origin context
  - Automatic full summary regeneration on target project after merge
  Schema: 4 new columns on projects table (summary, summary_hash, summary_snapshot,
  summary_incremental_count), 3 new DB functions, POST /api/projects/:id/summary endpoint
- **URL-based routing, flaky test fix, and delete confirmation UX** [#869886f](https://github.com/damusix/ai-tools/commit/869886f3366ae76930484d35ca437047d4369a5a)
  - Sync modal state with URL query params (?settings, ?merge, ?help, ?logs)
    so browser back/forward and bookmarks work
  - Fix flaky tests: use mkdtempSync for isolated temp dirs instead of
    shared tmp/ that config tests would delete out from under other files
  - Taxonomy delete always shows confirmation modal
- **restructure dashboard header with search filters, menu dropdown, and branding** [#b4ce0fb](https://github.com/damusix/ai-tools/commit/b4ce0fbbd839c6d8745ec75cf94aa19a6c08234f)
- **add changelog command and update docs** [#a40f4d0](https://github.com/damusix/ai-tools/commit/a40f4d0081e030840a8367f00e7d069188843658)
## 1.1.1

### Features

- **skip delete confirmation for zero-count taxonomy items** [#6474416](https://github.com/damusix/ai-tools/commit/647441631eab3edca514ccb0ca14787c485ce7b2)
- **show memory count on domain headers** [#5961a01](https://github.com/damusix/ai-tools/commit/5961a0153f63b975fbf097c60c6fbe734369264c)
- **add stderr logging to hooks.log for hook debugging** [#4d1c07e](https://github.com/damusix/ai-tools/commit/4d1c07eeb3d060a8d90103421c41ef9391c45d4c)
  Redirect stderr from all hook scripts to ~/.ai-memory/hooks.log
  with timestamped entries, enabling diagnosis of intermittent hook errors.
## 1.1.0

### Features

- **add search bar with dual-index word+trigram results** [#e9a4a9e](https://github.com/damusix/ai-tools/commit/e9a4a9e5c6070b7aa60a15f1766810d6259aa554)
- **add PreToolUse hook to inject taxonomy before search_memories** [#9c48395](https://github.com/damusix/ai-tools/commit/9c48395bee25a264ac5a51fceec8dec1d58b4f3f)
- **inject domain and category taxonomy into startup context** [#0915e18](https://github.com/damusix/ai-tools/commit/0915e18856e1a5e2bb1c9c39bc2354f1e3575842)
- **add /api/search with dual-index word+trigram search** [#707db9b](https://github.com/damusix/ai-tools/commit/707db9b78f0c6c019f6f3569aae52ae4fdb9a617)
- **add /api/taxonomy-summary endpoint for hook consumption** [#028bdb4](https://github.com/damusix/ai-tools/commit/028bdb4f54aa72a6c6872b87df1c653aa73d32a2)
- **add prefix wildcards to /api/recall for better search matching** [#92470c1](https://github.com/damusix/ai-tools/commit/92470c1e76cff0e6af4da8b68b6434af59c8c4a9)
- **add searchMemoriesFuzzy() for trigram substring matching** [#6406362](https://github.com/damusix/ai-tools/commit/6406362fbea4cb065acae957a572b3e46040c8b5)
- **support limit=0 for unlimited results in search and list functions** [#cffe6ee](https://github.com/damusix/ai-tools/commit/cffe6ee88287248dc59f82733641e933b4c944f7)
- **add trigram FTS5 table with sync triggers and backfill** [#7154e96](https://github.com/damusix/ai-tools/commit/7154e964dcc187d8a752f20371896f9fbdfff6b3)
- **self-healing setup, version bump to v1.0.0** [#8520940](https://github.com/damusix/ai-tools/commit/852094059ccb1589766ba32c687c105f0999679b)
  - **Cascading setup diagnostics for plugin cache installs:**
  - If no node_modules → pnpm install
  - If no native addon → pnpm rebuild better-sqlite3
  - If no dist/server.js → pnpm build
  Startup hook now always runs setup (cheap when healthy).
  Removed sync-versions from build.sh (release concern, not build).
  Bumped plugin.json to 1.0.0.
- **first-run setup, help docs, prerequisites, and platform support** [#a709940](https://github.com/damusix/ai-tools/commit/a709940645aec0bd1f719c11cda79d5e08655a33)
  - startup.sh detects missing dist/server.js and runs setup.sh automatically
  - setup.sh now validates pnpm is installed alongside node and sqlite3
  - README adds Prerequisites section (Node.js 22+, pnpm, sqlite3 with FTS5)
  - README adds Platform Support table (macOS tested, Linux high confidence, Windows WSL likely, native unsupported)
  - New settings.md help file covering config, domains, categories, and restore defaults
  - Updated about.md, domains.md, memories.md, observations.md with new feature docs
  - Settings modal gets help button linking to settings help topic
  - Version sync script and build.sh integration
- **unified delete, restore defaults, overflow fixes, project delete buttons** [#f3f4876](https://github.com/damusix/ai-tools/commit/f3f48766d34b376abdc9b6b0d53e9b6678e2e049)
  - Replace two-button taxonomy delete with single button + confirmation modal
  - Add per-tab restore defaults button in Settings footer
  - Fix observation sidebar and card overflow with truncation
  - Add project delete buttons to memory and observation headers on hover
- **export taxonomy seeds, restore-defaults API, help text in settings** [#cb91dec](https://github.com/damusix/ai-tools/commit/cb91dec465745ca04e92a57d5231b692ae4777e2)
  - Extract domain/category seeds to module-level exports in db.ts
  - Add restoreDefaultDomains/restoreDefaultCategories functions
  - Add POST /api/domains/restore-defaults and /api/categories/restore-defaults endpoints
  - Add help text to Domains/Categories tabs and AI generate panel explanation
- **display project icons and descriptions in dashboard** [#28b5327](https://github.com/damusix/ai-tools/commit/28b532768eaafe405cb3c3ad03fff55fca9a1edf)
- **unified Settings modal with Configuration/Domains/Categories tabs, AI generation, force-delete** [#216da66](https://github.com/damusix/ai-tools/commit/216da66ce646a190b1b9666a3f8fd9643a20be0d)
- **auto-enrich projects with AI description and icon after 5 memories** [#b640260](https://github.com/damusix/ai-tools/commit/b64026036e8972e2ba4b882b170aa6d6e940f382)
- **project deletion with confirmation modal** [#14f4004](https://github.com/damusix/ai-tools/commit/14f400401157c168f9c8f3747d40210dc5694e8a)
- **redesign transfer flow — target-first, multi-select sources, batch API** [#75f9def](https://github.com/damusix/ai-tools/commit/75f9deff68e4119813fd60690e548f00beed40d5)
- **add stop button with confirmation, show memory reason on cards** [#282b30c](https://github.com/damusix/ai-tools/commit/282b30c1a8e8ef5685b2b99d4ab66e917f7358d5)
- **worker passes reason to memory create/update, prompt requests reason field** [#1c39877](https://github.com/damusix/ai-tools/commit/1c39877327c7355019cdcba76cbda28b76b16fc3)
- **add reason to MCP save_memory tool, update Memory/Project types** [#0adc10c](https://github.com/damusix/ai-tools/commit/0adc10cd081d35f0e5c29653503358003fe55897)
- **API endpoints for project delete, stop, force-delete taxonomy, AI generate, batch transfer** [#26cf45c](https://github.com/damusix/ai-tools/commit/26cf45c6987bec316635fd22f14e4c295bd8e347)
- **add reason to memories, icon/description to projects, deleteProject, forceDeleteTaxonomy** [#bd43d83](https://github.com/damusix/ai-tools/commit/bd43d83f9ea48b68fd095986767614d44438c84a)
- **upgrade ConfirmModal with configurable labels, nested z-index support** [#8d4d56c](https://github.com/damusix/ai-tools/commit/8d4d56cef25694bcc543db9ff50877f29367c72d)
- **wire Taxonomy page into dashboard, use dynamic icons from API** [#6d52200](https://github.com/damusix/ai-tools/commit/6d522004c0231af1abddd95e1f52665ee17a0068)
- **categorized searchable icon picker from FA categories data** [#0589370](https://github.com/damusix/ai-tools/commit/058937024fd3473cdba783fe4aa76cd8e4af928f)
- **add Taxonomy management page component** [#4c71db6](https://github.com/damusix/ai-tools/commit/4c71db6278469d28713c2561bafb78fd61379965)
- **load Font Awesome 7 via CDN for taxonomy icons** [#3e96b0a](https://github.com/damusix/ai-tools/commit/3e96b0af9a20d769eec30b308fba9de2516a33f3)
- **add synthesisTimeoutMs to settings UI** [#fe61bb9](https://github.com/damusix/ai-tools/commit/fe61bb98505028dba1b6a1b09462cee4e80842b7)
- **stale observation synthesis trigger, dynamic categories in LLM prompts** [#2e47ef7](https://github.com/damusix/ai-tools/commit/2e47ef7fc56367adb4448cd73ca484948d50c9d9)
- **dynamic category params in MCP tools, add list_categories tool** [#83a552d](https://github.com/damusix/ai-tools/commit/83a552de04a3403b638ce9b4d5a94fe6837f4b3f)
- **add CRUD API endpoints for domains and categories** [#aba4fa6](https://github.com/damusix/ai-tools/commit/aba4fa6041f5c9b729f8391fc48b2a9aa2b8d8ee)
- **add CRUD functions for domains, categories, and stale observation detection** [#e91e16b](https://github.com/damusix/ai-tools/commit/e91e16b1a95017b59df733203594da32a6bf9f3a)
- **add categories table, icon column to domains, remove CHECK constraint** [#c6ce9b2](https://github.com/damusix/ai-tools/commit/c6ce9b2242118762711726c1d8c4181a4c630787)
- **add synthesisTimeoutMs config for time-based synthesis fallback** [#7c44186](https://github.com/damusix/ai-tools/commit/7c44186f9a02650042b9d19ed93734b9dc47c5c0)
### Bug Fixes

- **use real stats counts in header, render projects with 0 memories** [#1b7160e](https://github.com/damusix/ai-tools/commit/1b7160e135133c9c78e08cab6c348c10dacd1d3a)
- **broadcast SSE event when new project created via /enqueue** [#b2b91a9](https://github.com/damusix/ai-tools/commit/b2b91a9a15117f3c27c9942812e24c1c0fed06d0)
- **add /api/stats endpoint with real COUNT(*) totals** [#9137c6f](https://github.com/damusix/ai-tools/commit/9137c6f3604f8fbed16c5fc4f65578ec87c427cc)
- **make domain required with default 'general' in save_memory MCP tool** [#3e7dc07](https://github.com/damusix/ai-tools/commit/3e7dc07880432430c68a5a186fa41ef1b40d91a8)
- **add domain validation to insertMemory and updateMemory** [#3add037](https://github.com/damusix/ai-tools/commit/3add037470133c0ae6367e49c6022da1878a92a6)
- **wrap destructive DB ops in transactions, add input validation, encode URI params** [#941e23a](https://github.com/damusix/ai-tools/commit/941e23afb3d62a5f16275485938d401e59a540eb)
- **filter icon picker to FA7 free solid icons only** [#1f76ad9](https://github.com/damusix/ai-tools/commit/1f76ad949017605cb1a316b1458b39aa0efa4639)