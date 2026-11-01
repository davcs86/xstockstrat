# Design: fix-etf-flag-fill

**Created**: 2026-10-22
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator approval at the round-3 design gate; Floor clear; context.md § "Operator decisions at the design gate (2026-10-22)")
**Grounded in**: recon.md

---

## Chosen Approach

SEV-3, Track C. Per the operator on 2026-10-22, the scope is FR-1/@AC-2 (the later-call label) and FR-2/@AC-3
(rate-limited Info fill visibility, class only). The round-2 gate added one more record: FR-3 "etf flag fill unlabelled".
`255-fix-marketdata-fundamentals-cache` is a **hard predecessor and must be MERGED first**. It owns the root-cause fix
(D-51 source-filtered seed, `SeedFMPBudget`) and the classifier that 230 exports. Record the dependency in
`docs/roadmap/features/merge-order.md` at /sdd-spec.

There is no proto, migration or config-key change. The change is internal to `xstockstrat-marketdata`. It reaches the
consumer surfaces (backtest and `list_opportunities` `fundamentals_gap` via analysis `_fundamentals_gap_labels`,
recon.md:72-77) only through the existing `GetEtfFlags` cache. Operators see it as new Info log records.

Edits are limited to:
- `internal/service/etf_flags.go` and its tests;
- one exported classifier name in `internal/fmp/fmp_client.go`, which 230 adds itself and lists in its step Files;
- `services/xstockstrat-marketdata/CLAUDE.md`;
- this feature's `product-spec.md` and `acceptance.feature`.

1. **Trace id on the queue item (C-03, operator 2026-10-21 and round-2 steer).**
   - Add `type etfFillItem struct{ sym, traceID string }`. The queue (`etf_flags.go:38`, make at `:50`) becomes
     `chan etfFillItem`. Today a queue item is the bare symbol (recon.md:36).
   - `GetEtfFlags` (`:62`, which currently discards its ctx, recon.md:35) names its ctx and reads
     `middleware.FromContext(ctx).TraceID` once, before taking the lock.
   - `enqueueLocked` (`:83`) sends `etfFillItem{sym, tid}`. The `pending` dedup at `:87-92` makes the admitted
     enqueuer the single origin.
   - `StartEtfFlagFiller` (`:98`, loop ctx from `main.go:162`, recon.md:29,37) keeps the loop ctx for cancellation.
     Only the trace-id string crosses over; the request ctx never does.
   - `fillEtfFlag(ctx, item etfFillItem)` attaches `trace_id` to every fill record, and only when the id is non-empty.
   - Test churn: the four `<-svc.etf.queue` drains (`etf_flags_test.go:136,156,183,200`) compile unchanged.
     `etf_flags_test.go:226` (`svc.fillEtfFlag(context.Background(), "NEW")`) changes to `etfFillItem{sym: "NEW"}`.
2. **Gate with a reason** (recon.md:44-52, 95-100).
   - `etfFillAllowed() bool` (`:140-146`) becomes `etfFillGate() (reason string, used, cap int, snap bool)`.
   - The order is unchanged: `not_wired`, then `fmp_disabled`, then `BudgetSnapshot()`, then `no_cap`, then `budget`
     (`atQuotaAlertThreshold`, `marketdata_service.go:1959`). An empty reason means the gate is open.
   - It runs outside `etf.mu`, because `BudgetSnapshot` takes `fmp.Client.mu` (`fmp_client.go:98`).
   - The skip path never calls `src`, which preserves 215 @AC-14.
3. **Rate-limit state on `etfFlagState`** (`:33`), guarded by `mu`, using the injectable `clock()` (`:53`)
   (recon.md:101-106).
   - Add `etfFlagLogEvery = time.Minute` to the `:17-25` const block. It is a code constant, not a config key (FR-2, F-07).
   - **Skip slot:**
     - `lastSkipReason` is updated on every logged skip, and an open gate clears it.
     - Config reasons (`not_wired`, `fmp_disabled`, `no_cap`) log only when the reason changes.
     - `budget` logs when the reason changes, or once per `etfFlagLogEvery` (`budgetLoggedAt`).
   - **Fail slot** (operator, round-3 gate): a per-class `map[string]time.Time` keyed by the returned class string,
     with one record per class per window. The map is bounded by the classifier's finite output.
   - **Unlabelled slot** (operator, round-2 steer): its own `unlabelledLoggedAt`, with one record per window across
     all symbols. It is independent of the skip and fail slots.
   - Each decision is made under `mu`. The lock is released, and only then is `slog` called. Nothing logs while
     holding `mu`.
