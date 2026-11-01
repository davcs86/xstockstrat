"""Feature 274 @AC-21 — `mcp.tool.duration` outcome and tool-name labelling."""

from types import SimpleNamespace

import pytest
from mcp_types import CallToolResult, TextContent

from app.main import create_server
from app.tool_metrics import UNREGISTERED, ToolMetricsMiddleware


def _points(reader):
    data = reader.get_metrics_data()
    out = []
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name == "mcp.tool.duration":
                    assert m.unit == "ms"
                    out.extend(m.data.data_points)
    return out


def _by_labels(reader):
    return {
        (p.attributes["gen_ai.tool.name"], p.attributes["outcome"]): p.count
        for p in _points(reader)
    }


@pytest.fixture
def server(metric_reader):
    srv = create_server()

    @srv.tool()
    async def metrics_ok() -> str:
        return "fine"

    @srv.tool()
    async def metrics_raises() -> str:
        raise RuntimeError("boom")

    @srv.tool()
    async def metrics_is_error() -> CallToolResult:
        return CallToolResult(content=[TextContent(type="text", text="bad")], is_error=True)

    return srv


def _middleware(server):
    return next(m for m in server.middleware if isinstance(m, ToolMetricsMiddleware))


async def _call(server, method, name):
    ctx = SimpleNamespace(method=method, params={"name": name})

    async def call_next(_ctx):
        return await server.call_tool(name, {})

    return await _middleware(server)(ctx, call_next)


@pytest.mark.asyncio
async def test_success_records_ok(server, metric_reader):
    await _call(server, "tools/call", "metrics_ok")
    assert _by_labels(metric_reader) == {("metrics_ok", "ok"): 1}


@pytest.mark.asyncio
async def test_raising_tool_records_error_and_reraises(server, metric_reader):
    with pytest.raises(Exception):  # noqa: B017 - the server wraps the tool error type
        await _call(server, "tools/call", "metrics_raises")
    assert _by_labels(metric_reader) == {("metrics_raises", "error"): 1}


@pytest.mark.asyncio
async def test_is_error_result_records_error_and_returns_unchanged(server, metric_reader):
    result = await _call(server, "tools/call", "metrics_is_error")
    assert result.is_error is True
    assert _by_labels(metric_reader) == {("metrics_is_error", "error"): 1}


@pytest.mark.asyncio
async def test_is_error_dict_shape_records_error(server, metric_reader):
    ctx = SimpleNamespace(method="tools/call", params={"name": "metrics_ok"})

    async def call_next(_ctx):
        return {"isError": True}

    await _middleware(server)(ctx, call_next)
    assert _by_labels(metric_reader) == {("metrics_ok", "error"): 1}


@pytest.mark.asyncio
async def test_unknown_tool_name_is_bucketed_as_unregistered(server, metric_reader):
    with pytest.raises(Exception):  # noqa: B017 - unknown tool raises from the server
        await _call(server, "tools/call", "no_such_tool")
    assert _by_labels(metric_reader) == {(UNREGISTERED, "error"): 1}


@pytest.mark.asyncio
async def test_real_registered_tool_name_is_kept(server, metric_reader):
    names = [t.name for t in await server.list_tools()]
    real = next(n for n in names if not n.startswith("metrics_"))
    ctx = SimpleNamespace(method="tools/call", params={"name": real})

    async def call_next(_ctx):
        return CallToolResult(content=[])

    await _middleware(server)(ctx, call_next)
    assert _by_labels(metric_reader) == {(real, "ok"): 1}


@pytest.mark.asyncio
async def test_other_methods_record_nothing(server, metric_reader):
    ctx = SimpleNamespace(method="tools/list", params={})

    async def call_next(_ctx):
        return "listed"

    assert await _middleware(server)(ctx, call_next) == "listed"
    assert _points(metric_reader) == []
