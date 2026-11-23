# Recon: fix-analysis-evidence-dry

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached @ origin/main-dev c4fd48b0a (`feature/fix-analysis-evidence-dry` did not exist on origin at recon time; this push creates it). Discovery digests were UNSTAMPED; every `path:line` below was re-grepped at this tree.
**Affected services**: xstockstrat-analysis, xstockstrat-indicators (read-only source of formula content/version)

---

## Objective

Close two analysis single-source-of-truth gaps on the strategy evidence/live path. (1) The
evidence-eligibility fingerprint hashes only the strategy's `definition_json`, so editing a formula
that a CUSTOM_FORMULA component references (in indicators) leaves pre-edit evidence cells in the
headline grade (ANALYSIS-3 "fingerprint blind spot"). (2) The boot entry-backfill re-types the
live-gate SQL instead of using `LIVE_ENABLED_PREDICATE_SQL`, so the two could drift (ANALYSIS-7).

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13, pytest via `uv run pytest`, coverage floor 40%)
  - Fingerprint helper: `_definition_fingerprint` — `services/xstockstrat-analysis/app/handlers/servicer.py:7285`
    (sync, pure, module-level; filters `_FINGERPRINT_EXCLUDED_KEYS` at `:7282`/`:7298`, then
    `json.dumps(sort_keys=True, separators=(",", ":"))` and sha256 hex). Its docstring states the rule:
    hash only a DB-returned row's `definition_json`; `None`/`{}` hash identically.
  - The 7 call sites, all `_definition_fingerprint(<row>["definition_json"])`, split by store:
    - **Evidence cells** (`backtest_run_symbols.definition_fingerprint`):
      - `servicer.py:924` in `_run_backtest` (`run_fingerprint`)
      - `:2882` in `_fetch_and_aggregate` (grade derivation)
      - `:5267` in `_retry_unavailable_symbols` (`fingerprint=` kwarg)
    - **Readiness cache** (`analysis.readiness_cache.def_fingerprint`):
      - `:4011` in `EvaluateReadiness`
      - `:4208` in `GetWatchlistReadiness`
      - `:4294` in `_kick_readiness_refresh` (a sync `def`)
      - `:6107` in `_materialize_readiness_for_owner`
    - So **one helper feeds both fingerprints**. Changing the helper also moves the readiness-cache key.
  - Evidence reads:
    - `fetch_eligible` — `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py:67`
    - `fetch_all_for_fingerprint` — `backtest_run_symbols.py:88`
  - Readiness freshness: `is_readiness_row_fresh` — `services/xstockstrat-analysis/app/services/readiness.py:16`,
    which compares `row["def_fingerprint"] == fingerprint` at `:25`. Storage is in `app/repositories/readiness_cache.py:33,53-57`.
  - Existing GetFormula reads:
    - `servicer.py:731` and `:759` (evaluate path)
    - `:1935` (fundamentals map)
    - `:2544` (warmup cache, per-call `cache`/`deleted_cache`/`failures` dicts)
    - `app/engine/fundsignal_loop.py:558`
    - Refusal codes: `UNREADABLE_FORMULA_CODES = (NOT_FOUND, PERMISSION_DENIED)` at `app/services/evaluator.py:104`
    - Warning helper: `_deleted_formula_warning` at `servicer.py:243`
  - Live-gate constant: `LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"` at
    `services/xstockstrat-analysis/app/repositories/strategies.py:19`
    - Used by `StrategiesRepository.list_live_enabled` (`strategies.py:223`, `:229`)
    - Used by `app/engine/live_loop.py:52` (import) and `:373` (f-string)
  - Defect site: `services/xstockstrat-analysis/app/engine/entry_backfill.py:65`, the literal
    `"SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"`.
    - It is inside `run_once`, in a try/except that logs a warning and returns.
    - Module-top imports: `entry_backfill.py:22` (`app.engine.live_loop`), `:23` (`app.handlers.servicer`), `:24` (`app.identity`).
    - The docstring (`:11`) says "Imported ONLY by main.py, never by live_loop.py (no cycle)".
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`)
    - The next free number is `028`. The "migration 028 (feature 184)" cited in analysis `CLAUDE.md` is an `xstockstrat-config` seed, a different series (fails.md:2699).
  - Invariants: `services/xstockstrat-analysis/docs/context-constitution.md:19` (ANALYSIS-3, which already names the formula blind spot) and `:23` (ANALYSIS-7, which already says the "import cycle" justification does not hold).
- **`xstockstrat-indicators`** (Python 3.13, coverage floor 50%), with no change expected
  - Proto: `FormulaDefinition.updated_at = 7` — `packages/proto/indicators/v1/indicators.proto:169`
  - Mapper sets it from the row: `services/xstockstrat-indicators/app/handlers/servicer.py:862`, `:888`
  - `updated_at = NOW()` is set in two places:
    - `_UPSERT_SQL` (`services/xstockstrat-indicators/app/services/formulas_repository.py:55-70`, set at `:70`), called by `upsert` (`:152`) from `app/services/seed_formulas.py:34`
    - `_UPDATE_SQL` (set at `:79`)
  - So `updated_at` **moves on every UpdateFormula and on every boot seed upsert**, whether or not the content changed.
  - Last migration: `007_private_formulas_templates.up.sql`. None needed.

## Patterns to REUSE

- Entry-backfill selection → import `LIVE_ENABLED_PREDICATE_SQL` from `app/repositories/strategies.py:19`.
  - Follow the f-string usage in `app/engine/live_loop.py:52,373`.
  - Or call `StrategiesRepository.list_live_enabled` (`strategies.py:212-229`).
  - A top-level import is cycle-safe: `strategies.py` is a leaf, and `entry_backfill.py` already imports `live_loop`, which imports it.
- Formula content read for the fingerprint → reuse the lazy one-`GetFormula`-per-distinct-`formula_id` cache from `servicer.py:2526-2564` (`cache`/`deleted_cache`/`failures`).
  - Read with owner metadata, `owner_metadata(user_id)` from `app.identity`.
  - Treat a refusal as `UNREADABLE_FORMULA_CODES` (`evaluator.py:104`).
- Formula "version" input → the choice is between `FormulaDefinition.updated_at` and a content hash (`source`, `parameters`, `outputs`, `warmup_period`, `fundamental_inputs`). This is a design fork (see Risks).
- CUSTOM_FORMULA component discovery → filter on `comp.kind == COMPONENT_KIND_CUSTOM_FORMULA` and `comp.formula_id`, as at `servicer.py:724-767`.
- Regression-test homes:
  - AC-2: `services/xstockstrat-analysis/tests/test_entry_backfill.py`. It provides the `_strategy_row()` helper and the `db_pool.fetch = AsyncMock(...)` pattern. Capture the SQL passed to `fetch` and assert the constant is in it, mirroring the pin at `tests/test_analysis_servicer.py:6995,7021`.
  - AC-1: `tests/test_analysis_servicer.py` (~2208-2240) and `tests/test_unreadable_formula.py`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-11 @FR-9 @feature-215` "The derived grade excludes refused symbols without deleting evidence" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`). Grade derivation reads cells for the current fingerprint and never deletes cells. Any invalidation design must be non-destructive and keep the guard-exclusion/UNKNOWN semantics.
- **PRESERVE** `@AC-23 @FR-5 @FR-7 @regression @feature-289` "With the fundamentals gate on, a refused formula no longer blocks ScoreStrategy; an outage still does" (same file).
  - A formula fetch for the fingerprint must not abort ScoreStrategy on NOT_FOUND or PERMISSION_DENIED.
  - UNAVAILABLE still aborts.
  - Making a refusal fatal would be a CHANGE that needs sign-off.
- **PRESERVE** `@AC-2 @regression @feature-194` "a rename of an existing dirty strategy does not change its fingerprint" (`services/xstockstrat-analysis/acceptance/fix-strategy-signal-params-dead-keys.feature`). The fingerprint must not move on non-behavioural edits. Strategies without a CUSTOM_FORMULA component should keep a byte-identical fingerprint.
- **PRESERVE** `@AC-6 @FR-5 @feature-152` "manage_strategy normalizes source_symbol and folds it into the fingerprint" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`). `definition_json` stays fingerprint-sensitive, and the formula input is additive.
- **PRESERVE** the feature-262 boot entry-backfill rules (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature`):
  - `@AC-1 @FR-1`, `@AC-2 @FR-2`, `@AC-3 @FR-3`, `@AC-8 @FR-3`, `@AC-9 @FR-4`: owner-scoped ListOrders (`user_id` plus `x-user-id`) and per-owner failure isolation. The swapped selection must still return the owner column.
- **PRESERVE** `@AC-4 @FR-4` "A failed live-strategies read ends the backfill quietly" and `@AC-5 @FR-4` "A failed system-signal drain does not stop the backfill" (same file). The selection failure is still caught with a warning and no raise.
- **PRESERVE** `@AC-6 @FR-5 @regression @feature-262` "The strategies repository offers no owner-agnostic read or write" (same file). Reuse `list_live_enabled`; never add `get_by_id` or `update`.
- **PRESERVE** `@AC-3 @regression @feature-193` "the boot entry-backfill anchors the blend only inside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`).
- **PRESERVE** `@AC-6 @FR-6 @feature-180` "A watchlist binding to a non-live strategy is not materialized" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`). The live-gate semantics (`active AND live_enabled`) are unchanged.
- **PRESERVE** `@AC-7 @FR-6 @feature-205` "An authored fundamentals formula behaves identically as a strategy component" (`docs/sdd/business-rules/platform.feature`). Evaluation is unchanged; only the hashing changes.
- **PRESERVE** `@AC-23 @FR-11 @feature-224` "System special-cases are unchanged" (`docs/sdd/business-rules/platform.feature`). The UpdateFormula permission and contract are untouched.
- **EXTEND** (no existing guarantee): feature AC-1, "the fingerprint follows referenced formula content", is new. No suite asserts the current blind spot, so no CHANGE sign-off is needed.
- Both affected services have acceptance suites.

## Dependencies

- Proto/RPC: none. The fix reads existing `indicators.v1.GetFormula` → `FormulaDefinition` (`updated_at = 7` at `packages/proto/indicators/v1/indicators.proto:169`).
- Migration: none. `028` is free for `services/xstockstrat-analysis/migrations/` only if the design chooses a stored re-fingerprint (Open Question 2).
- Config keys: none.
- Inter-service edges: analysis → indicators `GetFormula`, which already exists. It would now be reached from the fingerprint path too, including `_run_backtest`, `_fetch_and_aggregate`, `_retry_unavailable_symbols` and possibly the readiness paths. The read must be as the strategy owner.
- New env vars / ports: none.

## Risks / Not-found

- **Shared helper (design fork).** The evidence and readiness-cache fingerprints come from the same `_definition_fingerprint`.
  - Widening it re-keys `readiness_cache` too, which also has a formula-staleness gap of its own.
  - Two choices:
    - (a) Widen both. Readiness rows get a one-time recompute, and the change touches 7 sites.
    - (b) Add a separate evidence-only fingerprint for the 3 evidence sites. This leaves the readiness behaviour (`@AC-3 @feature-180` fp-old/fp-new) untouched.
- **`updated_at` vs content hash (design fork).** Hashing `updated_at` re-fingerprints every strategy on the seeded system formula on **every indicators boot**, because the seed upsert sets `updated_at = NOW()` unconditionally (`formulas_repository.py:70`, via `seed_formulas.py:34`). That breaks `@AC-2 @feature-194`-style stability. A content hash of the behavioural `FormulaDefinition` fields avoids this. Those wire field names were not verified in this recon.
- **Sync to async.**
  - `_definition_fingerprint` is sync and called from the sync `_kick_readiness_refresh` (`servicer.py:4294`).
  - Folding in formula content needs either a pre-resolved formula map passed as a parameter or a new async resolver.
  - Each call site needs its owner's metadata. The boot path (`_fetch_and_aggregate`, ~`:2880`) defaults to `owner_metadata(user_id)`.
- **Refused or deleted formula contribution.** NOT_FOUND or PERMISSION_DENIED needs a defined, deterministic fingerprint contribution (for example a `"<id>:unreadable"` sentinel). It must not abort (`@AC-23 @feature-289`). UNAVAILABLE needs a decision: abort or fall back. A fallback must not silently stamp a wrong fingerprint.
- **One-time reset (Open Question 2).**
  - Any widening shifts the fingerprint of every existing CUSTOM_FORMULA strategy, so its evidence stops counting. The rows are kept, never deleted, per `@AC-11 @feature-215`.
  - "Carry forward" would need a stored re-stamp, which means migration `028` or a backfill.
- **Cost.** Grade derivation and backtests gain one extra `GetFormula` per distinct formula per call. Reuse the per-call cache.
- **Out of scope but noted.** ANALYSIS-7 also lists Python-side gate mirrors (`row.get("active") and row.get("live_enabled")` in `_retry_unavailable_symbols` and `_load_strategy_definition`). They are not SQL and not in this feature's reports.
- **Not read in this recon.** I did not open the two defect reports themselves; the problem is taken from product-spec.md. I did not open the `services/xstockstrat-indicators/tests` harness.
- **Ledger traps that apply.**
  - fails.md:2255: bind a shared constant rather than re-typing the literal. SQL-text assertions only prove the string was built, so pair them with the existing pin pattern.
  - fails.md:2699: migration-number "drift" can be a different series.
  - fails.md:1152 / 1531: any new cross-entity read must be owner-scoped. This covers the formula reads as the strategy owner.
  - fails.md:2659: a hand-made call-site list misses sites. Enumerate fingerprint sites by grep, which gives all 7 above.

## Recommended Scope

Advisory only.

1. **Step 1 (AC-2).**
   - `entry_backfill.py` imports `LIVE_ENABLED_PREDICATE_SQL` and uses it at `:65`. Keep the owner column and the try/except.
   - Add a red-first test in `tests/test_entry_backfill.py` that captures the `fetch` SQL.
   - Amend the ANALYSIS-7 text in `docs/context-constitution.md`.
2. **Step 2 (AC-1).**
   - Add a formula-aware evidence fingerprint: the definition hash plus a sorted `(formula_id, content-hash or unreadable-sentinel)` list. Use it only when a CUSTOM_FORMULA component exists, so other strategies stay byte-identical.
   - Resolve formulas with an owner-scoped, per-call cached `GetFormula`.
   - Wire it into the 3 evidence sites (`:924`, `:2882`, `:5267`). Whether readiness sites follow is the design's call (see Risks).
   - Tests: a formula edit changes the fingerprint; no formula means a byte-identical fingerprint; a refused formula is deterministic and does not abort.
3. **Step 3 (docs).** Update ANALYSIS-3 to remove the blind spot, `docs/scoring.md`, and the analysis `CLAUDE.md` pointer. Record the rollout reset decision (Open Question 2) in `context.md`.
