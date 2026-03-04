import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    dequeueObservation,
    completeObservationQueue,
    insertObservation,
    dequeueMemorySynthesis,
    completeMemoryQueue,
    enqueueMemorySynthesis,
    getUnprocessedObservations,
    countUnprocessedObservations,
    insertMemory,
    updateMemory,
    deleteMemory,
    markObservationsProcessed,
    listMemories,
    getDb,
    listProjects,
    listDomainsRaw,
    listCategoriesRaw,
    purgeStaleObservations,
    incrementSkippedCount,
    deleteOverSkippedObservations,
    getProjectsWithStaleObservations,
} from './db.js';
import { broadcast } from './sse.js';
import { log, error as logError } from './logger.js';
import { getConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

function loadPrompt(name: string, vars: Record<string, string> = {}): string {
    let text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${key}}}`, value);
    }
    return text;
}

// Agent SDK spawns a Claude Code subprocess. If we're already inside a CC session,
// the nested session check blocks it. Unsetting CLAUDECODE allows it to run.
delete process.env.CLAUDECODE;

let processing = false;

export async function runBackfill(): Promise<{ processed: number; split: number }> {
    const db = getDb();
    const unassigned = db.prepare(
        'SELECT m.id, m.content, m.tags, m.category, m.importance, m.observation_ids, m.project_id FROM memories m WHERE m.domain IS NULL LIMIT ?'
    ).all(getConfig().worker.backfillBatchSize) as any[];

    if (unassigned.length === 0) return { processed: 0, split: 0 };

    const domains = listDomainsRaw();
    const domainsText = domains.map(d => `- ${d.name}: ${d.description}`).join('\n');

    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const prompt = loadPrompt('backfill-domains', {
            DOMAINS: domainsText,
            MEMORIES: JSON.stringify(unassigned.map(m => ({ id: m.id, content: m.content })), null, 2),
        });

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

        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return { processed: 0, split: 0 };

        const assignments = JSON.parse(jsonMatch[0]) as {
            original_id: number;
            assignments: { domain: string; content: string }[];
        }[];

        let processed = 0;
        let split = 0;

        for (const entry of assignments) {
            const original = unassigned.find(m => m.id === entry.original_id);
            if (!original || !entry.assignments?.length) continue;

            if (entry.assignments.length === 1) {
                updateMemory(
                    original.id,
                    original.content,
                    original.tags,
                    original.category,
                    original.importance,
                    original.observation_ids,
                    entry.assignments[0].domain,
                );
                processed++;
            } else {
                deleteMemory(original.id);
                for (const a of entry.assignments) {
                    insertMemory(
                        original.project_id,
                        a.content,
                        original.tags,
                        original.category,
                        original.importance,
                        original.observation_ids,
                        a.domain,
                    );
                }
                processed++;
                split++;
            }
        }

        log('worker', `Backfill: assigned ${processed} memories, split ${split}`);
        broadcast('counts:updated', {});
        return { processed, split };
    } catch (err) {
        logError('worker', `Backfill failed: ${err}`);
        return { processed: 0, split: 0 };
    }
}

function checkStaleObservations(): void {
    const timeoutMs = getConfig().worker.synthesisTimeoutMs;
    if (timeoutMs === 0) return;
    const staleProjects = getProjectsWithStaleObservations(timeoutMs);
    for (const projectId of staleProjects) {
        enqueueMemorySynthesis(projectId);
        log('worker', `Enqueued stale synthesis for project ${projectId} (timeout: ${timeoutMs}ms)`);
    }
}

export function startWorker(): void {
    log('worker', `Starting queue worker (poll every ${getConfig().worker.pollIntervalMs}ms)`);

    // One-time backfill of unassigned memories
    setTimeout(async () => {
        const db = getDb();
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE domain IS NULL').get() as any).c;
        if (count > 0) {
            log('worker', `Found ${count} memories without domain, starting backfill...`);
            const maxIter = getConfig().worker.maxBackfillIterations;
            for (let i = 0; i < maxIter; i++) {
                const result = await runBackfill();
                if (result.processed === 0) break;
            }
            log('worker', 'Backfill complete');
        }
    }, getConfig().worker.backfillStartupDelayMs);

    setInterval(async () => {
        if (processing) return;
        processing = true;
        try {
            checkStaleObservations();
            await processObservationQueue();
            const synthesized = await processMemoryQueue();
            if (synthesized) runCleanup();
            const purged = purgeStaleObservations();
            if (purged > 0) {
                log('worker', `Purged ${purged} stale processed observations`);
                broadcast('counts:updated', {});
            }
        } catch (err) {
            logError('worker', `Error: ${err}`);
        } finally {
            processing = false;
        }
    }, getConfig().worker.pollIntervalMs);
}

async function processObservationQueue(): Promise<void> {
    const item = dequeueObservation();
    if (!item) return;

    try {
        const payload = JSON.parse(item.payload);
        const observations = await extractObservations(payload);

        for (const obs of observations) {
            const obsId = insertObservation(item.project_id, obs.content, obs.source_summary);
            broadcast('observation:created', { id: obsId, content: obs.content, source_summary: obs.source_summary, project_id: item.project_id });
        }

        completeObservationQueue(item.id, 'done');
        broadcast('counts:updated', {});

        // Check if we should trigger memory synthesis
        const unprocessedCount = countUnprocessedObservations(item.project_id);
        if (unprocessedCount >= getConfig().worker.observationSynthesisThreshold) {
            enqueueMemorySynthesis(item.project_id);
        }

        log('worker', `Extracted ${observations.length} observations from queue item ${item.id}`);
    } catch (err) {
        logError('worker', `Failed to process observation queue item ${item.id}: ${err}`);
        completeObservationQueue(item.id, 'failed');
    }
}

async function processMemoryQueue(): Promise<boolean> {
    const item = dequeueMemorySynthesis();
    if (!item) return false;

    try {
        const observations = getUnprocessedObservations(item.project_id);
        if (observations.length === 0) {
            completeMemoryQueue(item.id, 'done');
            return false;
        }

        const db = getDb();
        const project = db.prepare('SELECT path, description FROM projects WHERE id = ?').get(item.project_id) as any;
        const projectPath = project?.path;
        const projectContext = project?.description
            ? `${project.path} — ${project.description}`
            : project?.path || 'unknown';
        const existingMemories = listMemories(projectPath, undefined, undefined, getConfig().worker.synthesisMemoriesLimit);
        const result = await synthesizeMemories(observations, existingMemories, projectContext);

        const processedObsIds: number[] = [];

        for (const mem of result.creates || []) {
            insertMemory(
                item.project_id,
                mem.content,
                (mem.tags || []).join(','),
                mem.category || 'fact',
                mem.importance || 3,
                (mem.observation_ids || []).join(','),
                mem.domain || 'general',
                mem.reason || 'Synthesized from observations',
            );
            processedObsIds.push(...(mem.observation_ids || []));
        }

        for (const mem of result.updates || []) {
            updateMemory(
                mem.id,
                mem.content,
                (mem.tags || []).join(','),
                mem.category || 'fact',
                mem.importance || 3,
                mem.observation_ids?.join(',') || '',
                mem.domain || 'general',
                mem.reason || 'Updated from new observations',
            );
            processedObsIds.push(...(mem.observation_ids || []));
        }

        if (processedObsIds.length > 0) {
            markObservationsProcessed(processedObsIds);
        }

        // Strike counter: increment skipped_count for observations that were fed but ignored
        const usedSet: Record<number, true> = {};
        for (const id of processedObsIds) usedSet[id] = true;
        const skippedIds = observations.map(o => o.id).filter(id => !usedSet[id]);
        if (skippedIds.length > 0) {
            incrementSkippedCount(skippedIds);
            const deleted = deleteOverSkippedObservations();
            if (deleted > 0) {
                log('worker', `Deleted ${deleted} observations that reached skip limit`);
            }
        }

        completeMemoryQueue(item.id, 'done');
        log('worker', `Synthesized memories: ${result.creates?.length || 0} new, ${result.updates?.length || 0} updated`);
        return true;
    } catch (err) {
        logError('worker', `Failed to process memory queue item ${item.id}: ${err}`);
        completeMemoryQueue(item.id, 'failed');
        return false;
    }
}

async function extractObservations(payload: any): Promise<{ content: string; source_summary: string }[]> {
    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const domains = listDomainsRaw();
        const domainsText = domains.map(d => `- ${d.name}: ${d.description}`).join('\n');

        const prompt = loadPrompt('extract-observations', {
            TURN_DATA: JSON.stringify(payload).slice(0, getConfig().worker.extractionPayloadMaxChars),
            DOMAINS: domainsText,
        });

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

        // Strip markdown code block if present
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        logError('worker', `Agent SDK extraction failed, saving raw turn: ${err}`);
        const summary = typeof payload === 'string' ? payload.slice(0, 100) : JSON.stringify(payload).slice(0, 100);
        return [{ content: summary, source_summary: 'raw turn (extraction failed)' }];
    }
}

// ── Cleanup logic ───────────────────────────────────────────────

async function cleanupWithLLM(projectId: number): Promise<{ observations: number; memories: number }> {
    const db = getDb();

    const observations = db.prepare(
        'SELECT id, content, source_summary FROM observations WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(projectId, getConfig().worker.cleanupObservationsLimit) as { id: number; content: string; source_summary: string }[];

    const memories = db.prepare(
        'SELECT id, content, category, importance, domain FROM memories WHERE project_id = ? ORDER BY importance DESC, updated_at DESC LIMIT ?'
    ).all(projectId, getConfig().worker.cleanupMemoriesLimit) as { id: number; content: string; category: string; importance: number }[];

    if (observations.length === 0 && memories.length === 0) {
        return { observations: 0, memories: 0 };
    }

    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const categories = listCategoriesRaw();
        const categoriesText = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');

        const prompt = loadPrompt('cleanup', {
            OBSERVATIONS: JSON.stringify(observations, null, 2),
            MEMORIES: JSON.stringify(memories, null, 2),
            CATEGORIES: categoriesText,
        });

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

        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { observations: 0, memories: 0 };

        const parsed = JSON.parse(jsonMatch[0]);
        let deletedObs = 0;
        let deletedMem = 0;

        const obsIds = (parsed.delete_observation_ids || []) as number[];
        if (obsIds.length > 0) {
            const placeholders = obsIds.map(() => '?').join(',');
            const r = db.prepare(`DELETE FROM observations WHERE id IN (${placeholders})`).run(...obsIds);
            deletedObs = r.changes;
        }

        const memIds = (parsed.delete_memory_ids || []) as number[];
        if (memIds.length > 0) {
            const placeholders = memIds.map(() => '?').join(',');
            const r = db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...memIds);
            deletedMem = r.changes;
        }

        if (parsed.reasoning) {
            log('worker', `Cleanup reasoning: ${parsed.reasoning}`);
        }

        return { observations: deletedObs, memories: deletedMem };
    } catch (err) {
        logError('worker', `LLM cleanup failed: ${err}`);
        return { observations: 0, memories: 0 };
    }
}

export async function runCleanup(projectId?: number): Promise<{ deleted: { observations: number; memories: number } }> {
    const projects = projectId != null
        ? [{ id: projectId }]
        : listProjects() as { id: number }[];

    let totalObs = 0;
    let totalMem = 0;

    for (const p of projects) {
        const result = await cleanupWithLLM(p.id);
        totalObs += result.observations;
        totalMem += result.memories;
    }

    if (totalObs > 0 || totalMem > 0) {
        log('worker', `Cleanup: removed ${totalObs} observations, ${totalMem} memories`);
        broadcast('counts:updated', {});
    }

    return { deleted: { observations: totalObs, memories: totalMem } };
}

async function synthesizeMemories(
    observations: any[],
    existingMemories: any[],
    projectContext: string = 'unknown',
): Promise<{ creates?: any[]; updates?: any[] }> {
    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const domains = listDomainsRaw();
        const domainsText = domains.map(d => `- ${d.name}: ${d.description}`).join('\n');
        const categories = listCategoriesRaw();
        const categoriesText = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');

        const prompt = loadPrompt('synthesize-memories', {
            PROJECT: projectContext,
            EXISTING_MEMORIES: JSON.stringify(existingMemories.slice(0, getConfig().worker.synthesisTopSlice), null, 2),
            OBSERVATIONS: JSON.stringify(observations, null, 2),
            DOMAINS: domainsText,
            CATEGORIES: categoriesText,
        });

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

        // Extract JSON from response (may be wrapped in markdown code block)
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return {};
        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        logError('worker', `Agent SDK synthesis failed: ${err}`);
        return {};
    }
}
