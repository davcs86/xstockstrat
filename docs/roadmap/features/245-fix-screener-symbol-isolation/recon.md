# Recon: fix-screener-symbol-isolation

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-analysis

---

## Objective

`ScreenerEngine.screen()` fans out `_eval_symbol` with `asyncio.gather` and no `return_exceptions`
(`services/xstockstrat-analysis/app/services/screener.py:115`). `_eval_symbol` catches only
`grpc.RpcError` (`:229`), so one symbol's non-RPC exception aborts the whole `ScreenSymbols` RPC: UNKNOWN,
or INVALID_ARGUMENT for a `ValueError` (`app/handlers/servicer.py:3797-3800`). The fix isolates
per-symbol evaluation so a failing symbol degrades only its own row (FR-1). The scan deadline (FR-2) and
pre-fan-out request validation (FR-3) must keep failing the whole request. SEV-2, Track C.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13, uv)
  - Entry point: `serve()` — `app/main.py:39`; servicer registered `app/main.py:107`
  - Handler/servicer: `ScreenSymbols` — `app/handlers/servicer.py:3757-3810` (`@owner_scoped` `:3757`,
    def `:3758`)
    - deadline: `get_int("analysis.screener.max_duration_seconds", 120)` `:3786`, then
      `asyncio.wait_for(engine.screen(...))` `:3787-3790`, then `except TimeoutError` → DEADLINE_EXCEEDED
      `"screen exceeded {deadline}s deadline"` `:3791-3795`
    - `except ValueError` → INVALID_ARGUMENT `:3797-3800`. This is where a per-symbol `ValueError` is
      mislabelled today.
    - held cross-ref loop over `resp.results` `:3805-3809` (post-scan; unaffected)
  - Engine: `ScreenerEngine` — `app/services/screener.py`
    - `screen()` `:91`. `max_universe_size` `:92`; validation `_validate_fundamental_metrics` call
      `:110` (def `:377`, `@staticmethod` `:376`, raises `ValueError`) sits **before** the fan-out.
    - fan-out `per_symbol = await asyncio.gather(` `:115-127`, no `return_exceptions`, preserves
      `symbols` order
    - per-scan WARN summary reads `r["status"]`, `r["gap"]`, `r["bars_errored"]` `:131-145`
    - `_rank()` `:149-153`: `_normalize_universe`, `_build_result`, then sort
      `(r.score_unavailable, -r.score)` `:152`. Runs in `compute_executor` or `asyncio.to_thread`
      `:155-160`.
    - `coverage_gaps` from the full sorted list `:164-168`; `min_conviction` floor `:172-174`;
      `rank_limit` cap `:177-181`
    - `_eval_symbol` `:204`: row dict seeded `:207-216` (`symbol`, `raws {}`, `passes {}`,
      `signal_score 0.5`, `status OK`, `gap None`, `bars_errored False`). Only the GetBars `RpcError`
      is caught (`:229-231`). Unguarded `scoring.compute_signal_score` `:256`, reached only when
      `signals_map` is truthy (`:253`) and a latest bar exists (`:254-255`). Per-criterion loop
      `:262-277` sets `row["raws"]` progressively (`:276`). `_latest_indicator("RSI"/"ATR")` runs
      after the loop (`:284-285`).
    - raise sites outside any guard:
      - `_technical_value` `:331`: formula path under `self._sem` `:335`; `RpcError`-only catches at
        `:350` and `:369`
      - `_latest_indicator` `:288`: `RpcError`-only catch at `:299`
      - `_fundamental_value`: `float(...)` at `:404` and `:406`
      - `_latest_value`: the list branch is unguarded `:517`; the scalar branch catches
        `(TypeError, ValueError)` `:521`
    - `_fetch_signals` `:315`: returns `{}` unless `signal_sources` is set and `signal_weight > 0`
      (`:316-317`); `RpcError` caught `:327`
    - `_normalize_universe` `:409-437`: min-max over every row with `ref_name in row["raws"]`
      (`:413-417`)
    - `_build_result` `:439`
      - INSUFFICIENT_DATA early return with `passed=False` `:440-448`
      - default `passed = True` `:457`
      - `score_unavailable = weight_total <= 0 and len(criteria) > 0` `:479`
      - `pe`/`rsi`/`atr`/`rev_growth` read via `row.get(..., 0.0)` `:503-506`
    - logger `log = logging.getLogger(__name__)` `:37`; per-symbol WARN style
      `log.warning("GetBars failed for %s: %s", symbol, e)` `:230`
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`).
    Not needed.
  - Config-read pattern: `self._cfg.get_int("<key>", <default>)`, e.g. `screener.py:85` (semaphore),
    `:92`, `:177-179`; `servicer.py:3786`
  - Proto: `enum ScreenResultStatus` `packages/proto/analysis/v1/analysis.proto:483-487`
    (`UNSPECIFIED`/`OK`/`INSUFFICIENT_DATA` only); `bool score_unavailable = 14;` `analysis.proto:529`

## Patterns to REUSE

- **Per-symbol isolation via gather** → reuse `asyncio.gather(..., return_exceptions=True)` and then
  `isinstance(r, BaseException)` partitioning. Precedent: `app/admin_audit.py:58-59`. Others:
  `app/engine/entry_backfill.py:122`, plus the `return_exceptions` scope comment at
  `app/services/evaluator.py:436`. Constraint: a returned `asyncio.CancelledError` is a
  `BaseException`, so it must be re-raised, never turned into a degraded row (FR-2). The alternative
  isolation point is a wrapper with `except Exception` around `_eval_symbol`, which lets
  `CancelledError` through by construction (Python 3.13). Choosing between the two is a design fork.
- **Degraded-row marker** → reuse `ScreenResult.score_unavailable` (field 14, feature 144) with
  `passed=False`. It is the orthogonal additive bool, not a status overload (ledger insights.md:2280).
  It already sorts last via `:152` and already renders in `/insights/screener`
  (`page.tsx:184`, `:258`). No new enum value; do not use INSUFFICIENT_DATA (C-14 note in context.md).
- **Row shape** → reuse the `_eval_symbol` seed dict keys (`screener.py:207-216`) for a degraded row, so
  the WARN summary (`:131-145`), `_normalize_universe` and `_build_result` work unchanged. `status` must
  stay OK and `gap` None (keeps it out of `dataless_bars` and `coverage_gaps`). `bars_errored` stays
  False. `raws {}` keeps it out of normalisation. `pe`/`rsi`/`atr` default through `row.get`
  (`:503-506`).
- **`passed=False` forcing** → `_build_result` defaults `passed = True` (`:457`). A degraded row with
  empty raws and only soft criteria would otherwise come out passed=True with
  `score_unavailable=True` (`:479`), which is the `bef4258` scar
  (`services/xstockstrat-analysis/docs/context-constitution.md:41`). Reuse the existing fail-closed
  idiom: an explicit row flag read in `_build_result`, or a post-build override. Design picks.
- **WARN log** → reuse the `log.warning("<what> failed for %s: %s", symbol, e)` style at
  `screener.py:230` (module logger `:37`).
- **Engine-level tests (AC-1)** → `services/xstockstrat-analysis/tests/test_screener.py`
  (`asyncio_mode = "auto"` at `pyproject.toml:32`)
  - helpers: `make_cfg` `:19`, `bars` `:33`, `formula_resp` `:37`, `formula_criterion` `:43`,
    `make_engine` `:55`, `_timed_bar` `:566`
  - signal-weighted fixture template: `test_signal_weighted_screen_returns_ok_not_crash` `:572-618`
  - caplog WARN pattern: `:129-150`, `:153-175`
  - ranking and score_unavailable ordering: `test_soft_criterion_missing_data_flags_score_unavailable_and_ranks_last`
    `:335`
  - concurrency guards to keep green: `test_formula_evals_bounded_by_semaphore` `:625`,
    `test_screen_ranking_unchanged_by_concurrent_fanout` `:661`
  - FR-3 at engine level: `test_unknown_fundamental_metric_raises` `:468`
- **Servicer-level tests (AC-2, AC-3)** → `tests/test_analysis_servicer.py` `class TestScreenSymbols`
  `:1095`
  - helpers: `_ctx` `:1097`, `_svc` `:1109`, `_bars` `:1126`, `_formula_resp` `:1134`
  - abort pattern and effective AC-3: `test_unknown_metric_aborts_invalid_argument` `:1265`
    (abort assertions `:1278-1294`)
- **RED fixture discipline** → ledger insights.md:2486-2495 (feature 160). Supply at least 2 bars with
  `.time` on the last bar, and an in-window signal that moves the score off 0.5. Otherwise
  `_eval_symbol` short-circuits to INSUFFICIENT_DATA before `:256` and AC-1 passes on buggy code
  (P-06).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @regression @feature-160` "A signal-weighted screen returns results instead of
  crashing" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature:6`). A healthy
  signal-weighted `ScreenSymbols` still returns one ranked `SCREEN_RESULT_STATUS_OK` row per symbol
  and never UNKNOWN. The per-symbol guard must be transparent to healthy symbols.
