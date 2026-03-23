import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Signal } from './types.js';
import { countTokens } from '../tokens.js';
import { warn } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

function loadPrompt(name: string, vars: Record<string, string> = {}): string {

    let text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {

        text = text.replaceAll(`{{${key}}}`, value);
    }

    return text;
}

function mergeSignals(a: Signal[], b: Signal[]): Signal[] {

    const map = new Map<string, Signal>();
    for (const s of [...a, ...b]) {

        const ex = map.get(s.kind);
        if (!ex) {

            map.set(s.kind, { kind: s.kind, evidence: [...s.evidence] });
        } else {

            const ev = [...new Set([...ex.evidence, ...s.evidence])].slice(0, 12);
            map.set(s.kind, { kind: s.kind, evidence: ev });
        }
    }

    return [...map.values()];
}

export async function collectSignalsLlm(factsJson: string, maxTokens?: number): Promise<Signal[]> {

    const prompt = loadPrompt('architecture-signals', {
        FACTS_JSON: factsJson.slice(0, 120_000),
        MAX_TOKENS: String(maxTokens ?? 1500),
    });

    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let result = '';
    for await (const message of query({
        prompt,
        options: {
            allowedTools: [],
            permissionMode: 'bypassPermissions',
            model: 'haiku',
        },
    })) {

        if ('result' in message) result = message.result as string;
    }

    if (maxTokens && result.length > maxTokens * 5) {
        result = result.slice(0, maxTokens * 5);
    }

    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {

        const parsed = JSON.parse(jsonMatch[0]) as Signal[];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((x) => x && typeof x.kind === 'string' && Array.isArray(x.evidence))
            .map((x) => ({
                kind: String(x.kind).slice(0, 64),
                evidence: x.evidence.map(String).slice(0, 12),
            }));
    } catch {

        return [];
    }
}

export async function generateArchitectureFull(factsJson: string, maxTokens: number): Promise<string> {

    const prompt = loadPrompt('architecture-full', {
        FACTS_JSON: factsJson.slice(0, 120_000),
        MAX_TOKENS: String(maxTokens),
    });

    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let result = '';
    for await (const message of query({
        prompt,
        options: {
            allowedTools: [],
            permissionMode: 'bypassPermissions',
            model: 'haiku',
        },
    })) {

        if ('result' in message) result = message.result as string;
    }

    let text = result.trim();
    const budget = maxTokens;
    let tokenCount = countTokens(text);
    if (tokenCount > budget) {
        warn('architecture', `architecture_full exceeded budget (${tokenCount} > ${budget}), truncating`);
        while (text && tokenCount > budget) {
            text = text.slice(0, Math.floor(text.length * 0.85)).trimEnd();
            if (text.length < 20) break;
            tokenCount = countTokens(text);
        }
    }
    return text;
}

export async function generateArchitectureSummary(
    factsJson: string,
    architectureFull: string,
    maxTokens: number,
): Promise<string> {

    const prompt = loadPrompt('architecture-summary', {
        FACTS_JSON: factsJson.slice(0, 80_000),
        ARCHITECTURE_FULL: architectureFull.slice(0, 60_000),
        MAX_TOKENS: String(maxTokens),
    });

    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let result = '';
    for await (const message of query({
        prompt,
        options: {
            allowedTools: [],
            permissionMode: 'bypassPermissions',
            model: 'haiku',
        },
    })) {

        if ('result' in message) result = message.result as string;
    }

    let text = result.trim();
    const budget = maxTokens;
    const originalTokens = countTokens(text);
    let tokenCount = originalTokens;
    while (text && tokenCount > budget) {
        text = text.slice(0, Math.floor(text.length * 0.85)).trimEnd();
        if (text.length < 20) break;
        tokenCount = countTokens(text);
    }

    if (tokenCount > budget) {
        text = text.slice(0, Math.max(0, text.length - 100)).trimEnd();
    }

    if (countTokens(text) < originalTokens) {
        warn('architecture', `architecture_summary truncated to fit budget (${budget} tokens)`);
    }

    return text;
}

export { mergeSignals };
