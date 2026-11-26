# Recon: fix-gapsonly-backfill-is

**Created**: 2026-11-26
**From**: product-spec.md
**Tree**: feature/fix-gapsonly-backfill-is@8fd60e54 (origin/main-dev@34f68c57 is 1 commit ahead, not merged in; the cited code paths were re-grepped on this tree)
**Affected services**: xstockstrat-marketdata, xstockstrat-ingest (code change); xstockstrat-ui, xstockstrat-agent (consumer surfaces)
**Severity**: SEV-2 (Track C, dev / main-dev)

---

## Objective

A GAPS_ONLY daily-bar backfill must fetch every missing trading session in its requested range,
including interior holes bounded by stored bars on both sides (FR-1). It must never end COMPLETED
while a requested session is still missing (FR-2). It must still fetch nothing for a fully covered
range (FR-3). The root cause is confirmed in code: marketdata's coverage read returns only
(MIN, MAX, COUNT), so `ComputeGaps` can express only head and tail gaps. Ingest's GAPS_ONLY planner
consumes those gaps verbatim, and ingest's terminal-status logic never checks that the range was
actually filled.

## Codebase Map

- **`xstockstrat-marketdata`** (Go; run tests with `GOWORK=off`)
  - Entry point: `services/xstockstrat-marketdata/cmd/server/main.go:37` (`main`). The WatchConfig subscription is at `:63` and gRPC registration at `:182`.
  - Handler: `internal/handler/marketdata_handler.go:214` (`GetDataCoverage`). The gRPC adapter is at `:443`.
  - Service: `internal/service/marketdata_service.go:500` (`MarketDataService.GetDataCoverage`).
    - The doc comment at `:498` says the RPC is deliberately permissive on 15m/1h.
    - `s.repo.GetCoverage(...)` at `:526`; response built at `:531`.
    - `covered_ranges` is built as one range from earliest to latest at `:539`, even when holes exist. That is also misleading.
    - `timeframe.ComputeGaps(...)` at `:545`.
  - Root cause, gap math: `internal/timeframe/timeframe.go:84` (`ComputeGaps(reqStart, reqEnd, earliest, latest, count)`).
    - Doc at `:83`: "No bars → whole window; else only leading/trailing segments (interior holes out of scope)."
    - `type Gap` at `:77`; `Interval` at `:32`.
  - Root cause, repo: `internal/repository/marketdata_repo.go:243` (`GetCoverage`). It runs `SELECT MIN(time), MAX(time), COUNT(*)` (`:245`) over `marketdata.ohlcv` for a symbol, timeframe and window.
  - Last migration: `010_symbol_profile.up.sql` (`services/xstockstrat-marketdata/migrations/`). No migration is planned.
  - Trading-session calendar (already a marketdata dependency): `packages/proto/marketsession/marketsession.go`.
    - Header (`:1-2`): NYSE regular session in America/New_York; early closes and one-off closures are not modelled.
    - `SessionDate` `:22`, `DayStart` `:33`, `IsTradingDay` `:47`, `PrevTradingDay` `:56`, `isHoliday` `:74` (unexported; rule-based, with `observed` at `:98`).
    - Imported by `internal/service/delisting.go:12` (used at `:128`, `:162-163`).
    - It resolves through `go.mod:11` `github.com/xstockstrat/contracts v0.0.0` plus `replace … => ../../packages/proto` (`go.mod:49`). `packages/proto/go.mod` declares `module github.com/xstockstrat/contracts`.
  - Tests: `internal/timeframe/timeframe_test.go:97` (`TestComputeGaps`: no bars, leading, trailing, full, reversed). No service- or repo-level `GetDataCoverage` test exists.

