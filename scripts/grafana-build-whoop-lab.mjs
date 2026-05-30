#!/usr/bin/env node
// grafana-build-whoop-lab.mjs — "14 · WHOOP Lab": 50+ creative, information-dense
// visualisations of the WHOOP data using many different Grafana viz types.
// ENV: GRAFANA_URL, GRAFANA_AUTH, GRAFANA_DS_UID
const BASE = (process.env.GRAFANA_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

let rid = 0;
const tgt = (expr, legend, mode = "instant") => ({ expr, legendFormat: legend || "", refId: "A" + ++rid, datasource: DS, instant: true, format: mode === "table" ? "table" : "time_series" });
const RECOV = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 34, color: "yellow" }, { value: 67, color: "green" }] };
const HI = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 34, color: "orange" }, { value: 67, color: "green" }] };
const PERF = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 70, color: "orange" }, { value: 85, color: "green" }] };
const SPO2 = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 92, color: "orange" }, { value: 95, color: "green" }] };
const LO_HR = { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 60, color: "orange" }, { value: 70, color: "red" }] };
const SLEEP = { mode: "absolute", steps: [{ value: null, color: "red" }, { value: 6, color: "orange" }, { value: 7.5, color: "green" }] };

const P = [];
const push = (type, title, targets, { unit = "short", w = 6, h = 6, thresholds, options = {}, custom = {}, color, min, max, transformations } = {}) => {
  const panel = {
    id: 0, title, type, datasource: DS, targets, options,
    fieldConfig: { defaults: { unit, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), ...(thresholds ? { thresholds } : {}), ...(color ? { color } : thresholds ? { color: { mode: "thresholds" } } : {}), custom }, overrides: [] },
    gridPos: { x: 0, y: 0, w, h },
  };
  if (transformations) panel.transformations = transformations;
  P.push(panel);
  return panel;
};

// ── metric catalogs ──
const D = (m, label, o = {}) => ({ m, label, unit: o.unit || "short", th: o.th, color: o.color });
const BYDAY = [
  D("aw_whoop_recovery_by_day", "Recovery", { unit: "percent", th: RECOV, color: "green" }),
  D("aw_whoop_hrv_by_day", "HRV", { unit: "ms", color: "green" }),
  D("aw_whoop_rhr_by_day", "Ruhepuls", { unit: "none", th: LO_HR, color: "blue" }),
  D("aw_whoop_sleep_hours_by_day", "Schlaf", { unit: "h", th: SLEEP, color: "blue" }),
  D("aw_whoop_sleep_perf_by_day", "Schlaf-Perf.", { unit: "percent", th: PERF, color: "purple" }),
  D("aw_whoop_sleep_efficiency_by_day", "Effizienz", { unit: "percent", th: PERF, color: "teal" }),
  D("aw_whoop_sleep_consistency_by_day", "Konsistenz", { unit: "percent", color: "purple" }),
  D("aw_whoop_respiratory_by_day", "Atemfreq.", { unit: "none", color: "teal" }),
  D("aw_whoop_strain_est_by_day", "Belastung", { unit: "none", color: "orange" }),
  D("aw_whoop_kcal_by_day", "Energie", { unit: "none", color: "orange" }),
  D("aw_whoop_avg_hr_by_day", "Ø Puls", { unit: "none", color: "blue" }),
  D("aw_whoop_max_hr_by_day", "Max Puls", { unit: "none", color: "red" }),
  D("aw_whoop_spo2_by_day", "SpO₂", { unit: "percent", th: SPO2, color: "green" }),
  D("aw_whoop_skin_temp_by_day", "Hauttemp.", { unit: "celsius", color: "yellow" }),
  D("aw_whoop_disturbances_by_day", "Störungen", { unit: "none", color: "red" }),
  D("aw_whoop_sleep_cycles_by_day", "Zyklen", { unit: "none", color: "blue" }),
];
const TODAY = [
  { e: "aw_whoop_recovery_percent", label: "Recovery", unit: "percent", th: RECOV },
  { e: "aw_whoop_sleep_performance_percent", label: "Schlaf-Perf.", unit: "percent", th: PERF },
  { e: "aw_whoop_sleep_efficiency_percent", label: "Effizienz", unit: "percent", th: PERF },
  { e: "aw_whoop_sleep_consistency_percent", label: "Konsistenz", unit: "percent", th: PERF },
  { e: "aw_whoop_spo2_percent", label: "SpO₂", unit: "percent", th: SPO2 },
  { e: "aw_whoop_respiratory_rate", label: "Atemfreq.", unit: "none" },
];

