import { createSignal, createMemo, createEffect, For, Show, onCleanup, type Component } from 'solid-js';
import type { Project } from '../App';
import { shortPath } from '../App';
import Icon from './Icon';

export const ProjectSelector: Component<{
    projects: Project[];
    selected: string;
    onChange: (path: string) => void;
    onDeleteProject?: () => void;
    stats?: { memories: number; observations: number };
    onInputMount?: (el: HTMLInputElement) => void;
}> = (props) => {
    const [query, setQuery] = createSignal('');
    const [open, setOpen] = createSignal(false);
    const [highlightIndex, setHighlightIndex] = createSignal(0);
    let inputRef!: HTMLInputElement;
    let containerRef!: HTMLDivElement;

    const selectedProject = createMemo(() =>
        props.projects.find(p => p.path === props.selected)
    );

    const displayName = createMemo(() => {
        if (!props.selected) return 'All projects';
        const proj = selectedProject();
        return proj ? proj.name : shortPath(props.selected);
    });

    const filtered = createMemo(() => {
        const q = query().toLowerCase();
        if (!q) return props.projects;
        return props.projects.filter(p =>
            p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
        );
    });

    // Reset highlight when filtered list changes
    createEffect(() => {
        filtered();
        setHighlightIndex(0);
    });

    const select = (path: string) => {
        props.onChange(path);
        setQuery('');
        setOpen(false);
        inputRef?.blur();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (!open()) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setOpen(true);
                e.preventDefault();
            }
            return;
        }

        const items = filtered();
        // +1 for "All projects" option at index 0
        const total = items.length + 1;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightIndex(i => (i + 1) % total);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightIndex(i => (i - 1 + total) % total);
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightIndex() === 0) {
                    select('');
                } else {
                    const proj = items[highlightIndex() - 1];
                    if (proj) select(proj.path);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setQuery('');
                setOpen(false);
                inputRef?.blur();
                break;
        }
    };

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            setQuery('');
            setOpen(false);
        }
    };

    createEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
    });

    return (
        <div ref={containerRef} class="relative">
            <div class="relative">
                <i class="fa-solid fa-folder-open absolute left-2.5 top-1/2 -translate-y-1/2 text-[#d77757]" style="font-size: 11px"></i>
                <input
                    ref={(el) => { inputRef = el; props.onInputMount?.(el); }}
                    type="text"
                    class="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 pl-7 pr-16 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                    placeholder={displayName()}
                    value={open() ? query() : ''}
                    onFocus={() => {
                        setOpen(true);
                        setQuery('');
                    }}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                />
                <span class="kbd kbd-input">&#8984;&#8679;P</span>
            </div>

            {/* Stats line */}
            <div class="flex gap-2.5 mt-1 px-1">
                <span class="text-[9px] text-[#d77757]/50 flex items-center gap-1">
                    <Icon name="brain" size={9} />
                    {props.stats?.memories ?? 0} memories
                </span>
                <span class="text-[9px] text-purple-300/50 flex items-center gap-1">
                    <Icon name="eye" size={9} />
                    {props.stats?.observations ?? 0} observations
                </span>
            </div>

            {/* Dropdown */}
            <Show when={open()}>
                <div class="absolute z-50 top-[calc(100%-14px)] left-0 w-full bg-neutral-900 border border-neutral-700 rounded shadow-lg max-h-64 overflow-y-auto">
                    {/* All projects option */}
                    <button
                        class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                            highlightIndex() === 0 ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                        }`}
                        onMouseEnter={() => setHighlightIndex(0)}
                        onClick={() => select('')}
                    >
                        <i class="fa-solid fa-layer-group" style="font-size: 11px"></i>
                        <span>All projects</span>
                    </button>

                    <For each={filtered()}>
                        {(proj, idx) => (
                            <div
                                class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors group/item ${
                                    highlightIndex() === idx() + 1 ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                }`}
                                onMouseEnter={() => setHighlightIndex(idx() + 1)}
                            >
                                <button
                                    class="flex items-center gap-2 flex-1 min-w-0"
                                    onClick={() => select(proj.path)}
                                >
                                    <i class={`fa-solid ${proj.path === '_global' ? 'fa-globe' : (proj.icon || 'fa-folder-open')} text-[#d77757] shrink-0`} style="font-size: 11px"></i>
                                    <span class="truncate">{proj.name}</span>
                                    <span class="text-[10px] text-neutral-600 shrink-0">
                                        {proj.memory_count}m / {proj.observation_count}o
                                    </span>
                                </button>
                                <Show when={proj.path !== '_global'}>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            props.onChange(proj.path);
                                            props.onDeleteProject?.();
                                            setOpen(false);
                                        }}
                                        class="p-0.5 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0"
                                        title="Delete project"
                                    >
                                        <i class="fa-solid fa-trash" style="font-size: 9px"></i>
                                    </button>
                                </Show>
                            </div>
                        )}
                    </For>

                    <Show when={filtered().length === 0 && query()}>
                        <div class="px-3 py-2 text-xs text-neutral-500">No matching projects</div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};
