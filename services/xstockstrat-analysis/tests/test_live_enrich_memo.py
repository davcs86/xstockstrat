"""Feature 177 FR-4 — conditional live-enrichment memo (AC-5, AC-11).

Two consecutive ``_enrich_opportunities_live`` passes for the same symbol within the TTL must skip
both live RPCs on the second pass (AC-5), while a failed/unavailable first fetch must never be
memoized — the next pass still issues the RPC and a recovered quote appears (AC-11).
``time.monotonic`` is monkeypatched to a controllable clock so the TTL boundary is deterministic.

C-13: the marketdata-stub literals are single-consumer to this file (the sibling servicer tests
build their own inline) → kept inline. Reuses ``make_servicer`` from the servicer test module.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from .test_analysis_servicer import make_servicer

pytestmark = pytest.mark.asyncio


def _md_svc(last_price=12.34, prev_close=12.09, bars=(12.0, 12.5, 12.34)):
    svc = make_servicer()
    svc._marketdata = MagicMock()
    svc._marketdata.GetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.LatestPrice(
            symbol="CAPR", last_price=last_price, prev_close=prev_close
        )
    )
    svc._marketdata.GetBars = AsyncMock(
        return_value=marketdata_pb2.GetBarsResponse(
            bars=[marketdata_pb2.Bar(symbol="CAPR", close=c) for c in bars]
        )
    )
    return svc


async def test_memo_hit_skips_both_rpcs_within_ttl_then_refetches(monkeypatch):
    """AC-5: a second pass within the TTL serves the memoized quote/sparkline without either RPC;
    past the TTL both RPCs fire again."""
    clock = [1000.0]
    monkeypatch.setattr("app.handlers.servicer.time.monotonic", lambda: clock[0])
    svc = _md_svc()

    opp1 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    await svc._enrich_opportunities_live([opp1], [])
    assert svc._marketdata.GetLatestPrice.await_count == 1
    assert svc._marketdata.GetBars.await_count == 1

    # Pass 2 within the TTL (default 10s) → memo hit, no new RPCs, identical live fields.
    opp2 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    clock[0] = 1005.0
    await svc._enrich_opportunities_live([opp2], [])
    assert svc._marketdata.GetLatestPrice.await_count == 1  # not re-fetched
    assert svc._marketdata.GetBars.await_count == 1
    assert opp2.live_price == opp1.live_price
    assert [p.close for p in opp2.sparkline] == [p.close for p in opp1.sparkline]

    # Past the TTL → memo expired → both RPCs fire again.
    opp3 = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
    clock[0] = 1011.0
    await svc._enrich_opportunities_live([opp3], [])
    assert svc._marketdata.GetLatestPrice.await_count == 2
    assert svc._marketdata.GetBars.await_count == 2


async def test_ttl_zero_disables_memo():
    """live_enrich_ttl_seconds == 0 disables the memo → every pass fetches."""
    svc = _md_svc()
    svc._cfg.get_int_present = MagicMock(
        side_effect=lambda key, default: 0 if "live_enrich" in key else default
    )
    await svc._enrich_opportunities_live([analysis_pb2.Opportunity(symbol="CAPR")], [])
    await svc._enrich_opportunities_live([analysis_pb2.Opportunity(symbol="CAPR")], [])
    assert svc._marketdata.GetLatestPrice.await_count == 2  # always fetch


async def test_failed_fetch_is_never_memoized_and_recovers(monkeypatch):
    """AC-11: a first pass with no available quote memoizes nothing; a second pass within the TTL
    still issues the RPC (no stale price served) and surfaces the now-available quote."""
    clock = [1000.0]
    monkeypatch.setattr("app.handlers.servicer.time.monotonic", lambda: clock[0])
    svc = _md_svc()
    # Pass 1: price unavailable (last_price unset) → not memoized even though the sparkline was OK.
    svc._marketdata.GetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.LatestPrice(symbol="CAPR")
    )
    opp1 = analysis_pb2.Opportunity(symbol="CAPR")
    await svc._enrich_opportunities_live([opp1], [])
    assert not opp1.HasField("live_price")

    # Pass 2 within the TTL: the memo must NOT suppress the RPC; the quote is now available.
    svc._marketdata.GetLatestPrice = AsyncMock(
        return_value=marketdata_pb2.LatestPrice(symbol="CAPR", last_price=20.0, prev_close=19.0)
    )
    clock[0] = 1002.0
    opp2 = analysis_pb2.Opportunity(symbol="CAPR")
    await svc._enrich_opportunities_live([opp2], [])
    assert svc._marketdata.GetLatestPrice.await_count == 1  # the fresh mock was re-fetched
    assert opp2.HasField("live_price") and abs(opp2.live_price - 20.0) < 1e-9
