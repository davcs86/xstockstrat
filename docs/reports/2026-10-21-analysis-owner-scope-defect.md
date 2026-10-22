# Defect: Analysis entry-backfill reads trading orders with no owner scope, dies on one bad owner, and analysis keeps an owner-agnostic strategy update method

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: cross-tenant-state-leak
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-analysis, xstockstrat-trading
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-44, D-55, D-60. Grouped by service + theme (owner scoping in analysis). The scan rated D-55 and D-60 one level lower; D-55 is in the same `entry_backfill.run_once` as D-44, and D-60 is the same tenant hazard (a `strategy_id`-only query) in the strategies repository. Trading is listed because D-44 depends on how `ListOrders` treats an empty `user_id`. The trading-side fix belongs to the separate open report `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md` and is not absorbed here.

## Observed

### D-44 — Entry-backfill reads trading orders with no owner scope

At boot, `entry_backfill.run_once` seeds the live loop's per-owner `(user_id, strategy_id, symbol)` state from trading
order history. Its `ListOrders` request carries only `strategy_id` and `symbol`: no `user_id` and no metadata. Trading
filters by the body `user_id` and applies no filter when it is empty. So the call returns every user's orders for
that `strategy_id` and `symbol`. Strategy ids are per-owner since feature 133, so `strategy_id` alone does not identify
an owner. Owner A's `_last_entry_at` and `_last_state=True` can be seeded from owner B's fills on a shared
`strategy_id`, which suppresses or mis-times A's live alerts after a restart. The inline comment claims "ListOrders
stays owner-implicit via the order's own user_id", which is not true. The sibling call in `GetStrategyAnalytics`
passes `user_id=user_id` and propagation metadata.

### D-55 — `entry_backfill.run_once` says "Never raises" but one bad owner kills the boot pass

The docstring promises "Never raises". But `db_pool.fetch` and the per-owner drains (`_drain_held`,
`_drain_watchlist`, `_drain_owner_signals`), plus `_drain_system_signals` and `_resolve_fundamentals_universe`, run
outside any try. The drains call `owner_metadata(owner)`, which raises `ValueError` for an empty or `system` owner,
and they do so before their own try. The live loop guards this exact case with `except ValueError` and skips the
strategy. The backfill does not, so one such row ends the whole boot pass, and no other owner is backfilled. The task
is unretained (`main.py:174`), so the failure is silent.

### D-60 — `strategies.get_by_id` / `strategies.update` have no app callers, and `update` is owner-agnostic

`StrategiesRepository.update` writes `WHERE strategy_id = $1` with no owner predicate. `get_by_id` is an
owner-agnostic lookup whose docstring says it is "retained for callers that legitimately already hold the row's owner
(e.g. the live loop ...)". There are no such callers in `app/`. Because strategy ids are per-owner, any future caller
of `update` could overwrite another owner's strategy. About 30 test references still mock `_strategies_repo.get_by_id`,
so those mocks are stale.

## Expected

- D-44: the backfill's `ListOrders` passes the row owner's `user_id` and `owner_metadata(user_id)`. Only that owner's
  orders seed that owner's key.
- D-55: `run_once` honours "never raises" per owner. An owner whose drains raise (including the `ValueError` for an
  empty or `system` owner) is logged and skipped, and every other owner is still backfilled.
- D-60: the owner-agnostic `update` (and the caller-less `get_by_id`) are removed or made owner-scoped. Stale test
  mocks are moved to the owner-scoped methods the servicer actually calls.

## Reproduction

1. D-44: seed `analysis.strategies` with live strategy `s-1` for owner `u-a` on symbol `AAPL`. Have the trading stub
   return the orders a real `ListOrders{strategy_id:"s-1", symbol:"AAPL"}` returns with an empty `user_id`: one filled
   BUY 10 `AAPL` for user `u-b`, and none for `u-a`. Run `entry_backfill.run_once`. The key `("u-a","s-1","AAPL")` is
   seeded with `_last_state=True` from `u-b`'s order. Inspect the captured request: `user_id` is empty and no metadata
   is sent.
2. D-55: add a live strategy row whose `user_id` is `system` ahead of a valid owner `u-a`. `run_once` raises
   `ValueError("owner-scoped call needs a real owner, got 'system'")`, and `u-a` is never backfilled.
3. D-60: `grep -rn "_strategies_repo.get_by_id\|_strategies_repo.update(" services/xstockstrat-analysis/app` → 0 hits;
   the method body has no owner predicate.

## Evidence

### D-44

`services/xstockstrat-analysis/app/engine/entry_backfill.py:63-73` (scan cited `:64-65`, `:71-73`; unchanged)
> # never read by the loop. ListOrders stays owner-implicit via the order's own user_id.
> ...
> resp = await trading_stub.ListOrders(
>     trading_pb2.ListOrdersRequest(strategy_id=strategy_id, symbol=symbol)
> )

`services/xstockstrat-analysis/app/handlers/servicer.py:6315-6317` (scan cited `:6316`; sibling, owner-scoped)
> orders_resp = await self._trading.ListOrders(
>     trading_pb2.ListOrdersRequest(strategy_id=strategy_id, user_id=user_id),
>     metadata=propagation_meta,

`services/xstockstrat-trading/internal/service/trading.go:1587` and
`services/xstockstrat-trading/internal/repository/trading_repo.go:229-231` (an empty `user_id` adds no predicate)
> if userID != "" {
>     query += fmt.Sprintf(" AND user_id = $%d", i)

### D-55

`services/xstockstrat-analysis/app/engine/entry_backfill.py:52` (docstring "Never raises"), `:59-61` (fetch), `:90`,
`:94`, `:103-108` (drains outside any try; unchanged)

`services/xstockstrat-analysis/app/identity.py:6-10`
> def owner_metadata(owner: str) -> list[tuple[str, str]]:
>     """Owner metadata for an outbound call; raises ValueError for an empty or `system` owner."""

`services/xstockstrat-analysis/app/engine/live_loop.py:478,522,551` (drains call `owner_metadata` before their try) and
the live loop's own guard at `:393`
> except ValueError as e:
>     log.warning("live_loop: strategy %s skipped — %s", definition.strategy_id, e)

`services/xstockstrat-analysis/app/main.py:174` (unretained `create_task`)

### D-60

`services/xstockstrat-analysis/app/repositories/strategies.py:89-97` (`get_by_id`), `:110-124` (`update`; unchanged)
> UPDATE analysis.strategies
>    SET display_name = $2, definition_json = $3::jsonb, updated_at = NOW()
>  WHERE strategy_id = $1

Stale mocks: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`,
`tests/test_readiness_opportunities_source_symbol.py` (30 `_strategies_repo.get_by_id` references in total).

## Root cause hypothesis

The entry-backfill predates feature 133's per-owner strategy ids and still assumes `strategy_id` implies an owner. The
trading API makes an omitted `user_id` mean "all users", so the omission fails open. The per-owner drain guard was
added to the live loop but not mirrored into the backfill. The repository kept its pre-133 owner-agnostic methods after
the servicer moved to `get_by_owner_and_id` / `update_locked`.

## Confidence

high
