"""Feature 182 — admin user-management + cross-user profile MCP tools (tool layer).

Drives the registered `manage_user` / `list_users` / `get_user` / `admin_get_user_metadata` /
`admin_set_user_metadata` `.fn`s: verb dispatch + argument/role validation, per-tool admin gating
(non-admin rejected before any backend call — @AC-9), gRPC error mapping, and catalog registration.
Mirrors the test_account_tools harness (patch module-level client coroutines).
"""

from unittest.mock import AsyncMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import register_tools
from tests.conftest import ADMIN, TRADER, _ctx

_USER_TOOLS = [
    "manage_user",
    "list_users",
    "get_user",
    "admin_get_user_metadata",
    "admin_set_user_metadata",
]


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


# ── registration + inventory ─────────────────────────────────────────────────


def test_all_user_tools_registered():
    server = _make_server()
    for name in _USER_TOOLS:
        assert server._tool_manager.get_tool(name) is not None, f"{name} not registered"


def test_endpoint_catalog_lists_user_tools():
    from starlette.testclient import TestClient

    from app.main import build_http_app

    with TestClient(build_http_app()) as tc:
        names = {t["name"] for t in tc.get("/api/tools").json()["tools"]}
    assert set(_USER_TOOLS) <= names


# ── manage_user dispatch (AC-1/AC-2/AC-3/AC-4) ───────────────────────────────


@pytest.mark.asyncio
async def test_create_dispatches_and_hides_password():
    """@AC-1: create dispatches to client.create_user; the returned dict carries no password."""
    mock = AsyncMock(
        return_value={"userId": "n1", "email": "q@e.com", "roles": ["trader"], "isActive": True}
    )
    with patch.object(client, "create_user", mock):
        out = await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN),
            operation="create",
            email="q@e.com",
            password="Str0ng-P4ss!",
            roles=["trader"],
        )
    mock.assert_awaited_once_with("q@e.com", "Str0ng-P4ss!", ["trader"])
    assert out["userId"] == "n1"
    assert "password" not in out


@pytest.mark.asyncio
async def test_set_roles_dispatches():
    """@AC-2: set_roles dispatches to client.set_user_roles with the validated role list."""
    mock = AsyncMock(return_value={"userId": "u9", "roles": ["admin", "trader"]})
    with patch.object(client, "set_user_roles", mock):
        out = await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="set_roles", user_id="u9", roles=["trader", "admin"]
        )
    mock.assert_awaited_once_with("u9", ["trader", "admin"])
    assert out["roles"] == ["admin", "trader"]


@pytest.mark.asyncio
async def test_set_active_dispatches():
    """@AC-3: set_active dispatches to client.set_user_active(user_id, False)."""
    mock = AsyncMock(return_value={"userId": "u9", "isActive": False})
    with patch.object(client, "set_user_active", mock):
        out = await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="set_active", user_id="u9", active=False
        )
    mock.assert_awaited_once_with("u9", False)
    assert out["isActive"] is False


@pytest.mark.asyncio
async def test_reset_password_dispatches_and_hides_password():
    """@AC-4: reset_password dispatches; the plaintext is not in the returned dict."""
    mock = AsyncMock(return_value={"success": True, "userId": "u9"})
    with patch.object(client, "reset_password", mock):
        out = await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="reset_password", user_id="u9", password="N3w-P4ssw0rd!"
        )
    mock.assert_awaited_once_with("u9", "N3w-P4ssw0rd!")
    assert "N3w-P4ssw0rd!" not in str(out)


@pytest.mark.asyncio
async def test_set_active_requires_active_flag():
    with pytest.raises(ValueError, match="active"):
        await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="set_active", user_id="u9"
        )


@pytest.mark.asyncio
async def test_manage_user_unknown_operation_raises():
    with pytest.raises(ValueError, match="create/set_roles/set_active/reset_password"):
        await _tool_fn(_make_server(), "manage_user")(ctx=_ctx(ADMIN), operation="delete_all")


@pytest.mark.asyncio
async def test_manage_user_unknown_role_raises():
    with pytest.raises(ValueError, match="unknown role"):
        await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="set_roles", user_id="u9", roles=["superuser"]
        )


@pytest.mark.asyncio
async def test_manage_user_empty_roles_raises():
    with pytest.raises(ValueError, match="non-empty subset"):
        await _tool_fn(_make_server(), "manage_user")(
            ctx=_ctx(ADMIN), operation="create", email="q@e.com", password="pw", roles=[]
        )


