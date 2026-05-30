#!/usr/bin/env node
// grafana-build-aw.mjs — ActivityWatch/Cognitor + WHOOP dashboards (11–13).
// Compact + bold styling, WHOOP-app-inspired graphics, multi-day trend tracking.
// ENV: GRAFANA_URL, GRAFANA_AUTH (admin:admin), GRAFANA_DS_UID (prometheus)
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
const target = (expr, legend, mode) => ({
  expr, legendFormat: legend || "", refId: "A" + ++rid, datasource: DS,
  instant: mode === "instant" || mode === "table", format: mode === "table" ? "table" : "time_series",
});
// WHOOP colour zones: recovery red<34 / yellow 34-66 / green>=67
const RECOV = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 34, color: "yellow" }, { value: 67, color: "green" }] };
const HI_GOOD = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 34, color: "orange" }, { value: 67, color: "green" }] };
const SLEEP = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 6, color: "orange" }, { value: 7.5, color: "green" }] };
const PERF = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 70, color: "orange" }, { value: 85, color: "green" }] }; // sleep performance/efficiency, higher=better
const SPO2 = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 92, color: "orange" }, { value: 95, color: "green" }] }; // blood-oxygen, higher=better
const LO_HR = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 60, color: "orange" }, { value: 70, color: "red" }] }; // resting HR, lower=better
const RESP = { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 11, color: "green" }, { value: 18, color: "orange" }] }; // respiratory rate, ~12-18 normal

