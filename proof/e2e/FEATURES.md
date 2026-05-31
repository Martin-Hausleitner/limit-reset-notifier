# End-to-end proof — all features from this work session

Every feature below was built, run end-to-end against the live local stack
(Grafana `:3300` · Prometheus `:9490` · metrics `:9109/10/11`), and the evidence
committed here. Generated 2026-05-31.

| # | Feature (requested) | Status | Evidence in git |
|---|---|:--:|---|
| 1 | **Central KPI: Tokens/min** (tokens AND time combined as a rate) + prominent panel | ✅ | `proof/e2e/tokens-per-minute.md` (collector emit + live Prometheus query) · `proof/e2e/tokens-per-minute-pid-independent-fix.md` + `proof/e2e/lrn-exec.png` (**headline reads live 620 K/min; fixed PID-independent so it no longer reads 0 during active burn**) · `proof/e2e/tokens-per-minute-agents-headline.png` (live-agents headline tile + per-tool timeseries, privacy-cropped) · code: `src/collect-agents.mjs`, `scripts/grafana-build-{all,agents,index}.mjs` |
| 2 | **Screenshot every Grafana dashboard** + embed gallery in README | ✅ | `proof/e2e/capture-all-dashboards.txt` (all **17** dashboards captured, gallery count 17, every PNG non-blank) · `scripts/grafana-shots.mjs` |
| 3 | **Skill** that implements the whole screenshot→README workflow | ✅ | `.claude/skills/grafana-readme-shots/SKILL.md` |
| 4 | **End-to-end test** of the pipeline | ✅ | `proof/e2e/grafana-shots-e2e.txt` (1 pass) · `proof/e2e/unit-tests.txt` (17 pass) · `test/grafana-shots.e2e.mjs` |
| 5 | **Commit + push**, GitHub link, 10 shots readable in the README (mobile-friendly) | ✅ | `proof/e2e/github-live.txt` (10 KPI images HTTP 200 on `master`; health boards 404; PR #1 MERGED) · live: <https://github.com/Martin-Hausleitner/limit-reset-notifier#dashboard-gallery> |
| 6 | **Follow-up fix:** today-window tiles showed `No data` when empty | ✅ | `proof/e2e/no-data-fix.md` (`or vector(0)` idiom; live before/after queries) · re-captured `proof/grafana/lrn-exec.png` now shows Kosten/Tokens heute |
| 7 | **Codex tokens/min** (was Claude-only → 0 for Codex) | ✅ | `proof/e2e/codex-tokens-per-minute.md` (parser unit-tested + real rollout → 214 020 tokens) · `src/lib/codex-burn.mjs` + `test/codex-burn.test.mjs` (5 tests). Live reads 0 only while Codex is idle. |
| 8 | **Docs accuracy + full regression** | ✅ | `proof/e2e/full-suite.txt` (`node --test` → 23 pass / 0 fail) · DASHBOARDS.md count fix (17 dashboards / 249 panels) · README Tests section updated |
| 9 | **KPI chain: source → Grafana → Cognitor → macOS tray** | ✅ | `proof/e2e/cognitor-sync.md` (AW sync) + `proof/e2e/tray-display.md` (same value 148305 across all 3 hops) + `proof/e2e/tray-ai-limits-card.png` (🔥 AI-Limits tile, live) + `proof/e2e/tray-ai-limits.patch` (tray handoff). Native screencapture TCC-blocked (Martin grants Screen Recording/Accessibility) — documented. |

## Privacy decision (honoured)
The repo is **public** and `proof/grafana/` is git-ignored as "personal-data … keep local".
Per the user's choice, only the **10 `lrn-*` AI-KPI dashboards** (cost/limits/tokens — no
health data, no local paths) are published. The 7 personal-data boards (WHOOP health,
Cognitor time-tracking, live-agent session paths) were captured locally but **never committed**
— confirmed by the `404` checks in `github-live.txt`.

## Documented blocker (not actionable without the user)
The phrase **"Macht das David Kraus, also auch Sinkhandy-Repo"** in the last request could not
be parsed (dictation noise). No actionable feature could be derived from it. Everything else was
completed and pushed. Two plausible readings to confirm later:
- mirror the same gallery setup into another repo (name unknown), or
- "like <person/project> does it" as a styling reference.

This is the only open item; it needs a decision from the user and blocks nothing else.
