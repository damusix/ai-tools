# Versioning CLI Implementation Plan


> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool at `scripts/cli/` that manages plugin versioning with interactive and flag-based modes, generates per-plugin changelogs from git history, and turns the repo into a pnpm workspace.

**Architecture:** Entry point routes subcommands via `@bomb.sh/args` positional args. The `version` command uses `@clack/prompts` for interactive mode and plain stdout for flag mode. Library modules handle plugin discovery (from `marketplace.json`), version sync (across all manifest files), and changelog generation (from git log filtered to plugin directories).

**Tech Stack:** Bun runtime, `@clack/prompts`, `@bomb.sh/args`, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-14-versioning-cli-design.md`

---

## File Structure

```
package.json                    # NEW — workspace root, "dev" script
pnpm-workspace.yaml             # NEW — workspace config
scripts/cli/
    package.json                # NEW — private bun CLI package
    tsconfig.json               # NEW — TypeScript config
    src/
        index.ts                # NEW — entry point, subcommand router
        commands/
            version.ts          # NEW — version command (interactive + flag modes)
        lib/
            plugins.ts          # NEW — plugin discovery & version read/write
            changelog.ts        # NEW — git log parsing & CHANGELOG.md generation
            sync.ts             # NEW — marketplace.json + plugin.json version sync
        types.ts                # NEW — shared types
    test/
        plugins.test.ts         # NEW — plugin discovery tests
        changelog.test.ts       # NEW — changelog generation tests
        sync.test.ts            # NEW — version sync tests
```

---

## Chunk 1: Workspace Setup & Scaffolding

### Task 1: Create pnpm workspace root

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create root package.json**

```json
{
    "private": true,
    "scripts": {
        "dev": "bun scripts/cli/src/index.ts"
    }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
    - ai-memory
    - cc-auto-approve-fix
    - scripts/cli
```

- [ ] **Step 3: Verify workspace is recognized**

Run: `pnpm install`
Expected: pnpm detects the workspace and links packages. No errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml
git commit -m "chore: initialize pnpm workspace"
```

### Task 2: Scaffold CLI package

**Files:**
- Create: `scripts/cli/package.json`
- Create: `scripts/cli/tsconfig.json`
- Create: `scripts/cli/src/types.ts`
- Create: `scripts/cli/src/index.ts`

- [ ] **Step 1: Create scripts/cli/package.json**

```json
{
    "name": "@damusix/cli",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "dependencies": {
        "@bomb.sh/args": "latest",
        "@clack/prompts": "latest"
    },
    "devDependencies": {
        "@types/bun": "latest",
        "vitest": "latest"
    },
    "scripts": {
        "test": "vitest run"
    }
}
```

- [ ] **Step 2: Create scripts/cli/tsconfig.json**

```json
{
    "compilerOptions": {
        "target": "ESNext",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "outDir": "dist",
        "rootDir": "src",
        "types": ["bun"]
    },
    "include": ["src"]
}
```

- [ ] **Step 3: Create scripts/cli/src/types.ts**

```ts
export type BumpType = "patch" | "minor" | "major";

export interface PluginInfo {
    name: string;
    source: string;
    version: string;
    versionFile: string; // absolute path to the file holding version
    versionKey: string; // "version" — the JSON key
}

export interface ParsedCommit {
    hash: string;
    type: string;
    scope: string | null;
    description: string;
    breaking: boolean;
}

export interface VersionGroup {
    version: string;
    features: string[];
    fixes: string[];
    breaking: string[];
}
```

- [ ] **Step 4: Create scripts/cli/src/index.ts (minimal router)**

```ts
import { parse } from "@bomb.sh/args";

const args = parse(process.argv.slice(2));
const command = args._[0];

if (!command) {
    console.log("Usage: pnpm dev <command> [args]");
    console.log("");
    console.log("Commands:");
    console.log("  version    Bump plugin versions and generate changelogs");
    process.exit(0);
}

if (command === "version") {
    const { run } = await import("./commands/version.js");
    await run(args._.slice(1));
} else {
    console.error(`Unknown command: ${command}`);
    console.log("Available commands: version");
    process.exit(1);
}
```

- [ ] **Step 5: Create a placeholder commands/version.ts so the router loads**

```ts
export async function run(positionalArgs: string[]) {
    console.log("version command called with:", positionalArgs);
}
```

- [ ] **Step 6: Install dependencies**

Run from repo root: `pnpm install`
Expected: Dependencies installed for `scripts/cli`.

- [ ] **Step 7: Verify the CLI runs**

Run: `pnpm dev version`
Expected: Prints `version command called with: []`

Run: `pnpm dev version ai-memory minor`
Expected: Prints `version command called with: [ "ai-memory", "minor" ]`

Run: `pnpm dev`
Expected: Prints usage help.

Run: `pnpm dev bogus`
Expected: Prints `Unknown command: bogus` and exits with code 1.

- [ ] **Step 8: Commit**

```bash
git add scripts/cli/
git commit -m "chore: scaffold versioning CLI with subcommand router"
```

---

## Chunk 2: Plugin Discovery & Version Sync

### Task 3: Write plugin discovery tests

**Files:**
- Create: `scripts/cli/test/plugins.test.ts`

Tests use a temporary directory with mock marketplace.json and plugin files to validate discovery logic without touching the real repo.

- [ ] **Step 1: Write tests for discoverPlugins()**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { discoverPlugins, readVersion, writeVersion } from "../src/lib/plugins.js";

const TMP = join(fileURLToPath(import.meta.url), "../../../tmp/test-plugins");

beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    mkdirSync(join(TMP, ".claude-plugin"), { recursive: true });
});

afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
});

describe("discoverPlugins", () => {
    it("discovers plugins from marketplace.json", () => {
        // Plugin A: has package.json with version
        mkdirSync(join(TMP, "plugin-a"), { recursive: true });
        writeFileSync(
            join(TMP, "plugin-a", "package.json"),
            JSON.stringify({ name: "plugin-a", version: "1.2.3" })
        );

        // Plugin B: no package.json, uses .claude-plugin/plugin.json
        mkdirSync(join(TMP, "plugin-b", ".claude-plugin"), { recursive: true });
        writeFileSync(
            join(TMP, "plugin-b", ".claude-plugin", "plugin.json"),
            JSON.stringify({ name: "plugin-b", version: "0.5.0" })
        );

        writeFileSync(
            join(TMP, ".claude-plugin", "marketplace.json"),
            JSON.stringify({
                plugins: [
                    { name: "plugin-a", source: "./plugin-a" },
                    { name: "plugin-b", source: "./plugin-b" },
                ],
            })
        );

        const plugins = discoverPlugins(TMP);
        expect(plugins).toHaveLength(2);

        expect(plugins[0].name).toBe("plugin-a");
        expect(plugins[0].version).toBe("1.2.3");
        expect(plugins[0].versionFile).toContain("package.json");

        expect(plugins[1].name).toBe("plugin-b");
        expect(plugins[1].version).toBe("0.5.0");
        expect(plugins[1].versionFile).toContain("plugin.json");
    });

    it("throws if marketplace.json is missing", () => {
        expect(() => discoverPlugins(TMP + "/nonexistent")).toThrow();
    });
});

