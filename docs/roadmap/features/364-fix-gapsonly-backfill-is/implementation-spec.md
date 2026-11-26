# Implementation Spec: fix-gapsonly-backfill-is

**Status**: `pending`
**Created**: 2026-11-26
**Feature**: `docs/roadmap/features/364-fix-gapsonly-backfill-is/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/fix-gapsonly-backfill-is`
**Spec tree**: `feature/fix-gapsonly-backfill-is@3c9982d0` (origin/main-dev@34f68c57 is 1 commit ahead and not merged in; every cited line was re-grepped on this tree)

---

## Execution Summary

The fix follows design.md's Chosen Approach and Build order. It is a bug fix (Track C, SEV-2).

1. **Calendar and gap math (Steps 1–6).** First the `marketsession` calendar gains the one-off NYSE
   closures since 2000. Then marketdata computes session-aware 1d gaps (head, interior, tail) in a
   pure `timeframe.ComputeSessionGaps`. Finally `GetDataCoverage` is wired to a one-query 1d read
   (`MIN/MAX/COUNT + array_agg`).
2. **Proto (Steps 7–8).** The additive enum value `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4` and its
   codegen land as one unit.
3. **Ingest (Steps 9–14).** These steps add, in order:
   - the coalescing planner;
   - the fresh-path verify pass, with the `gaps_only` marker, the precedence change, the widened
     finalize gate, the alert gate and the ledger field;
   - the resume-path verify, with a NULL-safe range rebuild.
4. **Consumer surfaces (Steps 15–19, C-14).**
   - UI: the `backtestBackfill.ts` discriminator for an INCOMPLETE-only PARTIAL.
   - Agent: docstrings and `CLAUDE.md`, the runbook and strat-lab sync, and a doc-parity test.

Ingest needs the enum (Step 8). The UI and the agent need both the enum and the ingest behavior, so the
consumer steps come last.

**Consumer surfaces (C-14).** The product spec names two surfaces, and both are reached:

- `/trader` position detail, through Step 15 (`backtestBackfill.ts`, consumed at
  `src/app/trader/positions/[symbol]/page.tsx:1261`);
- the agent `get_backfill_status` / `trigger_backfill`, through Steps 17–19.

The `/insights/strategies/[id]` GAPS_ONLY action is **out of scope**. On re-check,
`src/app/insights/strategies/[id]/page.tsx:539-557` renders only `Backfill started — job <id>` and no
job status, so it cannot mis-render an INCOMPLETE-only PARTIAL. This resolves the design open risk,
which was based on grep only.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` interior hole is fetched, job COMPLETED | Step 4 (interior gap reported), Step 6 (RPC reports interior gap), Step 10 (planner fetches it), Step 12 (verify clean → COMPLETED) |
| `@AC-2` unfillable interior hole is not COMPLETED and is named | Step 12 (fresh path PARTIAL + `incomplete` reason), Step 14 (resume path) |
| `@AC-3` fully covered range fetches nothing | Step 4 (no gaps), Step 6 (no gaps on the wire), Step 12 (empty plan → COMPLETED, no verify, `bars_processed` 0) |
| `@AC-4` head gap with no earlier bars completes (O-1 carve-out, K = 730) | Step 12 (head-probe miss → COMPLETED; head-probe hit → INCOMPLETE) |
| `@AC-5` Backtests card: INCOMPLETE-only PARTIAL → vendor-data message, Re-run, then no-vendor-data | Step 16 (vitest + Playwright) |
| `@AC-6` `get_backfill_status` reports `incomplete` with the ranges | Step 19 (projection + doc parity) |

### Resolutions of design items deferred to `/sdd-spec`

- **O-9 (coalescing boundary).**
  - The rule: a symbol's sorted gaps merge while `gap.end − unit.start ≤ timedelta(days=backfill.chunk_window_days)`. The window is read live through `self._cfg.backfill_chunk_window_days` (`app/config/watcher.py:129`, default 90).
  - A single gap that is longer than the window stays its own unit, and `plan_chunks` splits it by window as it does today.
  - `chunk_max_bars` only batches **symbols** within a window (`app/repositories/backfill_chunks.py:58-61`, `max_syms = max(1, …)`). So a single-symbol merged unit of at most one window becomes exactly one chunk, and `chunk_max_bars` cannot split it further.
  - The bound for a 365-day range with a 90-day window is ≤ 5 chunks per symbol. Step 10 pins it.
- **O-8 (scan cost).**
  - The 1d coverage query keeps the **identical** `WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4` predicate (`internal/repository/marketdata_repo.go:244-247`). It therefore locks the same chunk set as today's `MIN/MAX/COUNT`; `array_agg` changes only the payload size.
  - Payload bounds:
    - ≤ ~260 timestamps for the 365-day default;
    - ≤ ~520 for the 730-day probe;
    - ≤ ~6.8k for an unset-start range, which uses the existing 2000-01-01 floor (`internal/service/marketdata_service.go:518-524`).
  - Verify doubles the planner's scan and adds one 730-day probe per checked symbol that has a gap.
  - The probe locks ≤ 730 one-day chunks only where pre-`004` one-day chunks exist (`migrations/004_widen_ohlcv_chunk_interval.up.sql:25`, 30-day chunks for newer data). That exceeds the 400-day `@AC-1 @feature-153` envelope on such legacy ranges.
  - **Recorded as accepted at spec (not measured):** no DB may be brought up in a step (spec-template § Migration step verification), so measurement is deferred to the dev smoke test listed in Step 6's Verification note. `/sdd-review impl-spec` must confirm the operator accepts this.
- **Analysis hot path.** Analysis readiness probes call 1d coverage over `_READINESS_COVERAGE_PROBE_DAYS` (10 days, `services/xstockstrat-analysis/app/handlers/servicer.py:330`). `array_agg` there returns ≤ 8 timestamps over the same predicate, so the added cost is bounded by payload, not by locks. A live latency check is part of the same dev smoke note.
- **`@AC-24 @feature-352` re-check.** `services/xstockstrat-agent/acceptance/delisted-symbol-handling.feature:24-29` is a **fundamentals** backfill, which never takes the GAPS_ONLY bars path. No conflict with the "EMPTY with prior history becomes INCOMPLETE" risk.
- **Juneteenth before 2022.** **Fix** (Step 1): the `observed(June 19)` rule applies only for `y >= 2022`. This is the year NYSE first closed, and the calendar is now the gap oracle back to 2000.
- **Closure-table maintenance.** The rule is stated as a ≤2-line constraint comment on the table (Step 1) and in the marketdata `CLAUDE.md` (Step 5).
- **Gap timestamp convention.**
  - `Gap.Start = DayStart(first missing session)` (00:00 America/New_York).
  - `Gap.End = DayStart(last missing session) + 12h` (noon New York).
  - Why: `End > Start` even for a one-session gap, because `plan_chunks` drops `range_end <= range_start` (`backfill_chunks.py:52`). And the UTC calendar date of both bounds equals the New York session date, so ingest can format the `reason` dates with `datetime.date()` in UTC and needs no tz database.
  - A 1d bar is stamped at 00:00 New York, so it lies inside `[Start, End]`.
- **Session completing mid-job.** When `range.end` is unset, the planner and verify each bound gaps at `marketsession.Reference(now)` at their own call time. A job that runs across 16:00 New York can see verify report the just-completed session as missing. This falls under the design's accepted open risk "vendor publishes the last completed session late → INCOMPLETE until the next run". No extra mechanism is added (How-to-Act #2).

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. It uses only the existing exported `IsTradingDay`, so it is not an atomic unit.
- Steps 3+4 land together: Step 4's test references `ComputeSessionGaps`, which Step 3 creates (§C "test references a symbol a later step creates").
- Steps 3–4 require Step 1, because the closure dates are part of the session oracle that Step 4 asserts.
- Steps 5+6 land together: Step 6 references the new `coverageReader` seam and the `GetDailyCoverage` repo method that Step 5 creates.
- Step 5 requires Step 3 (it calls `ComputeSessionGaps`).
- Steps 7+8 land together: a `.proto` edit needs its `proto-gen` step (§C). No exhaustive `Record`/switch over `BackfillSymbolOutcome` exists in any consumer (grep: `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1617-1625` assignments only; ingest `servicer.py:309-314` map; agent `client.py:2184` `Name()`; none in `services/xstockstrat-ui`), so no other parity guard turns red.
- Step 10 [test] covers Step 9 [service]. It calls the existing `_plan_work_ranges`, so it is not a unit.
- Steps 11+12 land together:
  - Step 11 makes the existing `tests/test_ingest_servicer.py:1100` `test_gaps_only_plans_from_coverage_gaps` fail. Its `MagicMock` coverage is re-read by verify, and its `assert_awaited_once` at `:1126` no longer holds, so Step 12 must edit it.
  - Step 12 also references the new `_GAPS_ONLY_VERIFY_KEY` / `_verify_gaps_only`.
- Steps 11–12 require Step 8 (`common_pb2.BACKFILL_SYMBOL_OUTCOME_INCOMPLETE`) and Step 9.
- Steps 13+14 land together: Step 14 patches `app.repositories.backfill_chunks.list_job_symbols`, which Step 13 creates.
- Steps 13–14 require Steps 11–12 (they reuse `_verify_gaps_only`).
- Step 15 requires Step 8 (`BackfillSymbolOutcome.INCOMPLETE` in `@xstockstrat/proto/common/v1/common_pb`).
- Step 16 [test] covers Step 15 [service]. vitest runs without typechecking, so the RED is behavioral, not a compile error.
- Steps 17–19 require Step 8 and Steps 11–14 (the documented behavior).
- Step 19 [test] covers Steps 17 [service] and 18 [docs]. It needs Step 18's runbook and skill text, so it runs after both.
- Consumer-surface seam (§C): the backend unit (1–14), the UI (15–16) and the agent (17–19) are separate surfaces. No unit crosses them.

---

### Step 1 — service: one-off NYSE closures and the post-2021 Juneteenth rule in `marketsession`

**Status**: `done`
**Service**: `packages/proto` (Go package `marketsession`; consumed by marketdata, portfolio, trading)
**Files**:
- `packages/proto/marketsession/marketsession.go` — modify

**Reviewers**: packages/proto owner — field number uniqueness, backward compatibility, naming conventions

**Codebase Evidence**:
- Header `marketsession.go:1-2`: "Early closes and one-off closures are not modelled."
- `isHoliday` `marketsession.go:74-94` is rule-based. Juneteenth `observed(date(y, time.June, 19))` at `:82` applies every year.
- Consumers:
  - `services/xstockstrat-marketdata/internal/service/delisting.go:12,128,162-163`;
  - `services/xstockstrat-portfolio/internal/service/offline_valuation.go:133-212`;
  - `services/xstockstrat-portfolio/internal/testdata/offline_pnl.go:49`;
  - trading resolves the same module (`services/xstockstrat-trading/go.mod:10,47`).
- A grep of consumer tests found no dates that collide with the new closures or with pre-2022 Juneteenth.
- No test file exists in `packages/proto/marketsession/` (ls).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an unexported `closures` set of `{y, m, d}` dates for the NYSE full-day one-off closures since 2000:
   - 2001-09-11, 2001-09-12, 2001-09-13, 2001-09-14 (September 11);
   - 2004-06-11 (Reagan);
   - 2007-01-02 (Ford);
   - 2012-10-29, 2012-10-30 (Hurricane Sandy);
   - 2018-12-05 (G. H. W. Bush);
   - 2025-01-09 (Carter).
2. Have `isHoliday` return true for these dates.
3. Precede the table with a ≤2-line constraint comment (How-to-Act #5), e.g.
   `// Add every new one-off NYSE closure here: a missing date reads as a permanently missing session in GetDataCoverage gaps.`
