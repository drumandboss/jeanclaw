import { loadConfig, resolveConfigPath } from './config.js'
import { SessionManager } from './session-manager.js'
import { ChannelRouter } from './channel-router.js'
import { Scheduler } from './scheduler.js'
import { loadIdentity } from './identity.js'
import { TelegramAdapter } from './channels/telegram.js'
import { iMessageAdapter } from './channels/imessage.js'
import { HttpAdapter } from './channels/http.js'
import { createLogger } from './logger.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { JeanClawConfig, CronJob, CommandType } from './types.js'

const log = createLogger('daemon')

function extractText(message: unknown): string {
  if (typeof message === 'string') return message
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>
    // Claude API format: { content: [{ type: 'text', text: '...' }] }
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<Record<string, unknown>>)
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
    }
    // Fallback: try .text or .content as string
    if (typeof msg.text === 'string') return msg.text
    if (typeof msg.content === 'string') return msg.content
  }
  return String(message)
}

/** User-friendly error messages */
function friendlyError(err: Error): string {
  const msg = err.message.toLowerCase()
  if (msg.includes('circuit breaker')) {
    return "I'm having trouble right now. Please try again in a minute."
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'That took too long. Try asking again, maybe with a simpler request.'
  }
  return 'Something went wrong. Try sending your message again.'
}

interface QueueEntry {
  readonly text: string
  readonly peerId: string
  readonly channelKey: string
}

export class Daemon {
  private sessionManager: SessionManager | null = null
  private router: ChannelRouter | null = null
  private scheduler: Scheduler | null = null
  private config: JeanClawConfig | null = null
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null

  // Per-key message queue
  private readonly messageQueues = new Map<string, QueueEntry[]>()
  private readonly processingKeys = new Set<string>()

  // Error cooldown: track last error time per peer
  private readonly lastErrorTime = new Map<string, number>()
  private static readonly ERROR_COOLDOWN_MS = 60_000

