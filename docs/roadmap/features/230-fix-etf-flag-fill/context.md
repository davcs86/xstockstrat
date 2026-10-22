# Context Log: fix-etf-flag-fill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-15 (/sdd-triage)

- **Origin:** defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`, from feature 215 Step 26(a) staging verification. The report and
  its sidecar live on `docs/215-staging-verification` (PR #1249).
- **Classification:** SEV-3, dev environment, not config-only. Routed to the SDD path (Track C).
- **Created:** status.md, feature.md, product-spec.md, acceptance.feature (@AC-1..3), context.md.
- **Affected services:** xstockstrat-marketdata.
- **Root cause hypothesis:** the boot-seed over-count closes the 80% fill gate. This is unconfirmed:
  log access was blocked in the triage session.
  - The alternatives are a Debug-only fetch error or an empty-profile negative cache.
  - The staging log tail at 19:00–19:22Z shows a steady stream of
    `edgar snapshot not producible — falling back to vendor`, which feeds the seed.
- **Operator decision (2026-10-15):** "Yes". Triage now, with the fix shape being an FMP-only seed
  count plus Info-level visibility for a skipped or failed fill.
- **Recommended design depth:** quick → `/sdd-design fix-etf-flag-fill quick`. Rationale: SEV-3,
  single service and no proto, migration or config change, but the root cause is unconfirmed.
  - **Recon must first confirm the cause:** from the marketdata run logs, or from a per-`source` count
    of today's `marketdata.fundamentals` rows.
  - **Open design question:** which `source` values cost an FMP call. `fmp` does; `edgar+fmp` is
    the PIT history in `fundamentals_history`, so it is not counted. Check whether Finnhub-provider
    rows ever spend FMP calls.
- **Development branch:** `feature/fix-etf-flag-fill`.

## Session 2026-10-22 (re-verification on main-dev)

- Purpose: bring the 230 triage artifacts onto `main-dev` (copied unchanged from `origin/feature/fix-etf-flag-fill`
  `459fb5c2`) and re-verify the defect, triaged at `a8a3cfd`, against `main-dev` `6923e95a` (86 commits later). The
  report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` and its `triaged` sidecar are already on
  main-dev and were left untouched. Status stays `draft`.
- **Still reproduces by reading** (`services/xstockstrat-marketdata`). None of the three suspect sites changed:
  - Fill gate: `internal/service/etf_flags.go:140-146` `etfFillAllowed` — `fmp.enabled`, budget wired, `cap > 0`,
    `!atQuotaAlertThreshold(used, cap)` (`marketdata_service.go:1959`, `count >= cap*8/10`). No drift in
    `etf_flags.go` since `a8a3cfd`.
  - Boot seed: `cmd/server/main.go:129-130` `fmpClient.SeedBudget(repo.CountFundamentalsFetchedToday(ctx))` — no drift.
    `CountFundamentalsFetchedToday` is still an unfiltered `count(*)` over today's `marketdata.fundamentals`
    (`internal/repository/marketdata_repo.go:656-664`; was `:565`, drift +91 from unrelated repo edits). Non-FMP rows
    still land in that table: the EDGAR fallback WARN `edgar snapshot not producible — falling back to vendor`
    (`marketdata_service.go:1864`, was `:1627`) feeds `resolveFundamentals`, and `UpsertFundamentals` call sites are
    at `:1707`, `:1762`, `:1879` (was `:1634` for the edgar snapshot write).
  - Fetch-error visibility: `etf_flags.go:126` still `slog.DebugContext(ctx, "etf flag fill failed", …)`; the gate-closed
    path (`:121-123`) returns with no log at all. The process logger is `slog.NewJSONHandler(os.Stdout, nil)`
    (`cmd/server/main.go:35`), i.e. Info level, so both causes stay invisible.
  - Wiring unchanged: `SetClassification(..., fmpClient)` sets `s.fmpBudget` (`main.go:152`,
    `classification_service.go:55`), `SetEtfFlagSource` `:153`, `StartEtfFlagFiller` `:162`.
  - Root cause is still unconfirmed from logs (no staging log access in this session); the code-level hypotheses
    in the 2026-10-15 entry all still hold.
- **Overlaps with in-flight features:**
  - `255-fix-marketdata-fundamentals-cache` (implementation-ready) — **subsumes 230's primary fix (@AC-1).** Its D-51 /
    FR-2 / `@AC-3` make `CountFundamentalsFetchedToday` source-filtered (`WHERE source = $1 AND (fetched_at >= $d OR
    as_of >= $d)`, `$1 = fmp.SourceName`) and extract the `main.go:129-130` seed into `SeedFMPBudget`. 255 does not
    mention 230 and does not touch `etf_flags.go` logging. Recommendation for /sdd-design: rescope 230 to land after 255,
    keep only @AC-2 (label on a later call) and @AC-3 (Info-level, rate-limited skip/fail visibility), and either drop
    230 @AC-1 or cite 255 `@AC-3` as its coverage. Note 255's design also warns that its D-53b re-fetch amplification
    can reach the FMP cap earlier and "starve the 215 ETF filler" — that strengthens the case for 230's @AC-3 logging.
  - `215-block-fundamentals-strategy-on-etf` (in-progress) — owns `etf_flags.go` (Step 9) and its tests
    (`etf_flags_test.go`, `@AC-14` gate cases incl. 80/100 skip, 0/0, fetch error not cached). 230 must preserve
    `@AC-14@feature-215` (C-16) and land after 215; merge-order already has 255 after 215.
  - `254-fix-marketdata-secret-exposure` (implementation-ready) — edits `fmp_client.go` error wrapping
    (`FetchIsEtf` `:375` on its list, transport `*url.Error` carries `apikey=`). If 230 logs the `FetchIsEtf` error at
    Info/Warn, it must not log the raw error string before 254 lands (or must log a class only, as 255 §5.3′ does).
    Soft rebase overlap; record a merge-order row at /sdd-spec.
  - `253-fix-edgar-companyfacts-decode` (launched) — reduces the `zero_history` EDGAR fallback flood (cik-as-string
    decode), which shrinks — but does not remove — the non-FMP row inflation behind the seed over-count. Its
    out-of-scope list leaves rate-limiting that WARN open.
- Recommended design depth unchanged: quick → `/sdd-design fix-etf-flag-fill quick`, with the 255 rescope as the
  first design question.

## Session 2026-10-22 (operator decision — narrow scope after 255)

