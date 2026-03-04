import { createSignal, createResource, createMemo, onCleanup, For, Show, type Component } from 'solid-js';
import { ProjectSelector } from './components/ProjectSelector';
import { MemoryCard } from './components/MemoryCard';
import { ObservationCard } from './components/ObservationCard';
import { ConfirmModal } from './components/Modal';
import TerminalLogs from './components/TerminalLogs';
import HelpDrawer from './components/HelpDrawer';
import Settings from './components/Settings';
import TransferModal from './components/TransferModal';
import Icon from './components/Icon';
import { sse, listen } from './sse';

export type Memory = {
    id: number;
    content: string;
    tags: string;
    category: string;
    importance: number;
    domain: string | null;
    reason: string;
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

export const shortPath = (p: string) =>
    p === '_global' ? 'global' : p.replace(/^\/(?:Users|home)\/[^/]+\//, '~/');


const App: Component = () => {
    const [project, setProject] = createSignal(localStorage.getItem(STORAGE_KEY) || '');
    const [refreshKey, setRefreshKey] = createSignal(0);
    const [deleteTarget, setDeleteTarget] = createSignal<{ type: string; id: number } | null>(null);
    const [toast, setToast] = createSignal('');
    const [restarting, setRestarting] = createSignal(false);
    const [cleaningUp, setCleaningUp] = createSignal(false);
    const [logsOpen, setLogsOpen] = createSignal(false);
    const [helpOpen, setHelpOpen] = createSignal(false);
    const [settingsOpen, setSettingsOpen] = createSignal(false);

    const [transferOpen, setTransferOpen] = createSignal(false);
    const [helpTopic, setHelpTopic] = createSignal('');
    const [stopConfirm, setStopConfirm] = createSignal(false);
    const [stopping, setStopping] = createSignal(false);
    const [deleteProjectTarget, setDeleteProjectTarget] = createSignal<any>(null);
    const openHelp = (topic: string) => { setHelpTopic(topic); setHelpOpen(true); };

    const [collapsedProjects, setCollapsedProjects] = createSignal<Record<string, boolean>>({});
    const [collapsedDomains, setCollapsedDomains] = createSignal<Record<string, boolean>>({});
    const [collapsedCategories, setCollapsedCategories] = createSignal<Record<string, boolean>>({});

    const toggleProject = (key: string) => {
        setCollapsedProjects(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleDomain = (key: string) => {
        setCollapsedDomains(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleCategory = (key: string) => {
        setCollapsedCategories(prev => ({ ...prev, [key]: !prev[key] }));
    };

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

    // SSE real-time updates
    for (const evt of ['memory:created', 'memory:deleted', 'observation:created', 'observation:deleted', 'counts:updated']) {
        listen(evt);
        sse.addEventListener(evt, refresh);
    }
    onCleanup(() => {
        for (const evt of ['memory:created', 'memory:deleted', 'observation:created', 'observation:deleted', 'counts:updated']) {
            sse.removeEventListener(evt, refresh);
        }
    });

    const [projects] = createResource(() => refreshKey(), () => api<Project[]>('/api/projects'));

    const [domainMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/domains'));
    const [categoryMeta] = createResource(() => refreshKey(), () => api<{ name: string; icon: string }[]>('/api/categories'));

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

    const [memories] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}&limit=100` : '?limit=100';
            return api<Memory[]>('/api/memories' + qs);
        },
    );

    const [observations] = createResource(
        () => ({ project: project(), key: refreshKey() }),
        ({ project: p }) => {
            const qs = p ? `?project=${encodeURIComponent(p)}&limit=100` : '?limit=100';
            return api<Observation[]>('/api/observations' + qs);
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

    const InfoBtn: Component<{ topic: string }> = (p) => (
        <button
            onClick={() => openHelp(p.topic)}
            class="p-1 rounded text-neutral-600 hover:text-sky-400 transition-colors"
            title="Help"
        >
            <Icon name="info" size={13} />
        </button>
    );

    return (
        <div class="max-w-[1400px] mx-auto flex flex-col h-screen">
            {/* Header */}
            <header class="flex items-center justify-between px-4 py-4 shrink-0">
                <div class="flex items-center gap-4">
                    <h1 class="text-xl font-bold text-neutral-200 flex items-center gap-2">
                        <Icon name="brain" size={20} class="text-sky-400" />
                        ai-memory
                    </h1>
                    <div class="flex gap-3 text-xs">
                        <span class="text-sky-300/70 flex items-center gap-1">
                            <Icon name="brain" size={12} />
                            {memories()?.length ?? 0} memories
                        </span>
                        <span class="text-purple-300/70 flex items-center gap-1">
                            <Icon name="eye" size={12} />
                            {observations()?.length ?? 0} observations
                        </span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
<button
                        onClick={() => setSettingsOpen(true)}
                        class="px-2 py-1.5 rounded text-neutral-500 hover:text-sky-400 transition-colors flex items-center"
                        title="Settings"
                    >
                        <Icon name="gear" size={15} />
                    </button>
                    <button
                        onClick={() => openHelp('about')}
                        class="px-2 py-1.5 rounded text-neutral-500 hover:text-sky-400 transition-colors flex items-center"
                        title="Help"
                    >
                        <Icon name="info" size={15} />
                    </button>
                    <button
                        onClick={() => setLogsOpen(true)}
                        class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                        title="View server logs"
                    >
                        <Icon name="terminal" size={14} />
                        Logs
                    </button>
                    <button
                        onClick={() => setTransferOpen(true)}
                        class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                        title="Transfer memories between projects"
                    >
                        <Icon name="transfer" size={14} />
                        Transfer
                    </button>
                    <button
                        onClick={handleCleanup}
                        disabled={cleaningUp()}
                        class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                        title="Remove junk observations and duplicate memories"
                    >
                        <Icon name="broom" size={14} />
                        {cleaningUp() ? 'Cleaning...' : 'Clean up'}
                    </button>
                    <button
                        onClick={handleRestart}
                        disabled={restarting()}
                        class="px-2 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 disabled:opacity-50 transition-colors flex items-center"
                        title="Restart the ai-memory server"
                    >
                        <Icon name="rotate-cw" size={14} class={restarting() ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setStopConfirm(true)}
                        class="px-2 py-1.5 text-xs rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 transition-colors flex items-center"
                        title="Stop the ai-memory server"
                    >
                        <i class="fa-solid fa-stop" style="font-size: 14px"></i>
                    </button>
                    <ProjectSelector
                        projects={projects() || []}
                        selected={project()}
                        onChange={selectProject}
                        onDeleteProject={() => {
                            const proj = (projects() || []).find((p: any) => p.path === project());
                            if (proj) setDeleteProjectTarget(proj);
                        }}
                    />
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
                            <span class="text-xs text-purple-300/70">({observations()?.length ?? 0})</span>
                            <InfoBtn topic="observations" />
                        </h2>
                        <Show
                            when={(observations()?.length ?? 0) > 0}
                            fallback={<div class="text-neutral-500 text-xs text-center py-8 flex flex-col items-center gap-2"><Icon name="eye-off" size={24} /><span>No observations</span></div>}
                        >
                            <For each={Object.entries(groupedObservations())}>
                                {([projPath, obs]) => (
                                    <>
                                        <Show when={projPath !== '_'}>
                                            <button
                                                class="w-full mt-4 mb-2 px-2 py-1.5 rounded bg-neutral-800/60 border border-neutral-700/50 flex items-center gap-1.5 hover:bg-neutral-800 transition-colors"
                                                onClick={() => toggleProject(`obs:${projPath}`)}
                                            >
                                                <Icon name={projPath === '_global' ? 'globe' : 'folder-open'} size={12} class="text-purple-400" />
                                                <span class="text-xs font-medium text-neutral-300">{shortPath(projPath)}</span>
                                                <span class="text-[10px] text-neutral-500">({obs.length})</span>
                                                <span class="ml-auto">
                                                    <Icon name={collapsedProjects()[`obs:${projPath}`] ? 'chevron-right' : 'chevron-down'} size={10} class="text-neutral-500" />
                                                </span>
                                            </button>
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
                    </aside>

                    {/* Memories main panel */}
                    <main class="flex-1 overflow-y-auto p-4">
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
                                                <button
                                                    class="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-neutral-800/60 transition-colors"
                                                    onClick={() => toggleProject(projGroup.project)}
                                                >
                                                    <Icon name={projGroup.project === '_global' ? 'globe' : 'folder-open'} size={16} class="text-sky-400" />
                                                    <span class="text-sm font-bold text-neutral-200">{shortPath(projGroup.project)}</span>
                                                    <span class="text-xs text-neutral-500">
                                                        ({projGroup.domains.reduce((n, d) => n + d.categories.reduce((c, cat) => c + cat.memories.length, 0), 0)} memories)
                                                    </span>
                                                    <span class="ml-auto">
                                                        <Icon name={collapsedProjects()[projGroup.project] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500" />
                                                    </span>
                                                </button>
                                            </Show>
                                            <Show when={projGroup.project === '_' || !collapsedProjects()[projGroup.project]}>
                                                <div class={`${projGroup.project !== '_' ? 'border-t border-neutral-700/50' : ''} p-3 flex flex-col gap-3`}>
                                                    <For each={projGroup.domains}>
                                                        {(domGroup) => {
                                                            const domKey = `${projGroup.project}:${domGroup.domain}`;
                                                            return (
                                                                /* Domain box */
                                                                <div class="rounded-lg border border-neutral-700/30 bg-neutral-800/30 overflow-hidden">
                                                                    <button
                                                                        class="w-full flex items-center justify-between py-2 px-3 text-sm font-semibold text-neutral-200 hover:bg-neutral-800/60 transition-colors"
                                                                        onClick={() => toggleDomain(domKey)}
                                                                    >
                                                                        <span class="capitalize flex items-center gap-1.5">
                                                                            <i class={`fa-solid ${domainIconMap()[domGroup.domain] || 'fa-folder'}`} style="font-size: 14px"></i>
                                                                            {domGroup.domain}
                                                                        </span>
                                                                        <Icon name={collapsedDomains()[domKey] ? 'chevron-right' : 'chevron-down'} size={12} class="text-neutral-500" />
                                                                    </button>
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

            <TerminalLogs open={logsOpen()} onClose={() => setLogsOpen(false)} />

            <HelpDrawer open={helpOpen()} topic={helpTopic()} onClose={() => setHelpOpen(false)} />

            <Settings open={settingsOpen()} onClose={() => setSettingsOpen(false)} showToast={showToast} />


            <TransferModal
                open={transferOpen()}
                projects={projects() || []}
                onClose={() => setTransferOpen(false)}
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
                    showToast(`Transferred ${total.memories} memories, ${total.observations} observations from ${sourcePaths.length} project(s)`);
                    refresh();
                }}
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