describe("readVersion / writeVersion", () => {
    it("reads and writes version in package.json", () => {
        mkdirSync(join(TMP, "pkg"), { recursive: true });
        const file = join(TMP, "pkg", "package.json");
        writeFileSync(file, JSON.stringify({ name: "test", version: "1.0.0" }, null, 4));

        expect(readVersion(file)).toBe("1.0.0");
        writeVersion(file, "1.1.0");
        expect(readVersion(file)).toBe("1.1.0");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `scripts/cli`: `pnpm test -- test/plugins.test.ts`
Expected: FAIL — `discoverPlugins` not exported.

### Task 4: Implement plugin discovery

**Files:**
- Create: `scripts/cli/src/lib/plugins.ts`

- [ ] **Step 1: Implement discoverPlugins, readVersion, writeVersion**

```ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { PluginInfo } from "../types.js";

interface MarketplaceEntry {
    name: string;
    source: string;
}

interface MarketplaceJson {
    plugins: MarketplaceEntry[];
}

export function discoverPlugins(repoRoot: string): PluginInfo[] {
    const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
    const raw = readFileSync(marketplacePath, "utf-8");
    const marketplace: MarketplaceJson = JSON.parse(raw);

    return marketplace.plugins.map((entry) => {
        const pluginDir = resolve(repoRoot, entry.source);
        const pkgJsonPath = join(pluginDir, "package.json");
        const pluginJsonPath = join(pluginDir, ".claude-plugin", "plugin.json");

        let versionFile: string;

        if (existsSync(pkgJsonPath)) {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            if (pkg.version) {
                versionFile = pkgJsonPath;
            } else {
                versionFile = pluginJsonPath;
            }
        } else {
            versionFile = pluginJsonPath;
        }

        const version = readVersion(versionFile);

        return {
            name: entry.name,
            source: entry.source,
            version,
            versionFile,
            versionKey: "version",
        };
    });
}

export function readVersion(filePath: string): string {
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    return json.version;
}

export function writeVersion(filePath: string, newVersion: string): void {
    const raw = readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    json.version = newVersion;
    writeFileSync(filePath, JSON.stringify(json, null, 4) + "\n");
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run from `scripts/cli`: `pnpm test -- test/plugins.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli/src/lib/plugins.ts scripts/cli/test/plugins.test.ts
git commit -m "feat: add plugin discovery from marketplace.json"
```

### Task 5: Write version sync tests

**Files:**
- Create: `scripts/cli/test/sync.test.ts`

- [ ] **Step 1: Write tests for syncVersions()**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { syncVersions } from "../src/lib/sync.js";
import type { PluginInfo } from "../src/types.js";

const TMP = join(fileURLToPath(import.meta.url), "../../../tmp/test-sync");

beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    mkdirSync(join(TMP, ".claude-plugin"), { recursive: true });
});

afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
});

describe("syncVersions", () => {
    it("updates marketplace.json with new version", () => {
        const marketplacePath = join(TMP, ".claude-plugin", "marketplace.json");
        writeFileSync(
            marketplacePath,
            JSON.stringify({
                plugins: [{ name: "test-plugin", version: "1.0.0", source: "./test" }],
            }, null, 4)
        );

        const plugin: PluginInfo = {
            name: "test-plugin",
            source: "./test",
            version: "1.1.0",
            versionFile: "/some/path",
            versionKey: "version",
        };

        syncVersions(TMP, plugin, "1.1.0");

        const updated = JSON.parse(readFileSync(marketplacePath, "utf-8"));
        expect(updated.plugins[0].version).toBe("1.1.0");
    });

    it("updates .claude-plugin/plugin.json if separate from version source", () => {
        const marketplacePath = join(TMP, ".claude-plugin", "marketplace.json");
        writeFileSync(
            marketplacePath,
            JSON.stringify({
                plugins: [{ name: "test-plugin", version: "1.0.0", source: "./test" }],
            }, null, 4)
        );

        // Plugin has package.json as source of truth
        mkdirSync(join(TMP, "test", ".claude-plugin"), { recursive: true });
        const pluginJsonPath = join(TMP, "test", ".claude-plugin", "plugin.json");
        writeFileSync(pluginJsonPath, JSON.stringify({ name: "test-plugin", version: "1.0.0" }, null, 4));

        const plugin: PluginInfo = {
            name: "test-plugin",
            source: "./test",
            version: "1.1.0",
            versionFile: join(TMP, "test", "package.json"), // different from plugin.json
            versionKey: "version",
        };

        syncVersions(TMP, plugin, "1.1.0");

        const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
        expect(pluginJson.version).toBe("1.1.0");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `scripts/cli`: `pnpm test -- test/sync.test.ts`
Expected: FAIL — `syncVersions` not exported.

### Task 6: Implement version sync

**Files:**
- Create: `scripts/cli/src/lib/sync.ts`

- [ ] **Step 1: Implement syncVersions()**

```ts
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { PluginInfo } from "../types.js";

export function syncVersions(repoRoot: string, plugin: PluginInfo, newVersion: string): string[] {
    const modified: string[] = [];

    // 1. Update marketplace.json
    const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
    const raw = readFileSync(marketplacePath, "utf-8");
    const marketplace = JSON.parse(raw);

    for (const entry of marketplace.plugins) {
        if (entry.name === plugin.name) {
            entry.version = newVersion;
        }
    }

    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 4) + "\n");
    modified.push(marketplacePath);

    // 2. Update .claude-plugin/plugin.json if it exists and is separate from version source
    const pluginDir = resolve(repoRoot, plugin.source);
    const pluginJsonPath = join(pluginDir, ".claude-plugin", "plugin.json");

    if (existsSync(pluginJsonPath) && pluginJsonPath !== plugin.versionFile) {
        const pluginRaw = readFileSync(pluginJsonPath, "utf-8");
        const pluginJson = JSON.parse(pluginRaw);
        pluginJson.version = newVersion;
        writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 4) + "\n");
        modified.push(pluginJsonPath);
    }

    return modified;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run from `scripts/cli`: `pnpm test -- test/sync.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli/src/lib/sync.ts scripts/cli/test/sync.test.ts
git commit -m "feat: add version sync across marketplace.json and plugin.json"
```

---

## Chunk 3: Changelog Generation

### Task 7: Write changelog tests

**Files:**
- Create: `scripts/cli/test/changelog.test.ts`

Tests exercise commit parsing and markdown generation with fake data (no real git calls in unit tests).

- [ ] **Step 1: Write tests for parseCommit() and generateChangelog()**

```ts
import { describe, it, expect } from "vitest";
import { parseCommit, groupCommitsByVersion, renderChangelog } from "../src/lib/changelog.js";
import type { ParsedCommit, VersionGroup } from "../src/types.js";

describe("parseCommit", () => {
    it("parses a feat commit", () => {
        const result = parseCommit("abc123", "feat: add search bar");
        expect(result).toEqual({
            hash: "abc123",
            type: "feat",
            scope: null,
            description: "add search bar",
            breaking: false,
        });
    });

    it("parses a scoped commit", () => {
        const result = parseCommit("abc123", "fix(db): handle null values");
        expect(result).toEqual({
            hash: "abc123",
            type: "fix",
            scope: "db",
            description: "handle null values",
            breaking: false,
        });
    });

    it("detects breaking change from ! suffix", () => {
        const result = parseCommit("abc123", "feat!: redesign API");
        expect(result?.breaking).toBe(true);
    });

    it("detects breaking change from body", () => {
        const result = parseCommit("abc123", "feat: new auth", "Some details\n\nBREAKING CHANGE: old tokens invalid");
        expect(result?.breaking).toBe(true);
    });

    it("returns null for non-conventional commits", () => {
        const result = parseCommit("abc123", "random commit message");
        expect(result).toBeNull();
    });

    it("returns null for chore commits (dropped types)", () => {
        const result = parseCommit("abc123", "chore: update deps");
        expect(result).toBeNull();
    });

    it("keeps non-feat/fix commits if they have BREAKING CHANGE in body", () => {
        const result = parseCommit("abc123", "refactor: rewrite auth", "BREAKING CHANGE: tokens invalidated");
        expect(result).not.toBeNull();
        expect(result?.breaking).toBe(true);
        expect(result?.type).toBe("refactor");
    });
});

describe("groupCommitsByVersion", () => {
    it("groups commits under a single version when no tags exist", () => {
        const commits: ParsedCommit[] = [
            { hash: "a", type: "feat", scope: null, description: "add feature", breaking: false },
            { hash: "b", type: "fix", scope: null, description: "fix bug", breaking: false },
        ];
        const tags: Record<string, string> = {};

        const groups = groupCommitsByVersion(commits, tags, "1.0.0");
        expect(groups).toHaveLength(1);
        expect(groups[0].version).toBe("1.0.0");
        expect(groups[0].features).toEqual(["add feature"]);
        expect(groups[0].fixes).toEqual(["fix bug"]);
    });

    it("does not double-count breaking changes in features/fixes", () => {
        const commits: ParsedCommit[] = [
            { hash: "a", type: "feat", scope: null, description: "redesign API", breaking: true },
        ];

        const groups = groupCommitsByVersion(commits, {}, "1.0.0");
        expect(groups[0].breaking).toEqual(["redesign API"]);
        expect(groups[0].features).toEqual([]);
    });

    it("splits commits at tag boundaries", () => {
        const commits: ParsedCommit[] = [
            { hash: "a", type: "feat", scope: null, description: "new thing", breaking: false },
            { hash: "b", type: "fix", scope: null, description: "old fix", breaking: false },
        ];
        // Tag at commit "b" means "b" belongs to 1.0.0
        const tags: Record<string, string> = { b: "1.0.0" };

        const groups = groupCommitsByVersion(commits, tags, "1.1.0");
        expect(groups).toHaveLength(2);
        expect(groups[0].version).toBe("1.1.0");
        expect(groups[0].features).toEqual(["new thing"]);
        expect(groups[1].version).toBe("1.0.0");
        expect(groups[1].fixes).toEqual(["old fix"]);
    });
});

describe("renderChangelog", () => {
    it("renders markdown with sections", () => {
        const groups: VersionGroup[] = [
            {
                version: "1.1.0",
                features: ["add search"],
                fixes: ["fix crash"],
                breaking: ["remove old API"],
            },
        ];

        const md = renderChangelog(groups);
        expect(md).toContain("# Changelog");
        expect(md).toContain("## 1.1.0");
        expect(md).toContain("### Breaking Changes");
        expect(md).toContain("- remove old API");
        expect(md).toContain("### Features");
        expect(md).toContain("- add search");
        expect(md).toContain("### Bug Fixes");
        expect(md).toContain("- fix crash");
    });

    it("omits empty sections", () => {
        const groups: VersionGroup[] = [
            { version: "1.0.0", features: ["initial"], fixes: [], breaking: [] },
        ];

        const md = renderChangelog(groups);
        expect(md).not.toContain("### Breaking Changes");
        expect(md).not.toContain("### Bug Fixes");
        expect(md).toContain("### Features");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `scripts/cli`: `pnpm test -- test/changelog.test.ts`
Expected: FAIL — functions not exported.

### Task 8: Implement changelog generation

**Files:**
- Create: `scripts/cli/src/lib/changelog.ts`

- [ ] **Step 1: Implement parseCommit()**

```ts
import type { ParsedCommit, VersionGroup } from "../types.js";

const CONVENTIONAL_RE = /^(\w+)(\(([^)]+)\))?(!)?:\s+(.+)$/;
const INCLUDED_TYPES: Record<string, true> = { feat: true, fix: true };

