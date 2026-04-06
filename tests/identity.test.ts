import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadIdentity } from '../src/identity.js'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('identity', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jc-id-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads and concatenates identity files in order', async () => {
    writeFileSync(join(tempDir, 'SOUL.md'), '# Soul\nBe helpful.')
    writeFileSync(join(tempDir, 'IDENTITY.md'), '# Identity\nI am TestBot.')
    writeFileSync(join(tempDir, 'USER.md'), '# User\nDavid.')

    const prompt = await loadIdentity(tempDir)
    expect(prompt).toContain('# Soul')
    expect(prompt).toContain('# Identity')
    expect(prompt).toContain('# User')
    const soulIdx = prompt.indexOf('# Soul')
    const idIdx = prompt.indexOf('# Identity')
    const userIdx = prompt.indexOf('# User')
    expect(soulIdx).toBeLessThan(idIdx)
    expect(idIdx).toBeLessThan(userIdx)
  })

  it('skips missing files without error', async () => {
    writeFileSync(join(tempDir, 'SOUL.md'), '# Soul\nMinimal.')
    const prompt = await loadIdentity(tempDir)
    expect(prompt).toContain('# Soul')
    expect(prompt).not.toContain('IDENTITY')
  })

  it('returns empty string for empty workspace', async () => {
    const prompt = await loadIdentity(tempDir)
    expect(prompt).toBe('')
  })
})
