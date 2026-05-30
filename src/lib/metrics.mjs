// metrics.mjs — render a KPI snapshot as Prometheus text-exposition format.
// Consumed via node-exporter's textfile collector. Pure + testable.

const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function series(name, labels, value) {
  const lbl = Object.entries(labels)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(",");
  return `${name}{${lbl}} ${value}`;
}

const HELP = {
  airate_used_percent: "Percent of the limit window already consumed",
  airate_remaining_percent: "Percent of the limit window still available",
  airate_window_expired: "1 if the window has elapsed (already reset)",
  airate_window_unknown_reset: "1 if the reset time is currently unknown",
  airate_reset_timestamp_seconds: "Unix time at which the window resets",
  airate_reset_in_seconds: "Seconds until the window resets",
  airate_burn_percent_per_hour: "Recent consumption rate in percent per hour",
  airate_exhaustion_timestamp_seconds: "Projected unix time the window is exhausted at current pace",
  airate_exhausts_before_reset: "1 if projected to exhaust before its reset",
  airate_tokens_today: "Approximate tokens used today",
};

export function snapshotToProm(snap) {
  const now = Date.parse(snap.generatedAt) || Date.now();
  const groups = {}; // metricName -> [series lines]
  const add = (name, labels, value) => {
    if (value == null || Number.isNaN(value)) return;
    (groups[name] ||= []).push(series(name, labels, value));
  };

  for (const p of snap.providers || []) {
    for (const w of p.windows || []) {
      const L = { provider: p.id, window: w.name || w.label, kind: w.kind };
      add("airate_used_percent", L, w.usedPercent);
      add("airate_remaining_percent", L, w.remainingPercent);
      add("airate_window_expired", L, w.expired ? 1 : 0);
      add("airate_window_unknown_reset", L, w.unknownReset ? 1 : 0);
      if (w.resetsAt) {
        add("airate_reset_timestamp_seconds", L, Math.round(Date.parse(w.resetsAt) / 1000));
        add("airate_reset_in_seconds", L, w.resetsInSeconds);
      }
      if (typeof w.burnPerHour === "number") add("airate_burn_percent_per_hour", L, w.burnPerHour);
      if (w.exhaustionAt) {
        add("airate_exhaustion_timestamp_seconds", L, Math.round(Date.parse(w.exhaustionAt) / 1000));
        add("airate_exhausts_before_reset", L, w.exhaustsBeforeReset ? 1 : 0);
      }
    }
  }
  const c = snap.consumption?.today || {};
  add("airate_tokens_today", { provider: "codex" }, c.codexTokensApprox);
  add("airate_tokens_today", { provider: "claude" }, c.claudeTokensApprox);

  const out = [`# limit-reset-notifier — generated ${snap.generatedAt} on ${snap.host}`];
  out.push("# HELP airate_up Scrape liveness of the limit-reset-notifier exporter", "# TYPE airate_up gauge", "airate_up 1");
  if (snap.dataCapturedAt) {
    out.push(
      "# HELP airate_data_age_seconds Age of the underlying CodexBar data",
      "# TYPE airate_data_age_seconds gauge",
      `airate_data_age_seconds ${Math.round((now - Date.parse(snap.dataCapturedAt)) / 1000)}`
    );
  }
  for (const name of Object.keys(groups)) {
    out.push(`# HELP ${name} ${HELP[name] || name}`, `# TYPE ${name} gauge`, ...groups[name]);
  }
  return out.join("\n") + "\n";
}