export function parseCommit(hash: string, subject: string, body?: string): ParsedCommit | null {
    const match = subject.match(CONVENTIONAL_RE);
    if (!match) return null;

    const type = match[1];
    const scope = match[3] || null;
    const bangSuffix = !!match[4];
    const description = match[5];
    const breakingInBody = body ? body.includes("BREAKING CHANGE") : false;
    const breaking = bangSuffix || breakingInBody;

    // Keep feat, fix, and any commit marked as breaking (regardless of type)
    if (!INCLUDED_TYPES[type] && !breaking) return null;

    return {
        hash,
        type,
        scope,
        description,
        breaking,
    };
}
```

- [ ] **Step 2: Implement groupCommitsByVersion()**

Commits arrive in reverse chronological order (newest first). Tags map commit hashes to version strings. The current (new) version captures all commits until the first tag boundary.

```ts
export function groupCommitsByVersion(
    commits: ParsedCommit[],
    tags: Record<string, string>,
    currentVersion: string
): VersionGroup[] {
    const groups: VersionGroup[] = [];
    let current: VersionGroup = {
        version: currentVersion,
        features: [],
        fixes: [],
        breaking: [],
    };

    for (const commit of commits) {
        // Check if this commit has a tag — if so, start a new group
        if (tags[commit.hash]) {
            // Push current group if it has content
            if (current.features.length || current.fixes.length || current.breaking.length) {
                groups.push(current);
            }
            current = {
                version: tags[commit.hash],
                features: [],
                fixes: [],
                breaking: [],
            };
        }

        if (commit.breaking) {
            current.breaking.push(commit.description);
        }

        // Breaking changes only appear in the Breaking Changes section
        if (!commit.breaking) {
            if (commit.type === "feat") {
                current.features.push(commit.description);
            } else if (commit.type === "fix") {
                current.fixes.push(commit.description);
            }
        }
    }

    // Push the last group
    if (current.features.length || current.fixes.length || current.breaking.length) {
        groups.push(current);
    }

    return groups;
}
```

- [ ] **Step 3: Implement renderChangelog()**

```ts
export function renderChangelog(groups: VersionGroup[]): string {
    const lines: string[] = ["# Changelog", ""];

    for (const group of groups) {
        lines.push(`## ${group.version}`, "");

        if (group.breaking.length) {
            lines.push("### Breaking Changes", "");
            for (const item of group.breaking) lines.push(`- ${item}`);
            lines.push("");
        }

        if (group.features.length) {
            lines.push("### Features", "");
            for (const item of group.features) lines.push(`- ${item}`);
            lines.push("");
        }

        if (group.fixes.length) {
            lines.push("### Bug Fixes", "");
            for (const item of group.fixes) lines.push(`- ${item}`);
            lines.push("");
        }
    }

    return lines.join("\n");
}
```

- [ ] **Step 4: Implement getGitLog() and getVersionTags() (the git integration functions)**

These call `git` via `Bun.spawnSync` and are used by the version command, not by unit tests.

```ts
export function getGitLog(repoRoot: string, pluginSourceDir: string): ParsedCommit[] {
    // %x1E (record separator) delimits commits, %x00 (null) delimits fields within a commit
    const result = Bun.spawnSync(
        ["git", "log", "--format=%H%x00%s%x00%B%x1E", "--", pluginSourceDir + "/"],
        { cwd: repoRoot }
    );

    const stdout = result.stdout.toString();
    if (!stdout.trim()) return [];

    const commits: ParsedCommit[] = [];
    const entries = stdout.split("\x1E").filter((e) => e.trim());

    for (const entry of entries) {
        const parts = entry.trim().split("\0");
        if (parts.length < 2) continue;
        const [hash, subject, ...bodyParts] = parts;
        const body = bodyParts.join("").trim();
        const parsed = parseCommit(hash, subject, body || undefined);
        if (parsed) commits.push(parsed);
    }

    return commits;
}

