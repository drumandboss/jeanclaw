#!/usr/bin/env node
/**
 * JeanClaw MCP Server — exposes tools to Claude sessions via stdio transport.
 *
 * Spawned as a child process by Claude CLI (`--mcp-config`).
 * Communicates with the JeanClaw daemon over HTTP (localhost).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
const HTTP_PORT = process.env.JEANCLAW_HTTP_PORT ?? '18790';
const WORKSPACE = process.env.JEANCLAW_WORKSPACE ?? join(process.env.HOME ?? '', 'jeanclaw');
const CONFIG_PATH = process.env.JEANCLAW_CONFIG_PATH ?? join(process.env.HOME ?? '', '.jeanclaw', 'config.json');
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function httpPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
}
async function httpGet(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
}
async function readConfig() {
    try {
        const raw = await readFile(CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function writeConfig(config) {
    const dir = join(process.env.HOME ?? '', '.jeanclaw');
    await mkdir(dir, { recursive: true });
    const tmp = CONFIG_PATH + '.tmp.' + process.pid;
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, CONFIG_PATH);
}
const IDENTITY_FILES = {
    SOUL: 'SOUL.md',
    IDENTITY: 'IDENTITY.md',
    USER: 'USER.md',
    AGENTS: 'AGENTS.md',
    HEARTBEAT: 'HEARTBEAT.md',
};
// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({ name: 'jeanclaw', version: '0.1.0' }, { capabilities: { tools: {} } });
// --- send_message ---
server.tool('send_message', 'Send a message to any configured channel (telegram, imessage) proactively.', {
    channel: z.enum(['telegram', 'imessage']).describe('Target channel'),
    peer_id: z.string().describe('Peer/chat ID to send to'),
    text: z.string().describe('Message text to send'),
}, async ({ channel, peer_id, text }) => {
    const result = await httpPost('/api/outbound', { channel, peerId: peer_id, text });
    if (!result.ok) {
        return { content: [{ type: 'text', text: `Failed to send message: HTTP ${result.status}` }], isError: true };
    }
    return { content: [{ type: 'text', text: `Message sent to ${channel}:${peer_id}` }] };
});
// --- manage_cron ---
server.tool('manage_cron', 'Add, remove, or list cron jobs. After add/remove, you should restart JeanClaw with `pm2 restart jeanclaw`.', {
    action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
    id: z.string().optional().describe('Cron job ID (required for add/remove)'),
    schedule: z.string().optional().describe('Cron schedule expression, e.g. "0 9 * * *" (required for add)'),
    timezone: z.string().optional().describe('IANA timezone, e.g. "America/New_York" (required for add)'),
    prompt: z.string().optional().describe('Prompt to run when cron fires (required for add)'),
    deliver_to: z.string().optional().describe('Delivery target, e.g. "telegram:123456" (required for add)'),
    session: z.enum(['isolated', 'shared']).optional().describe('Session mode (default: isolated)'),
}, async ({ action, id, schedule, timezone, prompt, deliver_to, session }) => {
    const config = await readConfig();
    if (action === 'list') {
        const crons = config.crons ?? [];
        if (crons.length === 0) {
            return { content: [{ type: 'text', text: 'No cron jobs configured.' }] };
        }
        const lines = crons.map((c) => `- **${c.id}**: \`${c.schedule}\` (${c.timezone}) → ${c.deliverTo}\n  Prompt: ${c.prompt.slice(0, 100)}${c.prompt.length > 100 ? '...' : ''}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    if (action === 'add') {
        if (!id || !schedule || !timezone || !prompt || !deliver_to) {
            return {
                content: [{ type: 'text', text: 'Missing required fields: id, schedule, timezone, prompt, deliver_to' }],
                isError: true,
            };
        }
        const existingCrons = config.crons ?? [];
        if (existingCrons.some((c) => c.id === id)) {
            return { content: [{ type: 'text', text: `Cron job "${id}" already exists. Remove it first.` }], isError: true };
        }
        const newCron = {
            id,
            schedule,
            timezone,
            prompt,
            deliverTo: deliver_to,
            session: session ?? 'isolated',
        };
        const updatedConfig = { ...config, crons: [...existingCrons, newCron] };
        await writeConfig(updatedConfig);
        return {
            content: [{
                    type: 'text',
                    text: `Cron job "${id}" added: ${schedule} (${timezone}). Run \`pm2 restart jeanclaw\` to apply.`,
                }],
        };
    }
    if (action === 'remove') {
        if (!id) {
            return { content: [{ type: 'text', text: 'Missing required field: id' }], isError: true };
        }
        const existingCrons = config.crons ?? [];
        const filtered = existingCrons.filter((c) => c.id !== id);
        if (filtered.length === existingCrons.length) {
            return { content: [{ type: 'text', text: `Cron job "${id}" not found.` }], isError: true };
        }
        const updatedConfig = { ...config, crons: filtered };
        await writeConfig(updatedConfig);
        return {
            content: [{
                    type: 'text',
                    text: `Cron job "${id}" removed. Run \`pm2 restart jeanclaw\` to apply.`,
                }],
        };
    }
    return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
});
// --- manage_heartbeat ---
server.tool('manage_heartbeat', 'Enable/disable heartbeat or change interval.', {
    action: z.enum(['enable', 'disable', 'set_interval']).describe('Action to perform'),
    interval: z.string().optional().describe('Interval string, e.g. "2h", "30m" (for set_interval)'),
}, async ({ action, interval }) => {
    const config = await readConfig();
    const heartbeat = { ...(config.heartbeat ?? { enabled: true, every: '2h', session: 'dedicated' }) };
    if (action === 'enable') {
        heartbeat.enabled = true;
    }
    else if (action === 'disable') {
        heartbeat.enabled = false;
    }
    else if (action === 'set_interval') {
        if (!interval) {
            return { content: [{ type: 'text', text: 'Missing required field: interval' }], isError: true };
        }
        // Basic validation
        if (!/^\d+(h|m|s)$/.test(interval)) {
            return { content: [{ type: 'text', text: `Invalid interval format: "${interval}". Use e.g. "2h", "30m", "45s".` }], isError: true };
        }
        heartbeat.every = interval;
    }
    const updatedConfig = { ...config, heartbeat };
    await writeConfig(updatedConfig);
    return {
        content: [{
                type: 'text',
                text: `Heartbeat updated: enabled=${heartbeat.enabled}, every=${heartbeat.every}. Run \`pm2 restart jeanclaw\` to apply.`,
            }],
    };
});
// --- manage_identity ---
server.tool('manage_identity', 'Read or update identity files (SOUL.md, USER.md, etc).', {
    action: z.enum(['read', 'update']).describe('Action to perform'),
    file: z.enum(['SOUL', 'IDENTITY', 'USER', 'AGENTS', 'HEARTBEAT']).describe('Which identity file'),
    content: z.string().optional().describe('New content (required for update)'),
}, async ({ action, file, content }) => {
    const filename = IDENTITY_FILES[file];
    if (!filename) {
        return { content: [{ type: 'text', text: `Unknown file: ${file}` }], isError: true };
    }
    const filePath = join(WORKSPACE, filename);
    if (action === 'read') {
        try {
            const data = await readFile(filePath, 'utf-8');
            return { content: [{ type: 'text', text: data }] };
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                return { content: [{ type: 'text', text: `File ${filename} does not exist yet.` }] };
            }
            return { content: [{ type: 'text', text: `Error reading ${filename}: ${err.message}` }], isError: true };
        }
    }
    if (action === 'update') {
        if (content === undefined || content === null) {
            return { content: [{ type: 'text', text: 'Missing required field: content' }], isError: true };
        }
        try {
            await writeFile(filePath, content, 'utf-8');
            return { content: [{ type: 'text', text: `${filename} updated successfully.` }] };
        }
        catch (err) {
            return { content: [{ type: 'text', text: `Error writing ${filename}: ${err.message}` }], isError: true };
        }
    }
    return { content: [{ type: 'text', text: `Unknown action: ${action}` }], isError: true };
});
// --- bot_status ---
server.tool('bot_status', 'Get JeanClaw daemon status including sessions, config, and health.', {}, async () => {
    try {
        const result = await httpGet('/api/status');
        if (!result.ok) {
            return { content: [{ type: 'text', text: `Failed to get status: HTTP ${result.status}` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `Cannot reach daemon at ${BASE_URL}: ${err.message}` }],
            isError: true,
        };
    }
});
// --- generate_image ---
server.tool('generate_image', 'Generate an image using DALL-E. Returns the file path of the generated image.', {
    prompt: z.string().describe('Image generation prompt'),
    provider: z.enum(['openai']).default('openai').describe('Image provider (only openai supported)'),
}, async ({ prompt: imagePrompt }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return {
            content: [{ type: 'text', text: 'Image generation not configured. Set OPENAI_API_KEY environment variable.' }],
            isError: true,
        };
    }
    try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt: imagePrompt,
                n: 1,
                size: '1024x1024',
                response_format: 'b64_json',
            }),
        });
        if (!res.ok) {
            const errBody = await res.text();
            return { content: [{ type: 'text', text: `OpenAI API error (${res.status}): ${errBody}` }], isError: true };
        }
        const json = (await res.json());
        const imageData = Buffer.from(json.data[0].b64_json, 'base64');
        const tmpDir = join(tmpdir(), 'jeanclaw-media');
        await mkdir(tmpDir, { recursive: true });
        const filePath = join(tmpDir, `${randomUUID()}.png`);
        await writeFile(filePath, imageData);
        return { content: [{ type: 'text', text: `Image generated and saved to: ${filePath}` }] };
    }
    catch (err) {
        return { content: [{ type: 'text', text: `Image generation failed: ${err.message}` }], isError: true };
    }
});
// --- text_to_speech ---
server.tool('text_to_speech', 'Convert text to speech audio using OpenAI TTS. Returns the file path of the audio.', {
    text: z.string().describe('Text to convert to speech'),
    provider: z.enum(['openai']).default('openai').describe('TTS provider (only openai supported)'),
}, async ({ text: ttsText }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return {
            content: [{ type: 'text', text: 'TTS not configured. Set OPENAI_API_KEY environment variable.' }],
            isError: true,
        };
    }
    try {
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'tts-1',
                input: ttsText,
                voice: 'alloy',
                response_format: 'mp3',
            }),
        });
        if (!res.ok) {
            const errBody = await res.text();
            return { content: [{ type: 'text', text: `OpenAI TTS API error (${res.status}): ${errBody}` }], isError: true };
        }
        const audioData = Buffer.from(await res.arrayBuffer());
        const tmpDir = join(tmpdir(), 'jeanclaw-media');
        await mkdir(tmpDir, { recursive: true });
        const filePath = join(tmpDir, `${randomUUID()}.mp3`);
        await writeFile(filePath, audioData);
        return { content: [{ type: 'text', text: `Audio generated and saved to: ${filePath}` }] };
    }
    catch (err) {
        return { content: [{ type: 'text', text: `TTS failed: ${err.message}` }], isError: true };
    }
});
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`MCP server fatal error: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=mcp-server.js.map