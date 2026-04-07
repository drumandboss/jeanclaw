import { join } from 'node:path';
import { ClaudeSession } from './claude-session.js';
import { writeJsonFile } from './persistence.js';
import { createLogger } from './logger.js';
const log = createLogger('session-manager');
const MAX_FAILURES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
export class SessionManager {
    sessions = new Map();
    circuitBreakers = new Map();
    opts;
    persistTimer = null;
    dirty = false;
    constructor(opts) {
        this.opts = opts;
    }
    resolveKey(channelKey) {
        switch (this.opts.sessionScope) {
            case 'main':
                return '__main__';
            case 'per-peer':
                return channelKey;
            case 'per-channel-peer':
                return channelKey;
        }
    }
    async getOrCreate(channelKey) {
        const key = this.resolveKey(channelKey);
        const existing = this.sessions.get(key);
        // Idle timeout: if session hasn't been used for 4 hours, reset it
        if (existing?.isAlive()) {
            const idleMs = Date.now() - existing.lastActivity;
            if (idleMs > IDLE_TIMEOUT_MS) {
                log.info('session idle timeout, resetting', { key, idleMs });
                await existing.stop();
                this.sessions.delete(key);
            }
            else {
                return existing;
            }
        }
        const breaker = this.circuitBreakers.get(key);
        if (breaker && breaker.failures >= MAX_FAILURES) {
            const elapsed = Date.now() - breaker.lastFailure;
            if (elapsed < breaker.backoffMs) {
                throw new Error(`Circuit breaker open for ${key}, retry in ${Math.ceil((breaker.backoffMs - elapsed) / 1000)}s`);
            }
        }
        const sessionOpts = {
            workspaceDir: this.opts.workspaceDir,
            model: this.opts.model,
            permissionMode: this.opts.permissionMode,
            effort: this.opts.effort,
            maxBudgetUsd: this.opts.maxBudgetUsd,
            appendSystemPrompt: this.opts.identityPrompt || undefined,
            resumeSessionId: existing?.sessionId,
        };
        const session = new ClaudeSession(sessionOpts);
        session.on('exit', ({ code }) => {
            if (code !== 0 && code !== null) {
                this.recordFailure(key);
            }
            else {
                this.clearFailures(key);
            }
        });
        session.on('error', () => {
            this.recordFailure(key);
        });
        session.start();
        this.sessions.set(key, session);
        this.schedulePersist();
        log.info('session created', { key, sessionId: session.sessionId });
        return session;
    }
    async reset(channelKey) {
        const key = this.resolveKey(channelKey);
        const session = this.sessions.get(key);
        if (session) {
            await session.stop();
            this.sessions.delete(key);
            this.schedulePersist();
            log.info('session reset', { key });
        }
    }
    async compact(channelKey) {
        const key = this.resolveKey(channelKey);
        const session = this.sessions.get(key);
        if (session?.isAlive()) {
            session.send('/compact');
            log.info('session compact requested', { key });
        }
    }
    getSessionInfo(channelKey) {
        const key = this.resolveKey(channelKey);
        const session = this.sessions.get(key);
        if (!session)
            return null;
        return {
            sessionId: session.sessionId,
            turnCount: session.turnCount,
            alive: session.isAlive(),
            lastActivity: session.lastActivity,
        };
    }
    async resetAll() {
        const keys = Array.from(this.sessions.keys());
        for (const key of keys) {
            const session = this.sessions.get(key);
            if (session) {
                await session.stop();
                this.sessions.delete(key);
            }
        }
        this.schedulePersist();
        log.info('all sessions reset');
    }
    listSessions() {
        return Array.from(this.sessions.entries()).map(([key, session]) => ({
            key,
            sessionId: session.sessionId,
            alive: session.isAlive(),
            turnCount: session.turnCount,
        }));
    }
    async stopAll() {
        const stops = Array.from(this.sessions.values()).map((s) => s.stop());
        await Promise.allSettled(stops);
        this.sessions.clear();
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
    }
    recordFailure(key) {
        const existing = this.circuitBreakers.get(key);
        const breaker = existing
            ? { ...existing }
            : { failures: 0, lastFailure: 0, backoffMs: BASE_BACKOFF_MS };
        breaker.failures++;
        breaker.lastFailure = Date.now();
        breaker.backoffMs = Math.min(breaker.backoffMs * 2, MAX_BACKOFF_MS);
        this.circuitBreakers.set(key, breaker);
        log.warn('session failure recorded', { key, failures: breaker.failures, backoffMs: breaker.backoffMs });
    }
    clearFailures(key) {
        this.circuitBreakers.delete(key);
    }
    schedulePersist() {
        this.dirty = true;
        if (this.persistTimer)
            return;
        this.persistTimer = setTimeout(async () => {
            this.persistTimer = null;
            if (!this.dirty)
                return;
            this.dirty = false;
            await this.persist();
        }, 5000);
    }
    async persist() {
        const store = {
            sessions: Object.fromEntries(Array.from(this.sessions.entries())
                .filter(([, s]) => s.sessionId != null)
                .map(([key, s]) => [
                key,
                {
                    sessionId: s.sessionId,
                    lastActivity: new Date(s.lastActivity).toISOString(),
                    model: this.opts.model,
                    turnCount: s.turnCount,
                },
            ])),
        };
        await writeJsonFile(join(this.opts.stateDir, 'sessions.json'), store);
        log.debug('sessions persisted', { count: Object.keys(store.sessions).length });
    }
}
//# sourceMappingURL=session-manager.js.map