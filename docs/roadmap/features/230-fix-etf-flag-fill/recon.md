# Recon: fix-etf-flag-fill

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata (fix site), xstockstrat-analysis (consumer, unchanged)

---

## Objective

The marketdata background ETF-flag filler never labels an ETF: SCHD stays `FUNDAMENTALS_GAP_UNSPECIFIED`, and
nothing logged at Info level explains why. The operator decided on 2026-10-22 that the root cause, the over-counted
FMP boot seed, is fixed by `255-fix-marketdata-fundamentals-cache` (D-51). 230 lands after 255 and keeps only two
requirements:
- **FR-1 / `@AC-2`:** an ETF that missed once is labelled on a later call once the budget allows.
- **FR-2 / `@AC-3`:** a skipped or failed fill produces a rate-limited log record at Info level or higher. The record
  carries the error class only, never the raw error text.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `services/xstockstrat-marketdata/cmd/server/main.go`.
    - `:35` creates the process logger with `slog.NewJSONHandler(os.Stdout, nil)`, which runs at Info level, so the
      filler's Debug record never appears.
    - `:126` creates `fmpClient := newFMPClient(...)`.
    - `:129-130` runs the boot seed, `repo.CountFundamentalsFetchedToday(ctx)` → `fmpClient.SeedBudget(n)`.
      **255 owns this; 230 does not touch it.**
    - `:152` calls `svc.SetClassification(..., fmpClient, fmpClient)`, which sets `s.fmpBudget`.
    - `:153` calls `svc.SetEtfFlagSource(fmpClient)`.
    - `:162` runs `go svc.StartEtfFlagFiller(ctx)`.
  - Fix site: `internal/service/etf_flags.go`.
    - `:17-25` is the constant block (`etfFlagTTL`, `etfFlagCacheMax`, `etfFlagQueueCap`).
    - `:33` declares `type etfFlagState`, with fields `src`, `mu`, `entries`, `pending`, `queue` and an injectable
      `now func() time.Time`. `clock()` is at `:53`.
    - `:62` defines `GetEtfFlags`. It is cache-only, discards its ctx, and enqueues on a miss.
    - `:83` defines `enqueueLocked`. A queue item is the bare symbol string.
    - `:98` defines `StartEtfFlagFiller`. It drains the queue on the loop ctx from `main.go:162`.
    - `fillEtfFlag` starts at `:115`. Its `defer` clears `pending`. It has two gaps:
      - **Gap 1:** `:121-123` `if !s.etfFillAllowed() { return }` skips silently.
      - **Gap 2:** `:126` `slog.DebugContext(ctx, "etf flag fill failed", "symbol", sym, "error", err)` logs at Debug
        only, and it logs the raw `err`.
    - `:135` writes the cache entry, `entries[sym] = etfFlagEntry{isEtf, fetchedAt}`. This is the write that the
      AC-2 second call reads.
    - `:140-146` defines `etfFillAllowed() bool`, which returns a bare bool. It returns false in any of these cases:
      - `src` is nil;
      - `fundCfg` is nil;
      - `marketdata.fmp.enabled` is false;
      - `fmpBudget` is nil;
      - `cap <= 0`;
      - `atQuotaAlertThreshold(used, cap)` is true.

      Only the last case has meaningful used/cap values, and the function does not expose them.
  - Threshold helper: `atQuotaAlertThreshold` at `internal/service/marketdata_service.go:1959`, defined as
    `cap > 0 && count >= (cap*8)/10`.
  - Budget seam:
    - The `fmpBudget` interface is at `internal/service/classification_service.go:36` and declares
      `BudgetSnapshot() (used, dailyCap int)`.
    - The real implementation is `(*fmp.Client).BudgetSnapshot` at `internal/fmp/fmp_client.go:98`. `SeedBudget` is
      at `:88`.
  - FMP error shapes in `internal/fmp/fmp_client.go` (read-only for 230). All of them are untyped on trunk.
    - `:222` adds the key to the query with `params.Set("apikey", c.apiKey)`.
    - `:243` returns `fmt.Errorf("fmp: %s request failed: %w", path, err)`. It `%w`-wraps a `*url.Error` whose text
      includes the full URL, `apikey=` included. **This is the leak path.**
    - `:255` returns `"fmp: %s returned HTTP %d"`. It carries no URL (see the comment at `:254`).
    - `:258` returns `"fmp: decode %s: %w"`.
    - `FetchIsEtf` is at `:374` and goes through `fetchProfile` → `getJSON`. It therefore shares the limiter, the day
      budget and every error shape listed here.
  - Last migration: `009_symbol_classification.up.sql` in `services/xstockstrat-marketdata/migrations/`. 230 needs
    no migration.
  - Config-read pattern: `s.fundCfg.GetBool("marketdata.fmp.enabled", false)` (`etf_flags.go:141`). 230 adds no
    config key.
  - Docs touchpoint: `services/xstockstrat-marketdata/CLAUDE.md`, the `GetEtfFlags` (feature 215, FR-11) paragraph.
    Its "Fixed invariants (not config keys)" list at `:174` is where the new window constant belongs.
