// Tests for the Prometheus exposition rendering. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotToProm } from "../src/lib/metrics.mjs";

const snap = {
  generatedAt: "2026-05-30T00:00:00Z",
  host: "h",
  dataCapturedAt: "2026-05-30T00:00:00Z",
  providers: [
    {
      id: "claude",
      label: "Claude",
      windows: [
        { name: "weekly", label: "Wochenlimit", kind: "long", usedPercent: 30, remainingPercent: 70, expired: false, unknownReset: false, resetsAt: "2026-05-31T00:00:00Z", resetsInSeconds: 86400, burnPerHour: 2, exhaustionAt: "2026-06-05T00:00:00Z", exhaustsBeforeReset: false },
        { name: "session", label: "Session", kind: "short", usedPercent: 40, remainingPercent: 60, expired: false, unknownReset: true, resetsAt: null, resetsInSeconds: null, burnPerHour: 3, exhaustionAt: null, exhaustsBeforeReset: false },
      ],
    },
  ],
  consumption: { today: { codexTokensApprox: 100, claudeTokensApprox: 200, claudeCostUsdApprox: 1.5 } },
};

test("emits valid prometheus exposition with provider/window labels", () => {
  const t = snapshotToProm(snap);
  assert.match(t, /^airate_up 1$/m);
  assert.match(t, /airate_remaining_percent\{provider="claude",window="weekly",kind="long"\} 70/);
  assert.match(t, /airate_window_unknown_reset\{provider="claude",window="session",kind="short"\} 1/);
  assert.match(t, /airate_reset_timestamp_seconds\{provider="claude",window="weekly",kind="long"\} \d+/);
  assert.match(t, /airate_tokens_today\{provider="claude"\} 200/);
});

test("unknown-reset window omits reset/exhaustion series; never NaN", () => {
  const t = snapshotToProm(snap);
  assert.doesNotMatch(t, /airate_reset_timestamp_seconds\{provider="claude",window="session"/);
  assert.doesNotMatch(t, /airate_exhaustion_timestamp_seconds\{provider="claude",window="session"/);
  assert.doesNotMatch(t, /NaN/);
});

test("every emitted metric has HELP and TYPE", () => {
  const t = snapshotToProm(snap);
  assert.match(t, /# TYPE airate_remaining_percent gauge/);
  assert.match(t, /# HELP airate_burn_percent_per_hour /);
});
