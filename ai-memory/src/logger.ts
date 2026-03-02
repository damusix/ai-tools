import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';

const LOG_DIR = join(homedir(), '.ai-memory');
const LOG_FILE = join(LOG_DIR, 'server.log');

mkdirSync(LOG_DIR, { recursive: true });

export type Level = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
    level: Level;
    section: string;
    time: string;
    message: string;
    raw: string;
}

class Logger extends EventEmitter {
    private timestamp(): string {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }

    private write(level: Level, section: string, message: string): void {
        const time = this.timestamp();
        const raw = `[${level}] [${section}] [${time}] ${message}`;
        try {
            appendFileSync(LOG_FILE, raw + '\n');
        } catch {}
        if (level === 'ERROR') {
            process.stderr.write(raw + '\n');
        }
        this.emit('line', { level, section, time, message, raw } satisfies LogEntry);
    }

    log(section: string, message: string): void {
        this.write('INFO', section, message);
    }

    warn(section: string, message: string): void {
        this.write('WARN', section, message);
    }

    error(section: string, message: string): void {
        this.write('ERROR', section, message);
    }
}

export const logger = new Logger();

// Convenience exports
export const log = (section: string, message: string) => logger.log(section, message);
export const warn = (section: string, message: string) => logger.warn(section, message);
export const error = (section: string, message: string) => logger.error(section, message);
