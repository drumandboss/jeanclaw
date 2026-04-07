import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { createLogger } from './logger.js';
import { MCP_CONFIG_PATH } from './mcp-config.js';
const log = createLogger('claude-session');
export class ClaudeSession extends EventEmitter {
    proc = null;
    rl = null;
    opts;
    _sessionId;
    _lastActivity = 0;
    _turnCount = 0;
    constructor(opts) {
        super();
        this.opts = opts;
        this._sessionId = opts.resumeSessionId;
    }
    get sessionId() {
        return this._sessionId;
    }
    get lastActivity() {
        return this._lastActivity;
    }
    get turnCount() {
        return this._turnCount;
    }
    isAlive() {
        return this.proc !== null && this.proc.exitCode === null;
    }
    buildSpawnArgs() {
        const args = [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--include-partial-messages',
            '--verbose',
            '--model', this.opts.model,
            '--permission-mode', this.opts.permissionMode,
        ];
        if (this._sessionId) {
            args.push('--resume', this._sessionId);
        }
        if (this.opts.effort) {
            args.push('--effort', this.opts.effort);
        }
        if (this.opts.maxBudgetUsd != null) {
            args.push('--max-budget-usd', String(this.opts.maxBudgetUsd));
        }
        if (this.opts.appendSystemPrompt) {
            args.push('--append-system-prompt', this.opts.appendSystemPrompt);
        }
        if (this.opts.allowedTools?.length) {
            args.push('--allowed-tools', ...this.opts.allowedTools);
        }
        if (this.opts.disallowedTools?.length) {
            args.push('--disallowed-tools', ...this.opts.disallowedTools);
        }
        // MCP config for JeanClaw tools
        args.push('--mcp-config', MCP_CONFIG_PATH);
        return args;
    }
    start() {
        if (this.isAlive())
            return;
        const args = this.buildSpawnArgs();
        log.info('spawning claude subprocess', { cwd: this.opts.workspaceDir, args });
        this.proc = spawn('claude', args, {
            cwd: this.opts.workspaceDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });
        this.rl = createInterface({ input: this.proc.stdout });
        this.rl.on('line', (line) => {
            const event = this.parseLine(line);
            if (!event)
                return;
            this._lastActivity = Date.now();
            if (event.type === 'system' && event.session_id) {
                this._sessionId = event.session_id;
            }
            this.emit('event', event);
        });
        this.proc.stderr.on('data', (chunk) => {
            log.debug('claude stderr', { data: chunk.toString().trim() });
        });
        this.proc.on('exit', (code, signal) => {
            log.info('claude subprocess exited', { code, signal, sessionId: this._sessionId });
            this.proc = null;
            this.rl = null;
            this.emit('exit', { code, signal });
        });
        this.proc.on('error', (err) => {
            log.error('claude subprocess error', { error: err.message });
            this.emit('error', err);
        });
    }
    send(text) {
        if (!this.isAlive() || !this.proc?.stdin?.writable) {
            throw new Error('Session is not alive');
        }
        this._turnCount++;
        const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
        this.proc.stdin.write(payload + '\n');
        log.debug('sent message', { sessionId: this._sessionId, turnCount: this._turnCount });
    }
    async stop() {
        if (!this.proc)
            return;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                log.warn('subprocess did not exit gracefully, sending SIGKILL');
                this.proc?.kill('SIGKILL');
            }, 3000);
            this.proc.on('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            this.proc.kill('SIGTERM');
        });
    }
    parseLine(line) {
        if (!line.trim())
            return null;
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=claude-session.js.map