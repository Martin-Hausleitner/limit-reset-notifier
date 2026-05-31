// cognitor-sync.mjs — pure builders for the Cognitor/ActivityWatch AI-limits sync payload.
// Kept side-effect-free so the parsing/summarising can be unit-tested; the AW HTTP I/O
// lives in src/sync-cognitor.mjs.

/** Parse ai_agent_tokens_per_minute{,_total} from a Prometheus exposition string. */
export function parseTokensPerMinute(promText) {
  const byTool = {};
  let total = null;
  for (const line of String(promText).split("\n")) {
    let m;
    if ((m = line.match(/^ai_agent_tokens_per_minute\{tool="([^"]+)"[^}]*\}\s+([\d.]+)/))) byTool[m[1]] = +m[2];
    else if ((m = line.match(/^ai_agent_tokens_per_minute_total\{[^}]*\}\s+([\d.]+)/))) total = +m[1];
  }
  return { total: total == null ? null : Math.round(total), byTool };
}

/** Summarise kpi.json into the soonest KNOWN reset + per-provider session state. */
export function summarizeResets(kpi) {
  const out = { providers: {}, next: null, generatedAt: kpi.generatedAt, host: kpi.host };
  for (const p of kpi.providers || []) {
    const session = (p.windows || []).find((w) => w.name === "session");
    out.providers[p.id] = {
      session_used_percent: session?.usedPercent ?? null,
      session_remaining_percent: session?.remainingPercent ?? null,
    };
    for (const w of p.windows || []) {
      if (w.resetsInSeconds == null || w.expired) continue; // only known, not-yet-elapsed windows
      if (!out.next || w.resetsInSeconds < out.next.in_seconds) {
        out.next = { provider: p.id, window: w.name, label: w.label, in_seconds: w.resetsInSeconds, at: w.resetsAt };
      }
    }
  }
  return out;
}

/** Build the flat, display-friendly event payload the Cognitor tray consumes. */
export function buildSyncPayload({ tpm, resets, now }) {
  return {
    tokens_per_minute: tpm.total ?? 0,
    tokens_per_minute_by_tool: tpm.byTool || {},
    next_reset_provider: resets.next?.provider ?? null,
    next_reset_window: resets.next?.window ?? null,
    next_reset_label: resets.next?.label ?? null,
    next_reset_in_seconds: resets.next?.in_seconds ?? null,
    next_reset_at: resets.next?.at ?? null,
    claude_session_used_percent: resets.providers.claude?.session_used_percent ?? null,
    codex_session_used_percent: resets.providers.codex?.session_used_percent ?? null,
    source_generated_at: resets.generatedAt ?? null,
    synced_at: now,
  };
}
