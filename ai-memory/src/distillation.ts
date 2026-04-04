import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    dequeueDistillation,
    completeDistillationQueue,
    listActiveMemoriesByDomain,
    softDeleteMemory,
    resetDistillationState,
    getDistillationState,
    getProjectPathById,
} from './db.js';
import { getConfig } from './config.js';
import { log, error as logError } from './logger.js';
import { broadcast } from './sse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

function loadPrompt(name: string, vars: Record<string, string> = {}): string {
    let text = readFileSync(join(PROMPTS_DIR, `${name}.md`), 'utf-8');
    for (const [key, value] of Object.entries(vars)) {
        text = text.replaceAll(`{{${key}}}`, value);
    }
    return text;
}

function gatherRepoTree(projectPath: string): string {
    try {
        return execSync(
            "tree -L 4 --dirsfirst -I 'node_modules|.git|dist|build|coverage|.next|__pycache__'",
            { cwd: projectPath, encoding: 'utf-8', timeout: 10000 },
        ).slice(0, 8000); // cap output size
    } catch {
        return '(tree command failed or not available)';
    }
}

function gatherGitLog(projectPath: string, sinceIso: string): string {
    try {
        const afterArg = sinceIso
            ? `--after="${sinceIso}"`
            : `--after="${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}"`;
        const output = execSync(
            `git log ${afterArg} --format="%h %s" --stat`,
            { cwd: projectPath, encoding: 'utf-8', timeout: 10000 },
        );
        return output.slice(0, 12000) || '(no commits since last review)';
    } catch {
        return '(git log failed)';
    }
}

async function distillBatch(
    memories: { id: number; content: string; category: string; created_at: string }[],
    domain: string,
    tree: string,
    gitLog: string,
    projectPath: string,
): Promise<{ id: number; reason: string }[]> {
    try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');

        const memoriesJson = JSON.stringify(
            memories.map(m => ({ id: m.id, content: m.content, category: m.category, created_at: m.created_at })),
            null,
            2,
        );

        const prompt = loadPrompt('distill-memories', {
            TREE: tree,
            GIT_LOG: gitLog,
            DOMAIN: domain,
            MEMORIES: memoriesJson,
        });

        let result = '';
        for await (const message of query({
            prompt,
            options: {
                allowedTools: ['Read', 'Glob', 'Grep'],
                permissionMode: 'bypassPermissions',
                model: 'haiku',
                workingDir: projectPath,
            },
        })) {
            if ('result' in message) result = message.result as string;
        }

        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return [];

        const parsed = JSON.parse(jsonMatch[0]);
        return Array.isArray(parsed.delete) ? parsed.delete : [];
    } catch (err) {
        logError('distillation', `LLM batch failed for domain "${domain}": ${err}`);
        return [];
    }
}

export async function processDistillationQueue(): Promise<void> {
    const item = dequeueDistillation();
    if (!item) return;

    try {
        const projectPath = getProjectPathById(item.project_id);
        if (!projectPath || projectPath === '_global') {
            completeDistillationQueue(item.id, 'done');
            return;
        }

        const state = getDistillationState(item.project_id);
        const scanRoot = state.git_root || projectPath;

        log('distillation', `Starting distillation for project ${projectPath}`);

        // Gather signals once, reuse across batches
        const tree = gatherRepoTree(scanRoot);
        const gitLog = gatherGitLog(scanRoot, state.distillation_at);

        // If no commits since last distillation, skip entirely
        if (state.distillation_at && gitLog === '(no commits since last review)') {
            log('distillation', `No changes since last distillation, skipping`);
            resetDistillationState(item.project_id);
            completeDistillationQueue(item.id, 'done');
            return;
        }

        const memsByDomain = listActiveMemoriesByDomain(item.project_id);
        const batchSize = getConfig().distillation.batchSize;
        let totalDeleted = 0;

        for (const [domain, memories] of Object.entries(memsByDomain)) {
            // Process in batches
            for (let i = 0; i < memories.length; i += batchSize) {
                const batch = memories.slice(i, i + batchSize);
                const toDelete = await distillBatch(batch, domain, tree, gitLog, scanRoot);

                for (const entry of toDelete) {
                    // Validate the ID exists in this batch to prevent hallucinated IDs
                    const validId = batch.some(m => m.id === entry.id);
                    if (validId) {
                        softDeleteMemory(entry.id, entry.reason);
                        totalDeleted++;
                    }
                }
            }
        }

        resetDistillationState(item.project_id);
        completeDistillationQueue(item.id, 'done');

        if (totalDeleted > 0) {
            broadcast('counts:updated', {});
        }
        log('distillation', `Distillation complete for ${projectPath}: soft-deleted ${totalDeleted} memories`);
    } catch (err) {
        logError('distillation', `Distillation failed for queue item ${item.id}: ${err}`);
        completeDistillationQueue(item.id, 'failed');
    }
}
