// sources.mjs — read AI usage / rate-limit data from local CodexBar caches.
// Zero dependencies (Node built-ins only). All paths are macOS CodexBar locations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const HIST = path.join(HOME, "Library/Application Support/com.steipete.codexbar/history");
const COST = path.join(HOME, "Library/Caches/CodexBar/cost-usage");

export const PATHS = {
  claudeHistory: path.join(HIST, "claude.json"),
  codexHistory: path.join(HIST, "codex.json"),
  codexCost: path.join(COST, "codex-v6.json"),
  claudeCost: path.join(COST, "claude-v2.json"),
  claudeConfig: path.join(HOME, ".claude.json"),
};

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function localDayKey(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const WINDOW_NAMES = {
  session: "Session-Limit (5h)",
  weekly: "Wochenlimit",
  opus: "Opus-Wochenlimit",
};

function windowLabel(name, windowMinutes) {
  if (WINDOW_NAMES[name]) return WINDOW_NAMES[name];
  const h = Math.round((windowMinutes || 0) / 60);
  if (h >= 168) return "Wochenlimit";
  if (h >= 24) return `${Math.round(h / 24)}-Tage-Limit`;
  return h ? `${h}h-Limit` : "Limit";
}

// Given an array of "buckets" (each bucket = one rate-limit window type with a
// time-series of {capturedAt,resetsAt,usedPercent}), return the latest *usable*
// entry per bucket (skipping trailing entries that lack a usedPercent reading).
function latestPerBucket(buckets) {
  if (!Array.isArray(buckets)) return [];
  const out = [];
  for (const bucket of buckets) {
    const entries = bucket?.entries;
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const latest = entries
      .filter((e) => e && e.capturedAt && e.resetsAt && typeof e.usedPercent === "number")
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
      .at(-1);
    if (latest)
      out.push({
        name: bucket.name || null,
        windowMinutes: bucket.windowMinutes || null,
        capturedAt: latest.capturedAt,
        resetsAt: latest.resetsAt,
        usedPercent: latest.usedPercent,
      });
  }
  return out;
}

function toWindow(entry, now) {
  const resetsMs = Date.parse(entry.resetsAt);
  const expired = resetsMs <= now; // window already elapsed; no fresh poll since
  const resetsInSeconds = Math.max(0, Math.round((resetsMs - now) / 1000));
  const label = windowLabel(entry.name, entry.windowMinutes);
  const kind = (entry.windowMinutes || 0) <= 300 ? "short" : "long";
  return {
    name: entry.name,
    windowMinutes: entry.windowMinutes,
    expired,
    kind,
    label,
    usedPercent: entry.usedPercent,
    remainingPercent: Math.max(0, 100 - entry.usedPercent),
    capturedAt: entry.capturedAt,
    resetsAt: entry.resetsAt,
    resetsInSeconds,
  };
}

function buildProvider(id, label, latestEntries, now) {
  const windows = latestEntries
    .map((e) => toWindow(e, now))
    .sort((a, b) => a.resetsInSeconds - b.resetsInSeconds);
  // The *binding* limit is the active (non-expired) window with the least headroom.
  const active = windows.filter((w) => !w.expired);
  const pool = active.length ? active : windows;
  const binding = pool.reduce(
    (acc, w) => (w.usedPercent > acc.usedPercent ? w : acc),
    pool[0] || { usedPercent: 0, remainingPercent: 100, resetsAt: null, resetsInSeconds: 0 }
  );
  const lastCapturedAt = windows.map((w) => w.capturedAt).filter(Boolean).sort().at(-1) || null;
  return {
    id,
    label,
    windows,
    lastCapturedAt,
    headline: {
      usedPercent: binding.usedPercent,
      remainingPercent: binding.remainingPercent,
      nextResetAt: binding.resetsAt,
      nextResetInSeconds: binding.resetsInSeconds,
    },
  };
}

// ---- Consumption (best-effort, clearly labelled "approx") -------------------
function codexTokensToday(now = new Date()) {
  const data = readJson(PATHS.codexCost);
  const day = data?.days?.[localDayKey(now)];
  if (!day) return 0;
  let tokens = 0;
  for (const model of Object.keys(day)) {
    const arr = day[model];
    if (Array.isArray(arr) && typeof arr[0] === "number") tokens += arr[0];
  }
  return tokens;
}

function claudeUsageToday(now = new Date()) {
  const data = readJson(PATHS.claudeCost);
  const today = localDayKey(now);
  let tokens = 0;
  let costNanos = 0;
  const files = data?.files || {};
  for (const f of Object.keys(files)) {
    const rows = files[f]?.claudeRows;
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (r?.dayKey !== today) continue;
      tokens += (r.input || 0) + (r.output || 0) + (r.cacheRead || 0) + (r.cacheCreate || 0);
      costNanos += r.costNanos || 0;
    }
  }
  return { tokens, costUsd: costNanos / 1e9 };
}

function claudeTier() {
  const cfg = readJson(PATHS.claudeConfig);
  return cfg?.organizationRateLimitTier || cfg?.userRateLimitTier || null;
}

export function getSnapshot(now = Date.now()) {
  const claudeHist = readJson(PATHS.claudeHistory);
  const codexHist = readJson(PATHS.codexHistory);

  const claudeLatest = latestPerBucket(claudeHist?.unscoped);
  const prefKey = codexHist?.preferredAccountKey;
  const codexBuckets = (prefKey && codexHist?.accounts?.[prefKey]) || [];
  const codexLatest = latestPerBucket(codexBuckets);

  const tier = claudeTier();
  const claudeLabel = tier ? `Claude Code (${tier.replace(/_/g, " ")})` : "Claude Code";

  const providers = [];
  if (claudeLatest.length) providers.push(buildProvider("claude", claudeLabel, claudeLatest, now));
  if (codexLatest.length) providers.push(buildProvider("codex", "Codex (gpt-5.5)", codexLatest, now));

  const claudeToday = claudeUsageToday(new Date(now));
  const dataCapturedAt = providers.map((p) => p.lastCapturedAt).filter(Boolean).sort().at(-1) || null;
  return {
    generatedAt: new Date(now).toISOString(),
    host: os.hostname(),
    tier,
    dataCapturedAt,
    providers,
    consumption: {
      today: {
        codexTokensApprox: codexTokensToday(new Date(now)),
        claudeTokensApprox: claudeToday.tokens,
        claudeCostUsdApprox: Number(claudeToday.costUsd.toFixed(2)),
      },
    },
  };
}
