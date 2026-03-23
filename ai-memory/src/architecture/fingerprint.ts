import { createHash } from 'node:crypto';
import type { ArchitectureFacts } from './types.js';

function sortKeysDeep(value: unknown): unknown {

    if (value === null || typeof value !== 'object') {

        return value;
    }

    if (Array.isArray(value)) {

        return value.map(sortKeysDeep);
    }

    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {

        sorted[k] = sortKeysDeep(obj[k]);
    }

    return sorted;
}

/** Hash deterministic scan inputs only (no LLM-derived `signals`). */
export function fingerprintDeterministic(facts: Pick<ArchitectureFacts, 'schemaVersion' | 'tree' | 'manifests' | 'ci'>): string {

    const payload = {
        schemaVersion: facts.schemaVersion,
        tree: facts.tree,
        manifests: facts.manifests,
        ci: facts.ci,
    };
    const json = JSON.stringify(sortKeysDeep(payload));
    return createHash('sha256').update(json, 'utf8').digest('hex');
}
