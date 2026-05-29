#!/usr/bin/env node
// collect.mjs — snapshot current AI limit/usage KPIs into dist/kpi.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSnapshot } from "./lib/sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "kpi.json");

const snap = getSnapshot();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snap, null, 2));

// human summary
console.log(`# KPI snapshot @ ${snap.generatedAt}  (host: ${snap.host})`);
for (const p of snap.providers) {
  console.log(`\n${p.label}`);
  for (const w of p.windows) {
    const h = Math.floor(w.resetsInSeconds / 3600);
    const m = Math.round((w.resetsInSeconds % 3600) / 60);
    const when = w.expired ? "bereits frei (zurückgesetzt)" : `reset in ${h}h ${m}m  (${w.resetsAt})`;
    console.log(
      `  ${w.label.padEnd(20)} used ${String(w.usedPercent).padStart(3)}%  ` +
        `frei ${String(w.remainingPercent).padStart(3)}%  ${when}`
    );
  }
}
console.log(
  `\nVerbrauch heute (ca.): Codex ${snap.consumption.today.codexTokensApprox.toLocaleString()} tok, ` +
    `Claude ${snap.consumption.today.claudeTokensApprox.toLocaleString()} tok / $${snap.consumption.today.claudeCostUsdApprox}`
);
console.log(`\n→ geschrieben: ${OUT}`);
