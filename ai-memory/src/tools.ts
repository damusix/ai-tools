import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    getOrCreateProject,
    searchMemories,
    searchObservations,
    listMemories,
    deleteMemory,
    listTags,
    listProjects,
    insertMemory,
    listDomains,
    transferProject,
} from './db.js';
import { log } from './logger.js';

export function createMcpServer(): McpServer {
    const server = new McpServer({
        name: 'ai-memory',
        version: '0.1.0',
    });

    server.registerTool(
        'save_memory',
        {
            description: 'Save a memory (decision, pattern, preference, fact, or solution).',
            inputSchema: z.object({
                content: z.string().describe('The memory content'),
                tags: z.array(z.string()).default([]).describe('Tags for categorization'),
                category: z.enum(['decision', 'pattern', 'preference', 'fact', 'solution']).default('fact'),
                importance: z.number().min(1).max(5).default(3).describe('1=low, 5=critical'),
                project: z
                    .string()
                    .optional()
                    .describe("Project path. Defaults to current project. Use '_global' for cross-project."),
                domain: z.string().optional().describe('Domain (e.g., frontend, backend, data). See list_domains for options.'),
            }),
        },
        async ({ content, tags, category, importance, project, domain }) => {
            const projectPath = project || process.env.PWD || '_global';
            const proj = getOrCreateProject(projectPath);
            const id = insertMemory(proj.id, content, tags.join(','), category, importance, '', domain);
            log('mcp', `save_memory: id=${id} category=${category} importance=${importance} project=${projectPath}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({ saved: true, id, project: projectPath }) }],
            };
        },
    );

    server.registerTool(
        'search_memories',
        {
            description:
                'Full-text search memories. Supports FTS5 syntax: quotes for phrases, * for prefix, OR/AND/NOT.',
            inputSchema: z.object({
                query: z.string().describe('Search query'),
                tags: z.array(z.string()).optional().describe('Filter by tags'),
                project: z.string().optional().describe('Scope to project path'),
                category: z.enum(['decision', 'pattern', 'preference', 'fact', 'solution']).optional(),
                limit: z.number().default(20),
                domain: z.string().optional().describe('Filter by domain'),
            }),
        },
        async ({ query, tags, project, category, limit, domain }) => {
            const projectPath = project || process.env.PWD || undefined;
            const tag = tags && tags.length > 0 ? tags[0] : undefined;
            const results = searchMemories(query, projectPath, tag, category, limit, domain);
            log('mcp', `search_memories: q="${query}" results=${results.length}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
            };
        },
    );

    server.registerTool(
        'search_observations',
        {
            description: 'Full-text search observations (atomic facts from turns).',
            inputSchema: z.object({
                query: z.string(),
                project: z.string().optional(),
                limit: z.number().default(20),
            }),
        },
        async ({ query, project, limit }) => {
            const projectPath = project || process.env.PWD || undefined;
            const results = searchObservations(query, projectPath, limit);
            log('mcp', `search_observations: q="${query}" results=${results.length}`);
            return {
                content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
            };
        },
    );

    server.registerTool(
        'list_memories',
        {
            description: 'Browse memories with optional filters.',
            inputSchema: z.object({
                project: z.string().optional(),
                tag: z.string().optional(),
                category: z.enum(['decision', 'pattern', 'preference', 'fact', 'solution']).optional(),
                limit: z.number().default(50),
                domain: z.string().optional().describe('Filter by domain'),
            }),
        },
        async ({ project, tag, category, limit, domain }) => {
            const projectPath = project || process.env.PWD || undefined;
            const results = listMemories(projectPath, tag, category, limit, domain);
            return {
                content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
            };
        },
    );

    server.registerTool(
        'delete_memory',
        {
            description: 'Delete a memory by ID.',
            inputSchema: z.object({
                id: z.number().describe('Memory ID to delete'),
            }),
        },
        async ({ id }) => {
            const deleted = deleteMemory(id);
            if (deleted) log('mcp', `delete_memory: id=${id}`);
            return {
                content: [{ type: 'text', text: JSON.stringify({ deleted, id }) }],
            };
        },
    );

    server.registerTool(
        'list_tags',
        {
            description: 'List all distinct tags with usage counts.',
            inputSchema: z.object({
                project: z.string().optional().describe('Project path'),
            }),
        },
        async ({ project }) => {
            const projectPath = project || process.env.PWD || undefined;
            const tags = listTags(projectPath);
            return {
                content: [{ type: 'text', text: JSON.stringify(tags, null, 2) }],
            };
        },
    );

    server.registerTool(
        'list_domains',
        {
            description: 'List all memory domains with usage counts.',
            inputSchema: z.object({
                project: z.string().optional().describe('Project path'),
            }),
        },
        async ({ project }) => {
            const projectPath = project || process.env.PWD || undefined;
            const domains = listDomains(projectPath);
            return {
                content: [{ type: 'text', text: JSON.stringify(domains, null, 2) }],
            };
        },
    );

    server.registerTool(
        'list_projects',
        {
            description: 'List all known projects with memory/observation counts.',
            inputSchema: z.object({}),
        },
        async () => {
            const projects = listProjects();
            return {
                content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
            };
        },
    );

    server.registerTool(
        'transfer_project',
        {
            description:
                'Transfer all memories and observations from one project path to another. Use when a project folder has been renamed or moved.',
            inputSchema: z.object({
                from: z.string().describe('Source project path (the old path)'),
                to: z.string().describe('Target project path (the new path)'),
            }),
        },
        async ({ from, to }) => {
            try {
                const result = transferProject(from, to);
                log('mcp', `transfer_project: ${from} → ${to} (${result.memories} memories, ${result.observations} observations)`);
                return {
                    content: [{ type: 'text', text: JSON.stringify({ transferred: true, from, to, ...result }) }],
                };
            } catch (err: any) {
                return {
                    content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
                };
            }
        },
    );

    return server;
}
