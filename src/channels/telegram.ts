import { Bot } from 'grammy'
import { createLogger } from '../logger.js'
import type { ChannelAdapter, IncomingMessage, SendOptions, TelegramConfig } from '../types.js'

const log = createLogger('telegram')
const MAX_MESSAGE_LENGTH = 4096
const STREAM_EDIT_INTERVAL_MS = 2000

export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text
  return text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n... (truncated)'
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram'
  private bot: Bot
  private messageHandlers: Array<(msg: IncomingMessage) => void> = []
  private readonly config: TelegramConfig

  constructor(config: TelegramConfig) {
    if (!config.botToken) throw new Error('Telegram bot token is required')
    this.config = config
    this.bot = new Bot(config.botToken)
  }

  async start(): Promise<void> {
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      if (this.config.dmPolicy === 'allowlist' && this.config.allowedUsers.length > 0) {
        if (!this.config.allowedUsers.includes(userId)) {
          log.warn('message from non-allowed user', { userId })
          return
        }
      }

      const text = ctx.message.text
      if (text === '/start') {
        await ctx.reply('JeanClaw is ready. Send me a message to get started.')
        return
      }

      const msg: IncomingMessage = {
        channelKey: `telegram:${userId}`,
        peerId: String(userId),
        text,
      }

      for (const handler of this.messageHandlers) {
        handler(msg)
      }
    })

    this.bot.catch((err) => {
      log.error('bot error', { error: err.message })
    })

    log.info('starting telegram bot')
    this.bot.start()
  }

  async stop(): Promise<void> {
    log.info('stopping telegram bot')
    await this.bot.stop()
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  async send(peerId: string, text: string, _options?: SendOptions): Promise<void> {
    const chatId = parseInt(peerId, 10)
    const truncated = truncateForTelegram(text)

    try {
      await this.bot.api.sendMessage(chatId, truncated, { parse_mode: 'Markdown' })
    } catch {
      try {
        await this.bot.api.sendMessage(chatId, truncated)
      } catch (err2) {
        log.error('failed to send message', { peerId, error: (err2 as Error).message })
      }
    }
  }

  async sendStreaming(peerId: string, chunks: AsyncIterable<string>): Promise<void> {
    const chatId = parseInt(peerId, 10)
    let sentMsg: { message_id: number } | null = null
    let fullText = ''
    let lastEdit = 0

    for await (const chunk of chunks) {
      fullText += chunk
      const now = Date.now()

      if (!sentMsg) {
        sentMsg = await this.bot.api.sendMessage(chatId, truncateForTelegram(fullText))
        lastEdit = now
      } else if (now - lastEdit >= STREAM_EDIT_INTERVAL_MS) {
        try {
          await this.bot.api.editMessageText(chatId, sentMsg.message_id, truncateForTelegram(fullText))
          lastEdit = now
        } catch { /* edit can fail if text unchanged */ }
      }
    }

    if (sentMsg && fullText) {
      try {
        await this.bot.api.editMessageText(chatId, sentMsg.message_id, truncateForTelegram(fullText))
      } catch { /* ignore if identical */ }
    }
  }
}
