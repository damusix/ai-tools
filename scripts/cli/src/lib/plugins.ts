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
