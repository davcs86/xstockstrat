"""list_opportunities tool deadline: AC-2 against a hung in-process analysis server, plus the
read-timeout policy fallbacks."""

import asyncio
import math
import time
from unittest.mock import AsyncMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client, tools
from tests.conftest import ADMIN, _ctx

# Bounds every await that would otherwise hang, so a missing deadline fails rather than hangs.
_HANG_GUARD_S = 10


def _list_opportunities_fn():
    server = MCPServer("test-agent")
    tools.register_tools(server)
    return server._tool_manager.get_tool("list_opportunities").fn


async def _start_hung_analysis_server():
    from gen.analysis.v1 import analysis_pb2_grpc  # noqa: PLC0415

    entered = asyncio.Event()

    class _HungAnalysis(analysis_pb2_grpc.AnalysisServiceServicer):
        async def ListOpportunities(self, request, context):  # noqa: N802
            entered.set()
            await asyncio.Event().wait()

    server = grpc.aio.server()
    analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(_HungAnalysis(), server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    return server, port, entered


@pytest.mark.asyncio
async def test_ac2_hung_analysis_read_fails_fast_with_deadline_error(monkeypatch):
    """@AC-2: a hung analysis ListOpportunities surfaces a deadline error instead of hanging."""
    server, port, entered = await _start_hung_analysis_server()
    try:
        monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", f"127.0.0.1:{port}")
        monkeypatch.setattr(
            client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep)
        )

        async def _policy(_key, _default, _cast):
            return 0.2

        monkeypatch.setattr(tools, "_agent_policy", _policy)

        started = time.monotonic()
        with pytest.raises(RuntimeError, match="deadline") as exc_info:
            await asyncio.wait_for(_list_opportunities_fn()(_ctx(ADMIN)), _HANG_GUARD_S)
        elapsed = time.monotonic() - started

        assert elapsed < 1.5
        assert entered.is_set(), "the analysis handler was never reached"
        assert "within 0.2s" in str(exc_info.value)
    finally:
        await server.stop(0)


async def _captured_timeout(monkeypatch, policy) -> float:
    monkeypatch.setattr(tools, "_agent_policy", policy)
    with patch.object(client, "list_opportunities", AsyncMock(return_value={})) as m:
        await asyncio.wait_for(_list_opportunities_fn()(_ctx(ADMIN)), _HANG_GUARD_S)
    return m.call_args.kwargs["timeout"]


@pytest.mark.asyncio
async def test_hung_policy_read_falls_back_to_default_deadline(monkeypatch, caplog):
    async def _hung_policy(_key, _default, _cast):
        await asyncio.Event().wait()

    monkeypatch.setattr(tools, "_POLICY_READ_TIMEOUT_S", 0.1)
    started = time.monotonic()
    with caplog.at_level("WARNING", logger=tools.log.name):
        timeout = await _captured_timeout(monkeypatch, _hung_policy)
    assert timeout == 40.0
    assert time.monotonic() - started < 1.0
    assert "agent policy read timed out; using safe default" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [0.0, -1.0, math.nan, math.inf])
async def test_non_positive_or_non_finite_policy_falls_back_to_default(monkeypatch, bad):
    async def _policy(_key, _default, _cast):
        return bad

    assert await _captured_timeout(monkeypatch, _policy) == 40.0


@pytest.mark.asyncio
async def test_valid_policy_value_is_passed_as_the_deadline(monkeypatch):
    seen: list[str] = []

    async def _policy(key, _default, _cast):
        seen.append(key)
        return 35.0

    assert await _captured_timeout(monkeypatch, _policy) == 35.0
    assert seen == ["opportunities.read_timeout_seconds"]
