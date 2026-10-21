# Product Spec: fix-analysis-owner-scope

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-analysis-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-44.** `entry_backfill.run_once._backfill_pair` calls
  `trading_stub.ListOrders(ListOrdersRequest(strategy_id=strategy_id, symbol=symbol))` with no `user_id` and no
  metadata (`services/xstockstrat-analysis/app/engine/entry_backfill.py:71-73`). Trading applies no owner filter for
  an empty `user_id` (`services/xstockstrat-trading/internal/repository/trading_repo.go:229-231`). The owner-keyed
  `_last_state` / `_last_entry_at` slot (`:66`, `:80-82`) can be seeded from another owner's fills on the same
  `strategy_id`. That suppresses or mis-times the owner's live alerts after a restart. The sibling
  `GetStrategyAnalytics` call is owner-scoped (`app/handlers/servicer.py:6315-6317`).
- **D-55.** `run_once` documents "Never raises" (`entry_backfill.py:52`) but runs `db_pool.fetch` (`:59-61`) and the
  per-owner drains (`:90`, `:94`, `:103-108`) unguarded. The drains call `owner_metadata`, which raises `ValueError`
  for an empty or `system` owner (`app/identity.py:6-10`, `app/engine/live_loop.py:478,522,551`). The live loop
  catches it (`live_loop.py:393`); the backfill does not. One bad row ends the pass for every owner, silently
  (unretained task, `app/main.py:174`).
- **D-60.** `StrategiesRepository.update` is owner-agnostic (`app/repositories/strategies.py:110-124`,
  `WHERE strategy_id = $1`). It and `get_by_id` (`:89-97`) have zero callers in `app/`. 30 test references still mock
  `_strategies_repo.get_by_id`.

**Expected.** See § Functional Requirements.

**Who is affected.** Traders with live strategies. After an analysis restart, live entry/exit alerts (`/trader`
alert stream, notification inbox and push) can be suppressed or mis-timed by another owner's order history, or no
owner gets an entry backfill at all.

## Functional Requirements

- **FR-1 (D-44).** Every `ListOrders` call the entry-backfill makes for a live row carries that row's owner: the
  request `user_id` is the row's `user_id`, and the call is sent with `owner_metadata(user_id)` (`x-user-id` = owner).
  A failure building that metadata or making that call affects only that `(strategy, symbol)` pair; other pairs and
  owners are still backfilled.
- **FR-2 (D-44).** An owner's in-memory entry state (`_last_state` / `_last_entry_at`) and durable entry cooldown are
  seeded only from that owner's orders, never from another owner's fills on the same `strategy_id`.
- **FR-3 (D-55).** A failure while preparing one owner (its `owner_metadata` `ValueError`, or any exception from its
  held / watchlist / owner-signal drains) is logged as a warning naming the strategy and owner, that owner's rows are
  skipped, and the pass continues for every other owner.
- **FR-4 (D-55).** `run_once` never raises. If the initial live-strategies `db_pool.fetch` fails, it logs a warning and
  returns with nothing seeded. If `_drain_system_signals` fails, it logs a warning and continues with an empty
  system-signal set.
- **FR-5 (D-60).** The owner-agnostic `StrategiesRepository.get_by_id` and `StrategiesRepository.update` are
  **removed** (decided: both have zero callers in `app/`; the owner-scoped `get_by_owner_and_id` and `update_locked`
  already cover every servicer path). No strategies-repository method reads or writes a strategy by `strategy_id`
  alone.
- **FR-6 (D-60).** Analysis tests that mock `_strategies_repo.get_by_id` are retargeted to the methods the servicer
  actually calls (`get_by_owner_and_id`, `update_locked`, `list_live_enabled`, …); none references a removed method.

**Trading-domain notes.** No `BrokerType`, paper/live, order-execution or order-type behavior changes; no new env
vars, ports or services (C-1..C-4 not triggered). `_infer_open_entry_time` keys on `filled_qty`; partial-fill handling
(`PARTIALLY_FILLED` with non-zero `filled_qty` counting toward the open balance) is unchanged by this fix — only the
set of orders it receives is narrowed to the owner's.

## Consumer Surface(s)

- `/trader` live alert stream, notification inbox and push: live entry/exit alerts for the strategy owner are no
  longer suppressed or mis-timed by another owner's fills, and every eligible owner gets its boot entry-backfill
  (FR-1..FR-4). No UI code changes; the surface is affected only through the alerts analysis emits.
- FR-5 / FR-6 are internal/platform-only (repository and test hygiene; no consumer-visible change).

## Reproduction Steps

1. Live strategy `s-1` owned by `u-a` on `AAPL`. The trading stub returns, for an empty-`user_id` `ListOrders`, a
   filled BUY 10 `AAPL` for `u-b` only. After `run_once`, `("u-a","s-1","AAPL")` is seeded `True`.
2. A live row owned by `system` ahead of `u-a`. `run_once` raises `ValueError`, and `u-a` is never backfilled.
3. `grep -rn "def get_by_id\|def update(" services/xstockstrat-analysis/app/repositories/strategies.py` → 2 (both
   methods exist), while `grep -rn "_strategies_repo.get_by_id\|_strategies_repo.update(" services/xstockstrat-analysis/app`
   → 0 (no production caller). The same grep over `services/xstockstrat-analysis/tests` → 30 (28 in
   `test_analysis_servicer.py`, 2 in `test_readiness_opportunities_source_symbol.py`). Post-fix all three counts are 0.

## Root Cause Hypothesis

Pre-feature-133 assumption that `strategy_id` implies an owner, combined with trading's fail-open empty `user_id`; the
live loop's `ValueError` guard not mirrored into the backfill; leftover owner-agnostic repository methods. See the
report.

## Affected Services

- xstockstrat-analysis (fix site)
- xstockstrat-trading (`ListOrders` semantics; read-only here — its server-side scoping is tracked separately)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Trading-side `ListOrders` / `StreamOrderUpdates` header scoping and proto field documentation
  (`docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`, `open`)
- The generic unretained-task / supervised-loop helper (feature 259, D-07); this feature reuses it if it lands first