- **`xstockstrat-ingest`** (Python 3.13, `uv run pytest --cov=app --cov-fail-under=40`)
  - Entry point: `services/xstockstrat-ingest/app/main.py:43` (`serve`). The servicer is registered at `:105`.
  - GAPS_ONLY planner: `app/handlers/servicer.py:787` (`_plan_work_ranges`).
    - It calls `GetDataCoverage` per symbol at `:801`.
    - It makes one `([sym], gs, ge)` unit per `cov.gaps` entry at `:807-810`.
    - `range_start` defaults to `range_end - 365d`.
  - Executor: `servicer.py:814` (`_execute_backfill`).
    - Chunk planning: `window_days` at `:824`.
    - Empty plan → early COMPLETED with `chunks_total=0` (`:834-845`). This is the FR-3 path.
  - Terminal status (FR-2 hook): `servicer.py:868` (`_finalize_backfill`).
    - `:881` FAILED if `chunks_failed > 0 and chunks_done == 0`.
    - `:883-884` PARTIAL if any failed symbol or chunk.
    - `:886` otherwise COMPLETED.
    - Nothing compares stored bars against the requested sessions.
    - Alert paths are at `:906` and `:917-918` (PARTIAL).
  - Fundamentals path (separate, not GAPS_ONLY-bars): `servicer.py:757-758`, PARTIAL if `failed`, else COMPLETED.
  - Chunk runner: `servicer.py:981` (`_run_chunks`).
  - Per-symbol results plumbing:
    - `_FUNDAMENTALS_RESULTS_KEY` `:308`.
    - `_merged_symbol_results` `:317` (precedence FAILED > SKIPPED > EMPTY).
    - `_record_attempt` `:335`.
    - `job_row_to_proto` `:349`.
    - The JSONB column `ingest.backfill_jobs.symbol_results` comes from migration `018_backfill_symbol_results`.
  - Last migration: `018_backfill_symbol_results.up.sql` (`services/xstockstrat-ingest/migrations/`). No migration is planned.
  - Config-read pattern: `app/config/watcher.py:129-130` (`backfill_chunk_window_days` → `int_positive(self, "backfill.chunk_window_days", 90)`).
  - Tests:
    - `tests/test_ingest_servicer.py:1100` (`test_gaps_only_plans_from_coverage_gaps`). It mocks `svc._marketdata.GetDataCoverage = AsyncMock(...)` and calls `svc._run_backfill`.
    - Helpers `_make_backfill_req` `:909` and `_self_serve_req` `:438`.
    - Self-serve denial fixture: `tests/fixtures/self_serve_denial.json` (exists).

- **`xstockstrat-ui`** (Next.js; consumer surface, no code change expected)
  - "Backfill missing data" on `/trader` position detail: `src/app/trader/positions/[symbol]/page.tsx`.
    - `useBackfillStatus` `:1203`; `FillMode.GAPS_ONLY` `:1269`; `data-testid="backtest-backfill-action"` `:1327`.
    - The "Backfill coverage" card counts only COMPLETED jobs as coverage (per digest, `:1504`; not re-grepped), so a false COMPLETED inflates it.
  - Status text: `src/lib/backtestBackfill.ts:72` (`backfillJobMessage`), PARTIAL case at `:90`.
    - `BackfillJobLike` `:20` has no still-missing-ranges field.
  - The terminal-status helper includes PARTIAL: `src/hooks/useBackfills.ts:17`.
  - Non-admin GAPS_ONLY on the strategies page: `src/app/insights/strategies/[id]/page.tsx:547`.
  - Tests:
    - vitest `src/lib/backtestBackfill.test.ts` (`pnpm run test:unit`).
    - Playwright `e2e/insights/backtest-coverage.spec.ts` and `e2e/trader/position-detail.spec.ts`.
    - Fixtures go in `e2e/fixtures/` + `INVENTORY.md` (C-12).

- **`xstockstrat-agent`** (Python; pure passthrough, no code change expected)
  - Client:
    - `_FILL_MODE_MAP` `app/client.py:2080`.
    - `trigger_backfill` `:2086`.
    - `_BACKFILL_OUTCOME_PREFIX` `:2169`.
    - `_backfill_job_to_dict` `:2172`. It uses MessageToDict, so a new `BackfillJob` field surfaces automatically, and outcome names are derived from the enum.
    - `get_backfill_status` `:2193`.
  - MCP tools: `trigger_backfill` `app/tools.py:1663`, `get_backfill_status` `:1758`.
  - Doc-sync contract test: `tests/test_tools_endpoint.py:129` and `:135` require `"gaps_only"` in the runbook, the skill reference and `SKILL.md`.
  - strat-lab skill mentions: `plugins/strat-lab/skills/backtest/SKILL.md:218`, `plugins/strat-lab/skills/backtest/reference/backfill.md:18`.

- **Other `GetDataCoverage` callers (not in the affected list, but regression-relevant)**: `xstockstrat-analysis` `app/handlers/servicer.py`.
  - The callers are at `:4110` (EvaluateReadiness), `:4195` (GetWatchlistReadiness) and `:6161` (readiness materializer).
  - All three consume only `cov.latest`, over a 10-day probe window (`_READINESS_COVERAGE_PROBE_DAYS`, `:330`).
  - The comments at `:326-329` and `:4103-4104` rely on `GetDataCoverage` being a cheap "MIN/MAX/COUNT metadata read" on a per-symbol, per-read hot path.
  - `rg` found no other non-generated, non-test callers in `services/`.