- **`xstockstrat-analysis`** (Python): consumer only, no change.
  - `_fundamentals_gap_labels` (`services/xstockstrat-analysis/app/handlers/servicer.py:1962`) calls `GetEtfFlags`
    with `metadata=propagation_meta` (`:1966-1969`).
  - On error it logs `log.warning("GetEtfFlags failed …")` and returns `{}` (`:1970-1972`).
  - It maps `is_etf` to the gap label at `:1974-1981`: unset → `UNSPECIFIED`, true → `ETF`, false → `NOT_ETF`.
  - Last migration: `027_contract_owner_dimension.up.sql`. None is needed.

## Patterns to REUSE

- **Error class without raw text.** Reuse 255's classifier rather than writing a second one (C-18 DRY).
  - 255's implementation-spec Step 5 (`docs/roadmap/features/255-fix-marketdata-fundamentals-cache/implementation-spec.md:622-641`)
    adds three unexported pieces to package `fmp`:
    - `statusError{path, code}`, returned at `:255`;
    - `stageError{stage, err}`, wrapping the `:243`/`:251`/`:258` errors;
    - `enrichmentClass(err) string`, which returns `cap` / `ctx` / `http_<code>` / `transport` / `read` / `decode`
      using `errors.Is`/`errors.As` only.
  - **Seam for design:** `enrichmentClass` is unexported in `fmp`, and the caller sits in `internal/service`. Two
    options:
    - (a) export the classifier, or an exported wrapper, after 255 merges;
    - (b) have `FetchIsEtf` return a class-bearing error.

    Either way, never match on string prefixes; 255 pins "never string matching".
- **Gate numbers for the skip record.** Reuse `s.fmpBudget.BudgetSnapshot()` (`fmp_client.go:98`) and
  `atQuotaAlertThreshold` (`marketdata_service.go:1959`).
  - Either reshape `etfFillAllowed` (`etf_flags.go:140`) to return a reason plus used/cap, or take the snapshot on
    the skip path.
  - The skip path must stay non-fetching (`@AC-14`).
- **Rate-limit clock and state.** Reuse the injectable `etfFlagState.now` / `clock()` (`etf_flags.go:33`, `:53`).
  The tests already drive this clock through `newEtfSvc` → `*etfClock` (`etf_flags_test.go:51`).
  - The state goes on `etfFlagState`, guarded by `mu` or a sibling field.
  - The only rate-limit precedent in the service is the per-key `lastStaleCheck` map (`marketdata_service.go:52-55`,
    checked through `staleCheckDue` at `:317`).
  - No log rate-limit helper exists in marketdata `internal/`.
- **Window constant.** Put it in the `etf_flags.go:17-25` constant block and list it under the CLAUDE.md Fixed
  invariants (`:174`). It is not a config key (FR-2, F-07).
- **Log capture in tests.** Reuse or generalise `recordingWarnHandler` (`internal/service/marketdata_service_test.go:1549`,
  `installWarnRecorder` at `:1589`).
  - It installs itself with `slog.SetDefault`, which is process-global, so a test that uses it must not call
    `t.Parallel()`.
  - `Handle` (`:1560-1563`) drops every record that is not Warn. If design picks Info, generalise this handler to
    also keep Info rather than copying it (DRY).
  - The other existing capture handler is `countingWarnHandler` (`:807`).
- **ETF test harness** in `internal/service/etf_flags_test.go`:
  - `fakeEtfSource` at `:15`, with `calls`, `resp` and `err`;
  - `newEtfSvc(src, budget, fmpOn)` at `:51` and `etfFlags(t, svc, …)` at `:62`;
  - the drain idiom `svc.fillEtfFlag(ctx, <-svc.etf.queue)`;
  - `TestEtfFlagFiller_ErrorNotCached` at `:196`, whose error pattern AC-3 can reuse with an error text that contains
    `apikey=`;
  - `fakeBudget{used, cap}` at `marketdata_service_test.go:2035`.
