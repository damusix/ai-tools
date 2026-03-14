import { Show, For, type Component } from 'solid-js';
import { type Memory, shortPath } from '../App';
import Icon from './Icon';

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : '');

export const MemoryCard: Component<{
    memory: Memory;
    onDelete: (id: number) => void;
    animation?: string;
    widthClass?: string;
    domainIcon?: string;
    categoryIcon?: string;
}> = (props) => {
    const m = props.memory;
    const width = () => props.widthClass || 'w-[calc(33.333%-11px)] min-w-[280px]';
    return (
        <div class={`${width()} flex flex-col rounded-lg border border-[#d77757]/10 bg-[#d77757]/[0.03] p-4 hover:border-[#d77757]/20 transition-colors ${props.animation || ''}`}>
            <div class="flex items-start justify-between gap-3 mb-2">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="px-2 py-0.5 rounded text-xs font-medium bg-[#d77757]/10 text-[#d77757]/80 flex items-center gap-1">
                        <i class={`fa-solid ${props.categoryIcon || 'fa-bookmark'}`} style="font-size: 11px"></i>
                        {m.category}
                    </span>
                    <Show when={m.domain}>
                        <span class="px-2 py-0.5 rounded text-xs font-medium bg-emerald-400/10 text-emerald-300/80 flex items-center gap-1">
                            <i class={`fa-solid ${props.domainIcon || 'fa-folder'}`} style="font-size: 11px"></i>
                            {m.domain}
                        </span>
                    </Show>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-amber-400/70 text-xs flex items-center gap-0.5">
                        <For each={Array.from({ length: 5 })}>
                            {(_, i) => (
                                <Icon name="star" size={11} class={i() < m.importance ? 'text-amber-400/70' : 'text-neutral-700'} />
                            )}
                        </For>
                    </span>
                    <button
                        onClick={() => props.onDelete(m.id)}
                        class="text-neutral-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-red-400/10"
                    >
                        <Icon name="x" size={12} />
                    </button>
                </div>
            </div>

            <p class="text-sm text-neutral-300 leading-relaxed flex-1 overflow-y-auto max-h-40 break-words">{m.content}</p>

            <Show when={m.reason}>
                <p class="text-[11px] text-neutral-500 italic mt-1 flex items-center gap-1">
                    <i class="fa-solid fa-circle-info" style="font-size: 10px"></i>
                    {m.reason}
                </p>
            </Show>

            <div class="mt-auto pt-3">
                <Show when={m.tags}>
                    <div class="flex flex-wrap gap-1.5 mb-2">
                        <For each={m.tags.split(',').filter(Boolean)}>
                            {(tag) => (
                                <span class="px-1.5 py-0.5 rounded text-[10px] bg-[#d77757]/5 text-neutral-500 flex items-center gap-0.5">
                                    <Icon name="tag" size={9} />
                                    {tag.trim()}
                                </span>
                            )}
                        </For>
                    </div>
                </Show>

                <div class="flex items-center justify-between text-[10px] text-neutral-600">
                    <span>#{m.id} · {shortPath(m.project_path)}</span>
                    <span>{fmtDate(m.created_at)}</span>
                </div>
            </div>
        </div>
    );
};
