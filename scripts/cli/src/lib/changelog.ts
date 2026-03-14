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
