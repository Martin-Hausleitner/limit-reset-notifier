// cognitor-sync.test.mjs — unit tests for the Cognitor sync payload builders + an
// end-to-end round-trip through the live ActivityWatch instance (auto-skips if absent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTokensPerMinute, summarizeResets, buildSyncPayload } from "../src/lib/cognitor-sync.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AW = (process.env.AW_URL || "http://127.0.0.1:5600").replace(/\/$/, "");

test("parseTokensPerMinute extracts total + per-tool", () => {
  const prom = [
    'ai_agent_tokens_per_minute{tool="claude",host="mac"} 36764.8',
    'ai_agent_tokens_per_minute{tool="codex",host="mac"} 0',
    'ai_agent_tokens_per_minute_total{host="mac"} 36764.8',
  ].join("\n");
  const r = parseTokensPerMinute(prom);
  assert.equal(r.total, 36765); // rounded
  assert.deepEqual(r.byTool, { claude: 36764.8, codex: 0 });
});

test("parseTokensPerMinute returns null total when absent (triggers fallback)", () => {
  assert.equal(parseTokensPerMinute("# nothing here\n").total, null);
});

test("summarizeResets picks the soonest KNOWN, not-expired window", () => {
  const kpi = { generatedAt: "t", host: "h", providers: [
    { id: "claude", windows: [
      { name: "session", usedPercent: 55, remainingPercent: 45, resetsInSeconds: null, expired: false }, // unknown → ignored
      { name: "weekly", label: "wk", usedPercent: 52, resetsInSeconds: 96000, resetsAt: "x", expired: false },
    ] },
    { id: "codex", windows: [
      { name: "session", usedPercent: 1, remainingPercent: 99, label: "5h", resetsInSeconds: 4000, resetsAt: "y", expired: false },
      { name: "weekly", resetsInSeconds: 500, resetsAt: "z", expired: true }, // expired → ignored
    ] },
  ] };
  const r = summarizeResets(kpi);
  assert.equal(r.next.provider, "codex");
  assert.equal(r.next.window, "session");
  assert.equal(r.next.in_seconds, 4000);
  assert.equal(r.providers.claude.session_used_percent, 55);
  assert.equal(r.providers.codex.session_used_percent, 1);
});

test("buildSyncPayload yields the flat tray contract", () => {
  const p = buildSyncPayload({
    tpm: { total: 500, byTool: { claude: 500 } },
    resets: { next: { provider: "codex", window: "session", label: "5h", in_seconds: 4000, at: "y" }, providers: { claude: { session_used_percent: 55 }, codex: { session_used_percent: 1 } }, generatedAt: "t" },
    now: "now",
  });
  assert.equal(p.tokens_per_minute, 500);
  assert.equal(p.next_reset_provider, "codex");
  assert.equal(p.next_reset_in_seconds, 4000);
  assert.equal(p.claude_session_used_percent, 55);
  assert.equal(p.synced_at, "now");
});

test("E2E: sync writes a readable AI-limits event into ActivityWatch", async (t) => {
  let up = false;
  try { up = (await fetch(`${AW}/api/0/info`, { signal: AbortSignal.timeout(2500) })).ok; } catch { /* down */ }
  if (!up) return t.skip(`ActivityWatch not reachable at ${AW}`);

  execFileSync("node", [path.join(ROOT, "src", "sync-cognitor.mjs")], { stdio: "pipe", timeout: 30000, env: process.env });

  // discover the bucket + read back the latest event
  const buckets = await (await fetch(`${AW}/api/0/buckets/`)).json();
  const id = Object.keys(buckets).find((k) => k.includes("ai-limits"));
  assert.ok(id, "ai-limits bucket not created");
  const events = await (await fetch(`${AW}/api/0/buckets/${encodeURIComponent(id)}/events?limit=1`)).json();
  assert.ok(events.length >= 1, "no event written");
  const d = events[0].data;
  assert.equal(typeof d.tokens_per_minute, "number", "tokens_per_minute missing/!number");
  assert.ok("next_reset_in_seconds" in d, "next_reset_in_seconds missing");
  assert.ok("synced_at" in d, "synced_at missing");
  // freshness: synced within the last 2 minutes
  assert.ok(Date.now() - Date.parse(d.synced_at) < 120000, "event is stale");
});