- **PRESERVE** `@AC-2 @regression @feature-160` "compute_signal_score reads the bar time from the
  correct proto field" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature:14`).
  `compute_signal_score` reads `bar.time`, never `timestamp`, and returns 0.0-1.0. It is the AC-1
  failure-injection site, so its healthy-path contract must not change.
- **PRESERVE** `@AC-29 @FR-6 @feature-224` "Opportunity provenance and screener signal filter exclude
  other users' signals" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature:42`).
  The screener signal filter stays owner-scoped. Isolation must not turn a scoping error into a visible
  or leaked row.
- **PRESERVE** `@AC-3 @FR-3 @feature-201` "In live/screener the formula sees the current fundamentals
  snapshot" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:26`).
  Snapshot fundamentals come from `GetFundamentalsMulti` with no PIT lookup. Weak overlap; listed for
  completeness.
- **No CHANGE flags.** No existing `@AC-*` asserts that a single-symbol failure aborts the scan, so
  there is no C-16 sign-off obligation.
- **Not impacted:**
  - `analysis-concurrency-offload.feature` (`@feature-176`): the header mentions the screener, but no
    scenario covers the `ScreenSymbols` fan-out.
  - `opportunity-compute-robustness.feature` (`@feature-185`): a per-symbol-degradation precedent
    only, on a different RPC.
  - the opportunities/readiness suites (sibling gathers, out of scope)
  - `docs/sdd/business-rules/platform.feature`: no screener guarantee
