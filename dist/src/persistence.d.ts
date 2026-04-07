export declare function readJsonFile<T = unknown>(path: string): Promise<T | null>;
export declare function writeJsonFile(path: string, data: unknown): Promise<void>;
