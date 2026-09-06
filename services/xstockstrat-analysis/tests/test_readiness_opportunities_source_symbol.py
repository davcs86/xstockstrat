"""Feature 152 — benchmark operand on the readiness + opportunities surfaces (Step 5).

Covers AC-2 (the traced leaf resolves the benchmark component from the benchmark symbol's own
bars) and the once-per-pass benchmark dedup (OT-3: one VOO fetch shared across a compute
pass). Real ``marketdata_pb2.Bar`` fixtures so the date-keyed join has real dates.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf import json_format

from .test_analysis_servicer import _EOF_PAGE, _HEADERS, _ctx, make_servicer


def _real_bars(symbol, closes, start=datetime(2025, 1, 2, tzinfo=UTC)):
    out = []
    for i, c in enumerate(closes):
        b = marketdata_pb2.Bar(symbol=symbol, close=c)
        b.time.FromDatetime(start + timedelta(days=i))
        out.append(b)
    return out


def _benchmark_strategy_row(threshold=100.0):
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        active=True,
        live_enabled=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
                source_symbol="VOO",
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": threshold}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _svc_with(bars_by_symbol):
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_id = AsyncMock(return_value=_benchmark_strategy_row())
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_benchmark_strategy_row())
    svc._marketdata = MagicMock()

    async def _get_bars(req, metadata=None):
        return SimpleNamespace(page=_EOF_PAGE, bars=bars_by_symbol.get(req.symbol, []))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    return svc


@pytest.mark.asyncio
async def test_readiness_resolves_benchmark_from_benchmark_symbol():
    """AC-2: the 'mkt' leaf passes because VOO (>100), NOT AAPL (<100), drives it."""
    svc = _svc_with(
        {
            "AAPL": _real_bars("AAPL", [1.0, 2.0, 3.0]),  # would FAIL mkt>100 if used
            "VOO": _real_bars("VOO", [120.0, 130.0, 150.0]),  # passes mkt>100
        }
    )
    resp = await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
        _ctx(_HEADERS),
    )
    r = resp.readiness[0]
    assert r.passing_conditions == 1 and r.total_conditions == 1
    assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_PASS
    # The benchmark VOO was fetched.
    fetched = {c.args[0].symbol for c in svc._marketdata.GetBars.await_args_list}
    assert "VOO" in fetched


@pytest.mark.asyncio
async def test_readiness_benchmark_gap_holds_when_benchmark_symbol_absent():
    """A benchmark component whose symbol has no bars → the leaf does not pass (hold)."""
    svc = _svc_with(
        {
            "AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0]),  # high, but 'mkt' is on VOO
            "VOO": [],  # no benchmark data → mkt reads gap → not passing
        }
    )
    resp = await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
        _ctx(_HEADERS),
    )
    r = resp.readiness[0]
    assert r.passing_conditions == 0


@pytest.mark.asyncio
async def test_windowed_benchmark_load_dedups_across_a_pass():
    """OT-3: benchmark bars are fetched at most once per compute pass via the shared cache."""
    svc = make_servicer()
    svc._marketdata = MagicMock()

    async def _get_bars(req, metadata=None):
        return SimpleNamespace(page=_EOF_PAGE, bars=_real_bars("VOO", [10.0, 11.0, 12.0]))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    definition = analysis_pb2.StrategyDefinition(
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
                source_symbol="VOO",
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    range_msg = common_pb2.TimeRange()
    cache: dict = {}
    out1 = await svc._load_benchmark_bars_windowed(definition, range_msg, (), cache=cache)
    out2 = await svc._load_benchmark_bars_windowed(definition, range_msg, (), cache=cache)

    assert "VOO" in out1 and "VOO" in out2
    voo_fetches = [c for c in svc._marketdata.GetBars.await_args_list if c.args[0].symbol == "VOO"]
    assert len(voo_fetches) == 1  # one fetch shared across the pass


# ---------------------------------------------------------------------------
# FR-2 (feature 176) — EvaluateReadiness parallelizes the per-symbol fan-out under
# _bars_fetch_sem: verdicts + order equal the serial baseline, the GetBars peak is
# capped at the configured bound (default 2), and a large request stays bounded.
#
# C-13: the simple-strategy row + counting-svc factory are single-consumer within this
# section → inline is compliant (mirrors _svc_with above).
# ---------------------------------------------------------------------------


def _simple_strategy_row(threshold=100.0):
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        active=True,
        live_enabled=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": threshold}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _counting_readiness_svc(bars_by_symbol, delay=0.02):
    """A servicer whose GetBars records peak in-flight concurrency (single event loop → plain
    counter; the await yields, letting concurrent fetches accumulate). No benchmark component,
    so the ONLY GetBars calls are the per-symbol readiness fetches."""
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_id = AsyncMock(return_value=_simple_strategy_row())
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_simple_strategy_row())
    svc._marketdata = MagicMock()
    state = {"in_flight": 0, "peak": 0}

    async def _get_bars(req, metadata=None):
        state["in_flight"] += 1
        state["peak"] = max(state["peak"], state["in_flight"])
        await asyncio.sleep(delay)
        state["in_flight"] -= 1
        return SimpleNamespace(page=_EOF_PAGE, bars=bars_by_symbol.get(req.symbol, []))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    return svc, state


@pytest.mark.asyncio
async def test_readiness_parallel_verdicts_and_order_preserved():
    """AC-2: the parallel fan-out emits one entry per requested symbol, IN request order, with
    the same deterministic verdicts the serial loop produced (even symbols pass sma>100, odd fail).
    """
    symbols = [f"SYM{i}" for i in range(20)]
    bars = {
        s: _real_bars(s, [120.0, 130.0, 150.0] if i % 2 == 0 else [1.0, 2.0, 3.0])
        for i, s in enumerate(symbols)
    }
    svc, _ = _counting_readiness_svc(bars, delay=0)

    resp = await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=symbols),
        _ctx(_HEADERS),
    )

    assert [r.symbol for r in resp.readiness] == symbols  # membership + order preserved
    assert [r.passing_conditions for r in resp.readiness] == [
        1 if i % 2 == 0 else 0 for i in range(20)
    ]


@pytest.mark.asyncio
async def test_readiness_bars_fetch_bounded_by_sem():
    """AC-2 (teeth): 6 symbols, blocking GetBars — peak in-flight fetches is EXACTLY 2, the
    configured analysis.opportunity.max_concurrent_bars_fetches default (the same bound the
    opportunity path uses). Serial (pre-176) would peak at 1."""
    symbols = [f"SYM{i}" for i in range(6)]
    bars = {s: _real_bars(s, [120.0, 130.0, 150.0]) for s in symbols}
    svc, state = _counting_readiness_svc(bars, delay=0.02)

    await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=symbols),
        _ctx(_HEADERS),
    )

    assert state["peak"] == 2


@pytest.mark.asyncio
async def test_readiness_large_request_stays_bounded():
    """Open risk (design.md): a 200-symbol request stays bounded — peak in-flight ≤ 2 (fetches
    are gated, not one-coroutine-per-symbol simultaneously), and every symbol still gets an entry.
    """
    symbols = [f"SYM{i}" for i in range(200)]
    bars = {s: _real_bars(s, [120.0, 130.0, 150.0]) for s in symbols}
    svc, state = _counting_readiness_svc(bars, delay=0.005)

    resp = await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=symbols),
        _ctx(_HEADERS),
    )

    assert len(resp.readiness) == 200
    assert state["peak"] <= 2
