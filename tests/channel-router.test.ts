import { describe, it, expect, vi } from 'vitest'
import { ChannelRouter } from '../src/channel-router.js'
import type { ChannelAdapter, IncomingMessage } from '../src/types.js'

function createMockAdapter(name: string): ChannelAdapter & { triggerMessage: (msg: IncomingMessage) => void } {
  let handler: ((msg: IncomingMessage) => void) | null = null
  return {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: (h) => { handler = h },
    send: vi.fn().mockResolvedValue(undefined),
    triggerMessage: (msg) => { handler?.(msg) },
  }
}

describe('ChannelRouter', () => {
  it('routes incoming message to handler', () => {
    const adapter = createMockAdapter('telegram')
    const router = new ChannelRouter()
    router.addAdapter(adapter)

    const received: IncomingMessage[] = []
    router.onMessage((msg) => received.push(msg))

    adapter.triggerMessage({
      channelKey: 'telegram:123',
      peerId: '123',
      text: 'hello',
    })

    expect(received).toHaveLength(1)
    expect(received[0].text).toBe('hello')
  })

  it('sends response to correct adapter', async () => {
    const tg = createMockAdapter('telegram')
    const im = createMockAdapter('imessage')
    const router = new ChannelRouter()
    router.addAdapter(tg)
    router.addAdapter(im)

    await router.send('telegram', '123', 'response text')
    expect(tg.send).toHaveBeenCalledWith('123', 'response text', undefined)
    expect(im.send).not.toHaveBeenCalled()
  })

  it('starts and stops all adapters', async () => {
    const a1 = createMockAdapter('a')
    const a2 = createMockAdapter('b')
    const router = new ChannelRouter()
    router.addAdapter(a1)
    router.addAdapter(a2)

    await router.startAll()
    expect(a1.start).toHaveBeenCalled()
    expect(a2.start).toHaveBeenCalled()

    await router.stopAll()
    expect(a1.stop).toHaveBeenCalled()
    expect(a2.stop).toHaveBeenCalled()
  })
})
