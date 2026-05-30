#!/usr/bin/env node
// grafana-dashboard.mjs — create/update the "AI Usage Limits" Grafana dashboard via API.
// ENV: GRAFANA_URL (http://100.120.120.120:3000) GRAFANA_AUTH (admin:admin) GRAFANA_DS_UID (prometheus)
const BASE = (process.env.GRAFANA_URL || "http://100.120.120.120:3000").replace(/\/$/, "");
const AUTH = process.env.GRAFANA_AUTH || "admin:admin";
const DS = { type: "prometheus", uid: process.env.GRAFANA_DS_UID || "prometheus" };
const headers = { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(AUTH).toString("base64") };

const tgt = (expr, legend) => ({ expr, legendFormat: legend, refId: "A", datasource: DS, instant: false });
let pid = 0;
const panel = (type, title, gridPos, targets, fieldConfig = {}, options = {}) => ({
  id: ++pid,
  title,
  type,
  datasource: DS,
  gridPos,
  targets,
  options,
  fieldConfig: { defaults: { ...fieldConfig }, overrides: [] },
});

const pctThresholds = { mode: "absolute", steps: [
  { value: null, color: "red" }, { value: 20, color: "orange" }, { value: 50, color: "green" },
] };

const panels = [
  panel("gauge", "Restkontingent (% frei)", { h: 8, w: 12, x: 0, y: 0 },
    [tgt("airate_remaining_percent", "{{provider}} · {{window}}")],
    { unit: "percent", min: 0, max: 100, thresholds: pctThresholds },
    { reduceOptions: { calcs: ["lastNotNull"] }, showThresholdMarkers: true }),
  panel("stat", "Reset in", { h: 8, w: 12, x: 12, y: 0 },
    [tgt("airate_reset_in_seconds", "{{provider}} · {{window}}")],
    { unit: "s", color: { mode: "fixed", fixedColor: "blue" } },
    { reduceOptions: { calcs: ["lastNotNull"] }, colorMode: "value", graphMode: "none", textMode: "value_and_name" }),
  panel("timeseries", "Verbrauch % (Verlauf)", { h: 8, w: 12, x: 0, y: 8 },
    [tgt("airate_used_percent", "{{provider}} · {{window}}")],
    { unit: "percent", min: 0, max: 100, custom: { drawStyle: "line", fillOpacity: 10, showPoints: "never" } }),
  panel("timeseries", "Burn-Rate %/h (Verlauf)", { h: 8, w: 12, x: 12, y: 8 },
    [tgt("airate_burn_percent_per_hour", "{{provider}} · {{window}}")],
    { unit: "percent", custom: { drawStyle: "line", fillOpacity: 10, showPoints: "never" } }),
  panel("stat", "Burn-Rate jetzt (%/h)", { h: 6, w: 8, x: 0, y: 16 },
    [tgt("airate_burn_percent_per_hour > 0", "{{provider}} · {{window}}")],
    { unit: "percent", color: { mode: "fixed", fixedColor: "orange" } },
    { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "area", textMode: "value_and_name" }),
  panel("stat", "Tokens heute (ca.)", { h: 6, w: 8, x: 8, y: 16 },
    [tgt("airate_tokens_today", "{{provider}}")],
    { unit: "short", color: { mode: "fixed", fixedColor: "purple" } },
    { reduceOptions: { calcs: ["lastNotNull"] }, graphMode: "none", textMode: "value_and_name" }),
  panel("stat", "Daten-Frische", { h: 6, w: 8, x: 16, y: 16 },
    [tgt("airate_data_age_seconds", "CodexBar age")],
    { unit: "s", thresholds: { mode: "absolute", steps: [{ value: null, color: "green" }, { value: 900, color: "orange" }, { value: 1800, color: "red" }] } },
    { reduceOptions: { calcs: ["lastNotNull"] }, colorMode: "background", graphMode: "none" }),
];

const dashboard = {
  uid: "limit-reset-notifier",
  title: "AI Usage Limits — Claude & Codex",
  tags: ["limit-reset-notifier", "ai", "usage"],
  timezone: "browser",
  schemaVersion: 39,
  version: 0,
  refresh: "30s",
  time: { from: "now-12h", to: "now" },
  panels,
};

const res = await fetch(`${BASE}/api/dashboards/db`, {
  method: "POST",
  headers,
  body: JSON.stringify({ dashboard, overwrite: true, message: "limit-reset-notifier auto-provision" }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Grafana API ${res.status}:`, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}
console.log(`✅ Grafana dashboard saved: ${BASE}${body.url}  (uid=${body.uid}, version=${body.version})`);
