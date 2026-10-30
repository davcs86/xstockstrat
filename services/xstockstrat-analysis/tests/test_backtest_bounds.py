"""Feature 272 (fix-analysis-backtest-bounds) — @AC-6.

A ``_BarFetchError`` (re-served page) fails the whole RunBacktest as FAILED_PRECONDITION
``backtest bar series incomplete: …`` with nothing persisted — for an evaluated symbol and
for the benchmark preload alike.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import grpc
import pytest

from .test_analysis_servicer import _EOF_PAGE, _owned_ctx, _windowed_req, make_servicer
from .test_backtest_source_symbol import _mkt_def, _sym_bars, _wire_per_symbol


def _stuck_on(svc, bars_by_symbol, stuck_symbol):
    """GetBars re-serves the same page with a non-empty token for ``stuck_symbol``."""

    async def _get_bars(req, **kw):
        bars = bars_by_symbol.get(req.symbol, [])
        if req.symbol == stuck_symbol:
            return SimpleNamespace(bars=bars, page=SimpleNamespace(next_page_token="stuck"))
        return SimpleNamespace(bars=bars, page=_EOF_PAGE)

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)


def _assert_failed_precondition_no_persistence(svc, ctx):
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION
    assert ctx.abort.await_args.args[1].startswith("backtest bar series incomplete:")
    svc._persist_symbol_cells.assert_not_awaited()
    svc._persist_backtest_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_truncated_symbol_fails_run_failed_precondition():
    svc = make_servicer()
    bars = {
        s: _sym_bars(s, n_prefix=30, n_window=15, base=100.0 + i * 10)
        for i, s in enumerate(("AAPL", "MSFT", "VOO"))
    }
    _wire_per_symbol(svc, bars)
    _stuck_on(svc, bars, "AAPL")
    svc._persist_symbol_cells = AsyncMock()
    svc._persist_backtest_run = AsyncMock()
    ctx = _owned_ctx()

    with pytest.raises(Exception, match="aborted"):
        await svc.RunBacktest(_windowed_req(_mkt_def(), symbols=("AAPL", "MSFT")), context=ctx)

    _assert_failed_precondition_no_persistence(svc, ctx)


@pytest.mark.asyncio
async def test_truncated_benchmark_fails_run_failed_precondition():
    svc = make_servicer()
    definition = _mkt_def()
    definition.components[0].source_symbol = "SPY"
    bars = {
        s: _sym_bars(s, n_prefix=30, n_window=15, base=100.0 + i * 10)
        for i, s in enumerate(("AAPL", "SPY"))
    }
    _wire_per_symbol(svc, bars)
    _stuck_on(svc, bars, "SPY")
    svc._persist_symbol_cells = AsyncMock()
    svc._persist_backtest_run = AsyncMock()
    ctx = _owned_ctx()

    with pytest.raises(Exception, match="aborted"):
        await svc.RunBacktest(_windowed_req(definition), context=ctx)

    _assert_failed_precondition_no_persistence(svc, ctx)
