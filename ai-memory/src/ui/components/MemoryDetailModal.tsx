import { type Component, createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import { type Memory, shortPath } from '../App';
import Overlay from './Overlay';
import Icon from './Icon';

type TaxonomyItem = { name: string; description: string; icon: string; count: number };

const normalizeTags = (raw: string): string =>
    raw.split(',').map(t => t.trim()).filter(Boolean).join(',');

const fmtDate = (d: string) => d ? new Date(d).toLocaleString() : '';

// ── Dropdown component ──────────────────────────────────────────
const Dropdown: Component<{
    label: string;
    value: string | null;
    items: TaxonomyItem[];
    onChange: (name: string | null) => void;
}> = (props) => {
    const [open, setOpen] = createSignal(false);
    let ref!: HTMLDivElement;

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
        }
    };

    const handleClickOutside = (e: MouseEvent) => {
        if (ref && !ref.contains(e.target as Node)) setOpen(false);
    };

    createEffect(() => {
        if (open()) {
            document.addEventListener('mousedown', handleClickOutside);
            onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
        }
    });

    return (
        <div ref={ref} class="relative" onKeyDown={handleKeydown}>
            <button
                class="w-full text-left px-2 py-1 rounded text-xs bg-neutral-800 border border-neutral-700 hover:border-neutral-600 flex items-center justify-between gap-1"
                onClick={() => setOpen(!open())}
            >
                <span class="truncate">{props.value || 'None'}</span>
                <Icon name={open() ? 'chevron-down' : 'chevron-right'} size={10} class="text-neutral-500 shrink-0" />
            </button>
            <Show when={open()}>
                <div class="absolute z-10 left-0 right-0 mt-1 bg-neutral-800 border border-neutral-700 rounded shadow-lg max-h-48 overflow-y-auto">
                    <Show when={props.label === 'Domain'}>
                        <button
                            class={`w-full text-left px-2 py-1.5 text-xs hover:bg-neutral-700 ${!props.value ? 'text-[#d77757]' : 'text-neutral-300'}`}
                            onClick={() => { props.onChange(null); setOpen(false); }}
                        >
                            None
                        </button>
                    </Show>
                    <For each={props.items}>
                        {(item) => (
                            <button
                                class={`w-full text-left px-2 py-1.5 text-xs hover:bg-neutral-700 flex items-center gap-1.5 ${item.name === props.value ? 'text-[#d77757]' : 'text-neutral-300'}`}
                                onClick={() => { props.onChange(item.name); setOpen(false); }}
                            >
                                <i class={`fa-solid ${item.icon}`} style="font-size: 10px"></i>
                                <span class="truncate">{item.name}</span>
                                <span class="text-neutral-600 ml-auto shrink-0">({item.count})</span>
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};

// ── DirtyDot indicator ──────────────────────────────────────────
const DirtyDot: Component<{ dirty: boolean }> = (props) => (
    <Show when={props.dirty}>
        <i class="fa-solid fa-circle text-red-400 absolute -top-1 -right-1" style="font-size: 7px"></i>
    </Show>
);

// ── Main component ──────────────────────────────────────────────
const MemoryDetailModal: Component<{
    memory: Memory | null;
    domains: TaxonomyItem[];
    categories: TaxonomyItem[];
    open: boolean;
    onClose: () => void;
    onUpdate: (id: number, fields: {
        content: string; tags: string; category: string; importance: number; domain: string | null;
    }) => Promise<void>;
    showToast: (msg: string) => void;
}> = (props) => {
    const [content, setContent] = createSignal('');
    const [tags, setTags] = createSignal('');
    const [category, setCategory] = createSignal('');
    const [domain, setDomain] = createSignal<string | null>(null);
    const [importance, setImportance] = createSignal(3);
    const [tagsFocused, setTagsFocused] = createSignal(false);
    const [saving, setSaving] = createSignal(false);

    // Original values for dirty tracking
    const [origContent, setOrigContent] = createSignal('');
    const [origTags, setOrigTags] = createSignal('');
    const [origCategory, setOrigCategory] = createSignal('');
    const [origDomain, setOrigDomain] = createSignal<string | null>(null);
    const [origImportance, setOrigImportance] = createSignal(3);

    // Sync from props when memory changes
    createEffect(() => {
        const m = props.memory;
        if (!m) return;
        setContent(m.content);
        setTags(m.tags);
        setCategory(m.category);
        setDomain(m.domain);
        setImportance(m.importance);
        setOrigContent(m.content);
        setOrigTags(m.tags);
        setOrigCategory(m.category);
        setOrigDomain(m.domain);
        setOrigImportance(m.importance);
    });

    const contentDirty = createMemo(() => content() !== origContent());
    const tagsDirty = createMemo(() => normalizeTags(tags()) !== normalizeTags(origTags()));
    const categoryDirty = createMemo(() => category() !== origCategory());
    const domainDirty = createMemo(() => domain() !== origDomain());
    const importanceDirty = createMemo(() => importance() !== origImportance());
    const isDirty = createMemo(() => contentDirty() || tagsDirty() || categoryDirty() || domainDirty() || importanceDirty());

    const handleCancel = () => {
        setContent(origContent());
        setTags(origTags());
        setCategory(origCategory());
        setDomain(origDomain());
        setImportance(origImportance());
        props.onClose();
    };

    const handleUpdate = async () => {
        if (!props.memory || !isDirty()) return;
        setSaving(true);
        try {
            await props.onUpdate(props.memory.id, {
                content: content(),
                tags: normalizeTags(tags()),
                category: category(),
                importance: importance(),
                domain: domain(),
            });
            props.onClose();
        } catch (e: any) {
            props.showToast(e.message || 'Update failed');
        } finally {
            setSaving(false);
        }
    };

    let contentRef!: HTMLDivElement;
    let tagsRef!: HTMLDivElement;

    return (
        <Overlay open={props.open} onClose={handleCancel}>
            <Show when={props.memory}>
                {(mem) => (
                    <div
                        class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Two-column layout */}
                        <div class="flex flex-1 overflow-hidden">
                            {/* Left column: content + tags */}
                            <div class="flex-1 p-5 flex flex-col gap-4 overflow-y-auto">
                                {/* Content */}
                                <div class="relative">
                                    <DirtyDot dirty={contentDirty()} />
                                    <div
                                        ref={(el) => {
                                            contentRef = el;
                                            el.textContent = content();
                                        }}
                                        contentEditable
                                        class="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap border border-dashed border-transparent hover:border-neutral-600 focus:border-[#d77757]/40 rounded p-2 outline-none min-h-[80px] max-h-[300px] overflow-y-auto"
                                        onInput={() => setContent(contentRef.textContent || '')}
                                    />

                                </div>

                                {/* Tags */}
                                <div class="relative">
                                    <DirtyDot dirty={tagsDirty()} />
                                    <div class="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <Icon name="tag" size={10} />
                                        Tags
                                    </div>
                                    <Show when={!tagsFocused()}>
                                        <div
                                            class="flex flex-wrap gap-1.5 border border-dashed border-transparent hover:border-neutral-600 rounded p-1.5 cursor-text min-h-[28px]"
                                            onClick={() => {
                                                setTagsFocused(true);
                                                requestAnimationFrame(() => tagsRef?.focus());
                                            }}
                                        >
                                            <Show when={tags()} fallback={<span class="text-neutral-600 text-xs">click to add tags</span>}>
                                                <For each={tags().split(',').filter(Boolean)}>
                                                    {(tag) => (
                                                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-[#d77757]/10 text-[#d77757]/70 flex items-center gap-0.5">
                                                            <Icon name="tag" size={9} />
                                                            {tag.trim()}
                                                        </span>
                                                    )}
                                                </For>
                                            </Show>
                                        </div>
                                    </Show>
                                    <Show when={tagsFocused()}>
                                        <div
                                            ref={(el) => {
                                                tagsRef = el;
                                                el.textContent = tags();
                                            }}
                                            contentEditable
                                            class="text-xs text-neutral-300 border border-dashed border-[#d77757]/40 rounded p-1.5 outline-none min-h-[28px]"
                                            onInput={() => setTags(tagsRef.textContent || '')}
                                            onBlur={() => setTagsFocused(false)}
                                        />
                                    </Show>
                                </div>
                            </div>

                            {/* Right sidebar */}
                            <div class="w-[185px] border-l border-neutral-700 p-4 flex flex-col gap-4 overflow-y-auto">
                                {/* Category */}
                                <div class="relative">
                                    <DirtyDot dirty={categoryDirty()} />
                                    <div class="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Category</div>
                                    <Dropdown
                                        label="Category"
                                        value={category()}
                                        items={props.categories}
                                        onChange={(v) => { if (v) setCategory(v); }}
                                    />
                                </div>

                                {/* Domain */}
                                <div class="relative">
                                    <DirtyDot dirty={domainDirty()} />
                                    <div class="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Domain</div>
                                    <Dropdown
                                        label="Domain"
                                        value={domain()}
                                        items={props.domains}
                                        onChange={(v) => setDomain(v)}
                                    />
                                </div>

                                {/* Importance stars */}
                                <div class="relative">
                                    <DirtyDot dirty={importanceDirty()} />
                                    <div class="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Importance</div>
                                    <div class="flex items-center gap-0.5">
                                        <For each={[1, 2, 3, 4, 5]}>
                                            {(n) => (
                                                <button
                                                    onClick={() => setImportance(n)}
                                                    class="p-0.5 hover:scale-125 transition-transform"
                                                    title={`Set importance to ${n}`}
                                                >
                                                    <Icon
                                                        name="star"
                                                        size={14}
                                                        class={n <= importance() ? 'text-amber-400' : 'text-neutral-700'}
                                                    />
                                                </button>
                                            )}
                                        </For>
                                    </div>
                                </div>

                                {/* Reason (read-only) */}
                                <Show when={mem().reason}>
                                    <div>
                                        <div class="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Reason</div>
                                        <p class="text-[11px] text-neutral-400 italic leading-relaxed">{mem().reason}</p>
                                    </div>
                                </Show>

                                {/* Timestamps (read-only) */}
                                <div class="mt-auto text-[10px] text-neutral-600 space-y-1">
                                    <div>Created: {fmtDate(mem().created_at)}</div>
                                    <div>Updated: {fmtDate(mem().updated_at)}</div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div class="border-t border-neutral-700 px-5 py-2.5 flex items-center justify-between">
                            <div class="text-[10px] text-neutral-600 space-x-2">
                                <span>#{mem().id} · {shortPath(mem().project_path)}</span>
                                <Show when={mem().observation_ids}>
                                    <span>obs: {mem().observation_ids}</span>
                                </Show>
                            </div>
                            <div class="flex items-center gap-2">
                                <button
                                    onClick={handleCancel}
                                    class="text-xs px-3 py-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleUpdate}
                                    disabled={!isDirty() || saving()}
                                    class={`text-xs px-3 py-1.5 rounded transition-colors ${
                                        isDirty() && !saving()
                                            ? 'bg-[#d77757]/20 text-[#d77757] hover:bg-[#d77757]/30'
                                            : 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                                    }`}
                                >
                                    {saving() ? 'Saving...' : 'Update'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </Show>
        </Overlay>
    );
};

export default MemoryDetailModal;
