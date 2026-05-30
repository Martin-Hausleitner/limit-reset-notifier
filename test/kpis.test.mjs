// Tests for the derived-KPI exporter. Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKpiProm } from "../src/lib/kpis.mjs";

test("buildKpiProm yields 1000+ valid prometheus series (requires CodexBar data)", (t) => {
  const { text, count } = buildKpiProm();
  if (count === 0) return t.skip("no CodexBar cost data on this machine");
  assert.ok(count >= 1000, `expected >=1000 derived KPI series, got ${count}`);
  assert.doesNotMatch(text, /NaN/);
  assert.doesNotMatch(text, /\{\}/); // every series must carry labels
  assert.match(text, /# TYPE airate_cost_usd_window gauge/);
  assert.match(text, /# TYPE airate_tokens_by_day gauge/);
});

test("buildKpiProm output is well-formed exposition", (t) => {
  const { text, count } = buildKpiProm();
  if (count === 0) return t.skip("no CodexBar cost data on this machine");
  for (const ln of text.split("\n")) {
    if (!ln || ln.startsWith("#")) continue;
    // metric{labels} value
    assert.match(ln, /^airate_[a-z_]+\{[^}]*\} -?\d/);
  }
});
