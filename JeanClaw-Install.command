#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  JeanClaw Installer — Double-click to install
# ═══════════════════════════════════════════════════════════

clear
echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     JeanClaw — AI Assistant Setup     ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
echo "  This will set up your personal AI assistant"
echo "  that you can talk to via Telegram."
echo ""
echo "  Prerequisites:"
echo "    - A Claude Max subscription"
echo "    - A Telegram bot token (from @BotFather)"
echo ""
read -p "  Ready? Press Enter to continue..."
echo ""

OS="$(uname -s)"

# Source nvm if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
fi

# ── Node.js ───────────────────────────────────────────────

if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  echo "  Installing Node.js (this may take a minute)..."
  if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm install 22
    nvm use 22
  else
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
  fi
fi
echo "  [OK] Node.js $(node -v)"

# ── Claude Code ───────────────────────────────────────────

if ! command -v claude &> /dev/null; then
  echo "  Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code 2>&1 | tail -1
fi

if ! command -v claude &> /dev/null; then
  echo ""
  echo "  ERROR: Couldn't install Claude Code CLI."
  echo "  Try manually: npm install -g @anthropic-ai/claude-code"
  read -p "  Press Enter to exit..."
  exit 1
fi
echo "  [OK] Claude Code $(claude --version 2>/dev/null | head -1)"

# ── Claude Login ──────────────────────────────────────────

if ! claude auth status 2>&1 | grep -qi "logged in\|authenticated\|active"; then
  echo ""
  echo "  You need to log in to Claude with your Max subscription."
  echo "  A browser window will open — sign in there."
  echo ""
  read -p "  Press Enter to open login..."
  claude auth login 2>&1 || true
  echo ""
  if ! claude auth status 2>&1 | grep -qi "logged in\|authenticated\|active"; then
    echo "  Login didn't complete. Run this installer again after logging in."
    read -p "  Press Enter to exit..."
    exit 0
  fi
fi
echo "  [OK] Claude logged in"

# ── Install JeanClaw ──────────────────────────────────────

INSTALL_DIR="$HOME/.jeanclaw/app"

echo "  Installing JeanClaw..."
rm -rf "$INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")"
git clone --quiet https://github.com/drumandboss/jeanclaw.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
npm install --production --silent 2>&1 | tail -1
echo "  [OK] JeanClaw installed"

# Symlink binary
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/bin/jeanclaw.js" "$BIN_DIR/jeanclaw"
chmod +x "$INSTALL_DIR/dist/bin/jeanclaw.js"

SHELL_RC="$HOME/.zshrc"
[ ! -f "$SHELL_RC" ] && SHELL_RC="$HOME/.bashrc"
if [ -f "$SHELL_RC" ] && ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
fi
export PATH="$BIN_DIR:$PATH"

# ── Setup ─────────────────────────────────────────────────

echo ""
echo "  ── Bot Setup ──"
echo ""

# Workspace
WORKSPACE="$HOME/jeanclaw"
mkdir -p "$WORKSPACE"

# Copy templates
if [ -d "$INSTALL_DIR/templates" ]; then
  for t in "$INSTALL_DIR/templates/"*.md; do
    BASENAME=$(basename "$t")
    if [ ! -f "$WORKSPACE/$BASENAME" ]; then
      cp "$t" "$WORKSPACE/$BASENAME"
    fi
  done
fi

echo "  What model should your assistant use?"
echo "    1) Sonnet (fast, recommended)"
echo "    2) Opus (deeper thinking, slower)"
echo ""
read -p "  Choice [1]: " MODEL_CHOICE
MODEL_CHOICE=${MODEL_CHOICE:-1}
if [ "$MODEL_CHOICE" = "2" ]; then
  MODEL="opus"
else
  MODEL="sonnet"
fi

echo ""
echo "  Now we need a Telegram bot token."
echo "  If you don't have one:"
echo "    1. Open Telegram"
echo "    2. Message @BotFather"
echo "    3. Send /newbot"
echo "    4. Follow the steps, copy the token"
echo ""
read -p "  Paste your bot token: " BOT_TOKEN

if [ -z "$BOT_TOKEN" ]; then
  echo "  No token provided. You can add it later in ~/.jeanclaw/config.json"
  TG_ENABLED="false"
else
  TG_ENABLED="true"
fi

# Write config
cat > "$HOME/.jeanclaw/config.json" << JCEOF
{
  "workspace": "$WORKSPACE",
  "model": "$MODEL",
  "permissionMode": "bypassPermissions",
  "effort": "high",
  "maxBudgetUsd": null,
  "sessionScope": "per-peer",
  "quietHours": { "start": "23:00", "end": "08:00" },
  "heartbeat": { "enabled": true, "every": "2h", "session": "dedicated" },
  "channels": {
    "telegram": {
      "enabled": $TG_ENABLED,
      "botToken": "$BOT_TOKEN",
      "dmPolicy": "open",
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
  "crons": []
}
JCEOF

echo "  [OK] Config saved"

# ── Start as daemon ───────────────────────────────────────

echo ""
echo "  Installing as background service (starts on boot)..."
jeanclaw install-daemon 2>&1 || {
  echo "  Daemon install failed. Starting manually instead..."
  nohup jeanclaw start > "$HOME/.jeanclaw/daemon.log" 2>&1 &
  echo "  [OK] Running in background (PID $!)"
}

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         JeanClaw is running!          ║"
echo "  ╠═══════════════════════════════════════╣"
echo "  ║  Open Telegram and message your bot.  ║"
echo "  ║  It will introduce itself and help    ║"
echo "  ║  you set up schedules and more.       ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""
read -p "  Press Enter to close this window..."