4. **Records.** All are Info level. `err` and `err.Error()` are never logged.
   - `etf flag fill skipped` carries `symbol` and `reason`, `used`/`cap` only when snapped (`no_cap`, `budget`),
     and `trace_id`.
   - `etf flag fill failed` replaces the `:126` Debug call (recon.md:40-42). It carries `symbol`,
     `class=fmp.ErrorClass(err)` and `trace_id`.
     - `class` is never empty. The operator chose `other` as the fallback for stage-less errors (build-request and
       the non-ctx limiter error).
     - The classifier is 255's `enrichmentClass` (recon.md:83-94). 230 exports it as `ErrorClass` in
       `fmp_client.go` after 255 merges; it is not requested from 255.
   - `etf flag fill unlabelled` (FR-3) is emitted on the `FetchIsEtf` `(nil, nil)` path (`fmp_client.go:359,372-379`).
     It carries `symbol` and `trace_id` only.
     - Caching is unchanged: the 30-day negative cache required by 215 @AC-14 stays.
     - The cache write at `:130-135` (recon.md:43) currently holds `mu` via `defer s.etf.mu.Unlock()`. It becomes an
       explicit unlock after the entry write and the slot decision, and the record is emitted after that unlock.
5. **Spec amendments in this feature.**
   - FR-2 gains "carries the originating request's `trace_id` when present".
   - New FR-3 covers the unlabelled record.
   - @AC-2 is rewritten as "skipped while the gate was closed → labelled on a later call once the gate reopens".
     Delete the 210/5 seed Givens (255 @AC-3 owns them) and the product-spec sentence "@AC-2 … fails before 255's
     source-filtered seed".
   - @AC-3 is split into concrete-count scenarios: gate-closed reasons, fetch-error class (never empty, no
     `apikey=`), and rate-limit.
   - New @AC-4 covers the unlabelled record and its slot.
6. **Tests.** They live in the service package and run non-parallel, because `slog.SetDefault` is process-wide
   (recon.md:109-114).
   - Generalise `recordingWarnHandler`/`installWarnRecorder` (`marketdata_service_test.go:1549,1589`) into
     `recordingLogHandler`/`installLogRecorder` with an exact-level field. `installWarnRecorder` becomes a wrapper.
   - (a) Reason table: one `not_wired` case (the existing `:128` case is enough, because `SetEtfFlagSource` sets
     src and queue together, `:44-51`), plus `fmp_disabled`, `no_cap` and `budget`. Each case asserts:
     - `src.total()==0`;
     - `pending` is cleared;
     - `used`/`cap` appear only for `no_cap` and `budget`.
   - (b) Fail class: an `apikey=SECRET`-wrapped `context.DeadlineExceeded` gives `ctx`, and the same wrapping of
     `fmp.ErrFMPDailyCapExceeded` gives `cap`. Every attribute value and `msg` is checked for `apikey=` and `SECRET`
     (`fails.md:3050`).
   - (c) Unlabelled: a `(nil, nil)` source emits one record with symbol and trace_id, and the entry is still
     negative-cached.
   - (d) Rate limit:
     - N budget skips give 1 record; advancing `*etfClock` past the window gives a second;
     - N `fmp_disabled` skips give 1 record across windows;
     - `fmp_disabled` → `budget` → `fmp_disabled` gives 3 records;
     - a class change inside the window logs each class once (per-class map);
     - the skip, fail and unlabelled slots are independent.
   - (e) Trace: route the call through `middleware.UnaryServerInterceptor`, as `propagation_test.go:75-82` does.
     A bare `metadata.NewIncomingContext` will not work: `FromContext` reads the unexported `propKey{}`
     (`propagation.go:10,21`). Assert `trace_id=t-1`, and assert that a call with no trace carries no `trace_id`.
   - Every logging test asserts a `src.total()` delta, so logging never adds fetches.
   - @AC-2 regression guard, built from `fakeEtfSource`, `newEtfSvc` and `fakeBudget` (recon.md:116-128):
     - `fakeBudget{used:200,cap:250}` gives 0 fetches;
     - reassign to `{used:5,cap:250}` (value receiver, `:2037`), drain, then `is_etf==true`;
     - P-06 waiver: this test passes on trunk. Record the waiver in context.md at execute.
