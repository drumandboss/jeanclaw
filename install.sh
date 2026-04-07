#!/bin/bash
set -e

echo ""
echo "  JeanClaw — One-Command Setup"
echo "  =============================="
echo ""

OS="$(uname -s)"

# ── Source nvm if available (many systems have Node via nvm) ──

if [ -f "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
fi

# ── Step 1: Node.js ──────────────────────────────────────────

install_node() {
  echo "  Installing Node.js 22..."

  # Try nvm first (no sudo needed)
  if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm install 22
    nvm use 22
    return
  fi

  # Install nvm + node (no sudo needed)
  echo "  Installing nvm (Node Version Manager)..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
}

if ! command -v node &> /dev/null; then
  install_node
elif [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]; then
  echo "  Node.js $(node -v) is too old. Need 22+."
  install_node
fi
echo "  Node.js: $(node -v)"

# ── Step 2: Claude Code CLI ──────────────────────────────────

if ! command -v claude &> /dev/null; then
  echo ""
  echo "  Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code 2>&1 | tail -1
fi

if ! command -v claude &> /dev/null; then
  echo ""
  echo "  ERROR: Claude Code CLI installation failed."
  echo "  Install manually: npm install -g @anthropic-ai/claude-code"
  exit 1
fi
echo "  Claude Code: $(claude --version 2>/dev/null | head -1)"

# Check if logged in
if ! claude auth status 2>&1 | grep -qi "logged in\|authenticated\|active"; then
  echo ""
  echo "  You need to log in to Claude Code with your Max subscription."
  echo "  Run:  claude auth login"
  echo ""
  echo "  Then run this installer again."
  exit 0
fi

# ── Step 3: Install JeanClaw ─────────────────────────────────

INSTALL_DIR="$HOME/.jeanclaw/app"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  Updating JeanClaw..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || {
    rm -rf "$INSTALL_DIR"
    git clone https://github.com/drumandboss/jeanclaw.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
else
  echo "  Installing JeanClaw..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone https://github.com/drumandboss/jeanclaw.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

npm install --production 2>&1 | tail -1

# Symlink binary
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/bin/jeanclaw.js" "$BIN_DIR/jeanclaw"
chmod +x "$INSTALL_DIR/dist/bin/jeanclaw.js"

# Add to PATH if needed
if ! echo "$PATH" | grep -q "$HOME/.local/bin"; then
  SHELL_RC="$HOME/.zshrc"
  [ ! -f "$SHELL_RC" ] && SHELL_RC="$HOME/.bashrc"
  if [ -f "$SHELL_RC" ] && ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
  fi
  export PATH="$BIN_DIR:$PATH"
fi

# ── Step 4: Setup (if not already configured) ────────────────

if [ ! -f "$HOME/.jeanclaw/config.json" ]; then
  echo ""
  echo "  Now let's set up your bot."
  echo ""
  jeanclaw setup
fi

# ── Step 5: Install as daemon ────────────────────────────────

echo ""
read -p "  Start JeanClaw on boot? (Y/n) " START_ON_BOOT
START_ON_BOOT=${START_ON_BOOT:-Y}

if [[ "$START_ON_BOOT" =~ ^[Yy] ]]; then
  jeanclaw install-daemon
else
  echo ""
  echo "  To start manually: jeanclaw start"
  echo "  To install later:  jeanclaw install-daemon"
fi

echo ""
echo "  Done! JeanClaw is ready."
echo "  Message your Telegram bot to get started."
echo ""
