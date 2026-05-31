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
// ★ THE headline KPI: tokens/min — tokens AND time combined as a live throughput rate
stat("🔥 Tokens/min (LIVE)", 'sum(ai_agent_tokens_per_minute_total{host=~"$host"})', { bg: true, spark: true, w: 6, h: 6, unit: "short", color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 50000, color: "green" }, { value: 200000, color: "orange" }, { value: 500000, color: "red" }] } });
stat("Peak Tokens/min (3h)", 'max_over_time((sum(ai_agent_tokens_per_minute_total{host=~"$host"}))[3h:5s])', { w: 3, h: 6, unit: "short", color: { mode: "fixed", fixedColor: "orange" } });
stat("🟢 Agents LIVE", 'sum(ai_agents_running_total{host=~"$host"})', { bg: true, w: 3, color: { mode: "fixed", fixedColor: "green" } });
stat("⚡ Arbeiten gerade", 'sum(ai_agents_active{host=~"$host"})', { bg: true, w: 3, color: { mode: "fixed", fixedColor: "blue" } });
stat("⏸ Warten", 'sum(ai_agents_idle{host=~"$host"})', { w: 3, color: { mode: "fixed", fixedColor: "text" } });
stat("🧟 Stale (>3h, 0% CPU)", 'sum(ai_agents_stale{host=~"$host"})', { w: 3, color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 1, color: "orange" }, { value: 5, color: "red" }] } });
stat("Peak heute", 'max_over_time((sum(ai_agents_running_total{host=~"$host"}))[24h:30s])', { w: 3, color: { mode: "fixed", fixedColor: "orange" } });
stat("Agent-Stunden heute", 'sum(sum_over_time(ai_agents_running_total{host=~"$host"}[24h])) * 5 / 3600', { w: 3, unit: "h", color: { mode: "fixed", fixedColor: "purple" } });
stat("💸 Live-Burn $/15min", 'sum(ai_agent_session_cost_recent_usd{host=~"$host"})', { w: 3, unit: "currencyUSD", bg: true, color: { mode: "fixed", fixedColor: "red" } });
stat("Kosten heute", "(sum(airate_cost_usd_window{window=\"today\"}) or vector(0))", { w: 3, unit: "currencyUSD", color: { mode: "fixed", fixedColor: "orange" } });

// ── 2) ★ THE centerpiece: token throughput (tokens/min) over time, stacked by tool ──
ts("🔥 Tokens/min über Zeit (je Tool) — Auslastung", [
  t("sum by(tool)(ai_agent_tokens_per_minute{host=~\"$host\",tool=~\"$tool\"})", "{{tool}}"),
], { w: 24, h: 9, stack: true, fill: 55, custom: { lineWidth: 2 } });

// ── 2b) parallel agents over time, stacked by tool (across machines) ──
ts("Parallele Agents über Zeit (je Tool)", [t("sum by(tool)(ai_agents_running{host=~\"$host\",tool=~\"$tool\"})", "{{tool}}")], { w: 24, h: 9, stack: true, fill: 60 });

// ── 3) per-machine + peak ──
ts("Parallele Agents je Maschine", [t("ai_agents_running_total{host=~\"$host\"}", "{{host}}"), t("max_over_time((sum(ai_agents_running_total))[1h:30s])", "Peak gesamt (1h)")], { w: 12, h: 8, fill: 25, stack: true });
// hourly heatmap of parallel agents (plugin)
push("marcusolsson-hourly-heatmap-panel", "Agents je Stunde — Heatmap", [t("sum(ai_agents_running_total)", "agents")], { w: 12, h: 8, unit: "short", pluginVer: "2.0.1", options: { showLegend: true, from: 0, to: 0, colorScheme: "interpolateViridis" } });

// ── 4) multi-week tokens & cost (from CodexBar history) ──
barDay("Tokens je Tag (Claude)", "sum by(day)(airate_tokens_by_day{provider=\"claude\"})", "tokens", { unit: "short", w: 12, color: { mode: "fixed", fixedColor: "teal" } });
barDay("Kosten je Tag ($)", "sum by(day)(airate_cost_usd_by_day{provider=\"claude\"})", "cost", { unit: "currencyUSD", w: 12, color: { mode: "fixed", fixedColor: "orange" } });

