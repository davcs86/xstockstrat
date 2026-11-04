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

- [x] Timeout for the detached cache insert: config key vs justified invariant (F-07) — decide in round 2. — resolved 2026-11-04: fixed invariant, operator-approved
- [ ] Partial application (k of N upserts, no transaction) accepted risk; repaired by boot replay.
- [x] Follow-up defect report for warm-poller/ingest cancel WARNs only if Loki shows a flood there. — resolved 2026-11-04: follow-up report created (docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md)

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
- [x] RED tests need two new inline fakes (bar-returning source that cancels; recording `barsBatchStore`) and an inline portfolio DB variant whose `Exec` cancels — list them in the step's Files (fails.md:2708-2711). (addressed 2026-11-04: fakes listed in the implementation-spec Step 4 Files)
- [ ] Partial application on portfolio cancel — accepted (boot replay); no transaction.

## Session 2026-11-04 — sdd-spec

- Generated implementation-spec.md with 5 steps (portfolio service+test, marketdata service+test, docs teardown). Status -> implementation-ready.
- Key codebase findings:
  - Portfolio fix sites confirmed at `portfolio_service.go`: fn `:1381`, loop `:1409`, upsert WARN `:1421`, delete branch `:1426-1428`, 206 skip `else` `:1431-1433`, realized `:1437-1439`. Test harness reusable as-is: `syncRecorderDB` (`portfolio_offline_test.go:220`), `recordWarns`, `syncEvent`/`offlineSyncPayload`, `parkedCount`; one new inline `cancelingDB` embedding `syncRecorderDB`.
  - Marketdata: `fetchAndCacheBars` `:356`, write `:370`, re-reads `:375/:382`; `barsBatchStore` seam `:127-130` wired `:239`; `sync/atomic` not imported yet. No existing test reaches `fetchAndCacheBars`; existing fakes return `nil, nil` and would pass vacuously.
  - Feature 291 also edits `marketdata_service.go` (ingester inserts, `barsStore` field comment `:109`) and leaves `:370` untouched: textual rebase only, no merge-order entry.