4. Gate the Juneteenth entry on `y >= 2022`. For `y < 2022`, skip the entry; do not compare against a sentinel date.
5. Replace header line 2 so it no longer claims one-off closures are not modelled: "Early closes are not modelled; one-off closures are listed in `closures`."
6. Change no exported signature.

**Verification**:
```
cd packages/proto && gofmt -l marketsession/ && GOWORK=off go vet ./marketsession/ && GOWORK=off go test ./marketsession/
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/... -count=1
cd services/xstockstrat-trading && GOWORK=off go build ./...
```
`gofmt -l` must print nothing. No golangci-lint runs here: CI has no lint job for `packages/proto` (the `golangci-lint-action` step runs only in the trading/marketdata/portfolio matrix, `working-directory: services/${{ matrix.service }}`, `.github/workflows/ci.yml:352-358`), so `gofmt` + `go vet` are this package's lint gate.

---

### Step 2 — test: `marketsession` closure and Juneteenth cases

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketsession/marketsession_test.go` — create

**Reviewers**: packages/proto owner — backward compatibility

**Codebase Evidence**:
- No test file in the package (recon.md:150; ls).
- Exported API under test: `IsTradingDay` `marketsession.go:47`, `PrevTradingDay` `:56`.

**TDD**: `red-green required`

**Covers**: — (supports AC-1's "every trading session" oracle)

**Instructions**:
1. Table-test `IsTradingDay(time.Date(…, 12, 0, 0, 0, time.UTC))`:
   - **false** for each closure date in Step 1;
   - **false** for 2022-06-20 (Juneteenth observed);
   - **true** for 2021-06-18 (pre-2022 Juneteenth observed Friday, a real session);
   - **true** for 2025-01-10;
   - **false** for 2025-12-25.
2. Assert `PrevTradingDay(2025-01-10)` is 2025-01-08.
3. RED on the pre-Step-1 tree: the 2025-01-09 and 2021-06-18 rows fail.
4. C-13: these are plain `time.Date` literals with a single consumer, so they stay inline (compliant).

**Verification**:
```
cd packages/proto && GOWORK=off go test ./marketsession/ -run . -count=1 -v
```
Before Step 1 it fails on 2025-01-09 and 2021-06-18; after Step 1 it passes. Lint gate is `gofmt -l marketsession/` (empty) + `GOWORK=off go vet ./marketsession/`, as in Step 1; CI has no golangci-lint job for `packages/proto`. This package is not in a CI coverage job, so no threshold applies. The Go CI coverage for this behavior is Step 4's `TestComputeSessionGaps` closure row.

---

### Step 3 — service: `timeframe.ComputeSessionGaps` (head, interior and tail 1d gaps)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/timeframe/timeframe.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning

**Codebase Evidence**:
- `type Gap` `timeframe.go:76-79`; `ComputeGaps` doc `:82-83` ("interior holes out of scope" at `:83`), func `:84-101`.
- Imports `:6-11`: `fmt`, `time`, `commonv1`.
- Calendar import path `"github.com/xstockstrat/contracts/marketsession"` (`internal/service/delisting.go:12`).
- `SessionDate` `marketsession.go:22`, `DayStart` `:33`, `IsTradingDay` `:47`, `PrevTradingDay` `:56`, `Reference` doc `:64-65`, func `:66-72`.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `func ComputeSessionGaps(reqStart, reqEnd time.Time, stored []time.Time, now time.Time) []Gap` beside `ComputeGaps`. Leave `ComputeGaps` unchanged, because 15m/1h still use it (recon.md:157).
2. It returns `nil` when `!reqEnd.After(reqStart)`.
3. The last countable session is `ref` from `marketsession.Reference(now)`, or `marketsession.PrevTradingDay(ref)` when `live` is true.
4. Build a set of stored session dates from `marketsession.SessionDate(t)` for each `t` in `stored`.
5. Walk the days in order:
   - start at `d := marketsession.DayStart(reqStart)`, advanced one day if `d.Before(reqStart)`;
   - continue while `!d.After(reqEnd)` and `!d.After(marketsession.DayStart(last))`;
   - step with `d.AddDate(0,0,1)` and re-normalize with `DayStart`.
6. Treat each `IsTradingDay(d)` day that is not in the stored set as missing.
7. Merge each run of consecutive missing trading sessions. Only a **stored** session ends a run; non-trading days do not. Emit each run as `Gap{Start: DayStart(first), End: DayStart(last).Add(12 * time.Hour)}`.
8. Doc comment (≤2 lines, a constraint):
   - consecutive gaps are always separated by at least one stored session, and ingest's verify relies on this;
   - `End` is noon New York of the last missing session.
9. Update the `ComputeGaps` doc so it reads as the 15m/1h path ("1d uses ComputeSessionGaps").

**Verification**: runs with Step 4 (one commit):
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/timeframe/ -run 'TestComputeSessionGaps|TestComputeGaps' -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — test: `TestComputeSessionGaps` (separation invariant, interior hole, full coverage, calendar)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/timeframe/timeframe_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity

**Codebase Evidence**:
- `TestComputeGaps` `timeframe_test.go:97-135` (subtests via `t.Run`).
- Imports `:3-8` already include `commonv1` alongside `testing` and `time`; add only the `marketsession` import.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3`