// ── 5) live sessions table (Status · Tool · Session · Ort · Host · Laufzeit) ──
push("table", "Live-Sessions — Status · Ort · Laufzeit", [t("ai_agent_session_runtime_seconds{host=~\"$host\"}", "", "table")], {
  w: 14, h: 9, unit: "s",
  transformations: [
    { id: "filterFieldsByName", options: { include: { pattern: "^(status|tool|session|dir|host|Value)$" } } },
    { id: "organize", options: { renameByName: { Value: "Laufzeit", tool: "Tool", session: "Session", host: "Host", dir: "Ort", status: "Status" }, indexByName: { status: 0, tool: 1, session: 2, dir: 3, host: 4, Value: 5 } } },
    { id: "sortBy", options: { sort: [{ field: "Laufzeit", desc: true }] } },
  ],
  options: { showHeader: true, cellHeight: "sm" },
  custom: { cellOptions: { type: "auto" }, filterable: true },
  overrides: [{ matcher: { id: "byName", options: "Status" }, properties: [{ id: "custom.cellOptions", value: { type: "color-text" } }, { id: "mappings", value: [{ type: "value", options: { active: { color: "blue", index: 0 }, idle: { color: "text", index: 1 }, stale: { color: "orange", index: 2 } } }] }, { id: "custom.width", value: 70 }] }],
});
// agents per tool right now (bar gauge, summed across machines)
push("bargauge", "Agents je Tool (jetzt)", [t("sum by(tool)(ai_agents_running{host=~\"$host\",tool=~\"$tool\"})", "{{tool}}", "instant")], { w: 10, h: 9, unit: "short", thresholds: TOOLCOLORS, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" } });

// ── 5b) LIVE token/cost burn per session (last 15 min, from Claude JSONL) ──
push("bargauge", "🔥 Live-Token-Burn je Session (15 min)", [t("ai_agent_session_tokens_recent{host=~\"$host\"}", "{{session}}", "instant")], { w: 12, h: 9, unit: "short", color: { mode: "continuous-YlOrRd" }, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" } });
push("table", "💸 Live-Kosten & Tokens je Session (15 min)", [
  { expr: "ai_agent_session_cost_recent_usd", refId: "cost", datasource: DS, instant: true, format: "table" },
  { expr: "ai_agent_session_tokens_recent", refId: "tok", datasource: DS, instant: true, format: "table" },
], {
  w: 12, h: 9, unit: "currencyUSD",
  transformations: [
    { id: "joinByField", options: { byField: "session", mode: "outer" } },
    { id: "filterFieldsByName", options: { include: { pattern: "^(session|model|Value #(cost|tok))$" } } },
    { id: "organize", options: { renameByName: { session: "Session", model: "Modell", "Value #cost": "Kosten $", "Value #tok": "Tokens" } } },
    { id: "sortBy", options: { sort: [{ field: "Kosten $", desc: true }] } },
  ],
  options: { showHeader: true, cellHeight: "sm" },
  overrides: [{ matcher: { id: "byName", options: "Tokens" }, properties: [{ id: "unit", value: "short" }, { id: "custom.cellOptions", value: { type: "gauge", mode: "gradient" } }] }],
});
// active vs idle over time
ts("Aktiv vs. Wartend über Zeit", [t("sum(ai_agents_active{host=~\"$host\"})", "aktiv"), t("sum(ai_agents_idle{host=~\"$host\"})", "wartend"), t("sum(ai_agents_stale{host=~\"$host\"})", "stale")], { w: 24, h: 8, stack: true, fill: 50 });

// ── 6) cost/token rate over time (live) ──
ts("Kosten heute kumuliert ($)", [t("sum(airate_cost_usd_window{window=\"today\"})", "$ heute")], { w: 12, h: 7, fill: 20, color: { mode: "fixed", fixedColor: "red" } });
ts("Tokens heute kumuliert", [t("sum(airate_tokens_window{window=\"today\",type=\"total\"})", "tokens heute")], { w: 12, h: 7, fill: 20, color: { mode: "fixed", fixedColor: "teal" } });

function layout(panels) { let x = 0, y = 0, id = 0, rh = 0; for (const p of panels) { const { w, h } = p.gridPos; if (x + w > 24) { x = 0; y += rh; rh = 0; } p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rh = Math.max(rh, h); } return panels; }
const templating = { list: [
  { name: "host", type: "query", datasource: DS, query: { query: "label_values(ai_agents_running_total, host)", refId: "host" }, refresh: 2, includeAll: true, allValue: ".*", multi: true, current: { text: ["All"], value: ["$__all"] }, label: "Maschine" },
  { name: "tool", type: "query", datasource: DS, query: { query: "label_values(ai_agents_running, tool)", refId: "tool" }, refresh: 2, includeAll: true, allValue: ".*", multi: true, current: { text: ["All"], value: ["$__all"] }, label: "Tool" },
] };
const dashboard = { uid: "ai-agents", title: "16 · KI-Agenten — Live & Verlauf", tags: ["agents", "ai", "live"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "10s", templating, time: { from: "now-3h", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "agents" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
