# Header Restructure + Search Filters Design


## Goal

Restructure the dashboard header into two rows, replace the project dropdown with a typeahead combobox, and build a unified search + filter bar with Datadog-style tag picking.


## Architecture

The current single-row header is split into two rows: a top bar for branding and actions, and a context strip for project selection and search. The existing `ProjectSelector` is rewritten as a typeahead combobox. A new `SearchBar` component combines free-text search with a multi-select filter picker for domains, categories, and tags.


## Components


### Row 1: Top Bar

Left side:
- Brand logo (`BrandLogo` component)
- "ai-memory" title
- GitHub icon (`fa-brands fa-github`) linking to `https://github.com/damusix/ai-tools`, opens in new tab
- GitHub icon styled `text-neutral-500 hover:text-[#d77757]`

Right side (all existing action buttons, unchanged):
- Settings (gear icon)
- Help (info icon)
- Logs button
- Transfer button
- Clean up button
- Restart button
- Stop button

No stats, no project selector in this row. The existing stats display (memory/observation counts next to the brand logo) must be removed from row 1 — stats move to row 2 under the ProjectSelector.


### Row 2: Context Strip

Darker background (`bg-neutral-950` or similar) with subtle bottom border separating it from the content area.

Two columns:
- Left: `ProjectSelector` typeahead (fixed ~240px width) with stats below
- Right: `SearchBar` with filter pills below (flex-1)


### ProjectSelector (Rewrite)

Replaces the current `<select>` dropdown with a typeahead combobox.

Behavior:
- Text input showing the current project name (or "All projects" when empty/cleared)
- Typing filters the project list in a dropdown below the input
- Case-insensitive matching against project name and path
- Click or Enter on highlighted item selects it
- Arrow keys navigate the dropdown, Escape closes it
- Click outside closes the dropdown
- "All projects" is always the first option; selecting it clears the project filter
- Delete button on hover for non-global projects (same as current)

Stats line below the input:
- Small text (9-10px) showing memory and observation counts
- Scoped to selected project via existing `/api/stats` endpoint
- When "All projects" selected, shows totals

Props interface (same shape as current):
- `projects: Project[]`
- `selected: string`
- `onChange: (path: string) => void`
- `onDeleteProject: () => void`


### SearchBar (New Component)

Unified search input with integrated filter picker. Replaces the inline search `<input>` currently in App.tsx.

#### Input behavior

- Focusing the input opens a dropdown of all available filters grouped by type
- Typing narrows all groups simultaneously (case-insensitive match against names)
- Each option shows its colored icon, name, and count
- Pressing Enter or clicking "Search for '___'" at the bottom fires a content search
- Clicking outside or Escape closes the dropdown
- Arrow keys navigate options within the dropdown, Enter selects the highlighted option

#### Dropdown sections

Three groups, each with a small header label:
- **Domains** — copper tint (`bg-[#d77757]/15 text-[#d77757]`), icons from `/api/domains`
- **Categories** — purple tint (`bg-purple-400/15 text-purple-400`), icons from `/api/categories`
- **Tags** — teal tint (`bg-teal-400/15 text-teal-400`), generic tag icon (`fa-tag`)

#### Selection

- Clicking an option adds it as a pill below the input and removes it from the dropdown
- Removing a pill (✕) returns it to the dropdown
- Multiple selections within the same type use OR logic (e.g. two domains = either domain)
- Across types use AND logic (domain + tag = must match both)
- After selecting a filter, the input clears and the dropdown stays open for quick multi-select
- Results update live as filters change (no Enter needed for filter-only queries)
- Debounce API calls (~200ms) when filters change rapidly to avoid request bursts

#### Filter pills

Row below the search input. Each pill has:
- Icon (domain/category icon from metadata, or generic tag icon)
- Label text
- ✕ remove button
- Color by type (copper / purple / teal as above)

#### Active search state

When a content search is active, a search pill appears (e.g. `🔍 "auth"`) that can be cleared independently of filter pills.

#### Props

- `project: string` — current project filter
- `domains: { name, icon, count }[]` — domain metadata
- `categories: { name, icon, count }[]` — category metadata
- `tags: { tag, count }[]` — tag list
- `onResults: (memories: Memory[] | null) => void` — pushes search results up to App


### GitHub Link

`<a>` tag with `fa-brands fa-github` icon next to the brand logo. `href="https://github.com/damusix/ai-tools"`, `target="_blank"`, `rel="noopener noreferrer"`. Styled `text-neutral-500 hover:text-[#d77757]` matching settings/help icon pattern.


## Backend Changes


### New endpoint: GET /api/tags

Exposes the existing `listTags()` function from `db.ts`.

Parameters:
- `project` (optional) — filter tags by project path

Returns: `{ tag: string, count: number }[]`


### Search endpoint: filter-only queries + comma-separated params

`GET /api/search` already accepts `domain`, `category`, `tag` query params but currently returns empty results when `q` is empty. Update to:

1. **Allow empty `q` when filter params are present** — fall back to a filtered `listMemories` query instead of requiring FTS. This enables filter-only browsing (e.g. show all memories in domain "api" without a text search).
2. **Support comma-separated values** for OR logic within a type.

Example: `/api/search?domain=api,backend&tag=security` (no `q`, filter-only)
Example: `/api/search?q=auth&domain=api,backend&tag=security` (text + filters)

Split on commas in the handler, pass arrays to the query functions. Changes needed in both `searchMemories`/`searchMemoriesFuzzy` (for text+filter) and a new filtered-list path (for filter-only).


## Files Changed

| File | Action |
|------|--------|
| `src/ui/App.tsx` | Restructure header into two rows, remove inline search and stats from row 1, wire SearchBar and ProjectSelector into row 2, add GitHub link, add `createResource` for `/api/tags`, update domain/category resource types to include `count` |
| `src/ui/components/ProjectSelector.tsx` | Rewrite from `<select>` to typeahead combobox with stats line |
| `src/ui/components/SearchBar.tsx` | New: unified search + filter picker component |
| `src/app.ts` | Add `GET /api/tags` endpoint, update `/api/search` to support comma-separated filter params |
| `src/db.ts` | Update `searchMemories` and `searchMemoriesFuzzy` to accept array params for domain/category/tag |


## Out of Scope

- Domain/category/tag filter dropdowns as separate UI elements
- Saved searches or search history
- URL-based state (planned for separate work)
