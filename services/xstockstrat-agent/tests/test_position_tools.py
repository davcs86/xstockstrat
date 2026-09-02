"""Feature 169 — get_positions + get_positions_by_account_id MCP tool tests.

Exercises both position tools against a mocked client.list_positions, covering all AC scenarios:
AC-1 (all positions), AC-2 (by account), AC-3 (admin user-bound), AC-4 (non-owned empty),
AC-5 (pagination), AC-6 (response shape), AC-9 (account_id required), AC-10 (empty positions).
"""

from unittest.mock import AsyncMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import ADMIN, TRADER, _ctx


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


_SERVER = _make_server()


# ── AC-1, AC-10: get_positions returns all / empty ─────────────────────────


@pytest.mark.asyncio
async def test_get_positions_returns_all_positions():
    """AC-1: get_positions returns all positions for the calling user."""
    mock_result = {
        "positions": [
            {"symbol": "AAPL", "qty": 100, "account_id": "acct-1", "market_value": 15000.0}
        ],
        "next_page_token": "",
    }
    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn = _tool_fn(_SERVER, "get_positions")
        result = await fn(_ctx(TRADER))
    assert result == mock_result
    assert len(result["positions"]) == 1
    assert result["positions"][0]["symbol"] == "AAPL"


@pytest.mark.asyncio
async def test_get_positions_empty():
    """AC-10: get_positions returns empty list when user has no positions."""
    mock_result = {"positions": [], "next_page_token": ""}
    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn = _tool_fn(_SERVER, "get_positions")
        result = await fn(_ctx(TRADER))
    assert result == {"positions": [], "next_page_token": ""}


# ── AC-2: get_positions_by_account_id returns filtered ─────────────────────


@pytest.mark.asyncio
async def test_get_positions_by_account_id_returns_filtered():
    """AC-2: get_positions_by_account_id returns positions for one account."""
    mock_result = {
        "positions": [{"symbol": "AAPL", "qty": 100, "account_id": "acct-1"}],
        "next_page_token": "",
    }
    with patch.object(
        client, "list_positions", new_callable=AsyncMock, return_value=mock_result
    ) as mock_lp:
        fn = _tool_fn(_SERVER, "get_positions_by_account_id")
        result = await fn(_ctx(TRADER), account_id="acct-1")
    assert result == mock_result
    mock_lp.assert_awaited_once()
    assert mock_lp.call_args.kwargs.get("account_id") == "acct-1"


# ── AC-9: account_id required ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_positions_by_account_id_requires_account_id():
    """AC-9: empty account_id raises ValueError."""
    fn = _tool_fn(_SERVER, "get_positions_by_account_id")
    with pytest.raises(ValueError, match="account_id is required"):
        await fn(_ctx(TRADER), account_id="")


# ── AC-3: admin user-bound ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_positions_admin_sees_only_own():
    """AC-3: admin caller's user_id is forwarded, not admin scope."""
    mock_result = {
        "positions": [{"symbol": "GOOG", "qty": 200, "account_id": "acct-admin"}],
        "next_page_token": "",
    }
    with patch.object(
        client, "list_positions", new_callable=AsyncMock, return_value=mock_result
    ) as mock_lp:
        fn = _tool_fn(_SERVER, "get_positions")
        result = await fn(_ctx(ADMIN))
    # Verify the admin's own user_id was forwarded (not an admin override)
    assert mock_lp.call_args.args[0] == "u-1"  # ADMIN user_id
    assert len(result["positions"]) == 1


# ── AC-4: non-owned account returns empty ──────────────────────────────────


@pytest.mark.asyncio
async def test_get_positions_by_account_non_owned_returns_empty():
    """AC-4: non-owned account returns empty list (backend WHERE user_id filter)."""
    mock_result = {"positions": [], "next_page_token": ""}
    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn = _tool_fn(_SERVER, "get_positions_by_account_id")
        result = await fn(_ctx(TRADER), account_id="acct-other")
    assert result["positions"] == []


# ── AC-5: pagination ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_positions_pagination():
    """AC-5: pagination params forwarded and next_page_token returned."""
    mock_result = {
        "positions": [{"symbol": "AAPL", "qty": 10}],
        "next_page_token": "tok-2",
    }
    with patch.object(
        client, "list_positions", new_callable=AsyncMock, return_value=mock_result
    ) as mock_lp:
        fn = _tool_fn(_SERVER, "get_positions")
        result = await fn(_ctx(TRADER), limit=10)
    assert result["next_page_token"] == "tok-2"
    # Verify limit was forwarded
    assert mock_lp.call_args.kwargs.get("limit") == 10 or (
        len(mock_lp.call_args.args) > 1 and mock_lp.call_args.args[1] == 10
    )


# ── AC-6: response shape matches manage_offline_account ────────────────────


@pytest.mark.asyncio
async def test_get_positions_response_shape_matches_manage_offline():
    """AC-6: both tools return snake_case proto field names in positions dict."""
    mock_result = {
        "positions": [
            {
                "symbol": "AAPL",
                "qty": 100,
                "avg_entry_price": 150.0,
                "current_price": 155.0,
                "market_value": 15500.0,
                "unrealized_pnl": 500.0,
                "account_id": "acct-1",
            }
        ],
        "next_page_token": "",
    }
    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn_all = _tool_fn(_SERVER, "get_positions")
        result_all = await fn_all(_ctx(TRADER))

    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn_by_acct = _tool_fn(_SERVER, "get_positions_by_account_id")
        result_by_acct = await fn_by_acct(_ctx(TRADER), account_id="acct-1")

    # Both return the same shape
    assert set(result_all.keys()) == {"positions", "next_page_token"}
    assert set(result_by_acct.keys()) == {"positions", "next_page_token"}
    # Position keys are snake_case proto field names
    pos_keys = set(result_all["positions"][0].keys())
    assert "symbol" in pos_keys
    assert "market_value" in pos_keys
    assert "unrealized_pnl" in pos_keys


# ── No claims → RuntimeError ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_positions_no_claims_raises():
    """No verified claims → RuntimeError."""
    fn = _tool_fn(_SERVER, "get_positions")
    with pytest.raises(RuntimeError, match="Streamable HTTP"):
        await fn(_ctx(None))


# ── Backward compat: manage_offline_account list_positions strips pagination ──


@pytest.mark.asyncio
async def test_manage_offline_account_list_positions_strips_pagination():
    """Step 6: manage_offline_account list_positions strips next_page_token for backward compat."""
    mock_result = {
        "positions": [{"symbol": "AAPL", "qty": 50, "account_id": "off-1"}],
        "next_page_token": "tok-1",
    }
    with patch.object(client, "list_positions", new_callable=AsyncMock, return_value=mock_result):
        fn = _tool_fn(_SERVER, "manage_offline_account")
        result = await fn(_ctx(TRADER), operation="list_positions", account_id="off-1")
    assert "positions" in result
    assert len(result["positions"]) == 1
    assert "next_page_token" not in result
