#!/bin/bash
set -e

echo ""
echo "  JeanClaw Installer"
echo "  ==================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 22+ first:"
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required. You have $(node -v)"
  echo "  Update: https://nodejs.org/"
  exit 1
fi
echo "  Node.js: $(node -v)"

# Check Claude Code
if ! command -v claude &> /dev/null; then
  echo "ERROR: Claude Code CLI not found."
  echo "  Install: https://docs.anthropic.com/en/docs/claude-code"
  echo "  Then log in with: claude"
  exit 1
fi
echo "  Claude Code: $(claude --version 2>/dev/null || echo 'installed')"

# Install location
INSTALL_DIR="$HOME/.jeanclaw/app"

if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || {
    echo "  Fresh install (couldn't pull)..."
    rm -rf "$INSTALL_DIR"
    git clone https://github.com/drumandboss/jeanclaw.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  }
else
  echo "  Cloning JeanClaw..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone https://github.com/drumandboss/jeanclaw.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
echo "  Installing dependencies..."
npm install --production 2>&1 | tail -1

# Create bin symlink
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/bin/jeanclaw.js" "$BIN_DIR/jeanclaw"
chmod +x "$INSTALL_DIR/dist/bin/jeanclaw.js"

# Check if ~/.local/bin is in PATH
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  fi

  if [ -n "$SHELL_RC" ]; then
    if ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
      echo ""
      echo "  Added ~/.local/bin to PATH in $SHELL_RC"
      echo "  Run: source $SHELL_RC"
    fi
  fi
  export PATH="$BIN_DIR:$PATH"
fi

echo ""
echo "  JeanClaw installed!"
echo ""
echo "  Next steps:"
echo "    jeanclaw setup           # configure your bot"
echo "    jeanclaw start           # start the daemon"
echo "    jeanclaw install-daemon  # auto-start on boot"
echo ""
echo "  If 'jeanclaw' is not found, run:"
echo "    source ~/.zshrc"
echo ""
