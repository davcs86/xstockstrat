"""Edge header propagation (PR #994, reversing AGENT-4).

The agent is a platform edge: every backend gRPC a tool triggers must forward the full propagation
trio — x-user-id + x-access-scope + x-trace-id — sourced from the caller's verified OAuth claims,
with a fresh x-trace-id minted at the edge when the caller carried none. This is wired by ONE
`CallerPropagationMiddleware` that binds the identity onto `client`'s per-request contextvar for the
duration of each tools/call, so `client._metadata()` picks it up with no per-tool plumbing.
"""

import pytest
from mcp.server.mcpserver import MCPServer

from app import client
from app.scopes import MCP_CLAIMS_SCOPE_KEY
from app.tools import CallerPropagationMiddleware, register_tools


class _FakeReq:
    def __init__(self, claims: dict | None):
        state = {} if claims is None else {MCP_CLAIMS_SCOPE_KEY: claims}
        self.scope = {"state": state}


class _FakeCtx:
    def __init__(self, method: str, claims: dict | None):
        self.method = method
        self.request = _FakeReq(claims)


class TestMetadataContext:
    def test_no_binding_forwards_nothing(self):
        assert client._metadata() == []

    def test_no_binding_passes_explicit_extra_through(self):
        # Back-compat: a direct client call outside a request (stdio, OAuth handshake, unit tests)
        # still forwards a legacy per-call header verbatim.
        assert client._metadata(("x-access-scope", "7")) == [("x-access-scope", "7")]

    def test_binding_emits_the_full_trio(self):
        token = client.set_caller("u-1", 15, "trace-abc")
        try:
            md = dict(client._metadata())
            assert md == {"x-user-id": "u-1", "x-access-scope": "15", "x-trace-id": "trace-abc"}
        finally:
            client.reset_caller(token)
        assert client._metadata() == []

    def test_context_wins_over_a_redundant_explicit_extra(self):
        token = client.set_caller("u-1", 15, "t")
        try:
            # A legacy per-call ("x-access-scope", …) must NOT double up — the context is the source
            # of truth and de-duplicates it.
            md = client._metadata(("x-access-scope", "999"))
            scopes = [v for k, v in md if k == "x-access-scope"]
            assert scopes == ["15"]
        finally:
            client.reset_caller(token)

    def test_empty_user_id_is_omitted(self):
        token = client.set_caller("", 1, "t")
        try:
            md = dict(client._metadata())
            assert "x-user-id" not in md
            assert md["x-access-scope"] == "1"
        finally:
            client.reset_caller(token)


class TestCallerPropagationMiddleware:
    @pytest.mark.asyncio
    async def test_binds_the_trio_during_a_tools_call(self):
        mw = CallerPropagationMiddleware()
        seen: dict = {}

        async def call_next(ctx):
            seen["md"] = dict(client._metadata())
            return "ok"

        result = await mw(_FakeCtx("tools/call", {"user_id": "u-7", "roles": ["admin"]}), call_next)
        assert result == "ok"
        assert seen["md"]["x-user-id"] == "u-7"
        assert seen["md"]["x-access-scope"] == "15"  # admin
        assert seen["md"]["x-trace-id"]  # minted at the edge
        # Reset after the call — nothing leaks onto the next request on this task.
        assert client._metadata() == []

    @pytest.mark.asyncio
    async def test_mints_a_trace_id_when_claims_carry_none(self):
        mw = CallerPropagationMiddleware()
        seen: dict = {}

        async def call_next(ctx):
            seen["trace"] = dict(client._metadata()).get("x-trace-id")
            return None

        await mw(_FakeCtx("tools/call", {"user_id": "u-1", "roles": ["trader"]}), call_next)
        assert seen["trace"]  # non-empty generated id

    @pytest.mark.asyncio
    async def test_propagates_a_supplied_trace_id(self):
        mw = CallerPropagationMiddleware()
        seen: dict = {}

        async def call_next(ctx):
            seen["trace"] = dict(client._metadata()).get("x-trace-id")
            return None

        claims = {"user_id": "u-1", "roles": ["trader"], "trace_id": "tid-9"}
        await mw(_FakeCtx("tools/call", claims), call_next)
        assert seen["trace"] == "tid-9"

    @pytest.mark.asyncio
    async def test_no_binding_for_non_tool_methods(self):
        mw = CallerPropagationMiddleware()
        seen: dict = {}

        async def call_next(ctx):
            seen["md"] = client._metadata()
            return None

        await mw(_FakeCtx("tools/list", {"user_id": "u-1", "roles": ["admin"]}), call_next)
        assert seen["md"] == []

    @pytest.mark.asyncio
    async def test_no_binding_when_claims_absent(self):
        mw = CallerPropagationMiddleware()
        seen: dict = {}

        async def call_next(ctx):
            seen["md"] = client._metadata()
            return None

        await mw(_FakeCtx("tools/call", None), call_next)
        assert seen["md"] == []

    @pytest.mark.asyncio
    async def test_resets_even_when_the_handler_raises(self):
        mw = CallerPropagationMiddleware()

        async def call_next(ctx):
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            await mw(_FakeCtx("tools/call", {"user_id": "u-1", "roles": ["admin"]}), call_next)
        assert client._metadata() == []  # finally-reset ran


class TestMiddlewareRegistered:
    def test_register_tools_installs_the_propagation_middleware(self):
        server = MCPServer("test-agent")
        register_tools(server)
        assert any(isinstance(m, CallerPropagationMiddleware) for m in server.middleware)
