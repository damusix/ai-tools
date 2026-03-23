import type { ParsedCommit, VersionGroup, GitLogEntry, ChangelogItem } from "../types.js";

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
        body: body?.trim() || null,
        breaking,
    };
}

export function groupCommitsByVersion(
    entries: GitLogEntry[],
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

    for (const entry of entries) {
        // Check if this commit has a tag — if so, start a new group
        if (tags[entry.hash]) {
            // Push current group if it has content
            if (current.features.length || current.fixes.length || current.breaking.length) {
                groups.push(current);
            }
            current = {
                version: tags[entry.hash],
                features: [],
                fixes: [],
                breaking: [],
            };
        }

        // Only add content for conventional commits
        if (!entry.commit) continue;

        const item: ChangelogItem = { hash: entry.hash, description: entry.commit.description, body: entry.commit.body };

        if (entry.commit.breaking) {
            current.breaking.push(item);
        }

        // Breaking changes only appear in the Breaking Changes section
        if (!entry.commit.breaking) {
            if (entry.commit.type === "feat") {
                current.features.push(item);
            } else if (entry.commit.type === "fix") {
                current.fixes.push(item);
            }
        }
    }

    // Push the last group
    if (current.features.length || current.fixes.length || current.breaking.length) {
        groups.push(current);
    }

    return groups;
}

function renderItem(item: ChangelogItem, repoUrl: string | null): string[] {
    const shortHash = item.hash.slice(0, 7);
    const hashRef = repoUrl
        ? `[#${shortHash}](${repoUrl}/commit/${item.hash})`
        : `#${shortHash}`;
    const lines: string[] = [`- **${item.description}** ${hashRef}`];
    if (item.body) {
        for (const line of item.body.split("\n")) {
            const trimmed = line.trimEnd();
            if (!trimmed) continue;
            if (/^\s*[-*]/.test(trimmed)) {
                lines.push(`  - ${trimmed.replace(/^\s*[-*]\s*/, '')}`);
            } else if (/^\w.*:$/.test(trimmed)) {
                lines.push(`  - **${trimmed}**`);
            } else {
                lines.push(`  ${trimmed}`);
            }
        }
    }
    return lines;
}

export function getRepoUrl(repoRoot: string): string | null {
    const result = Bun.spawnSync(["git", "remote", "get-url", "origin"], { cwd: repoRoot });
    const url = result.stdout.toString().trim();
    if (!url) return null;
    // Convert git@github.com:user/repo.git or https://github.com/user/repo.git to https://github.com/user/repo
    const sshMatch = url.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (sshMatch) return `https://github.com/${sshMatch[1]}`;
    const httpsMatch = url.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
    return null;
}

export function renderChangelog(groups: VersionGroup[], repoUrl: string | null = null): string {
    const lines: string[] = ["# Changelog", ""];

    for (const group of groups) {
        lines.push(`## ${group.version}`, "");

        if (group.breaking.length) {
            lines.push("### Breaking Changes", "");
            for (const item of group.breaking) lines.push(...renderItem(item, repoUrl));
        }

        if (group.features.length) {
            lines.push("### Features", "");
            for (const item of group.features) lines.push(...renderItem(item, repoUrl));
        }

        if (group.fixes.length) {
            lines.push("### Bug Fixes", "");
            for (const item of group.fixes) lines.push(...renderItem(item, repoUrl));
        }
    }

    return lines.join("\n");
}

export function getGitLog(repoRoot: string, pluginSourceDir: string): GitLogEntry[] {
    // %x1E (record separator) delimits commits, %x00 (null) delimits fields within a commit
    const result = Bun.spawnSync(
        ["git", "log", "--format=%H%x00%s%x00%b%x1E", "--", pluginSourceDir + "/"],
        { cwd: repoRoot }
    );

    const stdout = result.stdout.toString();
    if (!stdout.trim()) return [];

    const entries: GitLogEntry[] = [];
    const rawEntries = stdout.split("\x1E").filter((e) => e.trim());

    for (const entry of rawEntries) {
        const parts = entry.trim().split("\0");
        if (parts.length < 2) continue;
        const [hash, subject, ...bodyParts] = parts;
        const body = bodyParts.join("").trim();
        const parsed = parseCommit(hash, subject, body || undefined);
        entries.push({ hash, commit: parsed });
    }

    return entries;
}

export function getVersionTags(repoRoot: string, pluginName: string): Record<string, string> {
    const prefix = `${pluginName}@`;
    const result = Bun.spawnSync(
        ["git", "tag", "--list", `${prefix}*`, "--format=%(objectname) %(refname:short)"],
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
