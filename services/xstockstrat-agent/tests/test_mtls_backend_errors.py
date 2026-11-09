"""Feature 294 @AC-21 — `agent.backend.rpc_errors` from the mtls channel wrapper (design.md 1.9)."""

import asyncio
from types import SimpleNamespace

import grpc
import grpc.aio
import pytest
from grpc.aio import AioRpcError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app import client, mtls, tool_metrics, tools
from app.tool_metrics import ToolMetricsMiddleware
from tests.conftest import ADMIN, HANG_GUARD_S, _ctx, _rpc_error
from tests.test_list_opportunities_deadline import _start_hung_analysis_server
from tests.test_tool_metrics import _points, counter_values

_ERRORS = "agent.backend.rpc_errors"


@pytest.mark.asyncio
async def test_rpc_error_leaving_the_block_is_counted_and_propagates_unchanged(metric_reader):
    err = _rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED)
    with pytest.raises(AioRpcError) as exc_info:
        async with mtls.secure_channel("127.0.0.1:1", "xstockstrat-analysis"):
            raise err
    assert exc_info.value is err
    assert counter_values(metric_reader, _ERRORS) == {
        (("backend", "analysis"), ("grpc_code", "DEADLINE_EXCEEDED")): 1
    }


@pytest.mark.asyncio
async def test_list_opportunities_deadline_is_attributed_to_analysis(monkeypatch, metric_reader):
    """@AC-21 end to end: the real wrapper over a loopback analysis fake that never answers."""
    server, port, entered = await _start_hung_analysis_server()
    try:
        monkeypatch.setattr(
            grpc.aio,
            "secure_channel",
            lambda ep, _creds, options=None: grpc.aio.insecure_channel(ep),
        )
        monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", f"127.0.0.1:{port}")

        async def _policy(_key, _default, _cast):
            return 0.2

        monkeypatch.setattr(tools, "_agent_policy", _policy)
        mcp = MCPServer("test-agent")
        tools.register_tools(mcp)
        fn = mcp._tool_manager.get_tool("list_opportunities").fn
        ctx = SimpleNamespace(method="tools/call", params={"name": "list_opportunities"})
        admin = _ctx(ADMIN)

        async def call_next(_mw_ctx):
            return await fn(admin)

        with pytest.raises(ToolError, match="deadline"):
            await asyncio.wait_for(ToolMetricsMiddleware(mcp)(ctx, call_next), HANG_GUARD_S)
        assert entered.is_set(), "the analysis handler was never reached"
    finally:
        await server.stop(0)

    assert counter_values(metric_reader, _ERRORS) == {
        (("backend", "analysis"), ("grpc_code", "DEADLINE_EXCEEDED")): 1
    }
    points = _points(metric_reader)
    assert [set(p.attributes) for p in points] == [{"gen_ai.tool.name", "outcome"}]
    assert dict(points[0].attributes) == {
        "gen_ai.tool.name": "list_opportunities",
        "outcome": "error",
    }


@pytest.mark.asyncio
async def test_non_rpc_exception_is_not_counted(metric_reader):
    with pytest.raises(ValueError):
        async with mtls.secure_channel("127.0.0.1:1", "xstockstrat-analysis"):
            raise ValueError("not an rpc error")
    # Positive control in the same reader: an RPC error on another backend is counted.
    with pytest.raises(AioRpcError):
        async with mtls.secure_channel("127.0.0.1:1", "xstockstrat-ingest"):
            raise _rpc_error(grpc.StatusCode.UNAVAILABLE)
    assert counter_values(metric_reader, _ERRORS) == {
        (("backend", "ingest"), ("grpc_code", "UNAVAILABLE")): 1
    }


@pytest.mark.asyncio
async def test_raising_recorder_still_lets_the_original_error_propagate(monkeypatch):
    def _boom(*_a, **_k):
        raise RuntimeError("telemetry down")

    monkeypatch.setattr(tool_metrics, "record_backend_rpc_error", _boom)
    err = _rpc_error(grpc.StatusCode.UNAVAILABLE)
    with pytest.raises(AioRpcError) as exc_info:
        async with mtls.secure_channel("127.0.0.1:1", "xstockstrat-analysis"):
            raise err
    assert exc_info.value is err