  async start(configPath?: string): Promise<void> {
    log.info('starting JeanClaw daemon')

    this.config = await loadConfig(configPath ?? resolveConfigPath())

    // Load identity from workspace + JeanClaw self-management guide
    const workspaceIdentity = await loadIdentity(this.config.workspace)
    let jeanclawGuide = ''
    try {
      jeanclawGuide = await readFile(join(homedir(), 'jeanclaw', 'JEANCLAW.md'), 'utf-8')
    } catch { /* not found is fine */ }
    const identityPrompt = [workspaceIdentity, jeanclawGuide].filter(Boolean).join('\n\n---\n\n')

    const stateDir = join(homedir(), '.jeanclaw')
    this.sessionManager = new SessionManager({
      workspaceDir: this.config.workspace,
      stateDir,
      model: this.config.model,
      permissionMode: this.config.permissionMode,
      effort: this.config.effort,
      maxBudgetUsd: this.config.maxBudgetUsd,
      sessionScope: this.config.sessionScope,
      identityPrompt,
    })

    this.router = new ChannelRouter()

    if (this.config.channels.telegram.enabled) {
      const tgAdapter = new TelegramAdapter(this.config.channels.telegram)
      // Wire slash commands
      tgAdapter.onCommand(async (channelKey: string, command: CommandType) => {
        return this.handleCommand(channelKey, command)
      })
      this.router.addAdapter(tgAdapter)
    }

    if (this.config.channels.imessage.enabled) {
      this.router.addAdapter(new iMessageAdapter(this.config.channels.imessage))
    }

    if (this.config.channels.http.enabled) {
      const httpAdapter = new HttpAdapter(this.config.channels.http)
      httpAdapter.setStatusProvider(() => ({
        sessions: this.sessionManager?.listSessions() ?? [],
        config: {
          model: this.config!.model,
          sessionScope: this.config!.sessionScope,
          workspace: this.config!.workspace,
        },
      }))
      this.router.addAdapter(httpAdapter)
    }

    // Wire messages: channel -> queue -> session -> channel
    this.router.onMessage((msg) => {
      this.enqueueMessage({
        text: msg.text,
        peerId: msg.peerId,
        channelKey: msg.channelKey,
      })
    })

    // Scheduler
    this.scheduler = new Scheduler({
      heartbeat: this.config.heartbeat,
      crons: this.config.crons,
      quietHours: this.config.quietHours,
      onHeartbeat: async () => {
        log.info('heartbeat triggered')
        try {
          const heartbeatContent = await readFile(
            join(this.config!.workspace, 'HEARTBEAT.md'),
            'utf-8'
          )
          const session = await this.sessionManager!.getOrCreate('__heartbeat__')

          const responsePromise = new Promise<string>((resolve) => {
            let text = ''
            const onEvent = (event: Record<string, unknown>) => {
              if (event.type === 'assistant' && event.message) text = extractText(event.message)
              if (event.type === 'result') {
                session.removeListener('event', onEvent)
                resolve(text)
              }
            }
            session.on('event', onEvent)
            setTimeout(() => { session.removeListener('event', onEvent); resolve(text) }, 300_000)
          })

          session.send(
            `Heartbeat check. Follow these instructions:\n\n${heartbeatContent}\n\nIf nothing needs the user's attention, respond with ONLY the word SILENT. If something needs attention, respond normally.`
          )
          const response = await responsePromise

          if (response && response.trim() !== 'SILENT') {
            await this.deliverToDefaultChannel(response)
          }
        } catch (err) {
          log.error('heartbeat execution failed', { error: (err as Error).message })
        }
      },
      onCron: async (job: CronJob) => {
        log.info('cron job triggered', { id: job.id })
        try {
          const session = await this.sessionManager!.getOrCreate(
            job.session === 'isolated' ? `__cron_${job.id}__` : '__cron_shared__'
          )

          const responsePromise = new Promise<string>((resolve) => {
            let text = ''
            const onEvent = (event: Record<string, unknown>) => {
              if (event.type === 'assistant' && event.message) text = extractText(event.message)
              if (event.type === 'result') {
                session.removeListener('event', onEvent)
                resolve(text)
              }
            }
            session.on('event', onEvent)
            setTimeout(() => { session.removeListener('event', onEvent); resolve(text) }, 300_000)
          })

          session.send(job.prompt)
          const response = await responsePromise

          if (response && job.deliverTo) {
            const [channelName, peerId] = job.deliverTo.split(':')
            await this.router!.send(channelName, peerId, response)
          }
        } catch (err) {
          log.error('cron execution failed', { id: job.id, error: (err as Error).message })
        }
      },
    })

    await this.router.startAll()
    this.scheduler.start()

    // Daily reset at 4:00 AM
    this.scheduleDailyReset()

    log.info('JeanClaw daemon started', {
      workspace: this.config.workspace,
      model: this.config.model,
      channels: {
        telegram: this.config.channels.telegram.enabled,
        imessage: this.config.channels.imessage.enabled,
        http: this.config.channels.http.enabled,
      },
    })
  }

  async stop(): Promise<void> {
    log.info('stopping JeanClaw daemon')
    this.scheduler?.stop()
    if (this.dailyResetTimer) {
      clearInterval(this.dailyResetTimer)
      this.dailyResetTimer = null
    }
    await this.router?.stopAll()
    await this.sessionManager?.stopAll()
    log.info('JeanClaw daemon stopped')
  }

  private enqueueMessage(entry: QueueEntry): void {
    const key = entry.channelKey
    if (this.processingKeys.has(key)) {
      // Queue it
      const queue = this.messageQueues.get(key) ?? []
      this.messageQueues.set(key, [...queue, entry])
      log.debug('message queued', { channelKey: key, queueSize: queue.length + 1 })
      return
    }

    // Process immediately
    this.processMessage(entry)
  }

