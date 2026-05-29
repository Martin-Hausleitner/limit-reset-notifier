// Tests for the reset-detection core. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectResets, demoEvent } from "../src/lib/detect-core.mjs";

const T1 = "2026-05-30T00:00:00Z";
const T2 = "2026-05-30T05:00:00Z";
const beforeT1 = Date.parse(T1) - 3600e3;
const afterT1 = Date.parse("2026-05-30T01:00:00Z"); // T1 has elapsed
const beforeT2 = Date.parse("2026-05-30T02:00:00Z");

const snap = (used, resetsAt) => ({
  providers: [
    {
      id: "codex",
      label: "Codex (gpt-5.5)",
      windows: [{ label: "Wochenlimit", resetsAt, usedPercent: used, remainingPercent: 100 - used }],
      headline: { usedPercent: used, remainingPercent: 100 - used, nextResetAt: resetsAt },
    },
  ],
});

test("first observation only seeds state, emits no event", () => {
  const { events, state } = detectResets(snap(95, T1), {}, { now: beforeT1 });
  assert.equal(events.length, 0);
  assert.ok(state.providers.codex.windows[0]);
});

test("genuine reset fires exactly one REAL (non-demo) event", () => {
  const { state: s1 } = detectResets(snap(95, T1), {}, { now: beforeT1 });
  const { events } = detectResets(snap(2, T2), s1, { now: afterT1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].demo, false);
  assert.equal(events[0].provider, "codex");
  assert.equal(events[0].remainingPercent, 98);
  assert.equal(events[0].previousResetsAt, T1);
});

test("mid-window usage increase does NOT fire", () => {
  const { state: s1 } = detectResets(snap(10, T2), {}, { now: beforeT2 });
  const { events } = detectResets(snap(40, T2), s1, { now: beforeT2 });
  assert.equal(events.length, 0);
});

test("new window but still heavily used does NOT fire", () => {
  const { state: s1 } = detectResets(snap(50, T1), {}, { now: beforeT1 });
  const { events } = detectResets(snap(80, T2), s1, { now: afterT1 });
  assert.equal(events.length, 0);
});

test("does not re-notify the same reset (dedup)", () => {
  const { state: s1 } = detectResets(snap(95, T1), {}, { now: beforeT1 });
  const { state: s2, events: e2 } = detectResets(snap(2, T2), s1, { now: afterT1 });
  assert.equal(e2.length, 1);
  const { events: e3 } = detectResets(snap(3, T2), s2, { now: beforeT2 });
  assert.equal(e3.length, 0);
});

test("demoEvent targets the most-constrained provider", () => {
  const s = {
    providers: [
      { id: "claude", label: "Claude", windows: [{ label: "W", resetsAt: T2, usedPercent: 20, remainingPercent: 80 }], headline: { usedPercent: 20, remainingPercent: 80, nextResetAt: T2 } },
      { id: "codex", label: "Codex", windows: [{ label: "W", resetsAt: T2, usedPercent: 90, remainingPercent: 10 }], headline: { usedPercent: 90, remainingPercent: 10, nextResetAt: T2 } },
    ],
  };
  const e = demoEvent(s);
  assert.equal(e.provider, "codex");
  assert.equal(e.demo, true);
});
