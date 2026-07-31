#!/usr/bin/env node
// grafana-build-fusion.mjs — "17 · Tagessteuerung": one combined operating view
// for Cognitor time, WHOOP recovery/sleep, iPhone, AFK and live AI agents.
// ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
const target = (expr, legend = "", mode = "instant") => ({
  expr,
  legendFormat: legend,
  refId: "A" + ++rid,
  datasource: DS,
  instant: mode === "instant" || mode === "table",
  format: mode === "table" ? "table" : "time_series",
});
const P = [];
const panel = (type, title, targets, o = {}) => {
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
  P.push(p);
  return p;
};
const header = (title, body, o = {}) => panel("text", "", [], {
  w: 24,
  h: o.h || 3,
  options: { mode: "markdown", content: `## ${title}` },
});
const stat = (title, expr, o = {}) => panel("stat", title, [target(expr)], {
  w: o.w || 4,
  h: o.h || 5,
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
const timeseries = (title, series, o = {}) => panel("timeseries", title, series.map(([expr, legend]) => target(expr, legend, "range")), {
  w: o.w || 12,
  h: o.h || 7,
  unit: o.unit || "short",
  color: o.color,
  custom: {
    drawStyle: o.drawStyle || "line",
    fillOpacity: o.fillOpacity ?? 18,
    gradientMode: o.gradientMode || "opacity",
    showPoints: "never",
    lineWidth: o.lineWidth || 2,
    ...(o.custom || {}),
  },
  options: {
    legend: { showLegend: true, placement: "bottom", displayMode: "list" },
    tooltip: { mode: "multi", sort: "desc" },
  },
  overrides: o.overrides,
});
const gauge = (title, expr, o = {}) => panel("gauge", title, [target(expr)], {
  w: o.w || 6,
  h: o.h || 7,
  unit: o.unit || "percent",
  min: o.min ?? 0,
  max: o.max ?? 100,
  thresholds: o.thresholds,
  options: { reduceOptions: { calcs: ["lastNotNull"] }, showThresholdMarkers: true },
});
const bgauge = (title, expr, legend, o = {}) => panel("bargauge", title, [target(expr, legend)], {
  w: o.w || 12,
  h: o.h || 8,
  unit: o.unit || "s",
  color: o.color || { mode: "continuous-BlPu" },
  options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal", valueMode: "color" },
});
const pie = (title, expr, legend, o = {}) => panel("piechart", title, [target(expr, legend)], {
  w: o.w || 8,
  h: o.h || 8,
  unit: o.unit || "s",
  options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value", "percent"] } },
});
function joinedBars(title, series, o = {}) {
  const tgts = series.map(([expr, legend], i) => ({ ...target(expr, legend, "table"), refId: `j${i}` }));
  const overrides = series.map(([, legend, color], i) => ({
    matcher: { id: "byName", options: `Value #j${i}` },
    properties: [{ id: "displayName", value: legend }, ...(color ? [{ id: "color", value: { mode: "fixed", fixedColor: color } }] : [])],
  }));
  return panel("barchart", title, tgts, {
    w: o.w || 24,
    h: o.h || 8,
    unit: o.unit || "short",
    options: { xField: "day", stacking: o.stack || "none", showValue: "never", legend: { showLegend: true, placement: "bottom" } },
    custom: { fillOpacity: 80, lineWidth: 0 },
    transformations: [{ id: "joinByField", options: { byField: "day", mode: "outer" } }],
    overrides,
  });
}

const GOOD = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 45, color: "orange" }, { value: 70, color: "green" }] };
const LOAD = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 8, color: "orange" }, { value: 12, color: "red" }] };
const FOCUS = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 30, color: "orange" }, { value: 55, color: "green" }] };
const READINESS = "clamp_max(((avg(aw_whoop_recovery_percent) or vector(0)) * 0.45) + ((avg(aw_whoop_sleep_performance_percent) or vector(0)) * 0.25) + ((avg(aw_active_ratio_today) * 100 or vector(0)) * 0.20) + (clamp_max((sum(aw_work_seconds_today) or vector(0)) / 36000, 1) * 100 * 0.10), 100)";