7. **Docs.** The marketdata `CLAUDE.md` `GetEtfFlags` paragraph gets one bullet. It covers the `fmp_disabled`,
   `no_cap` and `budget` tokens (`not_wired` stays undocumented), the class-only fail record, the unlabelled record
   and `trace_id`. `etfFlagLogEvery` is added to Fixed invariants (`:174`, recon.md:70-71,107-108).

## Rejected Alternatives

- Treating the fill as "no originating request" and logging without `trace_id`. The admitted enqueuer is a single
  origin whose trace is available, so this would be a de facto C-03 waiver, which the operator refused.
- Passing the inbound request ctx to the fill. It is cancelled when the RPC returns, which would kill the background
  fetch.
- Asking 255 to rename and export `enrichmentClass`. That pushes a 230 need into a peer spec (F-09 risk), so 230 adds
  the export itself after 255 merges.
- Driving the trace test with a bare `metadata.NewIncomingContext`. `FromContext` would see an empty TraceID.
- Three `not_wired` sub-cases. Production reaches `not_wired` only through a nil fundCfg or budget, so one case is
  enough.
- An fmp-package httptest leak test. It duplicates 255 Step 12 over the same `getJSON` path and is a merge hot spot.
- A shared fail slot. A `ctx` → `cap` → `http_403` sequence inside one window would be hidden. The operator chose
  the per-class map.
- A single global log timestamp. A budget flood would mask fail records and config-reason changes.
- A per-symbol rate-limit key. Memory grows with the symbol count, and the logs still flood.
- Changing `FetchIsEtf` to return an exported class-bearing error type. It widens the fmp API and conflicts with
  254/255.
- Logging `err` / `err.Error()`. It can carry the `apikey=` URL until 254 lands (D-39, `fails.md:3050`).
- Keeping 230's own seed-count fix. The operator dropped it on 2026-10-22, and 255 owns it.
- Warn level. The label is best-effort, and analysis already warns on RPC failure.
- Only raising the existing Debug line to Info. A closed gate, the likeliest live state, would stay silent.
- Shortening the 30-day negative cache for empty profiles. That is a CHANGE to 215 @AC-14 with no operator sign-off;
  the unlabelled record makes the case visible instead.

## Open Risks

- [ ] Root cause unconfirmed. If staging shows an open gate and clean fetches while SCHD stays `UNSPECIFIED`, the
  live cause is the `(nil, nil)` negative cache. It is now visible via the unlabelled record, but fixing it needs
  operator sign-off to change 215 @AC-14's 30-day clause. To be addressed at the post-deploy 215 Step 26(a) check
  (`fails.md:2843`).
- [ ] Hard dependency on 255: its merge, its classifier token set, and its `other` fallback. Per the operator, the
  `other` resolution is noted in 255's context.md Open Threads through the merge-order/docs PR, not in 230's dir.
  A 255 slip blocks 230's classifier step (C-11). To be addressed at /sdd-spec (merge-order row) and at the
  classifier step.
- [ ] Three-way conflict risk in `fmp_client.go` with 254/255. 254's `*url.Error` rewrap must still classify as
  `transport`. To be re-verified at the 254 merge / the classifier step.
- [ ] `slog.SetDefault` is process-wide, so the ETF log tests must stay non-parallel. To be addressed at the test
  steps.
- [ ] A suppressed record drops its fill's `trace_id`; only the logged record's trace survives. Accepted.
- [ ] `class=ctx` records during shutdown are accepted noise, at most one per window.
- [ ] An `fmp_disabled` closed gate (the default config) is not fixed by 255 and logs once per process. The staging
  check must read `marketdata.fmp.enabled` and `marketdata.fundamentals.provider` directly. To be addressed at the
  docs step / post-deploy check.

## Constitution Rules Touched

- `C-03` — honored by: the admitted enqueuer's `x-trace-id` is carried on `etfFillItem` and attached to every fill
  record; the loop ctx keeps cancellation. No waiver.
