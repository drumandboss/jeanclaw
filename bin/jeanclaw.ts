#!/usr/bin/env node
import { Command } from 'commander'
import { Daemon } from '../src/daemon.js'
import { loadConfig, resolveConfigPath, DEFAULT_CONFIG } from '../src/config.js'
import { writeJsonFile } from '../src/persistence.js'
import { setLogLevel } from '../src/logger.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdir, copyFile, readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function askQuestion(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

const program = new Command()

program
  .name('jeanclaw')
  .description('Claude Code wrapper — AI assistant via Telegram, iMessage, and HTTP')
  .version('0.1.0')

program
  .command('start')
  .description('Start the JeanClaw daemon')
  .option('--config <path>', 'Path to config file')
  .option('--debug', 'Enable debug logging')
  .action(async (opts) => {
    if (opts.debug) setLogLevel('debug')

    const daemon = new Daemon()

    process.on('SIGINT', async () => {
      await daemon.stop()
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      await daemon.stop()
      process.exit(0)
    })

    await daemon.start(opts.config)
    process.stdin.resume()
  })

program
  .command('setup')
  .description('Interactive first-time setup')
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    console.log('\nJeanClaw Setup\n')

    // Check Claude CLI
    try {
      const { execSync } = await import('node:child_process')
      const version = execSync('claude --version', { encoding: 'utf-8' }).trim()
      console.log(`Claude Code CLI: ${version}`)
    } catch {
      console.error('Claude Code CLI not found. Install it first: https://docs.anthropic.com/en/docs/claude-code')
      rl.close()
      process.exit(1)
    }

    const defaultWorkspace = join(homedir(), 'jeanclaw')
    const workspace = (await askQuestion(rl, `Workspace directory [${defaultWorkspace}]: `)).trim() || defaultWorkspace
    await mkdir(workspace, { recursive: true })

    // Copy templates if workspace is empty
    const templateDir = join(__dirname, '..', 'templates')
    try {
      const existing = await readdir(workspace)
      const hasIdentity = existing.some((f) => f.endsWith('.md'))
      if (!hasIdentity) {
        const templates = await readdir(templateDir)
        for (const t of templates) {
          await copyFile(join(templateDir, t), join(workspace, t))
        }
        console.log('Created starter identity files in workspace.')
      }
    } catch { /* templates dir might not exist in dev */ }

    const model = (await askQuestion(rl, 'Default model [sonnet]: ')).trim() || 'sonnet'

    const enableTg = (await askQuestion(rl, 'Enable Telegram? (y/n) [n]: ')).trim().toLowerCase()
    let tgToken = ''
    if (enableTg === 'y' || enableTg === 'yes') {
      tgToken = (await askQuestion(rl, 'Telegram bot token (from @BotFather): ')).trim()
    }

    const config = {
      ...DEFAULT_CONFIG,
      workspace,
      model,
      channels: {
        ...DEFAULT_CONFIG.channels,
        telegram: {
          ...DEFAULT_CONFIG.channels.telegram,
          enabled: !!tgToken,
          botToken: tgToken,
        },
      },
    }

    const configDir = join(homedir(), '.jeanclaw')
    await mkdir(configDir, { recursive: true })
    const configPath = join(configDir, 'config.json')
    await writeJsonFile(configPath, config)
    console.log(`\nConfig saved to ${configPath}`)
    console.log('Run `jeanclaw start` to launch the daemon.')

    rl.close()
  })

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const config = await loadConfig()
    if (config.channels.http.enabled) {
      try {
        const res = await fetch(`http://${config.channels.http.bind}:${config.channels.http.port}/api/status`, {
          headers: config.channels.http.token ? { Authorization: `Bearer ${config.channels.http.token}` } : {},
        })
        if (res.ok) {
          console.log(JSON.stringify(await res.json(), null, 2))
        } else {
          console.log('Daemon not responding (HTTP', res.status, ')')
        }
      } catch {
        console.log('Daemon not running (connection refused)')
      }
    } else {
      console.log('HTTP channel disabled — cannot check status')
    }
  })

program
  .command('doctor')
  .description('Health check')
  .action(async () => {
    console.log('JeanClaw Doctor\n')

    try {
      const { execSync } = await import('node:child_process')
      const v = execSync('claude --version', { encoding: 'utf-8' }).trim()
      console.log(`  Claude Code CLI: ${v}`)
    } catch {
      console.log('  Claude Code CLI: NOT FOUND')
    }

    const configPath = resolveConfigPath()
    const config = await loadConfig()
    console.log(`  Config: ${configPath}`)
    console.log(`  Workspace: ${config.workspace}`)
    console.log(`  Model: ${config.model}`)
    console.log(`  Telegram: ${config.channels.telegram.enabled ? 'enabled' : 'disabled'}`)
    console.log(`  iMessage: ${config.channels.imessage.enabled ? 'enabled' : 'disabled'}`)
    console.log(`  HTTP: ${config.channels.http.enabled ? `enabled (port ${config.channels.http.port})` : 'disabled'}`)
  })

program
  .command('send <message>')
  .description('Send a one-shot message')
  .action(async (message: string) => {
    const { execSync } = await import('node:child_process')
    const config = await loadConfig()
    try {
      const result = execSync(`claude -p --model ${config.model} "${message.replace(/"/g, '\\"')}"`, {
        encoding: 'utf-8',
        cwd: config.workspace,
      })
      console.log(result)
    } catch (err) {
      console.error('Failed:', (err as Error).message)
    }
  })

program.parse()
