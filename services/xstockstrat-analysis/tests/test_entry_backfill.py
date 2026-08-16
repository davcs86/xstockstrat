"""
Unit tests for the boot-time Order-based entry-time backfill (feature 116).

Covers `_infer_open_entry_time`'s running-signed-balance inference (single round trip, flat
after a round trip, multi-crossing re-arming, zero-fill skip, unfiltered-status counting) and
`run_once`'s per-pair fan-out (seed + persist, skip-when-known, per-pair isolation, no-op
without a trading stub).
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from gen.trading.v1 import trading_pb2

from app.engine.entry_backfill import _infer_open_entry_time, run_once

_T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _order(side, filled_qty, updated_at, status=trading_pb2.ORDER_STATUS_FILLED):
    """A real trading_pb2.Order with a real, tz-aware updated_at Timestamp — entry_backfill.py
    reads it via `.ToDatetime(tzinfo=UTC)`, so a MagicMock stand-in won't round-trip."""
    o = trading_pb2.Order(side=side, filled_qty=filled_qty, status=status)
    o.updated_at.FromDatetime(updated_at)
    return o


def _strategy_row(
    strategy_id="s1", symbols=("AAPL",), user_id="u1", denied=None, signal_eligible=False
):
    dj = {}
    if symbols is not None:
        dj["signal_params"] = {"symbols": list(symbols)}
    if denied is not None:  # feature 132 — entry-only deny
        dj["denied_symbols"] = list(denied)
    if signal_eligible:
        dj["signal_eligible"] = True
    return {
        "user_id": user_id,
        "strategy_id": strategy_id,
        "display_name": strategy_id,
        "active": True,
        "live_enabled": True,
        "definition_json": dj,
    }


def _fake_live_loop(held=(), watchlist=(), signals=()):
    """A lightweight stand-in for LiveEvaluationLoop — run_once touches _last_state,
    _last_entry_at, _write_entry_cooldown, and (feature 132) the owner-scoped drains that source
    resolve_universe's union. The drains default to empty sets (a cold-boot portfolio outage)."""
    return SimpleNamespace(
        _last_state={},
        _last_entry_at={},
        _write_entry_cooldown=AsyncMock(),
        _drain_signals=AsyncMock(return_value=set(signals)),
        _drain_held=AsyncMock(return_value=set(held)),
        _drain_watchlist=AsyncMock(return_value=set(watchlist)),
    )


def _cfg():
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    return cfg


class TestInferOpenEntryTime:
    def test_infer_open_entry_time_single_round_trip(self):
        buy = _order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)
        assert _infer_open_entry_time([buy]) == _T0

    def test_infer_open_entry_time_flat_after_round_trip(self):
        buy = _order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)
        sell = _order(trading_pb2.ORDER_SIDE_SELL, 10.0, _T0 + timedelta(days=5))
        assert _infer_open_entry_time([buy, sell]) is None

    def test_infer_open_entry_time_multi_crossing(self):
        """Open Risk 3 — a flat→open→flat→open history must re-arm the candidate on the
        SECOND 0→nonzero crossing, not the first."""
        first_buy = _order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)
        sell = _order(trading_pb2.ORDER_SIDE_SELL, 10.0, _T0 + timedelta(days=5))
        second_buy = _order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0 + timedelta(days=20))
        result = _infer_open_entry_time([first_buy, sell, second_buy])
        assert result == _T0 + timedelta(days=20)
        assert result != _T0

    def test_infer_open_entry_time_skips_zero_fill_orders(self):
        buy = _order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)
        zero_fill = _order(
            trading_pb2.ORDER_SIDE_SELL,
            0.0,
            _T0 + timedelta(days=1),
            status=trading_pb2.ORDER_STATUS_EXPIRED,
        )
        # A zero-fill order must not perturb the running balance — the pair stays open at the
        # first BUY's time, not reset/cleared by the zero-fill SELL.
        assert _infer_open_entry_time([buy, zero_fill]) == _T0

    def test_infer_open_entry_time_counts_canceled_partial_fill(self):
        """A CANCELED order with a nonzero filled_qty must still count toward the open
        balance — status is deliberately unfiltered (a FILLED-only filter was rejected in
        design.md; a regression here would silently reproduce that rejected bug)."""
        partial_canceled = _order(
            trading_pb2.ORDER_SIDE_BUY,
            5.0,
            _T0,
            status=trading_pb2.ORDER_STATUS_CANCELED,
        )
        assert _infer_open_entry_time([partial_canceled]) == _T0


