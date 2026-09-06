"""Feature 181 — GetWatchlistReadiness cache-first classifier, keyset paging, UNKNOWN cooldown.

C-13: reuses the servicer harness (`_cache_svc`) + `_simple_strategy_row` from the sibling readiness
test modules (the canonical single-consumer homes); the watchlist-binding list + staged cache rows
are scenario-local domain literals with this module as their single consumer.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2

from app.handlers.servicer import _definition_fingerprint

from .test_analysis_servicer import _HEADERS, _ctx
from .test_readiness_cache import _cache_svc
from .test_readiness_opportunities_source_symbol import _simple_strategy_row

pytestmark = pytest.mark.asyncio

FP = _definition_fingerprint(_simple_strategy_row()["definition_json"])


def _wl_svc(bindings, *, cache=None, coverage=None):
    """A servicer whose watchlist returns `bindings` [(symbol, strategy_id), ...], whose readiness
    cache returns the staged `cache` rows (keyed by symbol), and whose coverage probe returns
    `coverage` (symbol -> latest_bar_epoch, default 0)."""
    cache = cache or {}
    coverage = coverage or {}
    svc = _cache_svc({})
    svc._portfolio = MagicMock()
    svc._portfolio.GetWatchlist = AsyncMock(
        return_value=SimpleNamespace(
            watchlist=SimpleNamespace(
                bindings=[SimpleNamespace(symbol=s, strategy_id=sid) for s, sid in bindings]
            )
        )
    )

    async def _read_many(uid, sid, rule, syms):
        return {s: cache[s] for s in syms if s in cache}

    svc._readiness_cache_repo.read_many = AsyncMock(side_effect=_read_many)

    async def _cov(req, metadata=None):
        return SimpleNamespace(latest=SimpleNamespace(seconds=coverage.get(req.symbol, 0)))

    svc._marketdata.GetDataCoverage = AsyncMock(side_effect=_cov)
    return svc


def _cache_row(*, bar_epoch, computed_at=None, valid_until=None, fp=FP, readiness_json=None):
    now = datetime.now(UTC)
    return {
        "symbol": "",
        "def_fingerprint": fp,
        "bar_epoch": bar_epoch,
        "computed_at": computed_at or now,
        "valid_until": valid_until or (now + timedelta(hours=1)),
        "readiness_json": {} if readiness_json is None else readiness_json,
    }


def _req(watchlist_id="wl1", *, page_size=0, page_token=""):
    return analysis_pb2.GetWatchlistReadinessRequest(
        watchlist_id=watchlist_id,
        page=common_pb2.PageRequest(page_size=page_size, page_token=page_token),
    )


def _by_pair(resp):
    return {(r.symbol, r.strategy_id): r for r in resp.rows}


# ── Four-way classifier (AC-3 + R-E) ────────────────────────────────────────


async def test_fresh_cache_row_is_resolved_inline_no_kick():
    """AC-3: a fresh, fingerprint-matching, bar_epoch>=lbe row → RESOLVED with inline readiness,
    served from the cache with no background refresh kicked."""
    svc = _wl_svc(
        [("AAPL", "s1")], cache={"AAPL": _cache_row(bar_epoch=100)}, coverage={"AAPL": 100}
    )
    svc._kick_readiness_refresh = MagicMock()
    resp = await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    row = _by_pair(resp)[("AAPL", "s1")]
    assert row.state == analysis_pb2.READINESS_STATE_RESOLVED
    assert row.HasField("readiness")
    svc._kick_readiness_refresh.assert_not_called()


async def test_sentinel_row_is_unknown_regardless_of_lbe():
    """R-E: a bar_epoch < 0 sentinel row → UNKNOWN even when lbe would otherwise say fresh."""
    svc = _wl_svc(
        [("AAPL", "s1")], cache={"AAPL": _cache_row(bar_epoch=-1)}, coverage={"AAPL": 100}
    )
    svc._kick_readiness_refresh = MagicMock()
    resp = await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    row = _by_pair(resp)[("AAPL", "s1")]
    assert row.state == analysis_pb2.READINESS_STATE_UNKNOWN
    assert not row.HasField("readiness")


async def test_missing_row_is_pending_and_kicks():
    """A cache miss → PENDING + a background refresh kicked for the pair."""
    svc = _wl_svc([("AAPL", "s1")], cache={}, coverage={"AAPL": 100})
    svc._kick_readiness_refresh = MagicMock()
    resp = await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    row = _by_pair(resp)[("AAPL", "s1")]
    assert row.state == analysis_pb2.READINESS_STATE_PENDING
    svc._kick_readiness_refresh.assert_called_once()
    kicked = svc._kick_readiness_refresh.call_args.args[1]
    assert kicked == {"s1": ["AAPL"]}


async def test_bar_busted_row_is_pending_not_stale_resolved():
    """Load-bearing (R-A / feature-177 @AC-2): a non-sentinel row whose bar_epoch trails a newer lbe
    is PENDING (re-decorate + re-warm), NEVER served as a stale RESOLVED."""
    svc = _wl_svc(
        [("AAPL", "s1")], cache={"AAPL": _cache_row(bar_epoch=100)}, coverage={"AAPL": 200}
    )
    svc._kick_readiness_refresh = MagicMock()
    resp = await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    assert _by_pair(resp)[("AAPL", "s1")].state == analysis_pb2.READINESS_STATE_PENDING


async def test_probe_miss_serves_cached_row_resolved_best_effort():
    """A probe miss (lbe = 0) does not falsely bust a non-sentinel in-window row → RESOLVED."""
    svc = _wl_svc([("AAPL", "s1")], cache={"AAPL": _cache_row(bar_epoch=100)}, coverage={"AAPL": 0})
    resp = await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    assert _by_pair(resp)[("AAPL", "s1")].state == analysis_pb2.READINESS_STATE_RESOLVED


# ── UNKNOWN recovery cooldown ───────────────────────────────────────────────


async def test_unknown_within_cooldown_is_not_rekicked():
    now = datetime.now(UTC)
    svc = _wl_svc(
        [("AAPL", "s1")],
        cache={"AAPL": _cache_row(bar_epoch=-1, computed_at=now - timedelta(seconds=100))},
        coverage={"AAPL": 100},
    )
    svc._kick_readiness_refresh = MagicMock()
    await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    svc._kick_readiness_refresh.assert_not_called()


async def test_unknown_past_cooldown_is_rekicked():
    now = datetime.now(UTC)
    svc = _wl_svc(
        [("AAPL", "s1")],
        cache={"AAPL": _cache_row(bar_epoch=-1, computed_at=now - timedelta(seconds=400))},
        coverage={"AAPL": 100},
    )
    svc._kick_readiness_refresh = MagicMock()
    await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    svc._kick_readiness_refresh.assert_called_once()


# ── Keyset paging (AC-4) ────────────────────────────────────────────────────


async def test_keyset_paging_bounds_work_to_visible_page():
    """AC-4: page_size < N returns only the first page's pairs with a next_page_token; resuming with
    it returns the rest with no skip/dup; the cache read is bounded to the visible page symbols."""
    bindings = [("AAA", "s1"), ("BBB", "s1"), ("CCC", "s1")]
    fresh = {s: _cache_row(bar_epoch=100) for s in ("AAA", "BBB", "CCC")}
    cov = {s: 100 for s in ("AAA", "BBB", "CCC")}
    svc = _wl_svc(bindings, cache=fresh, coverage=cov)

    resp1 = await svc.GetWatchlistReadiness(_req(page_size=2), _ctx(_HEADERS))
    assert [(r.symbol, r.strategy_id) for r in resp1.rows] == [("AAA", "s1"), ("BBB", "s1")]
    assert resp1.page.next_page_token != ""
    # read_many was called only for the visible page's symbols (never CCC on page 1).
    read_syms = {
        s for call in svc._readiness_cache_repo.read_many.await_args_list for s in call.args[3]
    }
    assert read_syms == {"AAA", "BBB"}

    resp2 = await svc.GetWatchlistReadiness(
        _req(page_size=2, page_token=resp1.page.next_page_token), _ctx(_HEADERS)
    )
    assert [(r.symbol, r.strategy_id) for r in resp2.rows] == [("CCC", "s1")]
    assert resp2.page.next_page_token == ""


async def test_keyset_composite_order_when_symbol_binds_two_strategies():
    """The cursor is composite (symbol, strategy_id): AAA/s1 and AAA/s2 are distinct rows and page
    in lexicographic order."""
    bindings = [("AAA", "s2"), ("AAA", "s1"), ("BBB", "s1")]
    fresh = {"AAA": _cache_row(bar_epoch=100), "BBB": _cache_row(bar_epoch=100)}
    svc = _wl_svc(bindings, cache=fresh, coverage={"AAA": 100, "BBB": 100})
    resp = await svc.GetWatchlistReadiness(_req(page_size=2), _ctx(_HEADERS))
    assert [(r.symbol, r.strategy_id) for r in resp.rows] == [("AAA", "s1"), ("AAA", "s2")]


# ── No cycle (AC-5) ─────────────────────────────────────────────────────────


async def test_reaches_watchlist_via_portfolio_stub_no_analysis_callback():
    """AC-5: the handler reads the watchlist over the existing analysis→portfolio GetWatchlist edge
    and issues no call back into analysis (no portfolio→analysis cycle)."""
    svc = _wl_svc(
        [("AAPL", "s1")], cache={"AAPL": _cache_row(bar_epoch=100)}, coverage={"AAPL": 100}
    )
    await svc.GetWatchlistReadiness(_req(), _ctx(_HEADERS))
    svc._portfolio.GetWatchlist.assert_awaited_once()
