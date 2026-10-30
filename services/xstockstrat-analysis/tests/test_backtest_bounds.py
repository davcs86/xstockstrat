"""Feature 272 (fix-analysis-backtest-bounds) — @AC-3, @AC-5, @AC-6.

A ``_BarFetchError`` (re-served page) fails the whole RunBacktest as FAILED_PRECONDITION
``backtest bar series incomplete: …`` with nothing persisted — for an evaluated symbol and
for the benchmark preload alike. ``analysis.backtest.max_duration_seconds`` bounds evaluation up
to result assembly (DEADLINE_EXCEEDED); persistence after ``disarm()`` always completes.
"""

import asyncio
import logging
import threading
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2

from app.handlers import servicer as servicer_mod
from tests.conftest import snapshot_watcher

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


_LIMIT_KEY = "analysis.backtest.max_duration_seconds"


def _bounded_svc(limit):
    """A wired AAPL+VOO servicer whose cfg stores ``limit`` for the backtest deadline key."""
    svc = make_servicer()
    svc._cfg = snapshot_watcher(**{_LIMIT_KEY: limit})
    bars = {
        s: _sym_bars(s, n_prefix=30, n_window=15, base=100.0 + i * 10)
        for i, s in enumerate(("AAPL", "VOO"))
    }
    _wire_per_symbol(svc, bars)
    svc._persist_symbol_cells = AsyncMock()
    svc._persist_backtest_run = AsyncMock()
    return svc, bars


def _req():
    return _windowed_req(_mkt_def(), symbols=("AAPL",))


def _stall_evaluated(svc, seconds, *, delegate=False):
    real = svc._backtest_symbol_evaluated

    async def _slow(*args, **kwargs):
        await asyncio.sleep(seconds)
        if delegate:
            return await real(*args, **kwargs)
        raise AssertionError("stall outlived the deadline")

    svc._backtest_symbol_evaluated = _slow


def _assert_deadline_abort(ctx, limit):
    ctx.abort.assert_awaited_once_with(
        grpc.StatusCode.DEADLINE_EXCEEDED, f"backtest exceeded {limit}s deadline"
    )


@pytest.mark.asyncio
async def test_deadline_exceeded_names_limit():
    svc, _ = _bounded_svc(1)
    _stall_evaluated(svc, 3)
    ctx = _owned_ctx()

    t0 = time.monotonic()
    with pytest.raises(Exception, match="aborted"):
        await svc.RunBacktest(_req(), context=ctx)

    assert time.monotonic() - t0 < 2
    _assert_deadline_abort(ctx, 1)
    svc._persist_symbol_cells.assert_not_awaited()
    svc._persist_backtest_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_deadline_fires_inside_awaited_getbars():
    svc, bars = _bounded_svc(1)

    async def _get_bars(req, **kw):
        if req.symbol == "AAPL":
            await asyncio.sleep(3)
        return SimpleNamespace(page=_EOF_PAGE, bars=bars.get(req.symbol, []))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    ctx = _owned_ctx()

    t0 = time.monotonic()
    with pytest.raises(Exception, match="aborted"):
        await svc.RunBacktest(_req(), context=ctx)

    assert time.monotonic() - t0 < 2
    _assert_deadline_abort(ctx, 1)


@pytest.mark.asyncio
async def test_stored_zero_means_no_limit():
    svc, _ = _bounded_svc(0)
    _stall_evaluated(svc, 2, delegate=True)
    ctx = _owned_ctx()

    result = await svc.RunBacktest(_req(), context=ctx)

    assert result.status == analysis_pb2.BACKTEST_STATUS_OK
    ctx.abort.assert_not_awaited()


@pytest.mark.asyncio
async def test_negative_limit_falls_back_to_300_with_warn(monkeypatch, caplog):
    svc, _ = _bounded_svc(-5)
    real = asyncio.timeout
    delays = []

    def _recorder(delay):
        delays.append(delay)
        return real(delay)

    monkeypatch.setattr(servicer_mod.asyncio, "timeout", _recorder)
    with caplog.at_level(logging.WARNING, logger="app.handlers.servicer"):
        await svc.RunBacktest(_req(), context=_owned_ctx())

    assert delays == [300]
    assert any(
        r.levelno == logging.WARNING and _LIMIT_KEY in r.getMessage() and "-5" in r.getMessage()
        for r in caplog.records
    )


@pytest.mark.asyncio
async def test_inner_timeout_is_not_mapped_to_deadline():
    svc, _ = _bounded_svc(60)
    svc._load_benchmark_bars = AsyncMock(side_effect=TimeoutError())
    ctx = _owned_ctx()

    with pytest.raises(TimeoutError):
        await svc.RunBacktest(_req(), context=ctx)

    assert all(
        c.args[:1] != (grpc.StatusCode.DEADLINE_EXCEEDED,) for c in ctx.abort.await_args_list
    )


@pytest.mark.asyncio
async def test_deadline_after_disarm_still_persists():
    svc, _ = _bounded_svc(1)
    persisted = []

    async def _slow_persist(*args, **kwargs):
        await asyncio.sleep(2)
        persisted.append(args)

    svc._persist_backtest_run = _slow_persist
    ctx = _owned_ctx()

    result = await svc.RunBacktest(_req(), context=ctx)

    assert result is not None
    ctx.abort.assert_not_awaited()
    assert persisted
    event_types = [c.args[0].event_type for c in svc._ledger.AppendEvent.await_args_list]
    assert "analysis.backtest.completed" in event_types


@pytest.mark.asyncio
async def test_deadline_returns_while_executor_thread_finishes():
    svc, _ = _bounded_svc(1)
    done = threading.Event()

    def _blocking():
        time.sleep(2)
        done.set()

    async def _offloaded(*args, **kwargs):
        await asyncio.get_running_loop().run_in_executor(svc._compute_executor, _blocking)
        raise AssertionError("executor stall outlived the deadline")

    svc._backtest_symbol_evaluated = _offloaded
    ctx = _owned_ctx()

    t0 = time.monotonic()
    with pytest.raises(Exception, match="aborted"):
        await svc.RunBacktest(_req(), context=ctx)

    assert time.monotonic() - t0 < 2
    assert not done.is_set()
    _assert_deadline_abort(ctx, 1)
    assert done.wait(3)