- **AC-2 seed seam.** Reuse 255's `seedFMPBudget(ctx, counter, client)` (255 implementation-spec `:335`, test
  `TestSeedFMPBudget_CountsOnlyFMPRows_AC3` at `:390`, in `cmd/server/main_test.go`, `package main`).
  - `newEtfSvc` bypasses the boot seed, and `fakeBudget` cannot express "210 non-FMP rows + 5 FMP rows".
  - A service-level AC-2 test can therefore use only the budget that 255's seed would leave, for example
    `fakeBudget{used:5, cap:250}`.
  - The "fails before 255" half lives in 255's seed test.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-14 @FR-11 @feature-215` "The ETF label never spends the guard's FMP headroom"
  (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`).
  - At or above 80% of `marketdata.fmp.daily_request_cap`, `GetEtfFlags` leaves `is_etf` unset, no FMP call is made,
    and the filler does not fetch. A cached flag is served for 30 days without a re-fetch.
  - 230 adds a rate-limited, secret-free log for a gate-closed skip or a failed fetch next to this behavior. The gate,
    the TTL and the cache-only RPC stay unchanged.
  - The backing tests are `TestEtfFlagFiller_HeadroomGate_AC14` (`etf_flags_test.go:118`) and their siblings. The new
    logging must add no source calls.
- **PRESERVE** `@AC-4 @feature-217` "Failed FMP calls refund the shared daily budget"
  (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`). Filler fetches keep going through the
  one shared `*fmp.Client` budget. 230 adds no second counter and does not skip the refund.
- **PRESERVE** `@AC-2 @FR-2 @feature-215` "A fundamentals-gated backtest on an ETF returns an explicit reason, not a
  silent no-trade" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`).
  - The refusal and `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` hold whatever the label is.
  - Only `fundamentals_gap` moves from `UNSPECIFIED` to `ETF`.
- **PRESERVE** `@AC-5 @FR-6 @feature-215` "The refusal is auditable"
  (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). The analysis-side skip log
  and the reason on the result are untouched.
- Not impacted:
  - marketdata `@AC-7 @feature-215`, the NotFound vs FailedPrecondition split;
  - `sector-classification.feature` `@AC-1`/`@AC-4` (outage) and the SCD scenarios;
  - `historical-fundamentals-backtest.feature` `@AC-5 @feature-198`;
  - the remaining analysis `@feature-215` scenarios. A `GetEtfFlags` error still leaves the label `UNSPECIFIED`.
- No CHANGE rules. `docs/sdd/business-rules/platform.feature` was scanned and nothing in it is touched.
- **Would-be CHANGE (out of scope):** shortening the 30-day negative cache for an empty profile (hypothesis 3) would
  alter `@AC-14`'s "served for 30 days" clause. That needs explicit operator sign-off in `context.md`.
- Coverage limits:
  - Read in full: both affected `block-fundamentals-strategy-on-etf.feature` suites, `sector-classification.feature`,
    `historical-fundamentals-backtest.feature` and `platform.feature`.
  - The other 14 marketdata and 31 analysis suites were only keyword-grepped.
  - The UI consumer suites for `fundamentals_gap` were not read. They are presumed PRESERVE because there is no UI
    text change.

## Dependencies

- Proto/RPC: none. `GetEtfFlags` / `EtfFlag.is_etf` are unchanged.
- Migration: none. If one were ever needed, the next free numbers would be marketdata `010` and analysis `028`.
- Config keys: none.
  - The rate-limit window is a code constant (FR-2).
  - `marketdata.fmp.enabled` and `marketdata.fmp.daily_request_cap` are read unchanged.
- Inter-service edges: no new edges. analysis → marketdata `GetEtfFlags` (gRPC) is unchanged.
- New env vars / ports: none.
- Feature ordering:
  - **Hard predecessor `255-fix-marketdata-fundamentals-cache`** (`implementation-ready`). It supplies the
    source-filtered seed, `seedFMPBudget` and `enrichmentClass`.
  - **215** (in-progress) owns `etf_flags.go` and `etf_flags_test.go`.
  - **254** is a soft overlap: it rewraps `*url.Error` in `fmp_client.go`. Until it lands, raw `FetchIsEtf` errors
    can contain `apikey=`.

