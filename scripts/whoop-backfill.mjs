#!/usr/bin/env node
// whoop-backfill.mjs — emit OpenMetrics with REAL timestamps so Prometheus has
// genuine time-series (→ Time Series, Heatmap, State Timeline panels work).
// Writes dist/whoop-trend.openmetrics ; backfill with:
//   promtool tsdb create-blocks-from openmetrics dist/whoop-trend.openmetrics /tmp/lrn-prom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AW = process.env.AW_URL || "http://localhost:5600";
const HOST = process.env.AW_HOST || "MHs-MacBook-Pro.local";
const OUT = path.join(ROOT, "dist", "whoop-trend.openmetrics");
const DAYS = Number(process.env.BACKFILL_DAYS || 60);
const now = Date.now();
const sinceISO = new Date(now - DAYS * 864e5).toISOString();

async function events(bucket, limit = 4000) {
  const u = `${AW}/api/0/buckets/${encodeURIComponent(bucket)}/events?start=${encodeURIComponent(sinceISO)}&end=${encodeURIComponent(new Date(now).toISOString())}&limit=${limit}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${bucket}: HTTP ${r.status}`);
  return r.json();
}
const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

// metric → array of {ts, v}
const series = new Map();
const add = (name, ts, v) => { if (v == null || Number.isNaN(v)) return; if (!series.has(name)) series.set(name, []); series.get(name).push({ ts, v: +v }); };

async function fromBucket(bucket, picks) {
  let ev = [];
  try { ev = await events(bucket, 200); } catch (e) { console.error(`skip ${bucket}: ${e.message}`); return; }
  for (const e of ev) { const ts = epoch(e.timestamp); for (const [name, pick] of Object.entries(picks)) add(name, ts, pick(e.data)); }
}

// WHOOP daily series (1 event/day → real daily time-series)
await fromBucket("aw-importer-whoop-recovery", {
  aw_whoop_recovery_ts: (d) => d.recovery_score_percent ?? d.recovery_score,
  aw_whoop_hrv_ts: (d) => d.heart_rate_variability_ms ?? d.hrv_rmssd_milli,
  aw_whoop_rhr_ts: (d) => d.resting_heart_rate_bpm ?? d.resting_heart_rate,
  aw_whoop_spo2_ts: (d) => d.blood_oxygen_percent ?? d.spo2_percentage,
  aw_whoop_skin_temp_ts: (d) => d.skin_temp_celsius,
});
await fromBucket("aw-importer-whoop-sleep", {
  aw_whoop_sleep_hours_ts: (d) => d.duration_hours,
  aw_whoop_sleep_perf_ts: (d) => d.record?.score?.sleep_performance_percentage,
  aw_whoop_sleep_eff_ts: (d) => d.record?.score?.sleep_efficiency_percentage,
  aw_whoop_sleep_cons_ts: (d) => d.record?.score?.sleep_consistency_percentage,
  aw_whoop_respiratory_ts: (d) => d.record?.score?.respiratory_rate,
  aw_whoop_sleep_deep_ts: (d) => (d.record?.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) / 3.6e6,
  aw_whoop_sleep_rem_ts: (d) => (d.record?.score?.stage_summary?.total_rem_sleep_time_milli ?? 0) / 3.6e6,
  aw_whoop_sleep_light_ts: (d) => (d.record?.score?.stage_summary?.total_light_sleep_time_milli ?? 0) / 3.6e6,
});
await fromBucket("aw-importer-whoop-cycle", {
  aw_whoop_kcal_ts: (d) => { const kj = d.kilojoule ?? d.energy_kilojoule; return kj ? Math.round(kj / 4.184) : null; },
  aw_whoop_avg_hr_ts: (d) => d.average_heart_rate_bpm ?? d.average_heart_rate,
  aw_whoop_max_hr_ts: (d) => d.max_heart_rate_bpm ?? d.max_heart_rate,
  aw_whoop_strain_est_ts: (d) => { const kj = d.kilojoule ?? d.energy_kilojoule; return kj ? +Math.min(21, (kj / 4.184) / 4000 * 21).toFixed(1) : null; },
});

// ActivityWatch hourly active + work seconds (for the hourly heatmap)
const hourBucket = (ts) => Math.floor(ts / 3600) * 3600;
async function hourly(bucket, name, filter) {
  let ev = [];
  try { ev = await events(bucket, 200000); } catch (e) { console.error(`skip ${bucket}: ${e.message}`); return; }
  const m = new Map();
  for (const e of ev) { if (!filter(e.data)) continue; const h = hourBucket(epoch(e.timestamp)); m.set(h, (m.get(h) || 0) + (e.duration || 0)); }
  for (const [h, v] of m) add(name, h, Math.round(v));
}
await hourly("aw-cognitor-aggregate-computer", "aw_active_seconds_ts", (d) => d._cognitor_source_type === "afkstatus" && d.status === "not-afk");
await hourly(`aw-watcher-presence-status_${HOST}`, "aw_work_seconds_ts", (d) => d.status === "work");

// write OpenMetrics
const lines = [];
for (const [name, pts] of series) {
  pts.sort((a, b) => a.ts - b.ts);
  lines.push(`# TYPE ${name} gauge`);
  for (const { ts, v } of pts) lines.push(`${name} ${v} ${ts}`);
}
lines.push("# EOF");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`backfill → ${OUT} · ${series.size} metrics · ${[...series.values()].reduce((a, p) => a + p.length, 0)} samples`);
