import { type Component, createSignal, createMemo, For, Show } from 'solid-js';
import Overlay from './Overlay';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';

const md = remark().use(remarkGfm).use(remarkHtml);
const renderMd = (text: string): string => {
    try {
        return String(md.processSync(text));
    } catch {
        return text;
    }
};

type ArchitectureData = {
    summary: string;
    full: string;
    facts: string;
    scannedAt: string;
};

const TABS = ['Summary', 'Full Analysis', 'Raw Facts'] as const;
type Tab = (typeof TABS)[number];

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : '');

const ArchitectureModal: Component<{
    data: ArchitectureData | null;
    open: boolean;
    onClose: () => void;
}> = (props) => {
    const [tab, setTab] = createSignal<Tab>('Summary');

    const parsedFacts = () => {
        if (!props.data?.facts) return null;
        try {
            return JSON.parse(props.data.facts);
        } catch {
            return null;
        }
    };

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <Show when={props.data}>
                {(data) => (
                    <div
                        class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Tab bar */}
                        <div class="flex border-b border-neutral-700">
                            <For each={[...TABS]}>
                                {(t) => (
                                    <button
                                        class={`px-4 py-2.5 text-xs font-medium transition-colors ${
                                            tab() === t
                                                ? 'text-cyan-400 border-b-2 border-cyan-400'
                                                : 'text-neutral-500 hover:text-neutral-300'
                                        }`}
                                        onClick={() => setTab(t)}
                                    >
                                        {t}
                                    </button>
                                )}
                            </For>
                        </div>

                        {/* Tab content */}
                        <div class="flex-1 overflow-y-auto p-5">
                            <Show when={tab() === 'Summary'}>
                                <Show
                                    when={data().summary}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No summary available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <div
                                        class="help-prose text-xs text-neutral-300 leading-relaxed"
                                        innerHTML={renderMd(data().summary)}
                                    />
                                </Show>
                            </Show>

                            <Show when={tab() === 'Full Analysis'}>
                                <Show
                                    when={data().full}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No full analysis available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <div
                                        class="help-prose text-xs text-neutral-300 leading-relaxed"
                                        innerHTML={renderMd(data().full)}
                                    />
                                </Show>
                            </Show>

                            <Show when={tab() === 'Raw Facts'}>
                                <Show
                                    when={parsedFacts()}
                                    fallback={
                                        <p class="text-xs text-neutral-500 italic">
                                            No facts available — trigger a rescan.
                                        </p>
                                    }
                                >
                                    <div class="space-y-4">
                                        {/* Tree */}
                                        <Show when={parsedFacts()?.tree}>
                                            <div>
                                                <h4 class="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">Tree</h4>
                                                <pre class="text-xs font-mono text-neutral-400 overflow-auto max-h-[40vh] bg-neutral-950 rounded-lg p-3 border border-neutral-800 whitespace-pre">
                                                    {parsedFacts().tree}
                                                </pre>
                                            </div>
                                        </Show>

                                        {/* Signals */}
                                        <Show when={parsedFacts()?.signals?.length > 0}>
                                            <div>
                                                <h4 class="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">Signals</h4>
                                                <div class="flex flex-wrap gap-1.5">
                                                    <For each={[...new Set((parsedFacts().signals as any[]).map((s: any) => s.kind) as string[])].sort()}>
                                                        {(kind: string) => {
                                                            const evidence = (parsedFacts().signals as any[])
                                                                .filter((s: any) => s.kind === kind)
                                                                .flatMap((s: any) => s.evidence);
                                                            return (
                                                                <span
                                                                    class="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400/80"
                                                                    title={evidence.join(', ')}
                                                                >
                                                                    {kind}
                                                                </span>
                                                            );
                                                        }}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>

                                        {/* Manifests */}
                                        <Show when={parsedFacts()?.manifests?.length > 0}>
                                            <div>
                                                <h4 class="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">Manifests</h4>
                                                <div class="space-y-2">
                                                    <For each={parsedFacts().manifests}>
                                                        {(m: any) => (
                                                            <div>
                                                                <div class="text-[10px] font-mono text-cyan-400/70 mb-0.5">{m.path}</div>
                                                                <pre class="text-xs font-mono text-neutral-500 overflow-auto max-h-[20vh] bg-neutral-950 rounded p-2 border border-neutral-800 whitespace-pre">
                                                                    {m.content}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>

                                        {/* CI */}
                                        <Show when={parsedFacts()?.ci?.workflows?.length > 0}>
                                            <div>
                                                <h4 class="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">CI Workflows</h4>
                                                <div class="flex flex-wrap gap-1.5">
                                                    <For each={parsedFacts().ci.workflows}>
                                                        {(name: string) => (
                                                            <span class="px-2 py-0.5 rounded text-[10px] bg-neutral-800 text-neutral-400 font-mono">
                                                                {name}
                                                            </span>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>

                                        {/* Metadata */}
                                        <div>
                                            <h4 class="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider mb-1.5">Metadata</h4>
                                            <div class="text-xs text-neutral-500 space-y-0.5">
                                                <div>Schema version: {parsedFacts()?.schemaVersion}</div>
                                                <div>Scanned: {parsedFacts()?.scannedAt}</div>
                                            </div>
                                        </div>
                                    </div>
                                </Show>
                            </Show>
                        </div>

                        {/* Footer */}
                        <div class="border-t border-neutral-700 px-5 py-2.5 flex items-center justify-between">
                            <div class="text-[10px] text-neutral-600">
                                Scanned: {fmtDate(data().scannedAt)}
                            </div>
                            <button
                                onClick={props.onClose}
                                class="text-xs px-3 py-1.5 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </Show>
        </Overlay>
    );
};

export default ArchitectureModal;
