# Proof — Tokens/min KPI (end-to-end)

Captured: 2026-05-30T23:34:58Z

## 1) Collector emits the metric (dist/agents.prom)
```
# HELP ai_agent_tokens_per_minute Token burn rate per tool (tokens/min, trailing 15-min window)
# TYPE ai_agent_tokens_per_minute gauge
ai_agent_tokens_per_minute{tool="claude",host="mac"} 36764.8
ai_agent_tokens_per_minute{tool="codex",host="mac"} 0
# HELP ai_agent_tokens_per_minute_total Total token burn rate (tokens/min, trailing 15-min window)
# TYPE ai_agent_tokens_per_minute_total gauge
ai_agent_tokens_per_minute_total{host="mac"} 36764.8
```

## 2) Prometheus has scraped it (live query @ :9490)
```
$ ai_agent_tokens_per_minute_total
{'__name__': 'ai_agent_tokens_per_minute_total', 'host': 'mac', 'instance': 'localhost:9111', 'job': 'ai-agents'} = 36764.8

$ ai_agent_tokens_per_minute (by tool)
{'__name__': 'ai_agent_tokens_per_minute', 'host': 'mac', 'instance': 'localhost:9111', 'job': 'ai-agents', 'tool': 'claude'} = 36764.8
{'__name__': 'ai_agent_tokens_per_minute', 'host': 'mac', 'instance': 'localhost:9111', 'job': 'ai-agents', 'tool': 'codex'} = 0
```

## 3) Visible on the public Executive Overview dashboard
See committed screenshot: proof/grafana/lrn-exec.png (headline tile '🔥 Tokens/min (LIVE)' + timeseries '🔥 Tokens/min — Auslastung (je Tool)').
