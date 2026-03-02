import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('config write', () => {
    const tmpDir = join(import.meta.dirname, '..', 'tmp');
    const configPath = join(tmpDir, 'config.yaml');

    beforeEach(() => {
        if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writeConfigYaml writes valid YAML that can be read back', async () => {
        const { writeConfigYaml, loadConfig } = await import('../src/config.js');
        const data = { worker: { pollIntervalMs: 9000 }, server: { port: 4000 } };
        writeConfigYaml(configPath, data);

        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('pollIntervalMs: 9000');
        expect(content).toContain('port: 4000');

        const config = loadConfig(configPath);
        expect(config.worker.pollIntervalMs).toBe(9000);
        expect(config.server.port).toBe(4000);
        expect(config.api.defaultLimit).toBe(50); // defaults preserved
    });
});
