import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getConfig } from './config.js';

const STATE_DIR = join(homedir(), '.ai-memory');
const DB_PATH = join(STATE_DIR, 'memory.db');

let _db: Database.Database | null = null;

export function initDb(dbPath?: string): Database.Database {
    if (_db) return _db;

    const resolvedPath = dbPath ?? DB_PATH;
    const dir = join(resolvedPath, '..');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    _db = new Database(resolvedPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');

    initSchema(_db);
    return _db;
}

export function closeDb(): void {
    if (_db) {
        _db.close();
        _db = null;
    }
}

export function getDb(): Database.Database {
    if (_db) return _db;
    return initDb();
}

export const DOMAIN_SEED: [string, string, string][] = [
    ['frontend', 'UI components, routing, state management, browser APIs, DOM', 'fa-display'],
    ['styling', 'CSS, themes, layouts, responsive design, animations', 'fa-palette'],
    ['backend', 'Server logic, business rules, middleware, request handling', 'fa-server'],
    ['api', 'API design, REST/GraphQL contracts, versioning, endpoints', 'fa-globe'],
    ['data', 'Database, schemas, queries, migrations, ORMs, caching', 'fa-database'],
    ['auth', 'Authentication, authorization, sessions, tokens, RBAC', 'fa-key'],
    ['testing', 'Test frameworks, strategies, fixtures, mocking, coverage', 'fa-vial'],
    ['performance', 'Optimization, caching, profiling, lazy loading, bundle size', 'fa-gauge-high'],
    ['security', 'Vulnerabilities, hardening, input validation, OWASP', 'fa-shield-halved'],
    ['accessibility', 'a11y, WCAG, screen readers, keyboard navigation', 'fa-universal-access'],
    ['infrastructure', 'Deployment, hosting, cloud, Docker, serverless', 'fa-cloud'],
    ['devops', 'CI/CD, pipelines, environments, release process', 'fa-code-branch'],
    ['monitoring', 'Logging, alerting, observability, error tracking', 'fa-chart-line'],
    ['tooling', 'Build tools, linters, formatters, bundlers, dev environment', 'fa-wrench'],
    ['git', 'Version control, branching strategy, hooks, workflows', 'fa-code-branch'],
    ['dependencies', 'Package management, upgrades, compatibility, vendoring', 'fa-cubes'],
    ['architecture', 'System design, patterns, module structure, conventions', 'fa-sitemap'],
    ['integrations', 'Third-party services, SDKs, webhooks, external APIs', 'fa-plug'],
    ['general', 'Cross-cutting concerns that don\'t fit elsewhere', 'fa-folder'],
];

export const CATEGORY_SEED: [string, string, string][] = [
    ['decision', 'A choice made between options, with rationale', 'fa-gavel'],
    ['pattern', 'A recurring approach established for the codebase', 'fa-repeat'],
    ['preference', 'A user style or workflow preference', 'fa-sliders'],
    ['fact', 'A discovered truth about the system or environment', 'fa-bookmark'],
    ['solution', 'A working fix for a non-obvious problem', 'fa-puzzle-piece'],
];

function initSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'fa-folder-open',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            content TEXT NOT NULL,
            source_summary TEXT NOT NULL,
            processed INTEGER NOT NULL DEFAULT 0,
            skipped_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'fact',
            importance INTEGER NOT NULL DEFAULT 3
                CHECK(importance BETWEEN 1 AND 5),
            observation_ids TEXT NOT NULL DEFAULT '',
            domain TEXT REFERENCES domains(name),
            reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts
            USING fts5(content, content=observations, content_rowid=id);

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
            USING fts5(content, tags, content=memories, content_rowid=id);

        -- FTS sync triggers for observations
        CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
            INSERT INTO observations_fts(rowid, content) VALUES (new.id, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, content) VALUES ('delete', old.id, old.content);
            INSERT INTO observations_fts(rowid, content) VALUES (new.id, new.content);
        END;

        -- FTS sync triggers for memories
        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
            INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_trigram
            USING fts5(content, tags, content=memories, content_rowid=id, tokenize="trigram");

        CREATE TRIGGER IF NOT EXISTS memories_trigram_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_trigram_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_trigram_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_trigram(memories_trigram, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
            INSERT INTO memories_trigram(rowid, content, tags) VALUES (new.id, new.content, new.tags);
        END;

        CREATE TABLE IF NOT EXISTS observation_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS memory_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        );

        CREATE TABLE IF NOT EXISTS domains (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT 'fa-folder'
        );

        CREATE TABLE IF NOT EXISTS categories (
            name TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT 'fa-bookmark'
        );

        CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project_id);
        CREATE INDEX IF NOT EXISTS idx_observations_processed ON observations(processed);
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories(domain);
        CREATE INDEX IF NOT EXISTS idx_obs_queue_status ON observation_queue(status);
        CREATE INDEX IF NOT EXISTS idx_mem_queue_status ON memory_queue(status);
    `);

    // Seed default domains
    const insertDomainStmt = db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)');
    for (const [name, desc, icon] of DOMAIN_SEED) {
        insertDomainStmt.run(name, desc, icon);
    }

    // Seed default categories
    const insertCategoryStmt = db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)');
    for (const [name, desc, icon] of CATEGORY_SEED) {
        insertCategoryStmt.run(name, desc, icon);
    }

    // Seed the _global project
    db.prepare(
        `
        INSERT OR IGNORE INTO projects (path, name) VALUES ('_global', 'global')
    `,
    ).run();

    // Backfill trigram FTS from existing memories (idempotent)
    const trigramCount = (db.prepare('SELECT COUNT(*) as c FROM memories_trigram_docsize').get() as any).c;
    const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    if (trigramCount < memoryCount) {
        db.exec("INSERT INTO memories_trigram(memories_trigram) VALUES('rebuild')");
    }
}

// ── Project queries ─────────────────────────────────────────────

export function getOrCreateProject(projectPath: string): { id: number; path: string; name: string } {
    const db = getDb();
    const existing = db.prepare('SELECT id, path, name FROM projects WHERE path = ?').get(projectPath) as any;
    if (existing) return existing;

    const name = projectPath === '_global' ? 'global' : projectPath.split('/').pop() || projectPath;
    const result = db.prepare('INSERT INTO projects (path, name) VALUES (?, ?)').run(projectPath, name);
    return { id: Number(result.lastInsertRowid), path: projectPath, name };
}

export function deleteProject(projectId: number): { memories: number; observations: number } {
    const db = getDb();
    const proj = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as any;
    if (!proj) throw new Error(`Project ${projectId} not found`);
    if (proj.path === '_global') throw new Error('Cannot delete the global project');

    const doDelete = db.transaction(() => {
        const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE project_id = ?').get(projectId) as any).c;
        const obsCount = (db.prepare('SELECT COUNT(*) as c FROM observations WHERE project_id = ?').get(projectId) as any).c;

        db.prepare('DELETE FROM observation_queue WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM memory_queue WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM memories WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM observations WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

        return { memories: memCount, observations: obsCount };
    });

    return doDelete();
}

export function updateProjectMeta(projectId: number, icon: string, description: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET icon = ?, description = ? WHERE id = ?').run(icon, description, projectId);
}

export function listProjects(): any[] {
    const db = getDb();
    return db
        .prepare(
            `
        SELECT p.id, p.path, p.name, p.icon, p.description, p.created_at,
            (SELECT COUNT(*) FROM observations WHERE project_id = p.id) as observation_count,
            (SELECT COUNT(*) FROM memories WHERE project_id = p.id) as memory_count
        FROM projects p
        ORDER BY p.name
    `,
        )
        .all();
}

// ── Observation queries ─────────────────────────────────────────

export function insertObservation(projectId: number, content: string, sourceSummary: string): number {
    const db = getDb();
    const result = db
        .prepare('INSERT INTO observations (project_id, content, source_summary) VALUES (?, ?, ?)')
        .run(projectId, content, sourceSummary);
    return Number(result.lastInsertRowid);
}

export function searchObservations(query: string, projectPath?: string, limit = 20): any[] {
    const db = getDb();
    let sql = `
        SELECT o.id, o.content, o.source_summary, o.processed, o.created_at, p.path as project_path
        FROM observations o
        JOIN observations_fts f ON o.id = f.rowid
        JOIN projects p ON o.project_id = p.id
        WHERE observations_fts MATCH ?
    `;
    const params: any[] = [query];

    if (projectPath) {
        sql += " AND (p.path = ? OR p.path = '_global')";
        params.push(projectPath);
    }
    sql += ` ORDER BY o.created_at DESC LIMIT ?`;
    params.push(limit);

    return db.prepare(sql).all(...params);
}

export function getUnprocessedObservations(projectId: number): any[] {
    const db = getDb();
    return db
        .prepare(
            'SELECT id, content, source_summary, created_at FROM observations WHERE project_id = ? AND processed = 0 ORDER BY created_at',
        )
        .all(projectId);
}

export function markObservationsProcessed(ids: number[]): void {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE observations SET processed = 1 WHERE id IN (${placeholders})`).run(...ids);
}

