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
import type { JeanClawConfig, CronJob } from './types.js'

const log = createLogger('daemon')

export class Daemon {
  private sessionManager: SessionManager | null = null
  private router: ChannelRouter | null = null
  private scheduler: Scheduler | null = null
  private config: JeanClawConfig | null = null

  async start(configPath?: string): Promise<void> {
    log.info('starting JeanClaw daemon')

    this.config = await loadConfig(configPath ?? resolveConfigPath())
    const identityPrompt = await loadIdentity(this.config.workspace)

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
      this.router.addAdapter(new TelegramAdapter(this.config.channels.telegram))
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

    // Wire messages: channel → session → channel
    this.router.onMessage(async (msg) => {
      try {
        const session = await this.sessionManager!.getOrCreate(msg.channelKey)

        let fullResponse = ''
        const responsePromise = new Promise<string>((resolve) => {
          const onEvent = (event: { type: string; message?: string; content?: string }) => {
            if (event.type === 'assistant' && event.message) {
              fullResponse = event.message
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

        session.send(msg.text)
        const response = await responsePromise

        if (response) {
          const [channelName] = msg.channelKey.split(':')
          await this.router!.send(channelName, msg.peerId, response)
        }
      } catch (err) {
        log.error('message handling failed', { channelKey: msg.channelKey, error: (err as Error).message })
        const [channelName] = msg.channelKey.split(':')
        await this.router!.send(channelName, msg.peerId, `Error: ${(err as Error).message}`)
      }
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
            const onEvent = (event: { type: string; message?: string }) => {
              if (event.type === 'assistant' && event.message) text = event.message
              if (event.type === 'result') {
                session.removeListener('event', onEvent)
                resolve(text)
              }
            }
            session.on('event', onEvent)
            setTimeout(() => { session.removeListener('event', onEvent); resolve(text) }, 300_000)
          })

          session.send(`Heartbeat check. Follow these instructions:\n\n${heartbeatContent}`)
          const response = await responsePromise

          if (response && response.toLowerCase() !== 'heartbeat_ok') {
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
            const onEvent = (event: { type: string; message?: string }) => {
              if (event.type === 'assistant' && event.message) text = event.message
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
    await this.router?.stopAll()
    await this.sessionManager?.stopAll()
    log.info('JeanClaw daemon stopped')
  }

  private async deliverToDefaultChannel(text: string): Promise<void> {
    if (!this.router || !this.config) return

    if (this.config.channels.telegram.enabled && this.config.channels.telegram.allowedUsers.length > 0) {
      const peerId = String(this.config.channels.telegram.allowedUsers[0])
      await this.router.send('telegram', peerId, text)
    }
  }
}