# ── readers (AC-5/AC-6) + admin profile (AC-7/AC-8) ──────────────────────────


@pytest.mark.asyncio
async def test_list_users_dispatches():
    """@AC-5: list_users returns the client's entries wrapped under 'users'."""
    mock = AsyncMock(return_value=[{"userId": "u1"}, {"userId": "u2"}, {"userId": "u3"}])
    with patch.object(client, "list_users", mock):
        out = await _tool_fn(_make_server(), "list_users")(ctx=_ctx(ADMIN))
    mock.assert_awaited_once_with()
    assert len(out["users"]) == 3


@pytest.mark.asyncio
async def test_get_user_dispatches():
    """@AC-6: get_user dispatches to client.get_user(user_id)."""
    mock = AsyncMock(return_value={"userId": "11111111-1111-1111-1111-111111111111"})
    with patch.object(client, "get_user", mock):
        out = await _tool_fn(_make_server(), "get_user")(
            ctx=_ctx(ADMIN), user_id="11111111-1111-1111-1111-111111111111"
        )
    mock.assert_awaited_once_with("11111111-1111-1111-1111-111111111111")
    assert out["userId"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_admin_get_user_metadata_dispatches():
    """@AC-7: admin_get_user_metadata dispatches to the client helper for the target user_id."""
    mock = AsyncMock(return_value={"userId": "target-1", "displayName": "Jane Q"})
    with patch.object(client, "admin_get_user_metadata", mock):
        out = await _tool_fn(_make_server(), "admin_get_user_metadata")(
            ctx=_ctx(ADMIN), user_id="target-1"
        )
    mock.assert_awaited_once_with("target-1")
    assert out["displayName"] == "Jane Q"


@pytest.mark.asyncio
async def test_admin_set_user_metadata_dispatches_only_provided_fields():
    """@AC-8: admin_set_user_metadata forwards only the provided field (display_name)."""
    mock = AsyncMock(return_value={"userId": "target-1", "displayName": "Jane Quant"})
    with patch.object(client, "admin_update_user_metadata", mock):
        out = await _tool_fn(_make_server(), "admin_set_user_metadata")(
            ctx=_ctx(ADMIN), user_id="target-1", display_name="Jane Quant"
        )
    mock.assert_awaited_once_with("target-1", phone=None, display_name="Jane Quant", metadata=None)
    assert out["displayName"] == "Jane Quant"


@pytest.mark.asyncio
async def test_admin_set_user_metadata_requires_a_field():
    with pytest.raises(ValueError, match="at least one field"):
        await _tool_fn(_make_server(), "admin_set_user_metadata")(
            ctx=_ctx(ADMIN), user_id="target-1"
        )


# ── @AC-9: every tool denies a non-admin caller before any backend call ──────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tool_name,client_fn,kwargs",
    [
        (
            "manage_user",
            "create_user",
            {"operation": "create", "email": "a@b.c", "password": "pw", "roles": ["trader"]},
        ),
        (
            "manage_user",
            "set_user_roles",
            {"operation": "set_roles", "user_id": "u9", "roles": ["admin"]},
        ),
        (
            "manage_user",
            "set_user_active",
            {"operation": "set_active", "user_id": "u9", "active": False},
        ),
        (
            "manage_user",
            "reset_password",
            {"operation": "reset_password", "user_id": "u9", "password": "pw"},
        ),
        ("list_users", "list_users", {}),
        ("get_user", "get_user", {"user_id": "u9"}),
        ("admin_get_user_metadata", "admin_get_user_metadata", {"user_id": "u9"}),
        (
            "admin_set_user_metadata",
            "admin_update_user_metadata",
            {"user_id": "u9", "display_name": "x"},
        ),
    ],
)
async def test_non_admin_is_denied_with_no_backend_call(tool_name, client_fn, kwargs):
    """@AC-9: a trader (no ADMIN bit) is rejected PermissionError; the client is never awaited."""
    mock = AsyncMock()
    with patch.object(client, client_fn, mock):
        with pytest.raises(PermissionError, match="admin scope"):
            await _tool_fn(_make_server(), tool_name)(ctx=_ctx(TRADER), **kwargs)
    mock.assert_not_awaited()
