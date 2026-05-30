#!/usr/bin/env node
// grafana-build-agents.mjs — "16 · KI-Agenten — Live & Verlauf": parallel running
// agents (live time-series), peak, agent-hours, tokens/cost today + multi-week,
// live sessions, hourly heatmap. ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
const t = (expr, legend, mode) => ({ expr, legendFormat: legend || "", refId: "A" + ++rid, datasource: DS, instant: mode === "instant" || mode === "table", format: mode === "table" ? "table" : "time_series" });
const P = [];
const push = (type, title, targets, { unit = "short", w = 6, h = 6, thresholds, options = {}, custom = {}, color, min, max, transformations, pluginVer } = {}) => {
  const p = { id: 0, title, type, datasource: DS, targets, options, fieldConfig: { defaults: { unit, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(thresholds ? { thresholds } : {}), ...(color ? { color } : thresholds ? { color: { mode: "thresholds" } } : {}), custom }, overrides: [] }, gridPos: { x: 0, y: 0, w, h } };
  if (transformations) p.transformations = transformations;
  if (pluginVer) p.pluginVersion = pluginVer;
  P.push(p); return p;
};
const TOOLCOLORS = { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 3, color: "green" }, { value: 8, color: "orange" }, { value: 15, color: "red" }] };

// live stat tiles
const stat = (title, expr, o = {}) => push("stat", title, [t(expr, "", "instant")], { h: 5, w: 4, options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: o.spark ? "area" : "none", colorMode: o.bg ? "background" : "value", justifyMode: "center" }, color: o.color || (o.thresholds ? { mode: "thresholds" } : { mode: "fixed", fixedColor: "text" }), ...o });
const ts = (title, targets, o = {}) => push("timeseries", title, targets, { h: o.h || 8, w: o.w || 12, custom: { drawStyle: "line", fillOpacity: o.fill ?? 30, showPoints: "never", lineWidth: 2, stacking: o.stack ? { mode: "normal" } : { mode: "none" }, ...(o.custom || {}) }, options: { legend: { showLegend: true, placement: "bottom", displayMode: "list" }, tooltip: { mode: "multi" } }, ...o });
const barDay = (title, expr, legend, o = {}) => push("barchart", title, [t(expr, legend, "table")], { h: 7, w: 12, options: { xField: "day", stacking: "none", showValue: "never", legend: { showLegend: false } }, custom: { fillOpacity: 85, lineWidth: 0 }, ...o });

// ── 1) LIVE headline stats (summed across all machines) ──
stat("🟢 Agents LIVE", "sum(ai_agents_running_total)", { bg: true, w: 4, color: { mode: "fixed", fixedColor: "green" } });
stat("Peak heute", "max_over_time((sum(ai_agents_running_total))[24h:30s])", { w: 4, color: { mode: "fixed", fixedColor: "orange" } });
stat("Aktive Sessions", "sum(ai_agent_sessions_active)", { w: 4, color: { mode: "fixed", fixedColor: "blue" } });
stat("Agent-Stunden heute", "sum(sum_over_time(ai_agents_running_total[24h])) * 5 / 3600", { w: 4, unit: "h", color: { mode: "fixed", fixedColor: "purple" } });
stat("Tokens heute", "sum(airate_tokens_window{window=\"today\",type=\"total\"})", { w: 4, unit: "short", color: { mode: "fixed", fixedColor: "teal" } });
stat("Kosten heute", "sum(airate_cost_usd_window{window=\"today\"})", { w: 4, unit: "currencyUSD", bg: true, color: { mode: "fixed", fixedColor: "red" } });

// ── 2) THE headline: parallel agents over time, stacked by tool (across machines) ──
ts("Parallele Agents über Zeit (je Tool)", [t("sum by(tool)(ai_agents_running)", "{{tool}}")], { w: 24, h: 9, stack: true, fill: 60 });

// ── 3) per-machine + peak ──
ts("Parallele Agents je Maschine", [t("ai_agents_running_total", "{{host}}"), t("max_over_time((sum(ai_agents_running_total))[1h:30s])", "Peak gesamt (1h)")], { w: 12, h: 8, fill: 25, stack: true });
// hourly heatmap of parallel agents (plugin)
push("marcusolsson-hourly-heatmap-panel", "Agents je Stunde — Heatmap", [t("sum(ai_agents_running_total)", "agents")], { w: 12, h: 8, unit: "short", pluginVer: "2.0.1", options: { showLegend: true, from: 0, to: 0, colorScheme: "interpolateViridis" } });

// ── 4) multi-week tokens & cost (from CodexBar history) ──
barDay("Tokens je Tag (Claude)", "sum by(day)(airate_tokens_by_day{provider=\"claude\"})", "tokens", { unit: "short", w: 12, color: { mode: "fixed", fixedColor: "teal" } });
barDay("Kosten je Tag ($)", "sum by(day)(airate_cost_usd_by_day{provider=\"claude\"})", "cost", { unit: "currencyUSD", w: 12, color: { mode: "fixed", fixedColor: "orange" } });

// ── 5) live sessions table ──
push("table", "Live-Sessions (Tool · Session · Laufzeit)", [t("ai_agent_session_runtime_seconds", "", "table")], {
  w: 12, h: 9, unit: "s",
  transformations: [
    { id: "filterFieldsByName", options: { include: { pattern: "^(tool|session|host|Value)$" } } },
    { id: "organize", options: { renameByName: { Value: "Laufzeit", tool: "Tool", session: "Session", host: "Host" } } },
    { id: "sortBy", options: { sort: [{ field: "Laufzeit", desc: true }] } },
  ],
  options: { showHeader: true, cellHeight: "sm" },
  custom: { cellOptions: { type: "auto" }, filterable: true },
});
// agents per tool right now (bar gauge, summed across machines)
push("bargauge", "Agents je Tool (jetzt)", [t("sum by(tool)(ai_agents_running)", "{{tool}}", "instant")], { w: 12, h: 9, unit: "short", thresholds: TOOLCOLORS, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" } });

// ── 6) cost/token rate over time (live) ──
ts("Kosten heute kumuliert ($)", [t("sum(airate_cost_usd_window{window=\"today\"})", "$ heute")], { w: 12, h: 7, fill: 20, color: { mode: "fixed", fixedColor: "red" } });
ts("Tokens heute kumuliert", [t("sum(airate_tokens_window{window=\"today\",type=\"total\"})", "tokens heute")], { w: 12, h: 7, fill: 20, color: { mode: "fixed", fixedColor: "teal" } });

function layout(panels) { let x = 0, y = 0, id = 0, rh = 0; for (const p of panels) { const { w, h } = p.gridPos; if (x + w > 24) { x = 0; y += rh; rh = 0; } p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rh = Math.max(rh, h); } return panels; }
const dashboard = { uid: "ai-agents", title: "16 · KI-Agenten — Live & Verlauf", tags: ["agents", "ai", "live"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "10s", time: { from: "now-3h", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "agents" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
