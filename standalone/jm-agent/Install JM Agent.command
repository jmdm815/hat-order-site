#!/bin/bash
# JM Agent installer for macOS. Double-click this file (or run it in Terminal).
# It installs to ~/jm-agent, asks for your keys (typed by you, never shown),
# and sets the agent to start automatically and restart if it ever stops.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/jm-agent"
LABEL="com.jmmedia.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
say() { printf "\n\033[1;34m▸ %s\033[0m\n" "$*"; }

clear || true
bold "JM Agent installer"
echo "Installs your always-on assistant to $DEST"

# ---------------------------------------------------------------- files
say "Copying files"
mkdir -p "$DEST"
# keep existing secrets, state and memory on reinstall
rsync -a --delete \
  --exclude ".env" --exclude "state.json" --exclude "node_modules" --exclude "runtime" --exclude "logs" \
  --exclude "workspace/memory/" --exclude "workspace/inbox/" --exclude "workspace/out/" --exclude "workspace/repos/" \
  --exclude "mcp.json" --exclude "Install JM Agent.command" --exclude "workspace/.claude/" \
  "$SRC/" "$DEST/"
mkdir -p "$DEST/workspace/memory" "$DEST/workspace/inbox" "$DEST/workspace/out" "$DEST/workspace/repos" "$DEST/logs"
[ -f "$DEST/workspace/memory/MEMORY.md" ] || cp "$SRC/workspace/memory/MEMORY.md" "$DEST/workspace/memory/MEMORY.md"
chmod +x "$DEST/bin/jm-agent" 2>/dev/null || true
# the JM playbook becomes a skill every session loads
mkdir -p "$DEST/workspace/.claude/skills/jm-media-operator"
cp "$SRC/workspace/playbook/SKILL.md" "$DEST/workspace/.claude/skills/jm-media-operator/SKILL.md"

# ---------------------------------------------------------------- node
say "Checking Node.js"
export PATH="$DEST/runtime/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$MAJOR" -ge 20 ] && NODE_OK=1
fi
if [ "$NODE_OK" -ne 1 ]; then
  echo "Installing a private copy of Node.js 22 (no admin password needed)…"
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH="x64"
  FILE=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '{print $2}' | grep "darwin-$ARCH.tar.gz$" | head -1)
  mkdir -p "$DEST/runtime"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" -o "$DEST/runtime/node.tgz"
  rm -rf "$DEST/runtime/node" && mkdir -p "$DEST/runtime/node"
  tar -xzf "$DEST/runtime/node.tgz" -C "$DEST/runtime/node" --strip-components 1
  rm "$DEST/runtime/node.tgz"
fi
NODE_BIN="$(command -v node)"
echo "Using $NODE_BIN ($(node -v))"

say "Installing packages (a minute or two)"
cd "$DEST"
npm install --omit=dev --no-audit --no-fund --loglevel=error

# ---------------------------------------------------------------- keys
ENV="$DEST/.env"
touch "$ENV"; chmod 600 "$ENV"
getv() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- || true; }
setv() {
  local k="$1" v="$2"
  grep -vE "^$k=" "$ENV" > "$ENV.tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$ENV.tmp"
  mv "$ENV.tmp" "$ENV"; chmod 600 "$ENV"
}
ask() { # ask KEY "prompt" secret(0/1) optional(0/1)
  local k="$1" p="$2" secret="$3" opt="$4" cur v
  cur="$(getv "$k")"
  if [ -n "$cur" ]; then
    read -r -p "$p is already saved. Keep it? [Y/n] " keep
    [[ "$keep" =~ ^[Nn] ]] || return 0
  fi
  while true; do
    if [ "$secret" = 1 ]; then read -r -s -p "$p: " v; echo; else read -r -p "$p: " v; fi
    v="$(echo "$v" | tr -d '[:space:]')"
    if [ -n "$v" ]; then setv "$k" "$v"; return 0; fi
    [ "$opt" = 1 ] && return 0
    echo "This one is required."
  done
}

say "Your keys (paste each one; nothing shows on screen while you paste)"
echo "Anthropic API key: console.anthropic.com → API keys. Usage is billed to that account."
ask ANTHROPIC_API_KEY "Anthropic API key" 1 0
echo
echo "Telegram: in Telegram, message @BotFather, send /newbot, and copy the token it gives you."
ask TELEGRAM_BOT_TOKEN "Telegram bot token (Enter to skip)" 1 1
echo
echo "Slack (optional now; see README for the 2-minute app setup)."
ask SLACK_BOT_TOKEN "Slack bot token xoxb-… (Enter to skip)" 1 1
[ -n "$(getv SLACK_BOT_TOKEN)" ] && ask SLACK_APP_TOKEN "Slack app token xapp-…" 1 0
echo
echo "Optional: OpenAI key so the agent can understand your voice notes."
ask OPENAI_API_KEY "OpenAI API key (Enter to skip)" 1 1

[ -n "$(getv AGENT_MODEL)" ] || setv AGENT_MODEL "claude-opus-5-5"
[ -n "$(getv MAX_PARALLEL)" ] || setv MAX_PARALLEL "4"
[ -n "$(getv EXTRA_DIRS)" ] || setv EXTRA_DIRS "$HOME/Documents/JM Renders"
CODE="$(getv PAIRING_CODE)"
if [ -z "$CODE" ]; then CODE=$(LC_ALL=C tr -dc '0-9' </dev/urandom | head -c 6); setv PAIRING_CODE "$CODE"; fi

# ---------------------------------------------------------------- launchd
say "Setting it to run all the time"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE_BIN</string><string>$DEST/src/index.mjs</string></array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$DEST/logs/agent.log</string>
  <key>StandardErrorPath</key><string>$DEST/logs/agent.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true
sleep 4
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = running"; then
  bold "✅ JM Agent is running."
else
  echo "It didn't start yet. Last log lines:"; tail -n 20 "$DEST/logs/agent.log" || true
fi

# ---------------------------------------------------------------- next steps
say "Last steps"
if [ -n "$(getv TELEGRAM_BOT_TOKEN)" ]; then
  echo "1) Telegram: open your new bot and send:   /pair $CODE"
fi
if [ -n "$(getv SLACK_BOT_TOKEN)" ]; then
  echo "2) Slack: send the bot a direct message:  pair $CODE"
fi
echo
echo "So it can reach your Documents folder without macOS blocking it, give Node.js"
echo "Full Disk Access: System Settings → Privacy & Security → Full Disk Access → +"
echo "then press Cmd+Shift+G and paste:  $NODE_BIN"
read -r -p "Open that settings page now? [Y/n] " o
[[ "$o" =~ ^[Nn] ]] || open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
if ! command -v gh >/dev/null 2>&1; then
  echo
  echo "Tip: install GitHub's command-line tool so the agent can work on your repos:"
  echo "  brew install gh && gh auth login"
fi
echo
bold "Manage it any time with:  ~/jm-agent/bin/jm-agent status | logs | restart | stop"
echo
read -r -p "Press Enter to close."