**Instructions**:
1. Add `TestComputeSessionGaps` with `now` fixed at 2026-11-26 18:00 UTC, so the last countable session is 2026-11-25. Build `stored` from a helper that lists the New York-midnight stamps (`marketsession.DayStart`) of every trading day in a span, minus the excluded days. Add these subtests:
   - **AC-1 interior hole.** Bars 2025-11-20..2026-03-31 and 2026-09-28..2026-11-25. The request is 2025-11-20 00:00Z..2026-11-25 23:59Z. Expect exactly one gap, Start 2026-04-01 (New York midnight) and End 2026-09-25 12:00 New York.
   - **AC-3 fully covered.** Every session stored → `len == 0`.
   - **Head and tail.** No bars before 2026-01-05 and none after 2026-11-20 → two gaps, the head first.
   - **Separation invariant.** Scattered missing days (each a single session, some separated by weekends or holidays only) → missing days separated only by non-trading days merge into one gap. For every adjacent pair of gaps, at least one stored session lies between `gaps[i].End` and `gaps[i+1].Start`.
   - **Calendar.** 2025-01-09 (closure) and 2025-12-25 are never reported missing.
   - **Live bound.** With `now` during a live session, today is not reported.
   - **Reversed range** → `nil`.
   - **No bars** → one gap spanning the first to the last session in range.
2. C-13: the `stored` helper has a single consumer, so it stays inline in this file (compliant).

**Verification**:
```
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && golangci-lint run --modules-download-mode=mod
```
Coverage total must be ≥ 40%. Before Step 3 this fails to compile (unit RED); after Step 3 it passes.

---

### Step 5 — service: 1d `GetDataCoverage` reads stored session times and reports session gaps

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning

**Codebase Evidence**:
- Repo:
  - `GetCoverage` `marketdata_repo.go:241-260` (`SELECT MIN(time), MAX(time), COUNT(*) … WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4`);
  - `r.pool.QueryRow` `:249`.
- Service:
  - `GetDataCoverage` `marketdata_service.go:498-552`; `s.repo.GetCoverage` `:526`; `ComputeGaps` loop `:545-550`;
  - `s.repo` is the concrete `*repository.MarketDataRepo` (`:41`).
- Seam pattern: interface fields assigned only when `repo != nil` (`marketdata_service.go:255-266`, e.g. `prevClose prevCloseReader` `:117,160-162`; "a nil pointer in an interface field defeats the nil-seam default" `:255`).
- `covered_ranges` stays a single earliest–latest range (`:539-543`; R-5, do not rewrite).
- marketdata `CLAUDE.md:15` describes `GetDataCoverage` as "earliest/latest/count + gaps".
- No caller of `GetCoverage` outside the service (grep: repo `:243`, service `:526` only).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repo.** Add `func (r *MarketDataRepo) GetDailyCoverage(ctx, symbol string, start, end time.Time) (earliest, latest time.Time, barCount int64, times []time.Time, err error)`.
   - It runs one query: `SELECT MIN(time), MAX(time), COUNT(*), COALESCE(array_agg(time ORDER BY time), '{}') FROM marketdata.ohlcv WHERE symbol=$1 AND timeframe='1d' AND time >= $2 AND time <= $3`.
   - The predicate is the same as `GetCoverage` with the timeframe fixed to `1d`.
   - Leave `GetCoverage` untouched for 15m/1h.
2. **Service seam.** Add `type dailyCoverageReader interface { GetDailyCoverage(...) }` beside `dailyCloseReader` (`:164-167`). Add a field `dailyCoverage dailyCoverageReader` with a ≤1-line comment, and assign `svc.dailyCoverage = repo` inside the existing `if repo != nil` block (`:259-266`).
3. **`GetDataCoverage`.**
   - When `canonical == "1d"` and `s.dailyCoverage != nil`, call `s.dailyCoverage.GetDailyCoverage(ctx, req.Symbol, start, end)`. Build `BarsTotal`/`Earliest`/`Latest`/`CoveredRanges` exactly as today, and fill `resp.Gaps` from `timeframe.ComputeSessionGaps(start, end, times, time.Now())`.
   - Otherwise keep the existing `s.repo.GetCoverage` + `ComputeGaps` path unchanged.
   - Keep the deliberately-permissive doc at `:498-499`.
