import { createLogger } from './logger.js';
const log = createLogger('channel-router');
export class ChannelRouter {
    adapters = new Map();
    handlers = [];
    addAdapter(adapter) {
        this.adapters.set(adapter.name, adapter);
        adapter.onMessage((msg) => {
            log.debug('message received', { channel: adapter.name, peerId: msg.peerId });
            for (const handler of this.handlers) {
                handler(msg);
            }
        });
    }
    onMessage(handler) {
        this.handlers.push(handler);
    }
    async send(adapterName, peerId, text, options) {
        const adapter = this.adapters.get(adapterName);
        if (!adapter) {
            log.error('adapter not found', { adapterName });
            return;
        }
        await adapter.send(peerId, text, options);
    }
    async startAll() {
        for (const [name, adapter] of this.adapters) {
            log.info('starting channel', { name });
            await adapter.start();
        }
    }
    async stopAll() {
        for (const [name, adapter] of this.adapters) {
            log.info('stopping channel', { name });
            await adapter.stop();
        }
    }
    getAdapter(name) {
        return this.adapters.get(name);
    }
}
//# sourceMappingURL=channel-router.js.map