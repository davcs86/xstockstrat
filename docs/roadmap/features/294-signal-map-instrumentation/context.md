# Context: signal-map-instrumentation

**Feature**: `docs/roadmap/features/294-signal-map-instrumentation/feature.md`
**Product Spec**: `docs/roadmap/features/294-signal-map-instrumentation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/294-signal-map-instrumentation/implementation-spec.md`

---

## Session 2026-11-04 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number `294` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh` (cursor ref `sdd/feature-cursor`).
- Source of truth for evidence: `docs/repo-surveyor/signal-map-findings.md` (PR #1427; `da6ca69` is the PR commit that added it). Line numbers in it are as of commit `9892b61`, the code it surveyed; the implementation spec must re-ground them.
- **Operator decisions (2026-11-04)**, taken via an up-front question gate before this story: scope = everything, SEV-2 first; signals only (no behavior change); instrument only (no alerts, dashboards or registry rows); delivery = `/sdd-execute sequential`, one integration PR. The operator also stated that these are not bugs and must be worked as a single effort, so this feature is on the SDD path and not on `docs/runbooks/bug-triage.md`.
- Ledger read (`fails.md`): `033-phase7-observability` and `143-daily-bars-only` entries recorded as Known traps in the product spec.

## Session 2026-11-04 — operator answers to the open questions

- **OQ1 naming:** dotted OTel names. Resolved.
- **OQ2 loop liveness:** "one log record per loop" — confirmed through a follow-up question as **one structured `INFO` record per successful tick, no gauge, no helper**. This replaces the `<service>.loop.last_success_timestamp` gauge in FR-2, AC-6 and AC-7. Loops that already write one cycle record per tick (trading position sync, analysis live loop with its registered literal, marketdata bar ingest) keep that record and do not write a second.
- **OQ3 CI guard:** assumption agreed; `/sdd-design` confirms it by running the script once.
- **OQ6 branch:** **sequential on the current branch `ccr-b4aace27-zvuaby`** (deviation from `/sdd-execute sequential`, which assumes `feature/<slug>`). PR #1427 becomes the single integration PR; its description needs rewriting before merge because it will carry the report, the SDD artifacts and the implementation.
- Trade-off the operator accepted: per-tick records for the 5 s trading pollers are about 17k Loki records per day per loop. This sits against FR-14 and the N-* demotions, which reduce log volume elsewhere.

## Deferred behavior follow-ups (for debt-radar / later features)

The "signals only" decision splits these findings; only the signal half is in this feature. Each needs its own feature or triage item:

| Report ID | Behavior half deferred |
|---|---|
| S-01 | `flattenAndHalt` halts and pages when `GetPosition` returns an error (distinct from legitimately flat `Qty == 0`) |
| S-02 | `maybeSubmitBracket` raises `emitBracketFailureAlert` when the bracket lookup fails |
| S-03 | `syncAccountPositions` counts a failed ledger emit as not-synced, so the stall watchdog fires |
| S-08 | per-cycle timeout and `GetBars` deadline in the live loop; remove the dead "previous cycle still running" branch |
| S-09 | return 503 instead of 401 when the agent's own mTLS or runtime fault breaks identity validation |
| S-13 | emit `backfill.failed` when `registry.Get` fails, and survive caller cancellation for the terminal event |
| S-14 | fundsignal run ends `partial` when emits fail; mark the run row `failed` on a mid-run exception |
| S-15 | refresh `last_seen_at` on a healthy empty poll; treat "N>0 items, 0 valid" as a source error |
| S-16 | `_resume_job` marks the job `FAILED` and alerts; route bare tasks through `supervision.spawn` |
| S-22 | 503 (not `200 {entries: []}`) when `DATABASE_URL` is unset |
| S-25 | sleep on a clean `WatchConfig` stream end |
| S-26 | add a deadline to the identity audit `AppendEvent` |
| N-02 | exponential backoff on the fixed 2 s retry loops |
| N-04 | skip systemic escalation when the state is already `REDUCE_ONLY` / `HALTED` |

## Open items carried into /sdd-review and /sdd-design

- See product-spec `## Open Questions` 1–6. Question 6 (feature branch name versus the harness branch `ccr-b4aace27-zvuaby`, with PR #1427 open) must be settled before `/sdd-execute`.

## Session 2026-11-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass **FAILED** on criterion 9 only (Open Questions 3, 4, 5 unticked). Fixed in the spec: OQ3 ticked (agreed), OQ4 closed ("keep old text at DEBUG, no rewording"), OQ5 closed (NC-1 out of scope; NC-2 and NC-4 settled in design Phase 0). Re-review: **PASS WITH WARNINGS**, no blockers, no Floor breach.
- Warnings addressed: named `trading.escalation.systemic` and the five config/ledger listener instruments; loop-name cap aligned to 8 in FR-2 and AC-7; trading-domain statement FR-15(h) (IBKR on equal terms, paper/live parity, fill handling unaffected); commit reference reconciled (`9892b61` = code surveyed, `da6ca69` = PR commit); stale Affected Services line fixed; FR-12 changed from "drop" to "demote to DEBUG, text unchanged"; AC-45…AC-56 appended for requirement sub-bullets that had no scenario (56 scenarios total, FR-1…FR-16 all covered).
- Demoted-duplicate check: 22 demoted features exist; none is a re-attempt (106 market-data freshness and 108 trading-safety dashboard SLOs are adjacent in spirit only). Treated as a new feature.
- Overlap findings (WARN level only, no proto/config/migration/instrument clash):
  - `215-block-fundamentals-strategy-on-etf` (in-progress): analysis `servicer.py`, `live_loop.py`, `evaluator.py`; 215 also moves fundamentals predicates into `app/services/fundamentals_guard.py`. Highest risk; 215 lands first per `merge-order.md:322`.
  - `281-signal-watchlist-expiry-pruning` (implementation-ready): agent `tools.py`, portfolio `portfolio_service.go` + `cmd/server/main.go`, config `configServiceImpl.ts`.
  - `243-fix-sandbox-seed-keys` (in-progress): indicators `servicer.py` (`_clamp_override`).
  - No `merge-order.md` row was written (no FAIL-level overlap). The impl-spec step ordering must put the 215-touched analysis steps after 215 lands, or rebase; re-run `/sdd-review impl-spec` for the Mode B overlap scan.
- Recommended design depth: **full** (12 affected services; overlap warnings).
- Operator branch override (recorded per review note): execute runs `sequential` on `ccr-b4aace27-zvuaby`, not `feature/<slug>`; PR #1427 is the integration PR. `/sdd-execute` must log this as a deviation.

## Session 2026-11-04 — sdd-design (in progress; checkpoint)

- Phase 0 Recon: wrote recon.md (12 services; reuse patterns: per-provider rebinding accessors in each service's existing telemetry module, `bffMetrics.ts` lazy rebind, `CollectingReader`/`metric_reader`/`ManualReader` test readers; no CHANGE to any existing business rule).
- Phase 1 Grilling: rounds 1-5 run (full mode). Floor status: clean in every round. Round 5 adversary verdict: APPROVE with fixes (no wrong citations among those checked; five acceptance scenarios still drifted from code: AC-4, AC-9, AC-12, AC-17, AC-19).
- Operator decisions taken at the gates (binding for design.md):
  - Tick rule = body ran to completion and was not a whole-tick failure, defined per loop (denominator = items that reached the fallible call); gated-off loops still write `loop tick ok` with `state`; event-driven consumers use a 60 s leading-edge throttle.
  - Acceptance scenarios amended in place (same IDs) with a note per change; new scenarios appended (AC-57, AC-58).
  - Agent backend label counted in the `mtls.secure_channel` wrapper `__aexit__`.
  - Portfolio recovery: `onHealthy` callback acknowledged ("stream resumed", only when >= 2 closes of one kind preceded it); counters also reset after a 10-minute quiet window.
  - Per-service `logTickOK` + loop-name constants (the earlier "no helper" applies to the gauge).
  - Orchestrator rulings: trading label key `category` -> `alert_kind`; AC-36 uses the fully-qualified `xstockstrat.analysis.v1.AnalysisService`; `observeQuotePass(ctx, ...)` replaces the per-position `slog.Warn` at portfolio_service.go:484 (applyQuotes signature unchanged).
- **Operator override (2026-11-04, explicit):** at the round-5 gate (the skill's hard cap of 5 rounds) the operator chose "override cap, run another round". The cap is a skill HARD CONSTRAINT, not a Floor (F-*) item, so it is overridable with sign-off recorded here. Round 6 is scoped narrowly: apply the nine round-5 fixes, produce the complete amended `acceptance.feature` and verify every scenario's labels/counts against the code. No further rounds beyond 6 without a new explicit sign-off.
- Status remains `spec-ready` until the design is approved.