4. **`CLAUDE.md:15`.** Change the line to say 1d gaps are session-aware (head/interior/tail from stored session dates via `marketsession`). Add a one-line closure-table maintenance rule: "a missed one-off closure reads as a permanent gap".

**Verification**: runs with Step 6 (one commit):
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/ -run 'TestGetDataCoverage' -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — test: service-level `GetDataCoverage` with a stubbed daily coverage reader

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/coverage_test.go` — create

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity

**Codebase Evidence**:
- No `GetDataCoverage` service or repo test exists (recon.md:41,159; grep found no `GetDataCoverage` in `*_test.go`).
- Struct-literal construction in tests: `svc := &MarketDataService{registry: reg, ledger: &fakeLedger{}}` (`marketdata_service_test.go:1072`).
- Package `service` (excluded from the CI coverage measurement by the `COVERPKGS` filter).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3`

**Instructions**:
1. Define `stubDailyCoverage` returning canned `(earliest, latest, count, times)` and recording the `(symbol, start, end)` it was called with.
2. Tests, all with a 2026 window ending before today, so `time.Now()` never truncates:
   - **(a) AC-1.** TIMEFRAME_1DAY, stored times with the 2026-04-01..2026-09-25 hole → `resp.Gaps` has exactly one entry with the expected Start and End. `BarsTotal`/`Earliest`/`Latest` equal the stub's values. `CoveredRanges` is one range (unchanged).
   - **(b) AC-3.** Full coverage → `len(resp.Gaps) == 0`.
   - **(c) Floor.** An unset `Range.Start` reaches the stub as 2000-01-01 UTC.
   - **(d) Error.** A stub error → a wrapped `get coverage:` error.
3. Do not exercise 15m/1h here: they need the concrete `s.repo`, and the path is unchanged.
4. C-13: the stub and times have a single consumer, so they stay inline (compliant).

**Verification**:
```
cd services/xstockstrat-marketdata && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" && golangci-lint run --modules-download-mode=mod
```
Coverage total must be ≥ 40%. The new logic is in the excluded `service`/`repository` packages, so no threshold applies to it; this unit test is the verification. The repo SQL has no offline test, because it needs a DB.

**Dev smoke (post-deploy, not run in execute)**: run `GetDataCoverage` 1d for one symbol over 400 days and over an unset start on dev. Confirm there is no SQLSTATE 53200 and that latency is comparable to today's call. This is the O-8 measurement deferred above.

---

### Step 7 — proto: `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass; xstockstrat-ingest owner — idempotent ingestion; packages/proto owner — backward compatibility

**Codebase Evidence**:
- `enum BackfillSymbolOutcome` `common.proto:156-161`: UNSPECIFIED 0, EMPTY 1, SKIPPED 2, FAILED 3. Next free value 4.
- Message comment `:163` "Lists non-written symbols only; reason is the source's error text, empty for EMPTY."

**Lands with**: `Step 8`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Append `BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4;` after FAILED.
2. Amend the `:163` comment to stay ≤2 lines and keep it true. For example: "Lists non-written symbols only; reason is the source's error text (empty for EMPTY), or for INCOMPLETE the still-missing session ranges."
3. Make no other change. Approval: 1 service owner (operator-accepted 2026-11-26).

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against '<repo-root>/.git#branch=feature/fix-gapsonly-backfill-is,subdir=packages/proto'
```
`<repo-root>` is the main checkout root (the first entry of `git worktree list --porcelain`). `subdir=` is mandatory (PLAT-10).

---

### Step 8 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/` — modify (generated)
- `packages/proto/gen/python/common/v1/` — modify (generated)
- `packages/proto/gen/ts/` — modify (generated, including `dist/`)

**Reviewers**: Proto Reviewer — `buf lint`/`buf breaking`; xstockstrat-ingest owner; packages/proto owner (inherited from Step 7)

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh`. CI `proto-freshness` enforces an empty diff.
- Generated paths are never read (root `CLAUDE.md` Key File Paths).

**Lands with**: `Step 7`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage only the regenerated files under `packages/proto/gen/` that the script changed.

**Verification**:
```
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ && cd services/xstockstrat-marketdata && GOWORK=off go build ./... && cd ../xstockstrat-ingest && uv run python -c "from gen.common.v1 import common_pb2; assert common_pb2.BACKFILL_SYMBOL_OUTCOME_INCOMPLETE == 4"
```
A second `./scripts/buf-gen.sh` must leave `git diff packages/proto/gen/` empty.

---

### Step 9 — service: GAPS_ONLY planner coalesces each symbol's gaps within `chunk_window_days`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion

**Codebase Evidence**:
- `_plan_work_ranges` `servicer.py:787-812`. It calls `GetDataCoverage(symbol, timeframe=tf_enum, range=request.range)` at `:801-806` and makes one unit per gap at `:807-810`.
- `self._cfg.backfill_chunk_window_days` is read at `:824`, `app/config/watcher.py:129-130` (default 90).
- `plan_chunks` `app/repositories/backfill_chunks.py:35-71` (window split `:56-58`; symbol batching only `:58-61`).
- R-7: one unit per gap is rejected.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In the GAPS_ONLY branch, build the per-symbol list `[(gs, ge)]` with the existing fallbacks (`_ts_to_dt(gap.start) or range_start`, `_ts_to_dt(gap.end) or range_end`).
2. Coalesce the list in order:
   - start a unit at the first gap;
   - extend it to a later gap's end while `ge - unit_start <= timedelta(days=self._cfg.backfill_chunk_window_days)`;
   - otherwise emit `([sym], unit_start, unit_end)` and start a new unit.
3. Keep the `GetDataCoverage` call shape unchanged (raw `request.range`, `propagation_meta`; C-03 propagation reused).
4. Update the docstring's "one per gap" wording to state the coalescing bound (≤2 lines, a constraint). Re-fetching stored sessions between gaps is harmless under `overwrite=false`.
5. Observe-only risk: coalescing adds vendor bandwidth on dense-hole symbols. No mechanism is added.

**Verification**:
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_ingest_servicer.py -q -k "gaps_only or coalesc"
```

---

### Step 10 — test: coalescing bound and one chunk per merged unit (O-9)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion

**Codebase Evidence**:
- `make_servicer(chunk_window_days=…, chunk_max_bars=…)` `tests/test_ingest_servicer.py:35-69`.
- `_make_backfill_req` `:909-917`.
- `TestRunBackfill` `:949`; `test_gaps_only_plans_from_coverage_gaps` `:1100-1127` (patch pattern `_CHUNKS`).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. In `TestRunBackfill`, add `test_gaps_only_coalesces_scattered_gaps_within_window`:
   - use `make_servicer(chunk_window_days=90)`;
   - `GetDataCoverage` returns a real `marketdata_pb2.GetDataCoverageResponse` with 40 one-session gaps spread across 2025-11-20..2026-11-20;
   - call `svc._plan_work_ranges(req, ["AAPL"], "1d", ())` with GAPS_ONLY.
2. Assert:
   - `len(units) <= 5` (`ceil(365/90)`);
   - every unit spans `<= timedelta(days=90)`;
   - the units' union covers every gap;
   - `backfill_chunks.plan_chunks(...)` over each unit yields exactly one chunk (O-9).
