import { type Component, createSignal, createEffect, For, Show } from 'solid-js';
import Overlay from './Overlay';

type TaxonomyItem = { name: string; description: string; icon: string; count: number };

const FA_ICONS = [
    'fa-bookmark', 'fa-brain', 'fa-bug', 'fa-bullseye', 'fa-chart-line', 'fa-chart-pie',
    'fa-circle-check', 'fa-circle-info', 'fa-circle-nodes', 'fa-clipboard', 'fa-clock',
    'fa-cloud', 'fa-code', 'fa-code-branch', 'fa-cog', 'fa-compass', 'fa-cubes',
    'fa-database', 'fa-display', 'fa-download', 'fa-envelope', 'fa-eye', 'fa-file',
    'fa-file-code', 'fa-file-lines', 'fa-filter', 'fa-fire', 'fa-flag', 'fa-flask',
    'fa-folder', 'fa-folder-open', 'fa-gauge-high', 'fa-gavel', 'fa-gear', 'fa-globe',
    'fa-graduation-cap', 'fa-hammer', 'fa-handshake', 'fa-hard-drive', 'fa-hashtag',
    'fa-heart', 'fa-house', 'fa-image', 'fa-inbox', 'fa-industry', 'fa-key',
    'fa-keyboard', 'fa-layer-group', 'fa-leaf', 'fa-lightbulb', 'fa-link', 'fa-list',
    'fa-lock', 'fa-magnifying-glass', 'fa-map', 'fa-memory', 'fa-message',
    'fa-microchip', 'fa-mobile', 'fa-moon', 'fa-network-wired', 'fa-paintbrush',
    'fa-palette', 'fa-paperclip', 'fa-pen', 'fa-people-group', 'fa-plug',
    'fa-puzzle-piece', 'fa-receipt', 'fa-repeat', 'fa-robot', 'fa-rocket',
    'fa-ruler', 'fa-scale-balanced', 'fa-screwdriver-wrench', 'fa-server',
    'fa-shield-halved', 'fa-sitemap', 'fa-sliders', 'fa-star', 'fa-sun',
    'fa-table', 'fa-tag', 'fa-tags', 'fa-terminal', 'fa-thumbs-up', 'fa-toolbox',
    'fa-trash', 'fa-tree', 'fa-trophy', 'fa-truck', 'fa-universal-access',
    'fa-unlock', 'fa-upload', 'fa-user', 'fa-user-shield', 'fa-users', 'fa-vial',
    'fa-wand-magic-sparkles', 'fa-warning', 'fa-wifi', 'fa-wrench', 'fa-xmark',
];