## Patterns to REUSE

- Trading-session definition (pins the C-14/C-15 calendar concern from review) → reuse `marketsession.IsTradingDay` / `SessionDate` / `DayStart` at `packages/proto/marketsession/marketsession.go:22,33,47`. It is already imported by marketdata (`internal/service/delisting.go:12`). Do not add a second calendar.
- Interior gaps on the wire → reuse the existing `repeated common.v1.TimeRange gaps = 7` on `GetDataCoverageResponse` (`packages/proto/marketdata/v1/marketdata.proto:186`). It can already carry N gaps, so FR-1 needs no proto change. `CoverageRange{start, end, bar_count}` (`:180`) can carry true contiguous segments.
- Gap derivation → extend `timeframe.ComputeGaps` (`internal/timeframe/timeframe.go:84`) or add a sibling pure function, kept unit-testable in `timeframe_test.go:97`. This follows insights "extract pure guard/builder functions before writing unit tests".
- Planner → keep `_plan_work_ranges` consuming `cov.gaps` unchanged (`servicer.py:807-810`). Once marketdata returns interior gaps, FR-1 is satisfied on the ingest side with no planner change. Chunking (`backfill.chunk_window_days`, `chunk_max_bars`) already applies per unit.
- FR-2 terminal state → reuse `BACKFILL_STATUS_PARTIAL = 5` (`ingest.proto:59`) and the existing PARTIAL alert path (`servicer.py:917-918`). The UI already renders PARTIAL (`backtestBackfill.ts:90`, `useBackfills.ts:17`), and the agent's status filter already lists `partial`.
- FR-2 verification → re-query `GetDataCoverage` after the chunks finish, with the same call shape as the planner (`servicer.py:801-805`). This is a candidate only; the cost and the interaction with the vendor-has-no-bar carve-out are for the grilling.
- Reporting still-missing ranges (AC-2) → reuse `BackfillJob.symbol_results = 16` (`ingest.proto:50`) / `common.v1.BackfillSymbolResult` (`common.proto:164`) via `_record_attempt` / `_merged_symbol_results` (`servicer.py:317,335`). Two tradeoffs for design:
  - `BackfillSymbolResult` has no date-range field. The range would go into the free-text `reason`, or into a new additive field or outcome.
  - A new `BackfillSymbolOutcome` value would project through the agent automatically (`client.py:2169`), but it changes the documented `get_backfill_status` shape, which triggers the strat-lab skill sync.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-15 @FR-6 @feature-343` "A non-admin request outside the self-serve envelope is denied with its reason" (`services/xstockstrat-ingest/acceptance/backtest-inline-backfill.feature`). Non-admins may only request GAPS_ONLY. Denial tokens and format stay unchanged (`tests/fixtures/self_serve_denial.json`).
- **PRESERVE** `@AC-7 @FR-6 @feature-343` "A non-admin user can run the inline backfill" (`services/xstockstrat-ingest/acceptance/backtest-inline-backfill.feature`). The job is accepted as QUEUED.
- **PRESERVE** `@AC-2 @FR-2 @feature-343` "The backfill covers the missing range through the end of the backtest window" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`). The UI sends a daily GAPS_ONLY no-overwrite request.
- **EXTEND** `@AC-9 @FR-5 @feature-343` "A partial or canceled backfill says so and can be retried" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`). FR-2's non-COMPLETED outcome (likely PARTIAL) must render with retry. Add a case if a new message or status is introduced.
- **PRESERVE** `@AC-6 @FR-5 @feature-343` "A failed backfill reports its error and can be retried" and `@AC-16 @FR-5 @feature-343` "A failed backfill with no error text reports its chunk counts" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`).
- **PRESERVE** `@AC-4 @FR-4 @feature-343` "A completed backfill offers a re-run and does not run it" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`). COMPLETED must still mean the data is ready.
- **PRESERVE** `@AC-13 @FR-5 @feature-343` "A gap the vendor cannot fill is reported instead of offering the backfill again" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`, line 91). This is in tension with FR-2: its precondition is that the backfill "has completed" while a vendor-unfillable gap remains. Design must reconcile this. If such a job no longer ends COMPLETED, this is a **CHANGE** that needs user sign-off in `context.md`.
- **PRESERVE** `@AC-3 @FR-3 @feature-343` "Progress is shown inline while the backfill runs" and `@AC-14 @FR-3 @feature-343` "Progress without a bar total shows no fraction" (`services/xstockstrat-ui/acceptance/backtest-inline-backfill.feature`). These cover the `bars_processed` / `bars_total` semantics.
- **PRESERVE** `@AC-23 @FR-7 @feature-352` "An unresolvable flagged symbol is skipped in a bars backfill" (`services/xstockstrat-marketdata/acceptance/delisted-symbol-handling.feature:94`). The job ends COMPLETED with the symbol `skipped`, not failed. This is in direct tension with FR-2: the "still missing" rule must carve out skipped symbols.
- **PRESERVE** `@AC-13 @FR-8 @feature-352` "A failing symbol that is not flagged still fails the job" (`services/xstockstrat-marketdata/acceptance/delisted-symbol-handling.feature:70`).
- **PRESERVE** `@AC-11 @FR-7 @feature-352` "An unresolvable flagged symbol is skipped and the job completes" (`services/xstockstrat-marketdata/acceptance/delisted-symbol-handling.feature`). This preserves the `written|empty|skipped|failed` outcome and metric vocabulary.
- **EXTEND** `@AC-14 @FR-9 @FR-11 @feature-352` "The job status carries the per-symbol reason" (`services/xstockstrat-agent/acceptance/delisted-symbol-handling.feature:8`). AC-2's still-missing ranges are added to the status result. If the shape changes, the strat-lab `backtest` skill is updated in the same PR.
- **PRESERVE** `@AC-24 @FR-9 @feature-352` "A symbol with no data in range is reported empty" (`services/xstockstrat-agent/acceptance/delisted-symbol-handling.feature:24`). `empty` stays distinct from "missing sessions".
- **PRESERVE** `@AC-2 @FR-2 @feature-261` "A backfill canceled while queued stays CANCELED and never runs", `@AC-3 @FR-4 @feature-261` "A canceled backfill is not resumed after a restart" and `@AC-6 @FR-3 @feature-261` "A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL" (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature:18,32,55`). CANCELED stays final; no new terminal-state rule may override it.
- **PRESERVE** `@AC-1 @regression @feature-153` "A 400-day bars query over the ohlcv hypertable locks few enough chunks to succeed" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature:10-11`). Any new per-timestamp or session coverage scan over a 365-day default window (or wider, up to 2000-01-01 when start is unset, `marketdata_service.go:518-524` per digest) must stay within the chunk-lock budget.
- **PRESERVE** `@AC-5` / `@AC-9 @FR-5 @feature-204` MCP `query_bars` (`services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature`) and `@AC-1 @FR-1 @feature-204` UI OHLCV query (`services/xstockstrat-ui/acceptance/backfilled-data-queryable.feature`). These are the read paths that verify AC-1.
- No existing acceptance suite pins `GetDataCoverage` / `ComputeGaps` semantics in xstockstrat-marketdata. The head/tail behavior is pinned only by `TestComputeGaps`.
- `docs/sdd/business-rules/platform.feature` has no scenario on GAPS_ONLY, coverage or gaps; its only hits are `ingest.backfill.*` config-key rows.
- Blind spot: `webhook-fanout-callback.feature` (ingest and agent) was keyword-matched only. Check it if FR-2 adds a new terminal state, because the completion webhook is keyed on terminal status.

