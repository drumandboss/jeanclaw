import { join } from 'node:path'
import { ClaudeSession, type ClaudeSessionOptions } from './claude-session.js'
import { writeJsonFile } from './persistence.js'
import { createLogger } from './logger.js'
import type { SessionsStore, SessionState, CircuitBreakerState } from './types.js'

const log = createLogger('session-manager')

const MAX_FAILURES = 3
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export interface SessionManagerOptions {
  readonly workspaceDir: string
  readonly stateDir: string
  readonly model: string
  readonly permissionMode: string
  readonly effort?: string
  readonly maxBudgetUsd?: number | null
  readonly sessionScope: 'main' | 'per-peer' | 'per-channel-peer'
  readonly identityPrompt: string
}

export class SessionManager {
  private readonly sessions = new Map<string, ClaudeSession>()
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>()
  private readonly opts: SessionManagerOptions
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(opts: SessionManagerOptions) {
    this.opts = opts
  }

  private resolveKey(channelKey: string): string {
    switch (this.opts.sessionScope) {
      case 'main':
        return '__main__'
      case 'per-peer':
        return channelKey
      case 'per-channel-peer':
        return channelKey
    }
  }

  async getOrCreate(channelKey: string): Promise<ClaudeSession> {
    const key = this.resolveKey(channelKey)
    const existing = this.sessions.get(key)
    if (existing?.isAlive()) return existing

    const breaker = this.circuitBreakers.get(key)
    if (breaker && breaker.failures >= MAX_FAILURES) {
      const elapsed = Date.now() - breaker.lastFailure
      if (elapsed < breaker.backoffMs) {
        throw new Error(
          `Circuit breaker open for ${key}, retry in ${Math.ceil((breaker.backoffMs - elapsed) / 1000)}s`,
        )
      }
    }

    const sessionOpts: ClaudeSessionOptions = {
      workspaceDir: this.opts.workspaceDir,
      model: this.opts.model,
      permissionMode: this.opts.permissionMode,
      effort: this.opts.effort,
      maxBudgetUsd: this.opts.maxBudgetUsd,
      appendSystemPrompt: this.opts.identityPrompt || undefined,
      resumeSessionId: existing?.sessionId,
    }

    const session = new ClaudeSession(sessionOpts)

    session.on('exit', ({ code }: { code: number | null }) => {
      if (code !== 0 && code !== null) {
        this.recordFailure(key)
      } else {
        this.clearFailures(key)
      }
    })

    session.on('error', () => {
      this.recordFailure(key)
    })

    session.start()
    this.sessions.set(key, session)
    this.schedulePersist()

    log.info('session created', { key, sessionId: session.sessionId })
    return session
  }

  async reset(channelKey: string): Promise<void> {
    const key = this.resolveKey(channelKey)
    const session = this.sessions.get(key)
    if (session) {
      await session.stop()
      this.sessions.delete(key)
      this.schedulePersist()
      log.info('session reset', { key })
    }
  }

  listSessions(): Array<{
    key: string
    sessionId: string | undefined
    alive: boolean
    turnCount: number
  }> {
    return Array.from(this.sessions.entries()).map(([key, session]) => ({
      key,
      sessionId: session.sessionId,
      alive: session.isAlive(),
      turnCount: session.turnCount,
    }))
  }

  async stopAll(): Promise<void> {
    const stops = Array.from(this.sessions.values()).map((s) => s.stop())
    await Promise.allSettled(stops)
    this.sessions.clear()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
  }

  private recordFailure(key: string): void {
    const existing = this.circuitBreakers.get(key)
    const breaker: CircuitBreakerState = existing
      ? { ...existing }
      : { failures: 0, lastFailure: 0, backoffMs: BASE_BACKOFF_MS }

    breaker.failures++
    breaker.lastFailure = Date.now()
    breaker.backoffMs = Math.min(breaker.backoffMs * 2, MAX_BACKOFF_MS)
    this.circuitBreakers.set(key, breaker)
    log.warn('session failure recorded', { key, failures: breaker.failures, backoffMs: breaker.backoffMs })
  }

  private clearFailures(key: string): void {
    this.circuitBreakers.delete(key)
  }

  private schedulePersist(): void {
    this.dirty = true
    if (this.persistTimer) return
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null
      if (!this.dirty) return
      this.dirty = false
      await this.persist()
    }, 5000)
  }

  private async persist(): Promise<void> {
    const store: SessionsStore = {
      sessions: Object.fromEntries(
        Array.from(this.sessions.entries())
          .filter(([, s]) => s.sessionId != null)
          .map(([key, s]) => [
            key,
            {
              sessionId: s.sessionId!,
              lastActivity: new Date(s.lastActivity).toISOString(),
              model: this.opts.model,
              turnCount: s.turnCount,
            } satisfies SessionState,
          ]),
      ),
    }
    await writeJsonFile(join(this.opts.stateDir, 'sessions.json'), store)
    log.debug('sessions persisted', { count: Object.keys(store.sessions).length })
  }
}
