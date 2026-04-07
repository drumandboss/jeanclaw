/**
 * Writes the MCP config JSON that Claude sessions use to discover JeanClaw tools.
 * The file is written to ~/.jeanclaw/mcp.json on daemon start.
 */
export declare const MCP_CONFIG_PATH: string;
export declare function writeMcpConfig(httpPort: number, workspace: string): Promise<void>;
