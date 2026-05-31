# Grafana-Dashboards — Übersicht

Lokales Grafana: **http://127.0.0.1:3300** (Home = Dashboard 1). Start: `bash local-stack/start-native.sh`.
Stand: 2026-05-31 · 17 Dashboards · 249 Panels.

> **★ Zentrale KPI — Tokens/min (live):** `ai_agent_tokens_per_minute{tool}` / `…_total` — der
> 15-min-Token-Burn pro Session als **Rate** (Tokens UND Zeit kombiniert). Sie ist die
> aussagekräftigste Auslastungskennzahl für Claude/Codex und prominent auf **0 · Übersicht**,
> **1 · Executive Overview** und **16 · KI-Agenten** (Headline-Tile + Verlauf je Tool).

## 🤖 KI-Nutzung & Limits (CodexBar → Prometheus)

| # | Dashboard | Zeigt | Panels | UID |
|---|-----------|-------|:--:|-----|
| 1 | **Executive Overview** | Kosten heute/7T/30T, Limit-Auslastung, Cache-Hit, Tokens, Restkontingent | 10 | `lrn-exec` |
| 2 | **Rate-Limits & Resets** | Auslastung & Reset-Zeiten je Limit (Session/Weekly/Opus) | 10 | `lrn-limits` |
| 3 | **Limit-Exhaustion Forecasting** | Burn-Rate, prognostizierte Erschöpfung, „reicht bis Reset?" | 10 | `lrn-forecast` |
| 4 | **Kosten / FinOps** | Kosten je Modell/Tag/Fenster, $/Mtok | 10 | `lrn-cost` |
| 5 | **Token-Volumen je Typ** | Input/Output/Cache-Tokens je Fenster | 10 | `lrn-tokens` |
| 6 | **Model-Mix & Share** | Verteilung & Anteil je Modell | 10 | `lrn-modelmix` |
| 7 | **Cache-Effizienz** | Cache-Hit-Ratio, Cache-Read-Anteil | 10 | `lrn-cache` |
| 8 | **Parent vs Subagent** | Haupt- vs. Subagent-Kosten/Tokens/Share | 10 | `lrn-roles` |
| 9 | **Daily & Weekly Trends** | Tages-/Wochenverläufe Tokens/Kosten/Sessions | 10 | `lrn-trends` |
| 10 | **Throughput** | Tokens/Request, Requests/Tag, Sessions | 10 | `lrn-throughput` |

## 🫀 Gesundheit, Zeit & Fokus (ActivityWatch · Cognitor · WHOOP)

| # | Dashboard | Zeigt | Panels | UID |
|---|-----------|-------|:--:|-----|
| 11 | **WHOOP — Recovery & Schlaf** | Recovery-Zonen-Verlauf 30 T, Schlafphasen gestapelt, HRV/RHR/Performance, **Kombi-Charts** (Recovery & Belastung, HRV & RHR …) | 21 | `aw-whoop` |
| 12 | **Cognitor — Zeit & Fokus** | „⏱ Heute gearbeitet", Zeit je Gruppe/Quelle/Gerät, Top-Apps/Domains, Arbeitszeit-Verlauf | 12 | `aw-computer` |
| 13 | **Presence & Training** | Presence-Status, Zeit je Status, Workouts, Energie/Tag | 8 | `aw-presence` |
| 14 | **WHOOP — Lab (50+ Viz)** | 60 kreative dichte Visualisierungen: Histogramme, Scatter, Gauge-Tabellen, Donuts, Bargauge-Modi, Small-Multiples | 60 | `aw-whoop-lab` |

## ⚡ KI-Agenten live (mac + vcvm)

| # | Dashboard | Zeigt | Panels | UID |
|---|-----------|-------|:--:|-----|
| 16 | **KI-Agenten — Live & Verlauf** | **★ Tokens/min live + Peak**, **Tokens/min über Zeit (je Tool)**, Agents live/Peak, Agent-Stunden, Tokens/Kosten heute, **parallele Agents über Zeit** (je Tool/Maschine), Live-Session-Tabelle, Stunden-Heatmap, Multi-Wochen Tokens/Kosten | 23 | `ai-agents` |

---

### Pipeline
- **Metrics-Server:** `:9109` AI-Limits · `:9110` ActivityWatch/Cognitor/WHOOP · `:9111` KI-Agenten (lokal + vcvm `100.120.120.120:9111`)
- **Prometheus** `:9490` (Retention 90 T) scrapet alle · **Grafana** `:3300`
- **Selbstheilung:** launchd `com.mh.lrn-local-routine` (alle 30 min) prüft & repariert alles → `state/local-routine.json`
- **Build:** `grafana-build-all.mjs` (1–10) · `grafana-build-aw.mjs` (11–13) · `grafana-build-whoop-lab.mjs` (14) · `grafana-build-agents.mjs` (16)