  private async processMessage(entry: QueueEntry): Promise<void> {
    const { channelKey, peerId, text } = entry
    this.processingKeys.add(channelKey)

    try {
      const session = await this.sessionManager!.getOrCreate(channelKey)
      const [channelName] = channelKey.split(':')

      // Send initial typing indicator
      this.sendTypingIndicator(channelName, peerId)

      // Keep typing indicator alive every 4 seconds while processing
      const typingInterval = setInterval(() => {
        this.sendTypingIndicator(channelName, peerId)
      }, 4000)

      // Streaming: collect partial text and edit message periodically
      let sentMessageId: number | null = null
      let fullResponse = ''
      let lastStreamEdit = 0
      const STREAM_INTERVAL = 2000

      const responsePromise = new Promise<string>((resolve) => {
        const onEvent = (event: Record<string, unknown>) => {
          if (event.type === 'assistant_partial' && event.message) {
            const partial = extractText(event.message)
            if (partial) {
              fullResponse = partial
              this.maybeStreamUpdate(channelName, peerId, fullResponse, sentMessageId, lastStreamEdit, STREAM_INTERVAL)
                .then((result) => {
                  if (result.messageId) sentMessageId = result.messageId
                  if (result.editTime) lastStreamEdit = result.editTime
                })
                .catch(() => { /* ignore stream errors */ })
            }
          }
          if (event.type === 'assistant' && event.message) {
            fullResponse = extractText(event.message)
          }
          if (event.type === 'result') {
            session.removeListener('event', onEvent)
            resolve(fullResponse)
          }
        }
        session.on('event', onEvent)
        setTimeout(() => {
          session.removeListener('event', onEvent)
          resolve(fullResponse || 'Request timed out.')
        }, 300_000)
      })

      session.send(text)
      const response = await responsePromise
      clearInterval(typingInterval)

      if (response) {
        if (sentMessageId) {
          // We already have a streaming message; edit it with final text, then send remaining chunks
          try {
            const adapter = this.router!.getAdapter(channelName)
            if (adapter && 'bot' in adapter) {
              const { splitForTelegram, markdownToTelegramHtml } = await import('./channels/telegram.js')
              const chatId = parseInt(peerId, 10)
              const chunks = splitForTelegram(response)

              // Edit first message
              const html = markdownToTelegramHtml(chunks[0])
              try {
                await (adapter as any).bot.api.editMessageText(chatId, sentMessageId, html, { parse_mode: 'HTML' })
              } catch {
                try {
                  await (adapter as any).bot.api.editMessageText(chatId, sentMessageId, chunks[0])
                } catch { /* ignore */ }
              }

              // Send remaining chunks
              for (let i = 1; i < chunks.length; i++) {
                await this.router!.send(channelName, peerId, chunks[i])
              }
            } else {
              await this.router!.send(channelName, peerId, response)
            }
          } catch {
            await this.router!.send(channelName, peerId, response)
          }
        } else {
          await this.router!.send(channelName, peerId, response)
        }
      }
    } catch (err) {
      log.error('message handling failed', { channelKey, error: (err as Error).message })
      await this.sendErrorIfAllowed(channelKey, peerId, err as Error)
    } finally {
      this.processingKeys.delete(channelKey)
      // Process next in queue
      this.processNextInQueue(channelKey)
    }
  }

  private processNextInQueue(channelKey: string): void {
    const queue = this.messageQueues.get(channelKey)
    if (!queue || queue.length === 0) {
      this.messageQueues.delete(channelKey)
      return
    }
    const [next, ...rest] = queue
    this.messageQueues.set(channelKey, rest)
    this.processMessage(next)
  }

