import { type Component } from 'solid-js';
import Overlay from './Overlay';

export const ConfirmModal: Component<{
    open: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}> = (props) => {
    return (
        <Overlay open={props.open} onClose={props.onCancel}>
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl">
                <p class="text-sm text-neutral-300 mb-4">{props.message}</p>
                <div class="flex justify-end gap-3">
                    <button
                        class="text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                        onClick={props.onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        class="text-sm px-3 py-1.5 rounded bg-red-500/10 text-red-400/80 hover:bg-red-500/20 hover:text-red-300"
                        onClick={props.onConfirm}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </Overlay>
    );
};
