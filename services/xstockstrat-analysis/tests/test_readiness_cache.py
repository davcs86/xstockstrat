"""Feature 177 FR-1 — readiness cache FAST/SLOW behavior (AC-1, AC-2).

C-13: reuses `_real_bars`, `_simple_strategy_row`, `_benchmark_strategy_row` from the sibling
readiness test module (the canonical single-consumer home for those literals); the cache-repo mock
is scenario-local to this file.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.handlers.servicer import _definition_fingerprint

from .test_analysis_servicer import _EOF_PAGE, _HEADERS, _ctx, make_servicer
from .test_readiness_opportunities_source_symbol import (
    _benchmark_strategy_row,
    _real_bars,
    _simple_strategy_row,
)

pytestmark = pytest.mark.asyncio


def _cache_svc(bars_by_symbol, strategy_row=None):
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(
        return_value=strategy_row or _simple_strategy_row()
    )
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
    svc._readiness_cache_repo = AsyncMock()
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={})
    svc._readiness_cache_repo.upsert_many = AsyncMock()
    return svc


def _verdicts(resp):
    return [
        (r.symbol, r.passing_conditions, r.total_conditions, round(r.conviction, 6))
        for r in resp.readiness
    ]


async def test_fast_path_serves_from_cache_without_fetch_or_eval():
    """AC-1: after a SLOW compute populates the cache, a repeat EvaluateReadiness within the window
    serves FAST — no GetBars — with byte-identical verdicts and a set computed_at."""
    svc = _cache_svc(
        {
            "AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0]),
            "MSFT": _real_bars("MSFT", [90.0, 95.0, 99.0]),
        }
    )
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL", "MSFT"])

    resp1 = await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count >= 2  # SLOW: fetched both symbols

    # Feed the SLOW-upserted rows back as the cache (matching fingerprint, valid_until in future).
    upserted = svc._readiness_cache_repo.upsert_many.await_args.args[0]
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={r["symbol"]: r for r in upserted})
    svc._marketdata.GetBars.reset_mock()

    resp2 = await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count == 0  # FAST: served from cache, no fetch
    assert _verdicts(resp2) == _verdicts(resp1)  # byte-identical verdicts
    assert resp2.HasField("computed_at")


async def test_slow_path_on_expiry_recomputes_and_restamps_bar_epoch():
    """AC-2: a cached row whose valid_until has elapsed re-evaluates (SLOW) and re-stamps bar_epoch
    to the newest served bar."""
    svc = _cache_svc({"AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0])})
    fp = _definition_fingerprint(_simple_strategy_row()["definition_json"])
    past = datetime.now(UTC) - timedelta(hours=1)
    svc._readiness_cache_repo.read_many = AsyncMock(
        return_value={
            "AAPL": {
                "symbol": "AAPL",
                "def_fingerprint": fp,
                "bar_epoch": 1,
                "readiness_json": {},
                "computed_at": past,
                "valid_until": past,  # elapsed → SLOW
            }
        }
    )
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"])

    await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count >= 1  # expiry → SLOW re-fetch
    upserted = {r["symbol"]: r for r in svc._readiness_cache_repo.upsert_many.await_args.args[0]}
    newest = _real_bars("AAPL", [120.0, 130.0, 150.0])[-1].time.seconds
    assert upserted["AAPL"]["bar_epoch"] == newest  # re-stamped to the newest served bar


async def test_bar_epoch_picks_up_a_newer_benchmark_bar():
    """AC-2 (benchmark-only): the evaluated symbol is dormant but the benchmark prints a newer bar →
    bar_epoch = max(evaluated, benchmark) picks up the benchmark's newest time.seconds."""
    aapl = _real_bars("AAPL", [1.0, 2.0, 3.0], start=datetime(2025, 1, 2, tzinfo=UTC))
    voo = _real_bars("VOO", [120.0, 130.0, 150.0], start=datetime(2025, 1, 10, tzinfo=UTC))  # newer
    svc = _cache_svc({"AAPL": aapl, "VOO": voo}, strategy_row=_benchmark_strategy_row())
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"])

    await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    upserted = {r["symbol"]: r for r in svc._readiness_cache_repo.upsert_many.await_args.args[0]}
    assert upserted["AAPL"]["bar_epoch"] == voo[-1].time.seconds  # benchmark's newer bar wins
    assert voo[-1].time.seconds > aapl[-1].time.seconds
