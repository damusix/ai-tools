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
