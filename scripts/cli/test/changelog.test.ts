import { describe, it, expect } from "vitest";
import { parseCommit, groupCommitsByVersion, renderChangelog } from "../src/lib/changelog.js";
import type { ParsedCommit, VersionGroup, GitLogEntry } from "../src/types.js";

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
        const entries: GitLogEntry[] = [
            { hash: "a", commit: { hash: "a", type: "feat", scope: null, description: "add feature", breaking: false } },
            { hash: "b", commit: { hash: "b", type: "fix", scope: null, description: "fix bug", breaking: false } },
        ];
        const tags: Record<string, string> = {};

        const groups = groupCommitsByVersion(entries, tags, "1.0.0");
        expect(groups).toHaveLength(1);
        expect(groups[0].version).toBe("1.0.0");
        expect(groups[0].features).toEqual(["add feature"]);
        expect(groups[0].fixes).toEqual(["fix bug"]);
    });

    it("does not double-count breaking changes in features/fixes", () => {
        const entries: GitLogEntry[] = [
            { hash: "a", commit: { hash: "a", type: "feat", scope: null, description: "redesign API", breaking: true } },
        ];

        const groups = groupCommitsByVersion(entries, {}, "1.0.0");
        expect(groups[0].breaking).toEqual(["redesign API"]);
        expect(groups[0].features).toEqual([]);
    });

    it("splits commits at tag boundaries", () => {
        const entries: GitLogEntry[] = [
            { hash: "a", commit: { hash: "a", type: "feat", scope: null, description: "new thing", breaking: false } },
            { hash: "b", commit: null }, // release commit — carries the tag but no changelog content
            { hash: "c", commit: { hash: "c", type: "fix", scope: null, description: "old fix", breaking: false } },
        ];
        // Tag at commit "b" means commits after "b" belong to 1.0.0
        const tags: Record<string, string> = { b: "1.0.0" };

        const groups = groupCommitsByVersion(entries, tags, "1.1.0");
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