header("Tagessteuerung", "Oben die Lage, direkt darunter die Bewegung: Recovery, Fokus, Arbeitslast und Agenten-Burn in einem Raster.", { h: 2 });
stat("Readiness", READINESS, { bg: true, w: 4, h: 4, unit: "percent", thresholds: GOOD });
stat("Deep Work", "sum(aw_work_seconds_today)", { bg: true, w: 4, h: 4, unit: "s", color: { mode: "fixed", fixedColor: "green" } });
stat("Aktiv / AFK", "(sum(aw_active_seconds_today) or vector(0)) / clamp_min((sum(aw_active_seconds_today) or vector(0)) + (sum(aw_afk_seconds_today) or vector(0)), 1) * 100", { w: 4, h: 4, unit: "percent", thresholds: FOCUS });
stat("Recovery", "avg(aw_whoop_recovery_percent)", { w: 4, h: 4, unit: "percent", thresholds: GOOD });
stat("Agenten live", "sum(ai_agents_running_total)", { bg: true, w: 4, h: 4, unit: "short", thresholds: LOAD });
stat("Tokens/min", "sum(ai_agent_tokens_per_minute_total)", { bg: true, spark: true, w: 4, h: 4, unit: "short", thresholds: { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 50000, color: "green" }, { value: 200000, color: "orange" }, { value: 500000, color: "red" }] } });
timeseries("Readiness / Recovery / Schlaf", [
  [READINESS, "Readiness"],
  ["avg(aw_whoop_recovery_percent)", "Recovery"],
  ["avg(aw_whoop_sleep_performance_percent)", "Schlaf"],
], { w: 6, h: 6, unit: "percent" });
timeseries("Arbeit / Aktiv / AFK", [
  ["sum(aw_work_seconds_today) / 3600", "Deep Work h"],
  ["sum(aw_active_seconds_today) / 3600", "Aktiv h"],
  ["sum(aw_afk_seconds_today) / 3600", "AFK h"],
], { w: 6, h: 6, unit: "short" });
timeseries("Agentenlast live", [
  ["sum(ai_agents_running_total)", "Agenten"],
  ["sum(ai_agents_active)", "aktiv"],
  ["sum(ai_agent_tokens_per_minute_total) / 100000", "Tokens/min /100k"],
], { w: 6, h: 6, unit: "short" });
timeseries("WHOOP Koerperdaten", [
  ["avg(aw_whoop_hrv_ms)", "HRV ms"],
  ["avg(aw_whoop_resting_hr_bpm)", "Ruhepuls"],
  ["avg(aw_whoop_sleep_hours)", "Schlaf h"],
], { w: 6, h: 6, unit: "short" });

header("Zeitbudget", "Arbeitszeit, AFK, iPhone und Browser werden dichter nebeneinander sichtbar.", { h: 2 });
pie("Zeit-Mix heute", "aw_time_by_group_seconds_today", "{{group}}", { w: 6, h: 8 });
bgauge("Geraete und Quellen", "aw_time_by_source_seconds_today", "{{source}}", { w: 10, h: 8 });
timeseries("Arbeits- und Geraeteverlauf", [
  ["sum(aw_work_seconds_today) / 3600", "Work h"],
  ["sum(aw_time_by_source_seconds_today{source=~\".*iPhone.*\"}) / 3600", "iPhone h"],
  ["sum(aw_time_by_source_seconds_today{source=~\".*Browser.*\"}) / 3600", "Browser h"],
], { w: 8, h: 8, unit: "short" });
bgauge("Top Apps heute", "topk(10, aw_app_seconds_today)", "{{app}}", { w: 8, h: 8 });
bgauge("Top Domains heute", "topk(10, aw_web_seconds_today)", "{{domain}}", { w: 8, h: 8 });
bgauge("Top iPhone-Apps heute", "topk(10, aw_ios_app_seconds_today)", "{{app}}", { w: 8, h: 8 });

header("Recovery vs Arbeit", "Diese Grafiken zeigen, ob hohe Arbeitslast mit guter Recovery zusammenfaellt oder gegen sie arbeitet.");
joinedBars("Recovery, Schlaf und Arbeit je Tag", [
  ["aw_whoop_recovery_by_day", "Recovery %", "#37b24d"],
  ["aw_whoop_sleep_perf_by_day", "Schlaf-Perf. %", "#9c36b5"],
  ["aw_work_hours_by_day * 10", "Arbeit h x10", "#1c7ed6"],
], { unit: "percent", h: 9 });
joinedBars("Aktivzeit, Schlaf und Energie je Tag", [
  ["aw_active_hours_by_day", "Aktiv h", "#7048e8"],
  ["aw_whoop_sleep_hours_by_day", "Schlaf h", "#4dabf7"],
  ["aw_whoop_kcal_by_day / 100", "kcal /100", "#f76707"],
], { unit: "short", h: 9 });

header("Agentenlast", "Live-Agenten und Tokens/min zeigen, ob gerade produktive Parallelisierung oder nur Last entsteht.");
panel("timeseries", "Tokens/min und parallele Agenten", [
  target("sum(ai_agent_tokens_per_minute_total)", "Tokens/min", "range"),
  target("sum(ai_agents_running_total) * 100000", "Agenten x100k", "range"),
], {
  w: 24,
  h: 8,
  unit: "short",
  custom: { drawStyle: "line", fillOpacity: 25, showPoints: "never", lineWidth: 2 },
  options: { legend: { showLegend: true, placement: "bottom" }, tooltip: { mode: "multi" } },
});
bgauge("Live-Agenten je Tool", "sum by(tool)(ai_agents_running)", "{{tool}}", { w: 12, h: 8, unit: "short", color: { mode: "continuous-YlOrRd" } });
bgauge("Live Token-Burn je Session", "ai_agent_session_tokens_recent", "{{session}}", { w: 12, h: 8, unit: "short", color: { mode: "continuous-YlOrRd" } });

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

const dashboard = {
  uid: "daily-control",
  title: "17 · Cognitor x Health — Tagessteuerung",
  tags: ["fusion", "cognitor", "whoop", "health"],
  timezone: "browser",
  schemaVersion: 39,
  version: 0,
  refresh: "10s",
  time: { from: "now-14d", to: "now" },
  panels: layout(P),
};
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "fusion" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
