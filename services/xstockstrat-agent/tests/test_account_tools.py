"""Feature 164 — broker-account MCP tools (tool layer).

Drives the registered `manage_account` / `list_accounts` `.fn`s: verb dispatch + argument
validation, the offline-creation steer, gRPC error mapping, ownership forwarding, and catalog
registration. Mirrors the test_watchlist_tools harness (patch module-level client coroutines).
"""

from unittest.mock import AsyncMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import ADMIN, TRADER, _ctx

_ACCOUNT_TOOLS = ["manage_account", "list_accounts"]


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


# ── registration + inventory ─────────────────────────────────────────────────


def test_both_account_tools_registered():
    server = _make_server()
    for name in _ACCOUNT_TOOLS:
        assert server._tool_manager.get_tool(name) is not None, f"{name} not registered"


def test_endpoint_catalog_lists_the_new_tools():
    from starlette.testclient import TestClient

    from app.main import build_http_app

    with TestClient(build_http_app()) as tc:
        names = {t["name"] for t in tc.get("/api/tools").json()["tools"]}
    assert set(_ACCOUNT_TOOLS) <= names


# ── manage_account register (AC-1 dispatch, AC-2, AC-3) ──────────────────────


@pytest.mark.asyncio
async def test_register_dispatches_to_client():
    mock = AsyncMock(return_value={"account": {"id": "acct-7"}})
    with patch.object(client, "register_broker_account", mock):
        server = _make_server()
        out = await _tool_fn(server, "manage_account")(
            ctx=_ctx(TRADER),
            operation="register",
            display_name="My Alpaca",
            broker_type="alpaca",
            credentials_json='{"api_key":"AK"}',
        )
    assert out["account"]["id"] == "acct-7"
    mock.assert_awaited_once_with("u-2", "My Alpaca", "alpaca", '{"api_key":"AK"}')


@pytest.mark.asyncio
async def test_register_requires_broker_type():
    """@AC-2: a missing broker_type is rejected naming the expected values; no RPC is made."""
    mock = AsyncMock()
    with patch.object(client, "register_broker_account", mock):
        server = _make_server()
        with pytest.raises(ValueError, match="broker_type"):
            await _tool_fn(server, "manage_account")(
                ctx=_ctx(TRADER),
                operation="register",
                display_name="My Alpaca",
                broker_type="",
                credentials_json="{}",
            )
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_register_rejects_offline_broker_type():
    """@AC-3: broker_type=offline is steered to manage_offline_account; no register RPC is made."""
    mock = AsyncMock()
    with patch.object(client, "register_broker_account", mock):
        server = _make_server()
        with pytest.raises(ValueError, match="manage_offline_account"):
            await _tool_fn(server, "manage_account")(
                ctx=_ctx(TRADER),
                operation="register",
                display_name="Manual book",
                broker_type="offline",
                credentials_json="",
            )
    mock.assert_not_awaited()


# ── manage_account update_credentials / deregister ───────────────────────────


@pytest.mark.asyncio
async def test_update_credentials_dispatches():
    mock = AsyncMock(return_value={"account": {"id": "acct-7"}})
    with patch.object(client, "update_broker_account_credentials", mock):
        server = _make_server()
        await _tool_fn(server, "manage_account")(
            ctx=_ctx(TRADER),
            operation="update_credentials",
            account_id="acct-7",
            credentials_json='{"api_key":"AKnew"}',
        )
    mock.assert_awaited_once_with("u-2", "acct-7", '{"api_key":"AKnew"}')


@pytest.mark.asyncio
async def test_update_credentials_requires_account_id():
    server = _make_server()
    with pytest.raises(ValueError, match="update_credentials requires"):
        await _tool_fn(server, "manage_account")(
            ctx=_ctx(TRADER), operation="update_credentials", credentials_json="{}"
        )


@pytest.mark.asyncio
async def test_deregister_dispatches():
    mock = AsyncMock(return_value={"deregistered": True, "account_id": "acct-7"})
    with patch.object(client, "deregister_broker_account", mock):
        server = _make_server()
        out = await _tool_fn(server, "manage_account")(
            ctx=_ctx(TRADER), operation="deregister", account_id="acct-7"
        )
    assert out == {"deregistered": True, "account_id": "acct-7"}
    mock.assert_awaited_once_with("u-2", "acct-7")


