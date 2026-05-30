"""
Shared async gRPC client for xstockstrat-agent.
All gRPC calls include x-mcp-secret metadata when MCP_AGENT_SECRET is set.
GetConfigValue() makes a one-shot gRPC call to xstockstrat-config to resolve credentials.
"""
import os
from datetime import datetime, timezone
from typing import Any

import grpc
from google.protobuf.json_format import MessageToDict
from google.protobuf.timestamp_pb2 import Timestamp

INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")
NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")
ANALYSIS_ENDPOINT = os.environ.get("ANALYSIS_ENDPOINT", "xstockstrat-analysis:50056")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")


def _metadata() -> list[tuple[str, str]]:
    if MCP_AGENT_SECRET:
        return [("x-mcp-secret", MCP_AGENT_SECRET)]
    return []


def _iso_to_timestamp(iso_str: str) -> Timestamp:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


_SEVERITY_MAP: dict[str, int] = {
    "info": 1,      # ALERT_SEVERITY_INFO
    "warning": 2,   # ALERT_SEVERITY_WARNING
    "error": 3,     # ALERT_SEVERITY_ERROR
    "critical": 4,  # ALERT_SEVERITY_CRITICAL
}


async def list_signal_sources(include_inactive: bool = False) -> list[dict[str, Any]]:
    """List signal sources via gRPC ListSignalSources."""
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.ListSignalSources(
            ingest_pb2.ListSignalSourcesRequest(include_inactive=include_inactive),
            metadata=_metadata(),
        )
    return [
        {
            "slug": src.slug,
            "display_name": src.display_name,
            "source_type": src.source_type,
            "config_json": MessageToDict(src.config_json),
            "has_credentials": src.has_credentials,
        }
        for src in resp.sources
    ]


async def ingest_signal(
    source: str,
    symbol: str,
    direction: str,
    valid_from: str,
    conviction: float | None = None,
    valid_until: str | None = None,
    headline: str | None = None,
    raw_url: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Ingest a trading signal via gRPC IngestSignal."""
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415

    signal = ingest_pb2.ExternalSignal(
        source=source,
        symbol=symbol,
        direction=direction,
        valid_from=_iso_to_timestamp(valid_from),
    )
    if conviction is not None:
        signal.conviction = conviction
    if valid_until is not None:
        signal.valid_until.CopyFrom(_iso_to_timestamp(valid_until))
    if headline is not None:
        signal.headline = headline
    if raw_url is not None:
        signal.raw_url = raw_url
    if tags is not None:
        signal.tags.extend(tags)

    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.IngestSignal(
            ingest_pb2.IngestSignalRequest(signal=signal),
            metadata=_metadata(),
        )
    return {"signal_id": resp.signal_id}


async def emit_alert(
    severity: str,
    category: str,
    title: str,
    body: str,
    source_service: str = "xstockstrat-agent",
    target_user_id: str = "",
) -> dict[str, Any]:
    """Emit an alert via gRPC EmitAlert."""
    from gen.notify.v1 import notify_pb2, notify_pb2_grpc  # noqa: PLC0415

    severity_val = _SEVERITY_MAP.get(severity.lower(), 1)

    async with grpc.aio.insecure_channel(NOTIFY_ENDPOINT) as channel:
        stub = notify_pb2_grpc.NotifyServiceStub(channel)
        resp = await stub.EmitAlert(
            notify_pb2.EmitAlertRequest(
                severity=severity_val,
                category=category,
                title=title,
                body=body,
                source_service=source_service,
                target_user_id=target_user_id,
            ),
            metadata=_metadata(),
        )
    return {"alert_id": resp.alert_id}


async def run_backtest(
    strategy_id: str,
    symbols: list[str],
    initial_capital: float = 100000.0,
) -> dict[str, Any]:
    """Trigger a backtest via gRPC RunBacktest."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.RunBacktest(
            analysis_pb2.RunBacktestRequest(
                strategy_id=strategy_id,
                symbols=list(symbols),
                initial_capital=initial_capital,
            ),
            metadata=_metadata(),
        )
    return {
        "backtest_id": resp.backtest_id,
        "strategy_id": resp.strategy_id,
        "total_return": resp.total_return,
        "sharpe_ratio": resp.sharpe_ratio,
        "max_drawdown": resp.max_drawdown,
        "win_rate": resp.win_rate,
        "total_trades": resp.total_trades,
    }


async def get_config_value(key: str) -> str | None:
    """
    Resolve a config key value via one-shot GetConfig gRPC call to xstockstrat-config.
    Used by extract_email_content / extract_website_content to resolve credentials.
    Returns None if the key is absent or the call fails.
    """
    try:
        from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

        async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
            stub = config_pb2_grpc.ConfigServiceStub(channel)
            snapshot = await stub.GetConfig(config_pb2.GetConfigRequest(namespace="agent"))
            v = snapshot.values.get(key)
            if v is None:
                return None
            return v.string_val or None
    except Exception:
        return None
