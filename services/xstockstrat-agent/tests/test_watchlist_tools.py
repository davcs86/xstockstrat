"""Feature 148 — watchlist MCP tools (tool layer).

Mirrors the test_ingest_signal_watchlist harness: patch the module-level client coroutines and
drive each registered tool's raw `.fn`. Asserts ownership-forwarding (caller's own user_id),
operation-verb dispatch, error mapping, tool registration, and docstring/runbook doc-parity.
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

_WATCHLIST_TOOLS = [
    "list_watchlists",
    "get_watchlist",
    "manage_watchlist",
    "manage_watchlist_symbols",
]


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


# ── registration + inventory (AC-10) ─────────────────────────────────────────


def test_all_four_watchlist_tools_registered():
    server = _make_server()
    for name in _WATCHLIST_TOOLS:
        assert server._tool_manager.get_tool(name) is not None, f"{name} not registered"


def test_endpoint_catalog_lists_the_new_tools():
    from starlette.testclient import TestClient

    from app.main import build_http_app

    with TestClient(build_http_app()) as tc:
        names = {t["name"] for t in tc.get("/api/tools").json()["tools"]}
    assert set(_WATCHLIST_TOOLS) <= names


# ── list_watchlists (AC-1) ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_watchlists_forwards_caller_and_pagination():
    mock = AsyncMock(return_value={"watchlists": [], "next_page_token": ""})
    with patch.object(client, "list_watchlists", mock):
        server = _make_server()
        out = await _tool_fn(server, "list_watchlists")(ctx=_ctx(TRADER), limit=5, page_token="tok")
    assert out == {"watchlists": [], "next_page_token": ""}
    mock.assert_awaited_once_with("u-2", limit=5, page_token="tok")


# ── get_watchlist (AC-2, AC-3) ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_watchlist_forwards_caller():
    mock = AsyncMock(return_value={"watchlist": {"watchlist_id": "wl-1"}})
    with patch.object(client, "get_watchlist", mock):
        server = _make_server()
        out = await _tool_fn(server, "get_watchlist")(ctx=_ctx(TRADER), watchlist_id="wl-1")
    assert out["watchlist"]["watchlist_id"] == "wl-1"
    mock.assert_awaited_once_with("u-2", "wl-1")


@pytest.mark.asyncio
async def test_get_watchlist_permission_denied_maps_to_runtimeerror():
    err = grpc.aio.AioRpcError(
        grpc.StatusCode.PERMISSION_DENIED, None, None, details="watchlist not owned by caller"
    )
    with patch.object(client, "get_watchlist", AsyncMock(side_effect=err)):
        server = _make_server()
        with pytest.raises(RuntimeError, match="not owned"):
            await _tool_fn(server, "get_watchlist")(ctx=_ctx(TRADER), watchlist_id="wl-x")


# ── manage_watchlist verb dispatch (AC-4, AC-5, AC-6) ────────────────────────


@pytest.mark.asyncio
async def test_manage_watchlist_create_dispatches():
    mock = AsyncMock(return_value={"watchlist": {"watchlist_id": "wl-new"}})
    with patch.object(client, "create_watchlist", mock):
        server = _make_server()
        out = await _tool_fn(server, "manage_watchlist")(
            ctx=_ctx(TRADER), operation="create", name="Breakouts", symbols=["TSLA"]
        )
    assert out["watchlist"]["watchlist_id"] == "wl-new"
    mock.assert_awaited_once_with(
        "u-2", name="Breakouts", description="", symbols=["TSLA"], bindings=None
    )


@pytest.mark.asyncio
async def test_manage_watchlist_create_requires_name():
    server = _make_server()
    with pytest.raises(ValueError, match="requires a name"):
        await _tool_fn(server, "manage_watchlist")(ctx=_ctx(TRADER), operation="create")


@pytest.mark.asyncio
async def test_manage_watchlist_update_dispatches_with_none_preserved():
    mock = AsyncMock(return_value={"watchlist": {"watchlist_id": "wl-1"}})
    with patch.object(client, "update_watchlist", mock):
        server = _make_server()
        await _tool_fn(server, "manage_watchlist")(
            ctx=_ctx(TRADER), operation="update", watchlist_id="wl-1", name="New Name"
        )
    mock.assert_awaited_once_with(
        "u-2", "wl-1", name="New Name", description=None, symbols=None, bindings=None
    )


@pytest.mark.asyncio
async def test_manage_watchlist_update_requires_watchlist_id():
    server = _make_server()
    with pytest.raises(ValueError, match="requires a watchlist_id"):
        await _tool_fn(server, "manage_watchlist")(ctx=_ctx(TRADER), operation="update", name="x")


@pytest.mark.asyncio
async def test_manage_watchlist_delete_dispatches():
    mock = AsyncMock(return_value={"deleted": True, "watchlist_id": "wl-1"})
    with patch.object(client, "delete_watchlist", mock):
        server = _make_server()
        out = await _tool_fn(server, "manage_watchlist")(
            ctx=_ctx(TRADER), operation="delete", watchlist_id="wl-1"
        )
    assert out["deleted"] is True
    mock.assert_awaited_once_with("u-2", "wl-1")


@pytest.mark.asyncio
async def test_manage_watchlist_delete_system_list_refused():
    err = grpc.aio.AioRpcError(
        grpc.StatusCode.FAILED_PRECONDITION,
        None,
        None,
        details="cannot delete a system-managed watchlist",
    )
    with patch.object(client, "delete_watchlist", AsyncMock(side_effect=err)):
        server = _make_server()
        with pytest.raises(RuntimeError, match="system-managed"):
            await _tool_fn(server, "manage_watchlist")(
                ctx=_ctx(TRADER), operation="delete", watchlist_id="wl-sys"
            )


@pytest.mark.asyncio
async def test_manage_watchlist_unknown_operation():
    server = _make_server()
    with pytest.raises(ValueError, match="expected create/update/delete"):
        await _tool_fn(server, "manage_watchlist")(
            ctx=_ctx(TRADER), operation="frobnicate", watchlist_id="wl-1"
        )


# ── manage_watchlist_symbols verb dispatch (AC-7, AC-8, AC-9) ────────────────


@pytest.mark.asyncio
async def test_manage_symbols_add_dispatches():
    mock = AsyncMock(return_value={"watchlist": {"watchlist_id": "wl-1"}})
    with patch.object(client, "add_watchlist_symbols", mock):
        server = _make_server()
        await _tool_fn(server, "manage_watchlist_symbols")(
            ctx=_ctx(TRADER),
            operation="add",
            watchlist_id="wl-1",
            bindings=[{"symbol": "GOOG", "strategy_id": "sma_crossover"}],
        )
    mock.assert_awaited_once_with(
        "u-2",
        "wl-1",
        symbols=None,
        bindings=[{"symbol": "GOOG", "strategy_id": "sma_crossover"}],
    )


@pytest.mark.asyncio
async def test_manage_symbols_remove_dispatches():
    mock = AsyncMock(return_value={"watchlist": {"watchlist_id": "wl-1"}})
    with patch.object(client, "remove_watchlist_symbols", mock):
        server = _make_server()
        await _tool_fn(server, "manage_watchlist_symbols")(
            ctx=_ctx(TRADER), operation="remove", watchlist_id="wl-1", symbols=["AAPL"]
        )
    mock.assert_awaited_once_with("u-2", "wl-1", symbols=["AAPL"])


@pytest.mark.asyncio
async def test_manage_symbols_requires_watchlist_id():
    server = _make_server()
    with pytest.raises(ValueError, match="requires a watchlist_id"):
        await _tool_fn(server, "manage_watchlist_symbols")(
            ctx=_ctx(TRADER), operation="add", watchlist_id="", symbols=["AAPL"]
        )


@pytest.mark.asyncio
async def test_manage_symbols_unknown_operation_no_rpc():
    add_mock = AsyncMock()
    rm_mock = AsyncMock()
    with (
        patch.object(client, "add_watchlist_symbols", add_mock),
        patch.object(client, "remove_watchlist_symbols", rm_mock),
    ):
        server = _make_server()
        with pytest.raises(ValueError, match="expected add/remove"):
            await _tool_fn(server, "manage_watchlist_symbols")(
                ctx=_ctx(TRADER), operation="replace", watchlist_id="wl-1", symbols=["AAPL"]
            )
    add_mock.assert_not_called()
    rm_mock.assert_not_called()


# ── doc parity (AC-10 / F-12) — docstring AND mcp-tools.md both document each tool ──


def test_doc_parity_docstring_and_runbook():
    server = _make_server()
    runbook = (
        pathlib.Path(__file__).resolve().parents[3] / "docs/runbooks/mcp-tools.md"
    ).read_text()
    for name in _WATCHLIST_TOOLS:
        doc = inspect.getdoc(_tool_fn(server, name)) or ""
        assert doc.strip(), f"{name} must have a docstring"
        assert f"### `{name}`" in runbook, f"mcp-tools.md must document {name}"
