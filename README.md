# JeanClaw

The splits between your Claude subscription and your AI agent.

JeanClaw wraps `claude -p` as a persistent subprocess and exposes it over Telegram, iMessage, and HTTP. No API keys. No per-token billing. Just your existing Claude Max subscription doing the work.

- **Telegram and iMessage access** — talk to Claude from your phone like a normal conversation
- **Heartbeat + cron** — Claude checks in on a schedule or runs tasks autonomously overnight
- **Uses your Max subscription** — the same plan you already pay for, no extra charges per message

## Quick Start

```bash
npm install -g jeanclaw
jeanclaw setup
jeanclaw start
```

`setup` checks that the Claude Code CLI is installed, creates your workspace, and writes a config file at `~/.jeanclaw/config.json`. `start` launches the daemon in the foreground.

## How It Works

JeanClaw spawns `claude -p` with `--input-format stream-json --output-format stream-json`. Each channel (Telegram, iMessage, HTTP) routes incoming messages into the subprocess and streams events back. Sessions are persistent — Claude remembers the conversation until you reset it.

```
Telegram / iMessage / HTTP
         |
   ChannelRouter
         |
   SessionManager  ←→  state (~/.jeanclaw/)
         |
   ClaudeSession (subprocess)
         |
      claude -p  (your Max subscription)
```

Session scope is configurable: one session per peer (`per-peer`), one per channel (`per-channel-peer`), or one shared session for everyone (`main`).

## CLI Reference

| Command | Description |
|---------|-------------|
| `jeanclaw start` | Start the daemon |
| `jeanclaw start --config <path>` | Start with a specific config file |
| `jeanclaw start --debug` | Start with debug logging |
| `jeanclaw setup` | Interactive first-time setup |
| `jeanclaw status` | Show running daemon status (requires HTTP channel) |
| `jeanclaw doctor` | Health check — verifies CLI, config, workspace |
| `jeanclaw send <message>` | Send a one-shot message and print the response |

## Configuration

Config lives at `~/.jeanclaw/config.json`. All fields are optional — missing fields fall back to defaults.

```json
{
  "workspace": "~/jeanclaw",
  "model": "sonnet",
  "permissionMode": "bypassPermissions",
  "effort": "high",
  "maxBudgetUsd": null,
  "sessionScope": "per-peer",
  "quietHours": { "start": "23:00", "end": "08:00" },
  "heartbeat": {
    "enabled": true,
    "every": "2h",
    "session": "dedicated"
  },
  "channels": {
    "telegram": {
      "enabled": false,
      "botToken": "",
      "dmPolicy": "pairing",
      "allowedUsers": [],
      "streaming": true
    },
    "imessage": {
      "enabled": false,
      "blueBubblesUrl": "",
      "blueBubblesPassword": "",
      "allowedContacts": []
    },
    "http": {
      "enabled": true,
      "port": 18790,
      "bind": "127.0.0.1",
      "token": null
    }
  },
  "crons": [
    {
      "id": "morning-brief",
      "schedule": "0 8 * * *",
      "timezone": "Europe/Madrid",
      "prompt": "Give me a morning briefing.",
      "deliverTo": "telegram:123456789",
      "session": "isolated"
    }
  ]
}
```

**Key fields:**
- `sessionScope` — `per-peer` (default), `per-channel-peer`, or `main`
- `permissionMode` — passed directly to `claude --permission-mode`
- `heartbeat.session` — `dedicated` (separate session) or `shared` (same as messages)
- `channels.telegram.dmPolicy` — `open` (anyone), `pairing` (pair first), or `allowlist`
- `crons[].session` — `isolated` (fresh session per run) or `shared`

## Workspace Files

The workspace directory (`~/jeanclaw` by default) is where Claude runs. Files here shape Claude's behavior and memory.

| File | Purpose |
|------|---------|
| `SOUL.md` | Core personality and operating principles — loaded into every session |
| `IDENTITY.md` | Name, role, and context for who Claude is acting as |
| `USER.md` | Information about you — name, timezone, communication preferences |
| `AGENTS.md` | Rules for autonomous operation — how to handle tasks, what to write to memory |
| `HEARTBEAT.md` | Instructions for scheduled check-ins — what to look at, when to alert you |

`setup` copies starter templates for all five files. Edit them to match your needs.

## HTTP API

When the HTTP channel is enabled, three endpoints are available:

- `GET /api/health` — liveness check, no auth required
- `GET /api/status` — sessions and config summary
- `POST /api/send` — send a message, body: `{ "message": "...", "sessionKey": "optional" }`

Set `channels.http.token` to require `Authorization: Bearer <token>` on all requests except `/api/health`.

## vs OpenClaw

OpenClaw connects to the Claude API directly using Anthropic API keys. JeanClaw connects to your local `claude` CLI subprocess instead.

JeanClaw exists because Anthropic changed the Extra Usage pricing on April 4, 2026. Running a personal agent through the API now costs real money per token. JeanClaw routes everything through the Max subscription you already pay for — unlimited usage, no per-token charges.

The tradeoff: JeanClaw requires the Claude Code CLI installed on the machine running the daemon. OpenClaw can run anywhere with just an API key.

## Requirements

- Node.js >= 22
- Claude Code CLI installed and authenticated (`claude --version` should work)

## License

MIT

## Credits

Inspired by [OpenClaw](https://github.com/openclaw/openclaw). Name inspired by Jean-Claude Van Damme, who also does the splits.
