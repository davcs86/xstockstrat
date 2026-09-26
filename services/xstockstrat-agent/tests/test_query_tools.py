"""Feature 204 — data-explorer query MCP tools (query_bars, query_fundamentals).

Mirrors the test_watchlist_tools harness: patch the module-level marketdata client coroutines and
drive each registered tool's raw `.fn` (no `ctx` param; propagation is middleware-borne).
Covers AC-5/6/7/9/13/14/18/19/21 at the tool layer. Single-consumer inline literals (C-13).
"""

from unittest.mock import AsyncMock, patch

import pytest
from mcp.server.mcpserver import MCPServer
from mcp.types import EmbeddedResource

from app import client
from app.tools import register_tools

# MessageToDict-shaped rows (snake_case field names, int64 volume as a string, RFC3339 timestamps).
_BARS = [
    {
        "symbol": "AAPL",
        "time": "2024-03-01T00:00:00Z",
        "open": 10.0,
        "high": 11.0,
        "low": 9.5,
        "close": 10.5,
        "volume": "1000",
    },
    {
        "symbol": "AAPL",
        "time": "2024-03-04T00:00:00Z",
        "open": 10.5,
        "high": 12.0,
        "low": 10.0,
        "close": 11.8,
        "volume": "2000",
    },
]

_SNAPSHOT = {
    "symbol": "AAPL",
    "market_cap": 3.0e12,
    "pe_ratio": 28.5,
    "as_of": "2024-05-01T00:00:00Z",
    "source": "finnhub",
    "stale": False,
    "missing_metrics": ["dividend_yield"],
}

_PERIODS = [
    {
        "symbol": "AAPL",
        "fiscal_period": "Q2-2024",
        "period_type": "quarterly",
        "period_end": "2024-06-30T00:00:00Z",
        "filed_date": "2024-08-01T00:00:00Z",
        "pe_ratio": 30.0,
        "missing_metrics": ["pb_ratio"],
    },
    {
        "symbol": "AAPL",
        "fiscal_period": "Q1-2024",
        "period_type": "quarterly",
        "period_end": "2024-03-31T00:00:00Z",
        "filed_date": "2024-05-01T00:00:00Z",
        "eps": 1.5,
        "missing_metrics": [],
    },
]


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(name: str):
    return _make_server()._tool_manager.get_tool(name).fn


# ── query_bars ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_bars_returns_bar_fields():  # AC-5
    mock = AsyncMock(return_value={"bars": _BARS, "next_page_token": "", "total_count": 2})
    with patch.object(client, "get_bars", mock):
        out = await _tool_fn("query_bars")(symbol="AAPL", start_date="2024-03-01T00:00:00Z")
    assert [b["symbol"] for b in out["bars"]] == ["AAPL", "AAPL"]
    for field in ("time", "open", "high", "low", "close", "volume"):
        assert field in out["bars"][0]
    assert out["next_page_token"] == ""


@pytest.mark.asyncio
async def test_query_bars_caps_limit_at_1000():  # AC-9
    mock = AsyncMock(return_value={"bars": [], "next_page_token": "", "total_count": 0})
    with patch.object(client, "get_bars", mock):
        await _tool_fn("query_bars")(symbol="AAPL", limit=5000)
    # client.get_bars(symbol, timeframe, start, end, limit, page_token) — limit is positional arg 4.
    assert mock.await_args.args[4] == 1000


@pytest.mark.asyncio
async def test_query_bars_last_refreshed_is_max_bar_time():  # AC-13
    mock = AsyncMock(return_value={"bars": _BARS, "next_page_token": "", "total_count": 2})
    with patch.object(client, "get_bars", mock):
        out = await _tool_fn("query_bars")(symbol="AAPL")
    assert out["last_refreshed"] == "2024-03-04T00:00:00Z"


@pytest.mark.asyncio
async def test_query_bars_empty_has_null_last_refreshed():
    mock = AsyncMock(return_value={"bars": [], "next_page_token": "", "total_count": 0})
    with patch.object(client, "get_bars", mock):
        out = await _tool_fn("query_bars")(symbol="ZZZZ")
    assert out["bars"] == []
    assert out["last_refreshed"] is None


@pytest.mark.asyncio
async def test_query_bars_csv_returns_text_csv_resource():  # AC-18
    mock = AsyncMock(return_value={"bars": _BARS, "next_page_token": "", "total_count": 2})
    with patch.object(client, "get_bars", mock):
        out = await _tool_fn("query_bars")(symbol="AAPL", format="csv")
    assert isinstance(out, list) and len(out) == 1
    res = out[0]
    assert isinstance(res, EmbeddedResource)
    assert res.resource.mime_type == "text/csv"
    lines = res.resource.text.splitlines()
    assert lines[0] == "time,open,high,low,close,volume"
    assert len(lines) == 3  # header + 2 bars
    assert "data-explorer/bars/AAPL" in str(res.resource.uri)


# ── query_fundamentals ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_query_fundamentals_snapshot():  # AC-6, AC-14
    mock = AsyncMock(return_value=_SNAPSHOT)
    with patch.object(client, "get_fundamentals", mock):
        out = await _tool_fn("query_fundamentals")(symbol="AAPL")
    assert out["fundamentals"]["pe_ratio"] == 28.5
    assert out["last_refreshed"] == "2024-05-01T00:00:00Z"  # from as_of (AC-14)
    assert out["missing_metrics"] == ["dividend_yield"]
    mock.assert_awaited_once_with("AAPL")


@pytest.mark.asyncio
async def test_query_fundamentals_historical_pagination():  # AC-7, AC-21
    mock = AsyncMock(return_value={"periods": _PERIODS, "next_page_token": "cursor-2"})
    with patch.object(client, "get_historical_fundamentals", mock):
        out = await _tool_fn("query_fundamentals")(symbol="AAPL", mode="historical", limit=100)
    assert [p["fiscal_period"] for p in out["periods"]] == ["Q2-2024", "Q1-2024"]
    assert out["next_page_token"] == "cursor-2"
    assert out["last_refreshed"] == "2024-08-01T00:00:00Z"  # max filed_date
    assert out["missing_metrics"] == ["pb_ratio"]  # union across periods
    assert mock.await_args.args[4] == 50  # historical limit capped at 50


@pytest.mark.asyncio
async def test_query_fundamentals_csv_blanks_missing_metrics():  # AC-19
    mock = AsyncMock(return_value=_SNAPSHOT)
    with patch.object(client, "get_fundamentals", mock):
        out = await _tool_fn("query_fundamentals")(symbol="AAPL", format="csv")
    assert isinstance(out, list) and isinstance(out[0], EmbeddedResource)
    res = out[0]
    assert res.resource.mime_type == "text/csv"
    lines = res.resource.text.splitlines()
    header = lines[0].split(",")
    row = lines[1].split(",")
    # missing_metric (dividend_yield) → empty cell (MARKETDATA-11: authoritative list, not truthy).
    assert row[header.index("dividend_yield")] == ""
    # a supplied metric survives.
    assert row[header.index("pe_ratio")] == "28.5"
    assert "data-explorer/fundamentals/AAPL" in str(res.resource.uri)


@pytest.mark.asyncio
async def test_query_fundamentals_rejects_unknown_mode():
    with pytest.raises(ValueError, match="unknown mode"):
        await _tool_fn("query_fundamentals")(symbol="AAPL", mode="bogus")
