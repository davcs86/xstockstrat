"""`mcp.tool.duration` histogram for every MCP `tools/call` (the agent has no gRPC server)."""

import time

from mcp_types import CallToolResult
from opentelemetry import metrics

UNREGISTERED = "unregistered"
# Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
_BUCKETS_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]


def _is_error_result(result) -> bool:
    match result:
        case CallToolResult(is_error=True) | {"isError": True}:
            return True
        case _:
            return False


class ToolMetricsMiddleware:
    """Times `tools/call` and records `outcome` ok|error; the tool name is bounded to the registered
    set, so a caller-supplied name cannot mint new label values."""

    def __init__(self, server) -> None:
        self._server = server
        self._names: set[str] | None = None
        self._histogram = None

    async def _registered(self) -> set[str]:
        if self._names is None:
            self._names = {tool.name for tool in await self._server.list_tools()}
        return self._names

    def _record(self, name: str, outcome: str, started: float) -> None:
        if self._histogram is None:
            self._histogram = metrics.get_meter(__name__).create_histogram(
                "mcp.tool.duration",
                unit="ms",
                explicit_bucket_boundaries_advisory=_BUCKETS_MS,
            )
        self._histogram.record(
            (time.perf_counter() - started) * 1000.0,
            {"gen_ai.tool.name": name, "outcome": outcome},
        )

    async def __call__(self, ctx, call_next):
        if getattr(ctx, "method", None) != "tools/call":
            return await call_next(ctx)
        requested = (getattr(ctx, "params", None) or {}).get("name")
        name = requested if requested in await self._registered() else UNREGISTERED
        started = time.perf_counter()
        outcome = "error"
        try:
            result = await call_next(ctx)
            outcome = "error" if _is_error_result(result) else "ok"
            return result
        finally:
            self._record(name, outcome, started)