// ════════ 1) radial gauges — today (6) ════════
for (const t of TODAY) push("gauge", `◍ ${t.label}`, [tgt(t.e)], { unit: t.unit, max: t.unit === "percent" ? 100 : undefined, thresholds: t.th, w: 4, h: 6, options: { reduceOptions: { calcs: ["lastNotNull"] }, showThresholdMarkers: true } });

// ════════ 2) big stat tiles — today (6) ════════
const TILES = [
  ["aw_whoop_recovery_percent", "Recovery", "percent", RECOV],
  ["aw_whoop_sleep_hours * 3600", "Schlaf", "s", SLEEP],
  ["aw_whoop_hrv_ms", "HRV", "ms", HI],
  ["aw_whoop_resting_hr_bpm", "Ruhepuls", "none", LO_HR],
  ["aw_whoop_day_kcal", "Energie kcal", "none", null],
  ["aw_whoop_sleep_cycles", "Schlafzyklen", "none", null],
];
for (const [e, label, unit, th] of TILES) push("stat", label, [tgt(e)], { unit, thresholds: th, color: th ? { mode: "thresholds" } : { mode: "fixed", fixedColor: "text" }, w: 4, h: 5, options: { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", colorMode: "background", justifyMode: "center" } });

// ════════ 3) today % values as bargauge — 3 display modes (3) ════════
const pctToday = TODAY.filter((t) => t.unit === "percent").map((t) => tgt(t.e, t.label));
for (const dm of ["gradient", "lcd", "basic"]) push("bargauge", `Heute % — ${dm}`, TODAY.filter((t) => t.unit === "percent").map((t) => tgt(t.e, t.label)), { unit: "percent", max: 100, thresholds: HI, w: 8, h: 6, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: dm, orientation: "horizontal", valueMode: "color" } });

// ════════ 4) Recovery-Verlauf — 3 different viz (3) ════════
push("bargauge", "Recovery — Säulen (Zonen)", [tgt("aw_whoop_recovery_by_day", "{{day}}")], { unit: "percent", max: 100, thresholds: RECOV, w: 12, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "gradient", orientation: "vertical", valueMode: "color" } });
push("bargauge", "Recovery — LCD horizontal", [tgt("aw_whoop_recovery_by_day", "{{day}}")], { unit: "percent", max: 100, thresholds: RECOV, w: 12, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "lcd", orientation: "horizontal", valueMode: "color" } });

// ════════ 5) small-multiples: one barchart per metric (16) ════════
for (const d of BYDAY) push("barchart", d.label, [tgt(d.m, d.label, "table")], { unit: d.unit, w: 6, h: 6, thresholds: d.th, color: d.th ? { mode: "thresholds" } : { mode: "fixed", fixedColor: d.color }, options: { xField: "day", stacking: "none", showValue: "never", legend: { showLegend: false } }, custom: { fillOpacity: 85, lineWidth: 0 } });

// ════════ 6) histograms — distribution of key metrics (8) ════════
for (const d of [BYDAY[0], BYDAY[1], BYDAY[2], BYDAY[3], BYDAY[4], BYDAY[8], BYDAY[9], BYDAY[7]])
  push("histogram", `Verteilung — ${d.label}`, [tgt(d.m, d.label, "table")], { unit: d.unit, w: 6, h: 6, color: { mode: "fixed", fixedColor: d.color || "blue" }, options: { combine: false }, custom: { fillOpacity: 70 } });

