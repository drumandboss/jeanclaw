import { Cron } from 'croner'
import { createLogger } from './logger.js'
import type { CronJob } from './types.js'

const log = createLogger('scheduler')

export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(h|m|s)$/)
  if (!match) throw new Error(`Invalid interval format: ${str}. Use format like "2h", "30m", "45s"`)

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'h': return value * 60 * 60 * 1000
    case 'm': return value * 60 * 1000
    case 's': return value * 1000
    default: throw new Error(`Unknown unit: ${unit}`)
  }
}

function isInQuietHours(quietHours: { start: string; end: string } | null): boolean {
  if (!quietHours) return false

  const now = new Date()
  const [startH, startM] = quietHours.start.split(':').map(Number)
  const [endH, endM] = quietHours.end.split(':').map(Number)

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }
  // Wraps midnight (e.g., 23:00-08:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

export interface SchedulerOptions {
  readonly heartbeat: {
    readonly enabled: boolean
    readonly every: string
    readonly session: string
  }
  readonly crons: readonly CronJob[]
  readonly quietHours: { readonly start: string; readonly end: string } | null
  readonly onHeartbeat: () => Promise<void>
  readonly onCron: (job: CronJob) => Promise<void>
}

export class Scheduler {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private cronJobs: Cron[] = []
  private readonly opts: SchedulerOptions

  constructor(opts: SchedulerOptions) {
    this.opts = opts
  }

  start(): void {
    if (this.opts.heartbeat.enabled) {
      const intervalMs = parseInterval(this.opts.heartbeat.every)
      log.info('starting heartbeat', { every: this.opts.heartbeat.every, intervalMs })

      this.heartbeatTimer = setInterval(async () => {
        if (isInQuietHours(this.opts.quietHours)) {
          log.debug('skipping heartbeat during quiet hours')
          return
        }
        try {
          await this.opts.onHeartbeat()
        } catch (err) {
          log.error('heartbeat failed', { error: (err as Error).message })
        }
      }, intervalMs)
    }

    for (const job of this.opts.crons) {
      log.info('scheduling cron job', { id: job.id, schedule: job.schedule, timezone: job.timezone })
      const cronJob = new Cron(job.schedule, { timezone: job.timezone }, async () => {
        if (isInQuietHours(this.opts.quietHours)) {
          log.debug('skipping cron during quiet hours', { id: job.id })
          return
        }
        try {
          await this.opts.onCron(job)
        } catch (err) {
          log.error('cron job failed', { id: job.id, error: (err as Error).message })
        }
      })
      this.cronJobs.push(cronJob)
    }
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const job of this.cronJobs) {
      job.stop()
    }
    this.cronJobs = []
    log.info('scheduler stopped')
  }

  async runCronNow(jobId: string): Promise<void> {
    const job = this.opts.crons.find((j) => j.id === jobId)
    if (!job) throw new Error(`Cron job not found: ${jobId}`)
    await this.opts.onCron(job)
  }
}
