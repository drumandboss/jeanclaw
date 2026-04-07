import type { ChannelAdapter, IncomingMessage, SendOptions } from './types.js';
export declare class ChannelRouter {
    private readonly adapters;
    private readonly handlers;
    addAdapter(adapter: ChannelAdapter): void;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    send(adapterName: string, peerId: string, text: string, options?: SendOptions): Promise<void>;
    startAll(): Promise<void>;
    stopAll(): Promise<void>;
    getAdapter(name: string): ChannelAdapter | undefined;
}
