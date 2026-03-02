export const sse = new EventTarget();

let es: EventSource | null = null;
const knownEvents = new Set<string>();

function ensureConnection(): EventSource {
    if (es && es.readyState !== EventSource.CLOSED) return es;
    es = new EventSource('/api/events');
    // Re-register known events on reconnect
    for (const event of knownEvents) {
        registerEvent(es, event);
    }
    return es;
}

function registerEvent(source: EventSource, event: string): void {
    source.addEventListener(event, (e: Event) => {
        const me = e as MessageEvent;
        const data = me.data ? JSON.parse(me.data) : {};
        sse.dispatchEvent(new CustomEvent(event, { detail: data }));
    });
}

export function listen(event: string): void {
    if (knownEvents.has(event)) {
        ensureConnection();
        return;
    }
    knownEvents.add(event);
    const source = ensureConnection();
    registerEvent(source, event);
}

// HMR cleanup
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        es?.close();
        es = null;
    });
}
