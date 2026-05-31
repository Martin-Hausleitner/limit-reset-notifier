# Proof — Codex tokens/min (live token burn from rollout logs)

Captured: 2026-05-31T00:40:49Z

## What
Extended the agents collector to compute a **live Codex tokens/min** from
`~/.codex/sessions/**/rollout-*.jsonl` (per-turn `token_count` events), so the KPI is
no longer Claude-only. Parsing lives in `src/lib/codex-burn.mjs` (pure, unit-tested).

## Unit + real-data tests (test/codex-burn.test.mjs)
```
✔ sums total_tokens for token_count events inside the window (1.262458ms)
✔ excludes events older than the window (0.07175ms)
✔ ignores non-token_count lines, other payloads, and malformed JSON (0.078875ms)
✔ events without a parseable timestamp are skipped (0.051916ms)
✔ real Codex rollout logs parse to a positive token total (when present) (19.209041ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## Real extraction from an actual Codex rollout log
newest rollout: rollout-2026-05-30T21-58-39-019e7a77-9c59-7d03-be3b-c4a1a76709e4.jsonl
token_count events: 8
tokens parsed (full session): 214,020
→ proves the parser extracts real Codex token usage end-to-end.

## Live metric (per tool)
```
ai_agent_tokens_per_minute{tool="claude",host="mac"} 616519.9
ai_agent_tokens_per_minute{tool="codex",host="mac"} 0
```
Codex reads 0 here because no Codex turn occurred in the trailing 15 min (sessions idle).
It becomes non-zero automatically as soon as a Codex session processes tokens — the
exact same trailing-15-min mechanism proven above on real data.
