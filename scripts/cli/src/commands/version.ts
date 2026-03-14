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
