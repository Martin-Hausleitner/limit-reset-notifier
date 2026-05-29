#!/usr/bin/env node
// detect.mjs — compare current snapshot to last-seen state, emit "reset" events.
// Flags: --demo  force a (clearly-labelled) demo reset event
//        --threshold=N  max usedPercent to still count as "fresh" (default 25)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectResets, demoEvent } from "./lib/detect-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KPI = path.join(ROOT, "dist", "kpi.json");
const EVENTS = path.join(ROOT, "dist", "events.json");
const STATE = path.join(ROOT, "state", "last.json");

const argv = process.argv.slice(2);
const DEMO = argv.includes("--demo");
const THRESHOLD = Number((argv.find((a) => a.startsWith("--threshold=")) || "").split("=")[1] || 25);

const snap = JSON.parse(fs.readFileSync(KPI, "utf8"));
const prevState = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { providers: {} };

const { events, state } = detectResets(snap, prevState, { threshold: THRESHOLD });
if (DEMO && events.length === 0) {
  const e = demoEvent(snap);
  if (e) events.push(e);
}

fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(EVENTS, JSON.stringify({ generatedAt: new Date().toISOString(), events }, null, 2));
fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

if (events.length === 0) {
  console.log("Kein Reset erkannt — keine Benachrichtigung nötig.");
} else {
  for (const e of events) {
    console.log(
      `RESET${e.demo ? " (DEMO)" : ""}: ${e.label} — ${e.windowLabel} ` +
        `→ ${e.remainingPercent}% frei, nächster Reset ${e.resetsAt}`
    );
  }
}
process.exit(0);
