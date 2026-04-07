import type { ChannelAdapter, IncomingMessage, SendOptions, HttpConfig } from '../types.js';
export interface OutboundCallback {
    (channel: string, peerId: string, text: string): Promise<void>;
}
export declare class HttpAdapter implements ChannelAdapter {
    readonly name = "http";
    private server;
    private messageHandlers;
    private readonly config;
    private statusProvider;
    private outboundCallback;
    constructor(config: HttpConfig);
    setStatusProvider(fn: () => unknown): void;
    setOutboundCallback(fn: OutboundCallback): void;
    getPort(): number;
    start(): Promise<void>;
    stop(): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    send(_peerId: string, _text: string, _options?: SendOptions): Promise<void>;
    private checkAuth;
    private readBody;
    private handleRequest;
}
