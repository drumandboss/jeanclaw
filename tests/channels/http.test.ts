import { describe, it, expect, afterEach } from 'vitest'
import { HttpAdapter } from '../../src/channels/http.js'

describe('HttpAdapter', () => {
  let adapter: HttpAdapter | null = null

  afterEach(async () => {
    if (adapter) await adapter.stop()
    adapter = null
  })

  it('starts server on configured port', async () => {
    adapter = new HttpAdapter({ enabled: true, port: 0, bind: '127.0.0.1', token: null })
    await adapter.start()
    const port = adapter.getPort()
    expect(port).toBeGreaterThan(0)

    const res = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe('ok')
  })

  it('requires auth token when configured', async () => {
    adapter = new HttpAdapter({ enabled: true, port: 0, bind: '127.0.0.1', token: 'secret123' })
    await adapter.start()
    const port = adapter.getPort()

    const noAuth = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(noAuth.status).toBe(401)

    const withAuth = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Authorization: 'Bearer secret123' },
    })
    expect(withAuth.status).toBe(200)
  })
})
