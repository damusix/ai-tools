import { Component } from 'solid-js';

const icons = import.meta.glob('../icons/*.svg', { query: '?raw', import: 'default', eager: true });

const Icon: Component<{ name: string; size?: number; class?: string }> = (props) => {
    const size = () => props.size ?? 16;
    const raw = () => {
        const svg = (icons[`../icons/${props.name}.svg`] ?? '') as string;
        return svg.replace('<svg ', `<svg fill="currentColor" width="${size()}" height="${size()}" `);
    };
    return (
        <span
            class={props.class ?? ''}
            style={{ width: `${size()}px`, height: `${size()}px`, display: 'inline-flex', 'align-items': 'center' }}
            innerHTML={raw()}
        />
    );
};

export default Icon;
