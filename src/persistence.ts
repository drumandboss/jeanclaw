import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function readJsonFile<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = path + '.tmp.' + process.pid
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  await rename(tmp, path)
}
