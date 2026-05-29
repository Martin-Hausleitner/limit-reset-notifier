#!/usr/bin/env bash
# tunnel-url.sh — print the current public cloudflared URL of the dashboard.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$ROOT/.env.deploy" ] && { set -a; . "$ROOT/.env.deploy"; set +a; }
: "${VCVM_HOST:?set VCVM_HOST}"
ssh -o BatchMode=yes "$VCVM_HOST" \
  'journalctl -u limit-reset-tunnel --no-pager 2>/dev/null | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" | tail -1'
