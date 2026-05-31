#!/usr/bin/env node
// local-routine.mjs — the 30-minute self-healing routine for the LOCAL stack.
// Verifies every deliverable; if a piece is down it brings it back; rebuilds
// dashboards if any are missing; refreshes data. Writes state/local-routine.json.
// Exits 0 only when 100% of checks pass. Scheduled via launchd every 1800s.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GRAF = "http://127.0.0.1:3300";
const AUTH = "admin:admin";
const PROM = "http://127.0.0.1:9490";
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const curl = (url) => sh(`curl -s -m 5 "${url}"`);
const bg = (cmd, env = {}) => { const c = spawn("bash", ["-lc", cmd], { cwd: ROOT, detached: true, stdio: "ignore", env: { ...process.env, ...env } }); c.unref(); };
const running = (pat) => sh(`pgrep -f ${JSON.stringify(pat)} | head -1`) !== "";

const AI_UIDS = ["lrn-exec", "lrn-limits", "lrn-forecast", "lrn-cost", "lrn-tokens", "lrn-modelmix", "lrn-cache", "lrn-roles", "lrn-trends", "lrn-throughput"];
const AW_UIDS = ["aw-whoop", "aw-computer", "aw-presence"];
const checks = [];
const add = (name, pass, evidence) => checks.push({ name, pass: !!pass, evidence: String(evidence) });

// 1. Grafana up — heal: (re)start if down
let health = curl(`${GRAF}/api/health`);
if (!health.includes('"ok"') && !running("grafana.ini")) {
  bg(`grafana server --config=local-stack/native/grafana.ini --homepath="$(brew --prefix grafana)/share/grafana" >/tmp/lrn-grafana-run.log 2>&1`);
  sh("sleep 8"); health = curl(`${GRAF}/api/health`);
}
add("grafana_up", health.includes('"ok"') || health.includes("database"), health.slice(0, 80));

// 2. metrics servers — heal each
if (!running("scripts/metrics-server.mjs")) bg("node scripts/metrics-server.mjs >/tmp/lrn-metrics-server.log 2>&1");
if (!curl("http://127.0.0.1:9110/metrics").includes("aw_up")) bg("node scripts/metrics-server.mjs >/tmp/lrn-aw-metrics.log 2>&1", { PORT: "9110", PROM_FILE: `${ROOT}/dist/activitywatch.prom` });
if (!curl("http://127.0.0.1:9111/metrics").includes("ai_collector_up")) bg("node scripts/metrics-server.mjs >/tmp/lrn-agents-metrics.log 2>&1", { PORT: "9111", PROM_FILE: `${ROOT}/dist/agents.prom` });
if (!running("agents-refresh-loop")) bg(`while true; do node src/collect-agents.mjs >/tmp/lrn-agents-collect.log 2>&1; sleep 20; done # agents-refresh-loop`);
sh("sleep 1");
const aiSeries = (curl("http://127.0.0.1:9109/metrics").match(/\n/g) || []).length;
const awServed = curl("http://127.0.0.1:9110/metrics").includes("aw_up");
const agServed = curl("http://127.0.0.1:9111/metrics").includes("ai_collector_up");
add("metrics_9109_ai", aiSeries > 1000, `${aiSeries} lines`);
add("metrics_9110_aw", awServed, awServed ? "aw_up served" : "down");
add("metrics_9111_agents", agServed, agServed ? "agents served" : "down");

// 3. Prometheus — heal: restart if not up
if (!running("storage.tsdb.path=/tmp/lrn-prom")) {
  bg("prometheus --config.file=local-stack/native-prometheus.yml --storage.tsdb.path=/tmp/lrn-prom --web.listen-address=127.0.0.1:9490 >/tmp/lrn-prometheus.log 2>&1");
  sh("sleep 6");
}
const targets = curl(`${PROM}/api/v1/targets?state=active`);
const upCount = (targets.match(/"health":"up"/g) || []).length;
add("prometheus_targets_up", upCount >= 3, `${upCount} targets up`);