// ════════ 7) correlation scatter (xychart) — WHOOP-style (4) ════════
function scatter(title, xExpr, xLabel, yExpr, yLabel, o = {}) {
  // auto mapping picks first numeric field as X, next as Y — so push X target first.
  const tx = { ...tgt(xExpr, xLabel, "table"), refId: "X" + rid }, ty = { ...tgt(yExpr, yLabel, "table"), refId: "Y" + rid };
  push("xychart", `${title}  (x: ${xLabel}, y: ${yLabel})`, [tx, ty], {
    w: o.w || 8, h: 7,
    options: { seriesMapping: "auto", showLegend: false },
    transformations: [{ id: "joinByField", options: { byField: "day", mode: "outer" } }],
  });
}
scatter("Recovery × Belastung", "aw_whoop_strain_est_by_day", "Belastung", "aw_whoop_recovery_by_day", "Recovery");
scatter("Recovery × HRV", "aw_whoop_hrv_by_day", "HRV", "aw_whoop_recovery_by_day", "Recovery");
scatter("Schlaf × Schlaf-Performance", "aw_whoop_sleep_hours_by_day", "Schlaf h", "aw_whoop_sleep_perf_by_day", "Perf");
scatter("HRV × Ruhepuls", "aw_whoop_rhr_by_day", "RHR", "aw_whoop_hrv_by_day", "HRV");

