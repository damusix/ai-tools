export const ARCHITECTURE_SCHEMA_VERSION = 1;

export type ManifestSnippet = {
    path: string;
    content: string;
};

export type Signal = {
    kind: string;
    evidence: string[];
};

export type ArchitectureCi = {
    workflows: string[];
};

export type ArchitectureFacts = {
    schemaVersion: number;
    scannedAt: string;
    tree: string;
    manifests: ManifestSnippet[];
    ci: ArchitectureCi;
    signals: Signal[];
    error?: string;
};

export type ScanOptions = {
    treeMaxDepth: number;
    manifestMaxDepth: number;
    manifestMaxFiles: number;
    manifestMaxCharsPerFile: number;
    manifestMaxTotalChars: number;
};
