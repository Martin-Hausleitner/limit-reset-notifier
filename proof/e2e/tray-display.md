# Proof — KPI chain end-to-end: data source → Grafana → Cognitor sync → macOS tray

Captured: 2026-05-31T02:09:30Z

## Single live value traced through all three hops (proves one KPI flows through, current)

At sync timestamp `2026-05-31T02:08:11Z` the **same** tokens/min value appears at every hop:

| Hop | Source | tokens/min | reset |
|---|---|---|---|
| 1 · Grafana | Prometheus `:9490` → `ai_agent_tokens_per_minute_total` | **148304.6** | `airate_reset_in_seconds` |
| 2 · Cognitor sync | ActivityWatch bucket `:5600` `aw-watcher-ai-limits_<host>` | **148305** | codex/session in 7541s |
| 3 · macOS tray | Cognitor.app own API `:5637` `/api/dashboard-snapshot` → `aiLimits` | **148305** | codex in 7541s |

The tray value is read straight from the **running Cognitor.app's** API — i.e. the real value the
tray itself serves and renders. `syncedAt` was 2 s before the read → current.

## Screenshot from the tray UI

`proof/e2e/tray-ai-limits-card.png` (and `-context.png`) — the **🔥 AI-Limits** card as rendered by
the tray's own frontend bundle (apps/tray/dist) fed the live `:5637` snapshot:
**TOKENS/MIN 148K · NEXT RESET · CODEX in 2h 05m · CLAUDE SESSION 61% · CODEX SESSION 84%**,
sitting directly above the Sleep/Recovery/Strain widgets in the real dashboard.

## What was changed where

- **limit-reset-notifier (this repo):** `src/sync-cognitor.mjs` + `src/lib/cognitor-sync.mjs`
  push the KPIs into the AW bucket; wired into the self-healing routine (60 s loop). Tested in
  `test/cognitor-sync.test.mjs` (AW round-trip E2E). Merged (PR #6).
- **Cognitor tray (`~/Documents/Playground`, repo `cognitor-launcher`):** additive patch to
  surface the bucket as an `aiLimits` snapshot field + an `AiLimitsCard` tile. Full diff saved as
  `proof/e2e/tray-ai-limits.patch` (90 insertions across main.rs / types.ts / main.tsx). Built
  (`cargo build --release`, 27 s incremental) and the running tray now serves `aiLimits` (verified above).

## Documented blocker — literal native-popover screencapture

A pixel capture of the **native** menu-bar popover window needs two macOS TCC permissions that
only Martin can grant to the controlling terminal:
- **Screen Recording** — `screencapture` returns *"could not create image from display"* without it.
- **Accessibility** — System Events cannot click the status-bar item to open the popover (AppleEvent timeout).

Grant both in *System Settings → Privacy & Security → {Screen Recording, Accessibility}* for the
terminal, then: `osascript -e 'tell application "System Events" to tell process "cognitor-tray" to click menu bar item 1 of menu bar 2'` and `screencapture -x popover.png`.
The screenshot above is the tray's own frontend + live tray data, which is functionally identical
to the popover render; the value proof (`:5637`) confirms the native app is current regardless.

## Coordination

The tray change lives in the Cognitor-owned repo. The change is applied + built + running; the
patch (`tray-ai-limits.patch`) is the handoff for the Cognitor session to review/commit upstream.
