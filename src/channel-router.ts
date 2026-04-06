import { createLogger } from './logger.js'
import type { ChannelAdapter, IncomingMessage, SendOptions } from './types.js'

const log = createLogger('channel-router')

export class ChannelRouter {
  private readonly adapters = new Map<string, ChannelAdapter>()
  private readonly handlers: Array<(msg: IncomingMessage) => void> = []

  addAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter)
    adapter.onMessage((msg) => {
      log.debug('message received', { channel: adapter.name, peerId: msg.peerId })
      for (const handler of this.handlers) {
        handler(msg)
      }
    })
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.handlers.push(handler)
  }

  async send(adapterName: string, peerId: string, text: string, options?: SendOptions): Promise<void> {
    const adapter = this.adapters.get(adapterName)
    if (!adapter) {
      log.error('adapter not found', { adapterName })
      return
    }
    await adapter.send(peerId, text, options)
  }

  async startAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      log.info('starting channel', { name })
      await adapter.start()
    }
  }

  async stopAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      log.info('stopping channel', { name })
      await adapter.stop()
    }
  }

  getAdapter(name: string): ChannelAdapter | undefined {
    return this.adapters.get(name)
  }
}
