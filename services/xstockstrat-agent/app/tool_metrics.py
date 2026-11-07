"""`mcp.tool.duration` histogram for every MCP `tools/call` (the agent has no gRPC server)."""

import logging
import time

import grpc
from mcp_types import CallToolResult
from opentelemetry import metrics

from app import telemetry
from app.scopes import MCP_CLAIMS_SCOPE_KEY

log = logging.getLogger(__name__)

UNREGISTERED = "unregistered"
# Matches scripts/testdata/rpc-status-vectors.json bucket bounds (shared by all runtimes).
_BUCKETS_MS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]


_BACKENDS = frozenset(
    {
        "analysis",
        "ingest",
        "indicators",
        "identity",
        "config",
        "portfolio",
        "trading",
        "marketdata",
        "notify",
    }
)
_GRANT_TYPES = frozenset({"authorization_code", "refresh_token"})
# Fixed invariant (design.md 1.13): at the cap no user id is added, evicted or logged.
_FIRST_CALL_SEEN_CAP = 10000
_first_call_seen: set[str] = set()


def record_auth_rejected(reason: str) -> None:
    """reason: missing_bearer | wrong_audience | identity_unavailable | invalid_token |
    internal_error."""
    telemetry.AUTH_REJECTED.add(1, {telemetry.KEY_REASON: reason})


def record_oauth_request(grant_type: str, outcome: str) -> None:
    """outcome: ok | upstream_error | invalid_grant | error | unsupported_grant_type."""
    grant = grant_type if grant_type in _GRANT_TYPES else "other"
    telemetry.OAUTH_REQUESTS.add(
        1, {telemetry.KEY_GRANT_TYPE: grant, telemetry.KEY_OUTCOME: outcome}
    )


def record_oauth_txn_rejected(reason: str) -> None:
    """reason: malformed | bad_sig | decode | state_mismatch."""
    telemetry.OAUTH_TXN_REJECTED.add(1, {telemetry.KEY_REASON: reason})


def record_backend_rpc_error(backend: str, code) -> None:
    attrs = {
        telemetry.KEY_BACKEND: backend if backend in _BACKENDS else "unknown",
        telemetry.KEY_GRPC_CODE: code.name if isinstance(code, grpc.StatusCode) else "UNKNOWN",
    }
    telemetry.BACKEND_RPC_ERRORS.add(1, attrs)


def record_degraded(kind: str) -> None:
    """kind: alert_threshold_default | auto_alert | watchlist_add | policy_default."""
    telemetry.DEGRADED.add(1, {telemetry.KEY_KIND: kind})


def _log_first_call(ctx) -> None:
    """One INFO per user id per process; `user_id` is a log field, never a metric label."""
    try:
        scope = getattr(getattr(ctx, "request", None), "scope", None) or {}
        claims = (scope.get("state") or {}).get(MCP_CLAIMS_SCOPE_KEY)
        user_id = claims.get("user_id") if isinstance(claims, dict) else None
        if not user_id or user_id in _first_call_seen:
            return
        if len(_first_call_seen) >= _FIRST_CALL_SEEN_CAP:
            return
        _first_call_seen.add(user_id)
        log.info("first successful tool call", extra={"user_id": user_id})
    except Exception:  # noqa: BLE001
        pass


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
            if outcome == "ok" and name != UNREGISTERED:
                _log_first_call(ctx)
