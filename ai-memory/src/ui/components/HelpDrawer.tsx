import { type Component, createSignal, createEffect } from 'solid-js';
import { Show } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';

const processor = remark().use(remarkGfm).use(remarkHtml);

const cache: Record<string, string> = {};

const HelpDrawer: Component<{
    open: boolean;
    topic: string;
    onClose: () => void;
}> = (props) => {
    const [html, setHtml] = createSignal('');
    const [loading, setLoading] = createSignal(false);

    createEffect(() => {
        if (!props.open || !props.topic) return;
        if (cache[props.topic]) {
            setHtml(cache[props.topic]);
            return;
        }
        setLoading(true);
        fetch(`/api/help/${props.topic}`)
            .then(r => r.text())
            .then(md => processor.process(md))
            .then(result => {
                const rendered = String(result);
                cache[props.topic] = rendered;
                setHtml(rendered);
                setLoading(false);
            })
            .catch(() => {
                setHtml('<p>Failed to load help content.</p>');
                setLoading(false);
            });
    });

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div
                class="fixed right-0 top-0 h-full w-[400px] bg-neutral-900 border-l border-neutral-700 overflow-y-auto p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <Icon name="info" size={14} class="text-[#d77757]" />
                        Help
                    </h2>
                    <button
                        onClick={props.onClose}
                        class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800"
                    >
                        <Icon name="x" size={14} />
                    </button>
                </div>
                <Show when={!loading()} fallback={<p class="text-neutral-500 text-sm">Loading...</p>}>
                    <div
                        class="help-prose text-sm text-neutral-300"
                        innerHTML={html()}
                    />
                </Show>
            </div>
        </Overlay>
    );
};

export default HelpDrawer;
