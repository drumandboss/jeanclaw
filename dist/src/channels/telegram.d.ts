import { Bot } from 'grammy';
import type { ChannelAdapter, IncomingMessage, SendOptions, TelegramConfig, CommandCallback } from '../types.js';
/** Convert Claude markdown to Telegram-safe HTML */
export declare function markdownToTelegramHtml(text: string): string;
/**
 * Split long messages into chunks at paragraph/newline boundaries.
 * Each chunk is at most maxLen characters.
 */
export declare function splitForTelegram(text: string, maxLen?: number): readonly string[];
export declare function truncateForTelegram(text: string): string;
export declare class TelegramAdapter implements ChannelAdapter {
    readonly name = "telegram";
    readonly bot: Bot;
    private messageHandlers;
    private commandCallback;
    private readonly config;
    constructor(config: TelegramConfig);
    /** Register a callback for slash commands (/new, /reset, /status, /compact) */
    onCommand(callback: CommandCallback): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    onMessage(handler: (msg: IncomingMessage) => void): void;
    send(peerId: string, text: string, _options?: SendOptions): Promise<void>;
    sendStreaming(peerId: string, chunks: AsyncIterable<string>): Promise<void>;
    private isAllowed;
    private parseCommand;
    private handleCommand;
    private sendSingleMessage;
    private sendEditOrFallback;
}
