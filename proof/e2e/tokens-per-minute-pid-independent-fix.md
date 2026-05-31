# Proof — Tokens/min headline fixed to be PID-independent (was reading 0 during live burn)

Captured: 2026-05-31T12:35Z

## The bug

The central **Tokens/min** KPI for Claude was computed only from sessions that the
process scanner could map PID → Claude `--session-id`. When a running agent's session id
couldn't be tied back to its process (which is the normal case for the very session doing
the work), its burn was invisible and the headline read **0** even though hundreds of
thousands of tokens/min were actually being spent.

Codex already avoided this by summing trailing-15-min burn across recently-touched rollout
files (PID-independent). Claude did not — so Claude's headline was the fragile one.

## The fix

`src/collect-agents.mjs` — new `claudeRecentTokens()` mirrors `codexRecentTokens()`:
walk `~/.claude/projects/*/*.jsonl` touched in the last 20 min and sum each file's
trailing-15-min `message.usage` tokens directly. The Tokens/min headline now derives from
this aggregate, so it always reflects real throughput regardless of process discovery.

## Before → after (same machine, seconds apart)

| Stage | Before fix | After fix |
|---|---|---|
| collector `ai_agent_tokens_per_minute_total` | `0` | **577823.9** |
| exporter `:9111/metrics` | `0` | **577823.9** |
| Prometheus `:9490` query | `0` | **577823.9** |
| Cognitor sync → AW bucket | `tokens/min=0` | **tokens/min=577824** |
| tray `:5637` `aiLimits.tokensPerMinute` | `0.0` | **577824.0** |

Direct source check of one live session JSONL confirmed the source had data the whole time:
`583353` tokens in the trailing 15 min → `38890/min` for that single session; the aggregate
across all 8 running Claude agents is the ~577K total.

## Screenshot

`proof/e2e/lrn-exec.png` — Grafana **Executive Overview** after the fix:
- **🔥 Tokens/min (LIVE) = 620 K** (red headline stat).
- **🔥 Tokens/min — Auslastung (je Tool)** timeseries shows the burn jumping from 0 to
  ~600 K at 14:35 — the exact moment the collector began reporting real burn. The flat-zero
  segment before it is the bug; the step is the fix landing live.
- Max Limit-Auslastung 97 % (codex session), Kosten heute $189, Cache-Hit 100 %.

## Tests

`node --test` → **28 pass / 0 fail** after the change.