- **Decided:** 230 lands **after** `255-fix-marketdata-fundamentals-cache`, which already fixes the root cause
  (D-51: source-filtered FMP seed count + `SeedFMPBudget`). 230 is narrowed to **AC-2** (an ETF is labelled on a
  later call once budget allows) and **AC-3** (rate-limited Info-level fill logging, error class only — no raw error
  text, since `FetchIsEtf` errors can carry the `apikey=` URL until 254 lands). Its own seed-count fix is dropped.
  `/sdd-review product-spec` amends FRs/ACs accordingly; 215's @AC-14 tests must keep passing.

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Warnings:
  - Criterion 8 (C-15): `@AC-3` has a disjunctive Given (gate closed, or fetch error containing `apikey=`) and no
    concrete rate-limit count (e.g. 5 skips of SCHD within 60s emit exactly 1 record), and it depends on the open
    rate-limit key. **Carry to /sdd-design:** split `@AC-3` into gate-closed, fetch-error and rate-limit scenarios once
    the key (per symbol, per reason, or global) is chosen.
  - Criterion 9 (C-11): three Open Questions remain unresolved (rate-limit key; whether the 30-day empty-profile
    negative TTL changes; root-cause confirmation). The rate-limit key blocks a well-formed `@AC-3` — resolve at /sdd-design.
  - Criterion 1: Problem Statement named no persona — **resolved in this session** (added a "Who is affected" paragraph
    naming the trader/analyst reading `fundamentals_gap` and the operator reading marketdata logs).
  - Note (sequencing): FR-1 / `@AC-2` depend on 255's source-filtered boot seed (`CountFundamentalsFetchedToday` at
    `services/xstockstrat-marketdata/cmd/server/main.go:129`, still unfiltered on this branch); FR-2 references 254 for
    the `apikey=` exposure. Keep the "lands after 255" ordering in `merge-order.md`.
  - Note (root cause): primary hypothesis still unconfirmed, as the spec states. Code claims verified:
    `fillEtfFlag` returns silently when `etfFillAllowed()` is false (`internal/service/etf_flags.go:121-123`), fetch
    errors log only at `slog.DebugContext` (`etf_flags.go:126`).
