export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let minLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...data,
  }
  const stream = level === 'error' ? process.stderr : process.stdout
  stream.write(JSON.stringify(entry) + '\n')
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => log('debug', component, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log('info', component, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log('warn', component, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log('error', component, msg, data),
  }
}
