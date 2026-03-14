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
