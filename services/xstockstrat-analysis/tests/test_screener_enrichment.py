"""Screener raw-column enrichment tests (feature 083, FR-8): pe / rsi / atr / rev_growth.

The `held` cross-ref is set by the servicer (portfolio edge) and is covered in
test_analysis_servicer.py::TestScreenSymbolsHeld.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.services.screener import ScreenerEngine


def _cfg():
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    return cfg


def _pe_criterion():
    return analysis_pb2.ScreenCriterion(
        ref_name="pe",
        kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
        metric_name="pe_ratio",
        op=analysis_pb2.COMPARATOR_LT,
        threshold=30.0,
        weight=1.0,
    )


def _engine(extra_metrics=None):
    md = MagicMock()
    md.GetBars = AsyncMock(
        return_value=SimpleNamespace(bars=[marketdata_pb2.Bar(close=c) for c in [10, 11, 12, 13]])
    )
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[
                marketdata_pb2.Fundamentals(
                    symbol="AAPL", pe_ratio=25.0, extra_metrics=extra_metrics or {}
                )
            ]
        )
    )
    ind = MagicMock()

    def _compute(req, metadata=None):
        val = {"RSI": 60.0, "ATR": 3.5}.get(req.indicator, 1.0)
        return SimpleNamespace(result=[SimpleNamespace(value=val)])

    ind.ComputeIndicator = AsyncMock(side_effect=_compute)
    return ScreenerEngine(md, ind, AsyncMock(), _cfg(), {})


@pytest.mark.asyncio
async def test_pe_rsi_atr_rev_growth_populated():
    engine = _engine(extra_metrics={"revenue_growth": 0.12})
    req = analysis_pb2.ScreenSymbolsRequest(symbols=["AAPL"], criteria=[_pe_criterion()])
    resp = await engine.screen(req)
    r = resp.results[0]
    assert r.pe == 25.0
    assert r.rsi == 60.0
    assert r.atr == 3.5
    assert abs(r.rev_growth - 0.12) < 1e-9
    # no regression: the fundamental criterion still scores and passes (pe 25 < 30).
    assert "pe" in r.criterion_scores
    assert r.passed is True


@pytest.mark.asyncio
async def test_rev_growth_zero_when_absent():
    engine = _engine(extra_metrics={})  # FMP did not report revenue_growth
    req = analysis_pb2.ScreenSymbolsRequest(symbols=["AAPL"], criteria=[_pe_criterion()])
    resp = await engine.screen(req)
    assert resp.results[0].rev_growth == 0.0
