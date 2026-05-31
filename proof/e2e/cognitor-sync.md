# Proof — KPI chain hops 1-2: data source → Grafana → Cognitor (ActivityWatch) sync

Captured: 2026-05-31T01:28:05Z

## Hop 1 — data source → Grafana (live Prometheus @ :9490)
```
ai_agent_tokens_per_minute_total -> 822381
min(airate_reset_in_seconds{provider="claude"}) -> 96023
min(airate_reset_in_seconds{provider="codex"}) -> 10410
```
Rendered on committed dashboards: proof/grafana/lrn-exec.png (Tokens/min headline + trend),
proof/grafana/lrn-limits.png (Rate-Limits & Resets — reset countdowns per provider/window).

## Hop 2 — Cognitor sync (ActivityWatch bucket = the macOS tray's data source)
Producer: src/sync-cognitor.mjs → AW bucket aw-watcher-ai-limits_<host>. Refreshed every 60s.

Latest event read back from ActivityWatch (:5600):
```json
[
    {
        "id": 57024255,
        "timestamp": "2026-05-31T01:28:03.955000+00:00",
        "duration": 0.0,
        "data": {
            "tokens_per_minute": 822381,
            "tokens_per_minute_by_tool": {
                "claude": 822381,
                "codex": 0
            },
            "next_reset_provider": "codex",
            "next_reset_window": "session",
            "next_reset_label": "Session-Limit (5h)",
            "next_reset_in_seconds": 10410,
            "next_reset_at": "2026-05-31T04:13:07Z",
            "claude_session_used_percent": 55,
            "codex_session_used_percent": 59,
            "source_generated_at": "2026-05-31T01:19:37.481Z",
            "synced_at": "2026-05-31T01:28:03.955Z"
        }
    }
]
```

## Tests (test/cognitor-sync.test.mjs)
```
✔ parseTokensPerMinute extracts total + per-tool (1.192416ms)
✔ parseTokensPerMinute returns null total when absent (triggers fallback) (0.072458ms)
✔ summarizeResets picks the soonest KNOWN, not-expired window (0.113167ms)
✔ buildSyncPayload yields the flat tray contract (0.069875ms)
✔ E2E: sync writes a readable AI-limits event into ActivityWatch (1586.442708ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```