// ── Memory queries ──────────────────────────────────────────────

export function insertMemory(
    projectId: number,
    content: string,
    tags: string,
    category: string,
    importance: number,
    observationIds: string,
    domain?: string,
    reason?: string,
): number {
    const validCats = listCategoriesRaw();
    if (!validCats.some(c => c.name === category)) {
        throw new Error(`Invalid category: "${category}". Valid: ${validCats.map(c => c.name).join(', ')}`);
    }
    if (domain) {
        const validDoms = listDomainsRaw();
        if (!validDoms.some(d => d.name === domain)) {
            throw new Error(`Invalid domain: "${domain}". Valid: ${validDoms.map(d => d.name).join(', ')}`);
        }
    }
    const db = getDb();
    const now = new Date().toISOString();
    const result = db
        .prepare(
            `INSERT INTO memories (project_id, content, tags, category, importance, observation_ids, domain, reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(projectId, content, tags, category, importance, observationIds, domain ?? null, reason ?? '', now, now);
    return Number(result.lastInsertRowid);
}

export function updateMemory(
    id: number,
    content: string,
    tags: string,
    category: string,
    importance: number,
    observationIds: string,
    domain?: string,
    reason?: string,
): void {
    const validCats = listCategoriesRaw();
    if (!validCats.some(c => c.name === category)) {
        throw new Error(`Invalid category: "${category}". Valid: ${validCats.map(c => c.name).join(', ')}`);
    }
    if (domain) {
        const validDoms = listDomainsRaw();
        if (!validDoms.some(d => d.name === domain)) {
            throw new Error(`Invalid domain: "${domain}". Valid: ${validDoms.map(d => d.name).join(', ')}`);
        }
    }
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
        `UPDATE memories SET content = ?, tags = ?, category = ?, importance = ?, observation_ids = ?, domain = ?, reason = ?, updated_at = ?
         WHERE id = ?`,
    ).run(content, tags, category, importance, observationIds, domain ?? null, reason ?? '', now, id);
}

export function searchMemories(
    query: string,
    projectPath?: string,
    tag?: string,
    category?: string,
    limit = 20,
    domain?: string,
): any[] {
    const db = getDb();
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, p.path as project_path
        FROM memories m
        JOIN memories_fts f ON m.id = f.rowid
        JOIN projects p ON m.project_id = p.id
        WHERE memories_fts MATCH ?
    `;
    const params: any[] = [query];

    if (projectPath) {
        sql += " AND (p.path = ? OR p.path = '_global')";
        params.push(projectPath);
    }
    if (tag) {
        sql += ' AND m.tags LIKE ?';
        params.push(`%${tag}%`);
    }
    if (category) {
        sql += ' AND m.category = ?';
        params.push(category);
    }
    if (domain) {
        sql += ' AND m.domain = ?';
        params.push(domain);
    }
    sql += ' ORDER BY m.importance DESC, m.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
}

export function searchMemoriesFuzzy(
    query: string,
    projectPath?: string,
    tag?: string,
    category?: string,
    limit = 20,
    domain?: string,
): any[] {
    if (!query || query.trim().length < 3) return [];
    const db = getDb();
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, p.path as project_path
        FROM memories m
        JOIN memories_trigram f ON m.id = f.rowid
        JOIN projects p ON m.project_id = p.id
        WHERE memories_trigram MATCH ?
    `;
    const params: any[] = [query];

    if (projectPath) {
        sql += " AND (p.path = ? OR p.path = '_global')";
        params.push(projectPath);
    }
    if (tag) {
        sql += ' AND m.tags LIKE ?';
        params.push(`%${tag}%`);
    }
    if (category) {
        sql += ' AND m.category = ?';
        params.push(category);
    }
    if (domain) {
        sql += ' AND m.domain = ?';
        params.push(domain);
    }
    sql += ' ORDER BY m.importance DESC, m.created_at DESC';
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
}

export function listMemories(projectPath?: string, tag?: string, category?: string, limit = 50, domain?: string): any[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (projectPath) {
        conditions.push("(p.path = ? OR p.path = '_global')");
        params.push(projectPath);
    }
    if (tag) {
        conditions.push('m.tags LIKE ?');
        params.push(`%${tag}%`);
    }
    if (category) {
        conditions.push('m.category = ?');
        params.push(category);
    }
    if (domain) {
        conditions.push('m.domain = ?');
        params.push(domain);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `
        SELECT m.id, m.content, m.tags, m.category, m.importance, m.domain, m.created_at, m.updated_at, m.reason, p.path as project_path
        FROM memories m
        JOIN projects p ON m.project_id = p.id
        ${where}
        ORDER BY m.importance DESC, m.created_at DESC
    `;
    if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
    }

    return db.prepare(sql).all(...params);
}

export function deleteMemory(id: number): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
}

export function deleteObservation(id: number): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM observations WHERE id = ?').run(id);
    return result.changes > 0;
}

export function getStats(projectPath?: string): { memories: number; observations: number } {
    const db = getDb();

    if (projectPath) {
        const row = db.prepare(`
            SELECT
                (SELECT COUNT(*) FROM memories m JOIN projects p ON m.project_id = p.id WHERE p.path = ? OR p.path = '_global') as memories,
                (SELECT COUNT(*) FROM observations o JOIN projects p ON o.project_id = p.id WHERE p.path = ? OR p.path = '_global') as observations
        `).get(projectPath, projectPath) as any;
        return { memories: row.memories, observations: row.observations };
    }

    const row = db.prepare(`
        SELECT
            (SELECT COUNT(*) FROM memories) as memories,
            (SELECT COUNT(*) FROM observations) as observations
    `).get() as any;
    return { memories: row.memories, observations: row.observations };
}

// ── Domain queries ──────────────────────────────────────────────

export function listDomains(projectPath?: string): { name: string; description: string; icon: string; count: number }[] {
    const db = getDb();
    let sql = `
        SELECT d.name, d.description, d.icon, COUNT(m.id) as count
        FROM domains d
        LEFT JOIN memories m ON m.domain = d.name
    `;
    const params: any[] = [];

    if (projectPath) {
        sql += `
            LEFT JOIN projects p ON m.project_id = p.id
            WHERE (m.id IS NULL OR p.path = ? OR p.path = '_global')
        `;
        params.push(projectPath);
    }

    sql += ' GROUP BY d.name ORDER BY count DESC, d.name';
    return db.prepare(sql).all(...params) as any[];
}

export function listDomainsRaw(): { name: string; description: string; icon: string }[] {
    const db = getDb();
    return db.prepare('SELECT name, description, icon FROM domains ORDER BY name').all() as any[];
}

export function insertDomain(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)').run(name, description, icon);
}

export function updateDomain(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('UPDATE domains SET description = ?, icon = ? WHERE name = ?').run(description, icon, name);
}

export function deleteDomain(name: string): void {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE domain = ?').get(name) as any).c;
    if (count > 0) throw new Error(`Cannot delete domain "${name}": ${count} memories reference it`);
    db.prepare('DELETE FROM domains WHERE name = ?').run(name);
}

export function forceDeleteDomain(name: string): number {
    const db = getDb();
    const doDelete = db.transaction(() => {
        const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE domain = ?').get(name) as any).c;
        if (count > 0) {
            db.prepare("DELETE FROM memories WHERE domain = ?").run(name);
        }
        db.prepare('DELETE FROM domains WHERE name = ?').run(name);
        return count;
    });
    return doDelete();
}

// ── Category queries ────────────────────────────────────────────

export function listCategoriesRaw(): { name: string; description: string; icon: string }[] {
    const db = getDb();
    return db.prepare('SELECT name, description, icon FROM categories ORDER BY name').all() as any[];
}

export function listCategories(projectPath?: string): { name: string; description: string; icon: string; count: number }[] {
    const db = getDb();
    let sql = `
        SELECT c.name, c.description, c.icon, COUNT(m.id) as count
        FROM categories c
        LEFT JOIN memories m ON m.category = c.name
    `;
    const params: any[] = [];

    if (projectPath) {
        sql += `
            LEFT JOIN projects p ON m.project_id = p.id
            WHERE (m.id IS NULL OR p.path = ? OR p.path = '_global')
        `;
        params.push(projectPath);
    }

    sql += ' GROUP BY c.name ORDER BY count DESC, c.name';
    return db.prepare(sql).all(...params) as any[];
}

export function insertCategory(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)').run(name, description, icon);
}

export function updateCategory(name: string, description: string, icon: string): void {
    const db = getDb();
    db.prepare('UPDATE categories SET description = ?, icon = ? WHERE name = ?').run(description, icon, name);
}

export function deleteCategory(name: string): void {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE category = ?').get(name) as any).c;
    if (count > 0) throw new Error(`Cannot delete category "${name}": ${count} memories reference it`);
    db.prepare('DELETE FROM categories WHERE name = ?').run(name);
}

export function forceDeleteCategory(name: string): number {
    const db = getDb();
    const doDelete = db.transaction(() => {
        const count = (db.prepare("SELECT COUNT(*) as c FROM memories WHERE category = ?").get(name) as any).c;
        if (count > 0) {
            db.prepare("DELETE FROM memories WHERE category = ?").run(name);
        }
        db.prepare('DELETE FROM categories WHERE name = ?').run(name);
        return count;
    });
    return doDelete();
}

export function restoreDefaultDomains(): number {
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO domains (name, description, icon) VALUES (?, ?, ?)');
    let restored = 0;
    for (const [name, desc, icon] of DOMAIN_SEED) {
        const result = stmt.run(name, desc, icon);
        if (result.changes > 0) restored++;
    }
    return restored;
}

export function restoreDefaultCategories(): number {
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO categories (name, description, icon) VALUES (?, ?, ?)');
    let restored = 0;
    for (const [name, desc, icon] of CATEGORY_SEED) {
        const result = stmt.run(name, desc, icon);
        if (result.changes > 0) restored++;
    }
    return restored;
}

// ── Tag queries ─────────────────────────────────────────────────

export function listTags(projectPath?: string): { tag: string; count: number }[] {
    const db = getDb();
    let sql = 'SELECT tags FROM memories m JOIN projects p ON m.project_id = p.id';
    const params: any[] = [];

    if (projectPath) {
        sql += " WHERE p.path = ? OR p.path = '_global'";
        params.push(projectPath);
    }

    const rows = db.prepare(sql).all(...params) as { tags: string }[];
    const counts: Record<string, number> = {};
    for (const row of rows) {
        if (!row.tags) continue;
        for (const tag of row.tags.split(',')) {
            const t = tag.trim();
            if (t) counts[t] = (counts[t] || 0) + 1;
        }
    }
    return Object.entries(counts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
}

// ── Queue queries ───────────────────────────────────────────────

export function enqueueObservation(projectId: number, payload: string): number {
    const db = getDb();
    const result = db
        .prepare('INSERT INTO observation_queue (project_id, payload) VALUES (?, ?)')
        .run(projectId, payload);
    return Number(result.lastInsertRowid);
}

export function dequeueObservation(): any | null {
    const db = getDb();
    const row = db
        .prepare("SELECT id, project_id, payload FROM observation_queue WHERE status = 'pending' ORDER BY id LIMIT 1")
        .get() as any;
    if (!row) return null;
    db.prepare("UPDATE observation_queue SET status = 'processing' WHERE id = ?").run(row.id);
    return row;
}

export function completeObservationQueue(id: number, status: 'done' | 'failed'): void {
    const db = getDb();
    db.prepare('UPDATE observation_queue SET status = ? WHERE id = ?').run(status, id);
}

export function enqueueMemorySynthesis(projectId: number): number {
    const db = getDb();
    const result = db.prepare('INSERT INTO memory_queue (project_id) VALUES (?)').run(projectId);
    return Number(result.lastInsertRowid);
}

export function dequeueMemorySynthesis(): any | null {
    const db = getDb();
    const row = db
        .prepare("SELECT id, project_id FROM memory_queue WHERE status = 'pending' ORDER BY id LIMIT 1")
        .get() as any;
    if (!row) return null;
    db.prepare("UPDATE memory_queue SET status = 'processing' WHERE id = ?").run(row.id);
    return row;
}

export function completeMemoryQueue(id: number, status: 'done' | 'failed'): void {
    const db = getDb();
    db.prepare('UPDATE memory_queue SET status = ? WHERE id = ?').run(status, id);
}

export function purgeStaleObservations(): number {
    const db = getDb();
    const days = getConfig().worker.observationRetentionDays;
    const result = db.prepare(
        `DELETE FROM observations WHERE processed = 1 AND created_at < datetime('now', '-${days} days')`
    ).run();
    return result.changes;
}

export function incrementSkippedCount(ids: number[]): void {
    if (ids.length === 0) return;
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE observations SET skipped_count = skipped_count + 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function deleteOverSkippedObservations(): number {
    const db = getDb();
    const result = db.prepare('DELETE FROM observations WHERE skipped_count >= ?').run(getConfig().worker.observationSkipLimit);
    return result.changes;
}

export function getProjectsWithStaleObservations(timeoutMs: number): number[] {
    if (timeoutMs === 0) return [];
    const db = getDb();
    const timeoutSeconds = Math.floor(timeoutMs / 1000);
    const rows = db.prepare(`
        SELECT DISTINCT o.project_id
        FROM observations o
        WHERE o.processed = 0
          AND o.created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${timeoutSeconds} seconds')
          AND NOT EXISTS (
              SELECT 1 FROM memory_queue mq
              WHERE mq.project_id = o.project_id
                AND mq.status IN ('pending', 'processing')
          )
    `).all() as { project_id: number }[];
    return rows.map(r => r.project_id);
}

export function transferProject(fromPath: string, toPath: string): { memories: number; observations: number } {
    const db = getDb();
    const source = db.prepare('SELECT id, path, name FROM projects WHERE path = ?').get(fromPath) as any;
    if (!source) throw new Error(`Source project not found: ${fromPath}`);

    const target = db.prepare('SELECT id FROM projects WHERE path = ?').get(toPath) as any;

    if (!target) {
        // No target — just rename the source project
        const name = toPath === '_global' ? 'global' : toPath.split('/').pop() || toPath;
        db.prepare('UPDATE projects SET path = ?, name = ? WHERE id = ?').run(toPath, name, source.id);
        const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE project_id = ?').get(source.id) as any).c;
        const obsCount = (db.prepare('SELECT COUNT(*) as c FROM observations WHERE project_id = ?').get(source.id) as any).c;
        return { memories: memCount, observations: obsCount };
    }

    // Target exists — move all records to target, then delete source
    const transfer = db.transaction(() => {
        db.prepare('UPDATE memories SET project_id = ? WHERE project_id = ?').run(target.id, source.id);
        db.prepare('UPDATE observations SET project_id = ? WHERE project_id = ?').run(target.id, source.id);
        db.prepare('UPDATE observation_queue SET project_id = ? WHERE project_id = ?').run(target.id, source.id);
        db.prepare('UPDATE memory_queue SET project_id = ? WHERE project_id = ?').run(target.id, source.id);

        const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE project_id = ?').get(target.id) as any).c;
        const obsCount = (db.prepare('SELECT COUNT(*) as c FROM observations WHERE project_id = ?').get(target.id) as any).c;

        db.prepare('DELETE FROM projects WHERE id = ?').run(source.id);
        return { memories: memCount, observations: obsCount };
    });

    return transfer();
}

export function countUnprocessedObservations(projectId: number): number {
    const db = getDb();
    const row = db
        .prepare('SELECT COUNT(*) as count FROM observations WHERE project_id = ? AND processed = 0')
        .get(projectId) as any;
    return row.count;
}
