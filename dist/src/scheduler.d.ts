import type { CronJob } from './types.js';
export declare function parseInterval(str: string): number;
export interface SchedulerOptions {
    readonly heartbeat: {
        readonly enabled: boolean;
        readonly every: string;
        readonly session: string;
    };
    readonly crons: readonly CronJob[];
    readonly quietHours: {
        readonly start: string;
        readonly end: string;
    } | null;
    readonly onHeartbeat: () => Promise<void>;
    readonly onCron: (job: CronJob) => Promise<void>;
}
export declare class Scheduler {
    private heartbeatTimer;
    private cronJobs;
    private readonly opts;
    constructor(opts: SchedulerOptions);
    start(): void;
    stop(): void;
    runCronNow(jobId: string): Promise<void>;
}