@pytest.mark.asyncio
async def test_deregister_permission_denied_maps_to_runtimeerror():
    """@AC-7: a non-owner's PERMISSION_DENIED from the backend surfaces as a RuntimeError."""
    err = grpc.aio.AioRpcError(
        grpc.StatusCode.PERMISSION_DENIED, None, None, details="account does not belong to caller"
    )
    with patch.object(client, "deregister_broker_account", AsyncMock(side_effect=err)):
        server = _make_server()
        with pytest.raises(RuntimeError, match="does not belong to caller"):
            await _tool_fn(server, "manage_account")(
                ctx=_ctx({"user_id": "user-99", "roles": ["trader"], "aud": "http://x"}),
                operation="deregister",
                account_id="acct-7",
            )


@pytest.mark.asyncio
async def test_unknown_operation_rejected():
    """@AC-8: an unknown operation is rejected listing the expected verbs."""
    server = _make_server()
    with pytest.raises(ValueError, match="register/update_credentials/deregister/resume"):
        await _tool_fn(server, "manage_account")(ctx=_ctx(TRADER), operation="delete_everything")


# ── manage_account resume (feature 169: AC-1/AC-2/AC-5) ─────────────────────


@pytest.mark.asyncio
async def test_resume_dispatches_to_client():
    """@AC-1/AC-5: resume with admin scope calls resume_broker_account and returns the account."""
    mock = AsyncMock(return_value={"account": {"id": "acct-7", "halted": False}})
    with patch.object(client, "resume_broker_account", mock):
        server = _make_server()
        out = await _tool_fn(server, "manage_account")(
            ctx=_ctx(ADMIN), operation="resume", account_id="acct-7", reason="false alarm"
        )
    assert out["account"]["id"] == "acct-7"
    assert out["account"]["halted"] is False
    mock.assert_awaited_once_with(user_id="u-1", account_id="acct-7", reason="false alarm")


@pytest.mark.asyncio
async def test_resume_requires_admin_scope():
    """@AC-2: resume with non-admin (trader) scope raises PermissionError."""
    mock = AsyncMock()
    with patch.object(client, "resume_broker_account", mock):
        server = _make_server()
        with pytest.raises(PermissionError, match="admin scope"):
            await _tool_fn(server, "manage_account")(
                ctx=_ctx(TRADER), operation="resume", account_id="acct-7"
            )
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_resume_requires_account_id():
    """Resume without account_id raises ValueError."""
    server = _make_server()
    with pytest.raises(ValueError, match="resume requires"):
        await _tool_fn(server, "manage_account")(ctx=_ctx(ADMIN), operation="resume", account_id="")


@pytest.mark.asyncio
async def test_resume_forwards_reason():
    """The optional reason parameter is forwarded verbatim to the client."""
    mock = AsyncMock(return_value={"account": {"id": "acct-7"}})
    with patch.object(client, "resume_broker_account", mock):
        server = _make_server()
        await _tool_fn(server, "manage_account")(
            ctx=_ctx(ADMIN), operation="resume", account_id="acct-7", reason="test reason"
        )
    mock.assert_awaited_once_with(user_id="u-1", account_id="acct-7", reason="test reason")


# ── list_accounts (AC-6) ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_accounts_returns_broker_and_offline():
    """@AC-6: list_accounts forwards the caller and returns broker + offline accounts by type."""
    mock = AsyncMock(
        return_value={
            "accounts": [
                {"id": "acct-7", "broker_type": "BROKER_TYPE_ALPACA"},
                {"id": "acct-9", "broker_type": "BROKER_TYPE_OFFLINE"},
            ]
        }
    )
    with patch.object(client, "list_broker_accounts", mock):
        server = _make_server()
        out = await _tool_fn(server, "list_accounts")(ctx=_ctx(TRADER))
    mock.assert_awaited_once_with("u-2")
    by_id = {a["id"]: a for a in out["accounts"]}
    assert by_id["acct-7"]["broker_type"] == "BROKER_TYPE_ALPACA"
    assert by_id["acct-9"]["broker_type"] == "BROKER_TYPE_OFFLINE"
