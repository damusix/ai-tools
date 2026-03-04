import { type Component, type JSX, createEffect, onCleanup } from 'solid-js';
import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';

const Overlay: Component<{
    open: boolean;
    onClose?: () => void;
    zIndex?: number;
    children: JSX.Element;
}> = (props) => {
    createEffect(() => {
        if (!props.open || !props.onClose) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') props.onClose!();
        };
        document.addEventListener('keydown', handler);
        onCleanup(() => document.removeEventListener('keydown', handler));
    });

    return (
        <Show when={props.open}>
            <Portal>
                <div
                    class="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center"
                    style={{ 'z-index': props.zIndex ?? 50 }}
                    onClick={(e) => {
                        if (e.target === e.currentTarget && props.onClose) props.onClose();
                    }}
                >
                    {props.children}
                </div>
            </Portal>
        </Show>
    );
};

export default Overlay;
