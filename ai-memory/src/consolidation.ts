import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { $ } from 'zx';
import { getConfig } from './config.js';
import {
    listProjectsForConsolidation,
    getOrCreateProject,
    updateProjectGitInfo,
    consolidateProject,
} from './db.js';
import { broadcast } from './sse.js';
import { log } from './logger.js';

async function detectGitInfo(absPath: string): Promise<{ root: string; url: string } | null> {
    if (!existsSync(absPath)) return null;

    const rootResult = await $({ quiet: true, nothrow: true, cwd: absPath })`git rev-parse --show-toplevel`;
    if (rootResult.exitCode !== 0) return null;

    const root = rootResult.stdout.trim();
    const urlResult = await $({ quiet: true, nothrow: true, cwd: absPath })`git remote get-url origin`;
    const url = urlResult.exitCode === 0 ? urlResult.stdout.trim() : '';

    return { root, url };
}

function isConsolidationEnabled(projectConsolidate: string): boolean {
    if (projectConsolidate === 'yes') return true;
    if (projectConsolidate === 'no') return false;
    return getConfig().projects.consolidateToGitRoot;
}

export async function checkGitConsolidation(): Promise<void> {
    const rows = listProjectsForConsolidation();
    if (rows.length === 0) return;

    for (const proj of rows) {
        // Phase 1: detect git root if not yet populated
        if (!proj.git_root) {
            const info = await detectGitInfo(proj.path);
            if (!info) continue;
            updateProjectGitInfo(proj.id, info.root, info.url);
            proj.git_root = info.root;
            proj.git_url = info.url;
        }

        // Skip if this IS the root or not in a repo
        if (!proj.git_root || proj.git_root === proj.path) continue;

        // Phase 2: consolidate if enabled
        if (!isConsolidationEnabled(proj.consolidate)) continue;

        const rootProject = getOrCreateProject(proj.git_root);

        // Check root project's override
        const rootRows = listProjectsForConsolidation();
        const rootRow = rootRows.find(r => r.id === rootProject.id);
        if (rootRow?.consolidate === 'no') continue;

        // Copy git info to root project if not already set
        updateProjectGitInfo(rootProject.id, proj.git_root, proj.git_url);

        const subpath = relative(proj.git_root, proj.path);
        const subpathTag = subpath ? `subpath:${subpath}` : '';

        const result = consolidateProject(proj.id, rootProject.id, subpathTag);
        log('consolidation', `Merged ${proj.path} → ${proj.git_root} (${result.memories} memories, ${result.observations} observations)`);
        broadcast('counts:updated', {});
    }
}
