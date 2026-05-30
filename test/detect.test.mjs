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
  assert.ok(state.providers.codex.windows.Wochenlimit); // keyed by window label, not index
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

test("windows are matched by name, not array index (reorder-safe)", () => {
  const Ts = "2026-05-30T04:00:00Z"; // session reset, stays in the future
  const win = (name, used, resetsAt) => ({ name, label: name, resetsAt, usedPercent: used, remainingPercent: 100 - used });
  const prov = (windows) => ({ providers: [{ id: "codex", label: "Codex", windows }] });
  const { state: s1 } = detectResets(prov([win("session", 5, Ts), win("weekly", 95, T1)]), {}, { now: beforeT1 });
  // weekly genuinely resets (T1→T2, 95→2); windows are REORDERED in the next snapshot
  const { events } = detectResets(prov([win("weekly", 2, T2), win("session", 5, Ts)]), s1, { now: afterT1 });
  assert.equal(events.length, 1); // index-keying would misfire here; name-keying is correct
  assert.equal(events[0].windowLabel, "weekly");
});

test("window with unknown reset time (null) emits no event", () => {
  const w = (used) => ({
    providers: [{ id: "claude", label: "Claude", windows: [{ name: "session", label: "Session", resetsAt: null, usedPercent: used, remainingPercent: 100 - used }] }],
  });
  const { state: s1, events: e1 } = detectResets(w(21), {}, { now: afterT1 });
  assert.equal(e1.length, 0);
  assert.equal(s1.providers.claude.windows.session.resetsAt, null);
  const { events: e2 } = detectResets(w(25), s1, { now: afterT1 });
  assert.equal(e2.length, 0);
});
