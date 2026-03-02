import { For, createMemo, createEffect, type Component } from 'solid-js';
import type { Project } from '../App';

export const ProjectSelector: Component<{
    projects: Project[];
    selected: string;
    onChange: (path: string) => void;
}> = (props) => {
    let selectRef!: HTMLSelectElement;

    const dupeNames = createMemo(() => {
        const counts: Record<string, number> = {};
        for (const p of props.projects) counts[p.name] = (counts[p.name] || 0) + 1;
        const dupes: Record<string, true> = {};
        for (const name in counts) if (counts[name] > 1) dupes[name] = true;
        return dupes;
    });

    const label = (p: Project) => {
        const suffix = dupeNames()[p.name] ? ` (#${p.id})` : '';
        return `${p.name}${suffix} (${p.memory_count}m / ${p.observation_count}o)`;
    };

    // Sync the DOM select value when projects load asynchronously
    createEffect(() => {
        const _ = props.projects; // track projects changes
        const val = props.selected;
        if (selectRef) selectRef.value = val;
    });

    return (
        <div class="flex items-center gap-3">
            <label class="text-sm text-neutral-500">Project:</label>
            <select
                ref={selectRef}
                class="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-neutral-600"
                value={props.selected}
                onChange={(e) => props.onChange(e.currentTarget.value)}
            >
                <option value="">All projects</option>
                <For each={props.projects}>
                    {(p) => <option value={p.path}>{label(p)}</option>}
                </For>
            </select>
        </div>
    );
};