- **Unguarded today:** the FR-2 deadline, FR-3 validation and `score_unavailable`/INSUFFICIENT_DATA
  semantics have no durable `@AC-*`. They live only in `services/xstockstrat-analysis/docs/context-constitution.md:41-42`
  and in code. This feature's AC-1..AC-3 become the first durable `ScreenSymbols` isolation, deadline
  and validation rules at launch (C-16 promotion).
- **Undocumented contract (note, not a guarantee):** keep bounded formula concurrency
  (`analysis.screener.max_concurrent_formula_evals`, `screener.py:84-86`) and the off-loop rank tail
  (`:155-160`) if the gather mechanics change.
- Coverage caveat (scenario-recon): 4 suites were read in full and 28 analysis suites were scanned by
  keyword grep only. A `ScreenSymbols` scenario without those keywords could have been missed.

## Dependencies

- Proto/RPC: none. The existing `ScreenResult.score_unavailable = 14` (`analysis.proto:529`) and
  `passed` cover a degraded row. Adding a `ScreenResultStatus` value (`:483-487`) would be a proto change
  (C-04/C-09 escalation).
- Migration: none (next free would be `028` in `services/xstockstrat-analysis/migrations/`)
- Config keys: none new. Existing reads: `analysis.screener.max_universe_size` (`screener.py:92`),
  `.max_concurrent_formula_evals` (`:85`), `.default_rank_limit` (`:177-179`), `.max_duration_seconds`
  (`servicer.py:3786`).
- Inter-service edges: unchanged (analysis → marketdata GetBars/GetFundamentals, indicators
  ExecuteFormula, ingest QuerySignals). Consumers of the changed response:
  - agent `screen_symbols` drops `score_unavailable` (`services/xstockstrat-agent/app/client.py:758-767`);
    the tool text says "Filter candidates on `passed`" (`services/xstockstrat-agent/app/tools.py:846`),
    so `passed=false` is load-bearing.
  - UI `/insights/screener` polls on INSUFFICIENT_DATA only (`page.tsx:122`, `:128`) and renders
    `scoreUnavailable` (`:184`, `:258`).
  - UI `SymbolScreening` reads `results[0]` and checks INSUFFICIENT_DATA only
    (`SymbolScreening.tsx:63-64`). It never reads `scoreUnavailable`; it shows per-criterion pass/fail
    badges (`:104-105`).
- New env vars / ports: none

## Risks / Not-found

- **Partial raws fork (open, design must pin).** A raise mid-loop (`:276`) or in `_latest_indicator`
  (`:284`) after the loop leaves partial `raws`. Because `_normalize_universe` normalises over every row
  carrying a raw (`:413-417`), kept raws shift the other 49 rows' scores. Design pins AC-1's oracle and
  writes it back into AC-1 as wording only, keeping the AC ID. A candidate oracle: each of the other 49
  rows equals the 49-symbol run without BAD. That candidate implies discarding BAD's raws. Ledger
  fails.md:804-822: universe-relative values must come from the intended membership.
