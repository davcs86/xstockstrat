"""Feature 177 FR-4 — conditional live-enrichment memo (AC-5, AC-11).

Two consecutive ``_enrich_opportunities_live`` passes for the same symbol within the TTL must skip
the live RPC on the second pass (AC-5), while a failed/unavailable first fetch must never be
memoized — the next pass still issues the RPC and a recovered quote appears (AC-11).
``time.monotonic`` is monkeypatched to a controllable clock so the TTL boundary is deterministic.

C-13: the marketdata-stub literals are single-consumer to this file (the sibling servicer tests
build their own inline) → kept inline. Reuses ``make_servicer`` from the servicer test module.

Updated for feature 183: enrichment now uses BatchGetLatestPrice (one call) instead of per-symbol
GetLatestPrice/GetBars fan-out.  BatchGetBars for sparklines was moved to the UI (async
useSparklines hook).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from .test_analysis_servicer import make_servicer

pytestmark = pytest.mark.asyncio


def _md_svc(last_price=12.34, prev_close=12.09):
    """Build a servicer with batch-RPC mocks for enrichment (feature 183).
    BatchGetBars is no longer called — sparklines moved to the UI."""
    svc = make_servicer()
    svc._marketdata = MagicMock()
    svc._marketdata.BatchGetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.BatchGetLatestPriceResponse(
            results=[
                marketdata_pb2.LatestPrice(
                    symbol="CAPR", last_price=last_price, prev_close=prev_close
                )
            ]
        )
    )
    return svc


async def test_memo_hit_skips_price_rpc_within_ttl_then_refetches(monkeypatch):
    """AC-5: a second pass within the TTL serves the memoized quote without the price RPC;
    past the TTL the RPC fires again. (Sparklines moved to the UI — only price is memoized.)"""
    clock = [1000.0]
    monkeypatch.setattr("app.handlers.servicer.time.monotonic", lambda: clock[0])
    svc = _md_svc()

    opp1 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    await svc._enrich_opportunities_live([opp1], [])
    assert svc._marketdata.BatchGetLatestPrice.await_count == 1

    # Pass 2 within the TTL (default 20s) → memo hit, no new RPC, identical live fields.
    opp2 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    clock[0] = 1005.0
    await svc._enrich_opportunities_live([opp2], [])
    assert svc._marketdata.BatchGetLatestPrice.await_count == 1  # not re-fetched
    assert opp2.live_price == opp1.live_price

    # Past the TTL → memo expired → RPC fires again.
    opp3 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    clock[0] = 1025.0
    await svc._enrich_opportunities_live([opp3], [])
    assert svc._marketdata.BatchGetLatestPrice.await_count == 2


async def test_ttl_zero_disables_memo():
    """live_enrich_ttl_seconds == 0 disables the memo → every pass fetches."""
    svc = _md_svc()
    svc._cfg.get_int_present = MagicMock(
        side_effect=lambda key, default: 0 if "live_enrich" in key else default
    )
    await svc._enrich_opportunities_live([analysis_pb2.Opportunity(symbol="CAPR")], [])
    await svc._enrich_opportunities_live([analysis_pb2.Opportunity(symbol="CAPR")], [])
    assert svc._marketdata.BatchGetLatestPrice.await_count == 2  # always fetch


async def test_failed_fetch_is_never_memoized_and_recovers(monkeypatch):
    """AC-11: a first pass with no available quote memoizes nothing; a second pass within the TTL
    still issues the RPC (no stale price served) and surfaces the now-available quote."""
    clock = [1000.0]
    monkeypatch.setattr("app.handlers.servicer.time.monotonic", lambda: clock[0])
    svc = _md_svc()
    # Pass 1: price unavailable (last_price unset) → not memoized even though the sparkline was OK.
    svc._marketdata.BatchGetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.BatchGetLatestPriceResponse(
            results=[marketdata_pb2.LatestPrice(symbol="CAPR")]
        )
    )
    opp1 = analysis_pb2.Opportunity(symbol="CAPR")
    await svc._enrich_opportunities_live([opp1], [])
    assert not opp1.HasField("live_price")

    # Pass 2 within the TTL: the memo must NOT suppress the RPC; the quote is now available.
    svc._marketdata.BatchGetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.BatchGetLatestPriceResponse(
            results=[marketdata_pb2.LatestPrice(symbol="CAPR", last_price=20.0, prev_close=19.0)]
        )
    )
    clock[0] = 1002.0
    opp2 = analysis_pb2.Opportunity(symbol="CAPR")
    await svc._enrich_opportunities_live([opp2], [])
    assert svc._marketdata.BatchGetLatestPrice.await_count == 1  # the fresh mock was re-fetched
    assert opp2.HasField("live_price") and abs(opp2.live_price - 20.0) < 1e-9
