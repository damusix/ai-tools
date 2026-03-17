# Changelog

## 1.2.1

### Features

- empty project cleanup, bulk delete, keyboard shortcuts, and project display filtering

### Bug Fixes

- hook JSON parsing and tiktoken-based token counting

## 1.2.0

### Features

- summary-based context injection, memory detail modal, and merge UX improvements
- URL-based routing, flaky test fix, and delete confirmation UX
- restructure dashboard header with search filters, menu dropdown, and branding
- add changelog command and update docs

## 1.1.1

### Features

- skip delete confirmation for zero-count taxonomy items
- show memory count on domain headers
- add stderr logging to hooks.log for hook debugging

## 1.1.0

### Features

- add search bar with dual-index word+trigram results
- add PreToolUse hook to inject taxonomy before search_memories
- inject domain and category taxonomy into startup context
- add /api/search with dual-index word+trigram search
- add /api/taxonomy-summary endpoint for hook consumption
- add prefix wildcards to /api/recall for better search matching
- add searchMemoriesFuzzy() for trigram substring matching
- support limit=0 for unlimited results in search and list functions
- add trigram FTS5 table with sync triggers and backfill
- self-healing setup, version bump to v1.0.0
- first-run setup, help docs, prerequisites, and platform support
- unified delete, restore defaults, overflow fixes, project delete buttons
- export taxonomy seeds, restore-defaults API, help text in settings
- display project icons and descriptions in dashboard
- unified Settings modal with Configuration/Domains/Categories tabs, AI generation, force-delete
- auto-enrich projects with AI description and icon after 5 memories
- project deletion with confirmation modal
- redesign transfer flow — target-first, multi-select sources, batch API
- add stop button with confirmation, show memory reason on cards
- worker passes reason to memory create/update, prompt requests reason field
- add reason to MCP save_memory tool, update Memory/Project types
- API endpoints for project delete, stop, force-delete taxonomy, AI generate, batch transfer
- add reason to memories, icon/description to projects, deleteProject, forceDeleteTaxonomy
- upgrade ConfirmModal with configurable labels, nested z-index support
- wire Taxonomy page into dashboard, use dynamic icons from API
- categorized searchable icon picker from FA categories data
- add Taxonomy management page component
- load Font Awesome 7 via CDN for taxonomy icons
- add synthesisTimeoutMs to settings UI
- stale observation synthesis trigger, dynamic categories in LLM prompts
- dynamic category params in MCP tools, add list_categories tool
- add CRUD API endpoints for domains and categories
- add CRUD functions for domains, categories, and stale observation detection
- add categories table, icon column to domains, remove CHECK constraint
- add synthesisTimeoutMs config for time-based synthesis fallback

### Bug Fixes

- use real stats counts in header, render projects with 0 memories
- broadcast SSE event when new project created via /enqueue
- add /api/stats endpoint with real COUNT(*) totals
- make domain required with default 'general' in save_memory MCP tool
- add domain validation to insertMemory and updateMemory
- wrap destructive DB ops in transactions, add input validation, encode URI params
- filter icon picker to FA7 free solid icons only
