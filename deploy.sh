#!/bin/bash
# Deploy Little Bamberg to Umbrel and rebuild.
# Usage: ./deploy.sh          → auto-detect (home network or Tailscale)
#        ./deploy.sh --home   → force umbrel.local (home network)
#        ./deploy.sh --ts     → force Tailscale IP umbrel
set -e
cd "$(dirname "$0")"

TAILSCALE_IP="umbrel"
TAILSCALE_HOST="umbrel@${TAILSCALE_IP}"
HOME_HOST="umbrel@umbrel.local"
REMOTE_DIR="~/little-bamberg"

# Determine target
if [[ "$1" == "--ts" ]]; then
  TARGET="$TAILSCALE_HOST"
  SERVER_IP="$TAILSCALE_IP"
  echo "→ Using Tailscale (${TAILSCALE_IP})"
elif [[ "$1" == "--home" ]]; then
  TARGET="$HOME_HOST"
  SERVER_IP="$TAILSCALE_IP"  # the app still advertises the Tailscale IP so it's reachable from anywhere
  echo "→ Using home network (umbrel.local) for the sync, Tailscale IP for the app config"
else
  if ping -c 1 -W 1 umbrel.local &>/dev/null; then
    TARGET="$HOME_HOST"
    SERVER_IP="$TAILSCALE_IP"
    echo "→ Home network detected, using umbrel.local for the sync"
  else
    TARGET="$TAILSCALE_HOST"
    SERVER_IP="$TAILSCALE_IP"
    echo "→ Not on home network, using Tailscale (${TAILSCALE_IP})"
  fi
fi

echo ""
echo "📦 Syncing files..."
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='.env' \
  ./ "${TARGET}:${REMOTE_DIR}/"

echo ""
echo "⚙️  Writing remote .env (LAN_IP=${SERVER_IP})..."
echo "   Docker publishes the port bound to this address only, so the app is"
echo "   reachable over the tailnet but not the raw LAN or the public internet."
ssh "${TARGET}" "cat > ${REMOTE_DIR}/.env" <<EOF
LAN_IP=${SERVER_IP}
EOF

echo ""
echo "🐳 Building and starting the container..."
ssh "${TARGET}" "cd ${REMOTE_DIR} && docker compose up -d --build"

echo ""
echo "✓ Deploy complete"
echo "  → http://${SERVER_IP}:3300 (only reachable over Tailscale)"
