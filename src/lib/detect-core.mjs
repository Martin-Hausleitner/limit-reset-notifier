// detect-core.mjs — pure reset-detection logic (no file I/O), so it is unit-testable.
//
// A window counts as "reset" when ALL hold vs. the previously seen state:
//   - rolled:      its resetsAt changed (a new limit window started)
//   - fresh:       usedPercent is back at/under `threshold` (quota available again)
//   - (oldExpired OR dropped): either the previous window's resetsAt has elapsed,
//                  or usage fell sharply (>10pp) — guards against spurious rolls
//   - notNotified: we haven't already notified for this exact resetsAt (dedup)
export function detectResets(snapshot, state, opts = {}) {
  const threshold = opts.threshold ?? 25;
  const now = opts.now ?? Date.now();
  const next = state && state.providers ? state : { providers: {} };
  const events = [];

  for (const p of snapshot.providers) {
    const prevP = (next.providers[p.id] ||= { windows: {} });
    p.windows.forEach((w, idx) => {
      const prev = prevP.windows[idx];
      let isReset = false;
      if (prev) {
        const rolled = w.resetsAt !== prev.resetsAt;
        const fresh = w.usedPercent <= threshold;
        const oldExpired = Date.parse(prev.resetsAt) <= now;
        const dropped = w.usedPercent + 10 < prev.usedPercent;
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
      prevP.windows[idx] = {
        resetsAt: w.resetsAt,
        usedPercent: w.usedPercent,
        notifiedResetsAt: isReset ? w.resetsAt : prev?.notifiedResetsAt || null,
      };
    });
  }
  return { events, state: next };
}

// Build a clearly-labelled demo event from the most-constrained provider/window.
export function demoEvent(snapshot) {
  const p = [...snapshot.providers].sort((a, b) => b.headline.usedPercent - a.headline.usedPercent)[0];
  if (!p) return null;
  const w = p.windows.find((x) => x.resetsAt === p.headline.nextResetAt) || p.windows[0];
  return {
    provider: p.id,
    label: p.label,
    windowLabel: w.label,
    usedPercent: 0,
    remainingPercent: 100,
    resetsAt: w.resetsAt,
    previousResetsAt: null,
    demo: true,
  };
}
