package api

import (
	"net/http"
	"strings"
	"sync"
)

var (
	hookDTSOnce  sync.Once
	hookDTSCache string
)

func buildHookDTS() string {
	var sb strings.Builder

	sb.WriteString(`// Hook Manager — TypeScript definitions for Claude Code hook payloads
// Provides IntelliSense for all 24 hook events, response types, and runtime APIs.

`)

	// Write each event interface from the shared eventSchemas map
	for _, name := range allEventNames {
		schema, ok := eventSchemas[name]
		if !ok {
			continue
		}
		sb.WriteString(schema)
		sb.WriteString("\n\n")
	}

	// Union type of all payloads
	sb.WriteString("/** Union of all hook event payloads — discriminated by `hook_event_name`. */\n")
	sb.WriteString("type HookPayload =\n")
	for i, name := range allEventNames {
		sb.WriteString("    | " + name + "Payload")
		if i < len(allEventNames)-1 {
			sb.WriteString("\n")
		} else {
			sb.WriteString(";\n\n")
		}
	}

	// Hook response type
	sb.WriteString(`/** Standard hook response written to stdout as JSON. All fields optional. */
interface HookResponse {
    /** Inject a system message into the conversation. */
    systemMessage?: string;
    /** Event-specific output — structure varies by event type. */
    hookSpecificOutput?: {
        /** PreToolUse: allow, deny, or prompt the user for the action. */
        permissionDecision?: "allow" | "deny" | "ask";
        /** Reason for the permission decision. */
        permissionDecisionReason?: string;
        /** PreToolUse: modified tool input to replace the original. */
        updatedInput?: Record<string, any>;
        /** Inject additional context into the conversation. */
        additionalContext?: string;
        /** PermissionRequest: permission decision. */
        decision?: { behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, any> };
        /** Elicitation/ElicitationResult: user action response. */
        action?: "accept" | "decline" | "cancel";
        /** Elicitation: form content. */
        content?: Record<string, any>;
        /** CwdChanged/FileChanged: file paths to watch. */
        watchPaths?: string[];
    };
    /** For blockable events (UserPromptSubmit, ConfigChange, Stop, etc.): block the action. */
    decision?: "block";
    /** Human-readable reason for blocking. */
    reason?: string;
    /** For Stop/SubagentStop/TeammateIdle/TaskCompleted: false = stop, true = continue. */
    continue?: boolean;
    /** Reason for stopping (when continue is false). */
    stopReason?: string;
    /** Hide hook output from verbose logs. */
    suppressOutput?: boolean;
}

`)

	// Minimal Node.js type stubs for hook scripts
	sb.WriteString(`// ─── Node.js Runtime Types ────────────────────────────────────────────

declare var process: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    exit(code?: number): never;
    env: Record<string, string | undefined>;
    argv: string[];
    cwd(): string;
    pid: number;
    platform: string;
    version: string;
};

declare var console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
    info(...args: any[]): void;
    debug(...args: any[]): void;
    dir(obj: any): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
};

declare var Buffer: {
    from(data: string | ArrayBuffer | any[], encoding?: string): Buffer;
    alloc(size: number): Buffer;
    isBuffer(obj: any): obj is Buffer;
    concat(list: Buffer[]): Buffer;
};

interface Buffer {
    toString(encoding?: string): string;
    length: number;
    slice(start?: number, end?: number): Buffer;
}

declare function require(module: string): any;
declare function setTimeout(fn: (...args: any[]) => void, ms: number): any;
declare function setInterval(fn: (...args: any[]) => void, ms: number): any;
declare function clearTimeout(id: any): void;
declare function clearInterval(id: any): void;

declare namespace NodeJS {
    interface ReadableStream {
        read(size?: number): Buffer | string | null;
        on(event: "data", listener: (chunk: Buffer | string) => void): this;
        on(event: "end", listener: () => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
        pipe<T extends WritableStream>(destination: T): T;
        setEncoding(encoding: string): this;
    }
    interface WritableStream {
        write(data: string | Buffer, encoding?: string): boolean;
        end(data?: string | Buffer): void;
        on(event: string, listener: (...args: any[]) => void): this;
    }
}

// ─── Node.js Modules ──────────────────────────────────────────────────

declare module "fs" {
    function readFileSync(path: string | number, options?: { encoding?: string; flag?: string } | string): string | Buffer;
    function writeFileSync(path: string, data: string | Buffer, options?: { encoding?: string; flag?: string } | string): void;
    function readFile(path: string, callback: (err: Error | null, data: Buffer) => void): void;
    function readFile(path: string, encoding: string, callback: (err: Error | null, data: string) => void): void;
    function writeFile(path: string, data: string | Buffer, callback: (err: Error | null) => void): void;
    function existsSync(path: string): boolean;
    function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
    function readdirSync(path: string): string[];
    function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number; mtime: Date };
    function unlinkSync(path: string): void;
    function appendFileSync(path: string, data: string | Buffer): void;
    namespace promises {
        function readFile(path: string, options?: { encoding?: string } | string): Promise<string | Buffer>;
        function writeFile(path: string, data: string | Buffer): Promise<void>;
        function readdir(path: string): Promise<string[]>;
        function stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtime: Date }>;
        function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
        function unlink(path: string): Promise<void>;
    }
}

declare module "path" {
    function join(...paths: string[]): string;
    function resolve(...paths: string[]): string;
    function basename(path: string, ext?: string): string;
    function dirname(path: string): string;
    function extname(path: string): string;
    function relative(from: string, to: string): string;
    function isAbsolute(path: string): boolean;
    function normalize(path: string): string;
    const sep: string;
    const delimiter: string;
}

declare module "child_process" {
    function execSync(command: string, options?: { encoding?: string; cwd?: string; timeout?: number; env?: Record<string, string> }): string | Buffer;
    function exec(command: string, callback: (error: Error | null, stdout: string, stderr: string) => void): any;
    function spawn(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string>; stdio?: any }): any;
    function spawnSync(command: string, args?: string[], options?: { cwd?: string; encoding?: string }): { stdout: string | Buffer; stderr: string | Buffer; status: number | null };
}

declare module "os" {
    function homedir(): string;
    function tmpdir(): string;
    function hostname(): string;
    function platform(): string;
    function arch(): string;
    function cpus(): Array<{ model: string; speed: number }>;
    function totalmem(): number;
    function freemem(): number;
    const EOL: string;
}

declare module "url" {
    class URL {
        constructor(input: string, base?: string);
        href: string;
        origin: string;
        protocol: string;
        hostname: string;
        pathname: string;
        search: string;
        hash: string;
        searchParams: URLSearchParams;
    }
}

declare module "util" {
    function format(format: string, ...args: any[]): string;
    function inspect(object: any, options?: { depth?: number; colors?: boolean }): string;
    function promisify<T>(fn: (...args: any[]) => void): (...args: any[]) => Promise<T>;
}

declare module "crypto" {
    function createHash(algorithm: string): Hash;
    function randomUUID(): string;
    function randomBytes(size: number): Buffer;
    interface Hash {
        update(data: string | Buffer): Hash;
        digest(encoding?: string): string | Buffer;
    }
}

`)

	// Bun runtime types
	sb.WriteString(`// ─── Bun Runtime Types ────────────────────────────────────────────────

declare namespace Bun {
    /** Standard input as a readable stream. */
    const stdin: {
        /** Read all stdin as a string. */
        text(): Promise<string>;
        /** Read all stdin and parse as JSON. */
        json(): Promise<any>;
        /** Read all stdin as an ArrayBuffer. */
        arrayBuffer(): Promise<ArrayBuffer>;
        /** Read all stdin as a Blob. */
        blob(): Promise<Blob>;
    };

    /** Standard output writer. */
    const stdout: {
        write(data: string | Buffer | Uint8Array): number;
    };

    /** Standard error writer. */
    const stderr: {
        write(data: string | Buffer | Uint8Array): number;
    };

    /** Write data to a file path or Response. */
    function write(dest: string | Response, data: string | Buffer | Blob | Response): Promise<number>;

    /** Open a file for reading. */
    function file(path: string): BunFile;

    /** Environment variables. */
    const env: Record<string, string | undefined>;

    /** Bun version string. */
    const version: string;

    /** Resolve a module path. */
    function resolveSync(module: string, parent?: string): string;

    /** Run a shell command. */
    function $(strings: TemplateStringsArray, ...values: any[]): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }>;

    /** Sleep for the given milliseconds. */
    function sleep(ms: number): Promise<void>;

    interface BunFile {
        text(): Promise<string>;
        json(): Promise<any>;
        arrayBuffer(): Promise<ArrayBuffer>;
        size: number;
        type: string;
        exists(): Promise<boolean>;
    }
}

`)

	return sb.String()
}

// GetHookTypes serves TypeScript definitions for hook payloads and runtime APIs.
// GET /api/types/hooks
func (a *API) GetHookTypes(w http.ResponseWriter, r *http.Request) {
	hookDTSOnce.Do(func() {
		hookDTSCache = buildHookDTS()
	})

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Write([]byte(hookDTSCache))
}
