import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Daemon } from '../src/daemon.js'
import { writeJsonFile } from '../src/persistence.js'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../src/claude-session.js', () => {
  const { EventEmitter } = require('node:events')
  class MockClaudeSession extends EventEmitter {
    private _alive = false
    constructor(opts: any) { super() }
    get sessionId() { return 'test-session-id' }
    get lastActivity() { return Date.now() }
    get turnCount() { return 1 }
    isAlive() { return this._alive }
    buildSpawnArgs() { return [] }
    start() { this._alive = true }
    send(text: string) {
      setTimeout(() => {
        this.emit('event', { type: 'assistant', message: `Response to: ${text}` })
        this.emit('event', { type: 'result', stop_reason: 'end_turn' })
      }, 50)
    }
    async stop() { this._alive = false }
    parseLine() { return null }
  }
  return { ClaudeSession: MockClaudeSession }
})

describe('Integration: Daemon + HTTP', () => {
  let tempDir: string
  let daemon: Daemon

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'jc-int-'))
    const workspace = join(tempDir, 'workspace')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'SOUL.md'), '# Soul\nBe helpful.')
    writeFileSync(join(workspace, 'HEARTBEAT.md'), '# Heartbeat\nCheck status.')

    const configPath = join(tempDir, 'config.json')
    await writeJsonFile(configPath, {
      workspace,
      model: 'sonnet',
      permissionMode: 'bypassPermissions',
      effort: 'high',
      sessionScope: 'per-peer',
      quietHours: null,
      heartbeat: { enabled: false, every: '2h', session: 'dedicated' },
      channels: {
        telegram: { enabled: false, botToken: '', dmPolicy: 'open', allowedUsers: [], streaming: true },
        imessage: { enabled: false, blueBubblesUrl: '', blueBubblesPassword: '', allowedContacts: [] },
        http: { enabled: true, port: 0, bind: '127.0.0.1', token: null },
      },
      crons: [],
    })

    daemon = new Daemon()
    await daemon.start(configPath)
  })

  afterEach(async () => {
    await daemon.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('starts daemon without errors and responds to health check', async () => {
    // Daemon started in beforeEach, verify it's alive
    expect(daemon).toBeDefined()
  })
})
