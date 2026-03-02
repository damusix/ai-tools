import { Show, type Component } from 'solid-js';
import { type Observation, shortPath } from '../App';
import Icon from './Icon';

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : '');

export const ObservationCard: Component<{
    observation: Observation;
    onDelete: (id: number) => void;
    animation?: string;
    fullWidth?: boolean;
}> = (props) => {
    const o = props.observation;
    const widthClass = () => props.fullWidth ? 'w-full' : 'w-[calc(25%-12px)] min-w-[280px]';
    return (
        <div class={`${widthClass()} group flex flex-col rounded-lg border border-purple-400/10 bg-purple-400/[0.03] p-4 hover:border-purple-400/20 transition-colors ${props.animation || ''}`}>
            <div class="flex items-start justify-between gap-3 mb-2">
                <span
                    class={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${
                        o.processed
                            ? 'bg-emerald-400/10 text-emerald-400/70'
                            : 'bg-purple-400/10 text-purple-300/70'
                    }`}
                >
                    <Icon name={o.processed ? 'check-circle' : 'clock'} size={11} />
                    {o.processed ? 'synthesized' : 'pending'}
                </span>
                <button
                    onClick={() => props.onDelete(o.id)}
                    class="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded hover:bg-red-400/10 shrink-0 transition-opacity"
                >
                    <Icon name="x" size={12} />
                </button>
            </div>

            <p class="text-sm text-neutral-300 leading-relaxed flex-1 overflow-y-auto max-h-40 break-words">{o.content}</p>

            <div class="mt-auto pt-3">
                <Show when={o.source_summary}>
                    <p class="text-xs text-neutral-500 mb-2 italic flex items-center gap-1">
                        <Icon name="link" size={10} class="shrink-0" />
                        {o.source_summary}
                    </p>
                </Show>

                <div class="flex items-center justify-between text-[10px] text-neutral-600">
                    <span>#{o.id} · {shortPath(o.project_path)}</span>
                    <span>{fmtDate(o.created_at)}</span>
                </div>
            </div>
        </div>
    );
};
