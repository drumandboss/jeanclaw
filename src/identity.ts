import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger } from './logger.js'

const log = createLogger('identity')

const IDENTITY_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'MEMORY.md',
] as const

export async function loadIdentity(workspaceDir: string): Promise<string> {
  const parts: string[] = []

  for (const filename of IDENTITY_FILES) {
    try {
      const content = await readFile(join(workspaceDir, filename), 'utf-8')
      if (content.trim()) {
        parts.push(content.trim())
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`failed to read ${filename}`, { error: (err as Error).message })
      }
    }
  }

  return parts.join('\n\n---\n\n')
}
