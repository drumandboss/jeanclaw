export interface JeanClawConfig {
  readonly workspace: string
  readonly model: string
  readonly permissionMode: string
  readonly effort: string
  readonly maxBudgetUsd: number | null
  readonly sessionScope: 'main' | 'per-peer' | 'per-channel-peer'
  readonly quietHours: { readonly start: string; readonly end: string } | null
  readonly heartbeat: {
    readonly enabled: boolean
    readonly every: string
    readonly session: 'dedicated' | 'shared'
  }
  readonly channels: {
    readonly telegram: TelegramConfig
    readonly imessage: iMessageConfig
    readonly http: HttpConfig
  }
  readonly crons: readonly CronJob[]
}

export interface TelegramConfig {
  readonly enabled: boolean
  readonly botToken: string
  readonly dmPolicy: 'open' | 'pairing' | 'allowlist'
  readonly allowedUsers: readonly number[]
  readonly streaming: boolean
}

export interface iMessageConfig {
  readonly enabled: boolean
  readonly blueBubblesUrl: string
  readonly blueBubblesPassword: string
  readonly allowedContacts: readonly string[]
}

export interface HttpConfig {
  readonly enabled: boolean
  readonly port: number
  readonly bind: string
  readonly token: string | null
}

export interface CronJob {
  readonly id: string
  readonly schedule: string
  readonly timezone: string
  readonly prompt: string
  readonly deliverTo: string
  readonly session: 'isolated' | 'shared'
}

export interface IncomingMessage {
  readonly channelKey: string
  readonly peerId: string
  readonly text: string
  readonly media?: readonly MediaAttachment[]
  readonly mediaPath?: string
  readonly replyTo?: string
}

export type CommandType = 'new' | 'reset' | 'status' | 'compact'

export interface CommandCallback {
  (channelKey: string, command: CommandType): Promise<string>
}

export interface MediaAttachment {
  readonly type: 'image' | 'voice' | 'document'
  readonly data: Buffer
  readonly mimeType: string
  readonly filename?: string
}

export interface SendOptions {
  readonly streaming?: boolean
  readonly replyTo?: string
}

export interface ChannelAdapter {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => void): void
  send(peerId: string, text: string, options?: SendOptions): Promise<void>
}

export interface SessionState {
  readonly sessionId: string
  readonly lastActivity: string
  readonly model: string
  readonly turnCount: number
}

export interface SessionsStore {
  readonly sessions: Record<string, SessionState>
}

export type ClaudeEventType =
  | 'system'
  | 'assistant'
  | 'assistant_partial'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'

export interface ClaudeEvent {
  readonly type: ClaudeEventType
  readonly message?: string
  readonly content?: string
  readonly session_id?: string
  readonly usage?: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_read_input_tokens?: number
  }
  readonly cost_usd?: number
  readonly stop_reason?: string
}

export interface CircuitBreakerState {
  failures: number
  lastFailure: number
  backoffMs: number
}
