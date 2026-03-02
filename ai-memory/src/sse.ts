import { createChannel } from 'better-sse';

export const channel = createChannel();

export function broadcast(event: string, data: unknown): void {
    channel.broadcast(data, event);
}
