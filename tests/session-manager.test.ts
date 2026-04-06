import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionManager } from '../src/session-manager.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock the ClaudeSession to avoid spawning real processes
vi.mock('../src/claude-session.js', () => {
  const { EventEmitter } = require('node:events')
  class MockClaudeSession extends EventEmitter {
    private _alive = false
    private _sessionId: string | undefined
    constructor(opts: any) {
      super()
      this._sessionId = opts.resumeSessionId
    }
    get sessionId() { return this._sessionId ?? 'mock-session-id' }
    get lastActivity() { return Date.now() }
    get turnCount() { return 0 }
    isAlive() { return this._alive }
    buildSpawnArgs() { return [] }
    start() { this._alive = true }
    send(text: string) {
      setTimeout(() => {
        this.emit('event', { type: 'assistant', message: `Echo: ${text}` })
        this.emit('event', { type: 'result', stop_reason: 'end_turn' })
      }, 10)
    }
    async stop() { this._alive = false }
    parseLine(line: string) { return null }
  }
  return { ClaudeSession: MockClaudeSession }
})

describe('SessionManager', () => {
  let tempDir: string
  let manager: SessionManager

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jc-sm-'))
    manager = new SessionManager({
      workspaceDir: tempDir,
      stateDir: tempDir,
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      sessionScope: 'per-peer',
      identityPrompt: 'You are a test agent.',
    })
  })

  afterEach(async () => {
    await manager.stopAll()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates a new session for unknown channel key', async () => {
    const session = await manager.getOrCreate('telegram:123')
    expect(session).toBeDefined()
    expect(session.isAlive()).toBe(true)
  })

  it('returns same session for same channel key', async () => {
    const s1 = await manager.getOrCreate('telegram:123')
    const s2 = await manager.getOrCreate('telegram:123')
    expect(s1).toBe(s2)
  })

  it('creates different sessions for different peers', async () => {
    const s1 = await manager.getOrCreate('telegram:123')
    const s2 = await manager.getOrCreate('telegram:456')
    expect(s1).not.toBe(s2)
  })

  it('uses main scope when configured', async () => {
    const mainManager = new SessionManager({
      workspaceDir: tempDir,
      stateDir: tempDir,
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      sessionScope: 'main',
      identityPrompt: '',
    })
    const s1 = await mainManager.getOrCreate('telegram:123')
    const s2 = await mainManager.getOrCreate('telegram:456')
    expect(s1).toBe(s2)
    await mainManager.stopAll()
  })

  it('lists active sessions', async () => {
    await manager.getOrCreate('telegram:123')
    await manager.getOrCreate('telegram:456')
    const sessions = manager.listSessions()
    expect(sessions).toHaveLength(2)
  })

  it('resets a session', async () => {
    await manager.getOrCreate('telegram:123')
    await manager.reset('telegram:123')
    const sessions = manager.listSessions()
    expect(sessions).toHaveLength(0)
  })
})