## Risks / Not-found

- **Root cause not confirmed from logs.** Triage, re-verification and this recon had no staging log access.
  Hypothesis 1 is supported by code: the seed is an unfiltered `count(*)` at `internal/repository/marketdata_repo.go:656`.
  Hypothesis 3 (empty profile negative-cached, `TestGetEtfFlags_EmptyProfileNegativeCached` `etf_flags_test.go:179`)
  is open. FR-2's logging is what makes the cause confirmable after deploy.
- **Rate-limit key unresolved.** Each option has a cost:
  - A **global** key (one `lastLogAt`) is the minimum and bounds the flood.
  - A **per-reason** key needs a small map.
  - A **per-symbol** key grows a map that only the queue and cache bound.

  Design must choose, and then split `@AC-3` into gate-closed, fetch-error and rate-limit scenarios with a concrete
  count (review warning, criterion 8).
- **Log level vs capture.** Choosing Info requires generalising `recordingWarnHandler`. Choosing Warn reuses it
  as-is.
- **Classifier visibility.** `enrichmentClass` is unexported (see the seam above). 255 leaves open an operator
  question: how to class stage-less errors (the build-request error and a non-ctx limiter error). 230 must not invent
  a label silently.
- **Not every closed gate is a budget gate.** FMP disabled, a nil source or budget, and `cap == 0` also close the
  gate. With FMP disabled, every miss would log. Design must decide:
  - which of these reasons are logged;
  - the token for each;
  - when used/cap applies.
- **Trace-id rule (operator 2026-10-21, C-03).** `fillEtfFlag` runs on the background loop ctx (`main.go:162`) with
  no originating request, so it may mint its own context. The rule still asks for a trace id "when one is
  available". `GetEtfFlags` discards its request ctx (`etf_flags.go:62`), and a queue item is only a symbol (`:83`),
  so carrying the enqueuing `x-trace-id` would mean widening the queue item. Design must decide this explicitly and
  record it.
- **Raw-error trap** (ledger `fails.md` 2026-10-22 fix-marketdata-secret-exposure, D-39). A `%w`-wrapped `*url.Error`
  carries `apikey=`. The AC-3 test must inject an error whose text contains `apikey=` and assert that neither the
  string nor the raw text appears in any captured record (message plus all attributes).
- **Analysis-side raw log (out of scope).** `servicer.py:1971` logs `GetEtfFlags` failures with the raw `e`. That is
  a marketdata gRPC error, not the FMP URL.
- **Merge conflicts:**
  - `etf_flags.go` and `etf_flags_test.go` with 215;
  - `fmp_client.go` with 254 and 255, if the classifier is exported.

  Record merge-order rows at /sdd-spec.
- **Not found:**
  - an error-classification helper on trunk (`errClass`, `classifyErr`);
  - a log rate-limit helper (`lastWarn`, `rateLimitedLog`, `logOncePer`);
  - an Info-level slog capture in marketdata tests;
  - any log assertion for the ETF filler;
  - any other `slog` call in the filler besides `:126`.

## Recommended Scope

These boundaries are advisory, not binding.

1. **Fill visibility (FR-2 / `@AC-3`)** in `etf_flags.go`.
   - Production changes:
     - the gate returns a reason, plus used/cap when the gate is budget-gated;
     - the skip and the fetch failure are logged at the chosen level, carrying the class from 255's classifier and
       never `err`;
     - both are rate-limited by one window constant on `etfFlagState`, using the injectable clock and the key that
       design picks;
     - the marketdata CLAUDE.md `GetEtfFlags` paragraph and its Fixed invariants list are updated.
   - Tests, using a non-parallel slog capture:
     - a gate-closed record with used/cap;
     - a fetch-error record that carries the class and contains no `apikey=`;
     - N repeats inside the window produce one record, and a record appears again after the window.
   - All `@AC-14` tests stay green.
2. **Label after the budget allows (FR-1 / `@AC-2`).**
   - Add a service-level regression test:
     - start from the budget state 255's seed leaves, for example `used:5, cap:250`;
     - miss SCHD and drain the queue;
     - call again and expect `is_etf == true`.
   - No production code is expected beyond 255. If the test fails after 255, go back to the operator.
3. **Staging confirmation.** After deploy, re-run feature 215 Step 26(a) on dev and read the new marketdata log lines
   to confirm the cause (spec Open Question 3).
