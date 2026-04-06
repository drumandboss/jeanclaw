#!/usr/bin/env node
import { Command } from 'commander'
import { Daemon } from '../src/daemon.js'
import { loadConfig, resolveConfigPath, DEFAULT_CONFIG } from '../src/config.js'
import { writeJsonFile } from '../src/persistence.js'
import { setLogLevel } from '../src/logger.js'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { mkdir, copyFile, readdir, writeFile, unlink } from 'node:fs/promises'
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

program
  .command('install-daemon')
  .description('Install JeanClaw as a background service that starts on boot')
  .action(async () => {
    const { execSync } = await import('node:child_process')
    const os = platform()

    // Find the jeanclaw binary path
    let binPath: string
    try {
      binPath = execSync('which jeanclaw', { encoding: 'utf-8' }).trim()
    } catch {
      // Not globally installed — use the local dist path
      binPath = join(__dirname, 'jeanclaw.js')
    }

    // Find node path
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim()

    if (os === 'darwin') {
      // macOS LaunchAgent
      const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.jeanclaw.daemon.plist')
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jeanclaw.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${binPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.jeanclaw', 'daemon-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.jeanclaw', 'daemon-stderr.log')}</string>
  <key>WorkingDirectory</key>
  <string>${homedir()}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>HOME</key>
    <string>${homedir()}</string>
  </dict>
</dict>
</plist>`

      await mkdir(join(homedir(), '.jeanclaw'), { recursive: true })
      await writeFile(plistPath, plist, 'utf-8')

      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' })
      } catch { /* not loaded yet, fine */ }

      execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' })

      console.log('JeanClaw daemon installed and started.')
      console.log(`  LaunchAgent: ${plistPath}`)
      console.log(`  Logs: ~/.jeanclaw/daemon-stdout.log`)
      console.log('')
      console.log('It will start automatically on login. To stop:')
      console.log(`  launchctl unload "${plistPath}"`)

    } else if (os === 'linux') {
      // Linux systemd user service
      const serviceDir = join(homedir(), '.config', 'systemd', 'user')
      const servicePath = join(serviceDir, 'jeanclaw.service')
      const service = `[Unit]
Description=JeanClaw AI Assistant Daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${binPath} start
Restart=always
RestartSec=10
WorkingDirectory=${homedir()}
Environment=PATH=${process.env.PATH}
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target`

      await mkdir(serviceDir, { recursive: true })
      await writeFile(servicePath, service, 'utf-8')

      execSync('systemctl --user daemon-reload', { encoding: 'utf-8' })
      execSync('systemctl --user enable jeanclaw', { encoding: 'utf-8' })
      execSync('systemctl --user start jeanclaw', { encoding: 'utf-8' })

      // Enable lingering so service runs without active login
      try {
        execSync('loginctl enable-linger', { encoding: 'utf-8' })
      } catch { /* may need root */ }

      console.log('JeanClaw daemon installed and started.')
      console.log(`  Service: ${servicePath}`)
      console.log('')
      console.log('Commands:')
      console.log('  systemctl --user status jeanclaw')
      console.log('  journalctl --user -u jeanclaw -f')
      console.log('  systemctl --user stop jeanclaw')

    } else {
      console.error(`Unsupported platform: ${os}. Use PM2 instead:`)
      console.error('  pm2 start jeanclaw -- start')
      console.error('  pm2 save')
      console.error('  pm2 startup')
    }
  })

program
  .command('uninstall-daemon')
  .description('Remove JeanClaw background service')
  .action(async () => {
    const { execSync } = await import('node:child_process')
    const os = platform()

    if (os === 'darwin') {
      const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.jeanclaw.daemon.plist')
      try {
        execSync(`launchctl unload "${plistPath}"`, { encoding: 'utf-8' })
      } catch { /* already unloaded */ }
      try {
        await unlink(plistPath)
      } catch { /* already removed */ }
      console.log('JeanClaw daemon uninstalled.')

    } else if (os === 'linux') {
      try {
        execSync('systemctl --user stop jeanclaw', { encoding: 'utf-8' })
        execSync('systemctl --user disable jeanclaw', { encoding: 'utf-8' })
      } catch { /* already stopped */ }
      const servicePath = join(homedir(), '.config', 'systemd', 'user', 'jeanclaw.service')
      try {
        await unlink(servicePath)
        execSync('systemctl --user daemon-reload', { encoding: 'utf-8' })
      } catch { /* already removed */ }
      console.log('JeanClaw daemon uninstalled.')

    } else {
      console.log('Use PM2 to manage the daemon on this platform.')
    }
  })

program.parse()
