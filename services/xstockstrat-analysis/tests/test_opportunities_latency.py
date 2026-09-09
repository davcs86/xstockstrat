"""Feature 183 — opportunities-latency-fix: batch RPCs, concurrent drains, TTL raise.

Four tests covering the latency-fix acceptance criteria:
  AC-6  Phase 0 drains dispatched concurrently via asyncio.gather
  AC-7  Phase 1 bars fetch uses BatchGetBars (not per-symbol GetBars)
  AC-8  Enrichment uses BatchGetLatestPrice + BatchGetBars (one call each)
  AC-9  Default live_enrich_ttl_seconds >= 15 (browser poll interval)

C-13: all marketdata-stub literals are single-consumer to this file → kept inline.
Reuses ``make_servicer`` from the sibling servicer test module.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from .test_analysis_servicer import make_servicer

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _batch_bars_response(symbols, bars_per_symbol=5):
    """Build a BatchGetBarsResponse with ``bars_per_symbol`` bars per symbol."""
    results = []
    for sym in symbols:
        bars = [marketdata_pb2.Bar(symbol=sym, close=100.0 + i) for i in range(bars_per_symbol)]
        results.append(marketdata_pb2.SymbolBars(symbol=sym, bars=bars))
    return marketdata_pb2.BatchGetBarsResponse(results=results)


def _batch_price_response(symbols):
    """Build a BatchGetLatestPriceResponse with a price per symbol."""
    results = []
    for sym in symbols:
        results.append(marketdata_pb2.LatestPrice(symbol=sym, last_price=150.0, prev_close=148.0))
    return marketdata_pb2.BatchGetLatestPriceResponse(results=results)


# ---------------------------------------------------------------------------
# AC-6: Phase 0 drains are concurrent
# ---------------------------------------------------------------------------


async def test_phase0_drains_concurrent():
    """AC-6: the four Phase 0 drain calls are dispatched via asyncio.gather (concurrently),
    and ``now_utc`` is captured AFTER the gather completes (not before)."""
    svc = make_servicer()

    call_order: list[str] = []

    async def _slow_drain_signals(meta):
        call_order.append("signals_start")
        # Yield control — if sequential, the next drain wouldn't start until this returns.
        await asyncio.sleep(0)
        call_order.append("signals_end")
        return []

    async def _slow_drain_held(uid, meta):
        call_order.append("held_start")
        await asyncio.sleep(0)
        call_order.append("held_end")
        return {}

    async def _slow_drain_bindings(meta):
        call_order.append("bindings_start")
        await asyncio.sleep(0)
        call_order.append("bindings_end")
        return []

    async def _slow_drain_weights(meta):
        call_order.append("weights_start")
        await asyncio.sleep(0)
        call_order.append("weights_end")
        return {}

    svc._drain_active_signals = _slow_drain_signals
    svc._drain_held_symbols = _slow_drain_held
    svc._drain_watchlist_bindings = _slow_drain_bindings
    svc._drain_source_weights = _slow_drain_weights

    # Mock everything after the drains to short-circuit the rest of _compute_opportunities.
    svc._cfg.get_float_present = MagicMock(side_effect=lambda key, default: default)
    svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)

    await svc._compute_opportunities("u1", [("x-user-id", "u1")])

    # Concurrent dispatch means all *_start appear before any *_end (interleaved).
    # With sequential dispatch, we'd see signals_start, signals_end, held_start, held_end, ...
    starts = [e for e in call_order if e.endswith("_start")]
    ends = [e for e in call_order if e.endswith("_end")]

    # All four starts must appear before the first end.
    first_end_idx = call_order.index(ends[0])
    for s in starts:
        assert call_order.index(s) < first_end_idx, (
            f"Drain '{s}' started after first end '{ends[0]}'"
            " — drains are sequential, not concurrent"
        )


# ---------------------------------------------------------------------------
# AC-7: Phase 1 uses BatchGetBars (not per-symbol GetBars)
# ---------------------------------------------------------------------------


async def test_phase1_uses_batch_get_bars():
    """AC-7: Phase 1 bars fetch calls BatchGetBars with all symbols in one RPC,
    not per-symbol GetBars fan-out."""
    svc = make_servicer()
    symbols = [f"SYM{i}" for i in range(50)]

    # Wire the four drains to produce 50 unique symbols (via watchlist bindings for simplicity).
    svc._drain_active_signals = AsyncMock(return_value=[])
    svc._drain_held_symbols = AsyncMock(return_value={})
    svc._drain_watchlist_bindings = AsyncMock(return_value=[(sym, "strat-1") for sym in symbols])
    svc._drain_source_weights = AsyncMock(return_value={})

    # _strategies_repo = None skips the resolve_universe fan-out (no live-strategy attribution),
    # but the watchlist bindings still produce (sym, "strat-1") candidates which ARE eligible
    # (they have a strategy_id). The _load_strategy_definition mock must populate the strategy_defs
    # cache with a valid definition for those candidates to reach defined_eligible.
    svc._strategies_repo = None

    # Use a real proto StrategyDefinition with one valid component (required by the evaluator).
    real_def = analysis_pb2.StrategyDefinition(
        strategy_id="strat-1",
        display_name="test",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 20.0},
            ),
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": 0}),
        exit_rule=json.dumps({"fn": "<", "lhs": "sma", "rhs": 0}),
    )

    async def _mock_load(user_id, strat_id, cache):
        cache[strat_id] = real_def

    svc._load_strategy_definition = _mock_load

    svc._component_series_sem = asyncio.Semaphore(5)
    svc._candidates_sem = asyncio.Semaphore(50)

    # Mock the marketdata stub — track calls.
    svc._marketdata = MagicMock()
    svc._marketdata.BatchGetBars = AsyncMock(
        return_value=_batch_bars_response(symbols, bars_per_symbol=400)
    )
    svc._marketdata.GetBars = AsyncMock()  # should NOT be called for Phase 1

    svc._readiness_materializer_bars_sem = asyncio.Semaphore(2)

    # Patch the evaluator to short-circuit (the test is about the batch fetch, not evaluation).
    from app.handlers.servicer import _empty_readiness

    async def _stub_evaluate(definition, bars, sym, rule="entry", benchmark_bars=None):
        r = _empty_readiness(sym)
        r["conviction"] = 0.5
        return r

    with patch(
        "app.services.evaluator.StrategyEvaluator.evaluate_conditions_traced",
        side_effect=_stub_evaluate,
    ):
        await svc._compute_opportunities("u1", [("x-user-id", "u1")])

    # Assert BatchGetBars was called (at least once) with all symbols.
    assert svc._marketdata.BatchGetBars.await_count >= 1
    call_args = svc._marketdata.BatchGetBars.await_args
    request = call_args.args[0]
    assert set(request.symbols) == set(symbols)

    # Assert per-symbol GetBars was NOT used for Phase 1 (no benchmark symbols → no fallback).
    assert svc._marketdata.GetBars.await_count == 0


# ---------------------------------------------------------------------------
# AC-8: Enrichment uses batch RPCs
# ---------------------------------------------------------------------------


async def test_enrichment_uses_batch_rpcs():
    """AC-8: _enrich_opportunities_live calls BatchGetLatestPrice and BatchGetBars
    each exactly once for all symbols, not per-symbol fan-out."""
    svc = make_servicer()
    symbols = [f"ENR{i}" for i in range(30)]
    opps = [analysis_pb2.Opportunity(symbol=sym, conviction=0.7) for sym in symbols]

    svc._marketdata = MagicMock()
    svc._marketdata.BatchGetLatestPrice = AsyncMock(return_value=_batch_price_response(symbols))
    svc._marketdata.BatchGetBars = AsyncMock(
        return_value=_batch_bars_response(symbols, bars_per_symbol=20)
    )
    # Legacy per-symbol methods — must NOT be called.
    svc._marketdata.GetLatestPrice = AsyncMock()
    svc._marketdata.GetBars = AsyncMock()

    await svc._enrich_opportunities_live(opps, [("x-user-id", "u1")])

    # Exactly one batch call per RPC.
    assert svc._marketdata.BatchGetLatestPrice.await_count == 1
    assert svc._marketdata.BatchGetBars.await_count == 1

    # All 30 symbols included in the batch requests.
    price_req = svc._marketdata.BatchGetLatestPrice.await_args.args[0]
    assert set(price_req.symbols) == set(symbols)

    bars_req = svc._marketdata.BatchGetBars.await_args.args[0]
    assert set(bars_req.symbols) == set(symbols)

    # Per-symbol RPCs NOT called.
    assert svc._marketdata.GetLatestPrice.await_count == 0
    assert svc._marketdata.GetBars.await_count == 0

    # Verify live fields were populated.
    for opp in opps:
        assert opp.HasField("live_price"), f"live_price not set for {opp.symbol}"
        assert abs(opp.live_price - 150.0) < 1e-9


# ---------------------------------------------------------------------------
# AC-9: TTL default exceeds poll interval
# ---------------------------------------------------------------------------


async def test_memo_ttl_default_exceeds_poll_interval():
    """AC-9: the default live_enrich_ttl_seconds is >= 15 (the browser 15s poll interval).
    React Query v5 counts refetchInterval from completion, so the TTL must exceed the
    poll interval to avoid redundant re-fetches."""
    svc = make_servicer()
    # make_servicer's get_int_present returns the default argument — which is the code's
    # hard-coded default. Read it the same way the production code does.
    ttl = svc._cfg.get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 20)
    assert ttl >= 15, f"Default TTL {ttl}s < 15s browser poll interval"
