#!/usr/bin/env bash
# vcvm-setup.sh — provision the public KPI dashboard + cloudflared tunnel on $VCVM_HOST.
# Usage:  VCVM_HOST=vcvm bash deploy/vcvm-setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f .env.deploy ] && { set -a; . ./.env.deploy; set +a; }
: "${VCVM_HOST:?set VCVM_HOST (ssh alias of the public host)}"
PORT="${PORT:-8799}"
DASH_USER="${DASH_USER:-admin}"
DASH_PASS="${DASH_PASS:-change-me}"
REMOTE="limit-reset-notifier"

echo "▶ creating dirs on $VCVM_HOST"
ssh -o BatchMode=yes "$VCVM_HOST" "mkdir -p ~/$REMOTE/dashboard ~/$REMOTE/data ~/$REMOTE/bin"

echo "▶ uploading dashboard + initial data"
scp -q dashboard/index.html dashboard/server.mjs "$VCVM_HOST:$REMOTE/dashboard/"
[ -f dist/kpi.json ]    && scp -q dist/kpi.json    "$VCVM_HOST:$REMOTE/data/kpi.json"    || true
[ -f dist/notify.json ] && scp -q dist/notify.json "$VCVM_HOST:$REMOTE/data/notify.json" || true

echo "▶ writing dashboard.env (chmod 600)"
ssh -o BatchMode=yes "$VCVM_HOST" "umask 077; cat > ~/$REMOTE/dashboard.env" <<EOF
DASH_USER=$DASH_USER
DASH_PASS=$DASH_PASS
PORT=$PORT
HOST=0.0.0.0
DATA_DIR=\$HOME/$REMOTE/data
STATIC_DIR=\$HOME/$REMOTE/dashboard
EOF

echo "▶ installing cloudflared (if missing)"
ssh -o BatchMode=yes "$VCVM_HOST" '
  REMOTE="limit-reset-notifier"
  if [ ! -x ~/$REMOTE/bin/cloudflared ]; then
    A=$(uname -m); case "$A" in x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) A=amd64;; esac
    curl -fsSL -o ~/$REMOTE/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$A"
    chmod +x ~/$REMOTE/bin/cloudflared
  fi
  ~/$REMOTE/bin/cloudflared --version'

echo "▶ installing systemd services"
HOME_REMOTE=$(ssh -o BatchMode=yes "$VCVM_HOST" 'echo $HOME')
ssh -o BatchMode=yes "$VCVM_HOST" "sudo tee /etc/systemd/system/limit-reset-dashboard.service >/dev/null" <<UNIT
[Unit]
Description=Limit Reset Notifier - public KPI dashboard
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
EnvironmentFile=$HOME_REMOTE/$REMOTE/dashboard.env
ExecStart=/usr/bin/node $HOME_REMOTE/$REMOTE/dashboard/server.mjs
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT

ssh -o BatchMode=yes "$VCVM_HOST" "sudo tee /etc/systemd/system/limit-reset-tunnel.service >/dev/null" <<UNIT
[Unit]
Description=Limit Reset Notifier - cloudflared quick tunnel
After=network-online.target limit-reset-dashboard.service
Wants=network-online.target
[Service]
Type=simple
ExecStart=$HOME_REMOTE/$REMOTE/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:$PORT
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT

ssh -o BatchMode=yes "$VCVM_HOST" '
  sudo systemctl daemon-reload
  sudo systemctl enable --now limit-reset-dashboard.service limit-reset-tunnel.service
  echo "dashboard: $(systemctl is-active limit-reset-dashboard.service)  tunnel: $(systemctl is-active limit-reset-tunnel.service)"
  timeout 40 journalctl -u limit-reset-tunnel -n 60 -f --no-pager 2>/dev/null | grep -m1 -oE "https://[a-z0-9-]+\.trycloudflare\.com"'
echo "✔ done — login user: $DASH_USER"
