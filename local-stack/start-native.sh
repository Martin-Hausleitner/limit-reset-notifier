#!/usr/bin/env bash
# start-native.sh — run the KPI stack locally with Homebrew grafana+prometheus (no Docker).
# Serves: metrics :9109 · Prometheus :9490 · Grafana :3300 (anonymous admin).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p /tmp/lrn-grafana/data /tmp/lrn-grafana/logs /tmp/lrn-grafana/plugins /tmp/lrn-prom

node src/collect.mjs >/dev/null 2>&1 || true     # refresh dist/limit_reset.prom (AI limits)
node src/collect-aw.mjs >/dev/null 2>&1 || true  # refresh dist/activitywatch.prom (Cognitor/WHOOP)

pgrep -f "scripts/metrics-server.mjs" | head -1 >/dev/null && pgrep -f "PORT=9110" >/dev/null \
  || true
pgrep -f "metrics-server.mjs" >/dev/null \
  || (nohup node scripts/metrics-server.mjs >/tmp/lrn-metrics-server.log 2>&1 & disown)
# second metrics server for ActivityWatch/Cognitor KPIs on :9110
pgrep -f "PORT=9110" >/dev/null \
  || (PORT=9110 PROM_FILE="$ROOT/dist/activitywatch.prom" nohup node scripts/metrics-server.mjs >/tmp/lrn-aw-metrics.log 2>&1 & disown)
# third metrics server for AI-agent live metrics on :9111
node src/collect-agents.mjs >/dev/null 2>&1 || true
pgrep -f "PORT=9111" >/dev/null \
  || (PORT=9111 PROM_FILE="$ROOT/dist/agents.prom" nohup node scripts/metrics-server.mjs >/tmp/lrn-agents-metrics.log 2>&1 & disown)
# fast (20s) agent refresh loop for live parallel-agent resolution
pgrep -f "agents-refresh-loop" >/dev/null \
  || (nohup bash -c 'while true; do cd "'"$ROOT"'" && node src/collect-agents.mjs >/tmp/lrn-agents-collect.log 2>&1; sleep 20; done # agents-refresh-loop' >/dev/null 2>&1 & disown)
# refresh the AW snapshot every 60s so the dashboards stay live
pgrep -f "aw-refresh-loop" >/dev/null \
  || (nohup bash -c 'while true; do cd "'"$ROOT"'" && node src/collect-aw.mjs >/tmp/lrn-aw-collect.log 2>&1; sleep 60; done # aw-refresh-loop' >/dev/null 2>&1 & disown)
pgrep -f "storage.tsdb.path=/tmp/lrn-prom" >/dev/null \
  || (nohup prometheus --config.file=local-stack/native-prometheus.yml --storage.tsdb.path=/tmp/lrn-prom --web.listen-address=127.0.0.1:9490 >/tmp/lrn-prometheus.log 2>&1 & disown)
pgrep -f "grafana.ini" >/dev/null \
  || (nohup grafana server --config=local-stack/native/grafana.ini --homepath="$(brew --prefix grafana)/share/grafana" >/tmp/lrn-grafana-run.log 2>&1 & disown)

# wait for readiness
curl -s --retry 15 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:3300/api/health
echo "metrics :9109 · Prometheus :9490 · Grafana http://127.0.0.1:3300 (anonymous admin)"
echo "→ build dashboards: GRAFANA_URL=http://127.0.0.1:3300 GRAFANA_DS_UID=prometheus node scripts/grafana-build-all.mjs"
echo "→ screenshots:      bash scripts/shot-dashboards.sh   (set GRAFANA_URL=http://127.0.0.1:3300)"
