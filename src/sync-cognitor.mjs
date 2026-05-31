#!/usr/bin/env node
// sync-cognitor.mjs — push the limit-reset-notifier KPIs (Tokens/min + Limit-Resets) into
// ActivityWatch, which is Cognitor's data layer + the source the Cognitor macOS tray reads.
//
// Reads:  dist/agents.prom  (ai_agent_tokens_per_minute*)  ·  dist/kpi.json  (reset windows)
// Writes: one current-state event into AW bucket  aw-watcher-ai-limits_<host>
//
// ENV: AW_URL (http://127.0.0.1:5600) · AGENTS_PROM (dist/agents.prom) · KPI_JSON (dist/kpi.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTokensPerMinute, summarizeResets, buildSyncPayload } from "./lib/cognitor-sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AW = (process.env.AW_URL || "http://127.0.0.1:5600").replace(/\/$/, "");
const PROM = path.resolve(ROOT, process.env.AGENTS_PROM || "dist/agents.prom");
const KPI = path.resolve(ROOT, process.env.KPI_JSON || "dist/kpi.json");

// ── tokens/min from the agents exporter (fall back to Prometheus if the file is absent) ──
async function tokensPerMinute() {
  let tpm = { total: null, byTool: {} };
  try { tpm = parseTokensPerMinute(fs.readFileSync(PROM, "utf8")); } catch { /* file missing → fall back */ }
  if (tpm.total == null) {
    try {
      const r = await fetch(`${AW.replace(":5600", ":9490")}/api/v1/query?query=ai_agent_tokens_per_minute_total`);
      const j = await r.json();
      tpm.total = j?.data?.result?.[0] ? Math.round(+j.data.result[0].value[1]) : 0;
    } catch { tpm.total = 0; }
  }
  return tpm;
}

// ── ActivityWatch: ensure bucket, then post the current-state event ──
async function awEnsureBucket(id, hostname) {
  const res = await fetch(`${AW}/api/0/buckets/${encodeURIComponent(id)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: "limit-reset-notifier", type: "ai.limits", hostname }),
  });
  if (!res.ok && res.status !== 304) {
    const t = await res.text().catch(() => "");
    if (!/already exists/i.test(t)) throw new Error(`bucket create ${res.status}: ${t.slice(0, 120)}`);
  }
}
async function awPostEvent(id, data, ts) {
  const res = await fetch(`${AW}/api/0/buckets/${encodeURIComponent(id)}/events`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ timestamp: ts, duration: 0, data }]),
  });
  if (!res.ok) throw new Error(`event post ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
  return res.json();
}

const tpm = await tokensPerMinute();
const resets = summarizeResets(JSON.parse(fs.readFileSync(KPI, "utf8")));
const host = resets.host || "localhost";
const bucket = `aw-watcher-ai-limits_${host}`;
const now = new Date().toISOString();

// the data contract the Cognitor tray reads (flat + display-friendly)
const data = buildSyncPayload({ tpm, resets, now });

await awEnsureBucket(bucket, host);
await awPostEvent(bucket, data, now);

const resetTxt = resets.next ? `${resets.next.provider}/${resets.next.window} in ${Math.round(resets.next.in_seconds / 60)}min` : "none";
console.log(`✅ synced → AW bucket ${bucket}  ·  tokens/min=${tpm.total}  ·  next reset=${resetTxt}`);
