import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('config write', () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'ai-memory-configapi-'));
        configPath = join(tmpDir, 'config.yaml');
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
