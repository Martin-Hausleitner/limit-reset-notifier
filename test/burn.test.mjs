// Tests for the burn-rate / exhaustion projection. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBurn } from "../src/lib/burn.mjs";

const iso = (ms) => new Date(ms).toISOString();
const base = Date.parse("2026-05-30T00:00:00Z");

test("increasing usage → positive burn + correct exhaustion projection", () => {
  const samples = [
    { capturedAt: iso(base), usedPercent: 50 },
    { capturedAt: iso(base + 3600e3), usedPercent: 60 }, // +10 %/h
  ];
  const r = computeBurn(samples, { now: base + 3600e3, resetsAt: iso(base + 10 * 3600e3) });
  assert.equal(r.burnPerHour, 10);
  assert.equal(Date.parse(r.exhaustionAt), base + 5 * 3600e3); // 40% left / 10%/h = 4h from now(=base+1h)
  assert.equal(r.exhaustsBeforeReset, true); // 5h < 10h reset
});

test("slow burn that outlasts the reset → exhaustsBeforeReset false", () => {
  const samples = [
    { capturedAt: iso(base), usedPercent: 80 },
    { capturedAt: iso(base + 3600e3), usedPercent: 81 }, // +1 %/h
  ];
  const r = computeBurn(samples, { now: base + 3600e3, resetsAt: iso(base + 5 * 3600e3) });
  assert.equal(r.burnPerHour, 1);
  assert.equal(r.exhaustsBeforeReset, false); // 19h to exhaust > 5h reset
});

test("flat usage → ~0 burn, no projection", () => {
  const samples = [
    { capturedAt: iso(base), usedPercent: 30 },
    { capturedAt: iso(base + 3600e3), usedPercent: 30 },
  ];
  const r = computeBurn(samples, { now: base + 3600e3, resetsAt: iso(base + 5 * 3600e3) });
  assert.equal(r.burnPerHour, 0);
  assert.equal(r.exhaustionAt, null);
});

test("single sample → null (cannot estimate)", () => {
  const r = computeBurn([{ capturedAt: iso(base), usedPercent: 10 }], { now: base });
  assert.equal(r.burnPerHour, null);
  assert.equal(r.exhaustionAt, null);
});
