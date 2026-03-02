import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, writeConfigYaml, configSchema } from '../src/config.js';

const TMP = join(import.meta.dirname, '..', 'tmp');

describe('config', () => {
    beforeEach(() => {
        mkdirSync(TMP, { recursive: true });
    });

    afterEach(() => {
        rmSync(TMP, { recursive: true, force: true });
    });

    it('returns all defaults when no config file exists', () => {
        const cfg = loadConfig(join(TMP, 'nonexistent.yaml'));
        expect(cfg.worker.pollIntervalMs).toBe(5000);
        expect(cfg.worker.observationSynthesisThreshold).toBe(10);
        expect(cfg.worker.extractionPayloadMaxChars).toBe(8000);
        expect(cfg.context.memoryTokenBudget).toBe(1000);
        expect(cfg.context.tagsTokenBudget).toBe(200);
        expect(cfg.server.port).toBe(24636);
        expect(cfg.server.restartDelayMs).toBe(200);
        expect(cfg.api.defaultLimit).toBe(50);
        expect(cfg.api.logsDefaultLines).toBe(500);
    });

    it('merges partial YAML with defaults', () => {
        const path = join(TMP, 'partial.yaml');
        writeConfigYaml(path, {
            worker: { pollIntervalMs: 2000 },
            server: { port: 4000 },
        });

        const cfg = loadConfig(path);
        expect(cfg.worker.pollIntervalMs).toBe(2000);
        expect(cfg.worker.observationSynthesisThreshold).toBe(10); // default
        expect(cfg.server.port).toBe(4000);
        expect(cfg.server.restartDelayMs).toBe(200); // default
        expect(cfg.context.memoryTokenBudget).toBe(1000); // default
    });

    it('rejects invalid values', () => {
        const path = join(TMP, 'invalid.yaml');
        writeConfigYaml(path, { worker: { pollIntervalMs: -1 } });
        expect(() => loadConfig(path)).toThrow();
    });

    it('writeConfigYaml writes valid YAML that can be read back', () => {
        const path = join(TMP, 'roundtrip.yaml');
        const data = {
            worker: { pollIntervalMs: 3000, backfillBatchSize: 100 },
            context: { memoryTokenBudget: 500 },
        };
        writeConfigYaml(path, data);

        const cfg = loadConfig(path);
        expect(cfg.worker.pollIntervalMs).toBe(3000);
        expect(cfg.worker.backfillBatchSize).toBe(100);
        expect(cfg.context.memoryTokenBudget).toBe(500);
    });
});
