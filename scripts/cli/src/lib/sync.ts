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

    if (existsSync(pluginJsonPath) && resolve(pluginJsonPath) !== resolve(plugin.versionFile)) {
        const pluginRaw = readFileSync(pluginJsonPath, "utf-8");
        const pluginJson = JSON.parse(pluginRaw);
        pluginJson.version = newVersion;
        writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 4) + "\n");
        modified.push(pluginJsonPath);
    }

    return modified;
}
