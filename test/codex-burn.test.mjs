// codex-burn.test.mjs — unit tests for the Codex rollout token parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sumCodexTokens } from "../src/lib/codex-burn.mjs";

const NOW = 1_780_000_000_000; // fixed reference "now"
const at = (offsetMs, total) => JSON.stringify({
  timestamp: new Date(NOW - offsetMs).toISOString(),
  type: "event_msg",
  payload: { type: "token_count", info: { last_token_usage: { total_tokens: total } } },
});

test("sums total_tokens for token_count events inside the window", () => {
  const text = [at(60_000, 100), at(120_000, 250)].join("\n"); // 1 + 2 min ago
  assert.equal(sumCodexTokens(text, NOW, 900_000), 350);
});

test("excludes events older than the window", () => {
  const text = [at(60_000, 100), at(1_800_000, 999)].join("\n"); // 30 min ago excluded
  assert.equal(sumCodexTokens(text, NOW, 900_000), 100);
});

test("ignores non-token_count lines, other payloads, and malformed JSON", () => {
  const text = [
    at(60_000, 42),
    JSON.stringify({ timestamp: new Date(NOW).toISOString(), type: "event_msg", payload: { type: "agent_message" } }),
    JSON.stringify({ type: "response_item", payload: {} }),
    "{ this is not json",
    "",
  ].join("\n");
  assert.equal(sumCodexTokens(text, NOW, 900_000), 42);
});

test("events without a parseable timestamp are skipped", () => {
  const text = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 5 } } } });
  assert.equal(sumCodexTokens(text, NOW, 900_000), 0);
});

test("real Codex rollout logs parse to a positive token total (when present)", (t) => {
  const base = path.join(os.homedir(), ".codex", "sessions");
  let newest = null, newestM = 0;
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp, depth + 1);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        const m = fs.statSync(fp).mtimeMs; if (m > newestM) { newestM = m; newest = fp; }
      }
    }
  };
  walk(base, 0);
  if (!newest) return t.skip("no Codex rollout logs on this machine");
  const text = fs.readFileSync(newest, "utf8");
  // use the file's own newest event as "now" + a wide window so all its events count →
  // proves the parser extracts real token totals regardless of when the session ran
  let maxTs = 0;
  for (const line of text.split("\n")) {
    if (!line.includes("token_count")) continue;
    try { const ts = Date.parse(JSON.parse(line).timestamp); if (ts > maxTs) maxTs = ts; } catch { /* skip */ }
  }
  if (!maxTs) return t.skip("newest rollout has no token_count events");
  const total = sumCodexTokens(text, maxTs, 10 * 365 * 24 * 3600 * 1000);
  assert.ok(total > 0, `expected >0 tokens parsed from ${path.basename(newest)}, got ${total}`);
});