export function getVersionTags(repoRoot: string, pluginName: string): Record<string, string> {
    const prefix = `${pluginName}@`;
    const result = Bun.spawnSync(
        ["git", "tag", "--list", `${prefix}*`, "--format=%(objectname:short) %(refname:short)"],
        { cwd: repoRoot }
    );

    const stdout = result.stdout.toString();
    const tags: Record<string, string> = {};

    for (const line of stdout.split("\n").filter(Boolean)) {
        const [hash, tagName] = line.split(" ");
        const version = tagName.replace(prefix, "");
        tags[hash] = version;
    }

    return tags;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run from `scripts/cli`: `pnpm test -- test/changelog.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/cli/src/lib/changelog.ts scripts/cli/test/changelog.test.ts
git commit -m "feat: add changelog generation from git history"
```

---

## Chunk 4: Version Command

### Task 9: Implement semver bump utility

**Files:**
- Modify: `scripts/cli/src/lib/plugins.ts`

- [ ] **Step 1: Add bumpVersion() to plugins.ts**

```ts
import type { BumpType } from "../types.js";

export function bumpVersion(current: string, bump: BumpType): string {
    const parts = current.split(".").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`Invalid semver: ${current}`);
    }

    const [major, minor, patch] = parts;

    switch (bump) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
    }
}
```

- [ ] **Step 2: Add a quick test in plugins.test.ts**

Append to existing test file:

```ts
import { bumpVersion } from "../src/lib/plugins.js";

describe("bumpVersion", () => {
    it("bumps patch", () => expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4"));
    it("bumps minor", () => expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0"));
    it("bumps major", () => expect(bumpVersion("1.2.3", "major")).toBe("2.0.0"));
    it("throws on invalid semver", () => expect(() => bumpVersion("bad", "patch")).toThrow());
});
```

- [ ] **Step 3: Run tests**

Run from `scripts/cli`: `pnpm test -- test/plugins.test.ts`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/cli/src/lib/plugins.ts scripts/cli/test/plugins.test.ts
git commit -m "feat: add semver bump utility"
```

### Task 10: Implement precondition checks

**Files:**
- Modify: `scripts/cli/src/lib/plugins.ts`

- [ ] **Step 1: Add git precondition helpers**

```ts
export function checkCleanWorkingTree(repoRoot: string): boolean {
    const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: repoRoot });
    return result.stdout.toString().trim() === "";
}

