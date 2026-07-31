#!/usr/bin/env node
// grafana-build-big-display.mjs — "18 · AI Usage Big Display": large-screen view
// for live Codex/Claude token burn, parallel agents, Codex accounts and 24h+ history.
// ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
const ref = () => "A" + ++rid;
const t = (expr, legend = "", mode = "range") => ({
  expr,
  legendFormat: legend,
  refId: ref(),
  datasource: DS,
  instant: mode === "instant" || mode === "table",
  format: mode === "table" ? "table" : "time_series",
});
const P = [];
const push = (type, title, targets = [], o = {}) => {
  const p = {
    id: 0,
    title,
    type,
    datasource: DS,
    targets,
    options: o.options || {},
    fieldConfig: {
      defaults: {
        unit: o.unit || "short",
        ...(o.min != null ? { min: o.min } : {}),
        ...(o.max != null ? { max: o.max } : {}),
        ...(o.thresholds ? { thresholds: o.thresholds, color: { mode: "thresholds" } } : {}),
        ...(o.color ? { color: o.color } : {}),
        custom: o.custom || {},
      },
      overrides: o.overrides || [],
    },
    gridPos: { x: 0, y: 0, w: o.w || 6, h: o.h || 6 },
  };
  if (o.transformations) p.transformations = o.transformations;
  if (o.pluginVersion) p.pluginVersion = o.pluginVersion;
  P.push(p);
  return p;
};
const header = (title, o = {}) => push("text", "", [], { w: 24, h: o.h || 2, options: { mode: "markdown", content: `## ${title}` } });
const stat = (title, expr, o = {}) => push("stat", title, [t(expr, "", "instant")], {
  w: o.w || 4,
  h: o.h || 4,
  unit: o.unit,
  thresholds: o.thresholds,
  color: o.color || (o.thresholds ? undefined : { mode: "fixed", fixedColor: "text" }),
  options: {
    reduceOptions: { calcs: ["lastNotNull"] },
    graphMode: o.spark ? "area" : "none",
    colorMode: o.bg ? "background" : "value",
    justifyMode: "center",
    textMode: "value",
  },
});
const ts = (title, series, o = {}) => push("timeseries", title, series.map(([expr, legend]) => t(expr, legend)), {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "short",
  custom: {
    drawStyle: "line",
    fillOpacity: o.fill ?? 25,
    gradientMode: "opacity",
    showPoints: o.showPoints || "auto",
    pointSize: o.pointSize || 4,
    lineWidth: o.lineWidth || 2,
    stacking: o.stack ? { mode: "normal" } : { mode: "none" },
  },
  options: { legend: { showLegend: true, placement: "bottom", displayMode: "list" }, tooltip: { mode: "multi", sort: "desc" } },
  color: o.color,
});
const bgauge = (title, expr, legend, o = {}) => push("bargauge", title, [t(expr, legend, "instant")], {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "short",
  min: o.min,
  max: o.max,
  thresholds: o.thresholds,
  color: o.color || { mode: "continuous-BlPu" },
  options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" },
});
const bgaugeMulti = (title, series, o = {}) => push("bargauge", title, series.map(([expr, legend]) => t(expr, legend, "instant")), {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "short",
  min: o.min,
  max: o.max,
  thresholds: o.thresholds,
  color: o.color || { mode: "continuous-BlPu" },
  options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" },
});
const tablePanel = (title, targets, o = {}) => push("table", title, targets, {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "short",
  transformations: o.transformations,
  options: { showHeader: true, cellHeight: "sm" },
  custom: { filterable: true },
  overrides: o.overrides,
});
const bar = (title, series, o = {}) => push("barchart", title, series.map(([expr, legend]) => t(expr, legend, "table")), {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "short",
  options: { xField: "day", stacking: o.stack || "none", showValue: "never", legend: { showLegend: true, placement: "bottom" } },
  custom: { fillOpacity: 85, lineWidth: 0 },
  transformations: series.length > 1 ? [{ id: "joinByField", options: { byField: "day", mode: "outer" } }] : undefined,
});
function barGroup(title, series, o = {}) {
  const targets = series.map(([expr, legend], i) => ({ ...t(expr, legend, "table"), refId: `g${i}` }));
  const overrides = series.map(([, legend, color], i) => ({
    matcher: { id: "byName", options: `Value #g${i}` },
    properties: [{ id: "displayName", value: legend }, ...(color ? [{ id: "color", value: { mode: "fixed", fixedColor: color } }] : [])],
  }));
  return push("barchart", title, targets, {
    w: o.w || 24,
    h: o.h || 8,
    unit: o.unit || "short",
    options: { xField: "day", stacking: o.stack || "none", showValue: "never", legend: { showLegend: true, placement: "bottom", displayMode: "list" } },
    custom: { fillOpacity: 82, lineWidth: 0 },
    transformations: [{ id: "joinByField", options: { byField: "day", mode: "outer" } }],
    overrides,
  });
}

