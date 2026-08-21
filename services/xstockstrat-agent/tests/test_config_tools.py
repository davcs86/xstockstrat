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


class TestSetConfigSecretWrites:
    """Feature 147 (PR #994 review): the agent NO LONGER client-side-refuses is_secret writes.

    Secrets are encrypted at rest and row-authoritative on write in xstockstrat-config, and the
    backend admin gate is what authorizes the write — so an admin may set a secret through the MCP.
    The old client-side ListKeys pre-check + `flagged is_secret` refusal was removed; the tool no
    longer calls ListKeys at all."""

    @pytest.mark.asyncio
    async def test_forwards_a_secret_key_write_without_a_client_side_refusal(self):
        server = _make_server()
        with (
            # ListKeys must NOT be consulted any more — patch it to explode if it ever is.
            patch.object(
                client, "list_config_keys", AsyncMock(side_effect=AssertionError("ListKeys called"))
            ),
            patch.object(
                client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
            ) as write,
        ):
            await _tool_fn(server, "set_config")(
                ctx=_ctx(ADMIN),
                namespace="marketdata",
                key="marketdata.alpaca.api_key",
                value_type="string",
                value="PKREALKEY",
                author="me",
                reason="rotate alpaca key",
            )
        # The write is forwarded to the backend (which encrypts it); no refusal, no ListKeys probe.
        write.assert_awaited_once()
        assert write.await_args.kwargs["key"] == "marketdata.alpaca.api_key"

    @pytest.mark.asyncio
    async def test_refuses_without_verified_claims(self):
        """No verified claims on the scope means the caller's role cannot be established.

        Feature 079 removed the legacy SSE POST /messages channel that used to reach a tool
        without passing _authorized, so this guard is now defence in depth rather than the
        live gate. The assertion is unchanged -- the guard must still hold."""
        server = _make_server()
        with patch.object(client, "set_config", AsyncMock()) as write:
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
        with patch.object(
            client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
        ) as write:
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
        with patch.object(
            client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
        ) as write:
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
        with patch.object(
            client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
        ) as write:
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
        with patch.object(
            client, "set_config", AsyncMock(return_value={"version": "1", "updated_at": "t"})
        ) as write:
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
            # A distinct non-default value for every SetConfigRequest field the builder sets so
            # each appears in ListFields(): environment='production' maps to a non-zero enum,
            # user_id is a per-user scope. trading_mode is deprecated (feature 147) and
            # intentionally NOT set by the builder, so it is excluded from the expected set below.
            await client.set_config(
                namespace="ns",
                key="k",
                value_type="string",
                value="v",
                environment="production",
                author="a",
                reason="r",
                access_scope=15,
                create_key=True,
                user_id="u-1",
            )
        built = {f.name for f, _ in captured["req"].ListFields()}
        expected = set(config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name) - {"trading_mode"}
        assert built == expected


class TestScopeIsDeploymentBound:
    """Feature 147 (PR #994 review): the config environment is ALWAYS this agent deployment's own
    environment (APPLICATION_ENV) — there is no caller-facing `environment` parameter to override
    it. env is a deployment property, so a production agent can never read/write a staging row (or
    vice versa)."""

    @pytest.mark.asyncio
    async def test_production_agent_binds_production(self, monkeypatch):
        """Never the proto zero-value: a production agent must not read/write a staging row."""
        monkeypatch.setenv("APPLICATION_ENV", "production")
        server = _make_server()
        with patch.object(client, "get_config", AsyncMock(return_value={"values": {}})) as read:
            await _tool_fn(server, "get_config")(namespace="marketdata")
        assert read.await_args.kwargs["environment"] == "production"

    @pytest.mark.asyncio
    async def test_staging_agent_binds_staging(self, monkeypatch):
        monkeypatch.setenv("APPLICATION_ENV", "development")
        server = _make_server()
        with patch.object(client, "get_config", AsyncMock(return_value={"values": {}})) as read:
            await _tool_fn(server, "get_config")(namespace="marketdata")
        assert read.await_args.kwargs["environment"] == "staging"

    @pytest.mark.asyncio
    async def test_config_tools_expose_no_environment_parameter(self):
        """The `environment` arg was removed from the three config tools (thread 1): a caller
        cannot select a different environment than the agent's own deployment."""
        server = _make_server()
        for tool in ("get_config", "list_config_keys", "set_config"):
            props = server._tool_manager.get_tool(tool).parameters["properties"]
            assert "environment" not in props, f"{tool} still exposes an environment parameter"


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
