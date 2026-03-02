import { serve } from '@hono/node-server';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getDb } from './db.js';
import { startWorker } from './worker.js';
import { createApp } from './app.js';
import { log, logger } from './logger.js';
import { broadcast } from './sse.js';
import { loadConfig, getConfig } from './config.js';

loadConfig(); // Initialize config before anything else

const PORT = getConfig().server.port;
const STATE_DIR = join(homedir(), '.ai-memory');
const PID_FILE = join(STATE_DIR, 'ai-memory.pid');

// Write PID file
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(PID_FILE, String(process.pid));

// Initialize DB
getDb();

const app = createApp();

// ── Start server and worker ─────────────────────────────────────
serve({ fetch: app.fetch, port: PORT }, () => {
    log('server', `Running on http://localhost:${PORT}`);
    log('server', `PID: ${process.pid} written to ${PID_FILE}`);
});

// Stream log lines to SSE clients
logger.on('line', (entry) => broadcast('log:line', entry));

// Start background queue worker
startWorker();

// Cleanup on exit
const cleanup = () => {
    try {
        unlinkSync(PID_FILE);
    } catch {}
    process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
