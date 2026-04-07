import type { ChannelAdapter, IncomingMessage, SendOptions, iMessageConfig } from '../types.js';
export declare class iMessageAdapter implements ChannelAdapter {
    readonly name = "imessage";
    private messageHandlers;
    private pollTimer;
    private lastTimestamp;
    private readonly config;
    constructor(config: iMessageConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    send(peerId: string, text: string, _options?: SendOptions): Promise<void>;
    private pollMessages;
}
