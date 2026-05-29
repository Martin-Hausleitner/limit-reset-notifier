// burn.mjs — estimate consumption velocity ("burn rate") for a limit window and
// project when it would be exhausted, from the CodexBar usedPercent time-series.
// Pure + dependency-free → unit-testable.
//
// samples: [{ capturedAt: ISO, usedPercent: number }]  (entries of the CURRENT window)
export function computeBurn(samples, opts = {}) {
  const now = opts.now ?? Date.now();
  const resetsAt = opts.resetsAt ?? null;
  const empty = { burnPerHour: null, exhaustionAt: null, exhaustsBeforeReset: false };

  const pts = (samples || [])
    .filter((s) => s && s.capturedAt && typeof s.usedPercent === "number")
    .map((s) => ({ t: Date.parse(s.capturedAt), u: s.usedPercent }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return empty;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const hours = (last.t - first.t) / 3.6e6;
  if (hours <= 0) return empty;

  const burnPerHour = (last.u - first.u) / hours; // %/h, may be ~0 or negative
  const rounded = Math.round(burnPerHour * 10) / 10;
  if (burnPerHour <= 0.05) {
    // flat or decreasing usage → no meaningful exhaustion projection
    return { burnPerHour: Math.max(0, rounded), exhaustionAt: null, exhaustsBeforeReset: false };
  }
  const remaining = Math.max(0, 100 - last.u);
  const secsToLimit = (remaining / burnPerHour) * 3600;
  const exhaustionAt = new Date(now + secsToLimit * 1000).toISOString();
  const exhaustsBeforeReset = resetsAt ? Date.parse(exhaustionAt) < Date.parse(resetsAt) : false;
  return { burnPerHour: rounded, exhaustionAt, exhaustsBeforeReset };
}
