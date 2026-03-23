import { type Component, type JSX, splitProps } from 'solid-js';
import { Tooltip as KTooltip } from '@kobalte/core/tooltip';

export const Tooltip: Component<{
    text: string;
    children: JSX.Element;
}> = (props) => {
    return (
        <KTooltip openDelay={300} closeDelay={0}>
            <KTooltip.Trigger as="span" class="inline-flex">
                {props.children}
            </KTooltip.Trigger>
            <KTooltip.Portal>
                <KTooltip.Content
                    class="z-50 max-w-[220px] rounded-md bg-neutral-800 border border-neutral-700 px-2.5 py-1.5 text-[10px] text-neutral-300 leading-relaxed shadow-lg animate-fade-in"
                >
                    {props.text}
                </KTooltip.Content>
            </KTooltip.Portal>
        </KTooltip>
    );
};
