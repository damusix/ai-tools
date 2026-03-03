import { z } from 'zod/v4';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

const workerSchema = z.object({
    pollIntervalMs: z.number().min(1000).default(5000),
    observationSynthesisThreshold: z.number().min(1).default(10),
    synthesisTimeoutMs: z.number().min(0).default(1800000),
    observationRetentionDays: z.number().min(1).default(14),
    observationSkipLimit: z.number().min(1).default(3),
    backfillStartupDelayMs: z.number().min(0).default(10000),
    maxBackfillIterations: z.number().min(1).default(20),
    backfillBatchSize: z.number().min(1).default(50),
    synthesisMemoriesLimit: z.number().min(1).default(100),
    synthesisTopSlice: z.number().min(1).default(20),
    cleanupObservationsLimit: z.number().min(1).default(200),
    cleanupMemoriesLimit: z.number().min(1).default(100),
    extractionPayloadMaxChars: z.number().min(100).default(8000),
});

const contextSchema = z.object({
    memoryTokenBudget: z.number().min(100).default(1000),
    tagsTokenBudget: z.number().min(50).default(200),
});

const serverSchema = z.object({
    port: z.number().min(1).max(65535).default(24636),
    restartDelayMs: z.number().min(50).default(200),
});

const apiSchema = z.object({
    defaultLimit: z.number().min(1).default(50),
    logsDefaultLines: z.number().min(1).default(500),
});

export const configSchema = z.object({
    worker: workerSchema.default({}),
    context: contextSchema.default({}),
    server: serverSchema.default({}),
    api: apiSchema.default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

const DEFAULT_CONFIG_PATH = join(homedir(), '.ai-memory', 'config.yaml');

let cached: AppConfig | null = null;

function applyDefaults(raw: Record<string, unknown>): AppConfig {
    // Parse each section individually to ensure inner defaults are applied
    const worker = workerSchema.parse(raw.worker ?? {});
    const context = contextSchema.parse(raw.context ?? {});
    const server = serverSchema.parse(raw.server ?? {});
    const api = apiSchema.parse(raw.api ?? {});
    return { worker, context, server, api };
}

export function loadConfig(path?: string): AppConfig {
    const configPath = path ?? DEFAULT_CONFIG_PATH;
    let raw: Record<string, unknown> = {};

    try {
        const content = readFileSync(configPath, 'utf-8');
        raw = (parse(content) as Record<string, unknown>) ?? {};
    } catch {
        // File doesn't exist — use all defaults
    }

    const config = applyDefaults(raw);
    // Validate the full shape (this will pass since we already parsed sections)
    configSchema.parse(config);
    cached = config;
    return config;
}

export function getConfig(): AppConfig {
    if (cached) return cached;
    return loadConfig();
}

export function writeConfigYaml(path: string | undefined, data: unknown): void {
    const configPath = path ?? DEFAULT_CONFIG_PATH;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, stringify(data), 'utf-8');
}
