#!/usr/bin/env node
// grafana-build-all.mjs — provision 10 Grafana dashboards (~100 panels) from the
// NotebookLM-informed KPI taxonomy, querying the airate_* Prometheus metrics.
// ENV: GRAFANA_URL, GRAFANA_AUTH (admin:admin), GRAFANA_DS_UID (prometheus)
const BASE = (process.env.GRAFANA_URL || "http://100.120.120.120:3000").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
// mode: "instant" (single current value), "table" (instant + table format), undefined (range)
const target = (expr, legend, mode) => ({
  expr, legendFormat: legend || "", refId: "A" + ++rid, datasource: DS,
  instant: mode === "instant" || mode === "table", format: mode === "table" ? "table" : "time_series",
});
// panel helpers: g gauge, s stat, bg bargauge, ts timeseries, bar barchart, pie piechart, tbl table
const PCT = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 60, color: "orange" }, { value: 85, color: "red" }] };
const PCT_FREE = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 20, color: "orange" }, { value: 50, color: "green" }] };

function panel(type, t, targets, { unit = "short", w = 6, h = 8, thresholds, options = {}, custom = {}, min, max } = {}) {
  return {
    id: 0, title: t, type, datasource: DS, targets, options,
    fieldConfig: { defaults: { unit, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(thresholds ? { thresholds, color: { mode: "thresholds" } } : {}), custom }, overrides: [] },
    gridPos: { x: 0, y: 0, w, h },
  };
}
const g = (t, e, l, o = {}) => panel("gauge", t, [target(e, l, "instant")], { unit: "percent", min: 0, max: 100, thresholds: PCT, w: 6, options: { reduceOptions: { calcs: ["lastNotNull"] }, showThresholdMarkers: true }, ...o });
const s = (t, e, l, o = {}) => panel("stat", t, [target(e, l, "instant")], { w: 6, options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", textMode: l ? "value_and_name" : "value", colorMode: "value" }, ...o });
const bg = (t, e, l, o = {}) => panel("bargauge", t, [target(e, l, "instant")], { w: 12, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal" }, ...o });
const ts = (t, e, l, o = {}) => panel("timeseries", t, [target(e, l)], { w: 12, custom: { drawStyle: "line", fillOpacity: 12, showPoints: "never" }, ...o });
const bar = (t, e, l, o = {}) => panel("barchart", t, [target(e, l, "table")], { w: 12, options: { xField: "day", stacking: "none", showValue: "never" }, custom: { fillOpacity: 80 }, ...o });
const pie = (t, e, l, o = {}) => panel("piechart", t, [target(e, l, "table")], { w: 8, options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value", "percent"] } }, ...o });
const tbl = (t, e, l, o = {}) => panel("table", t, [target(e, l, "table")], { w: 24, options: {}, ...o });

// ---- query fragments
const cwin = (w, extra = "") => `sum(airate_cost_usd_window{provider="claude",role="all",window="${w}"${extra}})`;
const twin = (w, type = "total") => `sum(airate_tokens_window{provider="claude",role="all",window="${w}",type="${type}"})`;
const hitAll = (w) => `sum(airate_tokens_window{provider="claude",type="cache_read",role="all",window="${w}"}) / clamp_min(sum(airate_tokens_window{provider="claude",type="cache_read",role="all",window="${w}"}) + sum(airate_tokens_window{provider="claude",type="input",role="all",window="${w}"}), 1)`;

const DASHBOARDS = [
  { uid: "lrn-exec", title: "1 · Executive Overview", tags: ["lrn", "exec"], panels: [
    s("Kosten heute (Claude $)", cwin("today"), "", { unit: "currencyUSD", thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 50, color: "orange" }, { value: 150, color: "red" }] } }),
    s("Kosten 7 Tage ($)", cwin("d7"), "", { unit: "currencyUSD" }),
    s("Kosten 30 Tage ($)", cwin("d30"), "", { unit: "currencyUSD" }),
    g("Max Limit-Auslastung", "max(airate_used_percent)", ""),
    g("Cache-Hit-Ratio gesamt", hitAll("all"), "", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    s("Tokens heute", twin("today"), "", { unit: "short" }),
    s("Sessions heute", 'sum(airate_sessions_window{window="today"})', "", { unit: "short" }),
    pie("Kostenanteil je Modell", 'sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "currencyUSD" }),
    bar("Kosten je Tag ($)", 'sum by(day)(airate_cost_usd_by_day{provider="claude"})', "", { unit: "currencyUSD" }),
    bg("Restkontingent je Limit", "airate_remaining_percent", "{{provider}} · {{window}}", { unit: "percent", max: 100, thresholds: PCT_FREE }),
  ] },
  { uid: "lrn-limits", title: "2 · Rate-Limits & Resets", tags: ["lrn", "limits"], panels: [
    g("Claude Session", 'airate_used_percent{provider="claude",window="session"}', ""),
    g("Codex Session", 'airate_used_percent{provider="codex",window="session"}', ""),
    g("Claude Opus weekly", 'airate_used_percent{provider="claude",window="opus"}', ""),
    g("Claude weekly", 'airate_used_percent{provider="claude",window="weekly"}', ""),
    g("Codex weekly", 'airate_used_percent{provider="codex",window="weekly"}', ""),
    s("Reset Claude (min)", 'min(airate_reset_in_seconds{provider="claude"})', "", { unit: "s", colorMode: "value" }),
    s("Reset Codex (min)", 'min(airate_reset_in_seconds{provider="codex"})', "", { unit: "s" }),
    bg("Restkontingent %", "airate_remaining_percent", "{{provider}} · {{window}}", { unit: "percent", max: 100, thresholds: PCT_FREE }),
    ts("Verbrauch % (Verlauf)", "airate_used_percent", "{{provider}} · {{window}}", { unit: "percent", max: 100 }),
    bg("Reset in (s)", "airate_reset_in_seconds", "{{provider}} · {{window}}", { unit: "s" }),
  ] },
  { uid: "lrn-forecast", title: "3 · Limit-Exhaustion Forecasting", tags: ["lrn", "forecast"], panels: [
    ts("Burn-Rate %/h (Verlauf)", "airate_burn_percent_per_hour", "{{provider}} · {{window}}", { unit: "percent" }),
    bg("Burn-Rate jetzt (%/h)", "airate_burn_percent_per_hour > 0", "{{provider}} · {{window}}", { unit: "percent" }),
    g("Stunden bis Limit (min)", "min(airate_remaining_percent / clamp_min(airate_burn_percent_per_hour,0.01))", "", { unit: "h", max: 200, thresholds: PCT_FREE }),
    s("Limits gefährdet (exhaust vor Reset)", "sum(airate_exhausts_before_reset)", "", { unit: "short", thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 1, color: "red" }] }, colorMode: "background" }),
    ts("Restkontingent Verlauf", "airate_remaining_percent", "{{provider}} · {{window}}", { unit: "percent", max: 100 }),
    bg("Hochrisiko (used>80%)", "airate_used_percent > 80", "{{provider}} · {{window}}", { unit: "percent", max: 100, thresholds: PCT }),
    ts("unknownReset Anomalien", "airate_window_unknown_reset", "{{provider}} · {{window}}"),
    ts("expired Flags", "airate_window_expired", "{{provider}} · {{window}}"),
    s("Höchste Auslastung", "max(airate_used_percent)", "", { unit: "percent" }),
    s("Datenfrische (s)", "airate_data_age_seconds", "", { unit: "s", thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 900, color: "orange" }, { value: 1800, color: "red" }] }, colorMode: "background" }),
  ] },
  { uid: "lrn-cost", title: "4 · Kosten / FinOps", tags: ["lrn", "cost"], panels: [
    s("Gesamtkosten (Claude $)", cwin("all"), "", { unit: "currencyUSD" }),
    s("Kosten heute ($)", cwin("today"), "", { unit: "currencyUSD" }),
    s("Kosten 7T ($)", cwin("d7"), "", { unit: "currencyUSD" }),
    s("Kosten 30T ($)", cwin("d30"), "", { unit: "currencyUSD" }),
    pie("Kostenanteil je Modell", 'sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "currencyUSD" }),
    bg("Kosten je Mtok ($/M)", 'airate_cost_per_mtok_usd{provider="claude",role="all",window="all"}', "{{model}}", { unit: "currencyUSD" }),
    bar("Kosten je Tag ($)", 'sum by(day)(airate_cost_usd_by_day{provider="claude"})', "", { unit: "currencyUSD" }),
    s("Ø Kosten/Request ($)", 'avg(airate_cost_per_request_usd{provider="claude",role="all",window="all"})', "", { unit: "currencyUSD", decimals: 5 }),
    bg("Codex Kosten-Proxy je Modell", 'airate_codex_cost_window{window="all"}', "{{model}}", { unit: "short" }),
    tbl("Kosten je Modell (gesamt $)", 'sort_desc(sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="all"}))', "{{model}}", { unit: "currencyUSD" }),
  ] },
  { uid: "lrn-tokens", title: "5 · Token-Volumen je Typ", tags: ["lrn", "tokens"], panels: [
    s("Input gesamt", twin("all", "input"), "", { unit: "short" }),
    s("Output gesamt", twin("all", "output"), "", { unit: "short" }),
    s("CacheRead gesamt", twin("all", "cache_read"), "", { unit: "short" }),
    s("CacheCreate gesamt", twin("all", "cache_create"), "", { unit: "short" }),
    g("Output/Input-Ratio", 'clamp_max(sum(airate_tokens_window{provider="claude",type="output",role="all",window="all"})/clamp_min(sum(airate_tokens_window{provider="claude",type="input",role="all",window="all"}),1),50)', "", { unit: "short", max: 50, thresholds: { mode: "absolute", steps: [{ value: null, color: "blue" }] } }),
    pie("Volumen je Token-Typ", 'sum by(type)(airate_tokens_window{provider="claude",role="all",window="all",type=~"input|output|cache_read|cache_create"})', "{{type}}", { unit: "short" }),
    bar("Tokens je Tag (input)", 'sum by(day)(airate_tokens_by_day{provider="claude",type="input"})', "", { unit: "short" }),
    bar("Tokens je Tag (output)", 'sum by(day)(airate_tokens_by_day{provider="claude",type="output"})', "", { unit: "short" }),
    bg("Tokens je Modell (total)", 'sum by(model)(airate_tokens_window{provider="claude",type="total",role="all",window="all"})', "{{model}}", { unit: "short" }),
    tbl("Tokens je Modell/Typ", 'sum by(model,type)(airate_tokens_window{provider="claude",role="all",window="all",type=~"input|output|cache_read|cache_create"})', "{{model}} {{type}}", { unit: "short" }),
  ] },
  { uid: "lrn-modelmix", title: "6 · Model-Mix & Share", tags: ["lrn", "models"], panels: [
    pie("Claude Requests je Modell", 'sum by(model)(airate_requests_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "short" }),
    pie("Claude Token-Share je Modell", 'sum by(model)(airate_tokens_window{provider="claude",type="total",role="all",window="all"})', "{{model}}", { unit: "short" }),
    pie("Claude Kosten-Share je Modell", 'sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "currencyUSD" }),
    bg("Subagent-Tokens je Modell", 'sum by(model)(airate_tokens_window{provider="claude",type="total",role="subagent",window="all"})', "{{model}}", { unit: "short" }),
    bg("Codex Tokens je Modell", 'sum by(model)(airate_tokens_window{provider="codex",type="total",role="all",window="all"})', "{{model}}", { unit: "short" }),
    bar("Tokens je Tag (alle Modelle)", 'sum by(day)(airate_tokens_by_day{provider="claude",type="output"})', "", { unit: "short" }),
    s("Aktive Claude-Modelle (30T)", 'count(count by(model)(airate_cost_usd_window{provider="claude",role="all",window="d30"}))', "", { unit: "short" }),
    s("Aktive Codex-Modelle", 'count(count by(model)(airate_codex_cost_window{window="all"}))', "", { unit: "short" }),
    bg("Kosten je Modell 30T", 'sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="d30"})', "{{model}}", { unit: "currencyUSD" }),
    tbl("Modell-Übersicht (Tokens/Kosten)", 'sum by(model)(airate_cost_usd_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "currencyUSD" }),
  ] },
  { uid: "lrn-cache", title: "7 · Cache-Effizienz", tags: ["lrn", "cache"], panels: [
    g("Cache-Hit-Ratio gesamt", hitAll("all"), "", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    g("Cache-Hit-Ratio 30T", hitAll("d30"), "", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    bg("Cache-Hit-Ratio je Modell", 'airate_cache_hit_ratio{provider="claude",role="all",window="all"}', "{{model}}", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    bg("Cache-Hit-Ratio je Rolle", 'airate_cache_hit_ratio{provider="claude",role=~"parent|subagent",window="all"}', "{{role}} {{model}}", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    s("CacheRead gesamt", twin("all", "cache_read"), "", { unit: "short" }),
    s("CacheCreate gesamt", twin("all", "cache_create"), "", { unit: "short" }),
    g("CacheRead-Anteil", 'sum(airate_tokens_window{provider="claude",type="cache_read",role="all",window="all"})/clamp_min(sum(airate_tokens_window{provider="claude",type="total",role="all",window="all"}),1)', "", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    bg("Tokens je Typ", 'sum by(type)(airate_tokens_window{provider="claude",role="all",window="all",type=~"cache_read|cache_create|input|output"})', "{{type}}", { unit: "short" }),
    ts("Cache-Hit-Ratio je Modell (Verlauf)", 'airate_cache_hit_ratio{provider="claude",role="all",window="all"}', "{{model}}", { unit: "percentunit", max: 1 }),
    tbl("Cache-Kennzahlen je Modell", 'airate_cache_hit_ratio{provider="claude",role="all",window="all"}', "{{model}}", { unit: "percentunit" }),
  ] },
  { uid: "lrn-roles", title: "8 · Parent vs Subagent", tags: ["lrn", "roles"], panels: [
    g("Subagent-Kostenanteil", 'sum(airate_subagent_cost_share{provider="claude",window="all"})', "", { unit: "percentunit", max: 1, thresholds: PCT }),
    g("Subagent-Request-Anteil", 'sum(airate_subagent_request_share{provider="claude",window="all"})', "", { unit: "percentunit", max: 1, thresholds: PCT }),
    g("Sidechain-Anteil", 'sum(airate_sidechain_request_share{provider="claude",window="all"})', "", { unit: "percentunit", max: 1, thresholds: PCT }),
    pie("Kosten je Rolle", 'sum by(role)(airate_cost_usd_window{provider="claude",role=~"parent|subagent",window="all"})', "{{role}}", { unit: "currencyUSD" }),
    pie("Tokens je Rolle", 'sum by(role)(airate_tokens_window{provider="claude",type="total",role=~"parent|subagent",window="all"})', "{{role}}", { unit: "short" }),
    bg("Tokens/Request je Rolle", 'airate_tokens_per_request{provider="claude",role=~"parent|subagent",window="all"}', "{{role}} {{model}}", { unit: "short" }),
    bg("Cache-Hit je Rolle", 'airate_cache_hit_ratio{provider="claude",role=~"parent|subagent",window="all"}', "{{role}} {{model}}", { unit: "percentunit", max: 1, thresholds: PCT_FREE }),
    bar("Subagent-Kosten je Tag ($)", 'sum by(day)(airate_cost_usd_by_day_role{provider="claude",role="subagent"})', "", { unit: "currencyUSD" }),
    bar("Parent-Kosten je Tag ($)", 'sum by(day)(airate_cost_usd_by_day_role{provider="claude",role="parent"})', "", { unit: "currencyUSD" }),
    tbl("Kosten je Rolle/Modell", 'sum by(role,model)(airate_cost_usd_window{provider="claude",role=~"parent|subagent",window="all"})', "{{role}} {{model}}", { unit: "currencyUSD" }),
  ] },
  { uid: "lrn-trends", title: "9 · Daily & Weekly Trends", tags: ["lrn", "trends"], panels: [
    s("Kosten 7T ($)", cwin("d7"), "", { unit: "currencyUSD" }),
    s("Kosten 30T ($)", cwin("d30"), "", { unit: "currencyUSD" }),
    s("Tokens 7T", twin("d7"), "", { unit: "short" }),
    s("Requests 7T", 'sum(airate_requests_window{provider="claude",role="all",window="d7"})', "", { unit: "short" }),
    bar("Kosten je Tag ($)", 'sum by(day)(airate_cost_usd_by_day{provider="claude"})', "", { unit: "currencyUSD" }),
    bar("Requests je Tag", 'sum by(day)(airate_requests_by_day{provider="claude"})', "", { unit: "short" }),
    bar("Sessions je Tag", 'sum by(day)(airate_sessions_by_day{provider="claude"})', "", { unit: "short" }),
    bar("Tokens je Tag (output)", 'sum by(day)(airate_tokens_by_day{provider="claude",type="output"})', "", { unit: "short" }),
    bar("Codex Tokens je Tag", 'sum by(day)(airate_codex_tokens_by_day{type="total"})', "", { unit: "short" }),
    tbl("Top-Kosten-Tage ($)", 'sort_desc(sum by(day)(airate_cost_usd_by_day{provider="claude"}))', "", { unit: "currencyUSD" }),
  ] },
  { uid: "lrn-throughput", title: "10 · Throughput", tags: ["lrn", "throughput"], panels: [
    s("Requests gesamt", 'sum(airate_requests_window{provider="claude",role="all",window="all"})', "", { unit: "short" }),
    s("Requests heute", 'sum(airate_requests_window{provider="claude",role="all",window="today"})', "", { unit: "short" }),
    s("Ø Tokens/Request", 'sum(airate_tokens_window{provider="claude",type="total",role="all",window="all"})/clamp_min(sum(airate_requests_window{provider="claude",role="all",window="all"}),1)', "", { unit: "short" }),
    s("Sessions gesamt", 'sum(airate_sessions_window{window="all"})', "", { unit: "short" }),
    bg("Tokens/Request je Modell", 'airate_tokens_per_request{provider="claude",role="all",window="all"}', "{{model}}", { unit: "short" }),
    bg("Kosten/Request je Modell ($)", 'airate_cost_per_request_usd{provider="claude",role="all",window="all"}', "{{model}}", { unit: "currencyUSD" }),
    bar("Requests je Tag", 'sum by(day)(airate_requests_by_day{provider="claude"})', "", { unit: "short" }),
    bg("Requests je Modell (all)", 'sum by(model)(airate_requests_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "short" }),
    pie("Output vs Input (Volumen)", 'sum by(type)(airate_tokens_window{provider="claude",role="all",window="all",type=~"input|output"})', "{{type}}", { unit: "short" }),
    tbl("Requests/Tokens je Modell", 'sum by(model)(airate_requests_window{provider="claude",role="all",window="all"})', "{{model}}", { unit: "short" }),
  ] },
];

function layout(panels) {
  let x = 0, y = 0, id = 0;
  for (const p of panels) {
    const w = p.gridPos.w, h = p.gridPos.h;
    if (x + w > 24) { x = 0; y += 8; }
    p.id = ++id;
    p.gridPos = { x, y, w, h };
    x += w;
  }
  return panels;
}

const results = [];
for (const d of DASHBOARDS) {
  const dashboard = { uid: d.uid, title: d.title, tags: d.tags, timezone: "browser", schemaVersion: 39, version: 0, refresh: "30s", time: { from: "now-6h", to: "now" }, panels: layout(d.panels) };
  const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "lrn auto" }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`✗ ${d.title}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`); continue; }
  results.push({ title: d.title, panels: d.panels.length, url: `${BASE}${body.url}` });
  console.log(`✅ ${d.title}  (${d.panels.length} panels)  ${BASE}${body.url}`);
}
console.log(`\n${results.length}/10 dashboards · ${results.reduce((a, r) => a + r.panels, 0)} panels total`);
