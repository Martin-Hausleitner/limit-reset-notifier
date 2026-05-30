# E2E Verification Report — limit-reset-notifier

> Produced by a 12-agent verification workflow (each agent ran real commands — curl, jq, ssh,
> Playwright — and returned a strict verdict) plus a synthesis agent. Date: 2026-05-30.

## limit-reset-notifier — E2E Verification: PASS (12/12 dimensions green, all high confidence; only 4 non-blocking nits)

| Dimension | Result | Confidence | Evidence (short) | Issues |
|---|---|---|---|---|
| public-reachability | ✅ | high | `*.trycloudflare.com`: `/healthz`→200; `/` no-auth→401 (`WWW-Authenticate: Basic realm="limit-reset-notifier"`); `-u mh:$PASS`→200; wrong pass→401; `/kpi.json`→200 valid JSON (jq exit 0, 3313 B). | — |
| dns-is-public | ✅ | high | Dashboard A-record 104.16.230/231.132 = CLOUDFLARENET (public, not 100.64/10). Homeserver `vcvm.tail6a40cd.ts.net`→100.120.120.120 (Tailscale CGNAT, `.ts.net`). Public dash + private HS. | — |
| matrix-e2e-send | ✅ | high | collect→detect `--demo`→notify-matrix sent event `$OyhF…`. Independent curl read-back: `type=m.room.message`, `sender=@openclaw`, body mentions "Limit-Reset". All 3 criteria met. | — |
| reset-detection-logic | ✅ | high | `node --test test/detect.test.mjs`→tests 6 / pass 6 / fail 0. Real reset fires; mid-window growth & rolled-but-busy suppressed; dedup verified. | Windows matched by array index, not stable key — latent misalignment risk on reorder/insert (untested). |
| burn-rate-logic | ✅ | high | `test/burn.test.mjs`→pass 4 / fail 0. jq over 4 live windows: 0 violations of `ebr ⇒ exhaustionAt<resetsAt`; deterministic across 3 reruns. claude weekly ebr=true (exhaust 05-30 < reset 06-01); Opus ebr=false correctly. | Cosmetic: ms-precision ISO breaks jq `fromdateiso8601` (Date.parse OK). `.providers[].provider` is null (key is `id`). |
| collector-integrity | ✅ | high | `collect.mjs`→kpi windows match raw latest-usable entries per bucket (Claude opus 13%/weekly 28%; Codex session 0%/weekly 87%). `dataCapturedAt` age 139 s (<30 min). | Claude session shows stale 0% (cap 05-29 07:54): true latest 21% sample lacks `resetsAt`, filtered by sources.mjs:57 — deterministic, but understates real reading. |
| launchd-collector | ✅ | high | `launchctl print`: runs=16, last exit=0, interval=600 s. cron.log tail "run.sh done"/"kpi.json published to vcvm", age 476 s. vcvm kpi.json age 479 s — both within interval. | — |
| systemd-vcvm | ✅ | high | dashboard & tunnel = active + enabled, `Restart=always`. `ss -tlnp`: LISTEN 0.0.0.0:8799 (node). sudo journalctl: "dashboard on http://0.0.0.0:8799 (user=mh)", no errors. | — |
| tunnel-resilience | ✅ | high | ExecStart includes `--protocol http2`; tunnel active; journalctl tail URL == `.env.deploy` DASHBOARD_URL (equality MATCH). | — |
| self-healing-url | ✅ | high | run.sh:13-27 reads live tunnel URL via ssh journalctl, rewrites `.env.deploy` (chmod 600) on drift. tunnel-url.sh exit 0, URL matches, regex valid; live 401→200 with creds; no `.tmp` leftover, file unedited. | — |
| dashboard-render | ✅ | high | `scripts/shot.mjs`→PNG 368179 B (>50 KB). HTML "KI-Limit Reset Notifier" ×2. Visual Read: full dashboard (Claude + Codex panels, usage, last-notification, 30 s auto-refresh) — not a login/error page. | — |
| secret-hygiene-and-repo | ✅ | high | `git grep` for token/IP → no match in tracked files. `.env.deploy`/state/dist/kpi.json git-ignored. Repo PUBLIC, `master` in sync with origin (0 0). | 2 untracked files (`deploy/com.mh.limit-reset-selfcheck.plist`, `scripts/selfcheck.mjs`) — verified secret-free but not yet committed/pushed. |

### Open items (all non-blocking)
- **reset-detection-logic** — Windows are matched by array index (`p.windows[idx]` vs `prevP.windows[idx]`), not a stable window key. Reordering or inserting a window could misalign prev-vs-current comparisons. Not exercised by current tests; latent correctness risk worth a stable-key fix.
- **collector-integrity** — Claude *session* window in kpi.json displays a stale/expired 0% reading because the true latest sample (21%) has no `resetsAt` and is filtered out at sources.mjs:57. Deterministic, but the shown session usage understates reality; consider surfacing latest usage even when `resetsAt` is absent.
- **burn-rate-logic (cosmetic)** — `exhaustionAt` uses ms-precision ISO timestamps that break jq `fromdateiso8601` (Date.parse/lexical compare still correct). Also `.providers[].provider` is `null` (the key is `id`) — note for any consumer querying by provider name.
- **secret-hygiene-and-repo** — Working tree not fully clean: 2 untracked files present (verified secret-free). Commit/push to finalize.

**Verdict:** Ship-ready. Every dimension passed at high confidence with independent read-backs (curl, jq, ssh, visual PNG). No critical failures; the four open items are quality/cosmetic follow-ups, not blockers.

---

## Post-verification fixes applied

All four non-blocking items flagged above were fixed and re-verified:

| Flagged item | Fix |
|---|---|
| Windows matched by **array index** (latent misalignment risk) | `detect-core.mjs` keys windows by stable `name`/`label`, never index (+ reorder-safe unit test). |
| **Claude session understated** — latest 21–30% reading dropped because it lacked `resetsAt`, falling back to a stale 0% entry | `sources.mjs` now uses the newest *usage* reading and marks the reset time **"unbekannt"** when CodexBar hasn't captured it. Surfaced in dashboard, Matrix message and collector (+ unit test). |
| `exhaustionAt` **ms-precision ISO** broke jq `fromdateiso8601` | `burn.mjs` emits second-precision ISO. |
| Two **untracked files** (selfcheck routine) | Committed + pushed. |

Re-verification after fixes: `node --test` → **12/12 pass**; dashboard re-screenshot confirms the
Claude session now shows real usage with "Reset-Zeit unbekannt" (see `proof/dashboard-public.png`).