// ════════ 8) donuts / pies (3) ════════
push("piechart", "Recovery-Zonen (Tage)", [tgt("count(aw_whoop_recovery_by_day >= 67)", "Grün"), tgt("count(aw_whoop_recovery_by_day >= 34 and aw_whoop_recovery_by_day < 67)", "Gelb"), tgt("count(aw_whoop_recovery_by_day < 34)", "Rot")], { unit: "none", w: 8, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value", "percent"] } } });
push("piechart", "Ø Schlafphasen (h)", [tgt("avg(aw_whoop_sleep_deep_by_day)", "Tief"), tgt("avg(aw_whoop_sleep_rem_by_day)", "REM"), tgt("avg(aw_whoop_sleep_light_by_day)", "Leicht"), tgt("avg(aw_whoop_sleep_awake_by_day)", "Wach")], { unit: "h", w: 8, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "pie", legend: { displayMode: "table", placement: "right", values: ["value", "percent"] } } });
push("piechart", "Puls Ø/Max/Ruhe (heute)", [tgt("aw_whoop_resting_hr_bpm", "Ruhe"), tgt("aw_whoop_day_avg_hr_bpm", "Ø"), tgt("aw_whoop_day_max_hr_bpm", "Max")], { unit: "none", w: 8, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value"] } } });

// ════════ 9) combined grouped barcharts — related metrics in one (6) ════════
function group(title, pairs, o = {}) {
  const tgts = pairs.map(([e, l], i) => ({ expr: e, legendFormat: l, refId: `g${rid}_${i}`, datasource: DS, instant: true, format: "table" }));
  const overrides = pairs.map(([, l, c], i) => ({ matcher: { id: "byName", options: `Value #g${rid}_${i}` }, properties: [{ id: "displayName", value: l }, ...(c ? [{ id: "color", value: { mode: "fixed", fixedColor: c } }] : [])] }));
  const p = push("barchart", title, tgts, { unit: o.unit || "short", w: o.w || 12, h: 7, options: { xField: "day", stacking: o.stack || "none", showValue: "never", legend: { showLegend: true, placement: "bottom" } }, custom: { fillOpacity: 80, lineWidth: 0 }, transformations: [{ id: "joinByField", options: { byField: "day", mode: "outer" } }] });
  p.fieldConfig.overrides = overrides;
}
group("Recovery & Belastung", [["aw_whoop_recovery_by_day", "Recovery", "#37b24d"], ["aw_whoop_strain_est_by_day * (100/21)", "Belastung", "#f76707"]], { unit: "percent" });
group("HRV & Ruhepuls", [["aw_whoop_hrv_by_day", "HRV", "#37b24d"], ["aw_whoop_rhr_by_day", "Ruhepuls", "#1c7ed6"]]);
group("Ø & Max Puls", [["aw_whoop_avg_hr_by_day", "Ø", "#1c7ed6"], ["aw_whoop_max_hr_by_day", "Max", "#e8590c"]]);
group("Schlafbedarf vs. tatsächlich", [["aw_whoop_sleep_need_hours_by_day", "Bedarf", "#868e96"], ["aw_whoop_sleep_hours_by_day", "Schlaf", "#4dabf7"]], { unit: "h" });
group("Schlafphasen (gestapelt)", [["aw_whoop_sleep_deep_by_day", "Tief", "#3b5bdb"], ["aw_whoop_sleep_rem_by_day", "REM", "#9c36b5"], ["aw_whoop_sleep_light_by_day", "Leicht", "#4dabf7"], ["aw_whoop_sleep_awake_by_day", "Wach", "#868e96"]], { unit: "h", stack: "normal" });
group("Effizienz & Konsistenz", [["aw_whoop_sleep_efficiency_by_day", "Effizienz", "#0ca678"], ["aw_whoop_sleep_consistency_by_day", "Konsistenz", "#7048e8"]], { unit: "percent" });

// ════════ 10) horizontal bargauge by-day for 4 metrics (4) ════════
for (const d of [BYDAY[1], BYDAY[3], BYDAY[8], BYDAY[9]])
  push("bargauge", `${d.label} — je Tag (LCD)`, [tgt(d.m, "{{day}}")], { unit: d.unit, thresholds: d.th, color: d.th ? { mode: "thresholds" } : { mode: "continuous-BlPu" }, w: 6, h: 7, options: { reduceOptions: { calcs: ["lastNotNull"] }, displayMode: "lcd", orientation: "horizontal", valueMode: "color" } });

// ════════ 11) dense gauge-cell tables (2) ════════
function gaugeTable(title, metrics) {
  // sum by(day) strips Prometheus label columns (__name__/instance/job) so only day+Value remain
  const tgts = metrics.map((d, i) => ({ expr: `sum by(day)(${d.m})`, refId: `t${i}`, datasource: DS, instant: true, format: "table" }));
  const overrides = metrics.map((d, i) => ({
    matcher: { id: "byName", options: `Value #t${i}` },
    properties: [{ id: "displayName", value: d.label }, { id: "unit", value: d.unit }, ...(d.th ? [{ id: "thresholds", value: d.th }, { id: "color", value: { mode: "thresholds" } }] : []), { id: "custom.cellOptions", value: { type: "gauge", mode: "gradient" } }, { id: "custom.width", value: 95 }],
  }));
  const p = push("table", title, tgts, {
    w: 24, h: 9, options: { showHeader: true, cellHeight: "sm", footer: { show: false } },
    custom: { cellOptions: { type: "gauge", mode: "gradient" }, align: "center" },
    transformations: [
      { id: "joinByField", options: { byField: "day", mode: "outer" } },
      { id: "filterFieldsByName", options: { include: { pattern: "^(day|Value #t\\d+)$" } } },
      { id: "sortBy", options: { fields: {}, sort: [{ field: "day", desc: true }] } },
    ],
  });
  p.fieldConfig.overrides = [{ matcher: { id: "byName", options: "day" }, properties: [{ id: "displayName", value: "Tag" }, { id: "custom.cellOptions", value: { type: "color-text" } }, { id: "custom.width", value: 64 }] }, ...overrides];
}
gaugeTable("Tabelle — Recovery & Herz (je Tag)", [BYDAY[0], BYDAY[1], BYDAY[2], BYDAY[12], BYDAY[7], BYDAY[8], BYDAY[9], BYDAY[10], BYDAY[11]]);
gaugeTable("Tabelle — Schlaf (je Tag)", [BYDAY[3], BYDAY[4], BYDAY[5], BYDAY[6], BYDAY[15], BYDAY[14]]);

// ── assemble ──
function layout(panels) {
  let x = 0, y = 0, id = 0, rowH = 0;
  for (const p of panels) { const { w, h } = p.gridPos; if (x + w > 24) { x = 0; y += rowH; rowH = 0; } p.id = ++id; p.gridPos = { x, y, w, h }; x += w; rowH = Math.max(rowH, h); }
  return panels;
}
const dashboard = { uid: "aw-whoop-lab", title: "14 · WHOOP — Lab (50+ Visualisierungen)", tags: ["aw", "whoop", "lab"], timezone: "browser", schemaVersion: 39, version: 0, refresh: "1m", time: { from: "now-30d", to: "now" }, panels: layout(P) };
const res = await fetch(`${BASE}/api/dashboards/db`, { method: "POST", headers, body: JSON.stringify({ dashboard, overwrite: true, message: "whoop lab" }) });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`✗ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`); process.exit(1); }
console.log(`✅ ${dashboard.title} — ${P.length} panels  ${BASE}${body.url}`);