3. Add `test_gaps_only_long_gap_stays_its_own_unit`: one 178-day gap (2026-04-01..2026-09-25) plus a later one-day gap → 2 units, and `plan_chunks` splits the long one by window. This is the AC-1 hole being planned.
4. RED on the pre-Step-9 tree: 40 units.
5. C-13: `GetDataCoverageResponse` builders have a single consumer module, so they stay inline (compliant).

**Verification**:
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 11 — service: fresh-path GAPS_ONLY verify, INCOMPLETE outcome, widened finalize gate

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion, signal normalization correctness

**Codebase Evidence**:
- Constants and helpers:
  - `_dt_to_ts` `servicer.py:302-305`;
  - `_FUNDAMENTALS_RESULTS_KEY` `:308`;
  - `_SYMBOL_FAILED` `:309`;
  - `_OUTCOME_PRECEDENCE` `:310-314` (FAILED is 3 today);
  - `_merged_symbol_results` `:317-332`.
- `_execute_backfill`:
  - plan-time `update_job(... chunks_total, bars_total)` `:856-861`;
  - `_run_chunks(...)` `:865`;
  - `_finalize_backfill(...)` `:866`.
- The FR-3 empty-plan early COMPLETED path is `:835-853` and stays unchanged.
- `_finalize_backfill` `:868-937`:
  - cancel guard `:874-877`;
  - status chain `:880-885`;
  - completed event payload `:911-916`;
  - PARTIAL alert `:917-924`.
- `_run_chunks` seeds `state["symbol_results"] = dict(symbol_results or {})` (`:999-1004`) and persists it per chunk (`:1082-1088`).
- Header propagation (C-03) is reused: `self._marketdata.GetDataCoverage(..., metadata=propagation_meta)` as at `:801-806`.
- The fixed-invariant doc precedent is marketdata `CLAUDE.md:121` "## Adaptive rate limit — fixed invariants (feature 347)". The ingest `CLAUDE.md:146` GAPS_ONLY line is the place to document K.

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Constants.**
   - Add `_GAPS_ONLY_VERIFY_KEY = "gaps_only"` beside `_FUNDAMENTALS_RESULTS_KEY`.
   - Add `_SYMBOL_INCOMPLETE = common_pb2.BACKFILL_SYMBOL_OUTCOME_INCOMPLETE`.
   - Add `_HEAD_PROBE_DAYS = 730`, with a ≤2-line constraint comment: a fixed invariant (operator 2026-11-26, F-07 convention), aligned with `backfill.self_serve_max_range_days`.
   - Change `_OUTCOME_PRECEDENCE` to EMPTY 1, SKIPPED 2, INCOMPLETE 3, FAILED 4, and update the `_merged_symbol_results` docstring order.
2. **`async def _verify_gaps_only(self, job_id, symbols, time_range, tf_enum, state, propagation_meta)`.**
   - Return immediately if `job_id in self._canceled_jobs`.
   - Compute `merged = {r.symbol: r.outcome for r in _merged_symbol_results(json.dumps(state["symbol_results"]))}`.
   - For each symbol in `sorted(symbols)`:
     - skip it if `merged.get(sym) == SKIPPED`;
     - re-check the cancel set and return if canceled;
     - `cov = await GetDataCoverage(symbol=sym, timeframe=tf_enum, range=time_range)`;
     - `missing = list(cov.gaps[1:])`;
     - if `cov.gaps` is non-empty, let `head_start = _ts_to_dt(cov.gaps[0].start)` and probe `GetDataCoverage(range=TimeRange(start=_dt_to_ts(head_start - timedelta(days=_HEAD_PROBE_DAYS)), end=cov.gaps[0].start))`. When `probe.bars_total > 0`, put `gaps[0]` first in `missing`; otherwise it is the head carve-out (O-1, accepted verbatim);
     - `gaps[0]` is probed even when it is an interior hole (stored bars inside the range precede it). That is intended: those bars lie in the probe window, so the probe hits and `gaps[0]` stays in `missing`. No separate head/interior classification is needed;
     - on any exception from either call, record `{"outcome": _SYMBOL_FAILED, "reason": f"coverage verify failed: {e}"}` and add the symbol to `state["failed_symbols"]` (PLAT-N1, a retryable PARTIAL);
     - if `missing` is non-empty, record `{"outcome": _SYMBOL_INCOMPLETE, "reason": "missing sessions " + "; ".join(f"{start.date()}..{end.date()}")}`. The dates come from `_ts_to_dt` (UTC), whose UTC date equals the New York session date (see the gap convention), so the result reads like `missing sessions 2026-04-01..2026-09-25`. Add the symbol to `state["incomplete_symbols"]` (a set; create it with `setdefault`).
   - Write `state["symbol_results"][_GAPS_ONLY_VERIFY_KEY] = results`. This overwrites the key wholesale (idempotent).
   - Persist it with `backfill_jobs.update_job(self._db, job_id, symbol_results=json.dumps(state["symbol_results"]))`.
   - If anything is incomplete, emit `log.warning("backfill job %s incomplete: %s", job_id, <sym: reason>)`.
3. **`_execute_backfill`** (GAPS_ONLY only, i.e. `request.fill_mode == FILL_MODE_GAPS_ONLY`):
   - add `symbol_results=json.dumps({_GAPS_ONLY_VERIFY_KEY: {}})` to the plan-time `update_job` (`:856`);
   - pass `symbol_results={_GAPS_ONLY_VERIFY_KEY: {}}` to `_run_chunks` (`:865`);
   - then call `await self._verify_gaps_only(job_id, sorted({s for c in planned for s in c["symbols"]}), request.range, _STR_TO_ENUM.get(timeframe, 0), state, propagation_meta)` before `_finalize_backfill`.
   - FULL mode is unchanged.
4. **`_finalize_backfill`.**
   - `incomplete = sorted(state.get("incomplete_symbols", ()))`, using `.get` because existing tests pass a state without the key (`tests/test_ingest_servicer.py:1291`).
   - Status chain: FAILED (`chunks_failed > 0 and chunks_done == 0`) → PARTIAL (failed symbols or chunks) → PARTIAL (`incomplete`) → COMPLETED.
   - The completed-event payload gains `"incomplete_symbols": incomplete` (additive JSON; no proto or webhook change).
   - The PARTIAL alert is sent only when `failed_symbols or state["chunks_failed"] > 0` (R-9: no alert for an INCOMPLETE-only PARTIAL).
   - CANCELED keeps its early return.
5. **ingest `CLAUDE.md:146`.** Extend the GAPS_ONLY line:
   - after the chunks, a verify pass marks still-missing symbols `incomplete` and the job ends PARTIAL;
   - add a "fixed invariant" sub-bullet: head-gap carve-out lookback K = 730 days, not a config key, with the operator's accepted O-1 residual in one sentence;
   - add the one-time residual (O-7): GAPS_ONLY jobs created before the deploy resume unverified.

**Verification**: runs with Step 12 (one commit):
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 12 — test: verify pass — AC-1/2/3/4, head probe, RPC failure, cancel, SKIPPED, alert gate

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion

