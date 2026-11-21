"""Feature 356 — held-position drains fail closed (AC-1..AC-4, AC-7..AC-9)."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import grpc
import pytest

import app.handlers.servicer as servicer_mod
from tests import test_telemetry
from tests.conftest import OWNER_HEADERS, aio_rpc_error
from tests.test_analysis_servicer import make_servicer
from tests.test_live_loop import _live_row, _make_loop
from tests.test_live_loop_telemetry import _wire_drains, all_attribute_values, metric_sum

metric_reader = test_telemetry.metric_reader
_HELD_FAILURES = "analysis.live_loop.drain_failures"


def _page(rows, next_token):
    return SimpleNamespace(
        positions=[SimpleNamespace(symbol=s, market_value=v) for s, v in rows],
        page=SimpleNamespace(next_page_token=next_token),
    )


def _ignore_token():
    async def _list(req, metadata=None):
        return _page([("AAPL", 100.0)], "t")

    return AsyncMock(side_effect=_list)


def _distinct_tokens():
    n = 0

    async def _list(req, metadata=None):
        nonlocal n
        n += 1
        return _page([("AAPL", 100.0)], f"p{n}")

    return AsyncMock(side_effect=_list)


def _page2_raises():
    async def _list(req, metadata=None):
        if req.page.page_token == "":
            return _page([("AAPL", 100.0)], "p2")
        raise aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "portfolio down")

    return AsyncMock(side_effect=_list)


def _honor_token(pages):
    tokens = [""] + [f"p{i}" for i in range(1, len(pages))]

    async def _list(req, metadata=None):
        i = tokens.index(req.page.page_token)
        nxt = tokens[i + 1] if i + 1 < len(pages) else ""
        return _page(pages[i], nxt)

    return AsyncMock(side_effect=_list)


def _svc(fake):
    svc = make_servicer()
    svc._portfolio = SimpleNamespace(ListPositions=fake)
    return svc


# ── servicer._drain_held_symbols ───────────────────────────────────────────────────────────────


async def test_ac1_ignored_token_raises_after_second_page():
    fake = _ignore_token()
    with pytest.raises(Exception) as ei:
        await _svc(fake)._drain_held_symbols("u-1", OWNER_HEADERS)
    assert fake.await_count == 2
    assert isinstance(ei.value, servicer_mod._PositionsPageError)


async def test_ac2_page_cap_raises_and_warns(caplog):
    fake = _distinct_tokens()
    with caplog.at_level(logging.WARNING), pytest.raises(Exception) as ei:
        await _svc(fake)._drain_held_symbols("u-1", OWNER_HEADERS)
    assert fake.await_count == 50
    assert [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING and "u-1" in r.getMessage() and "50" in r.getMessage()
    ]
    assert isinstance(ei.value, servicer_mod._PositionsPageError)


async def test_ac3_page2_rpc_error_raises_without_partial_rows():
    held = None
    with pytest.raises(Exception) as ei:
        held = await _svc(_page2_raises())._drain_held_symbols("u-1", OWNER_HEADERS)
    assert held is None
    assert isinstance(ei.value, servicer_mod._PositionsPageError)
    assert isinstance(ei.value.__cause__, grpc.aio.AioRpcError)


async def test_ac4_non_grpc_page_error_raises_positions_page_error():
    fake = AsyncMock(side_effect=RuntimeError("boom"))
    with pytest.raises(Exception) as ei:
        await _svc(fake)._drain_held_symbols("u-1", OWNER_HEADERS)
    assert isinstance(ei.value, servicer_mod._PositionsPageError)


async def test_ac8_honored_token_returns_every_page():
    fake = _honor_token([[("AAPL", 100.0)], [("MSFT", 200.0)], [("NVDA", 300.0)]])
    held = await _svc(fake)._drain_held_symbols("u-1", OWNER_HEADERS)
    assert held == {"AAPL": 100.0, "MSFT": 200.0, "NVDA": 300.0}
    assert fake.await_count == 3


async def test_ac9_single_page_sums_absolute_market_value():
    fake = _honor_token([[("AAPL", -150.0)]])
    held = await _svc(fake)._drain_held_symbols("u-1", OWNER_HEADERS)
    assert held == {"AAPL": 150.0}
    assert fake.await_count == 1


# ── live_loop._drain_held and the cycle ────────────────────────────────────────────────────────


def _loop(fake):
    loop = _make_loop()
    _wire_drains(loop, list_positions=fake)
    return loop


async def test_ac1_live_loop_ignored_token_raises(metric_reader):
    fake = _ignore_token()
    with pytest.raises(Exception) as ei:
        await _loop(fake)._drain_held("o-1")
    assert isinstance(ei.value, servicer_mod._PositionsPageError)
    assert fake.await_count == 2
    assert metric_sum(metric_reader, _HELD_FAILURES, source="held") == 1


async def test_ac2_live_loop_page_cap_raises_and_warns(metric_reader, caplog):
    fake = _distinct_tokens()
    with caplog.at_level(logging.WARNING), pytest.raises(Exception) as ei:
        await _loop(fake)._drain_held("o-1")
    assert isinstance(ei.value, servicer_mod._PositionsPageError)
    assert fake.await_count == 50
    assert [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING and "o-1" in r.getMessage() and "50" in r.getMessage()
    ]
    assert metric_sum(metric_reader, _HELD_FAILURES, source="held") == 1


async def test_ac3_live_loop_page2_error_raises_without_partial_set(metric_reader):
    held = None
    with pytest.raises(Exception) as ei:
        held = await _loop(_page2_raises())._drain_held("o-1")
    assert held is None
    assert isinstance(ei.value, servicer_mod._PositionsPageError)
    assert metric_sum(metric_reader, _HELD_FAILURES, source="held") == 1


async def test_ac8_live_loop_honored_token_returns_every_page():
    fake = _honor_token([[("AAPL", 1.0)], [("MSFT", 1.0)], [("NVDA", 1.0)]])
    assert await _loop(fake)._drain_held("o-1") == {"AAPL", "MSFT", "NVDA"}
    assert fake.await_count == 3


async def test_ac9_live_loop_single_page():
    fake = _honor_token([[("AAPL", 1.0)]])
    assert await _loop(fake)._drain_held("o-1") == {"AAPL"}
    assert fake.await_count == 1


async def test_ac7_failed_owner_skipped_once_per_cycle(metric_reader, caplog):
    async def _list(req, metadata=None):
        if req.user_id == "o-1":
            raise aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "portfolio down")
        return _page([("MSFT", 1.0)], "")

    fake = AsyncMock(side_effect=_list)
    loop = _loop(fake)
    loop._db.fetch = AsyncMock(
        return_value=[
            _live_row("s1", "o-1", symbols=["AAPL"]),
            _live_row("s2", "o-1", symbols=["AAPL"]),
            _live_row("s3", "o-2"),
        ]
    )
    seen = []

    async def fake_eval(defn, symbol, throttle, deny_entry=False):
        seen.append((defn.user_id, symbol))

    loop._eval_pair = fake_eval
    with caplog.at_level(logging.WARNING):
        await loop._run_cycle()
    assert not [s for u, s in seen if u == "o-1"]
    assert len([c for c in fake.await_args_list if c.args[0].user_id == "o-1"]) == 1
    assert metric_sum(metric_reader, _HELD_FAILURES, source="held") == 1
    assert {s for u, s in seen if u == "o-2"} == {"MSFT"}
    assert not [v for v in all_attribute_values(metric_reader) if "o-1" in v]
    warnings = [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING and "s1" in r.getMessage() and "o-1" in r.getMessage()
    ]
    assert len(warnings) == 1
