import { z } from 'zod/v4';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'yaml';

const summarySchema = z.object({
    quietPeriodMs: z.number().min(60000).default(300000),
    maxIncrementalCycles: z.number().min(1).default(10),
    checkIntervalMs: z.number().min(10000).default(60000),
});

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
    summary: summarySchema.default({}),
});

const contextSchema = z.object({
    memoryTokenBudget: z.number().min(100).default(1000),
    tagsTokenBudget: z.number().min(50).default(200),
});

const architectureSchema = z.object({
    enabled: z.boolean().default(true),
    summaryTokenBudget: z.number().min(50).default(500),
    fullMaxTokens: z.number().min(200).default(2000),
    scanIntervalDays: z.number().min(1).default(7),
    signalsMode: z.enum(['regex', 'llm', 'both']).default('regex'),
    signalsLlmMaxTokens: z.number().min(200).default(1500),
    treeMaxDepth: z.number().min(1).default(5),
    manifestMaxFiles: z.number().min(1).default(24),
    manifestMaxCharsPerFile: z.number().min(500).default(12000),
    manifestMaxTotalChars: z.number().min(1000).default(80000),
    scanProjectsPerTick: z.number().min(1).default(3),
});

const serverSchema = z.object({
    port: z.number().min(1).max(65535).default(24636),
    restartDelayMs: z.number().min(50).default(200),
});

const apiSchema = z.object({
    defaultLimit: z.number().min(1).default(50),
    logsDefaultLines: z.number().min(1).default(500),
});

const projectsSchema = z.object({
    consolidateToGitRoot: z.boolean().default(false),
    consolidateIntervalMs: z.number().min(10000).default(60000),
});

export const configSchema = z.object({
    worker: workerSchema.default({}),
    context: contextSchema.default({}),
    architecture: architectureSchema.default({}),
    server: serverSchema.default({}),
    api: apiSchema.default({}),
    projects: projectsSchema.default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

const DEFAULT_CONFIG_PATH = join(homedir(), '.ai-memory', 'config.yaml');

let cached: AppConfig | null = null;

function applyDefaults(raw: Record<string, unknown>): AppConfig {
    // Parse each section individually to ensure inner defaults are applied
    const rawWorker = (raw.worker ?? {}) as Record<string, unknown>;
    const worker = workerSchema.parse({
        ...rawWorker,
        summary: summarySchema.parse(rawWorker.summary ?? {}),
    });
    const context = contextSchema.parse(raw.context ?? {});
    const architecture = architectureSchema.parse(raw.architecture ?? {});
    const server = serverSchema.parse(raw.server ?? {});
    const api = apiSchema.parse(raw.api ?? {});
    const projects = projectsSchema.parse(raw.projects ?? {});
    return { worker, context, architecture, server, api, projects };
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
