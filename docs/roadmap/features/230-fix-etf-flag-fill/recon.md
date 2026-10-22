# Recon: fix-etf-flag-fill

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata (fix site), xstockstrat-analysis (consumer, unchanged)

---

## Objective

The background ETF-flag filler in marketdata never labels an ETF (SCHD stays `FUNDAMENTALS_GAP_UNSPECIFIED`), and at
Info level nothing shows why. Per the operator decision of 2026-10-22, the root cause (the over-counted FMP boot seed)
is fixed by `255-fix-marketdata-fundamentals-cache` (D-51). 230 lands after 255 and keeps only two things:
- **FR-1 / `@AC-2`:** an ETF missed once is labelled on a later call once budget allows.
- **FR-2 / `@AC-3`:** a skipped or failed fill emits a rate-limited log record at Info level or higher. The record
  carries the error class only, never the raw error text.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point and wiring: `services/xstockstrat-marketdata/cmd/server/main.go`.
    - Process logger is `slog.NewJSONHandler(os.Stdout, nil)` at `:35`. That is Info level, so a Debug record is invisible.
    - Boot seed at `:129-130` (`fmpClient.SeedBudget(n)` from `repo.CountFundamentalsFetchedToday`). **255 owns it.**
    - `svc.SetClassification(..., fmpClient, fmpClient)` sets `s.fmpBudget`. `svc.SetEtfFlagSource(fmpClient)` and
      `go svc.StartEtfFlagFiller(ctx)` follow a few lines later (`main.go:152`, `:153`, `:162`).
  - Fix site: `internal/service/etf_flags.go`.
    - Constants `etfFlagTTL`, `etfFlagCacheMax` and `etfFlagQueueCap` at `:17-25`.
    - `type etfFlagState` at `:33`, with fields `src`, `mu`, `entries`, `pending`, `queue` and an injectable
      `now func() time.Time`.
    - `GetEtfFlags` at `:62`. It is cache-only, ignores its ctx (`_ context.Context`) and enqueues on a miss.
    - `enqueueLocked` at `:83`. The queue carries only the symbol string.
    - `StartEtfFlagFiller` at `:98`. It drains the queue with the loop ctx from `main.go`.
    - `fillEtfFlag` starts at `:115`. Its `defer` clears `pending`.
      - **Gap 1:** `:121` `if !s.etfFillAllowed() { return }` is a silent skip.
      - **Gap 2:** `:126` `slog.DebugContext(ctx, "etf flag fill failed", "symbol", sym, "error", err)` logs at
        Debug only, and logs the raw `err`.
    - `etfFillAllowed` at `:140-146` returns a bare `bool`. It is false when any of these holds: nil `src`, nil
      `fundCfg`, `marketdata.fmp.enabled` false, nil `fmpBudget`, `cap <= 0`, or
      `atQuotaAlertThreshold(used, cap)`. The used/cap values are not returned to the caller.
  - Threshold helper: `atQuotaAlertThreshold` at `internal/service/marketdata_service.go:1959`
    (`cap > 0 && count >= (cap*8)/10`).
  - Budget seam: the `fmpBudget` interface at `internal/service/classification_service.go:36`, and
    `(*fmp.Client).BudgetSnapshot() (used, dailyCap int)` at `internal/fmp/fmp_client.go:98`
    (`SeedBudget` is at `:88`).
  - FMP error shapes (`internal/fmp/fmp_client.go`):
    - `:222` sets `apikey`.
    - `:243` `"fmp: %s request failed: %w"`. This `%w`-wraps a `*url.Error` whose text carries the full URL,
      including `apikey=`.
    - `:251` `"fmp: read %s body: %w"`.
    - `:255` `"fmp: %s returned HTTP %d"`. It carries no URL (comment at `:254`).
    - `:258` `"fmp: decode %s: %w"`.
    - `FetchIsEtf` at `:374` goes through `fetchProfile` → `getJSON`, so it shares the limiter, the day budget and
      every one of those error shapes. On trunk the errors are untyped.
  - Last migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`). 230 needs none.
  - Config-read pattern: `s.fundCfg.GetBool("marketdata.fmp.enabled", false)` (`etf_flags.go:141`). 230 adds no key.
  - Docs touchpoint: `services/xstockstrat-marketdata/CLAUDE.md:165`, the `GetEtfFlags (feature 215, FR-11)`
    paragraph. Its "Fixed invariants (not config keys)" list is at `:174`, and the new rate-limit window constant
    belongs there.
- **`xstockstrat-analysis`** (Python) is a consumer only, and no change is needed.
  - `_fundamentals_gap_labels` calls `GetEtfFlags` with `metadata=propagation_meta`
    (`services/xstockstrat-analysis/app/handlers/servicer.py:1962`).
  - It maps an unset `is_etf` → `UNSPECIFIED`, true → `ETF`, false → `NOT_ETF` (`:1975-1981`). On error it logs a WARN
    and returns `{}` (`:1970-1972`).
  - The backtest writes `diag.fundamentals_gap` (`:1246-1248`). Opportunity skip rows use
    `_label_fundamentals_skip_rows` (`:1984-1993`), and the value is read back at `:6739`.
  - The proto contract is unchanged: `EtfFlag.optional bool is_etf = 2` (`packages/proto/marketdata/v1/marketdata.proto:396-407`;
    RPC declared at `:72`). Documented behaviour is in `services/xstockstrat-analysis/CLAUDE.md:400-401`.
  - Last migration: `027_contract_owner_dimension.up.sql`. None is needed.

## Patterns to REUSE

- **Error class without raw text:** reuse 255's classifier. Do not write a second one.
  - 255's implementation-spec (Step 5, `docs/roadmap/features/255-fix-marketdata-fundamentals-cache/implementation-spec.md:618-650`)
    adds these to package `fmp`:
    - an unexported `statusError{path, code}` at `:255`;
    - an unexported `stageError{stage, err}` wrapping `:243`/`:251`/`:258`;
    - an unexported `enrichmentClass(err) string` that returns `cap` / `ctx` / `http_<code>` / `transport` / `read` /
      `decode`, using `errors.Is`/`errors.As` only.
  - 255 lands first, so 230 can classify `FetchIsEtf` errors with the same taxonomy (C-18 DRY).
  - **Seam question for design:** the helper is unexported in `fmp`, and the caller is in `internal/service`. The
    options are:
    - (a) export it from `fmp`, as a one-line rename or an exported wrapper in a 255-owned file, after 255 merges;
    - (b) classify inside `FetchIsEtf` and return a class-bearing error.
  - Do not use string-prefix matching. 255 pins "never string matching".
- **Gate numbers for the skip record:** reuse `s.fmpBudget.BudgetSnapshot()` (`fmp_client.go:98`) and
  `atQuotaAlertThreshold` (`marketdata_service.go:1959`).
  - Either reshape `etfFillAllowed` (`etf_flags.go:140`) to return the reason plus used/cap, or call the snapshot
    again on the skip path.
  - The skip path must stay non-fetching (`@AC-14`).
- **Rate-limit clock:** reuse the injectable `etfFlagState.now` / `clock()` (`etf_flags.go:33`, `:53`). The tests
  already drive it via `newEtfSvc` → `*etfClock` (`etf_flags_test.go:51`).
  - Rate-limit state belongs under `s.etf.mu` or a sibling field. No new package is needed: grep found no existing
    log rate-limit helper in marketdata `internal/`. The only `rateLimit` hits are the vendor request limiters.
- **Window constant:** add it beside `etfFlagTTL`/`etfFlagCacheMax`/`etfFlagQueueCap` (`etf_flags.go:17-25`) and
  document it under CLAUDE.md "Fixed invariants" (`:174`). It is not a config key (FR-2, F-07).
- **Log capture in tests:** reuse `recordingWarnHandler` (`internal/service/marketdata_service_test.go:1547-1593`). It
  installs itself via `slog.SetDefault`, which is process-global, so a test that uses it must not call `t.Parallel()`.
  The ETF tests currently have no `t.Parallel()`.
  - **Caveat:** `Handle` keeps only `r.Level == slog.LevelWarn`. If design picks Info, it needs a level-aware sibling
    or a generalisation of this handler. Do not copy it (DRY).
  - `countingWarnHandler` (`:804`, used at `:969`) is the other existing capture.
- **ETF test harness:** reuse these in `internal/service/etf_flags_test.go`:
  - `fakeEtfSource` (`:15`, with `calls`, `resp`, `err`), `newEtfSvc(src, budget, fmpOn)` (`:51`) and
    `etfFlags(t, svc, …)` (`:62`);
  - the gate-case table in `TestEtfFlagFiller_HeadroomGate_AC14` (`:118`), which calls
    `svc.fillEtfFlag(ctx, <-svc.etf.queue)`;
  - `TestEtfFlagFiller_ErrorNotCached` (`:196`);
  - `fakeBudget{used, cap}` (`marketdata_service_test.go:2035`) and `fakeCfg` (`:250`).
- **AC-2 seed seam:** reuse 255's `seedFMPBudget(ctx, counter, client)` (255 design.md:67; implementation-spec.md:390,
  `TestSeedFMPBudget_CountsOnlyFMPRows_AC3` in `cmd/server/main_test.go`).
  - `newEtfSvc` bypasses the boot seed, so an AC-2 test that honours "210 non-FMP + 5 FMP rows" must seed a real
  `fmp.Client` through that seam, or construct the budget as 255's seed would leave it.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-14 @FR-11 @feature-215` "The ETF label never spends the guard's FMP headroom" (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`).
  - At or above 80% of `marketdata.fmp.daily_request_cap`, `GetEtfFlags` returns unset, makes no FMP call, and the
    filler does not fetch. Cached flags last 30 days.
  - This is the fix site. 230's gate-closed logging must not change the gate. It is backed by `etf_flags_test.go`,
    whose tests must stay green.
- **PRESERVE** `@AC-7 @FR-7 @feature-215` "Marketdata reports fundamentals absence distinctly from outage and disable" (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`). The NotFound vs FailedPrecondition semantics for SCHD and the disable flags are untouched.
- **PRESERVE** `@AC-4` "Failed FMP calls refund the shared daily budget" (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`, `@feature-217`). Filler fetch failures must keep refunding the shared FMP budget. 230 does not touch the seed or the quota (255 owns them).
- **PRESERVE** `@AC-4` "An FMP outage does not break classification reads" (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`, `@feature-217`). A filler fetch failure stays non-fatal.
- **PRESERVE** `@AC-1` "FMP gateway never exceeds the configured rate limit under concurrency" (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`, `@feature-217`). Filler fetches stay on the single throttled gateway.
- **PRESERVE** `@AC-2 @FR-2 @feature-215` "A fundamentals-gated backtest on an ETF returns an explicit reason, not a silent no-trade" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). The refusal reason is unchanged. Only the `fundamentals_gap` label moves from UNSPECIFIED to ETF, and analysis consumes `GetEtfFlags` unchanged.
- **PRESERVE** `@AC-5 @FR-6 @feature-215` "The refusal is auditable" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). The analysis WARN log and the result-borne reason stay.
- **PRESERVE** `@AC-8 @FR-8 @feature-215` "A fundamentals outage is not reported as absence" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). A `GetEtfFlags` error leaves the label UNSPECIFIED.
- **PRESERVE** `@AC-3 @FR-5 @feature-215` "Non-ETF equities and non-fundamentals strategies are unaffected" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). Labelling must not alter AAPL or technical strategies.
- **PRESERVE** `@AC-2 @FR-1 @feature-185` "An evaluated-but-not-passing symbol is NOT marked unavailable" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`). The opportunity skip-row classification is unchanged; only the label value changes.
- No EXTEND or CHANGE rules found. 230's `@AC-2` and `@AC-3` are new cases alongside `@AC-14`, not alterations of it.
- **Would-be CHANGE (out of scope):** widening or shortening the 30-day negative cache for an empty profile
  (hypothesis 3) alters `@AC-14`'s "served for 30 days without re-fetch" clause. That needs explicit operator sign-off
  in `context.md`.
