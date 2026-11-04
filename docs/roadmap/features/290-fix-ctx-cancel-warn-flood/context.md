# Context Log: fix-ctx-cancel-warn-flood

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md` (Issues disabled): portfolio (and marketdata) keep working and WARN-flooding after the context is canceled
- Severity: SEV-3
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-portfolio, xstockstrat-marketdata
- Root cause hypothesis: No `ctx.Err()` short-circuit in the per-item loops (`portfolio_service.go:1420-1430`) or cache-insert paths (`marketdata_service.go:371`). The event is redelivered by `boundedRetry`, so this is log noise plus wasted DB calls, not data loss. Deploy correlation inferred from timestamps. The two services are independent fix sites.
- Recommended design depth: full -> `/sdd-design fix-ctx-cancel-warn-flood` (rationale: two affected services (rubric escalate signal); SEV-3)
- Development branch: feature/fix-ctx-cancel-warn-flood
- Number 290 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

---

## Session 2026-11-04 — sdd-design (Phase 0 + round 1)

- Status: `draft` (design not yet approved). `/sdd-review` skipped on the operator's instruction to work on 290/291 right away.
- Phase 0 recon written (`recon.md`): portfolio + marketdata discovery, 23 PRESERVE business rules (0 EXTEND / 0 CHANGE).
- **Root-cause evidence (Loki, staging, 2026-11-04 06:07 UTC):** portfolio logged `shutting down portfolio service` at :53.6 and the first `upsert position from sync failed … context canceled` at :54.94 on the same process; ~39 `account.positions.synced` events (5 upserts + 1 delete each) were handled in ~10 ms after the cancel, every one returning nil (acked). So the handler ctx IS done at flood time and the flood is shutdown draining buffered events — resolves the recon Risk "root cause unresolved". Portfolio restarts are frequent (start→shutdown pairs ~26 s apart, ~15 in the first 2 days of the window).
- Marketdata `GetBars: cache insert failed … begin tx: context canceled` fires ~3 min after marketdata's own shutdown line with no restart: client-cancelled request contexts while the process is alive. Warm-poller/ingest sites showed no flood in the checked window.
- Round 1 (full mode): proposer → adversary (NEEDS WORK, no Floor breach). Accepted: honest rationale ("stop draining; cursor irrelevant at shutdown" — the 2 s sleep at `portfolio_service.go:205` is never reached when `ctx.Err()!=nil` at `:197`; `lastSeq` is in memory, replay from 0 at boot); checks placed inside the reconcile / `RealizedPnl != nil` branches so the feature-206 skip path is untouched; extra RED cases (Exec-that-cancels, live-ctx pgx `context.Canceled` negative control, boundedRetry no-park, 206 skip path); reuse `s.barsStore` instead of a second `InsertBars` interface; Debug not Info; update the doc comment at `portfolio_service.go:1379-1380`; observable acceptance phrasing; FR tags.
- **Operator steers at the round-1 gate (P-04):** (A) detach the GetBars cache insert (bounded `context.WithoutCancel`) so bars persist after a client cancel — removes the WARN and the repeated Alpaca fetch; extends `@AC-8 @feature-196`, does not break it. (B) marketdata scope = `fetchAndCacheBars` only; warm-poller / ingest / `:564` out of scope.
- Rejected: wrapping the portfolio sync in a transaction (scope creep; partial state is repaired by boot replay); shared cross-module helper (separate Go modules); `errors.Is(err, context.Canceled)` as the stop test (would hide ctx-alive pgx cancels).
- Open: round 2 in progress (full mode mandates ≥2).

## Open Threads

- [ ] Timeout for the detached cache insert: config key vs justified invariant (F-07) — decide in round 2.
- [ ] Partial application (k of N upserts, no transaction) accepted risk; repaired by boot replay.
- [ ] Follow-up defect report for warm-poller/ingest cancel WARNs only if Loki shows a flood there.

---

## Session 2026-11-04 — sdd-design (round 2 + approval)

- Round 2 (full): proposer → adversary NEEDS WORK, no Floor breach; all findings adopted. Gate (P-04): operator chose the marketdata variant **"Detach, post-departure bound + 1 writer"**; design.md written; status `draft` → `design-approved` (/sdd-review skipped on operator instruction).
- Chosen: portfolio `ctx.Err()` stop (one local closure, checks inside the reconcile / `RealizedPnl` branches, return never break, broker sync returns the cancel error to stop draining); marketdata `fetchAndCacheBars` writes on a detached context bounded **only after the client leaves**, at most one departed-client writer at a time (others skipped silently), re-read skipped when the client is gone.
- Round-2 adversary caught: a plain 5 s `WithTimeout(WithoutCancel)` would also cut a LIVE caller's write and return a full page with no next-page token that analysis reads as end of data (`servicer.py:1482-1484`, `@feature-272`) — fixed by the post-departure bound; burst shape measured in Loki (max 27 cancels/minute across distinct symbols; 9 minute-buckets in 7 days) — motivates the one-writer slot.
- **Operator sign-off recorded (C-18/F-07 precedent): the post-departure write grace is a FIXED resource-protection invariant, not a config key** — it decides neither what the caller receives nor how old data can be. Value to be sized from a measured `InsertBars` p99 (~1000-bar slice) at spec time (provisional 5 s). Goes into marketdata `CLAUDE.md` (GetBars bullet) and MARKETDATA-3 prose; the stale doc comment at `marketdata_service.go:354-355` is rewritten.
- Follow-up artifact created (closes the earlier conditional Open Thread): `docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md` (+ `.status` open).
- Product-spec and acceptance.feature revised at this gate (FR-1/FR-2, root cause from Loki, consumer surface = internal; `@AC-1` keeps its meaning, new IDs appended).
- Business rules: PRESERVE set per design.md; EXTEND `@AC-8 @feature-196`; no CHANGE.
- Status: draft → design-approved.

## Open Threads (supersedes the earlier list)

- [ ] Size `grace` from a measured `InsertBars` p99 — marketdata spec step; record the measurement here.
- [ ] Teardown (Step): marketdata `CLAUDE.md` GetBars bullet + MARKETDATA-3 prose + the stale comment at `:354-355`; portfolio doc comment `:1379-1380`.
- [ ] RED tests need two new inline fakes (bar-returning source that cancels; recording `barsBatchStore`) and an inline portfolio DB variant whose `Exec` cancels — list them in the step's Files (fails.md:2708-2711).
- [ ] Partial application on portfolio cancel — accepted (boot replay); no transaction.