const RATE = { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 50000, color: "green" }, { value: 200000, color: "orange" }, { value: 500000, color: "red" }] };
const AGENTS = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 8, color: "orange" }, { value: 16, color: "red" }] };
const LIMIT = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 70, color: "orange" }, { value: 90, color: "red" }] };
const REMAINING = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 20, color: "orange" }, { value: 60, color: "green" }] };

header("AI Usage Big Display · Source: CodexBar");
stat("Tokens/min live", 'sum(ai_agent_tokens_per_minute_total{host=~"$host"})', { w: 4, h: 5, bg: true, spark: true, unit: "short", thresholds: RATE });
stat("Agents live", 'sum(ai_agents_running_total{host=~"$host"})', { w: 4, h: 5, bg: true, unit: "short", thresholds: AGENTS });
stat("Aktiv", 'sum(ai_agents_active{host=~"$host"})', { w: 3, h: 5, bg: true, color: { mode: "fixed", fixedColor: "blue" } });
stat("Codex heute", 'sum(airate_tokens_today{provider="codex"})', { w: 4, h: 5, unit: "short", color: { mode: "fixed", fixedColor: "teal" } });
stat("Claude heute", 'sum(airate_tokens_today{provider="claude"})', { w: 4, h: 5, unit: "short", color: { mode: "fixed", fixedColor: "purple" } });
stat("Claude $ heute", 'sum(airate_cost_usd_window{provider="claude",window="today"})', { w: 3, h: 5, unit: "currencyUSD", color: { mode: "fixed", fixedColor: "orange" } });
stat("Source age", "airate_data_age_seconds", { w: 2, h: 5, unit: "s", thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 300, color: "orange" }, { value: 900, color: "red" }] } });

ts("24h Token-Durchsatz je Tool", [
  ['sum by(tool)(ai_agent_tokens_per_minute{host=~"$host",tool=~"$tool",tool=~"codex|claude|agy"})', "{{tool}}"],
], { w: 12, h: 9, stack: true, fill: 45, unit: "short", showPoints: "always", pointSize: 5 });
ts("24h Parallele Agents je Tool", [
  ['sum by(tool)(ai_agents_running{host=~"$host",tool=~"$tool",tool=~"codex|claude|agy"})', "{{tool}}"],
], { w: 12, h: 9, stack: true, fill: 55, unit: "short", showPoints: "always", pointSize: 5 });

bgaugeMulti("Heute Tokens je System", [
  ['sum(airate_tokens_today{provider="codex"})', "Codex"],
  ['sum(airate_tokens_today{provider="claude"})', "Claude Code"],
  ['sum(sum_over_time(ai_agent_tokens_per_minute{host=~"$host",tool="agy"}[24h])) * 5 / 60', "agy"],
], { w: 8, h: 8, unit: "short", color: { mode: "continuous-YlOrRd" } });
bgauge("Heute Agent-Stunden je System", 'sum by(tool)(sum_over_time(ai_agents_running{host=~"$host",tool=~"codex|claude|agy"}[24h])) * 5 / 3600', "{{tool}}", { w: 8, h: 8, unit: "h", color: { mode: "continuous-BlPu" } });
bgauge("Peak Agents heute je System", 'max by(tool)(max_over_time(ai_agents_running{host=~"$host",tool=~"codex|claude|agy"}[24h]))', "{{tool}}", { w: 8, h: 8, unit: "short", thresholds: AGENTS });

