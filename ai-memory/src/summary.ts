import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { getMemoriesForHashing, getProjectSummaryState, updateProjectSummary, getDb, listProjects } from './db.js';
import { getConfig } from './config.js';
import { broadcast } from './sse.js';
import { log, error as logError } from './logger.js';

type MemoryRow = {
    id: number; content: string; tags: string; domain: string | null;
    category: string; importance: number; created_at: string; updated_at: string;
};

function hashString(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function hashMemoryFields(m: MemoryRow): string {
    return hashString(`${m.content}\0${m.tags}\0${m.domain ?? ''}\0${m.category}\0${m.importance}`);
}

export function computeMemoryHash(projectId: number): string {
    const memories = getMemoriesForHashing(projectId);
    const budget = getConfig().context.memoryTokenBudget;
    const payload = memories.map(m => `${m.id}\0${hashMemoryFields(m)}`).join('\n');
    return hashString(`${budget}\0${payload}`);
}

export function computeMemorySnapshot(projectId: number): Record<number, string> {
    const memories = getMemoriesForHashing(projectId);
    const result: Record<number, string> = {};
    for (const m of memories) {
        result[m.id] = hashMemoryFields(m);
    }
    return result;
}

export function computeSummaryDelta(
    current: Record<number, string>,
    snapshot: Record<number, string>,
): { added: number[]; updated: number[]; deleted: number[] } {
    const added: number[] = [];
    const updated: number[] = [];
    const deleted: number[] = [];

    for (const idStr of Object.keys(current)) {
        const id = Number(idStr);
        if (!(id in snapshot)) {
            added.push(id);
        } else if (current[id] !== snapshot[id]) {
            updated.push(id);
        }
    }

    for (const idStr of Object.keys(snapshot)) {
        const id = Number(idStr);
        if (!(id in current)) {
            deleted.push(id);
        }
    }

    return { added, updated, deleted };
}

export function loadClaudeMdChain(projectPath: string): string {
    if (projectPath === '_global') return '';
    if (!existsSync(projectPath)) return '';

    const files: string[] = [];

    // 1. User's global CLAUDE.md
    const globalClaude = join(homedir(), '.claude', 'CLAUDE.md');
    if (existsSync(globalClaude)) {
        files.push(readFileSync(globalClaude, 'utf-8'));
    }

    // 2. Walk from project path up to git root, collecting CLAUDE.md files
    const dirFiles: { path: string; content: string }[] = [];
    let dir = projectPath;
    const root = parsePath(dir).root;

    while (dir !== root) {
        const claudeFile = join(dir, 'CLAUDE.md');
        if (existsSync(claudeFile)) {
            dirFiles.push({ path: dir, content: readFileSync(claudeFile, 'utf-8') });
        }
        if (existsSync(join(dir, '.git'))) break;
        dir = dirname(dir);
    }

    // Reverse so outermost directory comes first
    dirFiles.reverse();
    files.push(...dirFiles.map(f => f.content));

    return files.join('\n\n---\n\n');
}

function loadPrompt(name: string, vars: Record<string, string> = {}): string {
    const promptsDir = join(dirname(fileURLToPath(import.meta.url)), 'prompts');
    let text = readFileSync(join(promptsDir, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${key}}}`, value);
    }
    return text;
}

export async function generateSummary(
    projectId: number,
    mode: 'full' | 'incremental',
    deltaMemoryIds?: number[],
): Promise<boolean> {
    const state = getProjectSummaryState(projectId);
    const memories = getMemoriesForHashing(projectId);
    const config = getConfig();
    const budget = config.context.memoryTokenBudget;
    const charBudget = budget * 4;

    // Look up project path for CLAUDE.md
    const db = getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return false;

    const claudeMd = loadClaudeMdChain(project.path);
    const claudeMdSection = claudeMd
        ? `The following is the project's CLAUDE.md chain, which the user already sees at session start. Do NOT repeat information already covered there:\n\n${claudeMd}`
        : '';

    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        let prompt: string;

        if (mode === 'full') {
            const memoriesJson = JSON.stringify(
                memories.map(m => ({
                    id: m.id, content: m.content, tags: m.tags,
                    domain: m.domain, category: m.category, importance: m.importance,
                })),
                null, 2,
            );
            const prevSection = state.summary
                ? `PREVIOUS SUMMARY (preserve what is still accurate, adjust what changed):\n${state.summary}`
                : '';

            prompt = loadPrompt('summarize-full', {
                TOKEN_BUDGET: String(budget),
                CHAR_BUDGET: String(charBudget),
                MEMORIES: memoriesJson,
                CLAUDE_MD_SECTION: claudeMdSection,
                PREVIOUS_SUMMARY_SECTION: prevSection,
            });
        } else {
            const deltaMemories = (deltaMemoryIds || [])
                .map(id => memories.find(m => m.id === id))
                .filter(Boolean);

            const hasAdded = deltaMemoryIds?.some(id => {
                const snap = state.summary_snapshot ? JSON.parse(state.summary_snapshot) : {};
                return !(id in snap);
            });
            const hasUpdated = deltaMemoryIds?.some(id => {
                const snap = state.summary_snapshot ? JSON.parse(state.summary_snapshot) : {};
                return id in snap;
            });
            let deltaType = 'New memories';
            if (hasAdded && hasUpdated) deltaType = 'New and updated memories';
            else if (hasUpdated) deltaType = 'Updated memories';

            prompt = loadPrompt('summarize-incremental', {
                TOKEN_BUDGET: String(budget),
                CHAR_BUDGET: String(charBudget),
                EXISTING_SUMMARY: state.summary,
                DELTA_TYPE_LABEL: deltaType,
                DELTA_MEMORIES: JSON.stringify(
                    deltaMemories.map(m => ({
                        id: m!.id, content: m!.content, tags: m!.tags,
                        domain: m!.domain, category: m!.category, importance: m!.importance,
                    })),
                    null, 2,
                ),
                CLAUDE_MD_SECTION: claudeMdSection,
            });
        }

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

        // Validate result — must be non-empty text (not JSON, not empty)
        const trimmed = result.trim();
        if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
            logError('summary', `LLM returned invalid summary format, skipping`);
            return false;
        }

        // Compute new snapshot and hash
        const newSnapshot = computeMemorySnapshot(projectId);
        const newHash = computeMemoryHash(projectId);
        const incrementalCount = mode === 'full' ? 0 : state.summary_incremental_count + 1;

        updateProjectSummary(
            projectId,
            trimmed,
            newHash,
            JSON.stringify(newSnapshot),
            incrementalCount,
        );

        broadcast('summary:updated', { projectId });
        log('summary', `${mode === 'full' ? 'Full' : 'Incremental'} summary generated for project ${project.path} (${trimmed.length} chars)`);
        return true;
    } catch (err) {
        logError('summary', `Summary generation failed for project ${projectId}: ${err}`);
        return false;
    }
}

