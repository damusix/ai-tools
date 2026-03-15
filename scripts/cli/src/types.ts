export type BumpType = "patch" | "minor" | "major";

export interface PluginInfo {
    name: string;
    source: string;
    version: string;
    versionFile: string; // absolute path to the file holding version
    versionKey: string; // "version" — the JSON key
}

export interface ParsedCommit {
    hash: string;
    type: string;
    scope: string | null;
    description: string;
    breaking: boolean;
}

export interface VersionGroup {
    version: string;
    features: string[];
    fixes: string[];
    breaking: string[];
}

export interface GitLogEntry {
    hash: string;
    commit: ParsedCommit | null;
}
