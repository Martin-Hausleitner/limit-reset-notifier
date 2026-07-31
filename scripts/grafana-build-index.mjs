#!/usr/bin/env node
// grafana-build-index.mjs — "0 · Übersicht / Launcher": one home page with live KPI tiles,
// an icon hero (dynamic-text plugin) and grouped dashboard links (dashlist).
// ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };
let rid = 0;
const t = (expr) => ({ expr, refId: "A" + ++rid, datasource: DS, instant: true, format: "time_series" });
const P = [];
const push = (type, title, targets, o = {}) => { P.push({ id: 0, title, type, datasource: DS, targets: targets || [], options: o.options || {}, fieldConfig: { defaults: { unit: o.unit || "short", ...(o.thresholds ? { thresholds: o.thresholds } : {}), ...(o.color ? { color: o.color } : {}), custom: {} }, overrides: [] }, gridPos: { x: 0, y: 0, w: o.w || 6, h: o.h || 4 }, ...(o.pluginVersion ? { pluginVersion: o.pluginVersion } : {}), ...(o.extra || {}) }); };
const stat = (title, expr, o = {}) => push("stat", title, [t(expr)], { h: 5, w: o.w || 4, unit: o.unit, color: o.color || { mode: "fixed", fixedColor: "text" }, options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", colorMode: o.bg ? "background" : "value", justifyMode: "center" } });
const dashlist = (title, tags, o = {}) => push("dashlist", title, [], { w: o.w || 8, h: o.h || 11, options: { showHeadings: false, showStarred: false, showRecentlyViewed: false, showSearch: true, includeVars: false, keepTime: false, tags, maxItems: 20 } });
const note = (content, o = {}) => push("text", "", [], { w: o.w || 24, h: o.h || 3, options: { mode: "markdown", content } });

// ── hero (built-in text panel — reliable markdown + emoji) ──
note("# Mission Control\nLive-KPIs fuer AI-Limits, Agenten, Cognitor-Zeit, WHOOP-Recovery und Wochenverlauf. Die Kacheln oben sind die schnelle Lage, die Listen darunter fuehren direkt in die Detailboards.", { h: 4 });

// ── live KPI tiles ──
stat("🔥 Tokens/min (LIVE)", "sum(ai_agent_tokens_per_minute_total)", { bg: true, w: 4, unit: "short", color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 50000, color: "green" }, { value: 200000, color: "orange" }, { value: 500000, color: "red" }] } });
stat("🟢 Agenten live", "sum(ai_agents_running_total)", { bg: true, w: 4, color: { mode: "fixed", fixedColor: "green" } });
stat("⚡ Arbeiten gerade", "sum(ai_agents_active)", { bg: true, w: 4, color: { mode: "fixed", fixedColor: "blue" } });
stat("💸 Live-Burn $/15min", "sum(ai_agent_session_cost_recent_usd)", { bg: true, w: 4, unit: "currencyUSD", color: { mode: "fixed", fixedColor: "red" } });
stat("💰 Kosten heute", "(sum(airate_cost_usd_window{window=\"today\"}) or vector(0))", { w: 4, unit: "currencyUSD", color: { mode: "fixed", fixedColor: "orange" } });
stat("🫀 Recovery", "aw_whoop_recovery_percent", { w: 4, unit: "percent", color: { mode: "thresholds" }, thresholds: { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 34, color: "yellow" }, { value: 67, color: "green" }] } });
stat("⏱ Heute gearbeitet", "aw_work_seconds_today", { w: 4, unit: "s", color: { mode: "fixed", fixedColor: "purple" } });

// ── grouped dashboard launchers (single tag each — multi-tag dashlist is AND) ──
note("## Detailboards\nErst die Tagessteuerung: Cognitor, WHOOP und Agenten in einer Sicht. Darunter die Detailboards fuer Quota, FinOps, Gesundheit, Zeit, Presence und Wochenverlauf.", { h: 3 });
dashlist("Tagessteuerung", ["fusion"], { w: 24, h: 5 });
dashlist("Big Display", ["display"], { w: 24, h: 5 });
dashlist("KI-Nutzung & Limits", ["lrn"], { w: 8, h: 12 });
dashlist("Cognitor, WHOOP & Presence", ["aw"], { w: 8, h: 12 });
dashlist("Agenten & Verlauf", ["agents"], { w: 8, h: 6 });
dashlist("Wochen- & Verlauf", ["weekly"], { w: 8, h: 6 });

function layout(panels) { let x = 0, y = 0, id = 0, rh = 0; for (const p of panels) { const { w, h } = p.gridPos; if (x + w > 24) { x = 0; y += rh; rh = 0; } p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rh = Math.max(rh, h); } return panels; }
const dashboard = { uid: "lrn-index", title: "0 · Übersicht", tags: ["index", "home"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "10s", time: { from: "now-3h", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "index" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
// set as Grafana home
await fetch(`${BASE}/api/org/preferences`, { method: "PUT", headers, body: JSON.stringify({ homeDashboardUID: "lrn-index", theme: "dark" }) });
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}  (als Home gesetzt)`);
