#!/usr/bin/env node
// detect.mjs — compare current snapshot to last-seen state, emit "reset" events.
// A reset = a window rolled into a new resetsAt AND usage is back near zero.
// Flags: --demo  force a (clearly-labelled) demo reset event for the binding window
//        --threshold=N  max usedPercent to still count as "fresh" (default 25)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KPI = path.join(ROOT, "dist", "kpi.json");
const EVENTS = path.join(ROOT, "dist", "events.json");
const STATE = path.join(ROOT, "state", "last.json");

const argv = process.argv.slice(2);
const DEMO = argv.includes("--demo");
const THRESHOLD = Number((argv.find((a) => a.startsWith("--threshold=")) || "").split("=")[1] || 25);

const snap = JSON.parse(fs.readFileSync(KPI, "utf8"));
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { providers: {} };
const now = Date.now();
const events = [];

for (const p of snap.providers) {
  const prevP = (state.providers[p.id] ||= { windows: {} });
  p.windows.forEach((w, idx) => {
    const prev = prevP.windows[idx];
    let isReset = false;
    if (prev) {
      const rolled = w.resetsAt !== prev.resetsAt; // new window started
      const fresh = w.usedPercent <= THRESHOLD; // back to (near) empty
      const oldExpired = Date.parse(prev.resetsAt) <= now; // previous window elapsed
      const dropped = w.usedPercent + 10 < prev.usedPercent; // usage fell sharply
      const notNotified = w.resetsAt !== prev.notifiedResetsAt;
      isReset = rolled && fresh && (oldExpired || dropped) && notNotified;
    }
    if (isReset) {
      events.push({
        provider: p.id,
        label: p.label,
        windowLabel: w.label,
        usedPercent: w.usedPercent,
        remainingPercent: w.remainingPercent,
        resetsAt: w.resetsAt,
        previousResetsAt: prev?.resetsAt || null,
        demo: false,
      });
    }
    // persist current observation (+ mark notified if we just fired)
    prevP.windows[idx] = {
      resetsAt: w.resetsAt,
      usedPercent: w.usedPercent,
      notifiedResetsAt: isReset ? w.resetsAt : prev?.notifiedResetsAt || null,
    };
  });
}

if (DEMO && events.length === 0) {
  // Synthesize a clearly-labelled demo event from the most-constrained provider,
  // so the full pipeline (detect → Matrix → dashboard) can be proven on demand.
  const p = [...snap.providers].sort(
    (a, b) => b.headline.usedPercent - a.headline.usedPercent
  )[0];
  if (p) {
    const w = p.windows.find((x) => x.resetsAt === p.headline.nextResetAt) || p.windows[0];
    events.push({
      provider: p.id,
      label: p.label,
      windowLabel: w.label,
      usedPercent: 0,
      remainingPercent: 100,
      resetsAt: w.resetsAt,
      previousResetsAt: null,
      demo: true,
    });
  }
}

fs.mkdirSync(path.dirname(EVENTS), { recursive: true });
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(EVENTS, JSON.stringify({ generatedAt: new Date(now).toISOString(), events }, null, 2));
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
