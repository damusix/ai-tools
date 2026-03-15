import { createSignal, createEffect, createMemo, Show, For, type Component } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';
import type { Project } from '../App';
import { shortPath } from '../App';

const TransferModal: Component<{
    open: boolean;
    projects: Project[];
    onClose: () => void;
    onTransfer: (targetPath: string, sourcePaths: string[]) => Promise<void>;
    onBatchDelete: (projectIds: number[]) => Promise<void>;
}> = (props) => {
    const [mode, setMode] = createSignal<'merge' | 'delete'>('merge');
    const [targetMode, setTargetMode] = createSignal<'existing' | 'new'>('existing');
    const [targetExisting, setTargetExisting] = createSignal('');
    const [targetNew, setTargetNew] = createSignal('');
    const [selectedSources, setSelectedSources] = createSignal<Record<string, boolean>>({});
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal('');
    const [sourceFilter, setSourceFilter] = createSignal('');
    const [confirmingDelete, setConfirmingDelete] = createSignal(false);

    const targetPath = () => targetMode() === 'existing' ? targetExisting() : targetNew().trim();

    const sourcePaths = () => Object.entries(selectedSources())
        .filter(([, v]) => v)
        .map(([k]) => k);

    const selectedProjects = () => props.projects.filter(p => selectedSources()[p.path]);

    const deleteTotals = createMemo(() => {
        const sel = selectedProjects();
        return {
            projects: sel.length,
            memories: sel.reduce((n, p) => n + p.memory_count, 0),
            observations: sel.reduce((n, p) => n + p.observation_count, 0),
        };
    });

    const availableSources = () => {
        if (mode() === 'delete') {
            return props.projects.filter(p => p.path !== '_global');
        }
        return props.projects.filter(p => p.path !== '_global' && p.path !== targetPath());
    };

    const filteredSources = createMemo(() => {
        const q = sourceFilter().trim();
        if (!q) return availableSources();
        try {
            const re = new RegExp(q, 'i');
            return availableSources().filter(p => re.test(p.path));
        } catch {
            const lower = q.toLowerCase();
            return availableSources().filter(p => p.path.toLowerCase().includes(lower));
        }
    });

    const toggleSource = (path: string) => {
        setSelectedSources(prev => ({ ...prev, [path]: !prev[path] }));
    };

    const valid = () => {
        if (mode() === 'delete') return sourcePaths().length > 0;
        return targetPath() && sourcePaths().length > 0;
    };

    const handleSubmit = async () => {
        if (!valid()) return;

        if (mode() === 'delete') {
            if (!confirmingDelete()) {
                setConfirmingDelete(true);
                return;
            }
            setLoading(true);
            setError('');
            try {
                const ids = selectedProjects().map(p => p.id);
                await props.onBatchDelete(ids);
                props.onClose();
            } catch (err: any) {
                setError(err.message || 'Delete failed');
            } finally {
                setLoading(false);
                setConfirmingDelete(false);
            }
            return;
        }

        setLoading(true);
        setError('');
        try {
            await props.onTransfer(targetPath(), sourcePaths());
            props.onClose();
        } catch (err: any) {
            setError(err.message || 'Merge failed');
        } finally {
            setLoading(false);
        }
    };

    // Reset state when modal opens
    createEffect(() => {
        if (props.open) {
            setMode('merge');
            setTargetMode('existing');
            setTargetExisting('');
            setTargetNew('');
            setSelectedSources({});
            setSourceFilter('');
            setError('');
            setConfirmingDelete(false);
        }
    });

    // Reset confirmation when selection changes
    createEffect(() => {
        sourcePaths();
        setConfirmingDelete(false);
    });

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div class="px-5 py-4 border-b border-neutral-700 flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <i class={`fa-solid ${mode() === 'delete' ? 'fa-trash-can' : 'fa-right-left'} ${mode() === 'delete' ? 'text-red-400' : 'text-[#d77757]'}`} style="font-size: 14px"></i>
                        {mode() === 'delete' ? 'Delete Projects' : 'Merge Projects'}
                    </h2>
                    <button onClick={props.onClose} class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800">
                        <Icon name="x" size={14} />
                    </button>
                </div>

                {/* Mode tabs */}
                <div class="flex border-b border-neutral-700">
                    <button
                        class={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${mode() === 'merge' ? 'text-[#d77757] border-b-2 border-[#d77757] bg-[#d77757]/5' : 'text-neutral-500 hover:text-neutral-300'}`}
                        onClick={() => { setMode('merge'); setSelectedSources({}); setConfirmingDelete(false); }}
                    >
                        <i class="fa-solid fa-right-left mr-1.5" style="font-size: 10px"></i>
                        Merge
                    </button>
                    <button
                        class={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${mode() === 'delete' ? 'text-red-400 border-b-2 border-red-400 bg-red-400/5' : 'text-neutral-500 hover:text-neutral-300'}`}
                        onClick={() => { setMode('delete'); setSelectedSources({}); setConfirmingDelete(false); }}
                    >
                        <i class="fa-solid fa-trash-can mr-1.5" style="font-size: 10px"></i>
                        Delete
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Target section (merge mode only) */}
                    <Show when={mode() === 'merge'}>
                        <div>
                            <label class="text-xs font-medium text-neutral-400 mb-2 block">Merge INTO (target)</label>
                            <div class="flex gap-2 mb-2">
                                <button
                                    class={`px-2 py-1 text-xs rounded ${targetMode() === 'existing' ? 'bg-[#d77757]/10 text-[#d77757]' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    onClick={() => setTargetMode('existing')}
                                >Existing project</button>
                                <button
                                    class={`px-2 py-1 text-xs rounded ${targetMode() === 'new' ? 'bg-[#d77757]/10 text-[#d77757]' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    onClick={() => setTargetMode('new')}
                                >New project path</button>
                            </div>
                            <Show when={targetMode() === 'existing'} fallback={
                                <input
                                    type="text"
                                    value={targetNew()}
                                    onInput={e => setTargetNew(e.currentTarget.value)}
                                    placeholder="/path/to/project"
                                    class="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600"
                                />
                            }>
                                <select
                                    value={targetExisting()}
                                    onChange={e => setTargetExisting(e.currentTarget.value)}
                                    class="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200"
                                >
                                    <option value="">Select target project...</option>
                                    <For each={props.projects.filter(p => p.path !== '_global')}>
                                        {p => <option value={p.path}>{shortPath(p.path)}</option>}
                                    </For>
                                </select>
                            </Show>
                        </div>
                    </Show>

                    {/* Source/selection section */}
                    <div>
                        <label class="text-xs font-medium text-neutral-400 mb-2 block">
                            {mode() === 'delete' ? 'Select projects to delete' : 'Merge FROM (select sources)'} — {sourcePaths().length} selected
                        </label>
                        <div class="relative mb-2">
                            <i class="fa-solid fa-filter absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-600" style="font-size: 10px"></i>
                            <input
                                type="text"
                                value={sourceFilter()}
                                onInput={e => setSourceFilter(e.currentTarget.value)}
                                placeholder="Filter projects (regex)..."
                                class="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 pl-7 text-xs text-neutral-200 placeholder:text-neutral-600"
                            />
                        </div>
                        <div class="max-h-48 overflow-y-auto border border-neutral-700 rounded">
                            <For each={filteredSources()} fallback={<p class="text-xs text-neutral-600 p-3">{sourceFilter() ? 'No matching projects' : 'No projects available'}</p>}>
                                {p => {
                                    const accentColor = mode() === 'delete' ? 'red-400' : '[#d77757]';
                                    const isSelected = () => !!selectedSources()[p.path];
                                    return (
                                        <label
                                            class={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b last:border-0 transition-colors ${
                                                isSelected()
                                                    ? mode() === 'delete'
                                                        ? 'border-l-[3px] border-l-red-400 border-b-red-400/20 bg-red-400/10'
                                                        : 'border-l-[3px] border-l-[#d77757] border-b-[#d77757]/20 bg-[#d77757]/10'
                                                    : 'border-l-[3px] border-l-transparent border-b-neutral-800 hover:bg-neutral-800'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected()}
                                                onChange={() => toggleSource(p.path)}
                                                class={mode() === 'delete' ? 'accent-red-400' : 'accent-[#d77757]'}
                                            />
                                            <span class={`text-sm flex-1 ${isSelected() ? (mode() === 'delete' ? 'text-red-400' : 'text-[#d77757]') : 'text-neutral-300'}`}>{shortPath(p.path)}</span>
                                            <span class={`text-[10px] ${isSelected() ? (mode() === 'delete' ? 'text-red-400/60' : 'text-[#d77757]/60') : 'text-neutral-600'}`}>{p.memory_count}m / {p.observation_count}o</span>
                                        </label>
                                    );
                                }}
                            </For>
                        </div>
                    </div>

                    {/* Confirmation summary for delete mode */}
                    <Show when={mode() === 'delete' && confirmingDelete()}>
                        <div class="bg-red-900/20 border border-red-500/30 rounded-lg px-4 py-3">
                            <p class="text-sm text-red-300 font-medium mb-1">Are you sure?</p>
                            <p class="text-xs text-red-300/80">
                                This will permanently delete {deleteTotals().projects} project{deleteTotals().projects !== 1 ? 's' : ''}, removing {deleteTotals().memories} memor{deleteTotals().memories !== 1 ? 'ies' : 'y'} and {deleteTotals().observations} observation{deleteTotals().observations !== 1 ? 's' : ''}.
                            </p>
                        </div>
                    </Show>

                    <Show when={error()}>
                        <p class="text-xs text-red-400">{error()}</p>
                    </Show>
                </div>

                {/* Footer */}
                <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-700">
                    <button onClick={() => { if (confirmingDelete()) { setConfirmingDelete(false); } else { props.onClose(); } }} class="text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-neutral-300">
                        {confirmingDelete() ? 'Back' : 'Cancel'}
                    </button>
                    <Show when={mode() === 'delete'} fallback={
                        <button
                            onClick={handleSubmit}
                            disabled={!valid() || loading()}
                            class="text-sm px-3 py-1.5 rounded bg-[#d77757]/10 text-[#d77757] hover:bg-[#d77757]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading() ? 'Merging...' : `Merge ${sourcePaths().length} project(s)`}
                        </button>
                    }>
                        <button
                            onClick={handleSubmit}
                            disabled={!valid() || loading()}
                            class="text-sm px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading() ? 'Deleting...' : confirmingDelete() ? `Confirm delete ${deleteTotals().projects} project(s)` : `Delete ${sourcePaths().length} project(s)`}
                        </button>
                    </Show>
                </div>
            </div>
        </Overlay>
    );
};

export default TransferModal;
