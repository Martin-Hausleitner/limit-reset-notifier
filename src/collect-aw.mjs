#!/usr/bin/env node
// collect-aw.mjs — pull ActivityWatch (localhost:5600) into Prometheus KPIs.
// Writes dist/activitywatch.prom. Health (WHOOP) + computer/web activity + iOS
// screen-time + presence + YouTube. Robust: a failing bucket is skipped, not fatal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AW = process.env.AW_URL || "http://localhost:5600";
const HOST = process.env.AW_HOST || "MHs-MacBook-Pro.local";
const OUT = process.env.AW_PROM_FILE || path.join(ROOT, "dist", "activitywatch.prom");

const now = new Date();
const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startISO = dayStart.toISOString();
const endISO = now.toISOString();

const L = [];
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 80);
function emit(name, help, type, samples) {
  if (!samples.length) return;
  L.push(`# HELP ${name} ${help}`);
  L.push(`# TYPE ${name} ${type}`);
  for (const { labels, value } of samples) {
    if (value == null || Number.isNaN(value)) continue;
    const lbl = labels && Object.keys(labels).length
      ? "{" + Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(",") + "}"
      : "";
    L.push(`${name}${lbl} ${value}`);
  }
}
const one = (name, help, value, labels = {}) => emit(name, help, "gauge", [{ labels, value }]);