- Overlap findings (level WARN):
  - [file] `services/xstockstrat-marketdata/internal/service/etf_flags.go` — 230 Fix Scope vs
    `215-block-fundamentals-strategy-on-etf` (in-progress) implementation-spec `:458`/`:493` (Step 9 owns the file).
    Merge-conflict risk; 230 `@AC-2`/`@AC-3` must preserve 215 `@AC-14` gate behaviour.
  - [file] `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — 230 test changes vs 215
    implementation-spec `:538`/`:554` (215 owns the `@AC-14` gate tests). Merge-conflict risk.
  - [behavioural dependency] `255-fix-marketdata-fundamentals-cache` (implementation-ready) product-spec `:24-26`
    (D-51 source-filtered FMP seed count in `cmd/server/main.go:129-130`) vs 230 `@AC-2` precondition. 230 lands after
    255; no shared file edit in 230 scope.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Triaged 2026-10-15 (docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md); Track C; re-verified 2026-10-22.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
  - Operator 2026-10-22: NARROW 230 to land after 255-fix-marketdata-fundamentals-cache, which already fixes the root cause (D-51 source-filtered FMP seed count + SeedFMPBudget). Keep only AC-2 (an ETF is labelled on a later call once budget allows) and AC-3 (rate-limited Info-level fill logging, error class only — never the raw error text, since FetchIsEtf errors can carry the apikey URL until 254 lands). Drop 230's own seed-count fix. The product-spec review amends FRs/ACs accordingly; 215's @AC-14 tests must keep passing.
- Spec already reflected the narrowing (FR-1/FR-2, `@AC-2`/`@AC-3`, former `@AC-1` delegated to 255 `@AC-3`); no
  FR/AC change needed in this session.
- Next: `/sdd-design fix-etf-flag-fill`.

## Session 2026-10-22 — sdd-batch design gate (round 2)

Full debate halted at the approval gate after round 2 (gate policy: halt). design.md is not written and status.md is
unchanged (spec-ready), per the grilling protocol. The resume state is in the `sdd-batch-design-state` block below.

## Open Threads

- **Approach (round 2).** Narrowed to @AC-2/@AC-3 with 255 as a hard predecessor. No proto, migration or config change.
  Edits stay in `internal/service/etf_flags.go`, one exported classifier name in `internal/fmp`, tests, and
  `services/xstockstrat-marketdata/CLAUDE.md`.
  - Gate: `etfFillAllowed() bool` becomes `etfFillGate() (reason, used, cap, snap)`, keeping the `:141` short-circuit
    order (`not_wired` → `fmp_disabled` → `BudgetSnapshot()` → `no_cap` → `budget`). It runs outside `etf.mu`, and the
    skip path never calls `src` (215 @AC-14 preserved).
  - Rate limit on `etfFlagState`, under `mu`: `lastSkipReason` updates on every logged skip (`budget` included).
    Config reasons log on change only; `budget` logs on change or once per `etfFlagLogEvery = time.Minute`. One shared
    `failLoggedAt` covers all fetch-error classes, so a class change inside the window is suppressed. The lock is
    released before `slog`.
  - Trace id (recommended fix for the blocking objection): `GetEtfFlags` stops discarding ctx. The queue becomes
    `chan etfFillItem{sym, traceID}`, carrying the single admitted enqueuer's trace (`:87-92`). The loop ctx keeps
    cancellation, and the 15 test drain sites change to `.sym`.
  - Records, both Info, never `err`: `etf flag fill skipped` (symbol, reason, used/cap only when snapped, trace_id) and
    `etf flag fill failed` (symbol, `fmp.ErrorClass(err)`, trace_id). Preferred: 255 Step 5 exports `ErrorClass`
    directly; a one-line wrapper only if 255 is frozen.
  - Tests (non-parallel; `slog.SetDefault` is process-wide):
    - a reason table with all three `not_wired` sub-cases, asserting `src.total()==0` and the pending clear;
    - ctx/cap class tests via `errors.Is` sentinels, with an `apikey=SECRET` leak check;
    - rate-limit tests asserting the pinned semantics;
    - a trace_id test;
    - one short @AC-2 regression guard (P-06 waiver) reassigning `fakeBudget`.
    The fmp-package httptest test is dropped, because 255 Step 12 covers it.
  - @AC-2 is rewritten as "an ETF skipped while the gate was closed is labelled once the gate reopens", and the 210/5
    seed Givens are deleted (255 owns them). The docs add a single bullet plus `etfFlagLogEvery` under Fixed
    invariants.
- **Strongest open objection (BLOCKING, C-03 / operator rule 2026-10-21).** The fill has an originating request.
  `GetEtfFlags` discards its ctx (`etf_flags.go:62`), but its single admitted enqueuer carries a trace id through
  `middleware.FromContext` (interceptor wired at `cmd/server/main.go:179`). Recording a "no originating request"
  reading in context.md would be a de facto C-03 waiver the operator refused. There are two ways to resolve it:
  1. carry the enqueuer's trace id on the queue item, as recommended above;
  2. escalate the interpretation to the operator under C-11.
  The proposal has not answered it yet.
- **Non-blocking objections.**
  - 255 must be merged, not just implementation-ready, and recorded in `merge-order.md` as a hard predecessor. If its
    stage-less classifier token is still unresolved, the 230 `ErrorClass` step stops under C-11.
  - Drop the duplicate fmp httptest test (C-18).
  - Ask 255 to export `ErrorClass` directly rather than wrapping it (C-18).
  - Pin the rate-limit state machine in the spec.
  - The reason table must assert behaviour (C-16 / 215 @AC-14).
  - The @AC-2 guard reuses existing helpers and notes its overlap with `TestEtfFlagFiller_HeadroomGate_AC14` and
    `TestGetEtfFlags_TTL` (P-06).
  - Scope step 3 reads staging's `marketdata.fmp.enabled` and `marketdata.fundamentals.provider` directly.
  - FR-2: the `FetchIsEtf` (nil, nil) path (`fmp_client.go:359,372-379`) negative-caches for 30 days with no log. An
    optional rate-limited `etf flag fill unlabelled` Info record goes to the operator at product-spec review, and is
    not added silently.
- **Open risks.**
  - The root cause is still unconfirmed. Only the post-deploy 215 Step 26(a) check catches it if the (nil, nil)
    negative cache is the cause (`fails.md:2843` pattern).
  - Hard dependency on 255.
  - Three-way `fmp_client.go` conflict with 254 and 255.
  - Broad mechanical test diff (15 drain sites).
  - Process-wide `slog.SetDefault` in tests.
  - Shutdown `class=ctx` noise (at most one per minute).
  - The default `fmp_disabled` gate logs once per process.
- **Floor status.** No Floor breaches. `etfFlagLogEvery` is an FR-2-sanctioned code constant (F-07), and nothing
  touches proto, migrations, config keys or secrets.
- **@AC changes.**
  - Covered by the operator decision (2026-10-22): 230 @AC-1 (CHANGE), @AC-2 (CHANGE), @AC-3 (CHANGE).
  - Not covered: 215 @AC-14 is PRESERVE only. No uncovered @AC change.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 230-fix-etf-flag-fill. It is narrowed by the operator to AC-2 and AC-3 and has 255 merged as a hard predecessor. There is no proto, migration or config change. All edits stay in internal/service/etf_flags.go, one exported classifier name in internal/fmp, tests, and services/xstockstrat-marketdata/CLAUDE.md.\n\n1. Gate (etf_flags.go:140-146). `etfFillAllowed() bool` becomes `etfFillGate() (reason string, used, cap int, snap bool)`.\n   - Keep the :141 short-circuit order: `not_wired` (src, fundCfg or fmpBudget is nil), then `fmp_disabled`, then `BudgetSnapshot()`, then `no_cap` (cap <= 0), then `budget` (atQuotaAlertThreshold, marketdata_service.go:1959).\n   - An empty reason means the gate is open.\n   - The gate runs OUTSIDE etf.mu. BudgetSnapshot takes fmp.Client.mu, so the client lock is never nested under etf.mu.\n   - The skip path never calls src, which preserves 215 @AC-14.\n\n2. Rate-limit state on etfFlagState (:33), guarded by mu. These are the pinned semantics.\n   - `lastSkipReason string` is updated on EVERY logged skip, `budget` included. The sequence fmp_disabled -> budget -> fmp_disabled therefore re-logs.\n   - Config reasons (not_wired, fmp_disabled, no_cap) log only when the reason differs from lastSkipReason.\n   - `budget` logs when the reason changed, or when budgetLoggedAt is at least etfFlagLogEvery old.\n   - One shared `failLoggedAt` for every fetch-error class, at most once per etfFlagLogEvery. A class change inside the window is suppressed. This must be stated in the spec. It is the default unless the proposer argues for per-class slots, which are bounded by 255's fixed token set.\n   - Open gate: clear lastSkipReason.\n   - `etfFlagLogEvery = time.Minute` is added to the :17-25 const block.\n   - The decision runs under mu with clock() (:53). The lock is released before slog. On the fail path, mu is held only for the decision, because the :116-120 defer takes it again.\n\n3. Trace id (recommended fix for the open blocking objection).\n   - GetEtfFlags (:62) stops discarding ctx. It reads `middleware.FromContext(ctx).TraceID`. The interceptor is wired at cmd/server/main.go:179.\n   - The queue item widens from `chan string` (:38,50) to `chan etfFillItem{sym, traceID string}`. Only the admitted enqueuer's trace is carried, because `pending` dedup at :87-92 makes that enqueuer the single origin.\n   - StartEtfFlagFiller still passes the loop ctx, so the request ctx is never used for cancellation.\n   - fillEtfFlag adds `\"trace_id\", item.traceID` to both records when the id is non-empty.\n   - Existing drains in the tests (15 sites) change to `.sym`.\n   - The alternative is the proposer's \"no originating request\" reading. That stands only if the operator explicitly confirms it under C-11; it must not be self-recorded in context.md.\n\n4. Records, both Info, never `err`/`err.Error()`.\n   - Skip: `slog.InfoContext(ctx, \"etf flag fill skipped\", \"symbol\", sym, \"reason\", reason[, \"used\", u, \"cap\", c only when snap][, \"trace_id\", tid])`.\n   - Fail: :126 Debug becomes `slog.InfoContext(ctx, \"etf flag fill failed\", \"symbol\", sym, \"class\", fmp.ErrorClass(err)[, \"trace_id\", tid])`.\n\n5. Classifier.\n   - Preferred: ask through a merge-order.md / 255 context.md note that 255 Step 5 export its classifier as `ErrorClass` directly.\n   - If 255 is frozen: a one-line `func ErrorClass(err error) string { return enrichmentClass(err) }` at the end of fmp_client.go.\n   - 230 adds no label of its own. If 255 merges with the stage-less token unresolved, the 230 step stops under C-11.\n\n6. Tests (service package, not parallel; slog.SetDefault is process-wide).\n   - Capture handler: rename recordingWarnHandler (marketdata_service_test.go:1549) to recordingLogHandler with an exact-level field. installWarnRecorder (:1589) becomes a wrapper over installLogRecorder(t, slog.LevelWarn). A test comment says exact-Info satisfies AC-3's \"Info or higher\".\n   - (a) Reason table. Covers not_wired with three sub-cases (nil src, nil fundCfg, nil fmpBudget, keeping the existing etf_flags_test.go:128 case), plus fmp_disabled, no_cap and budget. Each case asserts src.total()==0, that pending is cleared, that BudgetSnapshot is not taken for not_wired/fmp_disabled, and that used/cap appear only for no_cap/budget.\n   - (b) Fail class, using `errors.Is` sentinels only. `fmt.Errorf(\"fmp: /stable/profile?apikey=SECRET: %w\", context.DeadlineExceeded)` must give class==\"ctx\". The same wrapping of fmp.ErrFMPDailyCapExceeded (fmp_client.go:24) must give class==\"cap\". No record message or attribute may contain `apikey=` or `SECRET`.\n   - (d) Rate limit:\n     - N budget skips inside the window give 1 record; advancing *etfClock past etfFlagLogEvery gives a second;\n     - N fmp_disabled skips give 1 record even across windows;\n     - the reason-change sequence fmp_disabled -> budget -> fmp_disabled gives 3 records;\n     - skip and fail slots are independent;\n     - the fail-slot class-change behavior is asserted as pinned in step 2.\n   - (e) A trace test: GetEtfFlags with incoming PropagationData{TraceID:\"t-1\"}, drain, and the record carries trace_id=t-1.\n   - @AC-2 regression guard (`TDD: regression-guard`, P-06 waiver in context.md): one short test with no new helpers.\n     - Cap 250 with fakeBudget{used:200}: GetEtfFlags, drain, assert 0 fetches.\n     - Reassign svc.fmpBudget = fakeBudget{used:5,cap:250}. fakeBudget has a value receiver (marketdata_service_test.go:2037), so reassignment works.\n     - GetEtfFlags, drain (fetch), then GetEtfFlags returns is_etf==true.\n     - The test states that it overlaps with TestEtfFlagFiller_HeadroomGate_AC14 (:118-147) and TestGetEtfFlags_TTL (:151-166).\n   - Drop the fmp-package httptest test (c). 255 Step 12 (impl-spec :697-705) already covers http_500/transport/read/decode through a real Client, and FetchIsEtf reaches the same getJSON path (fmp_client.go:286-291,374-380).\n\n7. acceptance.feature and product-spec.\n   - Rewrite @AC-2 as \"an ETF skipped while the gate was closed is labelled on a later call once the gate reopens\".\n   - Delete the 210/5 seed Givens, which are owned by 255 @AC-3.\n   - The operator-mandated product-spec review amends the \"fails before 255\" sentence. It should also be asked whether to add an `etf flag fill unlabelled` Info record (symbol only, rate-limited, on the FetchIsEtf (nil,nil) path, with caching unchanged).\n\n8. Docs (marketdata CLAUDE.md, GetEtfFlags paragraph).\n   - Add one bullet for the fmp_disabled/no_cap/budget tokens, the class-only fail record and trace_id.\n   - Add etfFlagLogEvery to Fixed invariants.\n   - Do not document not_wired.\n   - The Scope step 3 staging check reads `marketdata.fmp.enabled` directly instead of relying on the single log-on-change line.",
    "open_objections": [
      {
        "text": "C-03 / operator rule 2026-10-21. The fill has an originating request. GetEtfFlags discards its ctx (etf_flags.go:62 `_ context.Context`). `enqueueLocked` admits exactly one enqueuer per symbol (:87-92), so that enqueuer is a single origin with a trace id available through middleware.FromContext, which the interceptor wires at cmd/server/main.go:179. Recording a 'no originating request' reading in context.md effectively waives C-03, and the operator said there is no waiver. To resolve, either carry the enqueuer's trace id on the queue item (`chan etfFillItem{sym, traceID}`; attach trace_id to both records; update the 15 test drain sites to `.sym`), or escalate the interpretation to the operator under C-11. The proposal has not answered this yet.",
        "blocking": true
      },
      {
        "text": "Dependency on 255. If 255 merges with its stage-less classifier token still an open operator question, the 230 ErrorClass step stops under C-11. 230's own assertions avoid that token by testing only ctx and cap. 255 must be merged, not just implementation-ready, and merge-order.md must record it as a hard predecessor.",
        "blocking": false
      },
      {
        "text": "C-18 DRY/YAGNI. Drop 230's fmp-package httptest test (c). It duplicates 255 Step 12 (impl-spec :697-705), because FetchIsEtf reaches the same getJSON path (fmp_client.go:286-291,374-380), and it adds churn to fmp_client_test.go, a merge hot spot with 254 and 255. The leak guarantee 230 owns lives in the service-level (b) test, which injects apikey=SECRET.",
        "blocking": false
      },
      {
        "text": "C-18. Prefer that 255 Step 5 export its classifier as `ErrorClass` directly, requested through a merge-order or 255 context.md note, rather than a one-line wrapper that gives one function two names. The wrapper is acceptable only if 255 is frozen.",
        "blocking": false
      },
      {
        "text": "Pin the rate-limit state machine in the spec:\n- `budget` updates lastSkipReason, so fmp_disabled -> budget -> fmp_disabled re-logs.\n- Choose a shared fail slot (class change inside the window suppressed) or per-class slots, and state which.\n- The gate (fundCfg.GetBool plus BudgetSnapshot, which takes fmp.Client.mu) runs outside etf.mu.\nTest (d) must assert the chosen semantics.",
        "blocking": false
      },
      {
        "text": "FR-2 purpose. FetchIsEtf returns (nil, nil) for an empty profile and for a missing or null isEtf (fmp_client.go:359,372-379). Either result is negative-cached for 30 days with no log, which is a live variant of hypothesis 3. Raise an optional rate-limited `etf flag fill unlabelled` Info record (symbol only, cache unchanged, @AC-14 untouched) at the operator-mandated product-spec review. Do not add it silently, because it goes beyond FR-2's 'skipped or failed'.",
        "blocking": false
      },
      {
        "text": "C-16 / 215 @AC-14. The reason table must assert behaviour as well as logs: src.total()==0 and the pending clear for every closed reason. It must keep all three not_wired sub-cases (nil src, nil fundCfg, nil fmpBudget), including the existing etf_flags_test.go:128 case.",
        "blocking": false
      },
      {
        "text": "P-06. The @AC-2 regression-guard waiver is accepted. The test must be one short test that reuses fakeEtfSource/newEtfSvc/the drain idiom with no new helpers, and it must note its overlap with TestEtfFlagFiller_HeadroomGate_AC14 (:118-147) and TestGetEtfFlags_TTL (:151-166).",
        "blocking": false
      },
      {
        "text": "The Scope step 3 staging verification must read staging's `marketdata.fmp.enabled` and `marketdata.fundamentals.provider` directly. An fmp_disabled gate, which 255 does not fix, emits only one log-on-change line per process and is easy to miss.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "230 @AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "230 @AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "230 @AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "215 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Treating the fill as 'no originating request' and recording it in context.md (proposal r2 section 6). Each fill has exactly one admitted enqueuer (etf_flags.go:87-92) whose trace id is available. Self-recording the reading is a de facto C-03 waiver the operator refused. Superseded by carrying the trace id on the queue item, unless the operator explicitly confirms the reading.",
      "Using the inbound request ctx for the fill (passing ctx through instead of just the trace id string). The request ctx is cancelled when the RPC returns, so the background fetch would die. Only the trace id is carried; the loop ctx keeps cancellation.",
      "An fmp-package httptest leak test in 230 (proposal r2 (c)). It duplicates 255 Step 12 over the same getJSON path and adds conflict risk in fmp_client_test.go.",
      "Service-level class assertions on stage-less synthetic errors. They depend on 255's unresolved fallback token. Replaced by errors.Is-resolvable ctx/cap sentinels.",
      "A single global log timestamp. A closed gate would mask the fetch-error class.",
      "A per-symbol rate-limit key. Memory grows with the symbol count, and it still floods.",
      "Two timestamps only, skip vs. fail (proposal r1). This hides reason changes and logs fmp_disabled forever in the default FMP-off state.",
      "Changing FetchIsEtf to return an exported class-bearing error type. It widens the fmp API and conflicts with 254 and 255.",
      "Logging err or err.Error(). FetchIsEtf errors can carry the apikey URL until 254 lands (D-39, operator 2026-10-22).",
      "Keeping 230's own seed-count fix. Dropped by operator decision 2026-10-22, because 255 owns it.",
      "Warn level. The label is best-effort, and analysis already warns on RPC failure (servicer.py:1970-1972).",
      "Only raising the existing Debug line to Info. A closed gate, the most likely live state, would stay silent."
    ],
    "open_risks": [
      "The root cause is still unconfirmed. If staging shows the gate open and a clean fetch, with SCHD still unlabelled, the cause is the (nil, nil) negative cache (empty profile or null isEtf), which logs nothing unless the optional 'unlabelled' record is approved. Fixing it would need operator sign-off on 215 @AC-14's 30-day clause. Only the post-deploy 215 Step 26(a) check catches this (ledger fails.md:2843, same unverified-cause pattern).",
      "Hard dependency on 255: its classifier token set, and the unresolved stage-less fallback token. A 255 slip blocks 230's ErrorClass step.",
      "Three-way conflict risk in fmp_client.go with 254 and 255. 254's *url.Error rewrap must still classify as transport; re-verify at the 254 merge.",
      "Widening the queue item touches 15 existing test drain sites, a mechanical but broad test diff.",
      "slog.SetDefault in tests is process-wide, so the ETF log tests must stay non-parallel or records leak between tests.",
      "class=ctx records during shutdown are accepted noise, at most one per minute.",
      "An fmp_disabled closed gate (the default config) is not fixed by 255 and logs once per process. Staging config must be checked directly."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-04",
      "F-07"
    ],
    "rationale": "I checked the code.\n- etf_flags.go:62 shows GetEtfFlags discarding its ctx (`_ context.Context`). The queue is `chan string` (:38,50). enqueueLocked admits exactly one enqueuer per symbol (:87-92). The propagation interceptor is wired at cmd/server/main.go:179, so middleware.FromContext(ctx).TraceID is available at enqueue time.\n- That confirms the adversary's new blocking point. The fill does have a single, well-defined origin. The proposer's 'no originating request' reading conflicts with the operator's binding 'no C-03 waiver; carry a trace id when available' rule, and the proposal has not answered it. It stays blocking. The cheap fix is carrying the trace id string, not the cancellable request ctx, and it is folded into the recommended approach.\n\nBoth round-1 blocking objections are concretely resolved.\n- The class seam: the service-level test uses only errors.Is-resolvable ctx/cap sentinels, so it no longer depends on 255's stage-less token. That dependency is reduced to a non-blocking C-11 stop condition.\n- Red-before-green: @AC-2 is now an explicit regression guard with a P-06 waiver. The seed Givens move to 255.\n\nThe adversary's non-blocking points are adopted into the best approach:\n- drop the duplicate fmp httptest test;\n- pin the rate-limit semantics and run the gate outside etf.mu;\n- keep all not_wired sub-cases for @AC-14;\n- read staging config directly.\n\nfakeBudget's value receiver (marketdata_service_test.go:2037) confirms that reassignment works for the @AC-2 test. FetchIsEtf's (nil, nil) path (fmp_client.go:372-379) confirms that the strongest risk is real. It goes to the operator at product-spec review rather than being added silently.\n\nThere is no Floor breach. etfFlagLogEvery is an FR-2-sanctioned code constant (F-07), and nothing touches proto, migrations, config keys or secrets. The operator decision sanctions the AC-1 drop and the AC-2 and AC-3 changes. 215 @AC-14 is preserved."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 3)