const IconPicker: Component<{ value: string; onChange: (icon: string) => void }> = (props) => {
    const [search, setSearch] = createSignal('');
    const filtered = () => {
        const q = search().toLowerCase();
        return q ? FA_ICONS.filter(i => i.includes(q)) : FA_ICONS;
    };

    return (
        <div class="space-y-2">
            <input
                type="text"
                placeholder="Search icons..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="w-full px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-sky-500 focus:outline-none"
            />
            <div class="grid grid-cols-10 gap-1 max-h-[160px] overflow-y-auto p-1 rounded bg-neutral-800 border border-neutral-700">
                <For each={filtered()}>
                    {(icon) => (
                        <button
                            type="button"
                            onClick={() => props.onChange(icon)}
                            class={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
                                props.value === icon
                                    ? 'bg-sky-600 text-white'
                                    : 'hover:bg-neutral-700 text-neutral-400'
                            }`}
                            title={icon}
                        >
                            <i class={`fa-solid ${icon}`} />
                        </button>
                    )}
                </For>
            </div>
        </div>
    );
};

const TaxonomyForm: Component<{
    mode: 'create' | 'edit';
    type: 'domain' | 'category';
    initial?: { name: string; description: string; icon: string };
    onSave: (data: { name: string; description: string; icon: string }) => void;
    onCancel: () => void;
}> = (props) => {
    const [name, setName] = createSignal(props.initial?.name || '');
    const [description, setDescription] = createSignal(props.initial?.description || '');
    const [icon, setIcon] = createSignal(props.initial?.icon || (props.type === 'domain' ? 'fa-folder' : 'fa-bookmark'));

    const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (!name().trim() || !description().trim()) return;
        props.onSave({ name: name().trim(), description: description().trim(), icon: icon() });
    };

    return (
        <form onSubmit={handleSubmit} class="space-y-3">
            <div>
                <label class="block text-xs font-medium text-neutral-300 mb-1">Name</label>
                <input
                    type="text"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                    disabled={props.mode === 'edit'}
                    placeholder={`e.g. ${props.type === 'domain' ? 'ml' : 'bug'}`}
                    class="w-full px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-sky-500 focus:outline-none disabled:opacity-50"
                />
            </div>
            <div>
                <label class="block text-xs font-medium text-neutral-300 mb-1">Description</label>
                <input
                    type="text"
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                    placeholder="Short description of this item"
                    class="w-full px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-sky-500 focus:outline-none"
                />
            </div>
            <div>
                <label class="block text-xs font-medium text-neutral-300 mb-1">Icon</label>
                <IconPicker value={icon()} onChange={setIcon} />
            </div>
            <div class="flex justify-end gap-2 pt-2">
                <button
                    type="button"
                    onClick={props.onCancel}
                    class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    class="px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors"
                >
                    {props.mode === 'create' ? 'Create' : 'Update'}
                </button>
            </div>
        </form>
    );
};

const TaxonomySection: Component<{
    type: 'domain' | 'category';
    items: TaxonomyItem[];
    onRefresh: () => void;
    showToast: (msg: string) => void;
}> = (props) => {
    const [formMode, setFormMode] = createSignal<'none' | 'create' | 'edit'>('none');
    const [editTarget, setEditTarget] = createSignal<TaxonomyItem | null>(null);

    const handleCreate = async (data: { name: string; description: string; icon: string }) => {
        const endpoint = props.type === 'domain' ? '/api/domains' : '/api/categories';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res.ok) {
            props.showToast(`${props.type} "${data.name}" created`);
            setFormMode('none');
            props.onRefresh();
        } else {
            const err = await res.json();
            props.showToast(err.error || 'Failed to create');
        }
    };

    const handleUpdate = async (data: { name: string; description: string; icon: string }) => {
        const endpoint = props.type === 'domain' ? `/api/domains/${data.name}` : `/api/categories/${data.name}`;
        const res = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: data.description, icon: data.icon }),
        });
        if (res.ok) {
            props.showToast(`${props.type} "${data.name}" updated`);
            setFormMode('none');
            setEditTarget(null);
            props.onRefresh();
        } else {
            props.showToast('Failed to update');
        }
    };

    const handleDelete = async (name: string) => {
        const endpoint = props.type === 'domain' ? `/api/domains/${name}` : `/api/categories/${name}`;
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (res.ok) {
            props.showToast(`${props.type} "${name}" deleted`);
            props.onRefresh();
        } else {
            const err = await res.json();
            props.showToast(err.error || 'Cannot delete');
        }
    };

    return (
        <div class="rounded-lg border border-neutral-700/30 bg-neutral-800/30 overflow-hidden">
            <div class="px-3.5 py-2.5 border-b border-neutral-700/30 flex items-center justify-between">
                <h3 class="text-[11px] font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                    <i class={`fa-solid ${props.type === 'domain' ? 'fa-layer-group' : 'fa-tags'}`} style="font-size: 12px" />
                    {props.type === 'domain' ? 'Domains' : 'Categories'}
                </h3>
                <button
                    onClick={() => { setFormMode('create'); setEditTarget(null); }}
                    class="px-2 py-1 text-[10px] rounded bg-sky-600/20 hover:bg-sky-600/40 text-sky-400 transition-colors flex items-center gap-1"
                >
                    <i class="fa-solid fa-plus" style="font-size: 10px" /> Add
                </button>
            </div>

            <Show when={formMode() === 'create'}>
                <div class="p-3.5 border-b border-neutral-700/30 bg-neutral-900/50">
                    <TaxonomyForm
                        mode="create"
                        type={props.type}
                        onSave={handleCreate}
                        onCancel={() => setFormMode('none')}
                    />
                </div>
            </Show>

            <div class="divide-y divide-neutral-700/20">
                <For each={props.items}>
                    {(item) => (
                        <div>
                            <Show when={formMode() === 'edit' && editTarget()?.name === item.name} fallback={
                                <div class="flex items-center gap-3 px-3.5 py-2 group hover:bg-neutral-800/50">
                                    <i class={`fa-solid ${item.icon}`} style="font-size: 14px; width: 20px; text-align: center" class:text-sky-400={true} />
                                    <div class="flex-1 min-w-0">
                                        <div class="text-xs font-medium text-neutral-200">{item.name}</div>
                                        <div class="text-[10px] text-neutral-500 truncate">{item.description}</div>
                                    </div>
                                    <span class="text-[10px] text-neutral-500 tabular-nums w-8 text-right">{item.count}</span>
                                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => { setFormMode('edit'); setEditTarget(item); }}
                                            class="p-1 rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-300"
                                            title="Edit"
                                        >
                                            <i class="fa-solid fa-pen" style="font-size: 10px" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(item.name)}
                                            disabled={item.count > 0}
                                            class="p-1 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                                            title={item.count > 0 ? `Cannot delete: ${item.count} memories use this` : 'Delete'}
                                        >
                                            <i class="fa-solid fa-trash" style="font-size: 10px" />
                                        </button>
                                    </div>
                                </div>
                            }>
                                <div class="p-3.5 bg-neutral-900/50">
                                    <TaxonomyForm
                                        mode="edit"
                                        type={props.type}
                                        initial={item}
                                        onSave={handleUpdate}
                                        onCancel={() => { setFormMode('none'); setEditTarget(null); }}
                                    />
                                </div>
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
};

const Taxonomy: Component<{
    open: boolean;
    onClose: () => void;
    showToast: (msg: string) => void;
}> = (props) => {
    const [domains, setDomains] = createSignal<TaxonomyItem[]>([]);
    const [categories, setCategories] = createSignal<TaxonomyItem[]>([]);

    const refresh = async () => {
        try {
            const [d, c] = await Promise.all([
                fetch('/api/domains').then(r => r.json()),
                fetch('/api/categories').then(r => r.json()),
            ]);
            setDomains(d);
            setCategories(c);
        } catch {
            props.showToast('Failed to load taxonomy data');
        }
    };

    createEffect(() => {
        if (props.open) refresh();
    });

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div
                class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div class="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
                    <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <i class="fa-solid fa-tags text-sky-400" style="font-size: 14px" />
                        Taxonomy
                    </h2>
                    <button
                        onClick={props.onClose}
                        class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800"
                    >
                        <i class="fa-solid fa-xmark" style="font-size: 14px" />
                    </button>
                </div>

                {/* Body */}
                <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    <TaxonomySection
                        type="domain"
                        items={domains()}
                        onRefresh={refresh}
                        showToast={props.showToast}
                    />
                    <TaxonomySection
                        type="category"
                        items={categories()}
                        onRefresh={refresh}
                        showToast={props.showToast}
                    />
                </div>

                {/* Footer */}
                <div class="flex items-center justify-end px-5 py-3 border-t border-neutral-700">
                    <button
                        onClick={props.onClose}
                        class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </Overlay>
    );
};

export default Taxonomy;
