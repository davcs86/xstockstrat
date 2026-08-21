"""Feature 127 — ingest_signal(direction="watchlist") auto-adds to the system-managed
signals watchlist (best-effort, post-commit, dedup/direction-gated) + doc parity.

Covers AC-1..AC-5. Mirrors the auto-alert test harness in test_tools.py: patch the
module-level client coroutines and drive the registered tool's raw `.fn`.
"""

import inspect
import pathlib
from unittest.mock import AsyncMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import TRADER, _ctx


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


# ── AC-1: watchlist direction, non-dedup → symbol added to the system list ──────


@pytest.mark.asyncio
async def test_watchlist_direction_adds_symbol():
    mock_ingest = AsyncMock(return_value={"signal_id": 1, "deduplicated": False})
    mock_ensure = AsyncMock(return_value="wl-sys")
    mock_add = AsyncMock(return_value=None)
    mock_config = AsyncMock(return_value=None)
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "ensure_signal_watchlist", mock_ensure),
        patch.object(client, "add_watchlist_symbol", mock_add),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            ctx=_ctx(TRADER),
            source="unusual_whales",
            symbol="NVDA",
            direction="watchlist",
            valid_from="2026-05-01T00:00:00Z",
        )
    assert result == {"signal_id": 1, "deduplicated": False}
    mock_ensure.assert_awaited_once_with("u-2")
    mock_add.assert_awaited_once_with("u-2", "wl-sys", "NVDA")


# ── AC-2: non-watchlist direction → no watchlist mutation ───────────────────────


@pytest.mark.asyncio
async def test_non_watchlist_direction_no_add():
    mock_ingest = AsyncMock(return_value={"signal_id": 2, "deduplicated": False})
    mock_ensure = AsyncMock(return_value="wl-sys")
    mock_add = AsyncMock(return_value=None)
    mock_config = AsyncMock(return_value=None)
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "ensure_signal_watchlist", mock_ensure),
        patch.object(client, "add_watchlist_symbol", mock_add),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        await _tool_fn(server, "ingest_signal")(
            ctx=_ctx(TRADER),
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
        )
    mock_ensure.assert_not_called()
    mock_add.assert_not_called()


# ── AC-3: deduplicated response → no watchlist mutation ─────────────────────────


@pytest.mark.asyncio
async def test_deduplicated_no_add():
    mock_ingest = AsyncMock(return_value={"signal_id": 3, "deduplicated": True})
    mock_ensure = AsyncMock(return_value="wl-sys")
    mock_add = AsyncMock(return_value=None)
    mock_config = AsyncMock(return_value=None)
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "ensure_signal_watchlist", mock_ensure),
        patch.object(client, "add_watchlist_symbol", mock_add),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            ctx=_ctx(TRADER),
            source="unusual_whales",
            symbol="NVDA",
            direction="watchlist",
            valid_from="2026-05-01T00:00:00Z",
        )
    assert result["deduplicated"] is True
    mock_ensure.assert_not_called()
    mock_add.assert_not_called()


# ── AC-4: portfolio failure never fails ingest; WARN logged ─────────────────────


@pytest.mark.asyncio
async def test_watchlist_add_failure_is_nonblocking(caplog):
    err = grpc.aio.AioRpcError(grpc.StatusCode.UNAVAILABLE, None, None, details="portfolio down")
    mock_ingest = AsyncMock(return_value={"signal_id": 4, "deduplicated": False})
    mock_ensure = AsyncMock(side_effect=err)
    mock_add = AsyncMock(return_value=None)
    mock_config = AsyncMock(return_value=None)
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "ensure_signal_watchlist", mock_ensure),
        patch.object(client, "add_watchlist_symbol", mock_add),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        with caplog.at_level("WARNING"):
            result = await _tool_fn(server, "ingest_signal")(
                ctx=_ctx(TRADER),
                source="unusual_whales",
                symbol="NVDA",
                direction="watchlist",
                valid_from="2026-05-01T00:00:00Z",
            )
    # ingest itself did not fail, and the add never proceeded past the failing ensure.
    assert result == {"signal_id": 4, "deduplicated": False}
    mock_add.assert_not_called()
    warnings = [
        r for r in caplog.records if r.levelname == "WARNING" and "Watchlist auto-add" in r.message
    ]
    assert warnings, "expected a WARNING log for the failed watchlist auto-add"
    # the original gRPC code is diagnosable from the logged message
    assert "UNAVAILABLE" in warnings[0].message or "portfolio down" in warnings[0].message


# ── AC-5: doc parity — docstring AND mcp-tools.md both document the side effect ──


def test_doc_parity_docstring_and_runbook():
    server = _make_server()
    doc = inspect.getdoc(_tool_fn(server, "ingest_signal")) or ""
    runbook = (
        pathlib.Path(__file__).resolve().parents[3] / "docs/runbooks/mcp-tools.md"
    ).read_text()

    def mentions_watchlist_add(text: str) -> bool:
        low = text.lower()
        return "watchlist" in low and ("system-managed" in low or "add" in low)

    assert mentions_watchlist_add(doc), (
        "ingest_signal docstring must document the watchlist auto-add"
    )
    # scope the runbook check to the ingest_signal section so an unrelated mention can't pass it
    section = runbook.split("### `ingest_signal`", 1)[1].split("### `emit_alert`", 1)[0]
    assert mentions_watchlist_add(section), (
        "mcp-tools.md ingest_signal entry must document the auto-add"
    )