  private async sendErrorIfAllowed(channelKey: string, peerId: string, err: Error): Promise<void> {
    const now = Date.now()
    const lastError = this.lastErrorTime.get(peerId) ?? 0
    if (now - lastError < Daemon.ERROR_COOLDOWN_MS) {
      log.debug('error cooldown active, suppressing error message', { peerId })
      return
    }
    this.lastErrorTime.set(peerId, now)

    const [errChannel] = channelKey.split(':')
    const friendly = friendlyError(err)
    try {
      await this.router!.send(errChannel, peerId, friendly)
    } catch (sendErr) {
      log.error('failed to send error message', { error: (sendErr as Error).message })
    }
  }

  private sendTypingIndicator(channelName: string, peerId: string): void {
    try {
      const adapter = this.router!.getAdapter(channelName)
      if (adapter && 'bot' in adapter) {
        const chatId = parseInt(peerId, 10)
        ;(adapter as any).bot.api.sendChatAction(chatId, 'typing').catch(() => { /* ignore */ })
      }
    } catch { /* ignore typing errors */ }
  }

  private async maybeStreamUpdate(
    channelName: string,
    peerId: string,
    text: string,
    sentMessageId: number | null,
    lastEditTime: number,
    interval: number,
  ): Promise<{ messageId: number | null; editTime: number }> {
    const now = Date.now()
    const adapter = this.router!.getAdapter(channelName)

    if (!adapter || !('bot' in adapter)) {
      return { messageId: sentMessageId, editTime: lastEditTime }
    }

    const chatId = parseInt(peerId, 10)
    const displayText = text.length > 4096
      ? text.slice(0, 4076) + '\n... (streaming)'
      : text

    if (!sentMessageId) {
      // Send first streaming message
      try {
        const sent = await (adapter as any).bot.api.sendMessage(chatId, displayText)
        return { messageId: sent.message_id, editTime: now }
      } catch {
        return { messageId: null, editTime: lastEditTime }
      }
    }

    if (now - lastEditTime >= interval) {
      try {
        await (adapter as any).bot.api.editMessageText(chatId, sentMessageId, displayText)
        return { messageId: sentMessageId, editTime: now }
      } catch { /* ignore edit failures */ }
    }

    return { messageId: sentMessageId, editTime: lastEditTime }
  }

  private async handleCommand(channelKey: string, command: CommandType): Promise<string> {
    if (!this.sessionManager) return 'Not initialized.'

    switch (command) {
      case 'reset':
      case 'new': {
        await this.sessionManager.reset(channelKey)
        return 'Session reset. Send a message to start fresh.'
      }
      case 'status': {
        const info = this.sessionManager.getSessionInfo(channelKey)
        if (!info) return 'No active session.'
        const lastActiveAgo = Math.round((Date.now() - info.lastActivity) / 1000)
        return [
          `Session: ${info.sessionId ?? 'unknown'}`,
          `Status: ${info.alive ? 'alive' : 'dead'}`,
          `Turns: ${info.turnCount}`,
          `Last active: ${lastActiveAgo}s ago`,
        ].join('\n')
      }
      case 'compact': {
        await this.sessionManager.compact(channelKey)
        return 'Compact requested. The session context will be compressed.'
      }
    }
  }

  private scheduleDailyReset(): void {
    // Check every 60 seconds if it's 4:00 AM
    this.dailyResetTimer = setInterval(async () => {
      const now = new Date()
      if (now.getHours() === 4 && now.getMinutes() === 0) {
        log.info('daily 4 AM session reset triggered')
        try {
          await this.sessionManager?.resetAll()
        } catch (err) {
          log.error('daily reset failed', { error: (err as Error).message })
        }
      }
    }, 60_000)
  }

  private async deliverToDefaultChannel(text: string): Promise<void> {
    if (!this.router || !this.config) return

    if (this.config.channels.telegram.enabled && this.config.channels.telegram.allowedUsers.length > 0) {
      const peerId = String(this.config.channels.telegram.allowedUsers[0])
      await this.router.send('telegram', peerId, text)
    }
  }
}