## Dependencies

- Proto/RPC: none required for FR-1, since `GetDataCoverageResponse.gaps = 7` already carries N gaps (`marketdata.proto:186`); the next free response field is 8. FR-2/AC-2 may want an additive field on `BackfillJob` (`ingest.proto:33`; `symbol_results = 16` at `:50`) or on `BackfillSymbolResult` (`common.proto:164`), or a new `BackfillSymbolOutcome` value (`common.proto:156`). Any of these must be additive and goes through the proto approval gate.
- Migration: none. The next numbers, if ever needed, are marketdata `011` and ingest `019`.
- Config keys: none new. The existing ingest keys `backfill.chunk_window_days` (90), `backfill.chunk_max_bars` (200000) and `backfill.max_concurrent_chunks` (3) apply to the interior-hole units.
- Inter-service edges: existing only, ingest → marketdata (`GetDataCoverage`, `BackfillBars`) and analysis → marketdata (`GetDataCoverage` readiness probes). No new edges.
- New env vars / ports: none.

## Risks / Not-found

- **FR-2 carve-out ambiguity** (needs a design decision and an AC scenario, per the review warning). The open question is how to separate "the vendor legitimately has no bar" (halted, not yet listed, early close or one-off closure that `marketsession` does not model) from "missing".
  - This conflicts with `@AC-23 @feature-352` (skipped symbol → COMPLETED) and `@AC-13 @feature-343` (vendor-unfillable gap after "completed").
  - Without a carve-out, every IPO'd-mid-range symbol, or any one-off closure (e.g. a national day of mourning), would end PARTIAL forever under GAPS_ONLY.
