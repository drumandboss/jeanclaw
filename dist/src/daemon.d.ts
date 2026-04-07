export declare class Daemon {
    private sessionManager;
    private router;
    private scheduler;
    private config;
    private dailyResetTimer;
    private readonly messageQueues;
    private readonly processingKeys;
    private readonly lastErrorTime;
    private static readonly ERROR_COOLDOWN_MS;
    start(configPath?: string): Promise<void>;
    stop(): Promise<void>;
    private enqueueMessage;
    private processMessage;
    private processNextInQueue;
    private sendErrorIfAllowed;
    private sendTypingIndicator;
    private maybeStreamUpdate;
    private handleCommand;
    private scheduleDailyReset;
    private deliverToDefaultChannel;
}