**Codebase Evidence**:
- The existing `test_gaps_only_plans_from_coverage_gaps` `:1100-1127` uses `cov = MagicMock()` and `assert_awaited_once()` at `:1126`, which breaks once verify re-reads coverage.
- Helpers:
  - `_mk_backfill_resp` `:110-115`;
  - `_bars_resp`/`_sr` `:2708-2715`;
  - `_stored_results` `:2724-2728`;
  - `_results_servicer` `:2744-2749`;
  - `_job_row` (`tests/_helpers.py:62-94`).
- Status-write helper `_status_writes` `:1349`.
- The canceled-state pattern is `svc._canceled_jobs.add(...)` (`:1289`).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:
1. **Edit the existing test (`:1100-1127`).** `GetDataCoverage` becomes an `AsyncMock(side_effect=[plan_cov, verify_cov])` with real `GetDataCoverageResponse` objects, where the verify response has no gaps. Assert `await_count == 2` and a final status of COMPLETED.
2. **Add a `TestGapsOnlyVerify` class.** It drives `_run_backfill` with GAPS_ONLY through real `plan_chunks` and patched chunk writes (the `:1115-1123` pattern), with real `marketdata_pb2.GetDataCoverageResponse` values. Tests:
   - **`@AC-1` SCHW.** The plan gap is 2026-04-01..2026-09-25 and the verify coverage has no gaps → COMPLETED, no `incomplete` entry, no alert.
   - **`@AC-2` IDXX.**
     - The verify coverage still has that gap as `gaps[0]`, and the probe returns `bars_total=120`.
     - Expect PARTIAL; stored `symbol_results["gaps_only"]["IDXX"] == {"outcome": INCOMPLETE, "reason": "missing sessions 2026-04-01..2026-09-25"}`; and IDXX not in `failed_symbols`.
     - `job_row_to_proto` merged results list IDXX as INCOMPLETE.
     - `EmitAlert` is not awaited. The `ingest.backfill.completed` payload carries `incomplete_symbols == ["IDXX"]`.
   - **`@AC-3` RLI.** The plan coverage has no gaps → COMPLETED via the empty-plan path. `GetDataCoverage.await_count == 1` (no verify), `BackfillBars` is not awaited, and `bars_processed` is not written above 0.
   - **`@AC-4` NEWCO.**
     - Head probe miss: the head gap remains, the probe returns `bars_total=0` → COMPLETED, no `incomplete`.
     - Head probe hit: the probe returns `bars_total=5` → PARTIAL/INCOMPLETE.
     - Assert the probe range starts exactly `timedelta(days=730)` before `gaps[0].start` and ends at it.
   - **Interior after a carved head.** The verify gaps are `[head, interior]` and the probe misses → INCOMPLETE naming only the interior range.
   - **Verify RPC failure.** The verify `GetDataCoverage` raises → PARTIAL, the symbol is in `failed_symbols` with reason prefix `coverage verify failed:`, and the WARNING alert is awaited.
   - **Cancel during verify.** Add the job to `_canceled_jobs` from inside the first verify call's side effect → no terminal status write and no second symbol checked (`@AC-6 @feature-261` preserved).
   - **SKIPPED excluded.** A chunk result marks PSKY SKIPPED → verify never calls coverage for PSKY, and the job is COMPLETED (`@AC-23 @feature-352` preserved).
   - **Precedence.** `_merged_symbol_results` with an EMPTY chunk entry and an INCOMPLETE verify entry → INCOMPLETE; with FAILED + INCOMPLETE → FAILED.
3. RED on the pre-Step-11 tree: AC-2 ends COMPLETED.
4. C-13: the coverage-response builders are used only in this module, so they stay inline (compliant). Reuse `_job_row` from `tests/_helpers.py`; do not add a second job-row literal.

**Verification**:
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 13 — service: resume path runs verify, with a NULL-safe range rebuild

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_chunks.py` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion

**Codebase Evidence**:
- `_resume_job` `servicer.py:943-976`. It calls `_run_chunks(..., symbol_results=json.loads(row.get("symbol_results") or "{}"))` at `:964-971`, then `_finalize_backfill` at `:972`.
- The NULL-safe rebuild already exists in `job_row_to_proto` `:368-374` (`if row.get("range_start"): tr.start.CopyFrom(_dt_to_ts(...))`). It is reused rather than re-written (recon Patterns to REUSE / DRY).
- `range_start`/`range_end` are persisted as `_ts_to_dt(request.range.*)`, which is `None` when unset (`:568-569`); `_dt_to_ts(None)` raises (`:302-305`; R-8).
- The repo has no "all chunk symbols" read today. It has only `get_incomplete_chunks` `backfill_chunks.py:101-111` and `list_jobs_with_incomplete_chunks` `:143-150` (pattern: `db_pool.fetch` + list comprehension).

**Lands with**: `Step 14`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repo.** Add `async def list_job_symbols(db_pool, job_id: str) -> list[str]`, which runs `SELECT DISTINCT unnest(symbols) AS symbol FROM ingest.backfill_chunks WHERE job_id = $1::uuid ORDER BY symbol`. These are the symbols that had planned units.
2. **`_resume_job`.**
   - After `_run_chunks`, if `_GAPS_ONLY_VERIFY_KEY in state["symbol_results"]`, call `await self._verify_gaps_only(job_id, await backfill_chunks.list_job_symbols(self._db, job_id), job_row_to_proto(row).range, _STR_TO_ENUM.get(timeframe, 0), state, meta)` before `_finalize_backfill`.
   - `job_row_to_proto(row).range` sets only the non-NULL bounds. An unset range stays empty, mirroring the fresh path's raw `request.range` (so marketdata's 2000 floor applies).
3. Jobs without the marker (FULL mode, or GAPS_ONLY created before deploy, the O-7 residual) resume exactly as today.

**Verification**: runs with Step 14 (one commit):
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 14 — test: resume verify with NULL bounds; `list_job_symbols`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_backfill_chunks.py` — modify

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion

**Codebase Evidence**:
- `test_resume_job_redrives_incomplete_chunks` `test_ingest_servicer.py:1145-1166` (patch pattern for `get_job`/`get_incomplete_chunks`/`update_job`).
- `_job_row(..., range_start=None, range_end=None, symbol_results=None)` defaults (`tests/_helpers.py:73-93`).
- Repo test pattern: `pool = AsyncMock(); pool.fetch = AsyncMock(return_value=[...])` (`test_backfill_chunks.py:92-97`).

**Lands with**: `Step 13`

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. **`test_backfill_chunks.py`.** `list_job_symbols` returns `[r["symbol"] …]`. Assert the SQL contains `DISTINCT unnest(symbols)` and that it passes `job_id`.
2. **`test_ingest_servicer.py`, resume tests.** Each uses a `_job_row` with `symbol_results=json.dumps({"gaps_only": {}})` and patches `list_job_symbols` → `["IDXX"]`:
   - **(a) NULL start.** `range_start=None`, `range_end=datetime(2026,11,25,tzinfo=UTC)`: no raise. The verify `GetDataCoverage` request has `range.HasField("start") is False` and `range.end` set. The verify reports the AC-2 gap with a probe hit → final PARTIAL + INCOMPLETE.
   - **(b) NULL end.** `range_end=None` → no raise; it finalizes.
   - **(c) No marker.** `symbol_results=None` → `GetDataCoverage` is never awaited (O-7 path unchanged).
