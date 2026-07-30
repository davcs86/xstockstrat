"""Tests for the config MCP tools (feature 073).

Three things these must actually prove, because each was a live design trap:

  1. get_config redacts on the is_secret FLAG, not on the key name — a flagged key need not
     carry the `secret.` prefix.
  2. set_config's transport rule is enforced by the ABSENCE of verified claims on the ASGI
     scope, not by inspecting the request. Both transports hand a tool a Starlette Request with
     an Authorization header, so neither could tell them apart. SSE was removed by 079.
  3. set_config forwards the caller's REAL derived scope, not _admin_metadata()'s hardcoded
     tuple — and the other management tools keep using the hardcoded one.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.scopes import MCP_CLAIMS_SCOPE_KEY, roles_to_access_scope
from app.tools import register_tools


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


def _ctx(claims: dict | None, *, with_request: bool = True):
    """A context whose request carries (or lacks) verified claims on its ASGI scope."""
    state = {MCP_CLAIMS_SCOPE_KEY: claims} if claims is not None else {}
    request = SimpleNamespace(scope={"state": state}) if with_request else None
    return SimpleNamespace(request_context=SimpleNamespace(request=request))


ADMIN = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "http://x"}
TRADER = {"user_id": "u-2", "email": "t@b.c", "roles": ["trader"], "aud": "http://x"}


class TestRolesToAccessScope:
    def test_admin_carries_the_admin_bit(self):
        assert roles_to_access_scope(["admin"]) & 0x04

    def test_trader_and_viewer_do_not(self):
        assert not roles_to_access_scope(["trader"]) & 0x04
        assert not roles_to_access_scope(["viewer"]) & 0x04

    def test_no_roles_is_zero(self):
        assert roles_to_access_scope([]) == 0
        assert roles_to_access_scope(None) == 0

    def test_matches_the_ui_mapping(self):
        # rolesToAccessScope in services/xstockstrat-ui/src/lib/auth.ts
        assert roles_to_access_scope(["admin"]) == 15
        assert roles_to_access_scope(["trader"]) == 11
        assert roles_to_access_scope(["viewer"]) == 1


class TestGetConfigRedaction:
    @pytest.mark.asyncio
    async def test_redacts_on_the_flag_not_the_key_name(self):
        server = _make_server()
        backend = {
            "namespace": "marketdata",
            "version": "1",
            "environment": "dev",
            "trading_mode": "all",
            "values": {
                # flagged but NOT prefixed — the case a name-based check would miss
                "marketdata.vendor.token": {
                    "value": "hunter2",
                    "value_type": "string",
                    "is_secret": True,
                },
                "marketdata.fmp.enabled": {
                    "value": True,
                    "value_type": "bool",
                    "is_secret": False,
                },
            },
        }
        with patch.object(client, "get_config", AsyncMock(return_value=backend)):
            result = await _tool_fn(server, "get_config")(namespace="marketdata")
        assert result["values"]["marketdata.vendor.token"]["value"] == "[redacted]"
        assert "hunter2" not in str(result)
        assert result["values"]["marketdata.fmp.enabled"]["value"] is True


class TestSetConfigGuards:
    @pytest.mark.asyncio
    async def test_rejects_a_secret_prefixed_key_before_any_rpc(self):
        server = _make_server()
        with (
            patch.object(client, "set_config", AsyncMock()) as write,
            patch.object(client, "list_config_keys", AsyncMock()) as listing,
        ):
            with pytest.raises(RuntimeError, match="secret keys are not settable"):
                await _tool_fn(server, "set_config")(
                    ctx=_ctx(ADMIN),
                    namespace="marketdata",
                    key="secret.marketdata.fmp.api_key",
                    value_type="string",
                    value="abc",
                    author="me",
                    reason="r",
                )
        write.assert_not_awaited()
        listing.assert_not_awaited()  # prong (b) runs before any network call

    @pytest.mark.asyncio
    async def test_rejects_a_flagged_key_that_is_not_prefixed(self):
        server = _make_server()
        listing = {"keys": [{"key": "marketdata.vendor.token", "is_secret": True}]}
        with (
            patch.object(client, "list_config_keys", AsyncMock(return_value=listing)),
            patch.object(client, "set_config", AsyncMock()) as write,
        ):
            with pytest.raises(RuntimeError, match="flagged is_secret"):
                await _tool_fn(server, "set_config")(
                    ctx=_ctx(ADMIN),
                    namespace="marketdata",
                    key="marketdata.vendor.token",
                    value_type="string",
                    value="abc",
                    author="me",
                    reason="r",
                )
        write.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_refuses_when_the_is_secret_lookup_fails(self):
        """Fails CLOSED — otherwise prong (a) is decorative."""
        import grpc

        server = _make_server()
        err = grpc.aio.AioRpcError(grpc.StatusCode.UNAVAILABLE, None, None, details="down")
        with (
            patch.object(client, "list_config_keys", AsyncMock(side_effect=err)),
            patch.object(client, "set_config", AsyncMock()) as write,
        ):
            with pytest.raises(RuntimeError, match="cannot verify"):
                await _tool_fn(server, "set_config")(
                    ctx=_ctx(ADMIN),
                    namespace="marketdata",
                    key="marketdata.fmp.enabled",
                    value_type="bool",
                    value="true",
                    author="me",
                    reason="r",
                )
        write.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_refuses_without_verified_claims(self):
        """No verified claims on the scope means the caller's role cannot be established.

        Feature 079 removed the legacy SSE POST /messages channel that used to reach a tool
        without passing _authorized, so this guard is now defence in depth rather than the
        live gate. The assertion is unchanged -- the guard must still hold."""
        server = _make_server()
        with (
            patch.object(client, "list_config_keys", AsyncMock(return_value={"keys": []})),
            patch.object(client, "set_config", AsyncMock()) as write,
        ):
            with pytest.raises(RuntimeError, match="Streamable HTTP"):
                await _tool_fn(server, "set_config")(
                    ctx=_ctx(None),
                    namespace="marketdata",
                    key="marketdata.fmp.enabled",
                    value_type="bool",
                    value="true",
                    author="me",
                    reason="r",
                )
        write.assert_not_awaited()


class TestSetConfigForwardsRealScope:
    @pytest.mark.asyncio
    async def test_forwards_the_admin_scope_derived_from_roles(self):
        server = _make_server()
        with (
            patch.object(client, "list_config_keys", AsyncMock(return_value={"keys": []})),
            patch.object(
                client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
            ) as write,
        ):
            await _tool_fn(server, "set_config")(
                ctx=_ctx(ADMIN),
                namespace="marketdata",
                key="marketdata.fmp.enabled",
                value_type="bool",
                value="true",
                author="me",
                reason="r",
            )
        assert write.await_args.kwargs["access_scope"] == 15  # admin, not the hardcoded 7

    @pytest.mark.asyncio
    async def test_forwards_a_non_admin_scope_unchanged(self):
        """The tool does not pre-judge: it forwards the real scope and lets the server's gate
        return PERMISSION_DENIED. Proves authorization is not silently escalated."""
        server = _make_server()
        with (
            patch.object(client, "list_config_keys", AsyncMock(return_value={"keys": []})),
            patch.object(
                client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
            ) as write,
        ):
            await _tool_fn(server, "set_config")(
                ctx=_ctx(TRADER),
                namespace="marketdata",
                key="marketdata.fmp.enabled",
                value_type="bool",
                value="true",
                author="me",
                reason="r",
            )
        forwarded = write.await_args.kwargs["access_scope"]
        assert forwarded == 11
        assert not forwarded & 0x04


class TestScopeDefaulting:
    @pytest.mark.asyncio
    async def test_defaults_to_the_agent_deployment_scope(self, monkeypatch):
        """Never the proto zero-value: a production agent must not write a dev row."""
        monkeypatch.setenv("APPLICATION_ENV", "production")
        monkeypatch.setenv("TRADING_MODE", "live")
        server = _make_server()
        with patch.object(client, "get_config", AsyncMock(return_value={"values": {}})) as read:
            await _tool_fn(server, "get_config")(namespace="marketdata")
        assert read.await_args.kwargs["environment"] == "production"
        assert read.await_args.kwargs["trading_mode"] == "live"

    @pytest.mark.asyncio
    async def test_an_explicit_parameter_wins(self, monkeypatch):
        monkeypatch.setenv("APPLICATION_ENV", "production")
        server = _make_server()
        with patch.object(client, "get_config", AsyncMock(return_value={"values": {}})) as read:
            await _tool_fn(server, "get_config")(namespace="marketdata", environment="dev")
        assert read.await_args.kwargs["environment"] == "dev"


class TestSdkWiring:
    def test_the_sdk_injects_the_context_parameter(self):
        """Proves find_context_parameter wired ctx — without this the tool would receive a
        plain string and the transport guard would never see claims."""
        server = _make_server()
        assert server._tool_manager.get_tool("set_config").context_kwarg == "ctx"
        # ...and that ctx is NOT exposed in the public inputSchema served by GET /api/tools
        props = server._tool_manager.get_tool("set_config").parameters["properties"]
        assert "ctx" not in props
        assert props["value_type"]["enum"] == ["string", "int", "float", "bool"]

    def test_other_management_tools_still_use_the_hardcoded_admin_tuple(self):
        """FR-5's AGENT-4 deviation is scoped to set_config only."""
        assert client._admin_metadata()[-1] == ("x-access-scope", "7")
