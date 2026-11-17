"""Feature 356 — held-position drains fail closed (AC-1..AC-4, AC-8, AC-9)."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import grpc
import pytest

import app.handlers.servicer as servicer_mod
from tests.conftest import OWNER_HEADERS, aio_rpc_error
from tests.test_analysis_servicer import make_servicer


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
