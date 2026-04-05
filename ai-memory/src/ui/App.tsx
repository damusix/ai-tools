import { createSignal, createResource, createMemo, createEffect, onCleanup, For, Show, type Component } from 'solid-js';
import { ProjectSelector } from './components/ProjectSelector';
import { SearchBar } from './components/SearchBar';
import { MemoryCard } from './components/MemoryCard';
import { ObservationCard } from './components/ObservationCard';
import { ConfirmModal } from './components/Modal';
import TerminalLogs from './components/TerminalLogs';
import HelpDrawer from './components/HelpDrawer';
import Settings from './components/Settings';
import TransferModal from './components/TransferModal';
import Icon from './components/Icon';
import BrandLogo from './components/BrandLogo';
import MemoryDetailModal from './components/MemoryDetailModal';
import ArchitectureModal from './components/ArchitectureModal';
import { Tooltip } from './components/Tooltip';
import { sse, listen } from './sse';

export type Memory = {
    id: number;
    content: string;
    tags: string;
    category: string;
    importance: number;
    domain: string | null;
    reason: string;
    observation_ids: string;
    created_at: string;
    updated_at: string;
    project_path: string;
};

export type Observation = {
    id: number;
    content: string;
    source_summary: string;
    processed: number;
    created_at: string;
    project_path: string;
};

export type Project = {
    id: number;
    path: string;
    name: string;
    icon: string;
    description: string;
    summary: string;
    architecture_summary: string;
    architecture_facts: string;
    architecture_full: string;
    architecture_scanned_at: string;
    git_root: string;
    git_url: string;
    consolidate: string;
    distillation_at: string;
    distillation_memories_since: number;
    distillation_status: string;
    distillation_error: string;
    distillation_queued: number;
    created_at: string;
    observation_count: number;
    memory_count: number;
};

type MemoryGroup = {
    domain: string;
    categories: { category: string; memories: Memory[] }[];
};

type ProjectMemoryGroup = {
    project: string;
    domains: MemoryGroup[];
};

const api = async <T,>(path: string, opts?: RequestInit): Promise<T> => (await fetch(path, opts)).json();

const STORAGE_KEY = 'ai-memory:selected-project';
const COLLAPSED_PROJECTS_KEY = 'ai-memory:collapsed-projects';
const COLLAPSED_DOMAINS_KEY = 'ai-memory:collapsed-domains';
const COLLAPSED_CATEGORIES_KEY = 'ai-memory:collapsed-categories';
const COLLAPSED_SUMMARIES_KEY = 'ai-memory:collapsed-summaries';
const COLLAPSED_ARCHITECTURE_KEY = 'ai-memory:collapsed-architecture';