3. RED on the pre-Step-13 tree: (a) ends COMPLETED.
4. C-13: reuse `_job_row`. The coverage builders are in the same module as Step 12, so there is no second consumer.

**Verification**:
```
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 15 — service: UI maps an INCOMPLETE-only PARTIAL to the vendor-has-no-bars state

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/backtestBackfill.ts` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `BackfillJobLike` `backtestBackfill.ts:20-27` has no `symbolResults`.
- `backfillJobMessage` `:72-112`; PARTIAL case `:90-100` (`chunksFailed > 0` → chunk text; else `Backfill partial: ${symbol} returned no data for part of the range`).
- Enum import style: `import { BackfillStatus, type FillMode } from '@xstockstrat/proto/ingest/v1/ingest_pb'` (`:3`) and `import type { Timeframe } from '@xstockstrat/proto/common/v1/common_pb'` (`:2`).
- The page consumes `jobMessage?.state === 'ready'` → Re-run button (`src/app/trader/positions/[symbol]/page.tsx:1261,1333-1334`). The re-run → `noVendorDataMessage` path is at `:1259,1320` (`@AC-13 @feature-343`).
- The BFF is a passthrough (O-2 closed), so `symbolResults` (BackfillJob field 16) reaches the browser.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Import `BackfillSymbolOutcome` (value import) from `@xstockstrat/proto/common/v1/common_pb`.
2. Add `symbolResults?: { outcome: BackfillSymbolOutcome }[]` to `BackfillJobLike`.
3. In the PARTIAL case, before the existing branches: if `chunksFailed === 0` and `symbolResults` has at least one `INCOMPLETE` and no `FAILED`, return `{ state: 'ready', text: \`Backfill finished: vendor has no bars for some sessions of ${symbol}\` }`.
4. Leave the existing PARTIAL texts unchanged, so the `@AC-9 @feature-343` Examples still hold.
5. Use no color literals (C-17 is not touched: text only).
6. Leave `page.tsx` unchanged (design §6).

**Verification**:
```
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint
```

---

### Step 16 — test: vitest discriminator rows and a Playwright INCOMPLETE-only scenario

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/backtestBackfill.test.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/backfillJobs.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness

**Codebase Evidence**:
- The vitest `backfillJobMessage` `it.each` table is at `backtestBackfill.test.ts:86-141` and imports `backfillJob` from `../../e2e/fixtures/backfillJobs` (`:7`).
- Fixture `backfillJob(over)` `e2e/fixtures/backfillJobs.ts:18-33` (numeric enums valid for both Connect responses and page.route JSON, `:6-9`).
- INVENTORY row `e2e/fixtures/INVENTORY.md:64`.
- Playwright `test.describe('inline backfill from the Backtests card')` `position-detail.spec.ts:989`:
  - `routeJob` `:1017-1020`;
  - `runInsufficient` `:996-1004`;
  - the `@AC-13` flow `:1090-1097`.
- Auth via `addAuthCookie` (`:997`, C-12 helper).

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. **Fixture.** In `backfillJobs.ts`, add `export function incompleteSymbolResult(symbol: string, reason = 'missing sessions 2026-04-01..2026-09-25')`, returning `{ symbol, outcome: BackfillSymbolOutcome.INCOMPLETE, reason }` (numeric enum). It has two consumers (vitest + Playwright), so it is C-12's canonical home. Add it to the INVENTORY `Backfill jobs` row (`:64`), naming both consumers.
2. **vitest.** Add rows to the `backfillJobMessage` table:
   - **(a) `@AC-5` INCOMPLETE-only PARTIAL.** `PARTIAL`, 3/3 chunks, `symbolResults: [incompleteSymbolResult('LYFT')]` → `{ state: 'ready', text: 'Backfill finished: vendor has no bars for some sessions of LYFT' }`.
   - **(b)** INCOMPLETE plus a FAILED entry → the existing "returned no data" partial text.
   - **(c)** INCOMPLETE but `chunksCompleted` 2/3 → the chunk-failed text.
   - The existing `@AC-9` rows keep no INCOMPLETE entries.
3. **Playwright.** Add `test('@AC-5 an INCOMPLETE-only partial reports missing vendor sessions and offers the re-run', …)` in the inline-backfill describe:
   - `routeJob(page, { status: BackfillStatus.PARTIAL, chunksCompleted: 5, chunksTotal: 5, symbolResults: [incompleteSymbolResult('ZZZZ')] })`;
   - click the backfill action;
   - expect `backtest-backfill-status` to have the text `Backfill finished: vendor has no bars for some sessions of ZZZZ` and `backtest-rerun` to be visible;
   - click re-run;
   - expect `backtest-no-vendor-data` to contain `No vendor data for` and `backtest-backfill-action` to have count 0.
4. RED on the pre-Step-15 tree: row (a) and the Playwright status text fail.

