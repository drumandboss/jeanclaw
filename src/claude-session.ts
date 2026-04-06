import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { createLogger } from './logger.js'
import type { ClaudeEvent } from './types.js'

const log = createLogger('claude-session')

export interface ClaudeSessionOptions {
  readonly workspaceDir: string
  readonly model: string
  readonly permissionMode: string
  readonly effort?: string
  readonly maxBudgetUsd?: number | null
  readonly appendSystemPrompt?: string
  readonly allowedTools?: readonly string[]
  readonly disallowedTools?: readonly string[]
  readonly resumeSessionId?: string
}

export class ClaudeSession extends EventEmitter {
  private proc: ChildProcess | null = null
  private rl: ReadlineInterface | null = null
  private readonly opts: ClaudeSessionOptions
  private _sessionId: string | undefined
  private _lastActivity: number = 0
  private _turnCount: number = 0

  constructor(opts: ClaudeSessionOptions) {
    super()
    this.opts = opts
    this._sessionId = opts.resumeSessionId
  }

  get sessionId(): string | undefined {
    return this._sessionId
  }

  get lastActivity(): number {
    return this._lastActivity
  }

  get turnCount(): number {
    return this._turnCount
  }

  isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  buildSpawnArgs(): string[] {
    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', this.opts.model,
      '--permission-mode', this.opts.permissionMode,
    ]

    if (this._sessionId) {
      args.push('--resume', this._sessionId)
    }
    if (this.opts.effort) {
      args.push('--effort', this.opts.effort)
    }
    if (this.opts.maxBudgetUsd != null) {
      args.push('--max-budget-usd', String(this.opts.maxBudgetUsd))
    }
    if (this.opts.appendSystemPrompt) {
      args.push('--append-system-prompt', this.opts.appendSystemPrompt)
    }
    if (this.opts.allowedTools?.length) {
      args.push('--allowed-tools', ...this.opts.allowedTools)
    }
    if (this.opts.disallowedTools?.length) {
      args.push('--disallowed-tools', ...this.opts.disallowedTools)
    }

    return args
  }

  start(): void {
    if (this.isAlive()) return

    const args = this.buildSpawnArgs()
    log.info('spawning claude subprocess', { cwd: this.opts.workspaceDir, args })

    this.proc = spawn('claude', args, {
      cwd: this.opts.workspaceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this.rl = createInterface({ input: this.proc.stdout! })
    this.rl.on('line', (line) => {
      const event = this.parseLine(line)
      if (!event) return

      this._lastActivity = Date.now()

      if (event.type === 'system' && event.session_id) {
        this._sessionId = event.session_id
      }

      this.emit('event', event)
    })

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      log.debug('claude stderr', { data: chunk.toString().trim() })
    })

    this.proc.on('exit', (code, signal) => {
      log.info('claude subprocess exited', { code, signal, sessionId: this._sessionId })
      this.proc = null
      this.rl = null
      this.emit('exit', { code, signal })
    })

    this.proc.on('error', (err) => {
      log.error('claude subprocess error', { error: err.message })
      this.emit('error', err)
    })
  }

  send(text: string): void {
    if (!this.isAlive() || !this.proc?.stdin?.writable) {
      throw new Error('Session is not alive')
    }

    this._turnCount++
    const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
    this.proc.stdin.write(payload + '\n')
    log.debug('sent message', { sessionId: this._sessionId, turnCount: this._turnCount })
  }

  async stop(): Promise<void> {
    if (!this.proc) return

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('subprocess did not exit gracefully, sending SIGKILL')
        this.proc?.kill('SIGKILL')
      }, 3000)

      this.proc!.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })

      this.proc!.kill('SIGTERM')
    })
  }

  parseLine(line: string): ClaudeEvent | null {
    if (!line.trim()) return null
    try {
      return JSON.parse(line) as ClaudeEvent
    } catch {
      return null
    }
  }
}