export async function checkProjectSummaries(): Promise<void> {
    const config = getConfig();
    const projects = listProjects() as { id: number; path: string }[];

    for (const project of projects) {
        try {
            const currentHash = computeMemoryHash(project.id);
            const state = getProjectSummaryState(project.id);

            // Skip if nothing changed
            if (currentHash === state.summary_hash) continue;

            // Check quiet period — no memory activity in last N ms
            const memories = getMemoriesForHashing(project.id);
            if (memories.length === 0) continue;

            const lastActivity = Math.max(
                ...memories.map(m => new Date(m.updated_at).getTime()),
            );
            const quietMs = config.worker.summary.quietPeriodMs;
            if (Date.now() - lastActivity < quietMs) continue;

            // Determine delta
            const currentSnapshot = computeMemorySnapshot(project.id);
            const oldSnapshot: Record<number, string> = state.summary_snapshot
                ? JSON.parse(state.summary_snapshot)
                : {};
            const delta = computeSummaryDelta(currentSnapshot, oldSnapshot);

            // Decide mode
            let mode: 'full' | 'incremental';
            let deltaIds: number[] | undefined;

            if (
                !state.summary ||
                delta.deleted.length > 0 ||
                state.summary_incremental_count >= config.worker.summary.maxIncrementalCycles
            ) {
                mode = 'full';
            } else {
                mode = 'incremental';
                deltaIds = [...delta.added, ...delta.updated];
            }

            log('summary', `Project "${project.path}": ${mode} summary (added=${delta.added.length}, updated=${delta.updated.length}, deleted=${delta.deleted.length}, cycle=${state.summary_incremental_count})`);
            await generateSummary(project.id, mode, deltaIds);
        } catch (err) {
            logError('summary', `Summary check failed for project ${project.path}: ${err}`);
        }
    }
}
