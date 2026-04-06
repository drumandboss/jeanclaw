import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readJsonFile, writeJsonFile } from '../src/persistence.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('persistence', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jc-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes and reads JSON atomically', async () => {
    const path = join(tempDir, 'test.json')
    const data = { hello: 'world', count: 42 }
    await writeJsonFile(path, data)
    const result = await readJsonFile(path)
    expect(result).toEqual(data)
  })

  it('returns null for missing files', async () => {
    const result = await readJsonFile(join(tempDir, 'nope.json'))
    expect(result).toBeNull()
  })

  it('creates parent directories if needed', async () => {
    const path = join(tempDir, 'sub', 'dir', 'test.json')
    await writeJsonFile(path, { nested: true })
    const result = await readJsonFile(path)
    expect(result).toEqual({ nested: true })
  })
})
