import { createServer } from 'node:http';
import { createLogger } from '../logger.js';
const log = createLogger('http');
export class HttpAdapter {
    name = 'http';
    server = null;
    messageHandlers = [];
    config;
    statusProvider = null;
    outboundCallback = null;
    constructor(config) {
        this.config = config;
    }
    setStatusProvider(fn) {
        this.statusProvider = fn;
    }
    setOutboundCallback(fn) {
        this.outboundCallback = fn;
    }
    getPort() {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object')
            return addr.port;
        return 0;
    }
    async start() {
        return new Promise((resolve) => {
            this.server = createServer(async (req, res) => {
                try {
                    await this.handleRequest(req, res);
                }
                catch (err) {
                    log.error('request error', { error: err.message });
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'internal server error' }));
                }
            });
            this.server.listen(this.config.port, this.config.bind, () => {
                log.info('HTTP server started', { port: this.getPort(), bind: this.config.bind });
                resolve();
            });
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
    onMessage(handler) {
        this.messageHandlers.push(handler);
    }
    async send(_peerId, _text, _options) {
        // HTTP responses are handled inline in handleRequest
    }
    checkAuth(req, res) {
        if (!this.config.token)
            return true;
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${this.config.token}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return false;
        }
        return true;
    }
    async readBody(req) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf-8');
    }
    async handleRequest(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        if (url.pathname === '/api/health' && req.method === 'GET') {
            if (!this.checkAuth(req, res))
                return;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
            return;
        }
        if (!this.checkAuth(req, res))
            return;
        if (url.pathname === '/api/status' && req.method === 'GET') {
            const status = this.statusProvider ? this.statusProvider() : {};
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status));
            return;
        }
        if (url.pathname === '/api/send' && req.method === 'POST') {
            const body = JSON.parse(await this.readBody(req));
            const msg = {
                channelKey: `http:${body.sessionKey ?? 'default'}`,
                peerId: body.sessionKey ?? 'default',
                text: body.message,
            };
            for (const handler of this.messageHandlers) {
                handler(msg);
            }
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ accepted: true }));
            return;
        }
        if (url.pathname === '/api/outbound' && req.method === 'POST') {
            if (!this.outboundCallback) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'outbound not configured' }));
                return;
            }
            try {
                const body = JSON.parse(await this.readBody(req));
                const { channel, peerId, text } = body;
                if (!channel || !peerId || !text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'missing required fields: channel, peerId, text' }));
                    return;
                }
                await this.outboundCallback(channel, peerId, text);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ sent: true }));
            }
            catch (err) {
                log.error('outbound send failed', { error: err.message });
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
    }
}
//# sourceMappingURL=http.js.map