- Spec-time refinements to design.md (to confirm at `/sdd-review impl-spec`): (1) departed-at-start write uses `WithTimeout(WithoutCancel(ctx), grace)` so `@AC-6`'s "deadline <= grace" is literally assertable; the design's `AfterFunc` form (no `Deadline()`) is kept for the live-at-start branch; (2) one-writer slot is an `atomic.Bool` (zero-value safe for test literals) instead of a buffered channel; (3) a write error is WARNed regardless of ctx state (the write is detached, so it is never the client's cancel).
- `grace` sizing (closes the Open Thread, with a caveat): `InsertBars` has no span (pgx untraced), so no direct p99. Tempo 24h: slowest whole-request `GetBars` (all 10 requests > 1 s) peaked at 2.70 s incl. Alpaca fetch + write + re-read; root-span p99 195 ms (10:00-10:15Z). 5 s = 1.85x that ceiling; worst case one pooled client conn for <= 5 s (PgBouncer), no pool max change (F-06). Operator may supply a direct staging InsertBars timing before the PR.
- Open: `AC-6` mid-write-departure case is an extra test beyond the nine ACs (same FR-2 guarantee).

---

## Session 2026-11-04 — sdd-review impl-spec (advisory)

- Result: 0 failures, 5 warnings, 0 Floor risks (advisory — did not block). Criteria pass: PASS WITH WARNINGS; overlap scan: no migration / proto / config-key collisions, no FAIL-level overlap.
- Unresolved ⚠ carried into execution:
  - Step 1/2: a canceled **broker** sync now returns `ctx.Err()` (Instruction 5) but no test asserts it — AC-1..3 use offline payloads, AC-4 is a live-ctx broker case, AC-5 hits the skip branch (C-15/P-06) — [x] addressed 2026-11-04: AC-10 + Step 2 test. Add a broker-payload, ctx-done case when executing Step 2.
  - Step 4: the pre-Step-3 "RED" is a **compile failure** (`barsCacheWriteGrace` undefined), not the claimed nil-`s.repo` panic, so every test in `internal/service` goes red (P-06) — [x] addressed 2026-11-04: Step 4 red-first note. Either stub the constant for the red run or record the compile failure as the red capture; re-confirm AC-7 and AC-8(i) fail by assertion/panic.
  - Step 4 / acceptance.feature: AC-8 subcase (ii) (departed ctx + failing detached write still WARNs, spec decision 3) and the mid-write-departure test have no `@AC-*` (C-15) — [x] addressed 2026-11-04: AC-11 and AC-12 added. Append a scenario (append-only IDs) or tag them as spec-level characterization.
  - Step 3: the one-writer slot caps only writers that START departed; a request live at write start that leaves mid-write takes the `WithCancel`+`AfterFunc` branch with no slot, so a burst of those can still hold up to N×`grace` pooled conns (F-06/C-18 — not a breach: live writes behave the same today, no pool maximum changes) — [x] addressed 2026-11-04: recorded in design.md Open Risks. Record as an accepted residual in design.md Open Risks; `design.md`'s "bounds the pool cost of a cancel burst" is only partly true.
  - Step 3: `grace` is sized from whole-request `GetBars` Tempo latency (p99 195 ms, 2.70 s ceiling) because `InsertBars` has no span — a substitute for the measured `InsertBars` p99 that design.md required (C-01). Keep the **staging `InsertBars` timing as a mandatory pre-PR gate** — [ ] unaddressed.
  - Step 4 (note): AC-9's shared source bars get `Timeframe` mutated by `truncateBars`; build fresh bars per call if a timeframe assertion is ever added on the third call — [x] addressed 2026-11-04: fresh-bars note in Step 4.
- Overlap findings (file-level, WARN, rebase-only): `marketdata_service.go:109` `barsStore` comment (290 Step 3 rewrites it; 291 adds a one-line constraint — whichever merges second re-reads it and states both consumers); `fetchAndCacheBars` hunk vs 282's adjacent GetBars gate (`:312-332`); `marketdata_service_test.go` end-of-file appends vs 215/282 inserts (highest textual-conflict risk); marketdata/portfolio `CLAUDE.md` and `context-constitution.md` edits in different sections/rule IDs vs 215/281/282/291. No `merge-order.md` row required (optional soft row 290 ↔ 291 for the `:109` comment).

---

## Session 2026-11-04 — sdd-review product-spec (advisory; status NOT changed)

- Verdict: PASS WITH WARNINGS (no blockers, no Floor). Status stays `implementation-ready` — this advisory run does not write status.md / feature.md history.
- Warnings addressed in this session: product-spec FR-1/FR-2 amended (broker cancel returns the cancellation; "departed-client write" = a write that starts after the client left; 5 s grace stated; a failed detached write still WARNs whatever the client's state; the untested live-ctx re-read WARN recorded as an accepted residual); persona named; "not persisted" instead of "discarded"; BrokerType-agnostic sentence; `:370` anchor reworded; grace provenance reworded to the Tempo-based sizing with the staging `InsertBars` timing kept as a mandatory pre-PR gate; acceptance: AC-1..AC-9 given concrete values and the missing tags (AC-3/AC-9 regression, AC-7 characterization, AC-1 title "after the first upsert"), AC-10 (broker cancel returns the cancellation), AC-11 (departed client + failing write still WARNs) and AC-12 (client leaves mid-write) appended; implementation-spec coverage table, `Covers` lines and test instructions updated (AC-10 test in Step 2; AC-11/AC-12 tests and a compile-failure red note in Step 4); mid-write residual added to design.md Open Risks.
- Overlap (warn-level): `barsStore` comment line shared with 291; 294 `boundedRetry` instrumentation; merge-order rows added (291, 294).