function panel(type, t, targets, { unit = "short", w = 6, h = 7, thresholds, options = {}, custom = {}, min, max, color } = {}) {
  return {
    id: 0, title: t, type, datasource: DS, targets, options,
    fieldConfig: { defaults: { unit, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(thresholds ? { thresholds } : {}), ...(color ? { color } : thresholds ? { color: { mode: "thresholds" } } : {}), custom }, overrides: [] },
    gridPos: { x: 0, y: 0, w, h },
  };
}
// compact, bold stat (background colour = punchy)
// neutral text colour when the value has no good/bad direction (avoids false-alarm red)
const S = (t, e, l, o = {}) => panel("stat", t, [target(e, l, "instant")], { h: 6, color: o.color || (o.thresholds ? { mode: "thresholds" } : { mode: "fixed", fixedColor: "text" }), options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", textMode: "value", colorMode: o.bg ? "background" : "value", justifyMode: "center" }, ...o });
const gauge = (t, e, l, o = {}) => panel("gauge", t, [target(e, l, "instant")], { unit: "percent", min: 0, max: 100, thresholds: RECOV, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, showThresholdMarkers: true }, ...o });
// bargauge over a *_by_day or top-N series — each labelled bar coloured by value
const bgauge = (t, e, l, o = {}) => panel("bargauge", t, [target(e, l, "instant")], { h: 7, w: 12, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: o.orient || "horizontal", valueMode: "color" }, ...o });
// barchart over a day-labelled series (xField=day)
const barDay = (t, e, l, o = {}) => panel("barchart", t, [target(e, l, "table")], { h: 7, w: 12, options: { xField: "day", stacking: "none", showValue: "auto", legend: { showLegend: false } }, custom: { fillOpacity: 90, lineWidth: 0 }, ...o });
// stacked per-day barchart from several [expr, legend, color] series (e.g. sleep stages).
// Uses explicit refIds so the joined value columns ("Value #<refId>") can be renamed.
function barStack(t, series, o = {}) {
  const tgts = series.map(([e, l], i) => ({ expr: e, legendFormat: l, refId: `s${i}`, datasource: DS, instant: true, format: "table" }));
  const overrides = series.map(([, l, c], i) => ({
    matcher: { id: "byName", options: `Value #s${i}` },
    properties: [{ id: "displayName", value: l }, ...(c ? [{ id: "color", value: { mode: "fixed", fixedColor: c } }] : [])],
  }));
  const p = panel("barchart", t, tgts, { h: 9, w: 24, unit: o.unit || "h", options: { xField: "day", stacking: "normal", showValue: "never", legend: { showLegend: true, placement: "right", displayMode: "list" } }, custom: { fillOpacity: 85, lineWidth: 0 }, ...o });
  p.fieldConfig.overrides = overrides;
  p.transformations = [{ id: "joinByField", options: { byField: "day", mode: "outer" } }];
  return p;
}
// grouped (side-by-side) per-day barchart — combine related metrics in one chart (WHOOP-style)
function barGroup(t, series, o = {}) {
  const tgts = series.map(([e, l], i) => ({ expr: e, legendFormat: l, refId: `g${i}`, datasource: DS, instant: true, format: "table" }));
  const overrides = series.map(([, l, c], i) => ({
    matcher: { id: "byName", options: `Value #g${i}` },
    properties: [{ id: "displayName", value: l }, ...(c ? [{ id: "color", value: { mode: "fixed", fixedColor: c } }] : [])],
  }));
  const p = panel("barchart", t, tgts, { h: 8, w: 12, unit: o.unit || "short", options: { xField: "day", stacking: "none", showValue: "never", legend: { showLegend: true, placement: "bottom", displayMode: "list" } }, custom: { fillOpacity: 80, lineWidth: 0 }, ...o });
  p.fieldConfig.overrides = overrides;
  p.transformations = [{ id: "joinByField", options: { byField: "day", mode: "outer" } }];
  return p;
}
const pie = (t, e, l, o = {}) => panel("piechart", t, [target(e, l, "instant")], { h: 7, w: 8, options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value", "percent"] } }, ...o });
const tbl = (t, e, l, o = {}) => panel("table", t, [target(e, l, "table")], { h: 7, w: 12, options: {}, ...o });
const multi = (type, t, tgts, o = {}) => panel(type, t, tgts.map(([e, l]) => target(e, l, "instant")), { h: 7, w: 8, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "horizontal" }, ...o });

const HRS = "s"; // seconds → Grafana renders h/m
const DASHBOARDS = [
  // ───────────────────────── 11 · WHOOP (recovery & sleep, app-style) ─────────
  { uid: "aw-whoop", title: "11 · WHOOP — Recovery & Schlaf", tags: ["aw", "whoop", "health"], time: "now-30d", panels: [
    // today at a glance — compact strip (8 key values)
    S("Recovery", "aw_whoop_recovery_percent", "", { unit: "percent", thresholds: RECOV, bg: true, w: 3, h: 4, color: { mode: "thresholds" } }),
    S("Schlaf", "aw_whoop_sleep_hours * 3600", "", { unit: HRS, thresholds: SLEEP, w: 3, h: 4, color: { mode: "thresholds" } }),
    S("Schlaf-Perf.", "aw_whoop_sleep_performance_percent", "", { unit: "percent", thresholds: HI_GOOD, w: 3, h: 4, color: { mode: "thresholds" } }),
    S("HRV", "aw_whoop_hrv_ms", "", { unit: "ms", thresholds: HI_GOOD, w: 3, h: 4, color: { mode: "thresholds" } }),
    S("Ruhepuls", "aw_whoop_resting_hr_bpm", "", { unit: "none", w: 3, h: 4, thresholds: LO_HR, color: { mode: "thresholds" } }),
    S("Atemfrequenz", "aw_whoop_respiratory_rate", "", { unit: "none", w: 3, h: 4, thresholds: RESP, color: { mode: "thresholds" } }),
    S("Schlaf-Effizienz", "aw_whoop_sleep_efficiency_percent", "", { unit: "percent", w: 3, h: 4, thresholds: PERF, color: { mode: "thresholds" } }),
    S("SpO₂", "aw_whoop_spo2_percent", "", { unit: "percent", w: 3, h: 4, thresholds: SPO2, color: { mode: "thresholds" } }),
    // ── headline trends ──
    bgauge("Recovery — Verlauf (30 Tage)", "aw_whoop_recovery_by_day", "{{day}}", { unit: "percent", max: 100, thresholds: RECOV, orient: "vertical", w: 24, h: 8 }),
    barStack("Schlaf & Phasen — Verlauf (30 Tage)", [
      ["aw_whoop_sleep_deep_by_day", "Tief", "#3b5bdb"],
      ["aw_whoop_sleep_rem_by_day", "REM", "#9c36b5"],
      ["aw_whoop_sleep_light_by_day", "Leicht", "#4dabf7"],
      ["aw_whoop_sleep_awake_by_day", "Wach", "#868e96"],
    ], { unit: "h", w: 24, h: 8 }),
    // ── combined charts (WHOOP-style: related metrics in one graphic) ──
    barGroup("HRV & Ruhepuls — kombiniert", [
      ["aw_whoop_hrv_by_day", "HRV (ms)", "#37b24d"],
      ["aw_whoop_rhr_by_day", "Ruhepuls (bpm)", "#1c7ed6"],
    ], { w: 12, h: 8 }),
    barGroup("Recovery & Belastung — kombiniert", [
      ["aw_whoop_recovery_by_day", "Recovery (%)", "#37b24d"],
      ["aw_whoop_strain_est_by_day * (100/21)", "Belastung (0-21, skaliert)", "#f76707"],
    ], { w: 12, h: 8, unit: "percent" }),
    barGroup("Recovery & Schlaf-Performance — kombiniert", [
      ["aw_whoop_recovery_by_day", "Recovery (%)", "#37b24d"],
      ["aw_whoop_sleep_perf_by_day", "Schlaf-Perf. (%)", "#9c36b5"],
    ], { w: 12, h: 8, unit: "percent" }),
    barGroup("Schlafbedarf vs. tatsächlich — kombiniert", [
      ["aw_whoop_sleep_need_hours_by_day", "Bedarf (h)", "#868e96"],
      ["aw_whoop_sleep_hours_by_day", "Tatsächlich (h)", "#4dabf7"],
    ], { w: 12, h: 8, unit: "h" }),
    barGroup("Schlaf-Effizienz & Konsistenz — kombiniert", [
      ["aw_whoop_sleep_efficiency_by_day", "Effizienz (%)", "#0ca678"],
      ["aw_whoop_sleep_consistency_by_day", "Konsistenz (%)", "#7048e8"],
    ], { w: 12, h: 7, unit: "percent" }),
    barGroup("Ø Puls & Max Puls — kombiniert", [
      ["aw_whoop_avg_hr_by_day", "Ø Puls (bpm)", "#1c7ed6"],
      ["aw_whoop_max_hr_by_day", "Max Puls (bpm)", "#e8590c"],
    ], { w: 12, h: 7, unit: "none" }),
    barGroup("Schlafzyklen & Störungen — kombiniert", [
      ["aw_whoop_sleep_cycles_by_day", "Zyklen", "#1098ad" ],
      ["aw_whoop_disturbances_by_day", "Störungen", "#e03131"],
    ], { w: 12, h: 7, unit: "none" }),
    // ── remaining single-value trends ──
    barDay("Atemfrequenz — Verlauf (/Tag)", "aw_whoop_respiratory_by_day", "Atemfreq.", { unit: "none", w: 6, h: 7, color: { mode: "fixed", fixedColor: "teal" } }),
    barDay("Energie / Belastung — Verlauf (kcal/Tag)", "aw_whoop_kcal_by_day", "kcal", { unit: "none", w: 6, h: 7, color: { mode: "fixed", fixedColor: "orange" } }),
    barDay("SpO₂ — Verlauf (%/Tag)", "aw_whoop_spo2_by_day", "SpO₂", { unit: "percent", w: 6, h: 7, thresholds: SPO2, color: { mode: "thresholds" }, min: 90, max: 100 }),
    barDay("Hauttemperatur — Verlauf (°C/Tag)", "aw_whoop_skin_temp_by_day", "Temp", { unit: "celsius", w: 6, h: 7, color: { mode: "fixed", fixedColor: "yellow" } }),
  ] },
  // ───────────────────────── 12 · Cognitor (time & focus) ─────────────────────
  { uid: "aw-computer", title: "12 · Cognitor — Zeit & Fokus", tags: ["aw", "cognitor", "activity"], time: "now-14d", panels: [
    S("⏱ Heute gearbeitet", "aw_work_seconds_today", "", { unit: HRS, bg: true, w: 6, h: 7, thresholds: { mode: "absolute", steps: [{ value: null, color: "blue" }, { value: 14400, color: "green" }, { value: 36000, color: "orange" }] }, color: { mode: "thresholds" } }),
    S("Aktive Zeit heute", "aw_active_seconds_today", "", { unit: HRS, bg: true, w: 6, h: 7, color: { mode: "fixed", fixedColor: "purple" } }),
    gauge("Aktiv-Anteil heute", "aw_active_ratio_today * 100", "", { unit: "percent", max: 100, thresholds: HI_GOOD, w: 4, h: 7 }),
    S("AFK heute", "aw_afk_seconds_today", "", { unit: HRS, w: 4, h: 7 }),
    S("iPhone heute", "aw_ios_screen_seconds_today", "", { unit: HRS, w: 4, h: 7 }),
    pie("Zeit je Gruppe", "aw_time_by_group_seconds_today", "{{group}}", { unit: HRS, w: 8, h: 8 }),
    bgauge("Zeit je Quelle / Gerät (Cognitor)", "aw_time_by_source_seconds_today", "{{source}}", { unit: HRS, w: 16, h: 8, color: { mode: "continuous-BlPu" } }),
    bgauge("Top Mac-Apps heute", "topk(10, aw_app_seconds_today)", "{{app}}", { unit: HRS, w: 8, h: 8, color: { mode: "continuous-BlPu" } }),
    bgauge("Top Web-Domains heute", "topk(10, aw_web_seconds_today)", "{{domain}}", { unit: HRS, w: 8, h: 8, color: { mode: "continuous-BlPu" } }),
    bgauge("Top iPhone-Apps heute", "topk(10, aw_ios_app_seconds_today)", "{{app}}", { unit: HRS, w: 8, h: 8, color: { mode: "continuous-BlPu" } }),
    // trends
    barDay("Arbeitszeit je Tag (h)", "aw_work_hours_by_day", "Arbeit", { unit: "h", w: 12, h: 8, color: { mode: "fixed", fixedColor: "blue" } }),
    barDay("Aktive Zeit je Tag (h)", "aw_active_hours_by_day", "Aktiv", { unit: "h", w: 12, h: 8, color: { mode: "fixed", fixedColor: "purple" } }),
  ] },
  // ───────────────────────── 13 · Presence & Training ─────────────────────────
  { uid: "aw-presence", title: "13 · Presence & Training", tags: ["aw", "presence"], time: "now-7d", panels: [
    tbl("Aktueller Presence-Status", "aw_presence_status_info", "", { w: 12, h: 6 }),
    pie("Zeit je Status heute", "aw_presence_seconds_today", "{{status}}", { unit: HRS, w: 8, h: 6 }),
    S("Status-Code", "aw_presence_status_code", "", { unit: "none", w: 4, h: 6 }),
    S("Workouts heute", "aw_whoop_workout_count_today", "", { unit: "none", w: 6, h: 6 }),
    S("Trainingsminuten heute", "aw_whoop_workout_minutes_today", "", { unit: "m", w: 6, h: 6 }),
    S("Trainings-kcal heute", "aw_whoop_workout_kcal_today", "", { unit: "none", w: 6, h: 6 }),
    S("YouTube-Zeit heute", "aw_youtube_seconds_today", "", { unit: HRS, w: 6, h: 6 }),
    barDay("Energie je Tag (kcal)", "aw_whoop_kcal_by_day", "kcal", { unit: "none", w: 24, h: 7, color: { mode: "fixed", fixedColor: "orange" } }),
  ] },
];

function layout(panels) {
  let x = 0, y = 0, id = 0, rowH = 0;
  for (const p of panels) {
    const w = p.gridPos.w, h = p.gridPos.h;
    if (x + w > 24) { x = 0; y += rowH; rowH = 0; }
    p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rowH = Math.max(rowH, h);
  }
  return panels;
}

const results = [];
for (const d of DASHBOARDS) {
  const dashboard = { uid: d.uid, title: d.title, tags: d.tags, timezone: "browser", schemaVersion: 39, version: 0, refresh: "30s", time: { from: d.time || "now-12h", to: "now" }, panels: layout(d.panels) };
  const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "aw auto" }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`✗ ${d.title}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`); continue; }
  results.push({ title: d.title, panels: d.panels.length, url: `${BASE}${body.url}` });
  console.log(`✅ ${d.title}  (${d.panels.length} panels)  ${BASE}${body.url}`);
}
console.log(`\n${results.length}/${DASHBOARDS.length} AW dashboards · ${results.reduce((a, r) => a + r.panels, 0)} panels`);
