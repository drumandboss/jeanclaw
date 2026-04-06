import { homedir } from 'node:os'
import { join } from 'node:path'
import { readJsonFile } from './persistence.js'
import type { JeanClawConfig } from './types.js'

export const DEFAULT_CONFIG: JeanClawConfig = {
  workspace: join(homedir(), 'jeanclaw'),
  model: 'sonnet',
  permissionMode: 'bypassPermissions',
  effort: 'high',
  maxBudgetUsd: null,
  sessionScope: 'per-peer',
  quietHours: { start: '23:00', end: '08:00' },
  heartbeat: {
    enabled: true,
    every: '2h',
    session: 'dedicated',
  },
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      dmPolicy: 'pairing',
      allowedUsers: [],
      streaming: true,
    },
    imessage: {
      enabled: false,
      blueBubblesUrl: '',
      blueBubblesPassword: '',
      allowedContacts: [],
    },
    http: {
      enabled: true,
      port: 18790,
      bind: '127.0.0.1',
      token: null,
    },
  },
  crons: [],
}

export function resolveConfigPath(): string {
  return join(homedir(), '.jeanclaw', 'config.json')
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const tv = target[key]
    if (sv != null && typeof sv === 'object' && !Array.isArray(sv) && tv != null && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>)
    } else {
      result[key] = sv
    }
  }
  return result
}

export async function loadConfig(path?: string): Promise<JeanClawConfig> {
  const configPath = path ?? resolveConfigPath()
  const raw = await readJsonFile<Record<string, unknown>>(configPath)
  if (!raw) return DEFAULT_CONFIG
  return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, raw) as unknown as JeanClawConfig
}
