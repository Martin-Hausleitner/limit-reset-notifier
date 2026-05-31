# Proof — fix: 'No data' on today-window headline tiles

Captured: 2026-05-31T00:36:13Z

## Problem
Executive Overview / Mission-Control / live-agents 'Kosten heute' + 'Tokens heute' tiles
rendered Grafana's **No data** whenever the `window="today"` series was momentarily
empty (stale CodexBar export, or early in the day before any usage).

## Fix
Wrap the today aggregations in `(… or vector(0))` so an empty window renders **0**, not
No data — in `grafana-build-all.mjs` (cwin/twin helpers), `grafana-build-index.mjs`,
`grafana-build-agents.mjs`.

## Verification (live @ :9490)
```
# the idiom: a deliberately-empty window now yields 0 instead of an empty result
$ sum(airate_cost_usd_window{window="zzz"})              -> EMPTY (=No data)
$ (sum(airate_cost_usd_window{window="zzz"}) or vector(0)) -> 0

# real today values now populate the tiles
$ Kosten heute  -> $62.76
$ Tokens heute -> 79788296
```

## Before / After
- Before: committed `proof/grafana/lrn-exec.png` showed 'Kosten heute = No data', 'Tokens heute = No data'.
- After: re-captured `proof/grafana/lrn-exec.png` shows 'Kosten heute $62.8', 'Tokens heute 79.8 Mil'.
