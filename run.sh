#!/usr/bin/env bash
# run.sh — one cycle: collect KPIs → detect resets → notify Matrix (on reset) →
# push live data to the public dashboard host. Safe to run on a schedule.
# Pass --demo to force a (clearly-labelled) test notification.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# load deploy config (DASHBOARD_URL, VCVM_HOST, …) if present
if [ -f .env.deploy ]; then set -a; . ./.env.deploy; set +a; fi
export DASHBOARD_URL="${DASHBOARD_URL:-}"

# self-heal the public URL: cloudflared quick-tunnel URLs change on restart, so
# discover the live one from the host and persist it (best-effort; offline-safe).
if [ -n "${VCVM_HOST:-}" ]; then
  LIVE_URL="$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$VCVM_HOST" \
    'journalctl -u limit-reset-tunnel --no-pager 2>/dev/null | grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" | tail -1' 2>/dev/null || true)"
  if [ -n "$LIVE_URL" ] && [ "$LIVE_URL" != "${DASHBOARD_URL:-}" ]; then
    export DASHBOARD_URL="$LIVE_URL"
    if [ -f .env.deploy ]; then
      grep -v '^DASHBOARD_URL=' .env.deploy > .env.deploy.tmp 2>/dev/null || true
      printf 'DASHBOARD_URL=%s\n' "$LIVE_URL" >> .env.deploy.tmp
      mv .env.deploy.tmp .env.deploy && chmod 600 .env.deploy
    fi
    echo "↻ dashboard URL refreshed: $LIVE_URL"
  fi
fi

node src/collect.mjs
node src/detect.mjs "$@"
node src/notify-matrix.mjs || echo "(notify skipped/failed — see above)"

# publish live snapshot + last notification to the public dashboard host
if [ -n "${VCVM_HOST:-}" ]; then
  [ -f proof/last-send.json ] && cp -f proof/last-send.json dist/notify.json || true
  scp -q dist/kpi.json "$VCVM_HOST:limit-reset-notifier/data/kpi.json" 2>/dev/null \
    && echo "→ kpi.json published to $VCVM_HOST" || echo "(scp kpi.json failed)"
  if [ -f dist/notify.json ]; then
    scp -q dist/notify.json "$VCVM_HOST:limit-reset-notifier/data/notify.json" 2>/dev/null \
      && echo "→ notify.json published to $VCVM_HOST" || true
  fi
fi
echo "run.sh done"
