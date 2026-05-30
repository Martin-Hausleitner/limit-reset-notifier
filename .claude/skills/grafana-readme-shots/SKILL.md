---
name: grafana-readme-shots
description: >-
  Screenshot every Grafana dashboard in this repo's local stack and embed them as a gallery in
  the README. Use when the user asks to "screenshot the dashboards", "put the dashboards in the
  README", "update the dashboard gallery", "Dashboards in die Readme", "Screenshots von den
  Grafana-Dashboards", or to refresh the dashboard images after rebuilding. Handles starting the
  local stack, optional rebuild, robust capture, README injection, and an end-to-end test.
---

# Grafana → README dashboard gallery

Capture all Grafana dashboards and inject a markdown gallery into `README.md` between
auto-managed markers. One script does discovery + capture + injection:
`scripts/grafana-shots.mjs`.

## When to use
- "Screenshot all the dashboards and put them in the README"
- "Update / refresh the dashboard gallery"
- After `grafana-build-*.mjs` changed panels and the README images are stale

## How it works (why these choices)
- **Discovery:** reads `GET /api/search?type=dash-db` so new dashboards are picked up
  automatically — no hardcoded UID list. Sorted by the numeric title prefix (`0 · …` → `16 · …`).
- **True height:** fetches each dashboard's panel grid and sizes the viewport to
  `maxRow × 30px` so tall dashboards (e.g. WHOOP-Lab, 60 panels) are captured whole.
- **No blanking:** uses a **viewport-only** capture (`fullPage: false`). `fullPage` races
  Grafana's scene relayout and silently blanks panels. Credentials go through Playwright
  `httpCredentials`, **never inline in the URL** (that breaks Grafana's own `fetch`).
- **Injection:** rewrites only the text between
  `<!-- DASHBOARD-SHOTS:START … -->` and `<!-- DASHBOARD-SHOTS:END -->` in `README.md`.

## Steps
1. **Ensure the local stack is up** (Grafana `:3300`, Prometheus `:9490`, metrics `:9109/10/11`):
   ```bash
   curl -fsS http://127.0.0.1:3300/api/health >/dev/null || bash local-stack/start-native.sh
   ```
2. **(Optional) rebuild dashboards first** if panels/scripts changed — set `REBUILD=1`.
3. **Capture + inject:**
   ```bash
   PW_PATH="$(npm root -g)/playwright" node scripts/grafana-shots.mjs
   ```
   Writes `proof/grafana/<uid>.png` for every dashboard and updates the README gallery.
   It flags any PNG ≤ 20 KB as `⚠️ looks blank`.
4. **Verify:** open `README.md` (gallery between the markers) and `git diff --stat`.

## Public vs. local screenshots (privacy)
`proof/grafana/` is **git-ignored** ("personal-data … keep local") and the repo is **public** —
BUT the 10 AI-KPI PNGs (`proof/grafana/lrn-*.png`) were committed before the ignore rule, so
git still tracks them: those are the only screenshots that render on GitHub. They carry $ spend +
token counts but no health data or local paths. Refresh exactly those (won't touch the ignored
health/agent boards):
```bash
ONLY=lrn-exec,lrn-limits,lrn-forecast,lrn-cost,lrn-tokens,lrn-modelmix,lrn-cache,lrn-roles,lrn-trends,lrn-throughput \
  node scripts/grafana-shots.mjs
```
A default run (all dashboards) re-captures WHOOP/Cognitor/live-agent boards into the **ignored**
`proof/grafana/` for local viewing only. Never `git add -f` those — confirm scope with the user
before publishing anything beyond the 10 `lrn-*`.

## Environment knobs
| ENV | Default | Purpose |
|---|---|---|
| `GRAFANA_URL` | `http://127.0.0.1:3300` | Grafana base URL |
| `GRAFANA_AUTH` | `admin:admin` | `user:pass` for the API + capture |
| `PW_PATH` | `playwright` | path to the Playwright module (use global: `$(npm root -g)/playwright`) |
| `README` | `README.md` | target markdown file |
| `SHOT_DIR` | `proof/grafana` | output dir for PNGs |
| `RANGE` | `now-3h` | dashboard time range |
| `REBUILD` | `0` | `1` = re-provision all dashboards before capturing |
| `ONLY` | _(all)_ | comma-separated UID filter (e.g. `lrn-exec,ai-agents`) |
| `SETTLE_MS` | `9000` | ms to wait for panels to render |

## End-to-end test
`test/grafana-shots.e2e.mjs` drives the real pipeline for a 2-dashboard subset into a **temp
README** (real files untouched) and asserts the PNGs are valid + non-blank and the gallery
markers got populated. It **skips** (doesn't fail) when Grafana/Playwright are absent.

```bash
PW_PATH="$(npm root -g)/playwright" node --test test/grafana-shots.e2e.mjs
```

## Gotchas
- Run it where the screenshots will be served from the same relative path as `README` →
  `SHOT_DIR`. The script computes the relative link automatically.
- If a dashboard shows `⚠️ looks blank`, bump `SETTLE_MS` (slow panels) or confirm its
  datasource has data for `RANGE`.
- Never pass `http://user:pass@host/...` URLs — Grafana's client-side `fetch` rejects
  credentialled URLs and the page fails to load.