export const shortPath = (p: string) =>
    p === '_global' ? 'global' : p.replace(/^\/(?:Users|home)\/[^/]+\//, '~/');


const MODAL_PARAMS = ['settings', 'merge', 'help', 'logs', 'memory'] as const;

const App: Component = () => {
    const [appVersion, setAppVersion] = createSignal('');
    fetch('/health').then(r => r.json()).then(d => setAppVersion(d.version || '')).catch(() => {});

    const [project, setProject] = createSignal(localStorage.getItem(STORAGE_KEY) || '');
    const [refreshKey, setRefreshKey] = createSignal(0);
    const [deleteTarget, setDeleteTarget] = createSignal<{ type: string; id: number } | null>(null);
    const [toast, setToast] = createSignal('');
    const [restarting, setRestarting] = createSignal(false);
    const [cleaningUp, setCleaningUp] = createSignal(false);
    const [consolidating, setConsolidating] = createSignal(false);
    const [logsOpen, setLogsOpen] = createSignal(false);
    const [helpOpen, setHelpOpen] = createSignal(false);
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    const [settingsTab, setSettingsTab] = createSignal<'config' | 'domains' | 'categories'>('config');

    const [transferOpen, setTransferOpen] = createSignal(false);
    const [helpTopic, setHelpTopic] = createSignal('');
    const [stopConfirm, setStopConfirm] = createSignal(false);
    const [stopping, setStopping] = createSignal(false);
    const [menuOpen, setMenuOpen] = createSignal(false);
    let menuRef!: HTMLDivElement;
    let searchInputRef: HTMLInputElement | undefined;
    let projectInputRef: HTMLInputElement | undefined;
    const [deleteProjectTarget, setDeleteProjectTarget] = createSignal<Project | null>(null);
    const [memoryDetailOpen, setMemoryDetailOpen] = createSignal(false);
    const [memoryDetail, setMemoryDetail] = createSignal<Memory | null>(null);
    const [taxonomyDomains, setTaxonomyDomains] = createSignal<any[]>([]);
    const [taxonomyCategories, setTaxonomyCategories] = createSignal<any[]>([]);

    // ── URL-based routing ────────────────────────────────────────────
    let modalPushed = false;

    const syncFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        setSettingsOpen(params.has('settings'));
        setTransferOpen(params.has('merge'));
        setLogsOpen(params.has('logs'));
        setHelpOpen(params.has('help'));
        if (params.has('settings')) {
            const tab = params.get('settings');
            if (tab === 'domains' || tab === 'categories') setSettingsTab(tab);
            else setSettingsTab('config');
        }
        if (params.has('help')) setHelpTopic(params.get('help') || '');
        if (params.has('memory')) {
            const memId = parseInt(params.get('memory')!, 10);
            if (!isNaN(memId) && !memoryDetailOpen()) {
                openMemoryDetail(memId);
            }
        } else {
            setMemoryDetailOpen(false);
            setMemoryDetail(null);
        }
    };

    const openModalUrl = (params: Record<string, string>) => {
        const url = new URL(window.location.href);
        const hadModal = MODAL_PARAMS.some(k => url.searchParams.has(k));
        for (const k of MODAL_PARAMS) url.searchParams.delete(k);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v || '');
        if (hadModal) {
            history.replaceState({ modal: true }, '', url);
        } else {
            history.pushState({ modal: true }, '', url);
            modalPushed = true;
        }
    };

    const closeModalUrl = () => {
        if (modalPushed) {
            modalPushed = false;
            history.back();
        } else {
            const url = new URL(window.location.href);
            for (const k of MODAL_PARAMS) url.searchParams.delete(k);
            history.replaceState(null, '', url);
        }
    };

    // Initialize from URL on mount
    syncFromUrl();
    window.addEventListener('popstate', () => { modalPushed = false; syncFromUrl(); });
    onCleanup(() => window.removeEventListener('popstate', syncFromUrl));

    // ── Keyboard shortcuts (VS Code style) ────────────────────────────
    const handleGlobalKeydown = (e: KeyboardEvent) => {
        // Ctrl+, → Settings
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === ',') {
            e.preventDefault();
            settingsOpen() ? closeSettings() : openSettings();
            return;
        }
        // Cmd+P → Search (focus search bar)
        if (e.metaKey && !e.shiftKey && e.key === 'p') {
            e.preventDefault();
            searchInputRef?.focus();
            return;
        }
        // Cmd+Shift+P → Projects (focus project selector)
        if (e.metaKey && e.shiftKey && e.key === 'p') {
            e.preventDefault();
            projectInputRef?.focus();
            return;
        }
        // Cmd+J → Logs
        if (e.metaKey && !e.shiftKey && e.key === 'j') {
            e.preventDefault();
            logsOpen() ? closeLogs() : openLogs();
            return;
        }
    };
    document.addEventListener('keydown', handleGlobalKeydown);
    onCleanup(() => document.removeEventListener('keydown', handleGlobalKeydown));

    const openSettings = (tab: 'config' | 'domains' | 'categories' = 'config') => {
        setSettingsTab(tab);
        setSettingsOpen(true);
        openModalUrl({ settings: tab });
    };

    const closeSettings = () => { setSettingsOpen(false); closeModalUrl(); };

    const openTransfer = () => { setTransferOpen(true); openModalUrl({ merge: '' }); };
    const closeTransfer = () => { setTransferOpen(false); closeModalUrl(); };

    const openLogs = () => { setLogsOpen(true); openModalUrl({ logs: '' }); };
    const closeLogs = () => { setLogsOpen(false); closeModalUrl(); };

    const openHelp = (topic: string) => { setHelpTopic(topic); setHelpOpen(true); openModalUrl({ help: topic }); };
    const closeHelp = () => { setHelpOpen(false); closeModalUrl(); };

    const openMemoryDetail = async (memOrId: Memory | number) => {
        let mem: Memory;
        if (typeof memOrId === 'number') {
            try {
                const res = await fetch(`/api/memories/${memOrId}`);
                if (!res.ok) { showToast('Memory not found'); return; }
                mem = await res.json();
            } catch { showToast('Failed to load memory'); return; }
        } else {
            mem = memOrId;
        }
        try {
            const [d, c] = await Promise.all([
                fetch('/api/domains').then(r => r.json()),
                fetch('/api/categories').then(r => r.json()),
            ]);
            setTaxonomyDomains(d);
            setTaxonomyCategories(c);
        } catch { /* dropdowns will be empty */ }
        setMemoryDetail(mem);
        setMemoryDetailOpen(true);
        openModalUrl({ memory: String(mem.id) });
    };

    const closeMemoryDetail = () => {
        setMemoryDetailOpen(false);
        setMemoryDetail(null);
        closeModalUrl();
    };

    const [deletedMemoryDetail, setDeletedMemoryDetail] = createSignal<(Memory & { deleted_at: string; deleted_reason: string }) | null>(null);
    const [deletedMemoryDetailOpen, setDeletedMemoryDetailOpen] = createSignal(false);

    const openDeletedMemoryDetail = (m: Memory & { deleted_at: string; deleted_reason: string }) => {
        setDeletedMemoryDetail(m);
        setDeletedMemoryDetailOpen(true);
    };
    const closeDeletedMemoryDetail = () => {
        setDeletedMemoryDetailOpen(false);
        setDeletedMemoryDetail(null);
    };

    const handleRestoreMemory = async (id: number) => {
        await fetch(`/api/memories/${id}/restore`, { method: 'POST' });
        showToast('Memory restored');
        refresh();
    };

    const handlePermanentDeleteMemory = async (id: number) => {
        await fetch(`/api/memories/${id}`, { method: 'DELETE' });
        showToast('Memory permanently deleted');
        refresh();
    };

    const triggerDistillation = async (projectId: number, projectPath: string) => {
        setDistilling(prev => ({ ...prev, [projectPath]: true }));
        try {
            await fetch(`/api/projects/${projectId}/distillation`, { method: 'POST' });
            showToast('Distillation queued');
        } catch {
            showToast('Failed to trigger distillation');
        }
        setDistilling(prev => ({ ...prev, [projectPath]: false }));
    };

    const handleMemoryUpdate = async (id: number, fields: {
        content: string; tags: string; category: string; importance: number; domain: string | null;
    }) => {
        const res = await fetch(`/api/memories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Update failed');
        }
        showToast('Memory updated');
        refresh();
    };

    const handleSettingsTabChange = (tab: 'config' | 'domains' | 'categories') => {
        setSettingsTab(tab);
        const url = new URL(window.location.href);
        url.searchParams.set('settings', tab);
        history.replaceState({ modal: true }, '', url);
    };

    const [searchQuery, setSearchQuery] = createSignal('');
    const [searchResults, setSearchResults] = createSignal<Memory[] | null>(null);

    const [collapsedProjects, setCollapsedProjects] = createSignal<Record<string, boolean>>(
        JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) || '{}')
    );
    const [collapsedDomains, setCollapsedDomains] = createSignal<Record<string, boolean>>(
        JSON.parse(localStorage.getItem(COLLAPSED_DOMAINS_KEY) || '{}')
    );
    const [collapsedCategories, setCollapsedCategories] = createSignal<Record<string, boolean>>(
        JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}')
    );

    const toggleProject = (key: string) => {
        setCollapsedProjects(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleDomain = (key: string) => {
        setCollapsedDomains(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleCategory = (key: string) => {
        setCollapsedCategories(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Bulk collapse/expand helpers
    const collapseAllProjects = (collapse: boolean) => {
        const groups = groupedMemories();
        const map: Record<string, boolean> = {};
        for (const g of groups) if (g.project !== '_') map[g.project] = collapse;
        setCollapsedProjects(collapse ? map : {});
    };
    const collapseAllDomainsInProject = (projectKey: string, collapse: boolean) => {
        const groups = groupedMemories();
        const proj = groups.find(g => g.project === projectKey);
        if (!proj) return;
        setCollapsedDomains(prev => {
            const next = { ...prev };
            for (const d of proj.domains) next[`${projectKey}:${d.domain}`] = collapse;
            return collapse ? next : Object.fromEntries(Object.entries(next).filter(([k]) => !k.startsWith(`${projectKey}:`)));
        });
    };
    const collapseAllCategoriesInDomain = (domKey: string, collapse: boolean) => {
        const groups = groupedMemories();
        for (const proj of groups) {
            for (const dom of proj.domains) {
                const dk = `${proj.project}:${dom.domain}`;
                if (dk !== domKey) continue;
                setCollapsedCategories(prev => {
                    const next = { ...prev };
                    for (const cat of dom.categories) next[`${dk}:${cat.category}`] = collapse;
                    return collapse ? next : Object.fromEntries(Object.entries(next).filter(([k]) => !k.startsWith(`${dk}:`)));
                });
            }
        }
    };

    // Persist collapse state to localStorage
    createEffect(() => localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify(collapsedProjects())));
    createEffect(() => localStorage.setItem(COLLAPSED_DOMAINS_KEY, JSON.stringify(collapsedDomains())));
    createEffect(() => localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify(collapsedCategories())));
    createEffect(() => localStorage.setItem(COLLAPSED_SUMMARIES_KEY, JSON.stringify(collapsedSummaries())));
    createEffect(() => localStorage.setItem(COLLAPSED_ARCHITECTURE_KEY, JSON.stringify(collapsedArchitecture())));

    const selectProject = (path: string) => {
        setProject(path);
        if (path) {
            localStorage.setItem(STORAGE_KEY, path);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    };

    const refresh = () => setRefreshKey((k) => k + 1);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(''), 4000);
    };

    const handleCleanup = async () => {
        setCleaningUp(true);
        try {
            const res = await api<{ deleted: { observations: number; memories: number } }>('/api/cleanup', { method: 'POST' });
            showToast(`Cleaned up ${res.deleted.observations} observations, ${res.deleted.memories} memories`);
            refresh();
        } catch {
            showToast('Cleanup failed');
        } finally {
            setCleaningUp(false);
        }
    };

    const handleCleanupEmpty = async () => {
        try {
            const res = await api<{ deleted: number }>('/api/projects/cleanup-empty', { method: 'POST' });
            showToast(res.deleted > 0 ? `Cleaned up ${res.deleted} empty project(s)` : 'No empty projects to clean up');
            refresh();
        } catch {
            showToast('Cleanup failed');
        }
    };

    const handleConsolidate = async () => {
        setConsolidating(true);
        try {
            await fetch('/api/consolidate', { method: 'POST' });
            showToast('Consolidation complete');
            refresh();
        } catch {
            showToast('Consolidation failed');
        }
        setConsolidating(false);
    };

    const handleBatchDelete = async (projectIds: number[]) => {
        const res = await fetch('/api/projects/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch delete failed');
        showToast(`Deleted ${data.deleted} project(s) (${data.totalMemories} memories, ${data.totalObservations} observations)`);
        selectProject('');
        refresh();
    };

    const handleRestart = async () => {
        setRestarting(true);
        try {
            await fetch('/api/restart', { method: 'POST' });
        } catch {}
        // Poll /health until server is back
        const start = Date.now();
        const poll = () => {
            if (Date.now() - start > 10000) {
                setRestarting(false);
                showToast('Restart timed out');
                return;
            }
            fetch('/health').then((r) => {
                if (r.ok) {
                    setRestarting(false);
                    showToast('Server restarted');
                    refresh();
                } else {
                    setTimeout(poll, 500);
                }
            }).catch(() => setTimeout(poll, 500));
        };
        setTimeout(poll, 500);
    };

    const handleStop = async () => {
        setStopping(true);
        setStopConfirm(false);
        try {
            await fetch('/api/stop', { method: 'POST' });
            showToast('Server stopping...');
        } catch {
            showToast('Stop failed');
        } finally {
            setStopping(false);
        }
    };

    const confirmDeleteProject = async () => {
        const target = deleteProjectTarget();
        if (!target) return;
        try {
            const res = await api<{ memories: number; observations: number }>(
                `/api/projects/${target.id}`,
                { method: 'DELETE' },
            );
            showToast(`Deleted project "${shortPath(target.path)}" (${res.memories} memories, ${res.observations} observations)`);
            selectProject('');
            refresh();
        } catch {
            showToast('Delete failed');
        }
        setDeleteProjectTarget(null);
    };

    // Close menu on click outside
    const handleMenuClickOutside = (e: MouseEvent) => {
        if (menuRef && !menuRef.contains(e.target as Node)) setMenuOpen(false);
    };
    createEffect(() => {
        document.addEventListener('mousedown', handleMenuClickOutside);
        onCleanup(() => document.removeEventListener('mousedown', handleMenuClickOutside));
    });

    // SSE real-time updates
    for (const evt of ['memory:created', 'memory:deleted', 'observation:created', 'observation:deleted', 'counts:updated', 'summary:updated', 'distillation:updated']) {
        listen(evt);
        sse.addEventListener(evt, refresh);
    }
    onCleanup(() => {
        for (const evt of ['memory:created', 'memory:deleted', 'observation:created', 'observation:deleted', 'counts:updated', 'summary:updated', 'distillation:updated']) {
            sse.removeEventListener(evt, refresh);
        }
    });

    const [projects] = createResource(() => refreshKey(), () => api<Project[]>('/api/projects'));

    const [domainMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string; count: number }[]>('/api/domains'));
    const [categoryMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string; count: number }[]>('/api/categories'));
    const [tagsMeta] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}` : '';
            return api<{ tag: string; count: number }[]>('/api/tags' + qs);
        },
    );

    const domainIconMap = createMemo(() => {
        const map: Record<string, string> = {};
        for (const d of domainMeta() || []) map[d.name] = d.icon;
        return map;
    });
    const categoryIconMap = createMemo(() => {
        const map: Record<string, string> = {};
        for (const c of categoryMeta() || []) map[c.name] = c.icon;
        return map;
    });

    const projectIconMap = createMemo(() => {
        const map: Record<string, string> = {};
        for (const p of projects() || []) map[p.path] = p.icon;
        return map;
    });

    const projectDescMap = createMemo(() => {
        const map: Record<string, string> = {};
        for (const p of projects() || []) map[p.path] = p.description;
        return map;
    });

    const projectSummaryMap = createMemo(() => {
        const map: Record<string, string> = {};
        for (const p of projects() || []) if (p.summary) map[p.path] = p.summary;
        return map;
    });

    const [collapsedSummaries, setCollapsedSummaries] = createSignal<Record<string, boolean>>(
        JSON.parse(localStorage.getItem(COLLAPSED_SUMMARIES_KEY) || '{}')
    );
    const toggleSummary = (key: string) => {
        setCollapsedSummaries(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const [generatingSummary, setGeneratingSummary] = createSignal<Record<string, boolean>>({});
    const triggerSummary = async (projectPath: string) => {
        const proj = (projects() || []).find((p: Project) => p.path === projectPath);
        if (!proj) return;
        setGeneratingSummary(prev => ({ ...prev, [projectPath]: true }));
        try {
            const res = await fetch(`/api/projects/${proj.id}/summary`, { method: 'POST' });
            if (res.ok) {
                showToast('Summary generated');
                refresh();
            } else {
                showToast('Summary generation failed');
            }
        } catch {
            showToast('Summary generation failed');
        }
        setGeneratingSummary(prev => ({ ...prev, [projectPath]: false }));
    };

    // ── Architecture state ──
    const projectArchitectureMap = createMemo(() => {
        const map: Record<string, { summary: string; facts: string; full: string; scannedAt: string }> = {};
        for (const p of projects() || []) {
            if (p.architecture_scanned_at) {
                map[p.path] = {
                    summary: p.architecture_summary,
                    facts: p.architecture_facts,
                    full: p.architecture_full,
                    scannedAt: p.architecture_scanned_at,
                };
            }
        }
        return map;
    });

    const [collapsedArchitecture, setCollapsedArchitecture] = createSignal<Record<string, boolean>>(
        JSON.parse(localStorage.getItem(COLLAPSED_ARCHITECTURE_KEY) || '{}')
    );
    const toggleArchitecture = (key: string) => {
        setCollapsedArchitecture(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const [generatingArchitecture, setGeneratingArchitecture] = createSignal<Record<string, boolean>>({});
    const triggerArchitectureScan = async (projectPath: string) => {
        const proj = (projects() || []).find((p: Project) => p.path === projectPath);
        if (!proj) return;
        setGeneratingArchitecture(prev => ({ ...prev, [projectPath]: true }));
        try {
            const res = await fetch(`/api/projects/${proj.id}/architecture`, { method: 'POST' });
            if (res.ok) {
                showToast('Architecture scan complete');
                refresh();
            } else {
                showToast('Architecture scan failed');
            }
        } catch {
            showToast('Architecture scan failed');
        }
        setGeneratingArchitecture(prev => ({ ...prev, [projectPath]: false }));
    };

    const [architectureModalPath, setArchitectureModalPath] = createSignal<string | null>(null);

    const setConsolidate = async (projectId: number, value: '' | 'yes' | 'no') => {
        try {
            const res = await fetch(`/api/projects/${projectId}/consolidate`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consolidate: value }),
            });
            if (res.ok) {
                showToast(`Consolidation set to ${value || 'default'}`);
                refresh();
            } else {
                showToast('Failed to update consolidation setting');
            }
        } catch {
            showToast('Failed to update consolidation setting');
        }
    };

    const [memories] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}&limit=0` : '?limit=0';
            return api<Memory[]>('/api/memories' + qs);
        },
    );

    const [observations] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}&limit=0` : '?limit=0';
            return api<Observation[]>('/api/observations' + qs);
        },
    );

    const [deletedMemories] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}` : '';
            return api<(Memory & { deleted_at: string; deleted_reason: string })[]>('/api/memories/deleted' + qs);
        },
    );

    const [distilling, setDistilling] = createSignal<Record<string, boolean>>({});

    const [stats] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}` : '';
            return api<{ memories: number; observations: number }>('/api/stats' + qs);
        },
    );

    // Group observations: by project (if all projects mode), then pending first
    const groupedObservations = createMemo(() => {
        const obs = observations() || [];
        const isAllProjects = !project();

        // Sort: pending first, then by date desc within each status
        const sorted = [...obs].sort((a, b) => {
            if (a.processed !== b.processed) return a.processed - b.processed; // pending (0) first
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        if (!isAllProjects) return { '_': sorted };

        // Group by project_path
        const groups: Record<string, Observation[]> = {};
        for (const o of sorted) {
            const key = o.project_path;
            if (!groups[key]) groups[key] = [];
            groups[key].push(o);
        }
        return groups;
    });

    // Group memories: by project (if needed) -> domain -> category
    const groupedMemories = createMemo(() => {
        const mems = memories() || [];
        const isAllProjects = !project();

        const projectMap: Record<string, Record<string, Record<string, Memory[]>>> = {};
        for (const m of mems) {
            const proj = isAllProjects ? m.project_path : '_';
            const dom = m.domain || 'uncategorized';
            const cat = m.category || 'uncategorized';
            if (!projectMap[proj]) projectMap[proj] = {};
            if (!projectMap[proj][dom]) projectMap[proj][dom] = {};
            if (!projectMap[proj][dom][cat]) projectMap[proj][dom][cat] = [];
            projectMap[proj][dom][cat].push(m);
        }

        // Sort memories by importance desc within each category
        // Sort domains and categories alphabetically
        const result: ProjectMemoryGroup[] = [];
        for (const proj of Object.keys(projectMap).sort()) {
            const domains: MemoryGroup[] = [];
            for (const dom of Object.keys(projectMap[proj]).sort()) {
                const categories: { category: string; memories: Memory[] }[] = [];
                for (const cat of Object.keys(projectMap[proj][dom]).sort()) {
                    const sorted = projectMap[proj][dom][cat].sort((a, b) => b.importance - a.importance);
                    categories.push({ category: cat, memories: sorted });
                }
                domains.push({ domain: dom, categories });
            }
            result.push({ project: proj, domains });
        }
        // Merge projects that have 0 memories so they still render
        if (isAllProjects) {
            const existingPaths: Record<string, true> = {};
            for (const g of result) existingPaths[g.project] = true;
            for (const p of (projects() || [])) {
                if (!existingPaths[p.path]) {
                    result.push({ project: p.path, domains: [] });
                }
            }
        }

        return result;
    });

    const confirmDelete = async () => {
        const target = deleteTarget();
        if (!target) return;
        await api(`/api/${target.type}/${target.id}`, { method: 'DELETE' });
        setDeleteTarget(null);
        refresh();
    };

    const initialLoad = () => memories.loading && !memories.latest && observations.loading && !observations.latest;

    const InfoBtn: Component<{ topic: string; hint?: string }> = (p) => {
        const btn = (
            <button
                onClick={() => openHelp(p.topic)}
                class="p-1 rounded text-neutral-600 hover:text-[#d77757] transition-colors"
            >
                <Icon name="info" size={13} />
            </button>
        );
        return p.hint ? <Tooltip text={p.hint}>{btn}</Tooltip> : btn;
    };

    return (
        <div class="max-w-[1400px] mx-auto flex flex-col h-screen">
            {/* Header */}
            <header class="shrink-0">
                {/* Row 1: Brand + actions */}
                <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
                    <div class="flex items-center gap-3">
                        <h1 class="text-xl font-bold text-neutral-200 flex items-center gap-2">
                            <BrandLogo size={20} />
                            ai-memory
                        </h1>
                        <a
                            href="https://github.com/damusix/ai-tools"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-neutral-500 hover:text-[#d77757] transition-colors flex items-center"
                            title="GitHub"
                        >
                            <i class="fa-brands fa-github" style="font-size: 16px"></i>
                        </a>
                        <Show when={appVersion()}>
                            <span class="text-[10px] text-neutral-600 font-mono">v{appVersion()}</span>
                        </Show>
                    </div>
                    <div class="flex items-center gap-2">
                        <InfoBtn topic="about" hint="How ai-memory works and what it does." />
                        <div ref={menuRef} class="relative">
                            <button
                                onClick={() => setMenuOpen(v => !v)}
                                class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                            >
                                <i class="fa-solid fa-bars" style="font-size: 13px"></i>
                                Menu
                            </button>
                            <Show when={menuOpen()}>
                                <div class="absolute right-0 top-[calc(100%+4px)] z-50 w-48 bg-neutral-900 border border-neutral-700 rounded shadow-lg overflow-hidden">
                                    <div class="px-3 py-1 pt-1.5">
                                        <span class="text-[9px] font-bold uppercase tracking-wider text-neutral-600">Views</span>
                                    </div>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors"
                                        onClick={() => { openSettings(); setMenuOpen(false); }}
                                    >
                                        <Icon name="gear" size={13} />
                                        Settings
                                        <span class="kbd ml-auto">&#8963;,</span>
                                    </button>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors"
                                        onClick={() => { openLogs(); setMenuOpen(false); }}
                                    >
                                        <Icon name="terminal" size={13} />
                                        Logs
                                        <span class="kbd ml-auto">&#8984;J</span>
                                    </button>
                                    <div class="border-t border-neutral-700/50" />
                                    <div class="px-3 py-1">
                                        <span class="text-[9px] font-bold uppercase tracking-wider text-neutral-600">Actions</span>
                                    </div>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors"
                                        onClick={() => { openTransfer(); setMenuOpen(false); }}
                                    >
                                        <Icon name="transfer" size={13} />
                                        Merge projects
                                    </button>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors disabled:opacity-50"
                                        disabled={consolidating()}
                                        onClick={() => { handleConsolidate(); setMenuOpen(false); }}
                                    >
                                        <i class={`fa-solid ${consolidating() ? 'fa-spinner fa-spin' : 'fa-code-branch'}`} style="font-size: 13px"></i>
                                        {consolidating() ? 'Consolidating...' : 'Merge subfolders'}
                                    </button>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors disabled:opacity-50"
                                        disabled={cleaningUp()}
                                        onClick={() => { handleCleanup(); setMenuOpen(false); }}
                                    >
                                        <Icon name="broom" size={13} />
                                        {cleaningUp() ? 'Cleaning...' : 'Clean up'}
                                    </button>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-neutral-300 hover:bg-neutral-800 transition-colors"
                                        onClick={() => { handleCleanupEmpty(); setMenuOpen(false); }}
                                    >
                                        <i class="fa-solid fa-folder-minus" style="font-size: 13px"></i>
                                        Purge empty projects
                                    </button>
                                    <div class="border-t border-neutral-700/50" />
                                    <div class="px-3 py-1">
                                        <span class="text-[9px] font-bold uppercase tracking-wider text-neutral-600">Server</span>
                                    </div>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-yellow-400 hover:bg-yellow-900/20 transition-colors disabled:opacity-50"
                                        disabled={restarting()}
                                        onClick={() => { handleRestart(); setMenuOpen(false); }}
                                    >
                                        <Icon name="rotate-cw" size={13} class={restarting() ? 'animate-spin' : ''} />
                                        Restart
                                    </button>
                                    <button
                                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-red-400 hover:bg-red-900/20 transition-colors"
                                        onClick={() => { setStopConfirm(true); setMenuOpen(false); }}
                                    >
                                        <i class="fa-solid fa-stop" style="font-size: 13px"></i>
                                        Stop server
                                    </button>
                                </div>
                            </Show>
                        </div>
                    </div>
                </div>

                {/* Row 2: Project + Search context strip */}
                <div class="flex items-start gap-4 px-4 py-2 bg-neutral-950 border-b border-neutral-800/50">
                    {/* Left: Project selector */}
                    <div class="w-[240px] shrink-0">
                        <ProjectSelector
                            projects={projects() || []}
                            selected={project()}
                            onChange={selectProject}
                            onDeleteProject={() => {
                                const proj = (projects() || []).find((p: any) => p.path === project());
                                if (proj) setDeleteProjectTarget(proj);
                            }}
                            stats={stats()}
                            onInputMount={(el) => { projectInputRef = el; }}
                        />
                    </div>
                    {/* Right: Search bar */}
                    <div class="flex-1">
                        <SearchBar
                            project={project()}
                            domains={domainMeta() || []}
                            categories={categoryMeta() || []}
                            tags={tagsMeta() || []}
                            onResults={setSearchResults}
                            onSearchTextChange={setSearchQuery}
                            onInputMount={(el) => { searchInputRef = el; }}
                        />
                    </div>
                </div>
            </header>

            {/* Two-panel body */}
            <Show when={!initialLoad()} fallback={<p class="text-neutral-500 text-sm py-8 text-center">Loading...</p>}>
                <div class="flex flex-1 min-h-0">
                    {/* Observations sidebar */}
                    <aside class="w-[300px] shrink-0 overflow-y-auto p-4">
                        <h2 class="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
                            <Icon name="eye" size={14} class="text-purple-400" />
                            Observations
                            <span class="text-xs text-purple-300/70">({stats()?.observations ?? 0})</span>
                            <InfoBtn topic="observations" hint="Raw facts extracted from your sessions before synthesis into memories." />
                        </h2>
                        <Show
                            when={(observations()?.length ?? 0) > 0}
                            fallback={<div class="text-neutral-500 text-xs text-center py-8 flex flex-col items-center gap-2"><Icon name="eye-off" size={24} /><span>No observations</span></div>}
                        >
                            <For each={Object.entries(groupedObservations())}>
                                {([projPath, obs]) => (
                                    <>
                                        <Show when={projPath !== '_'}>
                                            <div class="w-full mt-4 mb-2 px-2 py-1.5 rounded bg-neutral-800/60 border border-neutral-700/50 flex items-center gap-1.5 hover:bg-neutral-800 transition-colors min-w-0 group/proj">
                                                <button
                                                    class="flex items-center gap-1.5 min-w-0 flex-1"
                                                    onClick={() => toggleProject(`obs:${projPath}`)}
                                                    title={projPath}
                                                >
                                                    <i class={`fa-solid ${projPath === '_global' ? 'fa-globe' : (projectIconMap()[projPath] || 'fa-folder-open')} text-purple-400 shrink-0`} style="font-size: 12px"></i>
                                                    <span class="text-xs font-medium text-neutral-300 truncate min-w-0 flex-1 text-left">{shortPath(projPath)}</span>
                                                    <span class="text-[10px] text-neutral-500 shrink-0">({obs.length})</span>
                                                    <Icon name={collapsedProjects()[`obs:${projPath}`] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-500 shrink-0" />
                                                </button>
                                                <Show when={projPath !== '_global'}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const proj = (projects() || []).find((p: Project) => p.path === projPath);
                                                            if (proj) setDeleteProjectTarget(proj);
                                                        }}
                                                        class="p-0.5 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
                                                        title="Delete project"
                                                    >
                                                        <i class="fa-solid fa-trash" style="font-size: 9px"></i>
                                                    </button>
                                                </Show>
                                            </div>
                                        </Show>
                                        <Show when={projPath === '_' || !collapsedProjects()[`obs:${projPath}`]}>
                                            <div class="flex flex-col gap-2">
                                                <For each={obs}>
                                                    {(o) => (
                                                        <ObservationCard
                                                            observation={o}
                                                            onDelete={(id) => setDeleteTarget({ type: 'observations', id })}
                                                            fullWidth
                                                        />
                                                    )}
                                                </For>
                                            </div>
                                        </Show>
                                    </>
                                )}
                            </For>
                        </Show>
                        {/* Deleted memories section */}
                        <Show when={(deletedMemories()?.length ?? 0) > 0}>
                            <h2 class="text-sm font-semibold text-neutral-300 mt-6 mb-3 flex items-center gap-2">
                                <Icon name="trash" size={14} class="text-red-400/70" />
                                Deleted Memories
                                <span class="text-xs text-red-300/50">({deletedMemories()!.length})</span>
                                <InfoBtn topic="deleted-memories" hint="Memories flagged for deletion by distillation. Click for details." />
                            </h2>
                            <div class="flex flex-col gap-2">
                                <For each={deletedMemories()}>
                                    {(m) => (
                                        <div
                                            class="rounded-lg border border-neutral-700/50 bg-neutral-800/40 p-3 cursor-pointer hover:bg-neutral-800/80 hover:border-red-400/20 transition-colors group"
                                            onClick={() => openDeletedMemoryDetail(m)}
                                        >
                                            <p class="text-xs text-neutral-300 leading-relaxed max-h-20 overflow-hidden">{m.content}</p>
                                            <Show when={m.deleted_reason}>
                                                <p class="text-[10px] text-red-300/50 italic mt-1.5 leading-relaxed">{m.deleted_reason}</p>
                                            </Show>
                                            <div class="text-[10px] text-neutral-600 mt-2 flex items-center gap-1">
                                                <span>#{m.id}</span>
                                                <span>·</span>
                                                <span>{shortPath(m.project_path)}</span>
                                                <span>·</span>
                                                <span>{new Date(m.deleted_at).toLocaleString()}</span>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </aside>

                    {/* Memories main panel */}
                    <main class="flex-1 overflow-y-auto p-4">
                        <Show when={(memories()?.length ?? 0) > 0 && searchResults() === null}>
                            <div class="flex justify-end mb-2 gap-1">
                                <Tooltip text="Collapse all projects">
                                    <button
                                        onClick={() => collapseAllProjects(true)}
                                        class="p-1 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800 transition-colors"
                                    >
                                        <i class="fa-solid fa-compress" style="font-size: 11px"></i>
                                    </button>
                                </Tooltip>
                                <Tooltip text="Expand all projects">
                                    <button
                                        onClick={() => collapseAllProjects(false)}
                                        class="p-1 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800 transition-colors"
                                    >
                                        <i class="fa-solid fa-expand" style="font-size: 11px"></i>
                                    </button>
                                </Tooltip>
                            </div>
                        </Show>
                        <Show when={searchResults() !== null} fallback={
                            <Show
                                when={(memories()?.length ?? 0) > 0}
                                fallback={<div class="text-neutral-500 text-xs text-center py-8 flex flex-col items-center gap-2"><Icon name="brain" size={24} /><span>No memories yet</span></div>}
                            >
                                <For each={groupedMemories()}>
                                    {(projGroup) => (
                                        <>
                                            {/* Project box */}
                                            <div class={`mt-4 first:mt-0 rounded-xl border border-neutral-700/50 bg-neutral-800/20 overflow-hidden ${projGroup.project === '_' ? '' : ''}`}>
                                                <Show when={projGroup.project !== '_'}>
                                                    <div
                                                        class="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-neutral-800/60 transition-colors group/proj"
                                                    >
                                                        <button
                                                            class="flex items-center gap-2 flex-1 min-w-0"
                                                            onClick={() => toggleProject(projGroup.project)}
                                                            title={projectDescMap()[projGroup.project] || projGroup.project}
                                                        >
                                                            <i class={`fa-solid ${projGroup.project === '_global' ? 'fa-globe' : (projectIconMap()[projGroup.project] || 'fa-folder-open')} text-[#d77757]`} style="font-size: 16px"></i>
                                                            <div class="flex flex-col items-start min-w-0">
                                                                <span class="text-sm font-bold text-neutral-200 truncate max-w-full">{shortPath(projGroup.project)}</span>
                                                                <Show when={projectDescMap()[projGroup.project]}>
                                                                    <span class="text-[10px] text-neutral-500 leading-tight truncate max-w-full">{projectDescMap()[projGroup.project]}</span>
                                                                </Show>
                                                            </div>
                                                            <span class="text-xs text-neutral-500 shrink-0">
                                                                ({projGroup.domains.reduce((n, d) => n + d.categories.reduce((c, cat) => c + cat.memories.length, 0), 0)} memories)
                                                            </span>
                                                            <Icon name={collapsedProjects()[projGroup.project] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500 shrink-0" />
                                                        </button>
                                                        <Tooltip text="Collapse all domains">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); collapseAllDomainsInProject(projGroup.project, true); }}
                                                                class="p-1 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
                                                            >
                                                                <i class="fa-solid fa-compress" style="font-size: 9px"></i>
                                                            </button>
                                                        </Tooltip>
                                                        <Tooltip text="Expand all domains">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); collapseAllDomainsInProject(projGroup.project, false); }}
                                                                class="p-1 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
                                                            >
                                                                <i class="fa-solid fa-expand" style="font-size: 9px"></i>
                                                            </button>
                                                        </Tooltip>
                                                        <Show when={projGroup.project !== '_global'}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const proj = (projects() || []).find((p: Project) => p.path === projGroup.project);
                                                                    if (proj) setDeleteProjectTarget(proj);
                                                                }}
                                                                class="p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0"
                                                                title="Delete project"
                                                            >
                                                                <i class="fa-solid fa-trash" style="font-size: 10px"></i>
                                                            </button>
                                                        </Show>
                                                    </div>
                                                </Show>
                                                {/* Project summary section */}
                                                {(() => {
                                                    // In single-project mode, projGroup.project is '_' — resolve to the actual selected project path
                                                    const summaryPath = projGroup.project === '_' ? project() : projGroup.project;
                                                    if (!summaryPath || summaryPath === '_global') return null;
                                                    if (projGroup.project !== '_' && collapsedProjects()[projGroup.project]) return null;
                                                    return (
                                                        <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} px-4 py-2`}>
                                                            <Show when={projectSummaryMap()[summaryPath]} fallback={
                                                                <button
                                                                    class="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                                                                    onClick={() => triggerSummary(summaryPath)}
                                                                    disabled={generatingSummary()[summaryPath]}
                                                                >
                                                                    <i class={`fa-solid ${generatingSummary()[summaryPath] ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`} style="font-size: 10px"></i>
                                                                    <span>{generatingSummary()[summaryPath] ? 'Generating summary...' : 'Generate AI Summary'}</span>
                                                                </button>
                                                            }>
                                                                <div class="flex items-center gap-1.5">
                                                                    <button
                                                                        class="flex items-center gap-1.5 text-xs text-amber-500/80 hover:text-amber-400 transition-colors flex-1"
                                                                        onClick={() => toggleSummary(summaryPath)}
                                                                    >
                                                                        <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 10px"></i>
                                                                        <span class="font-medium">AI Summary</span>
                                                                        <Icon name={collapsedSummaries()[summaryPath] ? 'chevron-right' : 'chevron-down'} size={10} class="text-amber-500/60" />
                                                                    </button>
                                                                    <button
                                                                        class="p-1 rounded text-neutral-600 hover:text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-40"
                                                                        onClick={() => triggerSummary(summaryPath)}
                                                                        disabled={generatingSummary()[summaryPath]}
                                                                        title="Regenerate summary"
                                                                    >
                                                                        <i class={`fa-solid ${generatingSummary()[summaryPath] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} style="font-size: 10px"></i>
                                                                    </button>
                                                                </div>
                                                                <Show when={!collapsedSummaries()[summaryPath]}>
                                                                    <div class="mt-2 text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap bg-neutral-900/40 rounded-lg p-3 border border-amber-500/10">
                                                                        {projectSummaryMap()[summaryPath]}
                                                                    </div>
                                                                </Show>
                                                            </Show>
                                                        </div>
                                                    );
                                                })()}
                                                {/* Architecture section */}
                                                {(() => {
                                                    const archPath = projGroup.project === '_' ? project() : projGroup.project;
                                                    if (!archPath || archPath === '_global') return null;
                                                    if (projGroup.project !== '_' && collapsedProjects()[projGroup.project]) return null;
                                                    const archData = projectArchitectureMap()[archPath];
                                                    const signals = (() => {
                                                        if (!archData?.facts) return [];
                                                        try {
                                                            const parsed = JSON.parse(archData.facts);
                                                            return [...new Set((parsed.signals || []).map((s: any) => s.kind) as string[])].sort();
                                                        } catch {
                                                            return [];
                                                        }
                                                    })();
                                                    return (
                                                        <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} px-4 py-2`}>
                                                            <Show when={archData} fallback={
                                                                <button
                                                                    class="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-cyan-400 transition-colors disabled:opacity-40"
                                                                    onClick={() => triggerArchitectureScan(archPath)}
                                                                    disabled={generatingArchitecture()[archPath]}
                                                                >
                                                                    <i class={`fa-solid ${generatingArchitecture()[archPath] ? 'fa-spinner fa-spin' : 'fa-sitemap'}`} style="font-size: 10px"></i>
                                                                    <span>{generatingArchitecture()[archPath] ? 'Scanning architecture...' : 'Scan Project Architecture'}</span>
                                                                </button>
                                                            }>
                                                                <div class="flex items-center gap-1.5">
                                                                    <button
                                                                        class="flex items-center gap-1.5 text-xs text-cyan-500/80 hover:text-cyan-400 transition-colors flex-1"
                                                                        onClick={() => toggleArchitecture(archPath)}
                                                                    >
                                                                        <i class="fa-solid fa-sitemap" style="font-size: 10px"></i>
                                                                        <span class="font-medium">Architecture</span>
                                                                        <Icon name={collapsedArchitecture()[archPath] ? 'chevron-right' : 'chevron-down'} size={10} class="text-cyan-500/60" />
                                                                    </button>
                                                                    <button
                                                                        class="p-1 rounded text-neutral-600 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                                                                        onClick={() => triggerArchitectureScan(archPath)}
                                                                        disabled={generatingArchitecture()[archPath]}
                                                                        title="Rescan architecture"
                                                                    >
                                                                        <i class={`fa-solid ${generatingArchitecture()[archPath] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} style="font-size: 10px"></i>
                                                                    </button>
                                                                    <button
                                                                        class="p-1 rounded text-neutral-600 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
                                                                        onClick={() => setArchitectureModalPath(archPath)}
                                                                        title="View full architecture details"
                                                                    >
                                                                        <i class="fa-solid fa-up-right-and-down-left-from-center" style="font-size: 10px"></i>
                                                                    </button>
                                                                </div>
                                                                <Show when={!collapsedArchitecture()[archPath]}>
                                                                    <div class="mt-2 text-xs text-neutral-400 leading-relaxed whitespace-pre-wrap bg-neutral-900/40 rounded-lg p-3 border border-cyan-500/10">
                                                                        {archData!.summary}
                                                                    </div>
                                                                    <Show when={signals.length > 0}>
                                                                        <div class="mt-2 flex flex-wrap gap-1">
                                                                            <For each={signals}>
                                                                                {(signal: string) => (
                                                                                    <span class="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400/80">
                                                                                        {signal}
                                                                                    </span>
                                                                                )}
                                                                            </For>
                                                                        </div>
                                                                    </Show>
                                                                </Show>
                                                            </Show>
                                                        </div>
                                                    );
                                                })()}
                                                {/* Git info + consolidation */}
                                                {(() => {
                                                    const gitPath = projGroup.project === '_' ? project() : projGroup.project;
                                                    if (!gitPath || gitPath === '_global') return null;
                                                    if (projGroup.project !== '_' && collapsedProjects()[projGroup.project]) return null;
                                                    const proj = (projects() || []).find((p: Project) => p.path === gitPath);
                                                    if (!proj) return null;
                                                    return (
                                                        <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} px-4 py-2`}>
                                                            <Show when={proj.git_root}>
                                                                <div class="flex items-center gap-1.5 text-[10px] text-neutral-600 mb-1">
                                                                    <i class="fa-solid fa-code-branch" style="font-size: 9px"></i>
                                                                    <span class="font-mono truncate">{proj.git_root}</span>
                                                                    <Show when={proj.git_url}>
                                                                        <span class="text-neutral-700">·</span>
                                                                        <span class="truncate">{proj.git_url}</span>
                                                                    </Show>
                                                                </div>
                                                            </Show>
                                                            <div class="flex items-center justify-between flex-wrap gap-2">
                                                                <div class="flex items-center gap-2">
                                                                    <span class="text-[10px] text-neutral-500">Consolidation:</span>
                                                                    <InfoBtn topic="consolidation" hint="Auto-merge subfolder projects into the git root. Click for details." />
                                                                    <For each={[
                                                                        { value: '' as const, label: 'Default' },
                                                                        { value: 'yes' as const, label: 'Always' },
                                                                        { value: 'no' as const, label: 'Never' },
                                                                    ]}>
                                                                        {(opt) => (
                                                                            <button
                                                                                class={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                                                                    proj.consolidate === opt.value
                                                                                        ? 'bg-cyan-500/15 text-cyan-400'
                                                                                        : 'text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800'
                                                                                }`}
                                                                                onClick={() => setConsolidate(proj.id, opt.value)}
                                                                            >
                                                                                {opt.label}
                                                                            </button>
                                                                        )}
                                                                    </For>
                                                                </div>
                                                                <div class="flex items-center gap-2">
                                                                    <span class="text-[10px] text-neutral-500">Distillation:</span>
                                                                    <InfoBtn topic="deleted-memories" hint="Review memories against codebase for staleness. Flagged memories are hidden and purged after the grace period." />
                                                                    {(distilling()[proj.path] || proj.distillation_queued)
                                                                        ? <span class="text-[10px] text-purple-400">Distilling...</span>
                                                                        : <button
                                                                            class="text-[10px] px-1.5 py-0.5 rounded transition-colors border border-purple-400/20 text-purple-400 hover:bg-purple-400/10"
                                                                            onClick={() => triggerDistillation(proj.id, proj.path)}
                                                                        >
                                                                            Run Now
                                                                        </button>
                                                                    }
                                                                    <span class={`text-[10px] ${proj.distillation_status === 'failed' ? 'text-red-400' : 'text-neutral-600'}`}>
                                                                        {(distilling()[proj.path] || proj.distillation_queued)
                                                                            ? ''
                                                                            : proj.distillation_status === 'failed'
                                                                                ? `Failed: ${proj.distillation_error || 'unknown error'}`
                                                                                : proj.distillation_at
                                                                                    ? `Last: ${new Date(proj.distillation_at).toLocaleDateString()}`
                                                                                    : 'Never run'
                                                                        }
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                                <Show when={projGroup.project === '_' || !collapsedProjects()[projGroup.project]}>
                                                    <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} p-3 flex flex-col gap-3`}>
                                                        <For each={projGroup.domains}>
                                                            {(domGroup) => {
                                                                const domKey = `${projGroup.project}:${domGroup.domain}`;
                                                                return (
                                                                    /* Domain box */
                                                                    <div class="rounded-lg border border-neutral-700/30 bg-neutral-800/30 overflow-hidden">
                                                                        <div class="flex items-center py-2 px-3 hover:bg-neutral-800/60 transition-colors group/dom">
                                                                            <button
                                                                                class="flex-1 flex items-center justify-between text-sm font-semibold text-neutral-200"
                                                                                onClick={() => toggleDomain(domKey)}
                                                                            >
                                                                                <span class="capitalize flex items-center gap-1.5">
                                                                                    <i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 14px"></i>
                                                                                    {domGroup.domain}
                                                                                    <span class="text-neutral-600 font-normal text-xs">({domGroup.categories.reduce((sum, c) => sum + c.memories.length, 0)})</span>
                                                                                </span>
                                                                                <Icon name={collapsedDomains()[domKey] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500" />
                                                                            </button>
                                                                            <Show when={domGroup.categories.length > 1}>
                                                                                <div class="flex gap-0.5 ml-2 opacity-0 group-hover/dom:opacity-100 transition-opacity">
                                                                                    <Tooltip text="Collapse categories">
                                                                                        <button
                                                                                            onClick={() => collapseAllCategoriesInDomain(domKey, true)}
                                                                                            class="p-0.5 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800"
                                                                                        >
                                                                                            <i class="fa-solid fa-compress" style="font-size: 8px"></i>
                                                                                        </button>
                                                                                    </Tooltip>
                                                                                    <Tooltip text="Expand categories">
                                                                                        <button
                                                                                            onClick={() => collapseAllCategoriesInDomain(domKey, false)}
                                                                                            class="p-0.5 rounded text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800"
                                                                                        >
                                                                                            <i class="fa-solid fa-expand" style="font-size: 8px"></i>
                                                                                        </button>
                                                                                    </Tooltip>
                                                                                </div>
                                                                            </Show>
                                                                        </div>
                                                                        <Show when={!collapsedDomains()[domKey]}>
                                                                            <div class="border-t border-neutral-700/30 p-3 flex flex-col gap-3">
                                                                                <For each={domGroup.categories}>
                                                                                    {(catGroup) => {
                                                                                        const catKey = `${domKey}:${catGroup.category}`;
                                                                                        return (
                                                                                            /* Category box */
                                                                                            <div class="rounded-lg border border-neutral-800 bg-neutral-900/30 overflow-hidden">
                                                                                                <button
                                                                                                    class="w-full flex items-center justify-between py-2 px-3 text-xs font-medium text-neutral-400 hover:text-neutral-300 hover:bg-neutral-800/50"
                                                                                                    onClick={() => toggleCategory(catKey)}
                                                                                                >
                                                                                                    <span class="capitalize flex items-center gap-1.5">
                                                                                                        <i class={`fa-solid ${categoryIconMap()[catGroup.category] || 'fa-bookmark'}`} style="font-size: 12px"></i>
                                                                                                        {catGroup.category}
                                                                                                        <span class="text-neutral-600 font-normal">({catGroup.memories.length})</span>
                                                                                                    </span>
                                                                                                    <Icon name={collapsedCategories()[catKey] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-600" />
                                                                                                </button>
                                                                                                <Show when={!collapsedCategories()[catKey]}>
                                                                                                    <div class="flex flex-wrap gap-3 p-3 border-t border-neutral-800">
                                                                                                        <For each={catGroup.memories}>
                                                                                                            {(m) => (
                                                                                                                <MemoryCard
                                                                                                                    memory={m}
                                                                                                                    onDelete={(id) => setDeleteTarget({ type: 'memories', id })}
                                                                                                                    onExpand={(m) => openMemoryDetail(m)}
                                                                                                                    domainIcon={domainIconMap()[m.domain || ''] || 'fa-folder'}
                                                                                                                    categoryIcon={categoryIconMap()[m.category] || 'fa-bookmark'}
                                                                                                                />
                                                                                                            )}
                                                                                                        </For>
                                                                                                    </div>
                                                                                                </Show>
                                                                                            </div>
                                                                                        );
                                                                                    }}
                                                                                </For>
                                                                            </div>
                                                                        </Show>
                                                                    </div>
                                                                );
                                                            }}
                                                        </For>
                                                    </div>
                                                </Show>
                                            </div>
                                        </>
                                    )}
                                </For>
                            </Show>
                        }>
                            {/* Search results flat view */}
                            <div class="text-xs text-neutral-500 mb-2">
                                {searchResults()!.length} result{searchResults()!.length !== 1 ? 's' : ''} for '{searchQuery()}'
                            </div>
                            <Show when={searchResults()!.length > 0} fallback={
                                <div class="text-neutral-500 text-xs text-center py-8">No matches found</div>
                            }>
                                <div class="flex flex-wrap gap-3">
                                    <For each={searchResults()!}>
                                        {(m) => (
                                            <MemoryCard
                                                memory={m}
                                                onDelete={(id) => setDeleteTarget({ type: 'memories', id })}
                                                onExpand={(m) => openMemoryDetail(m)}
                                                domainIcon={domainIconMap()[m.domain || ''] || 'fa-folder'}
                                                categoryIcon={categoryIconMap()[m.category] || 'fa-bookmark'}
                                            />
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </Show>
                    </main>
                </div>
            </Show>

            <ConfirmModal
                open={!!deleteTarget()}
                message={`Delete ${deleteTarget()?.type?.slice(0, -1)} #${deleteTarget()?.id}?`}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />

            <ConfirmModal
                open={stopConfirm()}
                title="Stop Server"
                message="Stop the server? It will restart automatically with your next Claude Code session."
                confirmLabel="Stop"
                confirmClass="text-sm px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
                onConfirm={handleStop}
                onCancel={() => setStopConfirm(false)}
            />

            <ConfirmModal
                open={!!deleteProjectTarget()}
                title="Delete Project"
                message={`Delete project "${deleteProjectTarget() ? shortPath(deleteProjectTarget().path) : ''}"? This will permanently delete ${deleteProjectTarget()?.memory_count || 0} memories and ${deleteProjectTarget()?.observation_count || 0} observations.`}
                confirmLabel="Delete Project"
                onConfirm={confirmDeleteProject}
                onCancel={() => setDeleteProjectTarget(null)}
            />

            <TerminalLogs open={logsOpen()} onClose={closeLogs} />

            <HelpDrawer open={helpOpen()} topic={helpTopic()} onClose={closeHelp} />

            <Settings open={settingsOpen()} initialTab={settingsTab()} onClose={closeSettings} onTabChange={handleSettingsTabChange} showToast={showToast} onHelp={() => { closeSettings(); openHelp('settings'); }} />


            <TransferModal
                open={transferOpen()}
                projects={projects() || []}
                onClose={closeTransfer}
                onTransfer={async (targetPath, sourcePaths) => {
                    const res = await fetch('/api/projects/transfer-batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ targetPath, sourcePaths }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Transfer failed');
                    const total = data.results.reduce((acc: any, r: any) => ({
                        memories: acc.memories + (r.memories || 0),
                        observations: acc.observations + (r.observations || 0),
                    }), { memories: 0, observations: 0 });
                    showToast(`Merged ${total.memories} memories, ${total.observations} observations from ${sourcePaths.length} project(s)`);
                    refresh();
                }}
                onBatchDelete={handleBatchDelete}
            />

            <MemoryDetailModal
                memory={memoryDetail()}
                domains={taxonomyDomains()}
                categories={taxonomyCategories()}
                open={memoryDetailOpen()}
                onClose={closeMemoryDetail}
                onUpdate={handleMemoryUpdate}
                showToast={showToast}
            />

            <MemoryDetailModal
                memory={deletedMemoryDetail()}
                domains={taxonomyDomains()}
                categories={taxonomyCategories()}
                open={deletedMemoryDetailOpen()}
                onClose={closeDeletedMemoryDetail}
                onUpdate={async () => {}}
                onRestore={handleRestoreMemory}
                onPermanentDelete={handlePermanentDeleteMemory}
                showToast={showToast}
                mode="deleted"
            />

                <ArchitectureModal
                    data={(() => {
                        const path = architectureModalPath();
                        if (!path) return null;
                        const arch = projectArchitectureMap()[path];
                        if (!arch) return null;
                        return arch;
                    })()}
                    open={!!architectureModalPath()}
                    onClose={() => setArchitectureModalPath(null)}
                />

            <Show when={toast()}>
                <div class="fixed bottom-4 right-4 bg-neutral-800 border border-neutral-600 text-neutral-200 text-sm px-4 py-2 rounded shadow-lg z-50">
                    {toast()}
                </div>
            </Show>
        </div>
    );
};

export default App;