async function events(bucket, { start = startISO, end = endISO, limit = 5000 } = {}) {
  const u = `${AW}/api/0/buckets/${encodeURIComponent(bucket)}/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=${limit}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${bucket}: HTTP ${r.status}`);
  return r.json();
}
async function latest(bucket) {
  const r = await fetch(`${AW}/api/0/buckets/${encodeURIComponent(bucket)}/events?limit=1`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${bucket}: HTTP ${r.status}`);
  const d = await r.json();
  return d[0] || null;
}
const safe = async (label, fn) => { try { await fn(); } catch (e) { console.error(`skip ${label}: ${e.message}`); } };
const hostname = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; } };
function topN(map, n, nameKey, name, help, scale = 1) {
  const items = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  emit(name, help, "gauge", items.map(([k, v]) => ({ labels: { [nameKey]: k }, value: Math.round(v * scale) })));
}
const dayKey = (iso) => iso.slice(5, 10); // MM-DD
const emitDays = (name, help, map) => emit(name, help, "gauge",
  [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, v]) => ({ labels: { day }, value: Math.round(v * 100) / 100 })));

// ---- Cognitor aggregate = source of truth -----------------------------------
// Cognitor merges every watcher into normalized groups (computer/browser/other)
// with friendly source labels. We classify by _cognitor_source_type so AFK
// status and foreground windows are never summed together (no double-counting).
await safe("cognitor", async () => {
  const groups = ["computer", "browser", "other"];
  const all = [];
  for (const grp of groups) {
    try { for (const e of await events(`aw-cognitor-aggregate-${grp}`)) all.push(e); } catch (err) { console.error(`  cognitor-${grp}: ${err.message}`); }
  }
  const cd = (e) => e.data || {};
  const stype = (e) => cd(e)._cognitor_source_type || "";
  const sname = (e) => cd(e)._cognitor_source_name || "?";
  const cgroup = (e) => cd(e)._cognitor_group || "?";

  // foreground time = events that represent something on screen (window/web/app),
  // NOT afkstatus (which would overlap) and NOT zero-duration status pings.
  const fg = all.filter((e) => ["currentwindow", "web.tab.current", "app"].includes(stype(e)) && (e.duration || 0) > 0);

  // active / afk from the afkstatus source only
  let active = 0, afk = 0;
  for (const e of all) if (stype(e) === "afkstatus") (cd(e).status === "not-afk" ? (active += e.duration) : (afk += e.duration));
  one("aw_active_seconds_today", "Active (not-afk) seconds today — Cognitor", Math.round(active));
  one("aw_afk_seconds_today", "AFK seconds today — Cognitor", Math.round(afk));
  if (active + afk > 0) one("aw_active_ratio_today", "Active share of tracked time today — Cognitor", +(active / (active + afk)).toFixed(4));

  // time per Cognitor source (device/watcher) and per group — the headline view
  const bySource = new Map(), byGroup = new Map();
  for (const e of fg) { bySource.set(sname(e), (bySource.get(sname(e)) || 0) + e.duration); byGroup.set(cgroup(e), (byGroup.get(cgroup(e)) || 0) + e.duration); }
  topN(bySource, 12, "source", "aw_time_by_source_seconds_today", "Foreground seconds per Cognitor source today");
  emit("aw_time_by_group_seconds_today", "Foreground seconds per Cognitor group today", "gauge",
    [...byGroup.entries()].map(([k, v]) => ({ labels: { group: k }, value: Math.round(v) })));

  // top Mac apps (computer-group windows)
  const apps = new Map();
  for (const e of fg) if (stype(e) === "currentwindow" && cgroup(e) === "computer") { const a = cd(e).app || cd(e).title; if (a) apps.set(a, (apps.get(a) || 0) + e.duration); }
  topN(apps, 15, "app", "aw_app_seconds_today", "Seconds per macOS app today — Cognitor (top 15)");

  // top web domains (browser-group tabs)
  const dom = new Map();
  for (const e of fg) if (stype(e) === "web.tab.current") { const h = hostname(cd(e).url); if (h) dom.set(h, (dom.get(h) || 0) + (e.duration || 0)); }
  topN(dom, 15, "domain", "aw_web_seconds_today", "Seconds per web domain today — Cognitor (top 15)");

  // iPhone screen-time (app-type events from the iPhone source)
  const ios = new Map(); let iosTotal = 0;
  for (const e of fg) if (stype(e) === "app") { const a = cd(e).title || cd(e).app; iosTotal += e.duration; if (a) ios.set(a, (ios.get(a) || 0) + e.duration); }
  one("aw_ios_screen_seconds_today", "iPhone screen-time seconds today — Cognitor", Math.round(iosTotal));
  topN(ios, 10, "app", "aw_ios_app_seconds_today", "iPhone screen-time seconds per app today — Cognitor (top 10)");
});

// ---- YouTube watch sessions -------------------------------------------------
await safe("youtube", async () => {
  const ev = await events(`aw-import-youtube-watch-sessions_${HOST}`);
  let secs = 0;
  for (const e of ev) secs += e.duration || 0;
  one("aw_youtube_sessions_today", "YouTube watch sessions today", ev.length);
  one("aw_youtube_seconds_today", "YouTube watch seconds today", Math.round(secs));
});

// ---- WHOOP recovery ---------------------------------------------------------
await safe("whoop-recovery", async () => {
  const e = await latest("aw-importer-whoop-recovery"); if (!e) return;
  const d = e.data, s = d.record?.score || {};
  one("aw_whoop_recovery_percent", "WHOOP recovery score (%)", d.recovery_score_percent ?? d.recovery_score ?? s.recovery_score);
  one("aw_whoop_hrv_ms", "WHOOP HRV RMSSD (ms)", d.heart_rate_variability_ms ?? d.hrv_rmssd_milli ?? s.hrv_rmssd_milli);
  one("aw_whoop_resting_hr_bpm", "WHOOP resting heart rate (bpm)", d.resting_heart_rate_bpm ?? d.resting_heart_rate ?? s.resting_heart_rate);
  one("aw_whoop_spo2_percent", "WHOOP blood oxygen (%)", d.blood_oxygen_percent ?? d.spo2_percentage ?? s.spo2_percentage);
  one("aw_whoop_skin_temp_celsius", "WHOOP skin temperature (°C)", d.skin_temp_celsius ?? s.skin_temp_celsius);
});

// ---- WHOOP sleep ------------------------------------------------------------
await safe("whoop-sleep", async () => {
  const e = await latest("aw-importer-whoop-sleep"); if (!e) return;
  const d = e.data, st = d.record?.score?.stage_summary || {};
  one("aw_whoop_sleep_hours", "WHOOP last sleep duration (hours)", +(d.duration_hours ?? (e.duration / 3600)).toFixed(2));
  const sc = d.record?.score || {};
  const perf = sc.sleep_performance_percentage ?? d.sleep_performance_percent;
  if (perf != null) one("aw_whoop_sleep_performance_percent", "WHOOP sleep performance (%)", perf);
  if (sc.sleep_efficiency_percentage != null) one("aw_whoop_sleep_efficiency_percent", "WHOOP sleep efficiency (%)", +sc.sleep_efficiency_percentage.toFixed(1));
  if (sc.sleep_consistency_percentage != null) one("aw_whoop_sleep_consistency_percent", "WHOOP sleep consistency (%)", sc.sleep_consistency_percentage);
  if (sc.respiratory_rate != null) one("aw_whoop_respiratory_rate", "WHOOP respiratory rate (breaths/min)", +sc.respiratory_rate.toFixed(1));
  if (st.sleep_cycle_count != null) one("aw_whoop_sleep_cycles", "WHOOP sleep cycles", st.sleep_cycle_count);
  const needMs = sc.sleep_needed?.baseline_milli;
  if (needMs != null) one("aw_whoop_sleep_need_hours", "WHOOP sleep need (hours)", +(needMs / 3.6e6).toFixed(2));
  const h = (ms) => +(ms / 3.6e6).toFixed(2);
  if (st.total_rem_sleep_time_milli != null) one("aw_whoop_sleep_rem_hours", "WHOOP REM sleep (hours)", h(st.total_rem_sleep_time_milli));
  if (st.total_slow_wave_sleep_time_milli != null) one("aw_whoop_sleep_deep_hours", "WHOOP deep (SWS) sleep (hours)", h(st.total_slow_wave_sleep_time_milli));
  if (st.total_light_sleep_time_milli != null) one("aw_whoop_sleep_light_hours", "WHOOP light sleep (hours)", h(st.total_light_sleep_time_milli));
  if (st.disturbance_count != null) one("aw_whoop_sleep_disturbances", "WHOOP sleep disturbances", st.disturbance_count);
});

// ---- WHOOP cycle (day strain / energy) --------------------------------------
await safe("whoop-cycle", async () => {
  const e = await latest("aw-importer-whoop-cycle"); if (!e) return;
  const d = e.data, s = d.record?.score || {};
  const kj = d.kilojoule ?? d.energy_kilojoule ?? s.kilojoule;
  if (kj != null) { one("aw_whoop_day_kilojoule", "WHOOP day energy expenditure (kJ)", Math.round(kj)); one("aw_whoop_day_kcal", "WHOOP day energy expenditure (kcal)", Math.round(kj / 4.184)); }
  one("aw_whoop_day_avg_hr_bpm", "WHOOP day average heart rate (bpm)", d.average_heart_rate_bpm ?? d.average_heart_rate ?? s.average_heart_rate);
  one("aw_whoop_day_max_hr_bpm", "WHOOP day max heart rate (bpm)", d.max_heart_rate_bpm ?? d.max_heart_rate ?? s.max_heart_rate);
  if (d.strain ?? s.strain != null) one("aw_whoop_day_strain", "WHOOP day strain", d.strain ?? s.strain);
});

// ---- WHOOP workouts today ---------------------------------------------------
await safe("whoop-workout", async () => {
  const ev = await events("aw-importer-whoop-workout");
  let min = 0, kj = 0;
  for (const e of ev) { min += (e.data?.duration_minutes ?? e.duration / 60) || 0; kj += (e.data?.kilojoule ?? e.data?.energy_kilojoule ?? e.data?.record?.score?.kilojoule) || 0; }
  one("aw_whoop_workout_count_today", "WHOOP workouts today", ev.length);
  one("aw_whoop_workout_minutes_today", "WHOOP workout minutes today", Math.round(min));
  if (kj) one("aw_whoop_workout_kcal_today", "WHOOP workout energy today (kcal)", Math.round(kj / 4.184));
});

// ---- Presence / focus (current) ---------------------------------------------
await safe("presence", async () => {
  const e = await latest(`aw-watcher-presence-status_${HOST}`); if (!e) return;
  const d = e.data;
  emit("aw_presence_status_info", "Current presence status (value=1)", "gauge", [{
    labels: { status: d.status || "?", label: d.label || "?", place: d.place_name || d.place || "?", availability: d.availability || "?", class: d.presence_class || "?" }, value: 1,
  }]);
  const map = { sleep: 1, away: 2, home: 3, gym: 4, work: 5 };
  one("aw_presence_status_code", "Presence status code (sleep1 away2 home3 gym4 work5)", map[d.status] ?? 0);
});

// ---- Worked time today (presence=work) — the "heute gearbeitet" headline -----
await safe("worked-today", async () => {
  const pres = await events(`aw-watcher-presence-status_${HOST}`, { limit: 5000 }); // default window = today
  const agg = {};
  for (const e of pres) { const s = e.data?.status; if (s) agg[s] = (agg[s] || 0) + (e.duration || 0); }
  emit("aw_presence_seconds_today", "Seconds per presence status today", "gauge",
    Object.entries(agg).map(([status, v]) => ({ labels: { status }, value: Math.round(v) })));
  one("aw_work_seconds_today", "Worked seconds today (Cognitor presence=work)", Math.round(agg.work || 0));
});

// ---- Daily history (last 30 days) — the per-day VERLAUF of the key values -----
await safe("history", async () => {
  const DAYS = 30;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1))).toISOString();
  // worked + active hours per day
  const work = new Map(), active = new Map();
  try { for (const e of await events(`aw-watcher-presence-status_${HOST}`, { start: since, limit: 60000 })) if (e.data?.status === "work") { const k = dayKey(e.timestamp); work.set(k, (work.get(k) || 0) + (e.duration || 0)); } } catch (err) { console.error(`  hist work: ${err.message}`); }
  try { for (const e of await events("aw-cognitor-aggregate-computer", { start: since, limit: 150000 })) if (e.data?._cognitor_source_type === "afkstatus" && e.data?.status === "not-afk") { const k = dayKey(e.timestamp); active.set(k, (active.get(k) || 0) + (e.duration || 0)); } } catch (err) { console.error(`  hist active: ${err.message}`); }
  emitDays("aw_work_hours_by_day", "Worked hours per day (presence=work)", new Map([...work].map(([k, v]) => [k, v / 3600])));
  emitDays("aw_active_hours_by_day", "Active hours per day", new Map([...active].map(([k, v]) => [k, v / 3600])));

  // WHOOP recovery/cycle per-day series (one event per day)
  const wb = async (bucket, pick) => {
    const m = new Map();
    try { for (const e of await events(bucket, { start: since, limit: 120 })) { const v = pick(e.data); if (v != null && !Number.isNaN(v)) m.set(dayKey(e.timestamp), v); } } catch (err) { console.error(`  hist ${bucket}: ${err.message}`); }
    return m;
  };
  emitDays("aw_whoop_recovery_by_day", "WHOOP recovery % per day", await wb("aw-importer-whoop-recovery", (d) => d.recovery_score_percent ?? d.recovery_score ?? d.record?.score?.recovery_score));
  emitDays("aw_whoop_hrv_by_day", "WHOOP HRV ms per day", await wb("aw-importer-whoop-recovery", (d) => d.heart_rate_variability_ms ?? d.hrv_rmssd_milli ?? d.record?.score?.hrv_rmssd_milli));
  emitDays("aw_whoop_rhr_by_day", "WHOOP resting HR bpm per day", await wb("aw-importer-whoop-recovery", (d) => d.resting_heart_rate_bpm ?? d.resting_heart_rate ?? d.record?.score?.resting_heart_rate));
  emitDays("aw_whoop_spo2_by_day", "WHOOP SpO2 % per day", await wb("aw-importer-whoop-recovery", (d) => d.blood_oxygen_percent ?? d.spo2_percentage ?? d.record?.score?.spo2_percentage));
  emitDays("aw_whoop_skin_temp_by_day", "WHOOP skin temp °C per day", await wb("aw-importer-whoop-recovery", (d) => d.skin_temp_celsius ?? d.record?.score?.skin_temp_celsius));
  emitDays("aw_whoop_kcal_by_day", "WHOOP energy kcal per day", await wb("aw-importer-whoop-cycle", (d) => { const kj = d.kilojoule ?? d.energy_kilojoule ?? d.record?.score?.kilojoule; return kj ? Math.round(kj / 4.184) : null; }));
  emitDays("aw_whoop_avg_hr_by_day", "WHOOP day average HR bpm per day", await wb("aw-importer-whoop-cycle", (d) => d.average_heart_rate_bpm ?? d.average_heart_rate ?? d.record?.score?.average_heart_rate));
  emitDays("aw_whoop_max_hr_by_day", "WHOOP day max HR bpm per day", await wb("aw-importer-whoop-cycle", (d) => d.max_heart_rate_bpm ?? d.max_heart_rate ?? d.record?.score?.max_heart_rate));
  // estimated cardiovascular load (WHOOP strain 0-21 is not imported → energy-based proxy)
  emitDays("aw_whoop_strain_est_by_day", "Estimated day strain 0-21 (from energy kcal)", await wb("aw-importer-whoop-cycle", (d) => { const kj = d.kilojoule ?? d.energy_kilojoule ?? d.record?.score?.kilojoule; if (!kj) return null; return +Math.min(21, (kj / 4.184) / 4000 * 21).toFixed(1); }));

  // WHOOP sleep per-day: hours, performance, stages, efficiency, consistency, respiratory, need, cycles, disturbances
  const sHours = new Map(), sPerf = new Map(), sDeep = new Map(), sRem = new Map(), sLight = new Map(), sAwake = new Map();
  const sEff = new Map(), sCons = new Map(), sResp = new Map(), sNeed = new Map(), sCycles = new Map(), sDist = new Map();
  try {
    for (const e of await events("aw-importer-whoop-sleep", { start: since, limit: 120 })) {
      const d = e.data, k = dayKey(e.timestamp), sc = d.record?.score || {}, st = sc.stage_summary || {}, h = (ms) => +(ms / 3.6e6).toFixed(2);
      if (d.duration_hours != null) sHours.set(k, +d.duration_hours.toFixed(2));
      const perf = sc.sleep_performance_percentage ?? d.sleep_performance_percent; if (perf != null) sPerf.set(k, perf);
      if (sc.sleep_efficiency_percentage != null) sEff.set(k, +sc.sleep_efficiency_percentage.toFixed(1));
      if (sc.sleep_consistency_percentage != null) sCons.set(k, sc.sleep_consistency_percentage);
      if (sc.respiratory_rate != null) sResp.set(k, +sc.respiratory_rate.toFixed(1));
      if (sc.sleep_needed?.baseline_milli != null) sNeed.set(k, +(sc.sleep_needed.baseline_milli / 3.6e6).toFixed(2));
      if (st.sleep_cycle_count != null) sCycles.set(k, st.sleep_cycle_count);
      if (st.disturbance_count != null) sDist.set(k, st.disturbance_count);
      if (st.total_slow_wave_sleep_time_milli != null) sDeep.set(k, h(st.total_slow_wave_sleep_time_milli));
      if (st.total_rem_sleep_time_milli != null) sRem.set(k, h(st.total_rem_sleep_time_milli));
      if (st.total_light_sleep_time_milli != null) sLight.set(k, h(st.total_light_sleep_time_milli));
      if (st.total_awake_time_milli != null) sAwake.set(k, h(st.total_awake_time_milli));
    }
  } catch (err) { console.error(`  hist sleep: ${err.message}`); }
  emitDays("aw_whoop_sleep_hours_by_day", "WHOOP sleep hours per day", sHours);
  emitDays("aw_whoop_sleep_perf_by_day", "WHOOP sleep performance % per day", sPerf);
  emitDays("aw_whoop_sleep_efficiency_by_day", "WHOOP sleep efficiency % per day", sEff);
  emitDays("aw_whoop_sleep_consistency_by_day", "WHOOP sleep consistency % per day", sCons);
  emitDays("aw_whoop_respiratory_by_day", "WHOOP respiratory rate per day", sResp);
  emitDays("aw_whoop_sleep_need_hours_by_day", "WHOOP sleep need hours per day", sNeed);
  emitDays("aw_whoop_sleep_cycles_by_day", "WHOOP sleep cycles per day", sCycles);
  emitDays("aw_whoop_disturbances_by_day", "WHOOP sleep disturbances per day", sDist);
  emitDays("aw_whoop_sleep_deep_by_day", "WHOOP deep sleep hours per day", sDeep);
  emitDays("aw_whoop_sleep_rem_by_day", "WHOOP REM sleep hours per day", sRem);
  emitDays("aw_whoop_sleep_light_by_day", "WHOOP light sleep hours per day", sLight);
  emitDays("aw_whoop_sleep_awake_by_day", "WHOOP awake hours per day", sAwake);
});

L.push(`# generated ${endISO}`);
one("aw_up", "ActivityWatch collector last run (1=ok)", 1);
one("aw_data_age_seconds", "Seconds since this AW snapshot was written", 0);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join("\n") + "\n");
const series = L.filter((l) => l && !l.startsWith("#")).length;
console.log(`aw → ${OUT} · ${series} series`);