- **Calendar completeness**: `marketsession` does not model one-off closures (`marketsession.go:1-2`), and the package has no test file on disk. Using it as the "every trading session" oracle for AC-1 could produce phantom gaps on unmodelled closures. Design must decide whether that is acceptable or covered by the carve-out.
- **Hot-path cost**: analysis calls `GetDataCoverage` on every readiness read and relies on it being a MIN/MAX/COUNT metadata read (`analysis servicer.py:326-329,4103-4104`). Changing the RPC to scan per-bar timestamps for every caller adds cost there. Options: keep the scan bounded, or make interior-gap computation request-gated (an additive request field).
  - Ledger insight 064 "always-included vs opt-in response shape" applies: re-check the RPC's size and latency contract for all callers.
- **`covered_ranges` is already wrong** with holes (`marketdata_service.go:539`, a single earliest–latest range). It is in scope only if design chooses to correct it. No in-repo consumer of `covered_ranges` was found.
- **Status-gate widening trap** (insights `fix-custom-formula-allnone`): when a per-item loop gains a new failure path, the aggregate status gate keyed only on the old signals (`_finalize_backfill` `:881-886`) must be widened. Otherwise the job silently reports COMPLETED, which is exactly this bug.
- **Doc-drift trap** (fails `2026-08-02 mcp-tools-alignment-triage`): a change to the `get_backfill_status` observable shape must update `tools.py` docstrings, `docs/runbooks/mcp-tools.md`, the agent `CLAUDE.md:35` and the strat-lab skill (`SKILL.md:218`, `reference/backfill.md:18`) in the same PR (`docs/patterns/strat-lab-plugin.md`). The contract test at `test_tools_endpoint.py:129,135` covers only the `gaps_only` token.
- **int64 serialization**: AC-3's `bars_processed 0` appears via MessageToDict as the string `"0"` (insights `trigger-backfill-mcp-tool — reuse`).
- **Daily only**: `BackfillBars` rejects non-`1d` (feature 143). `GetDataCoverage` stays permissive on 15m/1h (`marketdata_service.go:498`); do not "fix" that asymmetry.
- Not found or not verified:
  - No marketdata service- or repo-level test for `GetDataCoverage`.
  - No ingest test covers an interior hole or "COMPLETED while sessions missing".
  - No range-bearing field on `BackfillSymbolResult`.
  - `fix-ohlcv-chunk-lock-oom` was read only for its scenarios, not its chunk-interval value.
  - The UI coverage card line `:1504` is cited from the digest only.

## Recommended Scope

Advisory; input to the grilling and `/sdd-spec`.

1. **marketdata, gap math (test first)**: add interior-hole cases to `TestComputeGaps`. Then implement session-aware gap derivation from stored session dates in a pure function in `internal/timeframe`, using `marketsession`. Adjacent missing sessions merge into one `Gap`.
2. **marketdata, repo and service**: add a bounded per-session-date read (distinct `SessionDate` of stored 1d bars in the window) or a SQL anti-join, and wire it into `GetDataCoverage` for `1d`. Leave `.earliest` and `.latest` untouched for the analysis probes. Decide whether to gate it and whether to correct `covered_ranges`.
3. **ingest, FR-2**: after the chunks complete, re-verify the requested range for each GAPS_ONLY symbol. If sessions are still missing, end PARTIAL and record the still-missing ranges per symbol in `symbol_results`. Honor the carve-out (skipped/delisted, and the vendor-has-no-bar rule as decided), CANCELED precedence, and the FR-3 empty-plan COMPLETED path.
4. **Consumer surfaces (C-14)**:
   - UI: verify PARTIAL renders the FR-2 case (EXTEND `@AC-9`), with a vitest case plus a mock-backend scenario.
   - Agent: no code change expected. If the status shape changes, update the docs, runbook and strat-lab skill in the same PR and add an agent `@AC` (EXTEND `@AC-14 @feature-352`).
5. **Acceptance**: add a scenario for the FR-2 carve-out once it is decided (review warning). Map AC-1, AC-2 and AC-3 to RED tests in marketdata (Go) and ingest (pytest).