- `C-08` — honored by: the single shared `*fmp.Client` budget is untouched, and the logging adds no fetch (asserted
  via `src.total()` deltas).
- `C-11` — honored by: the design forks went to the operator and are recorded in context.md: trace id, unlabelled
  record, `other` token, and fail-slot shape. 230 invents no classifier token.
- `C-15` — honored by: @AC-2/@AC-3 are rewritten into concrete-count scenarios, and @AC-4 is added for FR-3.
- `C-16` — honored by: see Business Rules Touched; every CHANGE has an operator decision.
- `C-18` — honored by: the design reuses 255's classifier through one export, generalises the existing log-capture
  handler instead of copying it, and drops the redundant sub-cases and the httptest test.
- `P-02` — honored by: the proposer and adversary exchanged only mediated syntheses across 3 rounds.
- `P-03` — honored by: the unlabelled record carries its verbatim operator steer (context.md, round-2 gate), and
  unresolved items stay as Open Risks.
- `P-04` / `P-05` — honored by: each gate's decision is recorded in context.md as it happened.
- `P-06` — honored by: the @AC-2 regression-guard waiver (passes on trunk) is recorded in context.md at execute.
- `F-04` — honored: every cited path:line comes from recon.md or a re-read during the debate.
- `F-07` — honored: `etfFlagLogEvery` is an FR-2-sanctioned code constant. No config key, secret, proto or migration
  is touched.
- `F-08` — honored: `fmp_client.go` is listed in the classifier step's Files.
- `F-09` — honored: 230 makes no edit to a peer feature's spec.

No Floor breaches.

## Business Rules Touched (C-16)

- CHANGE `230 @AC-1` "seed-count regression" — delegated to 255 @AC-3 and dropped from 230. Signed off by operator
  @ 2026-10-22 (context.md, "operator decision — narrow scope after 255").
- CHANGE `230 @AC-2` "An ETF missed once is labelled on a later call once budget allows" — rewritten as gate closed →
  reopened, with the 210/5 seed Givens removed. Signed off by operator @ 2026-10-22 (narrowing decision; round-3
  gate approval).
- CHANGE `230 @AC-3` "A skipped or failed fill is visible at Info level without raw error text" — split into reason,
  class and rate-limit scenarios. `class` is never empty (`other` fallback), and fail records use a per-class slot.
  Signed off by operator @ 2026-10-22 (round-3 gate, context.md).
- EXTEND `230 @AC-4` (new, FR-3) "etf flag fill unlabelled" — a rate-limited Info record on the `(nil, nil)` path,
  with caching unchanged. Signed off by operator @ 2026-10-22 (round-2 gate steer, verbatim in context.md).
- PRESERVE `@AC-14 @FR-11 @feature-215` "The ETF label never spends the guard's FMP headroom"
  (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`). It is not regressed:
  - the gate order, the 80% threshold and the 30-day TTL are unchanged;
  - the skip path never calls `src`;
  - logging adds no fetch.

  Recon framed this as EXTEND because logging now sits next to it; the guarantee itself is unchanged.
- PRESERVE `@AC-4 @feature-217` "Failed FMP calls refund the shared daily budget"
  (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`). There is no second counter, and the
  refund path is untouched.
- PRESERVE `@AC-2` / `@AC-5 @feature-215` (analysis `block-fundamentals-strategy-on-etf.feature`). The refusal and
  its audit log are unchanged; only `fundamentals_gap` moves from `UNSPECIFIED` to `ETF`.

## Rounds

There were 3 full-mode rounds, and the design was approved at the round-3 gate (Floor clear).

| Round | What happened | Gate outcome |
|---|---|---|
| 1 | Established the scope (AC-2 + AC-3). | — |
| 2 | Pinned the gate reasons and the rate-limit semantics. Raised the C-03 trace-id blocker. | Operator steer: carry the trace id; add the unlabelled record. |
| 3 | Folded the trace id in. Corrected the `:226` test churn. Moved the classifier export into 230. Raised two blockers: the unrecorded unlabelled steer, and the empty class token. | Both blockers were resolved by the recorded steers (context.md § "Operator decisions at the design gate"): the round-2 steer verbatim, and `other` plus a per-class fail slot at round 3. The operator approved. |

Termination reason: **approved**.
