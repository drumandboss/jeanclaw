import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function readJsonFile(path) {
    try {
        const raw = await readFile(path, 'utf-8');
        return JSON.parse(raw);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return null;
        throw err;
    }
}
export async function writeJsonFile(path, data) {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    const tmp = path + '.tmp.' + process.pid;
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    await rename(tmp, path);
}
//# sourceMappingURL=persistence.js.map