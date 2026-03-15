import { writeFileSync } from "fs";
import { join, resolve } from "path";
import { discoverPlugins, getRepoRoot } from "../lib/plugins.js";
import { getGitLog, getVersionTags, groupCommitsByVersion, renderChangelog } from "../lib/changelog.js";

export function run(positionalArgs: string[]) {
    const repoRoot = getRepoRoot();
    const plugins = discoverPlugins(repoRoot);
    const pluginNames: Record<string, true> = {};
    for (const p of plugins) pluginNames[p.name] = true;

    const target = positionalArgs[0];

    if (target && !pluginNames[target]) {
        console.error(`Unknown plugin: ${target}`);
        console.log("Available plugins:", plugins.map((p) => p.name).join(", "));
        process.exit(1);
    }

    const selected = target ? plugins.filter((p) => p.name === target) : plugins;

    for (const plugin of selected) {
        const pluginDir = resolve(repoRoot, plugin.source);
        const entries = getGitLog(repoRoot, pluginDir);
        const tags = getVersionTags(repoRoot, plugin.name);
        const groups = groupCommitsByVersion(entries, tags, plugin.version);
        const changelog = renderChangelog(groups);
        const changelogPath = join(pluginDir, "CHANGELOG.md");
        writeFileSync(changelogPath, changelog);
        console.log(`${plugin.name}: ${changelogPath}`);
    }
}
