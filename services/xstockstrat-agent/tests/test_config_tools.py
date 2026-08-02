"""Tests for the config MCP tools (feature 073).

Three things these must actually prove, because each was a live design trap:

  1. get_config redacts on the is_secret FLAG, not on the key name — a flagged key need not
     carry the `secret.` prefix.
  2. set_config's transport rule is enforced by the ABSENCE of verified claims on the ASGI
     scope, not by inspecting the request. Both transports hand a tool a Starlette Request with
     an Authorization header, so neither could tell them apart. SSE was removed by 079.
  3. set_config forwards the caller's REAL derived scope, not a hardcoded admin tuple — and
     feature 092 flipped the other management tools to forward the derived scope too.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.scopes import roles_to_access_scope
from app.tools import register_tools
from tests.conftest import ADMIN, TRADER, _ctx  # feature 092 (C-13): shared helpers


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


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


# feature 092: the four formerly-hardcoded-admin tools now forward the caller's derived scope,
# exactly like set_config. (name, client_attr, call_kwargs)
_FLIPPED_TOOLS = [
    ("manage_strategy", "manage_strategy", {"operation": "register", "strategy_id": "x"}),
    ("manage_signal_source", "manage_signal_source", {"operation": "register", "slug": "s"}),
    ("set_strategy_live", "set_strategy_live", {"strategy_id": "x", "live_enabled": True}),
    ("trigger_backfill", "trigger_backfill", {"symbols": ["AAPL"]}),
]


class TestManagementToolsForwardDerivedScope:
    """Feature 092: manage_strategy / manage_signal_source / set_strategy_live / trigger_backfill
    forward the CALLER's derived x-access-scope (was a hardcoded admin 7). RED before the flip:
    the tools had no ctx and the client wrappers hardcoded 7."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool, client_attr, kwargs", _FLIPPED_TOOLS)
    async def test_admin_forwards_scope_15(self, tool, client_attr, kwargs):
        server = _make_server()
        with patch.object(client, client_attr, AsyncMock(return_value={})) as write:
            await _tool_fn(server, tool)(ctx=_ctx(ADMIN), **kwargs)
        assert write.await_args.kwargs["access_scope"] == 15  # admin, not the old hardcoded 7

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool, client_attr, kwargs", _FLIPPED_TOOLS)
    async def test_non_admin_forwards_real_scope_without_admin_bit(self, tool, client_attr, kwargs):
        server = _make_server()
        with patch.object(client, client_attr, AsyncMock(return_value={})) as write:
            await _tool_fn(server, tool)(ctx=_ctx(TRADER), **kwargs)
        forwarded = write.await_args.kwargs["access_scope"]
        assert forwarded == 11  # trader — the backend gate, not the agent, rejects it
        assert not forwarded & 0x04

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool, client_attr, kwargs", _FLIPPED_TOOLS)
    async def test_refuses_without_verified_claims(self, tool, client_attr, kwargs):
        server = _make_server()
        with patch.object(client, client_attr, AsyncMock(return_value={})) as write:
            with pytest.raises(RuntimeError, match="Streamable HTTP"):
                await _tool_fn(server, tool)(ctx=_ctx(None), **kwargs)
        write.assert_not_awaited()


class TestSetConfigCreateKey:
    """Feature 091: the tool forwards create_key to the client (server enforces the gate)."""

    @pytest.mark.asyncio
    async def test_forwards_create_key_true(self):
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
                key="marketdata.fmp.new_knob",
                value_type="bool",
                value="true",
                author="me",
                reason="r",
                create_key=True,
            )
        assert write.await_args.kwargs["create_key"] is True

    @pytest.mark.asyncio
    async def test_defaults_create_key_false(self):
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
        assert write.await_args.kwargs["create_key"] is False


class TestSetConfigRequestParity:
    """Feature 091 (RC-1 guard): the hand-written SetConfigRequest builder must carry EVERY proto
    field. Mirror test_backtest_view.py::test_summary_key_set_covers_every_proto_field — pass a
    non-default value for every field and assert the built request's set fields equal the proto
    descriptor's fields, so a future added field fails closed instead of silently dropping off."""

    @pytest.mark.asyncio
    async def test_builder_covers_every_proto_field(self):
        from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

        captured = {}

        async def _capture(req, metadata=None):
            captured["req"] = req
            return config_pb2.SetConfigResponse(version="1")

        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=MagicMock())
        cm.__aexit__ = AsyncMock(return_value=False)
        stub = MagicMock()
        stub.SetConfig = AsyncMock(side_effect=_capture)
        with (
            patch("app.client.grpc") as mock_grpc,
            patch.object(config_pb2_grpc, "ConfigServiceStub", return_value=stub),
        ):
            mock_grpc.aio.insecure_channel.return_value = cm
            # A distinct non-default value for every SetConfigRequest field so each appears in
            # ListFields(): environment='production'/trading_mode='live' map to non-zero enums.
            await client.set_config(
                namespace="ns",
                key="k",
                value_type="string",
                value="v",
                environment="production",
                trading_mode="live",
                author="a",
                reason="r",
                access_scope=15,
                create_key=True,
            )
        built = {f.name for f, _ in captured["req"].ListFields()}
        assert built == set(config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name)


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

    def test_all_management_tools_forward_the_callers_derived_scope(self):
        """Feature 092: the hardcoded-admin `_admin_metadata()` tuple was removed. Every management
        write tool now takes `ctx` (SDK-injected) and forwards the caller's derived scope — what was
        a set_config-only deviation (AGENT-4) is now the platform-wide rule."""
        assert not hasattr(client, "_admin_metadata"), "the hardcoded admin tuple must be gone"
        server = _make_server()
        for tool in (
            "manage_strategy",
            "manage_signal_source",
            "set_strategy_live",
            "trigger_backfill",
            "set_config",
        ):
            t = server._tool_manager.get_tool(tool)
            assert t.context_kwarg == "ctx", f"{tool} must have SDK-wired ctx"
            assert "ctx" not in t.parameters["properties"], f"{tool} ctx leaked into inputSchema"
