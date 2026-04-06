import { describe, it, expect } from 'vitest'
import { TelegramAdapter, truncateForTelegram, splitForTelegram, markdownToTelegramHtml } from '../../src/channels/telegram.js'

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

describe('splitForTelegram', () => {
  it('returns short messages as single chunk', () => {
    const chunks = splitForTelegram('hello world')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('hello world')
  })

  it('splits long messages into multiple chunks', () => {
    const paragraph = 'Line of text here.\n'
    const text = paragraph.repeat(300) // ~5700 chars
    const chunks = splitForTelegram(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
    // Reassembled text should contain all content
    const reassembled = chunks.join('\n')
    expect(reassembled).toContain('Line of text here.')
  })

  it('splits at paragraph boundaries when possible', () => {
    const part1 = 'a'.repeat(3000)
    const part2 = 'b'.repeat(3000)
    const part3 = 'c'.repeat(3000)
    const text = `${part1}\n\n${part2}\n\n${part3}`
    const chunks = splitForTelegram(text)
    expect(chunks.length).toBeGreaterThan(1)
    // First chunk should end at a paragraph boundary (only 'a's)
    expect(chunks[0]).not.toContain('b'.repeat(100))
  })

  it('handles text with no good split points', () => {
    const text = 'x'.repeat(5000)
    const chunks = splitForTelegram(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
  })
})

describe('markdownToTelegramHtml', () => {
  it('converts bold markdown to HTML', () => {
    expect(markdownToTelegramHtml('hello **world**')).toContain('<b>world</b>')
  })

  it('converts inline code to HTML', () => {
    expect(markdownToTelegramHtml('use `npm install`')).toContain('<code>npm install</code>')
  })

  it('converts code blocks to pre tags', () => {
    const md = '```js\nconsole.log("hi")\n```'
    const html = markdownToTelegramHtml(md)
    expect(html).toContain('<pre>')
    expect(html).toContain('</pre>')
  })

  it('escapes HTML entities in regular text', () => {
    expect(markdownToTelegramHtml('a < b & c > d')).toContain('&lt;')
    expect(markdownToTelegramHtml('a < b & c > d')).toContain('&amp;')
    expect(markdownToTelegramHtml('a < b & c > d')).toContain('&gt;')
  })

  it('escapes HTML inside code blocks', () => {
    const md = '```\n<div>test</div>\n```'
    const html = markdownToTelegramHtml(md)
    expect(html).toContain('&lt;div&gt;')
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
