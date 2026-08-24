"""Feature 152 — benchmark operand through RunBacktest (Step 3).

Covers AC-4 (insufficient benchmark history → INSUFFICIENT_DATA naming the benchmark),
AC-5 (determinism: same explicit window → identical metrics), AC-8 (the VOO-gated
multi-component dip-buy strategy backtests to a valid status and the benchmark is fetched).
Real ``marketdata_pb2.Bar`` fixtures; a per-symbol GetBars so the benchmark (VOO) and the
evaluated symbol (AAPL) return distinct series.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

from .test_analysis_servicer import (
    _DAY,
    _EOF_PAGE,
    _W_START,
    _bar,
    _owned_ctx,
    _points,
    _windowed_req,
    make_servicer,
)


def _sym_bars(symbol, n_prefix, n_window, base):
    bars = [_bar(_W_START + off * _DAY, base + off) for off in range(-n_prefix, n_window)]
    for b in bars:
        b.symbol = symbol
    return bars


def _wire_per_symbol(svc, bars_by_symbol):
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._indicators = MagicMock()

    async def _compute(req, **kw):
        return _points([float(i) + 1.0 for i in range(len(req.values))])

    svc._indicators.ComputeIndicator = AsyncMock(side_effect=_compute)

    svc._marketdata = MagicMock()

    async def _get_bars(req, **kw):
        return SimpleNamespace(page=_EOF_PAGE, bars=bars_by_symbol.get(req.symbol, []))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    return svc


def _mkt_def(period=5):
    """A single benchmark component 'mkt' (SMA on VOO) gating entries."""
    return analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": float(period)},
                source_symbol="VOO",
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
        exit_rule=json.dumps({"fn": "<", "lhs": "mkt", "rhs": 0}),
    )


@pytest.mark.asyncio
async def test_insufficient_benchmark_history_names_benchmark_in_coverage_gaps():
    """AC-4: VOO lacks warmup history → status INSUFFICIENT_DATA and coverage_gaps names VOO."""
    svc = make_servicer()
    # AAPL: plenty of prefix. VOO: only in-window bars (0 prefix) → warmup shortfall.
    bars = {
        "AAPL": _sym_bars("AAPL", n_prefix=30, n_window=10, base=100.0),
        "VOO": _sym_bars("VOO", n_prefix=0, n_window=10, base=50.0),
    }
    _wire_per_symbol(svc, bars)
    req = _windowed_req(_mkt_def(period=5), symbols=("AAPL",))

    result = await svc.RunBacktest(req, context=_owned_ctx())

    assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
    assert any(g.symbol == "VOO" for g in result.coverage_gaps)
    # Exactly one VOO gap even though it is shared by every evaluated symbol (loaded once).
    assert sum(1 for g in result.coverage_gaps if g.symbol == "VOO") == 1


@pytest.mark.asyncio
async def test_benchmark_backtest_is_deterministic_across_runs():
    """AC-5: two runs over the same explicit window return identical metrics."""
    bars = {
        "AAPL": _sym_bars("AAPL", n_prefix=30, n_window=15, base=100.0),
        "VOO": _sym_bars("VOO", n_prefix=30, n_window=15, base=50.0),
    }
    req = _windowed_req(_mkt_def(period=5), symbols=("AAPL",))

    svc1 = _wire_per_symbol(make_servicer(), bars)
    r1 = await svc1.RunBacktest(req, context=_owned_ctx())
    svc2 = _wire_per_symbol(make_servicer(), bars)
    r2 = await svc2.RunBacktest(req, context=_owned_ctx())

    assert r1.status == r2.status
    assert (r1.total_return, r1.sharpe_ratio, r1.max_drawdown) == (
        r2.total_return,
        r2.sharpe_ratio,
        r2.max_drawdown,
    )


@pytest.mark.asyncio
async def test_voo_gated_dip_buy_backtests_and_fetches_benchmark():
    """AC-8: a multi-component VOO-gated strategy backtests to a valid status and the
    benchmark (VOO) is actually fetched."""
    svc = make_servicer()
    bars = {
        "AAPL": _sym_bars("AAPL", n_prefix=30, n_window=20, base=100.0),
        "VOO": _sym_bars("VOO", n_prefix=30, n_window=20, base=50.0),
    }
    _wire_per_symbol(svc, bars)
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="dip",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="rsi",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="RSI",
                params={"period": 14.0},
            ),
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 5.0},
                source_symbol="VOO",
            ),
        ],
        entry_rule=json.dumps(
            {
                "op": "AND",
                "conditions": [
                    {"fn": "<", "lhs": "rsi", "rhs": 100},
                    {"fn": ">", "lhs": "mkt", "rhs": 0},
                ],
            }
        ),
    )
    req = _windowed_req(definition, symbols=("AAPL",))
    result = await svc.RunBacktest(req, context=_owned_ctx())

    assert result.status in (
        analysis_pb2.BACKTEST_STATUS_OK,
        analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA,
    )
    fetched = {c.args[0].symbol for c in svc._marketdata.GetBars.await_args_list}
    assert "VOO" in fetched  # the benchmark was loaded
