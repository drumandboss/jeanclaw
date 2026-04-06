import { Bot } from 'grammy'
import { createLogger } from '../logger.js'
import type { ChannelAdapter, IncomingMessage, SendOptions, TelegramConfig, CommandCallback, CommandType } from '../types.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const log = createLogger('telegram')
const MAX_MESSAGE_LENGTH = 4096
const STREAM_EDIT_INTERVAL_MS = 2000

/** Convert Claude markdown to Telegram-safe HTML */
export function markdownToTelegramHtml(text: string): string {
  // First, escape HTML entities in the raw text, but we need to be careful
  // about code blocks. Process in stages.

  const codeBlocks: Array<{ placeholder: string; html: string }> = []
  let counter = 0

  // Extract fenced code blocks first
  let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const placeholder = `__CODEBLOCK_${counter++}__`
    const escaped = escapeHtml(code.trimEnd())
    codeBlocks.push({ placeholder, html: `<pre>${escaped}</pre>` })
    return placeholder
  })

  // Extract inline code
  processed = processed.replace(/`([^`]+)`/g, (_match, code) => {
    const placeholder = `__CODEBLOCK_${counter++}__`
    const escaped = escapeHtml(code)
    codeBlocks.push({ placeholder, html: `<code>${escaped}</code>` })
    return placeholder
  })

  // Now escape remaining HTML
  processed = escapeHtml(processed)

  // Convert markdown bold **text** to <b>text</b>
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  // Convert markdown italic *text* to <i>text</i> (but not inside bold)
  processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')

  // Restore code blocks
  for (const block of codeBlocks) {
    processed = processed.replace(block.placeholder, block.html)
  }

  return processed
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Split long messages into chunks at paragraph/newline boundaries.
 * Each chunk is at most maxLen characters.
 */
export function splitForTelegram(text: string, maxLen: number = MAX_MESSAGE_LENGTH): readonly string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    // Try to split at double newline (paragraph break)
    let splitAt = remaining.lastIndexOf('\n\n', maxLen)
    if (splitAt <= 0 || splitAt < maxLen * 0.3) {
      // Try single newline
      splitAt = remaining.lastIndexOf('\n', maxLen)
    }
    if (splitAt <= 0 || splitAt < maxLen * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitAt <= 0) {
      // Hard split as last resort
      splitAt = maxLen
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, '')
  }

  return chunks
}

// Keep the old export for backward compatibility in tests
export function truncateForTelegram(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text
  return text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n... (truncated)'
}

const TELEGRAM_FILE_BASE = 'https://api.telegram.org/file/bot'

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram'
  readonly bot: Bot
  private messageHandlers: Array<(msg: IncomingMessage) => void> = []
  private commandCallback: CommandCallback | null = null
  private readonly config: TelegramConfig

  constructor(config: TelegramConfig) {
    if (!config.botToken) throw new Error('Telegram bot token is required')
    this.config = config
    this.bot = new Bot(config.botToken)
  }

  /** Register a callback for slash commands (/new, /reset, /status, /compact) */
  onCommand(callback: CommandCallback): void {
    this.commandCallback = callback
  }

  async start(): Promise<void> {
    // Text message handler
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return

      if (!this.isAllowed(userId)) {
        log.warn('message from non-allowed user', { userId })
        return
      }

      const text = ctx.message.text

      // Handle /start
      if (text === '/start') {
        await ctx.reply('JeanClaw is ready. Send me a message to get started.')
        return
      }

      // Handle slash commands
      const command = this.parseCommand(text)
      if (command) {
        await this.handleCommand(ctx, userId, command)
        return
      }

      // Show typing indicator immediately
      await ctx.replyWithChatAction('typing')

      const msg: IncomingMessage = {
        channelKey: `telegram:${userId}`,
        peerId: String(userId),
        text,
      }

      for (const handler of this.messageHandlers) {
        handler(msg)
      }
    })

    // Photo handler
    this.bot.on('message:photo', async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return
      if (!this.isAllowed(userId)) return

      await ctx.replyWithChatAction('typing')

      try {
        const photos = ctx.message.photo
        // Largest photo is last in the array
        const largest = photos[photos.length - 1]
        const file = await ctx.api.getFile(largest.file_id)
        const fileUrl = `${TELEGRAM_FILE_BASE}${this.config.botToken}/${file.file_path}`

        const response = await fetch(fileUrl)
        if (!response.ok) throw new Error(`Failed to download photo: ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        const tmpDir = join(tmpdir(), 'jeanclaw-media')
        await mkdir(tmpDir, { recursive: true })
        const filePath = join(tmpDir, `${randomUUID()}.jpg`)
        await writeFile(filePath, buffer)

        const caption = ctx.message.caption ?? ''
        const textContent = caption
          ? `[User sent an image with caption: "${caption}"] The image file is at: ${filePath}`
          : `[User sent an image] The image file is at: ${filePath}`

        const msg: IncomingMessage = {
          channelKey: `telegram:${userId}`,
          peerId: String(userId),
          text: textContent,
          mediaPath: filePath,
        }

        for (const handler of this.messageHandlers) {
          handler(msg)
        }
      } catch (err) {
        log.error('photo handling failed', { error: (err as Error).message })
        await ctx.reply('Failed to process that image. Try again?')
      }
    })

    // Voice message handler
    this.bot.on('message:voice', async (ctx) => {
      const userId = ctx.from?.id
      if (!userId) return
      if (!this.isAllowed(userId)) return

      await ctx.replyWithChatAction('typing')

      try {
        const voice = ctx.message.voice
        const file = await ctx.api.getFile(voice.file_id)
        const fileUrl = `${TELEGRAM_FILE_BASE}${this.config.botToken}/${file.file_path}`

        const response = await fetch(fileUrl)
        if (!response.ok) throw new Error(`Failed to download voice: ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        const tmpDir = join(tmpdir(), 'jeanclaw-media')
        await mkdir(tmpDir, { recursive: true })
        const filePath = join(tmpDir, `${randomUUID()}.ogg`)
        await writeFile(filePath, buffer)

        const msg: IncomingMessage = {
          channelKey: `telegram:${userId}`,
          peerId: String(userId),
          text: `[User sent a voice message. The audio file is at: ${filePath} — please describe what you can help with.]`,
          mediaPath: filePath,
        }

        for (const handler of this.messageHandlers) {
          handler(msg)
        }
      } catch (err) {
        log.error('voice handling failed', { error: (err as Error).message })
        await ctx.reply('Failed to process that voice message. Try again?')
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
    const chunks = splitForTelegram(text)

    for (const chunk of chunks) {
      await this.sendSingleMessage(chatId, chunk)
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
        const firstChunks = splitForTelegram(fullText)
        sentMsg = await this.bot.api.sendMessage(chatId, firstChunks[0])
        lastEdit = now
      } else if (now - lastEdit >= STREAM_EDIT_INTERVAL_MS) {
        try {
          // Only edit the first message with the latest accumulated text (up to limit)
          const editText = fullText.length > MAX_MESSAGE_LENGTH
            ? fullText.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n... (streaming)'
            : fullText
          await this.bot.api.editMessageText(chatId, sentMsg.message_id, editText)
          lastEdit = now
        } catch { /* edit can fail if text unchanged */ }
      }
    }

    // Final: send all chunks properly
    if (sentMsg && fullText) {
      const allChunks = splitForTelegram(fullText)
      try {
        // Edit first message with final first chunk
        await this.sendEditOrFallback(chatId, sentMsg.message_id, allChunks[0])
      } catch { /* ignore if identical */ }

      // Send remaining chunks as new messages
      for (let i = 1; i < allChunks.length; i++) {
        await this.sendSingleMessage(chatId, allChunks[i])
      }
    }
  }

  private isAllowed(userId: number): boolean {
    if (this.config.dmPolicy === 'allowlist' && this.config.allowedUsers.length > 0) {
      return this.config.allowedUsers.includes(userId)
    }
    return true
  }

  private parseCommand(text: string): CommandType | null {
    const trimmed = text.trim().toLowerCase()
    if (trimmed === '/new' || trimmed === '/reset') return 'reset'
    if (trimmed === '/status') return 'status'
    if (trimmed === '/compact') return 'compact'
    return null
  }

  private async handleCommand(ctx: { reply: (text: string) => Promise<unknown> }, userId: number, command: CommandType): Promise<void> {
    if (!this.commandCallback) {
      await ctx.reply('Commands are not configured.')
      return
    }

    try {
      const result = await this.commandCallback(`telegram:${userId}`, command)
      await ctx.reply(result)
    } catch (err) {
      log.error('command handler failed', { command, error: (err as Error).message })
      await ctx.reply('Command failed. Try again.')
    }
  }

  private async sendSingleMessage(chatId: number, text: string): Promise<void> {
    const html = markdownToTelegramHtml(text)
    try {
      await this.bot.api.sendMessage(chatId, html, { parse_mode: 'HTML' })
    } catch {
      // Fallback: try plain text if HTML parsing failed
      try {
        await this.bot.api.sendMessage(chatId, text)
      } catch (err2) {
        log.error('failed to send message', { chatId, error: (err2 as Error).message })
      }
    }
  }

  private async sendEditOrFallback(chatId: number, messageId: number, text: string): Promise<void> {
    const html = markdownToTelegramHtml(text)
    try {
      await this.bot.api.editMessageText(chatId, messageId, html, { parse_mode: 'HTML' })
    } catch {
      try {
        await this.bot.api.editMessageText(chatId, messageId, text)
      } catch { /* ignore if identical */ }
    }
  }
}
