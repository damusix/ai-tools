import { createSignal, For, type Component } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';
import type { Project } from '../App';
import { shortPath } from '../App';

const TransferModal: Component<{
    open: boolean;
    projects: Project[];
    onClose: () => void;
    onTransfer: (from: string, to: string) => Promise<void>;
}> = (props) => {
    const [from, setFrom] = createSignal('');
    const [toMode, setToMode] = createSignal<'existing' | 'custom'>('custom');
    const [toExisting, setToExisting] = createSignal('');
    const [toCustom, setToCustom] = createSignal('');
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal('');

    const reset = () => {
        setFrom('');
        setToMode('custom');
        setToExisting('');
        setToCustom('');
        setError('');
        setLoading(false);
    };

    const close = () => {
        reset();
        props.onClose();
    };

    const toValue = () => toMode() === 'existing' ? toExisting() : toCustom().trim();

    const valid = () => {
        const f = from();
        const t = toValue();
        return f && t && f !== t;
    };

    const submit = async () => {
        if (!valid()) return;
        setLoading(true);
        setError('');
        try {
            await props.onTransfer(from(), toValue());
            close();
        } catch (e: any) {
            setError(e.message || 'Transfer failed');
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-sky-500/50';

    return (
        <Overlay open={props.open} onClose={close}>
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg p-6 w-[420px] mx-4 shadow-xl">
                <h3 class="text-sm font-semibold text-neutral-200 mb-4 flex items-center gap-2">
                    <Icon name="transfer" size={14} class="text-sky-400" />
                    Transfer Project
                </h3>

                {/* Source */}
                <label class="text-xs text-neutral-500 mb-1 block">Source project (old path)</label>
                <select class={inputClass} value={from()} onChange={(e) => setFrom(e.currentTarget.value)}>
                    <option value="">Select a project...</option>
                    <For each={props.projects.filter(p => p.path !== '_global')}>
                        {(p) => <option value={p.path}>{shortPath(p.path)} ({p.memory_count}m / {p.observation_count}o)</option>}
                    </For>
                </select>

                {/* Target */}
                <label class="text-xs text-neutral-500 mb-1 mt-4 block">Target project (new path)</label>
                <div class="flex gap-2 mb-2">
                    <button
                        class={`text-xs px-2 py-1 rounded ${toMode() === 'custom' ? 'bg-sky-500/20 text-sky-300' : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'}`}
                        onClick={() => setToMode('custom')}
                    >
                        New path
                    </button>
                    <button
                        class={`text-xs px-2 py-1 rounded ${toMode() === 'existing' ? 'bg-sky-500/20 text-sky-300' : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'}`}
                        onClick={() => setToMode('existing')}
                    >
                        Existing project
                    </button>
                </div>

                {toMode() === 'custom' ? (
                    <input
                        type="text"
                        class={inputClass}
                        placeholder="/Users/you/projects/new-name"
                        value={toCustom()}
                        onInput={(e) => setToCustom(e.currentTarget.value)}
                    />
                ) : (
                    <select class={inputClass} value={toExisting()} onChange={(e) => setToExisting(e.currentTarget.value)}>
                        <option value="">Select a project...</option>
                        <For each={props.projects.filter(p => p.path !== '_global' && p.path !== from())}>
                            {(p) => <option value={p.path}>{shortPath(p.path)} ({p.memory_count}m / {p.observation_count}o)</option>}
                        </For>
                    </select>
                )}

                {error() && <p class="text-xs text-red-400 mt-2">{error()}</p>}

                <p class="text-[11px] text-neutral-600 mt-3">
                    {toMode() === 'custom'
                        ? 'The source project will be renamed to the new path.'
                        : 'All memories and observations will be merged into the target project.'}
                </p>

                {/* Actions */}
                <div class="flex justify-end gap-3 mt-4">
                    <button
                        class="text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                        onClick={close}
                    >
                        Cancel
                    </button>
                    <button
                        class="text-sm px-3 py-1.5 rounded bg-sky-500/10 text-sky-400/80 hover:bg-sky-500/20 hover:text-sky-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={!valid() || loading()}
                        onClick={submit}
                    >
                        {loading() ? 'Transferring...' : 'Transfer'}
                    </button>
                </div>
            </div>
        </Overlay>
    );
};

export default TransferModal;
