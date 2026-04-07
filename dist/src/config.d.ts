import type { JeanClawConfig } from './types.js';
export declare const DEFAULT_CONFIG: JeanClawConfig;
export declare function resolveConfigPath(): string;
export declare function loadConfig(path?: string): Promise<JeanClawConfig>;