Full debate halted at the approval gate after round 3 (gate policy: halt). design.md is not written and status.md is
unchanged, per the grilling protocol. The resume state is in the `sdd-batch-design-state` block below; it supersedes
the round-2 block above.

## Open Threads

- **Approach (round 3).** Narrowed to @AC-2/@AC-3 by the operator, with 255 MERGED as a hard predecessor recorded in
  `merge-order.md`. No proto, migration or config change. Edits stay in `internal/service/etf_flags.go`, its tests,
  one exported classifier name in `internal/fmp/fmp_client.go` (added by 230 itself and listed in its step Files),
  `services/xstockstrat-marketdata/CLAUDE.md`, and this feature's product-spec.md and acceptance.feature.
  - Trace id (closes the round-2 C-03 blocker): queue becomes `chan etfFillItem{sym, traceID}` (`:38`, `:50`).
    `GetEtfFlags` (`:62`) names its ctx and reads `middleware.FromContext(ctx).TraceID` once, before the lock; the
    single admitted enqueuer (`:87-92`) is the origin. Only the string crosses over; the loop ctx keeps cancellation.
    `fillEtfFlag(ctx, item)` adds `trace_id` only when non-empty. Test churn: the four `<-svc.etf.queue` drains
    (`etf_flags_test.go:136,156,183,200`) compile unchanged; `:226` (`"NEW"`) becomes `etfFillItem{sym: "NEW"}`.
  - Gate: `etfFillAllowed() bool` becomes `etfFillGate() (reason, used, cap, snap)`, same order (`not_wired` →
    `fmp_disabled` → `BudgetSnapshot()` → `no_cap` → `budget`), run outside `etf.mu`; the skip path never calls
    `src` (215 @AC-14).
  - Rate limit on `etfFlagState` under `mu` (`lastSkipReason`, `budgetLoggedAt`, fail slot); config reasons log on
    change, `budget` on change or once per `etfFlagLogEvery = time.Minute`; decide under `mu`, emit after unlock.
    Fail slot still to pin: per-class map keyed by the returned class (recommended) or shared slot with the loss
    stated in AC-3.
  - Records, Info, never `err`/`err.Error()`: `etf flag fill skipped` (symbol, reason, used/cap only when snapped,
    trace_id) and `etf flag fill failed` (symbol, `class=fmp.ErrorClass(err)`, trace_id). `class` must never be empty.
  - Spec amendments: FR-2 gains the trace_id clause; @AC-2 rewritten as "skipped while gate closed → labelled once it
    reopens" (210/5 seed Givens and the "fails before 255's source-filtered seed" sentence removed); @AC-3 split into
    gate-reason, fetch-error-class (non-empty) and rate-limit scenarios.
  - Tests (non-parallel, generalised `recordingLogHandler`/`installLogRecorder`): one `not_wired` case plus
    fmp_disabled/no_cap/budget; ctx/cap class with an every-attribute `apikey=`/`SECRET` leak check; rate-limit
    sequences; trace_id routed through `middleware.UnaryServerInterceptor` (not bare `metadata.NewIncomingContext`);
    `src.total()` deltas everywhere; one @AC-2 regression guard reassigning `fakeBudget` (P-06 waiver to record).
  - (nil, nil) visibility (proposed FR-3/@AC-4 `unlabelled` record) is NOT in the approved approach unless the
    operator's steer is recorded verbatim here, or it is folded into AC-3 as one more reason. If adopted, the
    `defer s.etf.mu.Unlock()` at `:130-131` must become an explicit unlock before `slog`.
