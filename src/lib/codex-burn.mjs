// codex-burn.mjs — extract trailing-window token burn from Codex rollout JSONL.
//
// Codex session logs (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) emit one
// `{type:"event_msg", payload:{type:"token_count", info:{last_token_usage:{total_tokens}}}}`
// per turn. Summing `last_token_usage.total_tokens` over events inside a trailing time
// window gives the tokens processed in that window — the basis for Codex tokens/min.
// Pure + side-effect-free so it can be unit-tested against fixtures and real logs.

/**
 * @param {string} text  raw JSONL (one rollout file's contents, or a tail of it)
 * @param {number} nowMs reference "now" in epoch ms
 * @param {number} [windowMs=900000] trailing window (default 15 min)
 * @returns {number} summed last_token_usage.total_tokens for events within the window
 */
export function sumCodexTokens(text, nowMs, windowMs = 900000) {
  let total = 0;
  for (const line of text.split("\n")) {
    if (!line.includes("token_count")) continue; // cheap pre-filter
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload;
    if (!p || p.type !== "token_count") continue;
    const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (!ts || nowMs - ts > windowMs) continue;
    const lt = p.info && p.info.last_token_usage;
    if (lt && typeof lt.total_tokens === "number") total += lt.total_tokens;
  }
  return total;
}
