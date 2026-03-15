import { type Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import Overlay from './Overlay';
import { ConfirmModal } from './Modal';
import Icon from './Icon';
import { sse, listen } from '../sse';

type LogsResponse = {
    content: string;
    size: number;
    totalLines: number;
    hasMore: boolean;
};

const TerminalLogs: Component<{ open: boolean; onClose: () => void }> = (props) => {
    const [lines, setLines] = createSignal<string[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [offset, setOffset] = createSignal(0);
    const [hasMore, setHasMore] = createSignal(false);
    const [totalLines, setTotalLines] = createSignal(0);
    const [streaming, setStreaming] = createSignal(false);
    const [confirmTruncate, setConfirmTruncate] = createSignal(false);

    let scrollRef: HTMLDivElement | undefined;
    let isNearBottom = true;
    let handler: ((e: Event) => void) | null = null;

    const checkNearBottom = () => {
        if (!scrollRef) return;
        const threshold = 50;
        isNearBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < threshold;
    };

    const scrollToBottom = () => {
        if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    };

    const fetchLogs = async (off: number, mode: 'replace' | 'prepend') => {
        setLoading(true);
        try {
            const res: LogsResponse = await (await fetch(`/api/logs?lines=500&offset=${off}`)).json();
            const fetched = res.content ? res.content.split('\n') : [];
            if (mode === 'prepend') {
                setLines(prev => [...fetched, ...prev]);
            } else {
                setLines(fetched);
            }
            setHasMore(res.hasMore);
            setTotalLines(res.totalLines);
            setOffset(off + 500);

            if (mode === 'replace' || isNearBottom) {
                queueMicrotask(scrollToBottom);
            }
        } catch {
            setLines(['Failed to fetch logs']);
        } finally {
            setLoading(false);
        }
    };

    const startStreaming = () => {
        if (handler) return;
        listen('log:line');
        handler = (e: Event) => {
            const entry = (e as CustomEvent).detail;
            setLines(prev => [...prev, entry.raw]);
            setTotalLines(n => n + 1);
            if (isNearBottom) {
                queueMicrotask(scrollToBottom);
            }
        };
        sse.addEventListener('log:line', handler);
        setStreaming(true);
    };

    const stopStreaming = () => {
        if (handler) {
            sse.removeEventListener('log:line', handler);
            handler = null;
        }
        setStreaming(false);
    };

    const handleTruncate = async () => {
        try {
            await fetch('/api/logs/truncate', { method: 'POST' });
            setLines([]);
            setTotalLines(0);
            setHasMore(false);
            setOffset(0);
        } catch {}
        setConfirmTruncate(false);
    };

    // Open: fetch initial logs + start streaming by default
    createEffect(() => {
        if (props.open) {
            setOffset(0);
            fetchLogs(0, 'replace').then(() => startStreaming());
        } else {
            stopStreaming();
        }
    });

    onCleanup(() => stopStreaming());

    const LOG_RE = /^(\[(?:INFO|WARN|ERROR)\]) (\[[^\]]+\]) (\[[^\]]+\]) (.*)$/s;

    const levelColor = (level: string): string => {
        if (level.includes('ERROR')) return 'log-error';
        if (level.includes('WARN')) return 'log-warn';
        return 'log-info';
    };

    const renderLine = (line: string) => {
        const m = LOG_RE.exec(line);
        if (!m) return <span class="terminal-text">{line}</span>;
        const [, level, section, time, message] = m;
        return (
            <>
                <span class={levelColor(level)}>{level}</span>
                {' '}
                <span class={`log-section log-section-${section.slice(1, -1)}`}>{section}</span>
                {' '}
                <span class="log-time">{time}</span>
                {' '}
                <span class="log-message">{message}</span>
            </>
        );
    };

    return (
        <>
            <Overlay open={props.open} onClose={props.onClose}>
                <div
                    class="terminal-bg terminal-border border rounded-lg shadow-xl w-[90vw] max-w-3xl max-h-[80vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Title bar */}
                    <div class="terminal-bg flex items-center justify-between px-4 py-2.5 border-b terminal-border rounded-t-lg">
                        <div class="flex items-center gap-2">
                            <span class="inline-block w-3 h-3 rounded-full" style="background:#ff5f57" />
                            <span class="inline-block w-3 h-3 rounded-full" style="background:#febc2e" />
                            <span class="inline-block w-3 h-3 rounded-full" style="background:#28c840" />
                        </div>
                        <span class="text-xs terminal-text opacity-60 font-medium">ai-memory — logs</span>
                        <div class="flex items-center gap-1">
                            <button
                                onClick={() => streaming() ? stopStreaming() : startStreaming()}
                                class="terminal-text flex items-center gap-1 px-2 py-1 text-xs rounded hover:brightness-150 opacity-70 hover:opacity-100 transition"
                                title={streaming() ? 'Stop live stream' : 'Stream live logs'}
                            >
                                <Icon name={streaming() ? 'pause' : 'play'} size={14} />
                                <span class="text-[10px]">{streaming() ? 'Pause' : 'Live'}</span>
                            </button>
                            <button
                                onClick={() => fetchLogs(0, 'replace')}
                                class="terminal-text p-1 rounded hover:brightness-150 opacity-70 hover:opacity-100 transition"
                                title="Refresh"
                            >
                                <Icon name="rotate-cw" size={14} />
                            </button>
                            <button
                                onClick={() => { setLines([]); setTotalLines(0); setHasMore(false); }}
                                class="terminal-text p-1 rounded hover:brightness-150 opacity-70 hover:opacity-100 transition"
                                title="Clear display"
                            >
                                <Icon name="eraser" size={14} />
                            </button>
                            <button
                                onClick={() => setConfirmTruncate(true)}
                                class="terminal-text p-1 rounded hover:brightness-150 opacity-70 hover:opacity-100 transition"
                                title="Truncate log file"
                            >
                                <Icon name="trash" size={14} />
                            </button>
                            <button
                                onClick={props.onClose}
                                class="terminal-text p-1 rounded hover:brightness-150 opacity-70 hover:opacity-100 transition"
                                title="Close"
                            >
                                <Icon name="x" size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Content area */}
                    <div
                        ref={scrollRef}
                        class="terminal-bg terminal-text overflow-y-auto flex-1 font-mono text-xs leading-relaxed"
                        onScroll={checkNearBottom}
                    >
                        <Show when={hasMore()}>
                            <div class="text-center py-2">
                                <button
                                    onClick={() => fetchLogs(offset(), 'prepend')}
                                    disabled={loading()}
                                    class="px-3 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-neutral-400 disabled:opacity-50 transition-colors"
                                >
                                    {loading() ? 'Loading...' : 'Load older logs'}
                                </button>
                            </div>
                        </Show>
                        <div class="terminal-lines min-h-0">
                            <For each={lines()}>
                                {(line) => (
                                    <div class="terminal-line whitespace-pre-wrap break-all hover:bg-white/[0.03]">
                                        {renderLine(line)}
                                    </div>
                                )}
                            </For>
                        </div>
                    </div>

                    {/* Footer */}
                    <div class="terminal-bg border-t terminal-border px-4 py-1.5 rounded-b-lg flex items-center gap-2">
                        <span class="text-[10px] log-line-number">{totalLines()} lines</span>
                        <Show when={streaming()}>
                            <span class="text-[10px] text-green-500 flex items-center gap-1">
                                <span class="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                streaming
                            </span>
                        </Show>
                    </div>
                </div>
            </Overlay>

            <ConfirmModal
                open={confirmTruncate()}
                message="Permanently delete all logs?"
                onConfirm={handleTruncate}
                onCancel={() => setConfirmTruncate(false)}
            />
        </>
    );
};

export default TerminalLogs;
