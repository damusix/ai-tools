import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
    getDb,
    getOrCreateProject,
    enqueueObservation,
    listProjects,
    listMemories,
    deleteMemory,
    deleteObservation,
    listDomains,
    insertDomain,
    updateDomain,
    deleteDomain,
    listCategories,
    insertCategory,
    updateCategory,
    deleteCategory,
    searchMemories,
    searchMemoriesFuzzy,
    transferProject,
    deleteProject,
    updateProjectMeta,
    forceDeleteDomain,
    forceDeleteCategory,
    listDomainsRaw,
    listCategoriesRaw,
    restoreDefaultDomains,
    restoreDefaultCategories,
    getStats,
    listTags,
} from './db.js';
import { homedir } from 'node:os';
import { buildStartupContext } from './context.js';
import { createResponse } from 'better-sse';
import { channel, broadcast } from './sse.js';
import { runCleanup } from './worker.js';
import { log } from './logger.js';
import { getConfig, configSchema, writeConfigYaml } from './config.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadUiHtml(): string {
    const candidates = [
        join(__dirname, 'ui', 'index.html'),
        join(process.cwd(), 'dist', 'ui', 'index.html'),
        join(__dirname, '..', 'dist', 'ui', 'index.html'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return readFileSync(p, 'utf-8');
    }
    return '<html><body><h1>ai-memory UI — run pnpm build first</h1></body></html>';
}