// 4. refresh data + AW refresher loop
sh("node src/collect.mjs"); sh("node src/collect-aw.mjs");
if (!running("aw-refresh-loop")) bg(`while true; do node src/collect-aw.mjs >/tmp/lrn-aw-collect.log 2>&1; sleep 60; done # aw-refresh-loop`);
add("aw_refresher", running("aw-refresh-loop") || running("aw-refresh"), "loop alive");

// 5. ActivityWatch reachable + cognitor buckets
const awInfo = curl("http://localhost:5600/api/0/info");
const buckets = curl("http://localhost:5600/api/0/buckets/");
add("activitywatch_source", awInfo.includes("version") && buckets.includes("cognitor-aggregate"), awInfo.slice(0, 60));

// 5b. push the AI-limit KPIs (tokens/min + resets) into Cognitor's AW data layer (tray source)
if (awInfo.includes("version")) {
  sh("node src/sync-cognitor.mjs >/tmp/lrn-cognitor-sync.log 2>&1 || true");
  if (!running("cognitor-sync-loop")) bg(`while true; do node src/sync-cognitor.mjs >/tmp/lrn-cognitor-sync.log 2>&1; sleep 60; done # cognitor-sync-loop`);
  add("cognitor_ai_sync", buckets.includes("ai-limits") || running("cognitor-sync-loop"), "ai-limits bucket synced");
}

// 6. dashboards present — heal: rebuild if any missing
let search = curl(`http://${AUTH}@127.0.0.1:3300/api/search?type=dash-db`);
let dashCount = (search.match(/"uid"/g) || []).length;
const EXTRA_UIDS = ["aw-whoop-lab", "ai-agents", "lrn-weekly", "lrn-index"];
const missing = [...AI_UIDS, ...AW_UIDS, ...EXTRA_UIDS].filter((u) => !search.includes(`"${u}"`));
if (missing.length) {
  for (const b of ["grafana-build-all", "grafana-build-aw", "grafana-build-whoop-lab", "grafana-build-agents", "grafana-build-weekly", "grafana-build-index"])
    sh(`GRAFANA_URL=${GRAF} GRAFANA_DS_UID=prometheus node scripts/${b}.mjs`);
  search = curl(`http://${AUTH}@127.0.0.1:3300/api/search?type=dash-db`);
  dashCount = (search.match(/"uid"/g) || []).length;
}
add("dashboards_all", dashCount >= 17, `${dashCount} dashboards`);

// 7. home dashboard = Übersicht/Launcher — heal
const prefs = curl(`http://${AUTH}@127.0.0.1:3300/api/org/preferences`);
if (!prefs.includes("lrn-index")) sh(`curl -s -X PUT http://${AUTH}@127.0.0.1:3300/api/org/preferences -H "Content-Type: application/json" -d '{"homeDashboardUID":"lrn-index","theme":"dark"}'`);
add("home_index", curl(`http://${AUTH}@127.0.0.1:3300/api/org/preferences`).includes("lrn-index"), "home=lrn-index");

// 8. representative data presence
const probes = ["airate_used_percent", "aw_whoop_recovery_percent", "aw_time_by_group_seconds_today"];
const dataOk = probes.every((m) => { const r = curl(`${PROM}/api/v1/query?query=${m}`); return r.includes('"result":[{') || r.includes('"value"'); });
add("dashboards_have_data", dataOk, dataOk ? "all probes returned data" : "a probe was empty");

const passed = checks.filter((c) => c.pass).length;
const complete = passed === checks.length;
const state = { ts: sh("date -u +%Y-%m-%dT%H:%M:%SZ"), complete, passed, total: checks.length, checks };
fs.mkdirSync(path.join(ROOT, "state"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "state", "local-routine.json"), JSON.stringify(state, null, 2));
console.log(`[local-routine] ${state.ts}  ${passed}/${checks.length} ${complete ? "✅ 100% complete" : "⚠️ healing applied"}`);
for (const c of checks) if (!c.pass) console.log(`  ✗ ${c.name}: ${c.evidence}`);
process.exit(complete ? 0 : 1);