**Verification**:
```
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run test:coverage && pnpm exec playwright test e2e/trader/position-detail.spec.ts --project=chromium --grep "@AC-5|@AC-13|@AC-4"
grep -n "from '../fixtures'\|from '../../e2e/fixtures/backfillJobs'\|helpers/auth" services/xstockstrat-ui/e2e/trader/position-detail.spec.ts services/xstockstrat-ui/src/lib/backtestBackfill.test.ts
```
`test:coverage` (`vitest run --coverage`) must pass the thresholds `services/xstockstrat-ui/vitest.config.ts` enforces: lines/functions/statements ≥ 40%, scoped to `src/lib/**` (which contains `backtestBackfill.ts`). Playwright has no coverage threshold.
(If the sandbox times out on Playwright's `webServer`, pre-build and pre-start the server per the ledger insight `fix-custom-formula-allnone — reuse`.)

---

### Step 17 — service: agent `get_backfill_status` docstrings and `CLAUDE.md` name the `incomplete` outcome

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- The `get_backfill_status` docstring `tools.py:1775-1778` lists the outcomes `"empty"`, `"skipped"` or `"failed"`.
- The `_backfill_job_to_dict` docstring `client.py:2173-2176` says `outcome: empty|skipped|failed`. Its projection derives names from the enum (`:2183-2185`), so `incomplete` appears with no code change once Step 8 lands.
- Agent `CLAUDE.md:35` lists `empty`, `skipped` … or `failed`.

**TDD**: `red-green required` (the RED is Step 19's doc-parity assertion on the tool description)

**Covers**: —

**Instructions**:
1. In the `get_backfill_status` docstring, add `"incomplete"`: a GAPS_ONLY bars job verified that sessions in the range are still missing. The reason lists `missing sessions YYYY-MM-DD..YYYY-MM-DD[; …]`; the symbol is not in `failed_symbols`; and the job ends PARTIAL. Keep the existing sentences.
2. Update the `_backfill_job_to_dict` docstring outcome list to `empty|skipped|failed|incomplete`.
3. In `CLAUDE.md:35`, add `incomplete` (feature 364) with the same one-clause meaning.
4. Make no behavior change.

**Verification**:
```
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_client.py tests/test_tools_endpoint.py -q
```

---

### Step 18 — docs: runbook and strat-lab `backtest` skill sync for `incomplete`

**Status**: `pending`
**Service**: `docs/runbooks/`, `plugins/strat-lab/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/historical-backfill.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md`:
  - the `get_backfill_status` section `:1095`;
  - the outcome table, header near `:1123`, rows `empty`/`skipped`/`failed` at `:1125-1127`;
  - the `trigger_backfill` delisted note `:1028-1030`.
- `historical-backfill.md:357-359` "Gaps-only … fetch only the ranges `marketdata.GetDataCoverage` reports missing".
- strat-lab:
  - `SKILL.md:218-224` (non-admin gaps_only; `symbol_results` `skipped`);
  - `reference/backfill.md:59-62` (per-symbol outcomes).
- strat-lab same-PR rule: `docs/patterns/strat-lab-plugin.md` (root `CLAUDE.md` Context Guide).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **`mcp-tools.md`.** Add an `incomplete` row to the `get_backfill_status` outcome table:
   - GAPS_ONLY bars job only; sessions are still missing after the fetch;
   - the reason names the ranges; the job is `PARTIAL`; the symbol is not in `failed_symbols`; no alert is sent;
   - a head gap with no stored bar in the 730 days before it is exempt (pre-listing).
   Add one sentence under `trigger_backfill` saying GAPS_ONLY now fills interior holes.
2. **`historical-backfill.md:357`.** Say that gaps include interior holes (1d, session-aware), and that a range the vendor cannot fill ends `PARTIAL` with `incomplete` symbols. Add two accepted residuals:
   - IEX-feed holes recur as `incomplete` on every GAPS_ONLY run;
   - a late-published last session reads `incomplete` until the next run.
3. **strat-lab `SKILL.md:222-224` and `reference/backfill.md:59-62`.** An `incomplete` symbol means the vendor has no bars for those sessions: do not re-trigger the same range. A `PARTIAL` with only `incomplete` symbols is data-final, so backtest and expect insufficient data for that range.
4. Keep `gaps_only` present in all three files (the `test_tools_endpoint.py:112-135` contract).

**Verification**:
```
grep -n "incomplete" docs/runbooks/mcp-tools.md docs/runbooks/historical-backfill.md plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/backfill.md && grep -c "gaps_only" plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/backfill.md docs/runbooks/mcp-tools.md
```

---

### Step 19 — test: agent projects `incomplete` and docs stay in parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- `_symbol_results_job` / `_SYMBOL_RESULTS` `test_client.py:755-785`; `test_single_job_symbol_results_outcomes_and_reasons` `:787-798`; descriptor guard `:829-834`.
- Doc-parity pattern: `test_docs_and_skill_parity_with_self_serve_backfill` `test_tools_endpoint.py:112-135` (`_catalog()` `:78`, `_REPO` `:15`).

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. **`test_client.py`.** Add `test_incomplete_outcome_projects_with_its_ranges`:
   - a `BackfillJob` (PARTIAL, `failed_symbols=[]`) with `BackfillSymbolResult(symbol="IDXX", outcome=BACKFILL_SYMBOL_OUTCOME_INCOMPLETE, reason="missing sessions 2026-04-01..2026-09-25")`;
   - expect `result["job"]["symbol_results"] == [{"symbol": "IDXX", "outcome": "incomplete", "reason": "missing sessions 2026-04-01..2026-09-25"}]` and `"IDXX" not in result["job"]["failed_symbols"]`.
   - This is a characterization test: it already passes after Step 8 (enum-derived projection).
2. **`test_tools_endpoint.py`.** Add `test_docs_and_skill_parity_with_incomplete_outcome`, asserting that `"incomplete"` appears in:
   - `_catalog()["get_backfill_status"]["description"]`;
   - the `### \`get_backfill_status\`` section of `docs/runbooks/mcp-tools.md`;
   - `plugins/strat-lab/skills/backtest/reference/backfill.md`;
   - `plugins/strat-lab/skills/backtest/SKILL.md`.
   This is the RED before Steps 17–18.
3. C-13: these are single-consumer inline protos, mirroring `_symbol_results_job` (compliant).

**Verification**:
```
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 1 — service: one-off NYSE closures and the post-2021 Juneteenth rule in `marketsession`
**Spec said**: Step 1 **Verification** runs three sequential lines, each starting `cd <dir> && …` from the previous line's directory (`cd packages/proto && …`, then `cd services/xstockstrat-portfolio && …`, then `cd services/xstockstrat-trading && …`); Step 2 is a separate `test` step with no `**Lands with**`.
**Actual**: Steps 1+2 executed as one unplanned atomic unit (one RED→GREEN, one commit). Each Step 1 Verification line ran from the repo root in its own subshell: `(cd packages/proto && …); (cd services/xstockstrat-portfolio && …); (cd services/xstockstrat-trading && …)`; commands unchanged otherwise.
**Reason**: Step 1's `go test ./marketsession/` has no test file without Step 2, so Step 1 cannot show its own RED→GREEN alone; and the second and third `cd` lines resolve relative to `packages/proto` when run in sequence, so they cannot run as written.
**Disposition**: folded Step 2 into Step 1 — test step pairs the service step's red-green (operator choice A, 2026-11-26); verification lines run in per-line subshells from the repo root.

### Deviation: Step 8 — proto-gen: regenerate stubs (ingest import assertion)
**Spec said**: Step 8 **Verification** ends `cd ../xstockstrat-ingest && uv run python -c "from gen.common.v1 import common_pb2; assert common_pb2.BACKFILL_SYMBOL_OUTCOME_INCOMPLETE == 4"`.
**Actual**: Ran `uv run python -c "import sys; sys.path.insert(0, 'tests'); import conftest; from gen.common.v1 import common_pb2; assert common_pb2.BACKFILL_SYMBOL_OUTCOME_INCOMPLETE == 4"`, after `uv sync --extra dev` (`conftest` imports pytest).
**Reason**: `gen.common.v1` is importable in ingest only through the path setup in `tests/conftest.py`; the bare import cannot resolve.
**Disposition**: operator choice A, 2026-11-26 — keep the assertion and give it the conftest's import path.

### Deviation: Steps 7+8 — `buf` and `buf-gen.sh` ran in the codegen container
**Spec said**: Step 7 runs `buf lint && buf breaking …` and Step 8 runs `./scripts/buf-gen.sh` on the host.
**Actual**: The host has no `buf` or `grpc_tools`, so those commands ran unchanged inside the pinned `Dockerfile.codegen` image (`xstockstrat-codegen`), with the worktree mounted at its host path and the main checkout's `.git` and `node_modules` mounted read-only. The rest of Step 8's chain (`git status`, `go build`, `uv run`) ran on the host. A second `buf-gen.sh` left the `packages/proto/gen/` diff byte-identical (sha256 compare).
**Reason**: buf 1.72.0 and the codegen plugins are pinned in that image; tooling-setup names Docker as the preferred codegen route.
**Disposition**: CI-equivalent fallback.