export function createApp(): Hono {
    const app = new Hono();

    // ── MCP Streamable HTTP endpoint ────────────────────────────────
    app.all('/mcp', async (c) => {
        try {
            const server = createMcpServer();
            const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            await server.connect(transport);
            return await transport.handleRequest(c.req.raw);
        } catch (err) {
            log('mcp', `Error handling MCP request: ${err}`);
            return c.json({ error: 'MCP transport error' }, 500);
        }
    });

    // ── Health check ────────────────────────────────────────────────
    app.get('/health', (c) => c.json({ status: 'ok', pid: process.pid }));

    // ── HTTP API: Enqueue turn for observation extraction ───────────
    app.post('/enqueue', async (c) => {
        const body = await c.req.json();
        const projectPath = body.project || '_global';
        const isNew = !listProjects().some(p => p.path === projectPath);
        const project = getOrCreateProject(projectPath);
        const id = enqueueObservation(project.id, JSON.stringify(body.payload || body));
        log('api', `Enqueued turn for ${projectPath}`);
        if (isNew) broadcast('counts:updated', {});
        return c.json({ queued: true, id });
    });

    // ── HTTP API: Startup context ───────────────────────────────────
    app.post('/context', async (c) => {
        const body = await c.req.json();
        const projectPath = body.project || '_global';
        const context = buildStartupContext(projectPath);
        log('api', `Context injected for ${projectPath}`);
        return c.json({ systemMessage: context });
    });

    // ── JSON API for Web UI ─────────────────────────────────────────
    app.get('/api/projects', (c) => {
        return c.json(listProjects());
    });

    app.get('/api/stats', (c) => {
        const project = c.req.query('project');
        return c.json(getStats(project));
    });

    app.delete('/api/projects/:id', (c) => {
        const id = Number(c.req.param('id'));
        try {
            const result = deleteProject(id);
            log('api', `Project ${id} deleted (${result.memories} memories, ${result.observations} observations)`);
            broadcast('counts:updated', {});
            return c.json({ deleted: true, ...result });
        } catch (err: any) {
            return c.json({ error: err.message }, 400);
        }
    });

    app.put('/api/projects/:id/meta', async (c) => {
        const id = Number(c.req.param('id'));
        const { icon, description } = await c.req.json();
        if (typeof icon !== 'string' || typeof description !== 'string') {
            return c.json({ error: 'icon and description must be strings' }, 400);
        }
        updateProjectMeta(id, icon, description);
        log('api', `Project ${id} meta updated`);
        return c.json({ updated: true });
    });

    app.get('/api/memories', (c) => {
        const project = c.req.query('project');
        const tag = c.req.query('tag');
        const category = c.req.query('category');
        const domain = c.req.query('domain');
        const limit = parseInt(c.req.query('limit') || String(getConfig().api.defaultLimit), 10);
        return c.json(listMemories(project, tag, category, limit, domain));
    });

    app.delete('/api/memories/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const deleted = deleteMemory(id);
        if (deleted) {
            log('api', `Memory ${id} deleted`);
            broadcast('memory:deleted', { id });
        }
        return c.json({ deleted });
    });

    app.get('/api/domains', (c) => {
        const project = c.req.query('project');
        return c.json(listDomains(project));
    });

    app.post('/api/domains', async (c) => {
        const { name, description, icon } = await c.req.json();
        if (!name || !description) return c.json({ error: 'name and description required' }, 400);
        insertDomain(name, description, icon || 'fa-folder');
        log('api', `Domain created: ${name}`);
        broadcast('counts:updated', {});
        return c.json({ created: true, name });
    });

    app.put('/api/domains/:name', async (c) => {
        const name = c.req.param('name');
        const { description, icon } = await c.req.json();
        updateDomain(name, description, icon);
        log('api', `Domain updated: ${name}`);
        return c.json({ updated: true, name });
    });

    app.delete('/api/domains/:name', (c) => {
        const name = c.req.param('name');
        try {
            deleteDomain(name);
            log('api', `Domain deleted: ${name}`);
            broadcast('counts:updated', {});
            return c.json({ deleted: true, name });
        } catch (err: any) {
            return c.json({ error: err.message }, 409);
        }
    });

    app.delete('/api/domains/:name/force', (c) => {
        const name = c.req.param('name');
        try {
            const deleted = forceDeleteDomain(name);
            log('api', `Domain "${name}" force-deleted (${deleted} memories deleted)`);
            broadcast('counts:updated', {});
            return c.json({ deleted: true, memoriesDeleted: deleted });
        } catch (err: any) {
            return c.json({ error: err.message }, 400);
        }
    });

    app.post('/api/domains/restore-defaults', (c) => {
        const restored = restoreDefaultDomains();
        log('api', `Restored default domains (${restored} added)`);
        broadcast('counts:updated', {});
        return c.json({ restored });
    });

    app.get('/api/categories', (c) => {
        const project = c.req.query('project');
        return c.json(listCategories(project));
    });

    app.post('/api/categories', async (c) => {
        const { name, description, icon } = await c.req.json();
        if (!name || !description) return c.json({ error: 'name and description required' }, 400);
        insertCategory(name, description, icon || 'fa-bookmark');
        log('api', `Category created: ${name}`);
        broadcast('counts:updated', {});
        return c.json({ created: true, name });
    });

    app.put('/api/categories/:name', async (c) => {
        const name = c.req.param('name');
        const { description, icon } = await c.req.json();
        updateCategory(name, description, icon);
        log('api', `Category updated: ${name}`);
        return c.json({ updated: true, name });
    });

    app.delete('/api/categories/:name', (c) => {
        const name = c.req.param('name');
        try {
            deleteCategory(name);
            log('api', `Category deleted: ${name}`);
            broadcast('counts:updated', {});
            return c.json({ deleted: true, name });
        } catch (err: any) {
            return c.json({ error: err.message }, 409);
        }
    });

    app.delete('/api/categories/:name/force', (c) => {
        const name = c.req.param('name');
        try {
            const deleted = forceDeleteCategory(name);
            log('api', `Category "${name}" force-deleted (${deleted} memories deleted)`);
            broadcast('counts:updated', {});
            return c.json({ deleted: true, memoriesDeleted: deleted });
        } catch (err: any) {
            return c.json({ error: err.message }, 400);
        }
    });

    app.post('/api/categories/restore-defaults', (c) => {
        const restored = restoreDefaultCategories();
        log('api', `Restored default categories (${restored} added)`);
        broadcast('counts:updated', {});
        return c.json({ restored });
    });

    app.get('/api/observations', (c) => {
        const project = c.req.query('project');
        const limit = parseInt(c.req.query('limit') || String(getConfig().api.defaultLimit), 10);
        const db = getDb();
        let sql = `
            SELECT o.id, o.content, o.source_summary, o.processed, o.created_at, p.path as project_path
            FROM observations o
            JOIN projects p ON o.project_id = p.id
        `;
        const params: any[] = [];
        if (project) {
            sql += " WHERE (p.path = ? OR p.path = '_global')";
            params.push(project);
        }
        sql += ' ORDER BY o.created_at DESC LIMIT ?';
        params.push(limit);
        return c.json(db.prepare(sql).all(...params));
    });

    app.delete('/api/observations/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const deleted = deleteObservation(id);
        if (deleted) {
            log('api', `Observation ${id} deleted`);
            broadcast('observation:deleted', { id });
        }
        return c.json({ deleted });
    });

    // ── HTTP API: Recall (keyword search for hooks) ────────────────
    const STOP_WORDS: Record<string, true> = {
        'the': true, 'and': true, 'for': true, 'are': true, 'but': true,
        'not': true, 'you': true, 'all': true, 'can': true, 'had': true,
        'her': true, 'was': true, 'one': true, 'our': true, 'out': true,
        'has': true, 'have': true, 'from': true, 'been': true, 'some': true,
        'them': true, 'than': true, 'this': true, 'that': true, 'they': true,
        'what': true, 'when': true, 'will': true, 'with': true, 'would': true,
        'there': true, 'their': true, 'which': true, 'could': true, 'other': true,
        'about': true, 'into': true, 'your': true, 'just': true, 'also': true,
        'like': true, 'how': true, 'then': true, 'its': true, 'over': true,
        'such': true, 'after': true, 'should': true, 'these': true, 'only': true,
        'where': true, 'most': true, 'does': true, 'each': true, 'much': true,
    };

    app.post('/api/recall', async (c) => {
        try {
            const body = await c.req.json();
            const prompt = String(body.prompt || '');
            const project = body.project as string | undefined;

            const words = prompt
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter((w) => w.length > 0 && !STOP_WORDS[w]);

            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ memories: [] });

            const filtered = unique.filter(w => w.length >= 2);
            if (filtered.length === 0) return c.json({ memories: [] });
            const ftsQuery = filtered.map(w => w + '*').join(' OR ');
            const results = searchMemories(ftsQuery, project, undefined, undefined, 3);
            return c.json({ memories: results });
        } catch {
            return c.json({ memories: [] });
        }
    });

    // ── HTTP API: Search (word-based FTS + trigram fallback) ──────────
    app.get('/api/search', (c) => {
        try {
            const q = c.req.query('q') || '';
            if (!q.trim()) return c.json({ results: [] });

            const project = c.req.query('project');
            const domain = c.req.query('domain');
            const category = c.req.query('category');
            const tag = c.req.query('tag');
            const rawLimit = Number(c.req.query('limit') || '20');
            const limit = rawLimit < 0 ? 20 : rawLimit;

            // Extract and filter words (same logic as /api/recall)
            const words = q
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter((w) => w.length >= 2 && !STOP_WORDS[w]);

            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ results: [] });

            // 1. Word-based FTS with prefix wildcards (precision)
            const wordQuery = unique.map(w => w + '*').join(' OR ');
            const wordResults = searchMemories(wordQuery, project, tag, category, limit, domain);

            // 2. Trigram fallback for remaining slots (substring matching)
            const seen = new Set<number>(wordResults.map((r: any) => r.id));
            let combined = [...wordResults];

            if (limit === 0 || combined.length < limit) {
                const trigramQuery = unique.join(' OR ');
                const remaining = limit === 0 ? 0 : limit - combined.length;
                const trigramResults = searchMemoriesFuzzy(trigramQuery, project, tag, category, remaining, domain);
                for (const r of trigramResults) {
                    if (!seen.has(r.id)) {
                        seen.add(r.id);
                        combined.push(r);
                    }
                }
            }

            return c.json({ results: combined });
        } catch {
            return c.json({ results: [] });
        }
    });

    // ── HTTP API: Taxonomy summary (domains, categories, top tags) ────
    app.get('/api/taxonomy-summary', (c) => {
        const project = c.req.query('project');
        const domains = listDomains(project).filter(d => d.count > 0);
        const categories = listCategories(project).filter(cat => cat.count > 0);
        const tags = listTags(project).slice(0, 20);

        const parts: string[] = [];
        if (domains.length > 0) {
            parts.push('Domains: ' + domains.map(d => `${d.name}(${d.count})`).join(', '));
        }
        if (categories.length > 0) {
            parts.push('Categories: ' + categories.map(cat => `${cat.name}(${cat.count})`).join(', '));
        }
        if (tags.length > 0) {
            parts.push('Top tags: ' + tags.map(t => `${t.tag}(${t.count})`).join(', '));
        }

        return c.json({ summary: parts.join('\n') });
    });

    // ── HTTP API: Transfer project memories to a new path ────────────
    app.post('/api/projects/transfer', async (c) => {
        const body = await c.req.json();
        const from = body.from as string;
        const to = body.to as string;
        if (!from || !to) return c.json({ error: 'Both "from" and "to" are required' }, 400);
        if (from === to) return c.json({ error: '"from" and "to" must be different' }, 400);
        try {
            const result = transferProject(from, to);
            log('api', `Transferred project ${from} → ${to} (${result.memories} memories, ${result.observations} observations)`);
            broadcast('project:transferred', { from, to, ...result });
            return c.json({ transferred: true, ...result });
        } catch (err: any) {
            return c.json({ error: err.message }, 404);
        }
    });

    app.post('/api/projects/transfer-batch', async (c) => {
        const { targetPath, sourcePaths } = await c.req.json();
        if (!targetPath || !Array.isArray(sourcePaths) || sourcePaths.length === 0) {
            return c.json({ error: 'targetPath and sourcePaths[] required' }, 400);
        }

        const results = [];
        for (const fromPath of sourcePaths) {
            try {
                const result = transferProject(fromPath, targetPath);
                results.push({ from: fromPath, ...result });
            } catch (err: any) {
                results.push({ from: fromPath, error: err.message });
            }
        }

        broadcast('counts:updated', {});
        return c.json({ results });
    });

    // ── Logs endpoint ────────────────────────────────────────────────
    app.get('/api/logs', (c) => {
        const logPath = join(homedir(), '.ai-memory', 'server.log');
        const lines = parseInt(c.req.query('lines') || String(getConfig().api.logsDefaultLines), 10);
        const offset = parseInt(c.req.query('offset') || '0', 10);

        if (!existsSync(logPath)) {
            return c.json({ content: 'No log file found at ' + logPath, size: 0, totalLines: 0, hasMore: false });
        }

        const stat = statSync(logPath);
        const raw = readFileSync(logPath, 'utf-8');
        const allLines = raw.split('\n');
        const total = allLines.length;

        // offset=0 means the most recent `lines` lines, offset=500 means skip the last 500 and get the chunk before that
        const end = Math.max(0, total - offset);
        const start = Math.max(0, end - lines);
        const chunk = allLines.slice(start, end).join('\n');

        return c.json({ content: chunk, size: stat.size, totalLines: total, hasMore: start > 0 });
    });

    app.post('/api/logs/truncate', (c) => {
        const logPath = join(homedir(), '.ai-memory', 'server.log');
        try {
            writeFileSync(logPath, '');
            return c.json({ ok: true });
        } catch {
            return c.json({ error: 'Failed to truncate' }, 500);
        }
    });

    // ── Cleanup endpoint ──────────────────────────────────────────────
    app.post('/api/cleanup', async (c) => {
        const projectId = c.req.query('project_id');
        log('api', `Cleanup triggered${projectId ? ` for project ${projectId}` : ' (all projects)'}`);
        const result = await runCleanup(projectId ? parseInt(projectId, 10) : undefined);
        return c.json(result);
    });

    // ── Config endpoints ──────────────────────────────────────────
    app.get('/api/config', (c) => {
        // Flatten nested config for the UI (flat Record<string, number>)
        const cfg = getConfig();
        const flat: Record<string, number> = {};
        for (const section of Object.values(cfg)) {
            Object.assign(flat, section);
        }
        return c.json(flat);
    });

    app.put('/api/config', async (c) => {
        const flat = await c.req.json();
        // Unflatten: map each key back into its section using the schema shape
        const nested: Record<string, Record<string, unknown>> = {};
        const sectionKeys: Record<string, string[]> = {};
        for (const [section, schema] of Object.entries(configSchema.shape)) {
            const inner = (schema as any)._zod.def.innerType;
            sectionKeys[section] = Object.keys(inner.shape);
        }
        for (const [section, keys] of Object.entries(sectionKeys)) {
            nested[section] = {};
            for (const key of keys) {
                if (key in flat) nested[section][key] = flat[key];
            }
        }
        const validated = configSchema.parse(nested);
        writeConfigYaml(undefined, validated);
        log('api', 'Config saved, triggering restart');

        setTimeout(() => {
            const child = spawn(process.argv[0], process.argv.slice(1), {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            process.exit(0);
        }, getConfig().server.restartDelayMs);

        return c.json({ saved: true, restarting: true });
    });

    // ── Restart endpoint ────────────────────────────────────────────
    app.post('/api/restart', (c) => {
        log('server', 'Restart requested');

        setTimeout(() => {
            const child = spawn(process.argv[0], process.argv.slice(1), {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            process.exit(0);
        }, getConfig().server.restartDelayMs);
        return c.json({ restarting: true });
    });

    app.post('/api/taxonomy/generate', async (c) => {
        const { type, prompt: userPrompt } = await c.req.json();
        if (!type || !userPrompt) return c.json({ error: 'type and prompt required' }, 400);
        if (type !== 'domain' && type !== 'category') return c.json({ error: 'type must be "domain" or "category"' }, 400);

        const existing = type === 'domain'
            ? listDomainsRaw().map(d => d.name).join(', ')
            : listCategoriesRaw().map(cat => cat.name).join(', ');

        const systemPrompt = `You generate taxonomy items for a memory management system.
The user wants to create ${type}s. Existing ${type}s: ${existing}

Return ONLY a JSON array of objects with: name (lowercase, kebab-case), description (1 sentence), icon (Font Awesome class like "fa-rocket").
Generate 3-8 items. Do not duplicate existing ${type}s.`;

        try {
            const { query } = await import('@anthropic-ai/claude-agent-sdk');
            let result = '';
            for await (const message of query({
                prompt: `${systemPrompt}\n\n${userPrompt}`,
                options: {
                    allowedTools: [],
                    permissionMode: 'bypassPermissions',
                    model: 'haiku',
                },
            })) {
                if ('result' in message) result = message.result as string;
            }
            const match = result.match(/\[[\s\S]*\]/);
            const items = match ? JSON.parse(match[0]) : [];
            return c.json({ items });
        } catch (err: any) {
            return c.json({ error: err.message }, 500);
        }
    });

    app.post('/api/stop', (c) => {
        log('server', 'Stop requested — server will shut down');
        setTimeout(() => {
            process.exit(0);
        }, getConfig().server.restartDelayMs);
        return c.json({ stopping: true });
    });

    // ── SSE endpoint for real-time UI updates ───────────────────────
    app.get('/api/events', (c) =>
        createResponse(c.req.raw, (session) => {
            channel.register(session);
        }),
    );

    // ── Help topics endpoint ────────────────────────────────────────
    app.get('/api/help/:topic', (c) => {
        const topic = c.req.param('topic');
        if (!/^[a-z-]+$/.test(topic)) return c.json({ error: 'Invalid topic' }, 400);
        const candidates = [
            join(__dirname, 'ui', 'help', `${topic}.md`),
            join(__dirname, '..', 'src', 'ui', 'help', `${topic}.md`),
            join(process.cwd(), 'src', 'ui', 'help', `${topic}.md`),
        ];
        const helpPath = candidates.find(p => existsSync(p));
        if (!helpPath) return c.json({ error: 'Help topic not found' }, 404);
        const content = readFileSync(helpPath, 'utf-8');
        return c.text(content);
    });

    // ── Web UI: Vite-built SolidJS SPA ──────────────────────────────
    app.use('/assets/*', serveStatic({ root: join(__dirname, 'ui') }));

    // SPA fallback — serve index.html for any non-API route
    app.get('*', (c) => c.html(loadUiHtml()));

    return app;
}
