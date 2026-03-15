import { createSignal, createMemo, createEffect, on, For, Show, onCleanup, type Component } from 'solid-js';
import type { Memory } from '../App';
import Icon from './Icon';

type FilterType = 'domain' | 'category' | 'tag';
type Filter = { type: FilterType; value: string; icon: string };

type DomainMeta = { name: string; icon: string; count: number };
type CategoryMeta = { name: string; icon: string; count: number };
type TagMeta = { tag: string; count: number };

const FILTER_COLORS: Record<FilterType, { bg: string; text: string }> = {
    domain: { bg: 'bg-[#d77757]/15', text: 'text-[#d77757]' },
    category: { bg: 'bg-purple-400/15', text: 'text-purple-400' },
    tag: { bg: 'bg-teal-400/15', text: 'text-teal-400' },
};

const FILTER_LABELS: Record<FilterType, string> = {
    domain: 'Domains',
    category: 'Categories',
    tag: 'Tags',
};

const SEARCH_TEXT_KEY = 'ai-memory:search-text';
const SEARCH_FILTERS_KEY = 'ai-memory:search-filters';

export const SearchBar: Component<{
    project: string;
    domains: DomainMeta[];
    categories: CategoryMeta[];
    tags: TagMeta[];
    onResults: (memories: Memory[] | null) => void;
    onSearchTextChange?: (text: string) => void;
}> = (props) => {
    const [query, setQuery] = createSignal('');
    const [open, setOpen] = createSignal(false);
    const [filters, setFilters] = createSignal<Filter[]>(
        JSON.parse(localStorage.getItem(SEARCH_FILTERS_KEY) || '[]')
    );
    const [searchText, setSearchText] = createSignal(
        localStorage.getItem(SEARCH_TEXT_KEY) || ''
    );

    // Notify parent of restored search text on mount
    if (searchText()) props.onSearchTextChange?.(searchText());
    const [highlightIndex, setHighlightIndex] = createSignal(0);
    let inputRef!: HTMLInputElement;
    let containerRef!: HTMLDivElement;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Build the available options, excluding already-selected filters
    const selectedKeys = createMemo(() => {
        const keys: Record<string, true> = {};
        for (const f of filters()) keys[`${f.type}:${f.value}`] = true;
        return keys;
    });

    const filteredOptions = createMemo(() => {
        const q = query().toLowerCase();
        const selected = selectedKeys();
        const groups: { type: FilterType; items: { value: string; icon: string; count: number }[] }[] = [];

        // Domains
        const domainItems = (props.domains || [])
            .filter(d => !selected[`domain:${d.name}`] && d.count > 0)
            .filter(d => !q || d.name.toLowerCase().includes(q))
            .map(d => ({ value: d.name, icon: d.icon, count: d.count }));
        if (domainItems.length > 0) groups.push({ type: 'domain', items: domainItems });

        // Categories
        const categoryItems = (props.categories || [])
            .filter(c => !selected[`category:${c.name}`] && c.count > 0)
            .filter(c => !q || c.name.toLowerCase().includes(q))
            .map(c => ({ value: c.name, icon: c.icon, count: c.count }));
        if (categoryItems.length > 0) groups.push({ type: 'category', items: categoryItems });

        // Tags
        const tagItems = (props.tags || [])
            .filter(t => !selected[`tag:${t.tag}`])
            .filter(t => !q || t.tag.toLowerCase().includes(q))
            .map(t => ({ value: t.tag, icon: 'fa-tag', count: t.count }));
        if (tagItems.length > 0) groups.push({ type: 'tag', items: tagItems });

        return groups;
    });

    // Flat list for keyboard navigation
    const flatOptions = createMemo(() => {
        const flat: { type: FilterType; value: string; icon: string; count: number }[] = [];
        for (const group of filteredOptions()) {
            for (const item of group.items) {
                flat.push({ type: group.type, ...item });
            }
        }
        return flat;
    });

    createEffect(() => {
        flatOptions();
        setHighlightIndex(0);
    });

    const addFilter = (type: FilterType, value: string, icon: string) => {
        setFilters(prev => [...prev, { type, value, icon }]);
        setQuery('');
        inputRef?.focus();
    };

    const removeFilter = (type: FilterType, value: string) => {
        setFilters(prev => prev.filter(f => !(f.type === type && f.value === value)));
    };

    const clearSearchText = () => {
        setSearchText('');
        props.onSearchTextChange?.('');
    };

    // Execute search/filter query
    const executeQuery = () => {
        const activeFilters = filters();
        const text = searchText();

        if (!text && activeFilters.length === 0) {
            props.onResults(null);
            return;
        }

        const params = new URLSearchParams();
        if (text) params.set('q', text);
        if (props.project) params.set('project', props.project);

        const domains = activeFilters.filter(f => f.type === 'domain').map(f => f.value);
        const categories = activeFilters.filter(f => f.type === 'category').map(f => f.value);
        const tags = activeFilters.filter(f => f.type === 'tag').map(f => f.value);

        if (domains.length > 0) params.set('domain', domains.join(','));
        if (categories.length > 0) params.set('category', categories.join(','));
        if (tags.length > 0) params.set('tag', tags.join(','));

        fetch(`/api/search?${params}`)
            .then(r => r.json())
            .then((data: any) => props.onResults(data.results))
            .catch(() => props.onResults([]));
    };

    // Persist search state to localStorage
    createEffect(() => localStorage.setItem(SEARCH_TEXT_KEY, searchText()));
    createEffect(() => localStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(filters())));

    // Debounced execute when filters change
    createEffect(() => {
        filters(); // track
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(executeQuery, 200);
    });

    // Re-execute when project changes
    createEffect(() => {
        props.project; // track
        const activeFilters = filters();
        const text = searchText();
        if (text || activeFilters.length > 0) {
            executeQuery();
        }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
        const flat = flatOptions();

        if (!open()) {
            if (e.key === 'ArrowDown') {
                setOpen(true);
                e.preventDefault();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = query().trim();
                if (val) {
                    setSearchText(val);
                    props.onSearchTextChange?.(val);
                    setQuery('');
                    setOpen(false);
                    executeQuery();
                }
            }
            return;
        }

        // "Search for" row is index 0 when present; filter items shift by 1
        const hasSearchRow = query().trim().length > 0;
        const offset = hasSearchRow ? 1 : 0;
        const total = flat.length + offset;

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
                if (hasSearchRow && highlightIndex() === 0) {
                    // "Search for" row (first item)
                    setSearchText(query().trim());
                    props.onSearchTextChange?.(query().trim());
                    setQuery('');
                    setOpen(false);
                    executeQuery();
                } else {
                    const item = flat[highlightIndex() - offset];
                    if (item) addFilter(item.type, item.value, item.icon);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setOpen(false);
                break;
        }
    };

    // Close on click outside
    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            setOpen(false);
        }
    };

    createEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside));
    });

    // Reset filters when project changes (deferred to preserve restored state on mount)
    createEffect(on(() => props.project, () => {
        setFilters([]);
        setSearchText('');
        props.onSearchTextChange?.('');
        setQuery('');
        props.onResults(null);
    }, { defer: true }));

    return (
        <div ref={containerRef} class="relative">
            <div class="relative">
                <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" style="font-size: 11px"></i>
                <input
                    ref={inputRef}
                    type="text"
                    class="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 pl-7 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                    placeholder="Search or filter..."
                    value={query()}
                    onFocus={() => setOpen(true)}
                    onInput={(e) => setQuery(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {/* Pills row */}
            <Show when={filters().length > 0 || searchText()}>
                <div class="flex gap-1 mt-1 px-0.5 flex-wrap">
                    {/* Search text pill */}
                    <Show when={searchText()}>
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-neutral-700/50 text-neutral-300">
                            <i class="fa-solid fa-magnifying-glass" style="font-size: 8px"></i>
                            "{searchText()}"
                            <button
                                class="ml-0.5 text-neutral-500 hover:text-neutral-300"
                                onClick={() => { clearSearchText(); executeQuery(); }}
                            >
                                <i class="fa-solid fa-xmark" style="font-size: 8px"></i>
                            </button>
                        </span>
                    </Show>
                    {/* Filter pills */}
                    <For each={filters()}>
                        {(f) => {
                            const colors = FILTER_COLORS[f.type];
                            return (
                                <span class={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${colors.bg} ${colors.text}`}>
                                    <i class={`fa-solid ${f.icon}`} style="font-size: 8px"></i>
                                    {f.value}
                                    <button
                                        class="ml-0.5 opacity-60 hover:opacity-100"
                                        onClick={() => removeFilter(f.type, f.value)}
                                    >
                                        <i class="fa-solid fa-xmark" style="font-size: 8px"></i>
                                    </button>
                                </span>
                            );
                        }}
                    </For>
                </div>
            </Show>

            {/* Dropdown */}
            <Show when={open()}>
                <div class="absolute z-50 top-[34px] left-0 w-full bg-neutral-900 border border-neutral-700 rounded shadow-lg max-h-72 overflow-y-auto">
                    {(() => {
                        let flatIdx = 0;
                        // "Search for" row is index 0 when present, filter items shift by 1
                        const hasSearchRow = () => query().trim().length > 0;
                        return (
                            <>
                                {/* "Search for" row — first */}
                                <Show when={query().trim()}>
                                    <button
                                        class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                                            highlightIndex() === 0 ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                        }`}
                                        onMouseEnter={() => setHighlightIndex(0)}
                                        onClick={() => {
                                            setSearchText(query().trim());
                                            props.onSearchTextChange?.(query().trim());
                                            setQuery('');
                                            setOpen(false);
                                            executeQuery();
                                        }}
                                    >
                                        <i class="fa-solid fa-magnifying-glass" style="font-size: 11px"></i>
                                        <span>Search for "<strong>{query().trim()}</strong>"</span>
                                    </button>
                                </Show>

                                <For each={filteredOptions()}>
                                    {(group) => (
                                        <div>
                                            <div class={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${FILTER_COLORS[group.type].text} opacity-60`}>
                                                {FILTER_LABELS[group.type]}
                                            </div>
                                            <For each={group.items}>
                                                {(item) => {
                                                    const offset = hasSearchRow() ? 1 : 0;
                                                    const myIdx = flatIdx++ + offset;
                                                    return (
                                                        <button
                                                            class={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 transition-colors ${
                                                                highlightIndex() === myIdx ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-400 hover:bg-neutral-800/50'
                                                            }`}
                                                            onMouseEnter={() => setHighlightIndex(myIdx)}
                                                            onClick={() => addFilter(group.type, item.value, item.icon)}
                                                        >
                                                            <i class={`fa-solid ${item.icon} ${FILTER_COLORS[group.type].text}`} style="font-size: 11px"></i>
                                                            <span class="flex-1">{item.value}</span>
                                                            <span class="text-[10px] text-neutral-600">{item.count}</span>
                                                        </button>
                                                    );
                                                }}
                                            </For>
                                        </div>
                                    )}
                                </For>

                                <Show when={filteredOptions().length === 0 && !query().trim()}>
                                    <div class="px-3 py-2 text-xs text-neutral-500">No filters available</div>
                                </Show>
                            </>
                        );
                    })()}
                </div>
            </Show>
        </div>
    );
};