- **C-16 blind spot:** `services/xstockstrat-ui/acceptance/block-fundamentals-strategy-on-etf.feature` and
  `fix-trader-position-fundamentals.feature` are consumer-surface suites for `fundamentals_gap`. They were not read.
  The product-spec states there is no UI text change, so both are presumed PRESERVE, and design should confirm.

## Dependencies

- Proto/RPC: none. `GetEtfFlags` / `EtfFlag.is_etf = 2` are unchanged (`marketdata.proto:396-407`).
- Migration: none. If one were ever needed, the next free numbers are marketdata `010` and analysis `028`.
- Config keys: none. The rate-limit window is a code constant (FR-2). `marketdata.fmp.enabled` and
  `marketdata.fmp.daily_request_cap` are read unchanged.
- Inter-service edges: none new. analysis → marketdata `GetEtfFlags` (gRPC) is unchanged.
- New env vars / ports: none.
- **Feature ordering:**
  - **Hard predecessor `255-fix-marketdata-fundamentals-cache`** (`implementation-ready`, not executed). It provides
    the source-filtered seed, `seedFMPBudget` and `enrichmentClass`. `@AC-2` fails before 255 and passes after it.
  - Predecessor **215** (in-progress) owns `etf_flags.go` and `etf_flags_test.go` (Step 9).
  - **254** is a soft overlap: it rewraps `*url.Error` in `fmp_client.go`. Until 254 lands, raw `FetchIsEtf` errors
    can contain `apikey=`.