bgauge("AGY Prompt-Credits frei", 'ai_agy_prompt_credits_remaining_percent{host=~"$host"}', "frei", { w: 8, h: 7, unit: "percent", min: 0, max: 100, thresholds: REMAINING });
bgauge("AGY Modelle — Restquote", 'ai_agy_model_quota_remaining_percent{host=~"$host"}', "{{label}}", { w: 16, h: 7, unit: "percent", min: 0, max: 100, thresholds: REMAINING });

bgauge("Codex Accounts — Wochenlimit", 'airate_account_used_percent{provider="codex",window="weekly"}', "{{account}}", { w: 12, h: 8, unit: "percent", min: 0, max: 100, thresholds: LIMIT });
bgauge("Codex Accounts — Sessionlimit", 'airate_account_used_percent{provider="codex",window="session"}', "{{account}}", { w: 12, h: 8, unit: "percent", min: 0, max: 100, thresholds: LIMIT });

ts("CodexBar Tokenverbrauch — kumulativ heute", [
  ['sum(airate_tokens_today{provider="codex"})', "Codex"],
  ['sum(airate_tokens_today{provider="claude"})', "Claude"],
], { w: 24, h: 9, unit: "short", fill: 18, showPoints: "auto", pointSize: 4 });

ts("CodexBar Live-Durchsatz — Linien", [
  ['sum by(tool)(ai_agent_tokens_per_minute{host=~"$host",tool=~"$tool",tool=~"codex|claude|agy"})', "{{tool}}"],
  ['sum(ai_agent_tokens_per_minute_total{host=~"$host"})', "gesamt"],
], { w: 12, h: 8, unit: "short", fill: 12, showPoints: "always", pointSize: 5 });
bgauge("Codex Modelle — 30 Tage", 'sum by(model)(airate_codex_tokens_by_day{provider="codex",type="total"})', "{{model}}", { w: 12, h: 8, unit: "short", color: { mode: "continuous-BlPu" } });

ts("Aktiv, wartend, stale", [
  ['sum(ai_agents_active{host=~"$host"})', "aktiv"],
  ['sum(ai_agents_idle{host=~"$host"})', "wartend"],
  ['sum(ai_agents_stale{host=~"$host"})', "stale"],
], { w: 12, h: 8, stack: true, fill: 50 });
bgauge("Live Tokens/min je Tool", 'sum by(tool)(ai_agent_tokens_per_minute{host=~"$host",tool=~"$tool",tool=~"codex|claude|agy"})', "{{tool}}", { w: 12, h: 8, unit: "short", color: { mode: "continuous-YlOrRd" } });