- **Degraded-row shape fork (open).** Kept (`score_unavailable=true` + `passed=false`, status OK) or
  dropped. If kept, AC-1's "if present" must become "is present" so the test is red on buggy code (P-06).
  If dropped, `rank_limit`/`min_conviction` behaviour is unaffected, but the AI agent sees a silently
  missing symbol.
- **`SymbolScreening` single-symbol surface (C-14).** For a one-symbol scan, a kept degraded row with
  empty `criterion_raw_values` renders as "no criteria evaluated", not as an error, because the
  component reads no `scoreUnavailable`. Design must confirm that is acceptable or name a follow-up.
  The product-spec's no-UI-change claim is conditional on this.
- **Cancellation semantics.** With `return_exceptions=True`, an outer `wait_for` cancel still cancels
  the gather and its children. A child's own `CancelledError` comes back as a value and must be
  re-raised. Today, without `return_exceptions`, a raising child does not cancel its siblings (they run
  on, orphaned), and isolation removes that leak. Not verified by running.
- **FR-3 boundary.** Validation at `screener.py:110` precedes the fan-out. Isolation must wrap only the
  fan-out, never `screen()` as a whole, or the `ValueError` → INVALID_ARGUMENT mapping
  (`servicer.py:3797-3800`) is absorbed.
- **Aggregate-gate widening.** A new failure branch in a per-symbol loop must be checked against every
  downstream gate keyed on the old accumulators (ledger insights.md:1024-1027). Here those gates are
  the `dataless_bars` summary (`:131-145`), `coverage_gaps` (`:164-168`) and the `_build_result`
  `passed`/`score_unavailable` derivation (`:457`, `:479`).
- **Fail-closed rule.** An unevaluated gate never defaults to passed (ledger fails.md:2451-2465,
  `bef4258`). This applies directly to the degraded row.
- **Not found:**
  - no existing per-symbol `try/except Exception` or `return_exceptions` in `screener.py`
  - no existing scan-deadline test: `max_duration_seconds` appears in tests only as the `make_cfg`
    default at `test_screener.py:23`. AC-2 needs a new servicer test that overrides `_svc()`'s
    `get_int`.
  - no screener test raising a non-`RpcError` per symbol
  - no analysis-specific suite under `docs/sdd/business-rules/` (only `platform.feature`)
- **Not verified:** the AC-1 Example 2/3 raise paths (`_technical_value` ArithmeticError,
  `_latest_indicator` ValueError) are confirmed by reading the code, not by running it. Defect-report
  line anchors beyond those cited here were not re-checked.
- **Out of scope, still untracked:** sibling un-isolated gathers at `servicer.py:3983` (EvaluateReadiness)
  and `:5776` (opportunities `_row_for`, which catches only `RpcError` near `:5693-5696`). Each needs its
  own defect report (C-10 follow-up from the product-spec review).
- **Overlap:** feature 246 shares the analysis dir. Recheck at impl-spec that its scorer is not
  `scoring.compute_signal_score`, the AC-1 failure site (context.md re-review).

## Recommended Scope

Advisory; one service, no proto/migration/config.

1. **test (RED)**: AC-1 Scenario Outline in `tests/test_screener.py`, built from the `:572-618`
   signal-weighted template. Cover all three failure sites, the pinned score oracle, BAD's
   rank/`passed`/`score_unavailable`/status assertions, and a caplog WARN naming BAD. It must fail on the
   current code.
2. **service**: per-symbol isolation in `ScreenerEngine.screen()` / `_eval_symbol`
   (`screener.py:115-127`, `:204`). Use the chosen isolation point and degraded-row shape, discard
   partial raws per the pinned oracle, force `passed=False` (`_build_result` `:439-479`), keep the WARN
   log, and re-raise `CancelledError`.
3. **test (preservation)**: AC-2 deadline test (new) and an AC-3 check (reuse or extend
   `test_unknown_metric_aborts_invalid_argument` `:1265`) in `TestScreenSymbols`. Green before and
   after. Keep the existing concurrency and feature-160 tests green.
4. **docs**: update `services/xstockstrat-analysis/docs/context-constitution-findings.md:20` (Latent-bugs
   row → resolved), plus the context-constitution teardown.
