const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
let minLevel = 'info';
export function setLogLevel(level) {
    minLevel = level;
}
function log(level, component, message, data) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel])
        return;
    const entry = {
        ts: new Date().toISOString(),
        level,
        component,
        message,
        ...data,
    };
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
}
export function createLogger(component) {
    return {
        debug: (msg, data) => log('debug', component, msg, data),
        info: (msg, data) => log('info', component, msg, data),
        warn: (msg, data) => log('warn', component, msg, data),
        error: (msg, data) => log('error', component, msg, data),
    };
}
//# sourceMappingURL=logger.js.map