class TestRunOnce:
    async def test_run_once_seeds_live_loop_state_and_persists(self):
        live_loop = _fake_live_loop()
        db_pool = AsyncMock()
        db_pool.fetch = AsyncMock(return_value=[_strategy_row()])
        trading_stub = AsyncMock()
        trading_stub.ListOrders = AsyncMock(
            return_value=SimpleNamespace(orders=[_order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)])
        )

        await run_once(live_loop, db_pool, trading_stub, _cfg())

        key = ("u1", "s1", "AAPL")
        assert live_loop._last_state[key] is True
        assert live_loop._last_entry_at[key] == _T0
        live_loop._write_entry_cooldown.assert_awaited_once_with(key, _T0)

    async def test_run_once_skips_pairs_with_known_entry_time(self):
        live_loop = _fake_live_loop()
        key = ("u1", "s1", "AAPL")
        live_loop._last_entry_at[key] = _T0  # already known — no RPC needed
        db_pool = AsyncMock()
        db_pool.fetch = AsyncMock(return_value=[_strategy_row()])
        trading_stub = AsyncMock()
        trading_stub.ListOrders = AsyncMock()

        await run_once(live_loop, db_pool, trading_stub, _cfg())

        trading_stub.ListOrders.assert_not_awaited()

    async def test_run_once_swallows_per_pair_rpc_failure(self):
        live_loop = _fake_live_loop()
        db_pool = AsyncMock()
        db_pool.fetch = AsyncMock(
            return_value=[_strategy_row("s1", ("AAPL",)), _strategy_row("s2", ("MSFT",))]
        )
        trading_stub = AsyncMock()

        async def _list_orders(req):
            if req.strategy_id == "s1":
                raise RuntimeError("boom")
            return SimpleNamespace(orders=[_order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)])

        trading_stub.ListOrders = AsyncMock(side_effect=_list_orders)

        await run_once(live_loop, db_pool, trading_stub, _cfg())  # must not raise

        assert ("u1", "s1", "AAPL") not in live_loop._last_entry_at
        assert live_loop._last_entry_at[("u1", "s2", "MSFT")] == _T0

    async def test_run_once_noop_without_trading_stub(self):
        live_loop = _fake_live_loop()
        db_pool = AsyncMock()

        await run_once(live_loop, db_pool, None, _cfg())

        db_pool.fetch.assert_not_awaited()

    async def test_union_includes_held_denied_symbol(self):
        """feature 132: the backfill sources resolve_universe(...).union (NOT .universe), so a
        held-denied position still gets its entry anchor seeded (deny is entry-only and never
        applied on this hydration path)."""
        live_loop = _fake_live_loop(held=["AAPL"])  # owner holds AAPL
        db_pool = AsyncMock()
        # no allowlist, AAPL denied → union still = held = {AAPL}
        db_pool.fetch = AsyncMock(return_value=[_strategy_row("s1", symbols=None, denied=["AAPL"])])
        trading_stub = AsyncMock()
        trading_stub.ListOrders = AsyncMock(
            return_value=SimpleNamespace(orders=[_order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)])
        )

        await run_once(live_loop, db_pool, trading_stub, _cfg())

        assert live_loop._last_entry_at[("u1", "s1", "AAPL")] == _T0

    async def test_allowlist_free_pair_missed_on_portfolio_outage_allowlist_proceeds(self):
        """feature 132 accepted residual: with an empty (cold-boot outage) drain, an allowlist-free
        strategy's union is empty → its held pairs are missed this boot (self-heals next boot); an
        allowlist-bearing strategy in the same pass still proceeds (union ignores the drains)."""
        live_loop = _fake_live_loop(held=(), watchlist=(), signals=())  # outage → all empty
        db_pool = AsyncMock()
        db_pool.fetch = AsyncMock(
            return_value=[
                _strategy_row("free", symbols=None),  # allowlist-free → empty union under outage
                _strategy_row("bound", symbols=("MSFT",)),  # allowlist → proceeds regardless
            ]
        )
        trading_stub = AsyncMock()
        trading_stub.ListOrders = AsyncMock(
            return_value=SimpleNamespace(orders=[_order(trading_pb2.ORDER_SIDE_BUY, 10.0, _T0)])
        )

        await run_once(live_loop, db_pool, trading_stub, _cfg())

        # allowlist-bearing pair anchored; allowlist-free strategy contributed no pairs
        assert live_loop._last_entry_at[("u1", "bound", "MSFT")] == _T0
        assert not any(k[1] == "free" for k in live_loop._last_entry_at)
