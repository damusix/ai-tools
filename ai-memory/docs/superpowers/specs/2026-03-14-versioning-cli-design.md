# Versioning CLI Design Spec


## Overview

A CLI tool for managing plugin versions in the claude-marketplace monorepo. Supports two modes: interactive (prompts) and flag-based (subcommands). Generates per-plugin changelogs from git history and synchronizes versions across all manifest files.


## Stack

- **Runtime:** Bun
- **Interactive prompts:** `@clack/prompts`
- **Argument parsing:** `@bomb.sh/args`
- **Location:** `scripts/cli/`
- **Invocation:** `pnpm dev <subcommand> [args]`


## Repository Changes

The repo becomes a pnpm workspace.

**New files:**

```
package.json              # workspace root
pnpm-workspace.yaml       # workspace config
scripts/cli/
    package.json          # CLI tool (private, bun)
    src/
        index.ts          # entry point, subcommand router
        commands/
            version.ts    # version command
        lib/
            plugins.ts    # plugin discovery & version read/write
            changelog.ts  # git log parsing & CHANGELOG.md generation
            sync.ts       # marketplace.json + plugin.json sync
        types.ts          # shared types
```

**Root package.json:**

```json
{
    "private": true,
    "scripts": {
        "dev": "bun scripts/cli/src/index.ts"
    }
}
```

**pnpm-workspace.yaml:**

```yaml
packages:
    - ai-memory
    - cc-auto-approve-fix
    - scripts/cli
```

**Obsoleted:** `scripts/sync-versions.sh` — replaced by the CLI's built-in sync.


## Plugin Discovery

Plugins are discovered from `.claude-plugin/marketplace.json`. For each plugin entry:

- `name` — plugin identifier (e.g., `ai-memory`)
- `source` — relative path to plugin root (e.g., `./ai-memory`)
- Version source of truth resolution:
    - If `<source>/package.json` exists and has a `version` field → use it (e.g., `ai-memory`)
    - Otherwise → use `<source>/.claude-plugin/plugin.json` (e.g., `auto-approve-compound-bash`, which is a Go project with no `package.json`)

Note: Plugin names come from `marketplace.json` entries, not directory names. For example, the plugin named `auto-approve-compound-bash` lives in the directory `cc-auto-approve-fix/`. The CLI always uses the `name` field, never the directory path, when accepting user input.


## Version Command

### Flag Mode

```
pnpm dev version <plugin> <bump>
```

Examples:

```
pnpm dev version ai-memory minor
pnpm dev version auto-approve-compound-bash patch
```

Arguments:

| Position | Description | Values |
|----------|-------------|--------|
| 1 | Plugin name | Must match a name in marketplace.json |
| 2 | Bump type | `patch`, `minor`, `major` |

If the plugin name doesn't match, print available plugins and exit with error.

### Interactive Mode

Invoked with no arguments:

```
pnpm dev version
```

Flow:

1. **`multiselect()`** — pick which plugins to bump (shows all discovered plugins with current version as hint)
2. **`select()`** — shown sequentially for each selected plugin; pick bump type (`patch`, `minor`, `major`); current version shown as hint
3. **`confirm()`** — summary table of all planned bumps before executing
4. **Execute** — bump versions, sync manifests, regenerate changelogs, create git tags
5. **`tasks()`** — progress display with spinner per step

Cancellation is handled at every prompt via `isCancel()`, exiting cleanly with `cancel()`.


## Version Bump Process

For each plugin being bumped, in order:

1. **Parse** current version from source of truth (semver)
2. **Apply** bump (patch/minor/major)
3. **Write** new version to source of truth file
4. **Sync** version to `marketplace.json`
5. **Sync** version to `.claude-plugin/plugin.json` if it exists and is separate from the source of truth
6. **Regenerate** `<plugin-root>/CHANGELOG.md` from git history
7. **Stage** all modified files and **commit** with message `release: <plugin-name>@<new-version>`
8. **Create** git tag `<plugin-name>@<new-version>` on the release commit


## Changelog Generation

Each plugin gets a `CHANGELOG.md` at its root, regenerated from the full git history on every bump.

### Git Parsing

```
git log --format="%H%x00%s%x00%B" -- <plugin-source-dir>/
```

Uses null-byte separators (`%x00`) to cleanly delimit hash, subject, and full body. This enables detecting `BREAKING CHANGE` tokens in the commit body, not just the subject line.

Retrieves all commits that touched files within the plugin's directory.

### Commit Classification

Commits are parsed against the conventional commit format: `<type>(<scope>)?: <description>`

Scope is parsed but not included in changelog output. The description after the colon is used as the bullet text.

| Classification | Matching Rule |
|---------------|---------------|
| **Breaking Changes** | Type suffix `!` (e.g., `feat!:`, `fix!:`) or `BREAKING CHANGE` in commit body |
| **Features** | Type is `feat` |
| **Bug Fixes** | Type is `fix` |
| **Dropped** | All other types (`chore`, `docs`, `refactor`, `test`, `style`, `ci`, etc.) |

Breaking changes are extracted into their own section regardless of the commit type prefix.

### Version Boundaries

Commits are grouped by version using git tags in the format `<plugin-name>@<version>`. The tag's commit marks the boundary — commits between two tags belong to the newer version.

On first run (no tags exist), all qualifying commits land under the new version being created.

### Output Format

```markdown
# Changelog

## 1.1.0

### Breaking Changes
- Description of breaking change

### Features
- Add search bar with dual-index results
- Add PreToolUse hook for taxonomy injection

### Bug Fixes
- Make domain required with default 'general'

## 1.0.0

### Features
- Initial release
```

Sections are omitted if empty (e.g., no "Breaking Changes" heading if there are none for that version).


## Subcommand Architecture

The entry point (`index.ts`) acts as a router. `@bomb.sh/args` has no built-in subcommand support — routing is manual via positional args. The parsed `_` array provides positional arguments: `_[0]` is the subcommand name, and the rest are forwarded to the command handler.

```ts
// parse(argv)._ → ["version", "ai-memory", "minor"]
// _[0] selects the command, _[1..] are command-specific args
```

Each command handler validates its own positional args and flags independently.

Unknown subcommands print available commands and exit. No subcommand at all prints help/usage.

This design leaves room for future commands (`build`, `release`, `lint`, etc.) without restructuring.


## Preconditions & Error Handling

**Dirty working tree:** The CLI checks for uncommitted changes before starting. If the tree is dirty, it prints a warning and exits. Version bumps should not be mixed with unrelated uncommitted work.

**Duplicate tags:** Before creating a tag, check if `<plugin-name>@<version>` already exists. If it does, exit with an error — the version was likely already released.

**Invalid version:** If the version string in the source file is not valid semver, exit with an error and print the malformed value.

**Invalid plugin name (flag mode):** Print available plugin names from marketplace.json and exit.

**Invalid bump type (flag mode):** Print valid bump types (`patch`, `minor`, `major`) and exit.

**Multi-plugin bumps:** When multiple plugins are bumped (interactive mode), all changes are staged and committed as a single commit with message `release: <plugin-a>@<version>, <plugin-b>@<version>`. One tag per plugin is created on that commit.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | User error (bad plugin name, bad bump type, dirty tree) |
| 2 | System error (git failure, file write failure) |


## Output Behavior

**Interactive mode:** Uses `@clack/prompts` components — `intro()`, `outro()`, `tasks()` with spinners, styled prompts.

**Flag mode:** Plain-text status lines to stdout, no spinners or interactive UI. Suitable for scripting and CI.
