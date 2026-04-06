/**
 * Writes the MCP config JSON that Claude sessions use to discover JeanClaw tools.
 * The file is written to ~/.jeanclaw/mcp.json on daemon start.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from './logger.js'

const log = createLogger('mcp-config')

export const MCP_CONFIG_PATH = join(homedir(), '.jeanclaw', 'mcp.json')

export async function writeMcpConfig(httpPort: number, workspace: string): Promise<void> {
  // Resolve the path to the compiled MCP server entrypoint
  const mcpServerPath = resolve(join(import.meta.dirname ?? '.', 'mcp-server.js'))

  const config = {
    mcpServers: {
      jeanclaw: {
        command: 'node',
        args: [mcpServerPath],
        env: {
          JEANCLAW_HTTP_PORT: String(httpPort),
          JEANCLAW_WORKSPACE: workspace,
          JEANCLAW_CONFIG_PATH: join(homedir(), '.jeanclaw', 'config.json'),
        },
      },
    },
  }

  const dir = join(homedir(), '.jeanclaw')
  await mkdir(dir, { recursive: true })
  await writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  log.info('MCP config written', { path: MCP_CONFIG_PATH, mcpServer: mcpServerPath })
}
