import { createSignal, createEffect, Show, For, type Component } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';
import type { Project } from '../App';
import { shortPath } from '../App';

const TransferModal: Component<{
    open: boolean;
    projects: Project[];
    onClose: () => void;
    onTransfer: (targetPath: string, sourcePaths: string[]) => Promise<void>;
}> = (props) => {
    const [targetMode, setTargetMode] = createSignal<'existing' | 'new'>('existing');
    const [targetExisting, setTargetExisting] = createSignal('');
    const [targetNew, setTargetNew] = createSignal('');
    const [selectedSources, setSelectedSources] = createSignal<Record<string, boolean>>({});
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal('');

    const targetPath = () => targetMode() === 'existing' ? targetExisting() : targetNew().trim();

    const sourcePaths = () => Object.entries(selectedSources())
        .filter(([, v]) => v)
        .map(([k]) => k);

    const availableSources = () => props.projects.filter(
        p => p.path !== '_global' && p.path !== targetPath()
    );

    const toggleSource = (path: string) => {
        setSelectedSources(prev => ({ ...prev, [path]: !prev[path] }));
    };

    const valid = () => targetPath() && sourcePaths().length > 0;

    const handleSubmit = async () => {
        if (!valid()) return;
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
            setTargetMode('existing');
            setTargetExisting('');
            setTargetNew('');
            setSelectedSources({});
            setError('');
        }
    });

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div class="px-5 py-4 border-b border-neutral-700 flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <i class="fa-solid fa-right-left text-[#d77757]" style="font-size: 14px"></i>
                        Merge Projects
                    </h2>
                    <button onClick={props.onClose} class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800">
                        <Icon name="x" size={14} />
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* Target section */}
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

                    {/* Source section */}
                    <div>
                        <label class="text-xs font-medium text-neutral-400 mb-2 block">
                            Merge FROM (select sources) — {sourcePaths().length} selected
                        </label>
                        <div class="max-h-48 overflow-y-auto border border-neutral-700 rounded">
                            <For each={availableSources()} fallback={<p class="text-xs text-neutral-600 p-3">No projects available</p>}>
                                {p => (
                                    <label class="flex items-center gap-2 px-3 py-2 hover:bg-neutral-800 cursor-pointer border-b border-neutral-800 last:border-0">
                                        <input
                                            type="checkbox"
                                            checked={!!selectedSources()[p.path]}
                                            onChange={() => toggleSource(p.path)}
                                            class="accent-[#d77757]"
                                        />
                                        <span class="text-sm text-neutral-300 flex-1">{shortPath(p.path)}</span>
                                        <span class="text-[10px] text-neutral-600">{p.memory_count}m / {p.observation_count}o</span>
                                    </label>
                                )}
                            </For>
                        </div>
                    </div>

                    <Show when={error()}>
                        <p class="text-xs text-red-400">{error()}</p>
                    </Show>
                </div>

                {/* Footer */}
                <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-700">
                    <button onClick={props.onClose} class="text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-neutral-300">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={!valid() || loading()}
                        class="text-sm px-3 py-1.5 rounded bg-[#d77757]/10 text-[#d77757] hover:bg-[#d77757]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading() ? 'Merging...' : `Merge ${sourcePaths().length} project(s)`}
                    </button>
                </div>
            </div>
        </Overlay>
    );
};

export default TransferModal;
