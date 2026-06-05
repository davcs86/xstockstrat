"""
Shared async gRPC client for xstockstrat-agent.
All gRPC calls include x-mcp-secret metadata when MCP_AGENT_SECRET is set.
GetConfigValue() makes a one-shot gRPC call to xstockstrat-config to resolve credentials.
"""

import os
from datetime import UTC, datetime
from typing import Any

import grpc
from google.protobuf.json_format import MessageToDict
from google.protobuf.timestamp_pb2 import Timestamp

INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")
NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")
ANALYSIS_ENDPOINT = os.environ.get("ANALYSIS_ENDPOINT", "xstockstrat-analysis:50056")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")


def _metadata() -> list[tuple[str, str]]:
    if MCP_AGENT_SECRET:
        return [("x-mcp-secret", MCP_AGENT_SECRET)]
    return []


def _admin_metadata(api_key: str | None = None) -> list[tuple[str, str]]:
    """_metadata() plus an Authorization Bearer header for admin-scoped backend RPCs."""
    meta = list(_metadata())
    if api_key:
        meta.append(("authorization", f"Bearer {api_key}"))
    return meta


def _iso_to_timestamp(iso_str: str) -> Timestamp:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


_SEVERITY_MAP: dict[str, int] = {
    "info": 1,  # ALERT_SEVERITY_INFO
    "warning": 2,  # ALERT_SEVERITY_WARNING
    "error": 3,  # ALERT_SEVERITY_ERROR
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


async def manage_strategy(
    operation: str,
    definition: dict[str, Any],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Register/update/deactivate a stored strategy via gRPC ManageStrategy (admin-scoped)."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    op_map = {
        "register": analysis_pb2.STRATEGY_OPERATION_REGISTER,
        "update": analysis_pb2.STRATEGY_OPERATION_UPDATE,
        "deactivate": analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
    }
    if operation not in op_map:
        raise ValueError(f"unknown operation '{operation}' (expected register/update/deactivate)")

    kind_map = {
        "builtin": analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        "formula": analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
    }
    components = []
    for c in definition.get("components", []):
        kind = c.get("kind", "builtin")
        if kind not in kind_map:
            raise ValueError(f"unknown component kind '{kind}' (expected builtin/formula)")
        components.append(
            analysis_pb2.StrategyComponent(
                ref_name=c.get("ref_name", ""),
                kind=kind_map[kind],
                indicator=c.get("indicator", ""),
                formula_id=c.get("formula_id", ""),
                params={k: float(v) for k, v in (c.get("params") or {}).items()},
            )
        )

    pb_def = analysis_pb2.StrategyDefinition(
        strategy_id=definition.get("strategy_id", ""),
        display_name=definition.get("display_name", ""),
        components=components,
        entry_rule=definition.get("entry_rule", ""),
        exit_rule=definition.get("exit_rule", ""),
        active=definition.get("active", True),
    )
    signal_params = definition.get("signal_params")
    if signal_params:
        sp = Struct()
        sp.update(signal_params)
        pb_def.signal_params.CopyFrom(sp)

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ManageStrategy(
            analysis_pb2.ManageStrategyRequest(operation=op_map[operation], definition=pb_def),
            metadata=_admin_metadata(api_key),
        )
    return MessageToDict(resp)


async def get_strategy(strategy_id: str) -> dict[str, Any]:
    """Fetch a stored strategy definition via gRPC GetStrategy."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.GetStrategy(
            analysis_pb2.GetStrategyRequest(strategy_id=strategy_id),
            metadata=_metadata(),
        )
    return MessageToDict(resp)


async def list_strategy_definitions(include_inactive: bool = False) -> list[dict[str, Any]]:
    """List stored strategy definitions via gRPC ListStrategyDefinitions."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ListStrategyDefinitions(
            analysis_pb2.ListStrategyDefinitionsRequest(include_inactive=include_inactive),
            metadata=_metadata(),
        )
    return [MessageToDict(d) for d in resp.definitions]


async def manage_formula(
    operation: str,
    formula: dict[str, Any],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Register/update/delete a custom formula via gRPC indicators RPCs (admin-scoped)."""
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415

    if operation not in ("register", "update", "delete"):
        raise ValueError(f"unknown operation '{operation}' (expected register/update/delete)")

    async with grpc.aio.insecure_channel(INDICATORS_ENDPOINT) as channel:
        stub = indicators_pb2_grpc.IndicatorsServiceStub(channel)
        if operation == "register":
            resp = await stub.RegisterFormula(
                indicators_pb2.RegisterFormulaRequest(
                    name=formula["name"],
                    description=formula.get("description", ""),
                    source=formula["source"],
                    is_public=formula.get("is_public", False),
                    author=formula.get("author", ""),
                ),
                metadata=_admin_metadata(api_key),
            )
            return {"formula_id": resp.formula_id}
        if operation == "update":
            resp = await stub.UpdateFormula(
                indicators_pb2.UpdateFormulaRequest(
                    formula_id=formula["formula_id"],
                    user_id=formula["user_id"],
                    name=formula.get("name", ""),
                    description=formula.get("description", ""),
                    source=formula.get("source", ""),
                    is_public=formula.get("is_public", False),
                ),
                metadata=_admin_metadata(api_key),
            )
            return MessageToDict(resp.formula)
        resp = await stub.DeleteFormula(
            indicators_pb2.DeleteFormulaRequest(
                formula_id=formula["formula_id"],
                user_id=formula["user_id"],
            ),
            metadata=_admin_metadata(api_key),
        )
        return {"success": resp.success}


async def list_formulas(
    author_filter: str = "",
    include_public: bool = True,
) -> list[dict[str, Any]]:
    """List custom formula definitions via gRPC ListFormulas."""
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(INDICATORS_ENDPOINT) as channel:
        stub = indicators_pb2_grpc.IndicatorsServiceStub(channel)
        resp = await stub.ListFormulas(
            indicators_pb2.ListFormulasRequest(
                author_filter=author_filter, include_public=include_public
            ),
            metadata=_metadata(),
        )
    return [MessageToDict(f) for f in resp.formulas]


async def manage_signal_source(
    operation: str,
    source: dict[str, Any],
    credentials_ref: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Register/update/deactivate a signal source via gRPC ManageSignalSource (admin-scoped).

    FR-12: credentials_ref is forwarded to the backend but never echoed in the response.
    """
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    src = ingest_pb2.SignalSource(
        slug=source.get("slug", ""),
        display_name=source.get("display_name", ""),
        source_type=source.get("source_type", ""),
        extractor_module=source.get("extractor_module", ""),
        active=source.get("active", True),
    )
    config_json = source.get("config_json")
    if config_json:
        cfg = Struct()
        cfg.update(config_json)
        src.config_json.CopyFrom(cfg)

    req = ingest_pb2.ManageSignalSourceRequest(source=src, operation=operation)
    if credentials_ref:
        req.credentials_ref = credentials_ref

    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.ManageSignalSource(req, metadata=_admin_metadata(api_key))

    # FR-12: never echo credentials_ref back to the caller.
    return {
        "slug": resp.source.slug,
        "display_name": resp.source.display_name,
        "source_type": resp.source.source_type,
        "extractor_module": resp.source.extractor_module,
        "active": resp.source.active,
        "has_credentials": resp.source.has_credentials,
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
