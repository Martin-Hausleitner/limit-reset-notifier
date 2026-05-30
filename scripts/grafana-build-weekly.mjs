#!/usr/bin/env node
// grafana-build-weekly.mjs — "15 · Wochen- & Verlaufsübersicht": multi-week token/cost/
// session history (CodexBar, ~9 weeks of *_by_day) + agent rollups. ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };
let rid = 0;
const t = (expr, legend, mode) => ({ expr, legendFormat: legend || "", refId: "A" + ++rid, datasource: DS, instant: mode !== "range", format: mode === "table" ? "table" : "time_series" });
const P = [];
const push = (type, title, targets, o = {}) => { const p = { id: 0, title, type, datasource: DS, targets, options: o.options || {}, fieldConfig: { defaults: { unit: o.unit || "short", ...(o.min != null ? { min: o.min } : {}), ...(o.max != null ? { max: o.max } : {}), ...(o.thresholds ? { thresholds: o.thresholds } : {}), ...(o.color ? { color: o.color } : o.thresholds ? { color: { mode: "thresholds" } } : {}), custom: o.custom || {} }, overrides: o.overrides || [] }, gridPos: { x: 0, y: 0, w: o.w || 6, h: o.h || 6 } }; if (o.transformations) p.transformations = o.transformations; P.push(p); return p; };
const stat = (title, expr, o = {}) => push("stat", title, [t(expr, "", "instant")], { h: 5, w: o.w || 4, unit: o.unit, color: o.color || { mode: "fixed", fixedColor: "text" }, options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", colorMode: o.bg ? "background" : "value", justifyMode: "center" }, ...o });
const barDay = (title, expr, o = {}) => push("barchart", title, [t(expr, o.legend || "", "table")], { h: 8, w: o.w || 12, unit: o.unit, color: o.color, options: { xField: "day", stacking: o.stack || "none", showValue: "never", legend: { showLegend: !!o.stack, placement: "bottom" } }, custom: { fillOpacity: 85, lineWidth: 0 }, ...o });
function barGroup(title, pairs, o = {}) {
  const tgts = pairs.map(([e, l], i) => ({ expr: e, legendFormat: l, refId: `g${i}`, datasource: DS, instant: true, format: "table" }));
  const ov = pairs.map(([, l, c], i) => ({ matcher: { id: "byName", options: `Value #g${i}` }, properties: [{ id: "displayName", value: l }, ...(c ? [{ id: "color", value: { mode: "fixed", fixedColor: c } }] : [])] }));
  push("barchart", title, tgts, { h: 8, w: o.w || 12, unit: o.unit, options: { xField: "day", stacking: "none", showValue: "never", legend: { showLegend: true, placement: "bottom" } }, custom: { fillOpacity: 80, lineWidth: 0 }, overrides: ov, transformations: [{ id: "joinByField", options: { byField: "day", mode: "outer" } }] });
}
const W = (w, type = "total") => `sum(airate_tokens_window{window="${w}",type="${type}"})`;
const C = (w) => `sum(airate_cost_usd_window{window="${w}"})`;

// ── weekly headline stats ──
stat("Tokens 7 Tage", W("d7"), { unit: "short", color: { mode: "fixed", fixedColor: "teal" } });
stat("Kosten 7 Tage", C("d7"), { unit: "currencyUSD", bg: true, color: { mode: "fixed", fixedColor: "blue" } });
stat("Tokens 30 Tage", W("d30"), { unit: "short", color: { mode: "fixed", fixedColor: "teal" } });
stat("Kosten 30 Tage", C("d30"), { unit: "currencyUSD", bg: true, color: { mode: "fixed", fixedColor: "orange" } });
stat("Ø Kosten / Tag", 'avg(airate_cost_usd_by_day{provider="claude"})', { unit: "currencyUSD", color: { mode: "fixed", fixedColor: "purple" } });
stat("Sessions gesamt", "sum(airate_sessions_by_day)", { unit: "short", color: { mode: "fixed", fixedColor: "green" } });

// ── multi-week daily bars ──
barDay("Kosten je Tag ($) — 9 Wochen", 'sum by(day)(airate_cost_usd_by_day)', { unit: "currencyUSD", w: 24, color: { mode: "continuous-YlOrRd" } });
barDay("Tokens je Tag — 9 Wochen", 'sum by(day)(airate_tokens_by_day)', { unit: "short", w: 12, color: { mode: "fixed", fixedColor: "teal" } });
barDay("Sessions je Tag — 9 Wochen", 'sum by(day)(airate_sessions_by_day)', { unit: "short", w: 12, color: { mode: "fixed", fixedColor: "green" } });
barDay("Requests je Tag — 9 Wochen", 'sum by(day)(airate_requests_by_day)', { unit: "short", w: 12, color: { mode: "fixed", fixedColor: "blue" } });
barGroup("Claude vs Codex — Kosten je Tag", [["sum by(day)(airate_cost_usd_by_day)", "Claude $", "#f76707"], ["sum by(day)(airate_codex_cost_by_day)", "Codex $", "#1098ad"]], { unit: "currencyUSD", w: 12 });

// ── agent rollups (live, build over the coming week) ──
push("timeseries", "Parallele Agents — 7-Tage-Verlauf (live)", [t("sum(ai_agents_running_total)", "Agents gesamt", "range"), t("sum by(host)(ai_agents_running_total)", "{{host}}", "range")], { w: 24, h: 8, unit: "short", custom: { drawStyle: "line", fillOpacity: 25, showPoints: "never", lineWidth: 2 }, options: { legend: { showLegend: true, placement: "bottom" }, tooltip: { mode: "multi" } } });

function layout(panels) { let x = 0, y = 0, id = 0, rh = 0; for (const p of panels) { const { w, h } = p.gridPos; if (x + w > 24) { x = 0; y += rh; rh = 0; } p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rh = Math.max(rh, h); } return panels; }
const dashboard = { uid: "lrn-weekly", title: "15 · Wochen- & Verlaufsübersicht", tags: ["weekly", "trends"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "1m", time: { from: "now-9w", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "weekly" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
