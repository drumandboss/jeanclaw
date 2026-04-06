import { describe, it, expect } from 'vitest'
import { TelegramAdapter, truncateForTelegram } from '../../src/channels/telegram.js'

describe('truncateForTelegram', () => {
  it('returns short messages unchanged', () => {
    expect(truncateForTelegram('hello')).toBe('hello')
  })

  it('truncates messages over 4096 chars', () => {
    const long = 'x'.repeat(5000)
    const result = truncateForTelegram(long)
    expect(result.length).toBeLessThanOrEqual(4096)
    expect(result).toContain('... (truncated)')
  })
})

describe('TelegramAdapter', () => {
  it('throws if bot token is empty', () => {
    expect(() => new TelegramAdapter({
      enabled: true,
      botToken: '',
      dmPolicy: 'open',
      allowedUsers: [],
      streaming: true,
    })).toThrow('bot token is required')
  })
})
