import { createServer, type Server, type IncomingMessage as HttpReq, type ServerResponse } from 'node:http'
import { createLogger } from '../logger.js'
import type { ChannelAdapter, IncomingMessage, SendOptions, HttpConfig } from '../types.js'

const log = createLogger('http')

export class HttpAdapter implements ChannelAdapter {
  readonly name = 'http'
  private server: Server | null = null
  private messageHandlers: Array<(msg: IncomingMessage) => void> = []
  private readonly config: HttpConfig
  private statusProvider: (() => unknown) | null = null

  constructor(config: HttpConfig) {
    this.config = config
  }

  setStatusProvider(fn: () => unknown): void {
    this.statusProvider = fn
  }

  getPort(): number {
    const addr = this.server?.address()
    if (addr && typeof addr === 'object') return addr.port
    return 0
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res)
        } catch (err) {
          log.error('request error', { error: (err as Error).message })
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal server error' }))
        }
      })

      this.server.listen(this.config.port, this.config.bind, () => {
        log.info('HTTP server started', { port: this.getPort(), bind: this.config.bind })
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve())
      } else {
        resolve()
      }
    })
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  async send(_peerId: string, _text: string, _options?: SendOptions): Promise<void> {
    // HTTP responses are handled inline in handleRequest
  }

  private checkAuth(req: HttpReq, res: ServerResponse): boolean {
    if (!this.config.token) return true

    const auth = req.headers.authorization
    if (!auth || auth !== `Bearer ${this.config.token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return false
    }
    return true
  }

  private async readBody(req: HttpReq): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf-8')
  }

  private async handleRequest(req: HttpReq, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (url.pathname === '/api/health' && req.method === 'GET') {
      if (!this.checkAuth(req, res)) return
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
      return
    }

    if (!this.checkAuth(req, res)) return

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const status = this.statusProvider ? this.statusProvider() : {}
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(status))
      return
    }

    if (url.pathname === '/api/send' && req.method === 'POST') {
      const body = JSON.parse(await this.readBody(req))
      const msg: IncomingMessage = {
        channelKey: `http:${body.sessionKey ?? 'default'}`,
        peerId: body.sessionKey ?? 'default',
        text: body.message,
      }
      for (const handler of this.messageHandlers) {
        handler(msg)
      }
      res.writeHead(202, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ accepted: true }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
}