export function tagExists(repoRoot: string, tagName: string): boolean {
    const result = Bun.spawnSync(["git", "tag", "--list", tagName], { cwd: repoRoot });
    return result.stdout.toString().trim() !== "";
}

export function getRepoRoot(): string {
    const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
    return result.stdout.toString().trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/cli/src/lib/plugins.ts
git commit -m "feat: add git precondition checks"
```

### Task 11: Implement version command — flag mode

**Files:**
- Modify: `scripts/cli/src/commands/version.ts`

- [ ] **Step 1: Implement the full flag-mode flow**

Note: This file includes all imports upfront (including `@clack/prompts` for Task 12). The `runInteractive()` is a placeholder here, replaced in Task 12.

```ts
import { writeFileSync } from "fs";
import { join, resolve } from "path";
import {
    intro,
    outro,
    cancel,
    multiselect,
    select,
    confirm,
    tasks,
    isCancel,
    log,
} from "@clack/prompts";
import {
    discoverPlugins,
    writeVersion,
    bumpVersion,
    checkCleanWorkingTree,
    tagExists,
    getRepoRoot,
} from "../lib/plugins.js";
import { syncVersions } from "../lib/sync.js";
import { getGitLog, getVersionTags, groupCommitsByVersion, renderChangelog } from "../lib/changelog.js";
import type { BumpType } from "../types.js";

const VALID_BUMPS: Record<string, true> = { patch: true, minor: true, major: true };

export async function run(positionalArgs: string[]) {
    if (positionalArgs.length === 0) {
        return runInteractive();
    }

    return runFlagMode(positionalArgs);
}

function runFlagMode(positionalArgs: string[]) {
    const repoRoot = getRepoRoot();
    const plugins = discoverPlugins(repoRoot);
    const pluginNames: Record<string, true> = {};
    for (const p of plugins) pluginNames[p.name] = true;

    const [pluginName, bumpType] = positionalArgs;

    if (!pluginName || !pluginNames[pluginName]) {
        console.error(`Unknown plugin: ${pluginName}`);
        console.log("Available plugins:", plugins.map((p) => p.name).join(", "));
        process.exit(1);
    }

    if (!bumpType || !VALID_BUMPS[bumpType]) {
        console.error(`Invalid bump type: ${bumpType}`);
        console.log("Valid types: patch, minor, major");
        process.exit(1);
    }

    if (!checkCleanWorkingTree(repoRoot)) {
        console.error("Working tree is dirty. Commit or stash changes before versioning.");
        process.exit(1);
    }

    const plugin = plugins.find((p) => p.name === pluginName)!;
    const newVersion = bumpVersion(plugin.version, bumpType as BumpType);
    const tag = `${plugin.name}@${newVersion}`;

    if (tagExists(repoRoot, tag)) {
        console.error(`Tag ${tag} already exists.`);
        process.exit(1);
    }

    console.log(`${plugin.name}: ${plugin.version} → ${newVersion}`);

    try {
        // 1. Write version to source of truth
        writeVersion(plugin.versionFile, newVersion);
        console.log(`  Updated ${plugin.versionFile}`);

        // 2. Sync to marketplace.json and plugin.json
        const synced = syncVersions(repoRoot, plugin, newVersion);
        for (const f of synced) console.log(`  Synced ${f}`);

        // 3. Generate changelog
        const pluginDir = resolve(repoRoot, plugin.source);
        const commits = getGitLog(repoRoot, pluginDir);
        const versionTags = getVersionTags(repoRoot, plugin.name);
        const groups = groupCommitsByVersion(commits, versionTags, newVersion);
        const changelog = renderChangelog(groups);
        const changelogPath = join(pluginDir, "CHANGELOG.md");
        writeFileSync(changelogPath, changelog);
        console.log(`  Generated ${changelogPath}`);

        // 4. Commit and tag
        const filesToStage = [plugin.versionFile, ...synced, changelogPath];
        Bun.spawnSync(["git", "add", ...filesToStage], { cwd: repoRoot });
        const commitResult = Bun.spawnSync(["git", "commit", "-m", `release: ${tag}`], { cwd: repoRoot });
        if (commitResult.exitCode !== 0) {
            throw new Error(`git commit failed: ${commitResult.stderr.toString()}`);
        }
        Bun.spawnSync(["git", "tag", tag], { cwd: repoRoot });
        console.log(`  Created tag ${tag}`);
    } catch (err) {
        console.error(`System error: ${(err as Error).message}`);
        process.exit(2);
    }

    console.log("Done.");
}

async function runInteractive() {
    // Placeholder for Task 12
    console.log("Interactive mode not yet implemented.");
}
```

- [ ] **Step 2: Test manually with a dry run**

Run: `pnpm dev version ai-memory patch`
Expected: Bumps `ai-memory` from 1.0.0 → 1.0.1, updates marketplace.json, generates changelog, commits, creates tag `ai-memory@1.0.1`.

Verify: `git log --oneline -1` shows `release: ai-memory@1.0.1`
Verify: `git tag --list 'ai-memory@*'` shows `ai-memory@1.0.1`

- [ ] **Step 3: Commit**

```bash
git add scripts/cli/src/commands/version.ts
git commit -m "feat: implement version command flag mode"
```

### Task 12: Implement version command — interactive mode

**Files:**
- Modify: `scripts/cli/src/commands/version.ts`

- [ ] **Step 1: Replace the runInteractive() placeholder**

All imports are already at the top of the file from Task 11. Replace only the `runInteractive()` function body:

```ts
async function runInteractive() {
    const repoRoot = getRepoRoot();

    intro("Version Bump");

    if (!checkCleanWorkingTree(repoRoot)) {
        cancel("Working tree is dirty. Commit or stash changes first.");
        process.exit(1);
    }

    const plugins = discoverPlugins(repoRoot);

    // 1. Select plugins
    const selectedPlugins = await multiselect({
        message: "Which plugins to bump?",
        options: plugins.map((p) => ({
            value: p.name,
            label: p.name,
            hint: `v${p.version}`,
        })),
    });

    if (isCancel(selectedPlugins)) {
        cancel("Cancelled.");
        process.exit(0);
    }

    // 2. Select bump type for each
    const bumps: { pluginName: string; bump: BumpType }[] = [];

    for (const pluginName of selectedPlugins) {
        const plugin = plugins.find((p) => p.name === pluginName)!;

        const bump = await select({
            message: `Bump type for ${pluginName} (v${plugin.version})?`,
            options: [
                { value: "patch", label: "patch", hint: `→ ${bumpVersion(plugin.version, "patch")}` },
                { value: "minor", label: "minor", hint: `→ ${bumpVersion(plugin.version, "minor")}` },
                { value: "major", label: "major", hint: `→ ${bumpVersion(plugin.version, "major")}` },
            ],
        });

        if (isCancel(bump)) {
            cancel("Cancelled.");
            process.exit(0);
        }

        bumps.push({ pluginName, bump: bump as BumpType });
    }

    // 3. Confirm
    const summary = bumps
        .map((b) => {
            const p = plugins.find((p) => p.name === b.pluginName)!;
            return `  ${b.pluginName}: ${p.version} → ${bumpVersion(p.version, b.bump)}`;
        })
        .join("\n");

    log.message(summary);

    const ok = await confirm({ message: "Proceed with these bumps?" });

    if (isCancel(ok) || !ok) {
        cancel("Cancelled.");
        process.exit(0);
    }

    // 4. Execute
    const allFilesToStage: string[] = [];
    const allTags: string[] = [];

    await tasks(
        bumps.map((b) => ({
            title: `Bumping ${b.pluginName}`,
            task: async () => {
                const plugin = plugins.find((p) => p.name === b.pluginName)!;
                const newVersion = bumpVersion(plugin.version, b.bump);
                const tag = `${plugin.name}@${newVersion}`;

                if (tagExists(repoRoot, tag)) {
                    throw new Error(`Tag ${tag} already exists`);
                }

                // Write version
                writeVersion(plugin.versionFile, newVersion);
                allFilesToStage.push(plugin.versionFile);

                // Sync
                const synced = syncVersions(repoRoot, plugin, newVersion);
                allFilesToStage.push(...synced);

                // Changelog
                const pluginDir = resolve(repoRoot, plugin.source);
                const commits = getGitLog(repoRoot, pluginDir);
                const tags = getVersionTags(repoRoot, plugin.name);
                const groups = groupCommitsByVersion(commits, tags, newVersion);
                const changelog = renderChangelog(groups);
                const changelogPath = join(pluginDir, "CHANGELOG.md");
                writeFileSync(changelogPath, changelog);
                allFilesToStage.push(changelogPath);

                allTags.push(tag);

                return `${plugin.name} → ${newVersion}`;
            },
        }))
    );

    // Single commit for all plugins
    try {
        const commitMsg = `release: ${allTags.join(", ")}`;
        Bun.spawnSync(["git", "add", ...allFilesToStage], { cwd: repoRoot });
        const commitResult = Bun.spawnSync(["git", "commit", "-m", commitMsg], { cwd: repoRoot });
        if (commitResult.exitCode !== 0) {
            throw new Error(`git commit failed: ${commitResult.stderr.toString()}`);
        }

        for (const tag of allTags) {
            Bun.spawnSync(["git", "tag", tag], { cwd: repoRoot });
        }
    } catch (err) {
        console.error(`System error: ${(err as Error).message}`);
        process.exit(2);
    }

    outro(`Released: ${allTags.join(", ")}`);
}
```

- [ ] **Step 2: Test interactively**

Run: `pnpm dev version`
Expected: Shows multiselect with plugins, then bump type selection, then confirmation, then executes.

- [ ] **Step 3: Commit**

```bash
git add scripts/cli/src/commands/version.ts
git commit -m "feat: implement version command interactive mode"
```

---

## Chunk 5: Cleanup & Final Verification

### Task 13: Remove obsolete sync-versions.sh

**Files:**
- Delete: `scripts/sync-versions.sh`

- [ ] **Step 1: Verify sync.ts replaces sync-versions.sh functionality**

Check that `syncVersions()` updates both marketplace.json and plugin.json — same as the shell script did.

- [ ] **Step 2: Remove the file**

```bash
git rm scripts/sync-versions.sh
git commit -m "chore: remove sync-versions.sh, replaced by CLI"
```

### Task 14: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run from `scripts/cli`: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Test flag mode end-to-end**

Create a test branch, run `pnpm dev version ai-memory patch`, verify:
- `ai-memory/package.json` version is bumped
- `ai-memory/.claude-plugin/plugin.json` version is bumped
- `.claude-plugin/marketplace.json` version is bumped
- `ai-memory/CHANGELOG.md` exists with correct format
- Git commit exists with `release: ai-memory@<version>`
- Git tag exists

- [ ] **Step 3: Test interactive mode end-to-end**

Run `pnpm dev version` (no args), walk through the prompts, verify same outputs.

- [ ] **Step 4: Test error cases**

- `pnpm dev version nonexistent patch` → prints available plugins, exits 1 (user error)
- `pnpm dev version ai-memory bogus` → prints valid bump types, exits 1 (user error)
- With dirty working tree → prints warning, exits 1 (user error)
- Git/filesystem failures → prints system error, exits 2 (system error)
