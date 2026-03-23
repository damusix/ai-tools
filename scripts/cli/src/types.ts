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
    body: string | null;
    breaking: boolean;
}

export interface ChangelogItem {
    hash: string;
    description: string;
    body: string | null;
}

export interface VersionGroup {
    version: string;
    features: ChangelogItem[];
    fixes: ChangelogItem[];
    breaking: ChangelogItem[];
}

export interface GitLogEntry {
    hash: string;
    commit: ParsedCommit | null;
}
