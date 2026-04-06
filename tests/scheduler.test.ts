import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler, parseInterval } from '../src/scheduler.js'

describe('parseInterval', () => {
  it('parses hours', () => {
    expect(parseInterval('2h')).toBe(2 * 60 * 60 * 1000)
  })

  it('parses minutes', () => {
    expect(parseInterval('30m')).toBe(30 * 60 * 1000)
  })

  it('parses seconds', () => {
    expect(parseInterval('45s')).toBe(45 * 1000)
  })

  it('throws on invalid format', () => {
    expect(() => parseInterval('abc')).toThrow()
  })
})

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires heartbeat callback at interval', async () => {
    const onHeartbeat = vi.fn().mockResolvedValue(undefined)
    const scheduler = new Scheduler({
      heartbeat: { enabled: true, every: '1s', session: 'dedicated' },
      crons: [],
      quietHours: null,
      onHeartbeat,
      onCron: vi.fn(),
    })

    scheduler.start()

    await vi.advanceTimersByTimeAsync(1100)
    expect(onHeartbeat).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onHeartbeat).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('respects quiet hours', async () => {
    const onHeartbeat = vi.fn().mockResolvedValue(undefined)

    // Set time to 23:30 (inside quiet hours 23:00-08:00)
    const quietTime = new Date()
    quietTime.setHours(23, 30, 0, 0)
    vi.setSystemTime(quietTime)

    const scheduler = new Scheduler({
      heartbeat: { enabled: true, every: '1s', session: 'dedicated' },
      crons: [],
      quietHours: { start: '23:00', end: '08:00' },
      onHeartbeat,
      onCron: vi.fn(),
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(1100)

    expect(onHeartbeat).not.toHaveBeenCalled()
    scheduler.stop()
  })
})
