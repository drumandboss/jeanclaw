import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, DEFAULT_CONFIG, resolveConfigPath } from '../src/config.js'
import { writeJsonFile } from '../src/persistence.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('config', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jc-cfg-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(join(tempDir, 'config.json'))
    expect(config.model).toBe('sonnet')
    expect(config.channels.telegram.enabled).toBe(false)
    expect(config.sessionScope).toBe('per-peer')
  })

  it('merges partial config with defaults', async () => {
    const configPath = join(tempDir, 'config.json')
    await writeJsonFile(configPath, {
      model: 'opus',
      channels: { telegram: { enabled: true, botToken: 'test-token' } },
    })
    const config = await loadConfig(configPath)
    expect(config.model).toBe('opus')
    expect(config.channels.telegram.enabled).toBe(true)
    expect(config.channels.telegram.botToken).toBe('test-token')
    expect(config.channels.telegram.dmPolicy).toBe('pairing')
    expect(config.channels.http.port).toBe(18790)
  })

  it('resolves config path from home directory', () => {
    const path = resolveConfigPath()
    expect(path).toContain('.jeanclaw')
    expect(path).toContain('config.json')
  })
})
