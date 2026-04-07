import { ClaudeSession } from './claude-session.js';
export interface SessionManagerOptions {
    readonly workspaceDir: string;
    readonly stateDir: string;
    readonly model: string;
    readonly permissionMode: string;
    readonly effort?: string;
    readonly maxBudgetUsd?: number | null;
    readonly sessionScope: 'main' | 'per-peer' | 'per-channel-peer';
    readonly identityPrompt: string;
}
export declare class SessionManager {
    private readonly sessions;
    private readonly circuitBreakers;
    private readonly opts;
    private persistTimer;
    private dirty;
    constructor(opts: SessionManagerOptions);
    private resolveKey;
    getOrCreate(channelKey: string): Promise<ClaudeSession>;
    reset(channelKey: string): Promise<void>;
    compact(channelKey: string): Promise<void>;
    getSessionInfo(channelKey: string): {
        sessionId: string | undefined;
        turnCount: number;
        alive: boolean;
        lastActivity: number;
    } | null;
    resetAll(): Promise<void>;
    listSessions(): Array<{
        key: string;
        sessionId: string | undefined;
        alive: boolean;
        turnCount: number;
    }>;
    stopAll(): Promise<void>;
    private recordFailure;
    private clearFailures;
    private schedulePersist;
    private persist;
}