header("CodexBar Langzeit-Fakten");
tablePanel("Tages-Tokens je System", [t('airate_system_tokens_by_day{system=~"codex|claude|agy"}', "", "table")], {
  w: 12,
  h: 8,
  transformations: [
    { id: "filterFieldsByName", options: { include: { pattern: "^(day|system|Value)$" } } },
    { id: "organize", options: { renameByName: { day: "Tag", system: "System", Value: "Tokens" }, indexByName: { day: 0, system: 1, Value: 2 } } },
    { id: "sortBy", options: { sort: [{ field: "Tag", desc: true }, { field: "Tokens", desc: true }] } },
  ],
  overrides: [{ matcher: { id: "byName", options: "Tokens" }, properties: [{ id: "unit", value: "short" }, { id: "custom.cellOptions", value: { type: "gauge", mode: "gradient" } }] }],
});
tablePanel("Claude Tages-Sessions & Requests", [
  { ...t('airate_system_sessions_by_day{system="claude"}', "Sessions", "table"), refId: "sess" },
  { ...t('airate_system_requests_by_day{system="claude"}', "Requests", "table"), refId: "req" },
], {
  w: 12,
  h: 8,
  transformations: [
    { id: "joinByField", options: { byField: "day", mode: "outer" } },
    { id: "filterFieldsByName", options: { include: { pattern: "^(day|Value #(sess|req))$" } } },
    { id: "organize", options: { renameByName: { day: "Tag", "Value #sess": "Sessions", "Value #req": "Requests" }, indexByName: { day: 0, "Value #sess": 1, "Value #req": 2 } } },
    { id: "sortBy", options: { sort: [{ field: "Tag", desc: true }] } },
  ],
  overrides: [
    { matcher: { id: "byName", options: "Sessions" }, properties: [{ id: "unit", value: "short" }, { id: "custom.cellOptions", value: { type: "gauge", mode: "gradient" } }] },
    { matcher: { id: "byName", options: "Requests" }, properties: [{ id: "unit", value: "short" }, { id: "custom.cellOptions", value: { type: "gauge", mode: "gradient" } }] },
  ],
});
bgauge("Claude Rollen — 30 Tage Tokens", 'sum by(role)(airate_tokens_by_day_role{provider="claude"})', "{{role}}", { w: 8, h: 8, unit: "short", color: { mode: "continuous-BlPu" } });
bgauge("Claude Token-Typen — 30 Tage", 'sum by(type)(airate_tokens_by_day{provider="claude"})', "{{type}}", { w: 8, h: 8, unit: "short", color: { mode: "continuous-BlPu" } });
bgauge("Codex Cache — 30 Tage", 'sum by(type)(airate_codex_tokens_by_day{provider="codex"})', "{{type}}", { w: 8, h: 8, unit: "short", color: { mode: "continuous-BlPu" } });
bgauge("Claude Modelle — 30 Tage Kosten", 'sum by(model)(airate_cost_usd_by_day{provider="claude"})', "{{model}}", { w: 12, h: 8, unit: "currencyUSD", color: { mode: "continuous-YlOrRd" } });
bgauge("Codex Kostenproxy — 30 Tage", 'sum by(model)(airate_codex_cost_by_day{provider="codex"})', "{{model}}", { w: 12, h: 8, unit: "short", color: { mode: "continuous-YlOrRd" } });

push("table", "Live Sessions", [t('ai_agent_session_runtime_seconds{host=~"$host"}', "", "table")], {
  w: 24,
  h: 8,
  unit: "s",
  transformations: [
    { id: "filterFieldsByName", options: { include: { pattern: "^(status|tool|session|dir|host|Value)$" } } },
    { id: "organize", options: { renameByName: { Value: "Laufzeit", tool: "Tool", session: "Session", host: "Host", dir: "Ort", status: "Status" }, indexByName: { status: 0, tool: 1, session: 2, dir: 3, host: 4, Value: 5 } } },
    { id: "sortBy", options: { sort: [{ field: "Laufzeit", desc: true }] } },
  ],
  options: { showHeader: true, cellHeight: "sm" },
  custom: { filterable: true },
});

function layout(panels) {
  let x = 0, y = 0, id = 0, rowH = 0;
  for (const p of panels) {
    const { w, h } = p.gridPos;
    if (x + w > 24) { x = 0; y += rowH; rowH = 0; }
    p.id = ++id;
    p.gridPos = { x, y, w, h };
    x += w;
    rowH = Math.max(rowH, h);
  }
  return panels;
}

const templating = { list: [
  { name: "host", type: "query", datasource: DS, query: { query: "label_values(ai_agents_running_total, host)", refId: "host" }, refresh: 2, includeAll: true, allValue: ".*", multi: true, current: { text: ["All"], value: ["$__all"] }, label: "Maschine" },
  { name: "tool", type: "query", datasource: DS, query: { query: "label_values(ai_agents_running, tool)", refId: "tool" }, refresh: 2, includeAll: true, allValue: ".*", multi: true, current: { text: ["All"], value: ["$__all"] }, label: "Tool" },
] };
const dashboard = { uid: "ai-big-display", title: "18 · AI Usage Big Display", tags: ["display", "agents", "codex", "claude"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "10s", templating, time: { from: "now-24h", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "big display" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