## Risks / Not-found

- **Root cause still unconfirmed** from staging logs. No log access was available in triage, re-verification or this
  recon. The code-level hypotheses all still hold:
  - Hypothesis 1 (seed over-count) is plausible via `marketdata_service.go:1864` ("edgar snapshot not producible —
    falling back to vendor").
  - Hypothesis 3 (empty profile negative-cached, `TestGetEtfFlags_EmptyProfileNegativeCached` `etf_flags_test.go:179`)
    is neither confirmed nor refuted.
  - FR-2's logging is what makes it confirmable after deploy.
- **Rate-limit key unresolved.** The options are per symbol, per reason or global; the spec review carried this to
  design. It must be fixed before `@AC-3` can be split into concrete gate-closed, fetch-error and rate-limit scenarios
  with a count, for example "5 skips of SCHD in 60s → exactly 1 record".
- **Log level vs existing capture.** `recordingWarnHandler` keeps WARN only, so the choice between Info and Warn
  decides whether that helper must be generalised.
- **255 classifier visibility.** `enrichmentClass` is unexported in `fmp`. 230 must pick a seam. Classes for errors
  that have no stage (the `:226` build-request error and a non-ctx limiter error at `:229`) are an open operator
  question in 255, so 230 must not invent a label silently.
- **Gate-closed reasons are not all budget.** `etfFillAllowed` is also false when FMP is disabled, a source or budget
  is nil, or `cap == 0`.
  - With FMP disabled, every miss would log "gate closed".
  - Design must decide whether those reasons are logged, under which reason token, and whether `used/cap` applies.
- **Trace-id rule (operator 2026-10-21).** `fillEtfFlag` runs on the background loop ctx (`main.go:162`), with no
  originating request, so minting its own ctx is allowed.
  - The rule still asks for a trace id "when one is available".
  - `GetEtfFlags` discards its request ctx (`etf_flags.go:62`), and the queue carries only the symbol (`:83`).
  - Carrying the enqueuing request's `x-trace-id` into the fill log means widening the queue item. Design must decide
    this and record it, not skip it silently.
- **Raw-error trap** (ledger `fails.md` 2026-10-22 fix-marketdata-secret-exposure, D-39). A `%w`-wrapped
  `*url.Error` carries `apikey=`. The AC-3 test must drive a `FetchIsEtf` error whose text contains `apikey=`, and
  assert that neither that string nor the raw text appears in any captured record.
- **Analysis-side raw log (noted, out of scope).** `servicer.py:1971` logs `GetEtfFlags` failures with the raw `e`,
  unthrottled. That is a gRPC error from marketdata, not the FMP URL, so FR-2 does not apply.
- **Merge conflicts.** `etf_flags.go`/`etf_flags_test.go` overlap with 215 Step 9, and `fmp_client.go` overlaps with
  254/255 if the classifier is exported. Record merge-order rows at /sdd-spec.
- **Not found:**
  - no log rate-limit helper and no typed FMP errors on trunk;
  - no slog capture in `etf_flags_test.go`;
  - no other `slog` call in the filler besides `:126`.

## Recommended Scope

Advisory only:
1. **Fill visibility (FR-2 / `@AC-3`).** In `etf_flags.go`:
   - make the gate return a reason, plus used/cap when budget-gated;
   - log the gate-closed skip and the fetch failure at the chosen level, with the class from 255's classifier and
     never `err`;
   - rate-limit both through one window constant on `etfFlagState`, keyed per the design decision, using the
     injectable clock;
   - update the marketdata CLAUDE.md `GetEtfFlags` paragraph and the Fixed-invariants list.

   Tests, using a non-parallel slog capture:
   - a gate-closed record with used/cap;
   - a fetch-error record that carries the class and contains no `apikey=`;
   - N repeats within the window produce one record, and a record appears again after the window.

   All existing `@AC-14` tests must stay green.
2. **Label after budget allows (FR-1 / `@AC-2`).** Add a service-level regression test:
   - seed a real `fmp.Client` via 255's `seedFMPBudget` with 210 non-FMP rows and 5 FMP rows (cap 250);
   - miss SCHD, drain the queue, call again, and expect `is_etf == true`.

   No production code should be needed beyond 255. If the test fails after 255, that falsifies hypothesis 1 and must
   go back to the operator.
3. **Staging confirmation.** After deploy, re-run feature 215 Step 26(a) on dev and read the new marketdata log lines
   to confirm the cause (spec Open Question 3).