- **Strongest open objections (BLOCKING).**
  1. P-03/P-04/P-05: the FR-3/@AC-4 `unlabelled` record claims operator direction ("steer 2") that is recorded nowhere
     in the feature dir; context.md records only the AC-2+AC-3 narrowing. Record the steer verbatim or fold it into
     AC-3 before /sdd-spec.
  2. C-11/P-03: 255's `enrichmentClass` leaves stage-less errors (build-request, non-ctx limiter) unlabelled and its
     impl-spec (`:642-644`) forbids inventing a token, so `class=""` is reachable. The operator's fallback token must
     land in 255's Open Threads before 230's spec, and AC-3 must pin `class` as non-empty.
- **Non-blocking objections.** `:226` test edit (folded in); pin fail-slot semantics; interceptor-routed trace test;
  explicit unlock if anything logs at the cache write; 230 owns the `ErrorClass` export (C-18/F-08/F-09); one
  `not_wired` case (supersedes round 2's three); record the P-06 waiver and drop the contradictory product-spec
  sentence; 255 must be merged, and 254's `*url.Error` rewrap must still classify as transport.
- **Open risks.** Root cause unconfirmed ((nil, nil) 30-day negative cache would stay silent; only 215 Step 26(a)
  catches it, `fails.md:2843`); hard dependency on 255 and its fallback token; three-way `fmp_client.go` conflict
  with 254/255; process-wide `slog.SetDefault`; suppressed records drop their trace_id; shutdown `class=ctx` noise;
  default `fmp_disabled` gate logs once per process.
- **Floor status.** No Floor breaches. `etfFlagLogEvery` is an FR-2-sanctioned code constant (F-07); nothing touches
  proto, migrations, config keys or secrets.
- **@AC changes.**
  - Covered by the operator decision (2026-10-22): 230 @AC-1, @AC-2, @AC-3 (CHANGE).
  - Not covered: 230 @AC-4 (proposed FR-3 `unlabelled` record) is an uncovered EXTEND. 215 @AC-14 and 217 @AC-4 are
    PRESERVE only.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis for 230-fix-etf-flag-fill (SEV-3, Track C). The operator narrowed it to AC-2 and AC-3, and 255 must be MERGED as a hard predecessor that merge-order.md records. There is no proto, migration or config change. Edits are confined to services/xstockstrat-marketdata/internal/service/etf_flags.go, its tests, one exported classifier name in internal/fmp/fmp_client.go (added by 230 itself and listed in its step Files), marketdata CLAUDE.md, and this feature's product-spec.md and acceptance.feature.\n\n1. Trace id (closes the r2 C-03 blocker).\n   - Add `type etfFillItem struct{ sym, traceID string }`.\n   - The queue at etf_flags.go:38 and its make at :50 become `chan etfFillItem`.\n   - GetEtfFlags (:62) names its ctx and reads `middleware.FromContext(ctx).TraceID` once, before the lock.\n   - enqueueLocked (:83) sends `etfFillItem{sym, tid}`. Because of the pending dedup at :87-92, the admitted enqueuer is the single origin.\n   - StartEtfFlagFiller (:109-110) keeps the loop ctx for cancellation. Only the string crosses over; the request ctx never does.\n   - fillEtfFlag(ctx, item etfFillItem) adds \"trace_id\" to each record only when it is non-empty.\n   - Test churn, corrected and verified: the four drains at etf_flags_test.go:136,156,183,200 (`<-svc.etf.queue`) compile unchanged. etf_flags_test.go:226 `svc.fillEtfFlag(context.Background(), \"NEW\")` (TestEtfFlagFiller_EvictsOldestAtBound) must change to `etfFillItem{sym: \"NEW\"}`. That makes five call sites with one edit.\n\n2. Gate.\n   - `etfFillAllowed() bool` (:140-146) becomes `etfFillGate() (reason string, used, cap int, snap bool)`.\n   - The order is unchanged: not_wired, then fmp_disabled, then BudgetSnapshot(), then no_cap, then budget (atQuotaAlertThreshold, marketdata_service.go:1959). An empty reason means the gate is open.\n   - It runs OUTSIDE etf.mu, because BudgetSnapshot takes fmp.Client.mu.\n   - The skip path never calls src (215 @AC-14).\n\n3. Rate-limit state on etfFlagState (:33), guarded by mu.\n   - Fields: lastSkipReason, budgetLoggedAt, failLoggedAt.\n   - Config reasons log on change only. budget logs on change or once per etfFlagLogEvery. Every logged skip updates lastSkipReason, and an open gate clears it.\n   - The fail slot is a decision the spec must pin. Either a shared slot, accepting explicitly in the AC-3 rate-limit scenario that a class change inside the window is suppressed, or a small `map[string]time.Time` keyed by the returned class string. The map is bounded by the classifier's finite output and needs no coupling to 255's token list. Recommended: the per-class map, because diagnosis is the purpose; the shared slot is acceptable only if the AC text states the loss.\n   - Add `etfFlagLogEvery = time.Minute` to the :17-25 const block.\n   - Decide under mu with clock() (:53), release mu, then call slog.\n\n4. Records: Info level; err and err.Error() are never logged.\n   - Skip: \"etf flag fill skipped\" with symbol and reason, plus used/cap only when snap, plus trace_id.\n   - Fail: the :126 Debug call becomes \"etf flag fill failed\" with symbol, class=fmp.ErrorClass(err) and trace_id.\n   - The class must never be empty. 230 does not invent a fallback token: the operator-chosen token for stage-less errors (build-request, limiter) must be recorded before /sdd-spec, and AC-3 pins `class` as non-empty.\n\n5. (nil, nil) visibility (FetchIsEtf fmp_client.go:359,372-379). The r3 FR-3/@AC-4 'unlabelled' record has no recorded operator authority. Grep across the feature dir finds no 'unlabelled' or 'steer' entry, and context.md records the narrowing to AC-2+AC-3 only. It is NOT part of the approved approach unless one of two things happens before /sdd-spec:\n   - (a) the operator's steer is recorded verbatim in context.md; or\n   - (b) it is folded into AC-3 as an additional reason on the existing record path, keeping the AC count at two.\n   If (a) is chosen, the cache write at :130-135 currently holds mu via `defer s.etf.mu.Unlock()`. The spec must convert that to an explicit unlock after the entry write and slot decision, then emit outside the lock. Caching is unchanged either way (30-day negative cache, 215 @AC-14).\n\n6. Spec amendments in this feature.\n   - FR-2 gains 'carries the originating request's trace_id when present'.\n   - @AC-2 is rewritten as 'skipped while the gate was closed → labelled on a later call once the gate reopens'. Delete the 210/5 seed Givens (owned by 255 @AC-3) and the product-spec sentence '@AC-2 … fails before 255's source-filtered seed'.\n   - @AC-3 is split into concrete-count scenarios: gate-closed reasons, fetch-error class (non-empty), and rate-limit.\n\n7. Tests. They live in the service package and run non-parallel, because slog.SetDefault is process-wide.\n   - Capture handler: generalise recordingWarnHandler/installWarnRecorder (marketdata_service_test.go:1549,1589) into recordingLogHandler/installLogRecorder with an exact-level field. installWarnRecorder becomes a wrapper.\n   - (a) Reason table: one not_wired case, the existing :128 'no budget wired' case, which is enough because SetEtfFlagSource sets src and queue together (:44-51). Plus fmp_disabled, no_cap and budget. Each case asserts src.total()==0, pending cleared, and used/cap present only for no_cap/budget.\n   - (b) Fail class: an apikey=SECRET-wrapped context.DeadlineExceeded gives class ctx, and the same wrapping of fmp.ErrFMPDailyCapExceeded gives class cap. Assert on EVERY attribute value plus msg: none may contain 'apikey=' or 'SECRET' (fails.md:3050).\n   - (d) Rate limit, with the semantics as pinned in step 3:\n     - N budget skips give 1 record; stepping *etfClock past the window gives a second;\n     - N fmp_disabled skips give 1 record across windows;\n     - fmp_disabled → budget → fmp_disabled gives 3 records;\n     - skip and fail slots are independent;\n     - fail-class behaviour matches the pinned choice.\n   - (e) Trace: route the call through middleware.UnaryServerInterceptor, as propagation_test.go:75-82 does. Do NOT use a bare metadata.NewIncomingContext, because FromContext reads unexported propKey{} (propagation.go:10,21) and would see an empty id. Assert trace_id=t-1, and assert that a no-trace call carries no trace_id attribute.\n   - Every logging test asserts a src.total() delta, so logging never adds fetches.\n   - @AC-2 regression guard, one short test reusing fakeEtfSource/newEtfSvc/fakeBudget:\n     - fakeBudget{used:200,cap:250} gives 0 fetches;\n     - reassign to {used:5,cap:250}, which works because of the value receiver (:2037);\n     - drain, then is_etf==true;\n     - record the P-06 waiver (the test passes on trunk) in context.md.\n\n8. Docs: marketdata CLAUDE.md, GetEtfFlags paragraph.\n   - Add one bullet covering the fmp_disabled/no_cap/budget tokens (not_wired undocumented), the class-only fail record and trace_id.\n   - Add etfFlagLogEvery to Fixed invariants.\n   - The Scope step 3 staging check reads marketdata.fmp.enabled and marketdata.fundamentals.provider directly.",
    "open_objections": [
      {
        "text": "P-03/P-04/P-05 scope. The proposed FR-3/@AC-4 'etf flag fill unlabelled' record claims operator direction ('steer 2'), but that direction is not recorded anywhere in the feature dir: grep for 'unlabelled'/'steer' returns nothing, and context.md records only the AC-2+AC-3 narrowing. Before /sdd-spec, either record the operator's steer verbatim in context.md or fold the (nil, nil) visibility into AC-3's existing record path as one more reason. Carrying FR-3 unrecorded is a silent scope change.",
        "blocking": true
      },
      {
        "text": "C-11/P-03 empty class token. 255's enrichmentClass leaves stage-less errors (build-request, non-ctx limiter) unlabelled, and 255's impl-spec :642-644 forbids inventing a token. FetchIsEtf can return those errors in production, so class=\"\" can occur. Testing only ctx/cap hides this. Get the operator's fallback token (e.g. 'other') into 255's Open Threads before 230's spec, and pin in AC-3 that class is never empty.",
        "blocking": true
      },
      {
        "text": "Test-compile correction (now folded into the approach). The r3 'zero churn, four sites' claim was false: etf_flags_test.go:226 passes the string literal \"NEW\" to fillEtfFlag and must become etfFillItem{sym: \"NEW\"}. The spec must list this edit and correct the Key Decision citation. It is resolved on paper and must be carried into the impl-spec.",
        "blocking": false
      },
      {
        "text": "Fail-slot semantics are still unpinned. A shared slot hides a ctx→cap→http_403 sequence inside one window. Choose one of two and state it in AC-3: a per-class map keyed by the returned string (recommended), or the shared slot with the loss explicitly accepted. Test (d) must assert the chosen behaviour.",
        "blocking": false
      },
      {
        "text": "Test (e) realism. middleware.FromContext reads unexported propKey{}, which only UnaryServerInterceptor sets (propagation.go:10,21,27-35). The spec must require routing the call through the interceptor, as propagation_test.go:75-82 does. A bare metadata.NewIncomingContext yields an empty TraceID.",
        "blocking": false
      },
      {
        "text": "Lock ordering at the cache write. fillEtfFlag holds mu through `defer s.etf.mu.Unlock()` (etf_flags.go:130-131). If any record is emitted from this point (only an approved unlabelled record would do so), the spec must convert the defer to an explicit unlock before slog. It must not log while holding mu.",
        "blocking": false
      },
      {
        "text": "C-18 coupling. 230 should add the ErrorClass export to fmp_client.go itself, after 255 merges, by renaming the function or adding one exported name, with fmp_client.go listed in its step Files (F-08). It should not ask 255 to change its spec. This avoids pushing a 230 need into a peer feature, and avoids an F-09 issue if 255 starts executing first.",
        "blocking": false
      },
      {
        "text": "C-18 YAGNI. Drop the three not_wired sub-cases. SetEtfFlagSource sets src and queue together (:44-51), and the filler returns on a nil queue (:102). Keep one not_wired case, the existing :128 one. This supersedes the r2 synthesis requirement to keep all three.",
        "blocking": false
      },
      {
        "text": "P-06. Record the @AC-2 regression-guard waiver (the test passes on trunk) in context.md. Remove the product-spec sentence '@AC-2 … fails before 255's source-filtered seed', which contradicts the rewritten scenario.",
        "blocking": false
      },
      {
        "text": "Dependency on 255. It must be merged, not just implementation-ready, and merge-order.md must record it as a hard predecessor. 254's *url.Error rewrap must still classify as transport; re-verify at the 254 merge.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "230 @AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "230 @AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "230 @AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "230 @AC-4 (proposed FR-3 unlabelled record)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "215 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "217 @AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Treating the fill as having 'no originating request' and logging without a trace_id (r2 reading). The admitted enqueuer (etf_flags.go:87-92) is a single origin whose trace is available. Self-recording that reading would be a de facto C-03 waiver, and the operator refused one. Carrying the trace-id string is cheap.",
      "Passing the inbound request ctx to the fill. It is cancelled when the RPC returns and would kill the background fetch. Only the trace-id string is carried.",
      "Adding FR-3/@AC-4 'unlabelled' with no recorded operator steer (r3 as written). It is a silent scope change beyond the 2026-10-22 narrowing. It is held unless the steer is recorded, or the case is folded into AC-3.",
      "Asking 255 to rename and export enrichmentClass as ErrorClass. It pushes a 230 need into a peer spec and risks F-09. 230 adds the export itself after 255 merges.",
      "Driving test (e) with metadata.NewIncomingContext alone. FromContext reads the unexported propKey that only the interceptor sets, so TraceID would be empty.",
      "Three not_wired sub-cases. Production can reach not_wired only through nil fundCfg/fmpBudget, and the token is undocumented. One case is enough.",
      "An fmp-package httptest leak test. It duplicates 255 Step 12 over the same getJSON path and is a merge hot spot.",
      "Service-level class assertions on stage-less synthetic errors. They depend on 255's unresolved fallback token.",
      "A single global log timestamp. A budget flood would mask fail records and config-reason changes.",
      "A per-symbol rate-limit key. Memory grows with the symbol count, and logs still flood.",
      "Changing FetchIsEtf to return an exported class-bearing error type. It widens the fmp API and conflicts with 254/255.",
      "Logging err or err.Error(). It can carry the apikey URL until 254 lands (D-39, fails.md:3050).",
      "Keeping 230's own seed-count fix. The operator dropped it on 2026-10-22; 255 owns it.",
      "Warn level. The label is best-effort, and analysis already warns on RPC failure.",
      "Only raising the existing Debug line to Info. A closed gate, the likeliest live state, would stay silent."
    ],
    "open_risks": [
      "Root cause unconfirmed. If staging shows an open gate and clean fetches while SCHD stays UNSPECIFIED, the cause is the (nil, nil) 30-day negative cache. Without an approved unlabelled record or an AC-3 reason, it logs nothing. Fixing it would need operator sign-off to change 215 @AC-14's 30-day clause. Only the post-deploy 215 Step 26(a) check catches this (fails.md:2843).",
      "Hard dependency on 255: its merge, its classifier token set and the unresolved stage-less fallback token. A 255 slip blocks 230's classifier step under C-11.",
      "Three-way conflict risk in fmp_client.go with 254/255. 254's *url.Error rewrap must still classify as transport.",
      "slog.SetDefault is process-wide. The ETF log tests must stay non-parallel or records leak between tests.",
      "A suppressed record drops its fill's trace_id; only the logged record's trace survives.",
      "class=ctx records during shutdown are accepted noise, at most one per window.",
      "An fmp_disabled closed gate (the default config) is not fixed by 255 and logs once per process. Staging config must be read directly."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-04",
      "P-05",
      "P-06",
      "F-04",
      "F-07",
      "F-08",
      "F-09"
    ],
    "rationale": "I re-read the code.\n- etf_flags_test.go:226 calls `svc.fillEtfFlag(context.Background(), \"NEW\")` with a string literal. This confirms the adversary: the r3 'zero churn' claim is false. The fix is a one-line edit, now folded into the approach. The four `<-svc.etf.queue` drains (:136,156,183,200) do compile unchanged.\n- propagation.go:10,21,27-35 confirms that FromContext reads an unexported propKey{} set only by UnaryServerInterceptor. Test (e) must route through the interceptor.\n- etf_flags.go:130-131 confirms the cache write holds mu through a defer. Any emit at that point needs an explicit unlock.\n- A grep of the feature dir for 'unlabelled'/'steer' found nothing. The claimed operator direction for FR-3/@AC-4 is unrecorded, so that objection stays blocking under P-03/P-05. The binding 2026-10-22 decision narrows 230 to AC-2+AC-3.\n\nThe r2 blocking C-03 objection is concretely resolved. The trace-id string is carried on the queue item, the loop ctx keeps cancellation, and the operator's 'carry a trace when available' rule is met.\n\nThe empty-class risk is not answered: 'tests use only ctx/cap' avoids it rather than resolving it. It stays blocking until the operator picks the fallback token and AC-3 pins class as non-empty.\n\nNon-blocking refinements are adopted: 230 owns the export, one not_wired case, an every-attribute leak check, src.total() deltas, the P-06 waiver recorded, and the contradictory product-spec sentence removed. The fail-slot choice remains a pin-it item.\n\nThere is no Floor breach. etfFlagLogEvery is an FR-2-sanctioned code constant (F-07), and nothing touches proto, migrations, config keys or secrets. The operator decision covers the AC-1/2/3 changes. The proposed @AC-4 is an uncovered EXTEND. 215 @AC-14 and 217 @AC-4 are preserved."
  },
  "floor_breaches": []
}
```
