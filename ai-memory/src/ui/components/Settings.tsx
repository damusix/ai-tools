import { type Component, createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';
import { ConfirmModal } from './Modal';
import FA_CATEGORIES from '../fa-icons-data';

// ── Types ──────────────────────────────────────────────────────────────

type TaxonomyItem = { name: string; description: string; icon: string; count: number };

type FieldDef = { key: string; label: string; fallback: number; desc: string };
type Section = { icon: string; label: string; fields: FieldDef[] };

// ── Configuration sections ─────────────────────────────────────────────

const sections: Section[] = [
    {
        icon: 'wrench', label: 'Worker', fields: [
            { key: 'pollIntervalMs', label: 'Poll Interval', fallback: 5000, desc: 'ms between queue checks' },
            { key: 'observationSynthesisThreshold', label: 'Synthesis Threshold', fallback: 10, desc: 'observations before synthesis triggers' },
            { key: 'synthesisTimeoutMs', label: 'Synthesis Timeout', fallback: 1800000, desc: 'ms before stale observations trigger synthesis (0 = disabled)' },
            { key: 'observationRetentionDays', label: 'Retention Days', fallback: 14, desc: 'days to keep processed observations' },
            { key: 'observationSkipLimit', label: 'Skip Limit', fallback: 3, desc: 'skips before observation is deleted' },
            { key: 'backfillStartupDelayMs', label: 'Backfill Delay', fallback: 10000, desc: 'ms before backfill starts' },
            { key: 'maxBackfillIterations', label: 'Max Backfill Iterations', fallback: 20, desc: 'max backfill cycles on startup' },
            { key: 'backfillBatchSize', label: 'Backfill Batch Size', fallback: 50, desc: 'memories per backfill batch' },
            { key: 'synthesisMemoriesLimit', label: 'Synthesis Memories Limit', fallback: 100, desc: 'existing memories passed to synthesis' },
            { key: 'synthesisTopSlice', label: 'Synthesis Top Slice', fallback: 20, desc: 'top memories in synthesis prompt' },
            { key: 'cleanupObservationsLimit', label: 'Cleanup Observations Limit', fallback: 200, desc: 'observations sent to cleanup LLM' },
            { key: 'cleanupMemoriesLimit', label: 'Cleanup Memories Limit', fallback: 100, desc: 'memories sent to cleanup LLM' },
            { key: 'extractionPayloadMaxChars', label: 'Extraction Max Chars', fallback: 8000, desc: 'max chars per turn for extraction' },
        ],
    },
    {
        icon: 'brain', label: 'Context', fields: [
            { key: 'memoryTokenBudget', label: 'Memory Token Budget', fallback: 1000, desc: 'tokens for memories at startup' },
            { key: 'tagsTokenBudget', label: 'Tags Token Budget', fallback: 200, desc: 'tokens for tags at startup' },
        ],
    },
    {
        icon: 'server', label: 'Server', fields: [
            { key: 'port', label: 'Port', fallback: 24636, desc: 'server listen port' },
            { key: 'restartDelayMs', label: 'Restart Delay', fallback: 200, desc: 'ms delay before restart' },
        ],
    },
    {
        icon: 'globe', label: 'API', fields: [
            { key: 'defaultLimit', label: 'Default Limit', fallback: 50, desc: 'default pagination limit' },
            { key: 'logsDefaultLines', label: 'Logs Default Lines', fallback: 500, desc: 'default log lines returned' },
        ],
    },
];

// ── Icon helpers ───────────────────────────────────────────────────────

const toFaClass = (name: string) => name.startsWith('fa-') ? name : `fa-${name}`;
const fromFaClass = (cls: string) => cls.startsWith('fa-') ? cls.slice(3) : cls;

const MAX_GRID_ICONS = 200;

// ── IconPicker ─────────────────────────────────────────────────────────

const IconPicker: Component<{ value: string; onChange: (icon: string) => void }> = (props) => {
    const [open, setOpen] = createSignal(false);
    const [search, setSearch] = createSignal('');
    const [activeCategory, setActiveCategory] = createSignal<string | null>(null);
    let containerRef: HTMLDivElement | undefined;

    createEffect(() => {
        if (!open()) return;
        const handler = (e: MouseEvent) => {
            if (containerRef && !containerRef.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        onCleanup(() => document.removeEventListener('mousedown', handler));
    });

    const visibleIcons = createMemo(() => {
        const q = search().toLowerCase();
        const cat = activeCategory();

        if (q) {
            const seen: Record<string, true> = {};
            const results: string[] = [];
            for (const c of FA_CATEGORIES) {
                for (const icon of c.icons) {
                    if (icon.includes(q) && !seen[icon]) {
                        seen[icon] = true;
                        results.push(icon);
                        if (results.length >= MAX_GRID_ICONS) return results;
                    }
                }
            }
            return results;
        }

        if (cat) {
            const found = FA_CATEGORIES.find(c => c.key === cat);
            return found ? found.icons.slice(0, MAX_GRID_ICONS) : [];
        }

        return FA_CATEGORIES[0]?.icons.slice(0, MAX_GRID_ICONS) || [];
    });

    const handleSelect = (iconName: string) => {
        props.onChange(toFaClass(iconName));
        setOpen(false);
        setSearch('');
    };

    const currentRaw = () => fromFaClass(props.value);

    return (
        <div class="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen(!open())}
                class="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 hover:border-neutral-600 transition-colors w-full"
            >
                <i class={`fa-solid ${props.value}`} style="font-size: 14px" />
                <span class="flex-1 text-left text-neutral-400 truncate">{props.value}</span>
                <i class={`fa-solid fa-chevron-${open() ? 'up' : 'down'}`} style="font-size: 10px; color: #666" />
            </button>

            <Show when={open()}>
                <div class="absolute z-50 left-0 right-0 mt-1 rounded-lg bg-neutral-900 border border-neutral-700 shadow-xl overflow-hidden" style="width: 460px">
                    <div class="p-2 border-b border-neutral-700/50">
                        <div class="relative">
                            <i class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" style="font-size: 10px" />
                            <input
                                type="text"
                                placeholder="Search all icons..."
                                value={search()}
                                onInput={(e) => { setSearch(e.currentTarget.value); if (e.currentTarget.value) setActiveCategory(null); }}
                                class="w-full pl-7 pr-2 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-sky-500 focus:outline-none"
                                autofocus
                            />
                        </div>
                    </div>

                    <div class="flex" style="height: 280px">
                        <Show when={!search()}>
                            <div class="w-[140px] border-r border-neutral-700/50 overflow-y-auto shrink-0">
                                <For each={FA_CATEGORIES}>
                                    {(cat) => (
                                        <button
                                            type="button"
                                            onClick={() => setActiveCategory(cat.key)}
                                            class={`w-full text-left px-2.5 py-1.5 text-[10px] transition-colors truncate ${
                                                (activeCategory() || FA_CATEGORIES[0]?.key) === cat.key
                                                    ? 'bg-sky-600/20 text-sky-400 font-medium'
                                                    : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300'
                                            }`}
                                        >
                                            {cat.label}
                                            <span class="text-neutral-600 ml-1">{cat.icons.length}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>

                        <div class="flex-1 overflow-y-auto p-2">
                            <div class="grid grid-cols-8 gap-1">
                                <For each={visibleIcons()}>
                                    {(iconName) => (
                                        <button
                                            type="button"
                                            onClick={() => handleSelect(iconName)}
                                            class={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                                                currentRaw() === iconName
                                                    ? 'bg-sky-600 text-white'
                                                    : 'hover:bg-neutral-700 text-neutral-400'
                                            }`}
                                            title={iconName}
                                        >
                                            <i class={`fa-solid fa-${iconName}`} style="font-size: 14px" />
                                        </button>
                                    )}
                                </For>
                            </div>
                            <Show when={visibleIcons().length === 0}>
                                <div class="text-[10px] text-neutral-500 text-center py-6">No icons match "{search()}"</div>
                            </Show>
                            <Show when={visibleIcons().length >= MAX_GRID_ICONS}>
                                <div class="text-[10px] text-neutral-500 text-center py-2">Showing first {MAX_GRID_ICONS} — refine your search</div>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

// ── TaxonomyForm ───────────────────────────────────────────────────────

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

// ── TaxonomySection ────────────────────────────────────────────────────

const TaxonomySection: Component<{
    type: 'domain' | 'category';
    items: TaxonomyItem[];
    onRefresh: () => void;
    showToast: (msg: string) => void;
}> = (props) => {
    const [formMode, setFormMode] = createSignal<'none' | 'create' | 'edit'>('none');
    const [editTarget, setEditTarget] = createSignal<TaxonomyItem | null>(null);
    const [deleteTarget, setDeleteTarget] = createSignal<TaxonomyItem | null>(null);

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
        const endpoint = props.type === 'domain' ? `/api/domains/${encodeURIComponent(data.name)}` : `/api/categories/${encodeURIComponent(data.name)}`;
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

    const handleDelete = (item: TaxonomyItem) => {
        setDeleteTarget(item);
    };

    const confirmDelete = async () => {
        const item = deleteTarget();
        if (!item) return;
        const hasMemories = item.count > 0;
        const endpoint = props.type === 'domain'
            ? `/api/domains/${encodeURIComponent(item.name)}${hasMemories ? '/force' : ''}`
            : `/api/categories/${encodeURIComponent(item.name)}${hasMemories ? '/force' : ''}`;
        try {
            const res = await fetch(endpoint, { method: 'DELETE' });
            if (res.ok) {
                if (hasMemories) {
                    const data = await res.json();
                    props.showToast(`Deleted ${props.type} "${item.name}" (${data.memoriesDeleted} memories removed)`);
                } else {
                    props.showToast(`${props.type} "${item.name}" deleted`);
                }
                props.onRefresh();
            } else {
                const err = await res.json();
                props.showToast(err.error || 'Delete failed');
            }
        } catch {
            props.showToast('Delete failed');
        }
        setDeleteTarget(null);
    };

    return (
        <>
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
                                                onClick={() => handleDelete(item)}
                                                class="p-1 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400"
                                                title={item.count > 0 ? `Delete (will remove ${item.count} memories)` : 'Delete'}
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

            <ConfirmModal
                open={!!deleteTarget()}
                title={`Delete ${props.type}`}
                message={
                    (deleteTarget()?.count || 0) > 0
                        ? `Delete ${props.type} "${deleteTarget()?.name}"? This will permanently remove ${deleteTarget()?.count} memories that use this ${props.type}.`
                        : `Delete ${props.type} "${deleteTarget()?.name}"?`
                }
                confirmLabel={(deleteTarget()?.count || 0) > 0 ? 'Force Delete' : 'Delete'}
                confirmClass={(deleteTarget()?.count || 0) > 0
                    ? 'text-sm px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300'
                    : undefined
                }
                onConfirm={confirmDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </>
    );
};

// ── AI Generation Panel ────────────────────────────────────────────────

const AiGeneratePanel: Component<{
    type: 'domain' | 'category';
    prompt: string;
    setPrompt: (v: string) => void;
    loading: boolean;
    results: { name: string; description: string; icon: string }[];
    onGenerate: () => void;
    onApprove: (item: { name: string; description: string; icon: string }) => void;
    onReject: (item: { name: string; description: string; icon: string }) => void;
    onClose: () => void;
}> = (props) => {
    return (
        <div class="mb-4 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3.5">
            <div class="flex items-center justify-between mb-2">
                <h4 class="text-xs font-medium text-purple-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 12px" />
                    Generate {props.type === 'domain' ? 'Domains' : 'Categories'} with AI
                </h4>
                <button
                    onClick={props.onClose}
                    class="text-neutral-500 hover:text-neutral-300 p-0.5 rounded hover:bg-neutral-800"
                >
                    <i class="fa-solid fa-xmark" style="font-size: 10px" />
                </button>
            </div>

            <Show when={props.results.length === 0}>
                <p class="text-[11px] text-purple-300/60 mb-2">
                    Describe your project or use case and AI will suggest {props.type === 'domain' ? 'domains' : 'categories'} tailored to it. You can approve or reject each suggestion.
                </p>
                <div class="flex gap-2">
                    <textarea
                        value={props.prompt}
                        onInput={(e) => props.setPrompt(e.currentTarget.value)}
                        placeholder={`Describe your project or what ${props.type === 'domain' ? 'domains' : 'categories'} you need...`}
                        rows={2}
                        class="flex-1 px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-purple-500 focus:outline-none resize-none"
                    />
                    <div class="flex flex-col gap-1">
                        <button
                            onClick={props.onGenerate}
                            disabled={props.loading || !props.prompt.trim()}
                            class="px-3 py-1.5 text-xs rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
                        >
                            <Show when={props.loading} fallback={<i class="fa-solid fa-bolt" style="font-size: 10px" />}>
                                <i class="fa-solid fa-spinner fa-spin" style="font-size: 10px" />
                            </Show>
                            {props.loading ? 'Generating...' : 'Generate'}
                        </button>
                        <button
                            onClick={props.onClose}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </Show>

            <Show when={props.results.length > 0}>
                <div class="space-y-1.5">
                    <For each={props.results}>
                        {(item) => (
                            <div class="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800/60 border border-neutral-700/30">
                                <i class={`fa-solid ${item.icon}`} style="font-size: 14px" class:text-purple-400={true} />
                                <div class="flex-1 min-w-0">
                                    <div class="text-xs font-medium text-neutral-200">{item.name}</div>
                                    <div class="text-[10px] text-neutral-500 truncate">{item.description}</div>
                                </div>
                                <button
                                    onClick={() => props.onApprove(item)}
                                    class="p-1 rounded hover:bg-green-900/40 text-green-500/60 hover:text-green-400"
                                    title="Approve and create"
                                >
                                    <i class="fa-solid fa-check" style="font-size: 10px" />
                                </button>
                                <button
                                    onClick={() => props.onReject(item)}
                                    class="p-1 rounded hover:bg-red-900/40 text-red-500/60 hover:text-red-400"
                                    title="Reject"
                                >
                                    <i class="fa-solid fa-xmark" style="font-size: 10px" />
                                </button>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};

// ── Settings (unified modal) ───────────────────────────────────────────

const Settings: Component<{
    open: boolean;
    onClose: () => void;
    showToast: (msg: string) => void;
    onHelp?: () => void;
}> = (props) => {
    const [tab, setTab] = createSignal<'config' | 'domains' | 'categories'>('config');
    const [config, setConfig] = createSignal<Record<string, number>>({});
    const [saving, setSaving] = createSignal(false);
    const [domains, setDomains] = createSignal<TaxonomyItem[]>([]);
    const [categories, setCategories] = createSignal<TaxonomyItem[]>([]);

    const [restoreConfirm, setRestoreConfirm] = createSignal<'config' | 'domains' | 'categories' | null>(null);

    // AI generation state
    const [aiPromptMode, setAiPromptMode] = createSignal<'domain' | 'category' | null>(null);
    const [aiPrompt, setAiPrompt] = createSignal('');
    const [aiLoading, setAiLoading] = createSignal(false);
    const [aiResults, setAiResults] = createSignal<{ name: string; description: string; icon: string }[]>([]);

    const refreshTaxonomy = async () => {
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
        if (!props.open) return;
        fetch('/api/config')
            .then(r => r.json())
            .then(data => setConfig(data))
            .catch(() => props.showToast('Failed to load config'));
        refreshTaxonomy();
    });

    const updateField = (key: string, value: number) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config()),
            });
        } catch {
            setSaving(false);
            props.showToast('Failed to save config');
            return;
        }

        const start = Date.now();
        const poll = () => {
            if (Date.now() - start > 10000) {
                setSaving(false);
                props.showToast('Restart timed out');
                return;
            }
            fetch('/health').then(r => {
                if (r.ok) {
                    setSaving(false);
                    props.showToast('Settings saved & server restarted');
                    props.onClose();
                } else {
                    setTimeout(poll, 500);
                }
            }).catch(() => setTimeout(poll, 500));
        };
        setTimeout(poll, 500);
    };

    const handleAiGenerate = async () => {
        const type = aiPromptMode();
        if (!type || !aiPrompt().trim()) return;
        setAiLoading(true);
        try {
            const res = await fetch('/api/taxonomy/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, prompt: aiPrompt() }),
            });
            const data = await res.json();
            if (data.items) setAiResults(data.items);
            else props.showToast(data.error || 'AI generation failed');
        } catch {
            props.showToast('AI generation failed');
        } finally {
            setAiLoading(false);
        }
    };

    const approveAiItem = async (item: { name: string; description: string; icon: string }) => {
        const type = aiPromptMode();
        const endpoint = type === 'domain' ? '/api/domains' : '/api/categories';
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item),
            });
            if (res.ok) {
                props.showToast(`Created ${type} "${item.name}"`);
                setAiResults(prev => prev.filter(i => i.name !== item.name));
                refreshTaxonomy();
            } else {
                const err = await res.json();
                props.showToast(err.error || 'Failed to create');
            }
        } catch {
            props.showToast('Failed to create');
        }
    };

    const rejectAiItem = (item: { name: string; description: string; icon: string }) => {
        setAiResults(prev => prev.filter(i => i.name !== item.name));
    };

    const closeAiPanel = () => {
        setAiPromptMode(null);
        setAiPrompt('');
        setAiResults([]);
    };

    const handleRestoreConfig = () => {
        const defaults: Record<string, number> = {};
        for (const section of sections) {
            for (const field of section.fields) {
                defaults[field.key] = field.fallback;
            }
        }
        setConfig(defaults);
        setRestoreConfirm(null);
        props.showToast('Config reset to defaults — click Save & Restart to apply');
    };

    const handleRestoreTaxonomy = async (type: 'domains' | 'categories') => {
        try {
            const res = await fetch(`/api/${type}/restore-defaults`, { method: 'POST' });
            const data = await res.json();
            props.showToast(data.restored > 0 ? `Restored ${data.restored} default ${type}` : `All default ${type} already present`);
            refreshTaxonomy();
        } catch {
            props.showToast('Restore failed');
        }
        setRestoreConfirm(null);
    };

    const tabs = [
        { id: 'config' as const, label: 'Configuration', icon: 'fa-sliders' },
        { id: 'domains' as const, label: 'Domains', icon: 'fa-layer-group' },
        { id: 'categories' as const, label: 'Categories', icon: 'fa-tags' },
    ];

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div
                class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header with tabs */}
                <div class="px-5 py-4 border-b border-neutral-700">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                            <Icon name="gear" size={14} class="text-sky-400" />
                            Settings
                        </h2>
                        <div class="flex items-center gap-1">
                            <Show when={props.onHelp}>
                                <button
                                    onClick={props.onHelp}
                                    class="text-neutral-500 hover:text-sky-400 p-1 rounded hover:bg-neutral-800 transition-colors"
                                    title="Help"
                                >
                                    <Icon name="info" size={14} />
                                </button>
                            </Show>
                            <button
                                onClick={props.onClose}
                                class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800"
                            >
                                <Icon name="x" size={14} />
                            </button>
                        </div>
                    </div>
                    <div class="flex gap-1">
                        <For each={tabs}>
                            {(t) => (
                                <button
                                    class={`px-3 py-1.5 text-xs rounded-t flex items-center gap-1.5 transition-colors ${
                                        tab() === t.id
                                            ? 'bg-neutral-800 text-sky-400 border border-neutral-700 border-b-transparent -mb-px'
                                            : 'text-neutral-500 hover:text-neutral-300'
                                    }`}
                                    onClick={() => { setTab(t.id); closeAiPanel(); }}
                                >
                                    <i class={`fa-solid ${t.icon}`} style="font-size: 11px"></i>
                                    {t.label}
                                </button>
                            )}
                        </For>
                    </div>
                </div>

                {/* Tab content */}
                <div class="flex-1 overflow-y-auto px-5 py-4">
                    {/* Configuration tab */}
                    <Show when={tab() === 'config'}>
                        <div class="space-y-5">
                            <For each={sections}>
                                {(section) => (
                                    <div class="rounded-lg border border-neutral-700/30 bg-neutral-800/30 overflow-hidden">
                                        <div class="px-3.5 py-2.5 border-b border-neutral-700/30">
                                            <h3 class="text-[11px] font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                                                <Icon name={section.icon} size={12} />
                                                {section.label}
                                            </h3>
                                        </div>
                                        <div class="grid grid-cols-2 gap-3 p-3.5">
                                            <For each={section.fields}>
                                                {(field) => (
                                                    <div>
                                                        <label class="block text-xs font-medium text-neutral-300 mb-1">{field.label}</label>
                                                        <input
                                                            type="number"
                                                            value={config()[field.key] ?? field.fallback}
                                                            onInput={(e) => updateField(field.key, Number(e.currentTarget.value))}
                                                            class="w-full px-2.5 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:border-sky-500 focus:outline-none transition-colors"
                                                        />
                                                        <p class="text-[10px] text-neutral-500 mt-0.5">{field.desc}</p>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>

                    {/* Domains tab */}
                    <Show when={tab() === 'domains'}>
                        <p class="text-xs text-neutral-500 mb-3 leading-relaxed">
                            Domains organize memories by technical area (e.g. frontend, backend, data). When Claude saves a memory, it assigns a domain to help you filter and search later.
                        </p>
                        <div class="flex items-center gap-2 mb-3">
                            <Show when={aiPromptMode() !== 'domain'}>
                                <button
                                    onClick={() => { setAiPromptMode('domain'); setAiResults([]); setAiPrompt(''); }}
                                    class="px-3 py-1.5 text-xs rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1.5"
                                >
                                    <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 12px"></i>
                                    Generate with AI
                                </button>
                            </Show>
                        </div>
                        <Show when={aiPromptMode() === 'domain'}>
                            <AiGeneratePanel
                                type="domain"
                                prompt={aiPrompt()}
                                setPrompt={setAiPrompt}
                                loading={aiLoading()}
                                results={aiResults()}
                                onGenerate={handleAiGenerate}
                                onApprove={approveAiItem}
                                onReject={rejectAiItem}
                                onClose={closeAiPanel}
                            />
                        </Show>
                        <TaxonomySection
                            type="domain"
                            items={domains()}
                            onRefresh={refreshTaxonomy}
                            showToast={props.showToast}
                        />
                    </Show>

                    {/* Categories tab */}
                    <Show when={tab() === 'categories'}>
                        <p class="text-xs text-neutral-500 mb-3 leading-relaxed">
                            Categories classify the type of knowledge stored (e.g. decision, pattern, solution). They help distinguish why something was remembered.
                        </p>
                        <div class="flex items-center gap-2 mb-3">
                            <Show when={aiPromptMode() !== 'category'}>
                                <button
                                    onClick={() => { setAiPromptMode('category'); setAiResults([]); setAiPrompt(''); }}
                                    class="px-3 py-1.5 text-xs rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors flex items-center gap-1.5"
                                >
                                    <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 12px"></i>
                                    Generate with AI
                                </button>
                            </Show>
                        </div>
                        <Show when={aiPromptMode() === 'category'}>
                            <AiGeneratePanel
                                type="category"
                                prompt={aiPrompt()}
                                setPrompt={setAiPrompt}
                                loading={aiLoading()}
                                results={aiResults()}
                                onGenerate={handleAiGenerate}
                                onApprove={approveAiItem}
                                onReject={rejectAiItem}
                                onClose={closeAiPanel}
                            />
                        </Show>
                        <TaxonomySection
                            type="category"
                            items={categories()}
                            onRefresh={refreshTaxonomy}
                            showToast={props.showToast}
                        />
                    </Show>
                </div>

                {/* Footer */}
                <div class="flex items-center justify-between px-5 py-3 border-t border-neutral-700">
                    <div>
                        <button
                            onClick={() => setRestoreConfirm(tab())}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                        >
                            <i class="fa-solid fa-arrow-rotate-left" style="font-size: 11px"></i>
                            Restore Defaults
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <button
                            onClick={props.onClose}
                            class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                        >
                            Cancel
                        </button>
                        <Show when={tab() === 'config'}>
                            <button
                                onClick={handleSave}
                                disabled={saving()}
                                class="px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
                            >
                                <Icon name="rotate-cw" size={12} class={saving() ? 'animate-spin' : ''} />
                                {saving() ? 'Restarting...' : 'Save & Restart'}
                            </button>
                        </Show>
                    </div>
                </div>

                <ConfirmModal
                    open={!!restoreConfirm()}
                    title="Restore Defaults"
                    message={
                        restoreConfirm() === 'config'
                            ? 'Reset all configuration values to their defaults? You will need to Save & Restart to apply.'
                            : `Restore default ${restoreConfirm()}? This will add back any removed defaults but won't overwrite your changes.`
                    }
                    confirmLabel="Restore"
                    onConfirm={() => {
                        const t = restoreConfirm();
                        if (t === 'config') handleRestoreConfig();
                        else if (t === 'domains' || t === 'categories') handleRestoreTaxonomy(t);
                    }}
                    onCancel={() => setRestoreConfirm(null)}
                />
            </div>
        </Overlay>
    );
};

export default Settings;
