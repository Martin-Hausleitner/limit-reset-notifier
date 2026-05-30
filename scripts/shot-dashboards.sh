#!/usr/bin/env bash
# shot-dashboards.sh — screenshot all 10 Grafana KPI dashboards into proof/grafana/.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f .env.deploy ] && { set -a; . ./.env.deploy; set +a; }
export PW_PATH="$(npm root -g)/playwright" SHOT_WAITUNTIL=load SHOT_SETTLE_MS=9000
G="${GRAFANA_URL:-http://100.120.120.120:3000}"
mkdir -p proof/grafana
for uid in lrn-exec lrn-limits lrn-forecast lrn-cost lrn-tokens lrn-modelmix lrn-cache lrn-roles lrn-trends lrn-throughput; do
  node scripts/shot.mjs "$G/d/$uid/d?kiosk&from=now-30d&to=now" "proof/grafana/$uid.png" 1500 1100 >/dev/null 2>&1 \
    && echo "✓ $uid ($(stat -f%z "proof/grafana/$uid.png" 2>/dev/null) B)" || echo "✗ $uid"
done
