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
    searchMemories,
    transferProject,
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
        const project = getOrCreateProject(projectPath);
        const id = enqueueObservation(project.id, JSON.stringify(body.payload || body));
        log('api', `Enqueued turn for ${projectPath}`);
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
                .filter((w) => w.length > 3 && !STOP_WORDS[w]);

            const unique = [...new Set(words)].slice(0, 5);
            if (unique.length === 0) return c.json({ memories: [] });

            const ftsQuery = unique.join(' OR ');
            const results = searchMemories(ftsQuery, project, undefined, undefined, 3);
            return c.json({ memories: results });
        } catch {
            return c.json({ memories: [] });
        }
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
