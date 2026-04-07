import { EventEmitter } from 'node:events';
import type { ClaudeEvent } from './types.js';
export interface ClaudeSessionOptions {
    readonly workspaceDir: string;
    readonly model: string;
    readonly permissionMode: string;
    readonly effort?: string;
    readonly maxBudgetUsd?: number | null;
    readonly appendSystemPrompt?: string;
    readonly allowedTools?: readonly string[];
    readonly disallowedTools?: readonly string[];
    readonly resumeSessionId?: string;
}
export declare class ClaudeSession extends EventEmitter {
    private proc;
    private rl;
    private readonly opts;
    private _sessionId;
    private _lastActivity;
    private _turnCount;
    constructor(opts: ClaudeSessionOptions);
    get sessionId(): string | undefined;
    get lastActivity(): number;
    get turnCount(): number;
    isAlive(): boolean;
    buildSpawnArgs(): string[];
    start(): void;
    send(text: string): void;
    stop(): Promise<void>;
    parseLine(line: string): ClaudeEvent | null;
}
