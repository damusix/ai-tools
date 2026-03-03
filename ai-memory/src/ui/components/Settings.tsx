import { type Component, createSignal, createEffect, For } from 'solid-js';
import Overlay from './Overlay';
import Icon from './Icon';

type FieldDef = { key: string; label: string; fallback: number; desc: string };
type Section = { icon: string; label: string; fields: FieldDef[] };

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

const Settings: Component<{
    open: boolean;
    onClose: () => void;
    showToast: (msg: string) => void;
}> = (props) => {
    const [config, setConfig] = createSignal<Record<string, number>>({});
    const [saving, setSaving] = createSignal(false);

    createEffect(() => {
        if (!props.open) return;
        fetch('/api/config')
            .then(r => r.json())
            .then(data => setConfig(data))
            .catch(() => props.showToast('Failed to load config'));
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

    return (
        <Overlay open={props.open} onClose={props.onClose}>
            <div
                class="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[680px] max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div class="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
                    <h2 class="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                        <Icon name="gear" size={14} class="text-sky-400" />
                        Settings
                    </h2>
                    <button
                        onClick={props.onClose}
                        class="text-neutral-500 hover:text-neutral-300 p-1 rounded hover:bg-neutral-800"
                    >
                        <Icon name="x" size={14} />
                    </button>
                </div>

                {/* Body */}
                <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
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

                {/* Footer */}
                <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-700">
                    <button
                        onClick={props.onClose}
                        class="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors flex items-center gap-1.5"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving()}
                        class="px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                        <Icon name="rotate-cw" size={12} class={saving() ? 'animate-spin' : ''} />
                        {saving() ? 'Restarting...' : 'Save & Restart'}
                    </button>
                </div>
            </div>
        </Overlay>
    );
};

export default Settings;
