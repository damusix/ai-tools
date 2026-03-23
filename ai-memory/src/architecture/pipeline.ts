import { getConfig } from '../config.js';
import {
    getProjectArchitecture,
    getProjectPathById,
    listArchitectureProjectIds,
    updateProjectArchitecture,
} from '../db.js';
import { log, warn } from '../logger.js';
import { broadcast } from '../sse.js';
import { fingerprintDeterministic } from './fingerprint.js';
import {
    collectSignalsLlm,
    generateArchitectureFull,
    generateArchitectureSummary,
    mergeSignals,
} from './llm.js';
import { scanProjectArchitectureBase } from './scan.js';
import type { ArchitectureFacts, ScanOptions } from './types.js';

function scanOptionsFromConfig(): ScanOptions {

    const a = getConfig().architecture;
    return {
        treeMaxDepth: a.treeMaxDepth,
        manifestMaxDepth: a.treeMaxDepth,
        manifestMaxFiles: a.manifestMaxFiles,
        manifestMaxCharsPerFile: a.manifestMaxCharsPerFile,
        manifestMaxTotalChars: a.manifestMaxTotalChars,
    };
}

function daysSinceScan(scannedAtIso: string): number {

    if (!scannedAtIso.trim()) return Number.POSITIVE_INFINITY;
    const t = Date.parse(scannedAtIso);
    if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
    return (Date.now() - t) / 86400000;
}

/**
 * Runs filesystem scan + optional signal LLM + architecture full/summary Haiku passes, then persists.
 * @returns true if a new snapshot was written.
 */
export async function runArchitectureScanForProject(
    projectId: number,
    opts: { force?: boolean } = {},
): Promise<boolean> {

    const cfg = getConfig().architecture;
    if (!cfg.enabled) return false;

    const projectPath = getProjectPathById(projectId);
    if (!projectPath || projectPath === '_global') return false;

    const base = scanProjectArchitectureBase(projectPath, scanOptionsFromConfig());
    if (base.error) {
        warn('architecture', `Scan error for project ${projectPath}: ${base.error}`);
        return false;
    }

    const fp = fingerprintDeterministic(base);
    const stored = getProjectArchitecture(projectId);
    const interval = cfg.scanIntervalDays;
    const staleEnough = daysSinceScan(stored.scannedAt) >= interval;
    const fingerprintChanged = fp !== stored.fingerprint;

    if (!opts.force && !fingerprintChanged && !staleEnough) {
        log('architecture', `Skipped ${projectPath} (fingerprint unchanged, scan not stale)`);
        return false;
    }

    log('architecture', `Scanning ${projectPath} (force=${!!opts.force} fpChanged=${fingerprintChanged} stale=${staleEnough})`);

    let facts: ArchitectureFacts = { ...base };
    const mode = cfg.signalsMode;

    if (mode === 'llm' || mode === 'both') {
        const payload =
            mode === 'llm'
                ? { ...base, signals: [] as ArchitectureFacts['signals'] }
                : base;
        const llmSignals = await collectSignalsLlm(JSON.stringify(payload), cfg.signalsLlmMaxTokens);
        facts.signals = mode === 'llm' ? llmSignals : mergeSignals(base.signals, llmSignals);
    }

    const factsJson = JSON.stringify(facts);
    const full = await generateArchitectureFull(factsJson, cfg.fullMaxTokens);
    const summary = await generateArchitectureSummary(factsJson, full, cfg.summaryTokenBudget);

    updateProjectArchitecture(projectId, {
        facts: factsJson,
        full,
        summary,
        fingerprint: fp,
        scannedAt: facts.scannedAt,
    });

    broadcast('counts:updated', {});
    log('architecture', `Wrote snapshot for ${projectPath}`);
    return true;
}

/**
 * Runs ONLY the deterministic scan (tree + manifests + signals + fingerprint).
 * No Haiku calls. Returns raw facts JSON + fingerprint + whether fingerprint changed.
 */
export function runDeterministicScan(
    projectId: number,
): { facts: ArchitectureFacts; fingerprint: string; changed: boolean } | { error: string } {
    const projectPath = getProjectPathById(projectId);
    if (!projectPath || projectPath === '_global') return { error: '_global or missing path' };

    // Deterministic scan works even when architecture.enabled is false (user-initiated)
    const base = scanProjectArchitectureBase(projectPath, scanOptionsFromConfig());
    if (base.error) return { error: base.error };

    const fp = fingerprintDeterministic(base);
    const stored = getProjectArchitecture(projectId);
    return { facts: base, fingerprint: fp, changed: fp !== stored.fingerprint };
}

/** Rotating batch of projects per worker tick (cheap no-op when nothing is due). */
export async function checkArchitectureScans(pollCount: number): Promise<void> {

    const cfg = getConfig().architecture;
    if (!cfg.enabled) return;

    const rows = listArchitectureProjectIds();
    if (rows.length === 0) return;

    const max = cfg.scanProjectsPerTick;
    const start = (pollCount * max) % rows.length;
    const ordered = [...rows.slice(start), ...rows.slice(0, start)];

    for (let i = 0; i < Math.min(max, ordered.length); i++) {

        await runArchitectureScanForProject(ordered[i].id, { force: false });
    }
}
