import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile } from './persistence.js';
export const DEFAULT_CONFIG = {
    workspace: join(homedir(), 'jeanclaw'),
    model: 'sonnet',
    permissionMode: 'bypassPermissions',
    effort: 'high',
    maxBudgetUsd: null,
    sessionScope: 'per-peer',
    quietHours: { start: '23:00', end: '08:00' },
    heartbeat: {
        enabled: true,
        every: '2h',
        session: 'dedicated',
    },
    channels: {
        telegram: {
            enabled: false,
            botToken: '',
            dmPolicy: 'pairing',
            allowedUsers: [],
            streaming: true,
        },
        imessage: {
            enabled: false,
            blueBubblesUrl: '',
            blueBubblesPassword: '',
            allowedContacts: [],
        },
        http: {
            enabled: true,
            port: 18790,
            bind: '127.0.0.1',
            token: null,
        },
    },
    crons: [],
};
export function resolveConfigPath() {
    return join(homedir(), '.jeanclaw', 'config.json');
}
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        const sv = source[key];
        const tv = target[key];
        if (sv != null && typeof sv === 'object' && !Array.isArray(sv) && tv != null && typeof tv === 'object' && !Array.isArray(tv)) {
            result[key] = deepMerge(tv, sv);
        }
        else {
            result[key] = sv;
        }
    }
    return result;
}
export async function loadConfig(path) {
    const configPath = path ?? resolveConfigPath();
    const raw = await readJsonFile(configPath);
    if (!raw)
        return DEFAULT_CONFIG;
    return deepMerge(DEFAULT_CONFIG, raw);
}
//# sourceMappingURL=config.js.map