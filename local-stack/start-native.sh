#!/usr/bin/env bash
# start-native.sh — run the KPI stack locally with Homebrew grafana+prometheus (no Docker).
# Serves: metrics :9109 · Prometheus :9490 · Grafana :3300 (anonymous admin).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p /tmp/lrn-grafana/data /tmp/lrn-grafana/logs /tmp/lrn-grafana/plugins /tmp/lrn-prom

node src/collect.mjs >/dev/null 2>&1 || true   # refresh dist/limit_reset.prom

pgrep -f "scripts/metrics-server.mjs" >/dev/null \
  || (nohup node scripts/metrics-server.mjs >/tmp/lrn-metrics-server.log 2>&1 & disown)
pgrep -f "storage.tsdb.path=/tmp/lrn-prom" >/dev/null \
  || (nohup prometheus --config.file=local-stack/native-prometheus.yml --storage.tsdb.path=/tmp/lrn-prom --web.listen-address=127.0.0.1:9490 >/tmp/lrn-prometheus.log 2>&1 & disown)
pgrep -f "grafana.ini" >/dev/null \
  || (nohup grafana server --config=local-stack/native/grafana.ini --homepath="$(brew --prefix grafana)/share/grafana" >/tmp/lrn-grafana-run.log 2>&1 & disown)

# wait for readiness
curl -s --retry 15 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:3300/api/health
echo "metrics :9109 · Prometheus :9490 · Grafana http://127.0.0.1:3300 (anonymous admin)"
echo "→ build dashboards: GRAFANA_URL=http://127.0.0.1:3300 GRAFANA_DS_UID=prometheus node scripts/grafana-build-all.mjs"
echo "→ screenshots:      bash scripts/shot-dashboards.sh   (set GRAFANA_URL=http://127.0.0.1:3300)"
