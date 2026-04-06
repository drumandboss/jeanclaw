import { createLogger } from '../logger.js'
import type { ChannelAdapter, IncomingMessage, SendOptions, iMessageConfig } from '../types.js'

const log = createLogger('imessage')
const POLL_INTERVAL_MS = 5000

export class iMessageAdapter implements ChannelAdapter {
  readonly name = 'imessage'
  private messageHandlers: Array<(msg: IncomingMessage) => void> = []
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastTimestamp: number = Date.now()
  private readonly config: iMessageConfig

  constructor(config: iMessageConfig) {
    if (!config.blueBubblesUrl) throw new Error('BlueBubbles URL is required')
    this.config = config
  }

  async start(): Promise<void> {
    log.info('starting iMessage adapter', { url: this.config.blueBubblesUrl })

    this.pollTimer = setInterval(async () => {
      try {
        await this.pollMessages()
      } catch (err) {
        log.error('poll failed', { error: (err as Error).message })
      }
    }, POLL_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  async send(peerId: string, text: string, _options?: SendOptions): Promise<void> {
    const url = `${this.config.blueBubblesUrl}/api/v1/message/text`
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.blueBubblesPassword}`,
        },
        body: JSON.stringify({
          chatGuid: `iMessage;-;${peerId}`,
          message: text,
        }),
      })
    } catch (err) {
      log.error('failed to send iMessage', { peerId, error: (err as Error).message })
    }
  }

  private async pollMessages(): Promise<void> {
    const url = `${this.config.blueBubblesUrl}/api/v1/message?after=${this.lastTimestamp}&limit=50&sort=asc`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.blueBubblesPassword}` },
    })

    if (!res.ok) {
      log.warn('BlueBubbles poll failed', { status: res.status })
      return
    }

    const data = (await res.json()) as { data: Array<{
      dateCreated: number
      isFromMe: boolean
      handle: { address: string } | null
      text: string | null
    }> }

    for (const msg of data.data) {
      if (msg.isFromMe) continue
      if (!msg.text?.trim()) continue

      const sender = msg.handle?.address
      if (!sender) continue

      if (this.config.allowedContacts.length > 0 && !this.config.allowedContacts.includes(sender)) {
        continue
      }

      const incoming: IncomingMessage = {
        channelKey: `imessage:${sender}`,
        peerId: sender,
        text: msg.text,
      }

      for (const handler of this.messageHandlers) {
        handler(incoming)
      }

      this.lastTimestamp = Math.max(this.lastTimestamp, msg.dateCreated)
    }
  }
}
