"""Feature 152 — benchmark operand on the live evaluator (Step 4).

Covers AC-7: the live loop preloads a benchmark (source_symbol) over the live window
widened by that benchmark's own warmup (builtin AND custom-formula), threads it into
evaluate, and degrades safely (a failed benchmark fetch → omitted → the leaf reads hold,
never a crash). Real ``marketdata_pb2.Bar`` fixtures.
"""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from .test_live_loop import _bar_at, _decision, _make_loop


def _voo_bar(dt: datetime, close: float = 50.0):
    b = marketdata_pb2.Bar(symbol="VOO", close=close)
    b.time.FromDatetime(dt)
    return b


def _benchmark_def(*, formula=False, period=200.0):
    if formula:
        comp = analysis_pb2.StrategyComponent(
            ref_name="mkt",
            kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
            formula_id="f-1",
            source_symbol="VOO",
        )
    else:
        comp = analysis_pb2.StrategyComponent(
            ref_name="mkt",
            kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
            indicator="SMA",
            params={"period": period},
            source_symbol="VOO",
        )
    return analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        user_id="u1",
        display_name="S1",
        components=[comp],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )


@pytest.mark.asyncio
async def test_builtin_benchmark_loaded_over_warmup_widened_window():
    """AC-7: an SMA(200) benchmark is fetched over a window widened well beyond the 365-day
    live lookback so the gate is actually warm."""
    loop = _make_loop()
    loop._evaluator.declared_formula_warmups = AsyncMock(return_value={})
    now = datetime.now(UTC)
    loop._marketdata.GetBars = AsyncMock(
        return_value=SimpleNamespace(bars=[_voo_bar(now - timedelta(days=1))])
    )
    out = await loop._load_benchmark_bars(_benchmark_def(period=200.0))
    assert set(out) == {"VOO"}
    req = loop._marketdata.GetBars.await_args.args[0]
    assert req.symbol == "VOO"
    start_dt = req.range.start.ToDatetime(tzinfo=UTC)
    assert (now - start_dt).days > 365  # widened by the SMA(200) warmup


@pytest.mark.asyncio
async def test_formula_benchmark_window_spans_declared_warmup():
    """AC-7 (formula sub-case): a custom-formula benchmark's fetch window is widened by its
    declared warmup_period — the live path now plumbs the formula-warmup cache."""
    loop = _make_loop()
    loop._evaluator.declared_formula_warmups = AsyncMock(return_value={"f-1": 300})
    now = datetime.now(UTC)
    loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_voo_bar(now)]))
    await loop._load_benchmark_bars(_benchmark_def(formula=True))
    req = loop._marketdata.GetBars.await_args.args[0]
    start_dt = req.range.start.ToDatetime(tzinfo=UTC)
    # 365-day live window + a 300-bar formula warmup (converted to calendar days) → > 665.
    assert (now - start_dt).days > 365 + 300


@pytest.mark.asyncio
async def test_benchmark_fetch_failure_degrades_to_none_no_crash():
    """AC-7: a benchmark whose fetch raises is omitted (→ hold), never crashes the loop."""
    loop = _make_loop()
    loop._evaluator.declared_formula_warmups = AsyncMock(return_value={})
    loop._marketdata.GetBars = AsyncMock(side_effect=RuntimeError("boom"))
    out = await loop._load_benchmark_bars(_benchmark_def(period=200.0))
    assert out is None  # safe degrade


@pytest.mark.asyncio
async def test_eval_pair_threads_benchmark_bars_into_evaluate():
    """AC-7: _eval_pair fetches the benchmark and passes it to evaluate as benchmark_bars."""
    loop = _make_loop()
    loop._evaluator.declared_formula_warmups = AsyncMock(return_value={})
    loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, False)])
    now = datetime.now(UTC)
    bars_by = {"AAPL": [_bar_at(now)], "VOO": [_voo_bar(now)]}

    async def _gb(req, **kw):
        return SimpleNamespace(bars=bars_by.get(req.symbol, []))

    loop._marketdata.GetBars = AsyncMock(side_effect=_gb)

    await loop._eval_pair(_benchmark_def(period=1.0), "AAPL", throttle=0)  # must not raise

    call = loop._evaluator.evaluate.await_args
    benchmark_arg = call.args[3] if len(call.args) > 3 else call.kwargs.get("benchmark_bars")
    assert benchmark_arg is not None and "VOO" in benchmark_arg
