import {
    listMemories,
    listTags,
    getOrCreateProject,
    listDomainsRaw,
    listCategoriesRaw,
    getProjectSummaryState,
    getProjectArchitectureSummary,
} from './db.js';
import { log } from './logger.js';
import { getConfig } from './config.js';
import { countTokens } from './tokens.js';

function formatMemoryLine(m: any): string {
    return `- [${m.category}] (${m.importance}) ${m.content}${m.tags ? ` tags: ${m.tags}` : ''}`;
}

/**
 * Build the deterministic (structured) memory section.
 * Extracted from the original buildStartupContext logic — groups by domain,
 * selects top-1 per domain then fills by importance within budget.
 */
function buildDeterministicMemories(
    allMemories: any[],
    maxTokens: number,
): { text: string; selectedCount: number; totalCount: number; domainNames: string[] } {
    const totalCount = allMemories.length;

    // Group memories by domain
    const byDomain: Record<string, typeof allMemories> = {};
    for (const m of allMemories) {
        const domain = m.domain || 'general';
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(m);
    }

    const domainNames = Object.keys(byDomain).sort();
    const selected: { domain: string; memory: any }[] = [];
    const used = new Set<number>();
    let tokenCount = 0;

    // Phase 1: top-1 per domain
    for (const domain of domainNames) {
        const top = byDomain[domain][0];
        if (top) {
            const line = formatMemoryLine(top);
            const lineTokens = countTokens(line);
            if (tokenCount + lineTokens <= maxTokens) {
                selected.push({ domain, memory: top });
                used.add(top.id);
                tokenCount += lineTokens;
            }
        }
    }

    // Phase 2: fill remaining budget by importance across all domains
    const remaining = allMemories.filter(m => !used.has(m.id));
    for (const m of remaining) {
        const line = formatMemoryLine(m);
        const lineTokens = countTokens(line);
        if (tokenCount + lineTokens > maxTokens) break;
        selected.push({ domain: m.domain || 'general', memory: m });
        tokenCount += lineTokens;
    }

    // Build grouped output
    const grouped: Record<string, string[]> = {};
    for (const { domain, memory } of selected) {
        if (!grouped[domain]) grouped[domain] = [];
        grouped[domain].push(formatMemoryLine(memory));
    }

    const lines: string[] = [];
    const selectedCount = selected.length;

    if (selectedCount > 0) {
        lines.push(`\n## Memories (${selectedCount} of ${totalCount})\n`);
        lines.push(`**Legend:**`);
        lines.push(`> H3 headings = domain (count shown of total)`);
        lines.push(`> Line format: \`- [category] (importance) content tags: t1,t2\``);
        lines.push(`> Importance: 1=trivia, 2=useful, 3=normal, 4=important, 5=critical`);

        const sortedDomains = Object.keys(grouped).sort();
        for (const domain of sortedDomains) {
            const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);
            const domainTotal = byDomain[domain]?.length ?? grouped[domain].length;
            const shownCount = grouped[domain].length;
            const countLabel = shownCount < domainTotal
                ? `${shownCount} of ${domainTotal}`
                : `${shownCount}`;
            lines.push(`\n### ${domainLabel} (${countLabel})`);
            lines.push(...grouped[domain]);
        }
    } else {
        lines.push('\nNo memories yet for this project. Use save_memory or /remember to start building context.');
    }

    return { text: lines.join('\n'), selectedCount, totalCount, domainNames };
}

export function buildStartupContext(projectPath: string): string {
    const project = getOrCreateProject(projectPath);
    const allMemories = listMemories(projectPath, undefined, undefined, 100);
    const tags = listTags(projectPath);

    const memoryBudget = getConfig().context.memoryTokenBudget;
    const budgetWithTolerance = memoryBudget + 200;

    const lines: string[] = [];
    lines.push(`<memory-context project="${projectPath}">`);

    if (getConfig().architecture.enabled) {

        const archSummary = getProjectArchitectureSummary(project.id).trim();
        if (archSummary) {

            lines.push('\n## Project architecture');
            lines.push('> Filesystem-derived snapshot (rescan via `rescan_project_architecture` MCP tool).\n');
            lines.push(archSummary);
        }
    }

    // Compute total formatted token count to decide which path to take
    const totalFormattedTokens = countTokens(
        allMemories.map(m => formatMemoryLine(m)).join('\n')
    );

    let selectedCount = 0;
    const totalCount = allMemories.length;
    let domainNames: string[] = [];

    if (totalFormattedTokens <= budgetWithTolerance) {
        // Path A: Everything fits — use deterministic formatter
        const result = buildDeterministicMemories(allMemories, memoryBudget);
        lines.push(result.text);
        selectedCount = result.selectedCount;
        domainNames = result.domainNames;
    } else {
        // Check for cached summary — always prefer summary over truncated deterministic,
        // since a complete summary of all memories beats showing a fraction of them
        const summaryState = getProjectSummaryState(project.id);

        if (summaryState.summary) {
            // Path B: Use cached LLM summary
            lines.push('\n## Project Summary');
            lines.push('> Below is a synthesis of all memories for this project. References like (#123, #456)');
            lines.push('> point to specific memory IDs -- use `search_memories` to query them directly.\n');
            lines.push(summaryState.summary);
            selectedCount = totalCount; // summary covers all
            // Derive domainNames for the tip section
            const byDomain: Record<string, boolean> = {};
            for (const m of allMemories) byDomain[m.domain || 'general'] = true;
            domainNames = Object.keys(byDomain).sort();
        } else {
            // Path C: Fallback to deterministic (truncated)
            const result = buildDeterministicMemories(allMemories, memoryBudget);
            lines.push(result.text);
            selectedCount = result.selectedCount;
            domainNames = result.domainNames;
        }
    }

    // ── Tags section ──
    let tagTokens = 0;
    const maxTagTokens = getConfig().context.tagsTokenBudget;
    const selectedTags: string[] = [];

    for (const t of tags) {
        const entry = `${t.tag}(${t.count})`;
        const entryTokens = countTokens(entry + ', ');
        if (tagTokens + entryTokens > maxTagTokens) break;
        selectedTags.push(entry);
        tagTokens += entryTokens;
    }

    if (selectedTags.length > 0) {
        lines.push(`\n## Tags (name followed by memory count)\n${selectedTags.join(', ')}`);
    }

    // ── Taxonomy sections (unchanged) ──
    const allDomains = listDomainsRaw();
    if (allDomains.length > 0) {
        lines.push(`\n## Available Domains\n${allDomains.map(d => d.name).join(', ')}`);
    }

    const allCategories = listCategoriesRaw();
    if (allCategories.length > 0) {
        lines.push(
            `\n## Available Categories\n${allCategories.map(c => `${c.name}: ${c.description}`).join('\n')}`,
        );
    }

    // ── Tip section (unchanged) ──
    if (selectedCount > 0 && selectedCount < totalCount) {
        const domainList = domainNames.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ');
        lines.push(`\n> **Tip:** Only ${selectedCount} of ${totalCount} memories are shown above. If your task is heavy on a specific domain (${domainList}), use the \`search_memories\` MCP tool to retrieve deeper context for that domain.`);
    }

    const port = getConfig().server.port;
    lines.push(`\n## ai-memory Dashboard\nManage memories and observations at http://localhost:${port}`);

    lines.push('\n</memory-context>');
    log('context', `Injected ${selectedCount} of ${totalCount} memories across ${domainNames.length} domains for ${projectPath}`);
    return lines.join('\n');
}
