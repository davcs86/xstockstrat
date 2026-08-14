"""
Shared async gRPC client for xstockstrat-agent.
MCP_AGENT_SECRET is not sent on outbound calls (feature 097) — it signs the agent's stateless
OAuth txn blob in app/oauth_server.py.
GetConfigValue() makes a one-shot gRPC call to xstockstrat-config to resolve credentials.
"""

import logging
import math
import os
from datetime import UTC, datetime
from typing import Any

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.timestamp_pb2 import Timestamp

log = logging.getLogger(__name__)

INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")
NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")
ANALYSIS_ENDPOINT = os.environ.get("ANALYSIS_ENDPOINT", "xstockstrat-analysis:50056")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")
IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")


def _metadata() -> list[tuple[str, str]]:
    return []


def _iso_to_timestamp(iso_str: str) -> Timestamp:
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


def _ts_to_iso(ts: Timestamp) -> str:
    """RFC3339 UTC string for a protobuf Timestamp (feature 087)."""
    return ts.ToDatetime(tzinfo=UTC).isoformat()


def _scrub_struct_nonfinite(struct) -> None:
    """In-place replace NaN/±Inf `number_value`s in a protobuf Struct with null (feature 087).

    A test_formula dry-run of unvalidated source commonly emits NaN/Inf (div-by-zero, warm-up,
    log≤0); the sandbox does not scrub these, so `MessageToDict` on the output Struct raises
    ValueError (ledger 2026-07-21). Scrubbing the Struct BEFORE projection keeps the dry-run honest
    instead of a 500. Must run on the proto, not the projected dict — MessageToDict is what raises.
    """

    def _scrub_value(v) -> None:
        kind = v.WhichOneof("kind")
        if kind == "number_value" and not math.isfinite(v.number_value):
            v.null_value = 0  # google.protobuf.NullValue.NULL_VALUE
        elif kind == "struct_value":
            _scrub_struct_nonfinite(v.struct_value)
        elif kind == "list_value":
            for item in v.list_value.values:
                _scrub_value(item)

    for v in struct.fields.values():
        _scrub_value(v)


def _build_formula_parameter(d: dict):
    """Build a FormulaParameter proto from a dict (shared by manage_formula + execute_formula)."""
    from gen.indicators.v1 import indicators_pb2  # noqa: PLC0415

    param_type_map = {
        "int": indicators_pb2.PARAMETER_TYPE_INT,
        "float": indicators_pb2.PARAMETER_TYPE_FLOAT,
        "bool": indicators_pb2.PARAMETER_TYPE_BOOL,
        "string": indicators_pb2.PARAMETER_TYPE_STRING,
    }
    p = indicators_pb2.FormulaParameter(
        name=d.get("name", ""),
        type=param_type_map.get(
            str(d.get("type", "")).lower(),
            indicators_pb2.PARAMETER_TYPE_UNSPECIFIED,
        ),
        description=d.get("description", ""),
        required=bool(d.get("required", False)),
    )
    default = d.get("default")
    if isinstance(default, bool):
        p.default_value.bool_value = default
    elif isinstance(default, (int, float)):
        p.default_value.number_value = default
    elif isinstance(default, str):
        p.default_value.string_value = default
    if d.get("min") is not None:
        p.min = float(d["min"])
    if d.get("max") is not None:
        p.max = float(d["max"])
    return p


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
            # Feature 087: surface active + source-health fields the projection had dropped
            "active": src.active,
            "health": _SOURCE_HEALTH_NAME(src.health),
            "last_seen_at": (
                _ts_to_iso(src.last_seen_at) if src.HasField("last_seen_at") else None
            ),
            "last_error": src.last_error,
            # int64 → a JSON number here (manual projection), not the int64-as-string contract.
            "signals_fed": src.signals_fed,
        }
        for src in resp.sources
    ]


def _SOURCE_HEALTH_NAME(value: int) -> str:
    """SourceHealthStatus enum value → its name (feature 087). Imported lazily per AGENT-2."""
    from gen.ingest.v1 import ingest_pb2  # noqa: PLC0415

    return ingest_pb2.SourceHealthStatus.Name(value)


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
    return {"signal_id": resp.signal_id, "deduplicated": resp.deduplicated}


async def emit_alert(
    severity: str,
    category: str,
    title: str,
    body: str,
    source_service: str = "xstockstrat-agent",
    target_user_id: str = "",
    context: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Emit an alert via gRPC EmitAlert."""
    from gen.notify.v1 import notify_pb2, notify_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    severity_val = _SEVERITY_MAP.get(severity.lower(), 1)

    req = notify_pb2.EmitAlertRequest(
        severity=severity_val,
        category=category,
        title=title,
        body=body,
        source_service=source_service,
        target_user_id=target_user_id,
        correlation_id=correlation_id,
    )
    if context:
        # Feature 087: structured context stored + fanned out by notify (context=7).
        req.context.CopyFrom(ParseDict(context, Struct()))
    if tags:
        req.tags.extend(tags)

    async with grpc.aio.insecure_channel(NOTIFY_ENDPOINT) as channel:
        stub = notify_pb2_grpc.NotifyServiceStub(channel)
        resp = await stub.EmitAlert(req, metadata=_metadata())
    return {"alert_id": resp.alert_id}


async def run_backtest(
    strategy_id: str,
    symbols: list[str],
    initial_capital: float = 100000.0,
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    """Trigger a backtest via gRPC RunBacktest.

    ``start``/``end`` are ISO date/datetime strings bounding the **evaluation window**
    (feature 071). Both omitted reproduces the pre-071 rolling default: the servicer treats
    an unset bound (``seconds == 0``) as open and defaults ``end`` → now, ``start`` →
    ``end − analysis.backtest.max_range_days``. Supplying both makes a run reproducible
    across calendar days (FR-4) and equal to the UI's result for the same window (FR-6) —
    the UI sends the identical `range` field. Warm-up bars are fetched from *before*
    ``start`` by the server, so the requested window is evaluated fully warm and no trade
    opens before ``start``.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415
    from gen.common.v1 import common_pb2  # noqa: PLC0415

    start_ts = _iso_to_timestamp(start) if start else None
    end_ts = _iso_to_timestamp(end) if end else None
    if (
        start_ts is not None
        and end_ts is not None
        and (start_ts.seconds, start_ts.nanos) > (end_ts.seconds, end_ts.nanos)
    ):
        raise ValueError("start must not be after end")

    req = analysis_pb2.RunBacktestRequest(
        strategy_id=strategy_id,
        # feature 065: run the strategy's REGISTERED definition (strategy_id_ref ==
        # strategy_id) so agent-triggered runs earn fingerprinted evidence toward the
        # derived headline grade. An unregistered id now returns NOT_FOUND instead of
        # silently running a legacy SMA backtest (design.md § Callers; C-10(b) parity).
        strategy_id_ref=strategy_id,
        symbols=list(symbols),
        initial_capital=initial_capital,
    )
    if start_ts is not None or end_ts is not None:
        tr = common_pb2.TimeRange()
        if start_ts is not None:
            tr.start.CopyFrom(start_ts)
        if end_ts is not None:
            tr.end.CopyFrom(end_ts)
        # One-sided ranges are safe: the servicer defaults each unset bound independently.
        req.range.CopyFrom(tr)

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.RunBacktest(req, metadata=_metadata())
    # feature 064: return the full BacktestResult (including the per-bar `diagnostics`) so the
    # agent can reason over the day-by-day OHLCV/indicator/decision data and suggest strategy or
    # indicator changes. `preserving_proto_field_name` keeps the snake_case keys existing consumers
    # expect; `always_print_fields_with_no_presence` keeps zero-valued metrics (e.g. total_return=0,
    # the exact "0 trades / 0% return" case being debugged) present rather than omitted.
    return MessageToDict(
        resp,
        preserving_proto_field_name=True,
        always_print_fields_with_no_presence=True,
    )


def _build_component(c: dict[str, Any]):
    """Map a component dict → StrategyComponent (feature 090: shared by manage_strategy and the
    screen_symbols technical-criterion component). Raises ValueError on an unknown kind."""
    from gen.analysis.v1 import analysis_pb2  # noqa: PLC0415

    kind_map = {
        "builtin": analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        "formula": analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
    }
    kind = c.get("kind", "builtin")
    if kind not in kind_map:
        raise ValueError(f"unknown component kind '{kind}' (expected builtin/formula)")
    return analysis_pb2.StrategyComponent(
        ref_name=c.get("ref_name", ""),
        kind=kind_map[kind],
        indicator=c.get("indicator", ""),
        formula_id=c.get("formula_id", ""),
        params={k: float(v) for k, v in (c.get("params") or {}).items()},
    )


async def screen_symbols(
    symbols: list[str],
    criteria: list[dict[str, Any]] | None = None,
    signal_sources: list[str] | None = None,
    signal_weight: float = 0.0,
    technical_weight: float = 1.0,
    min_conviction: float = 0.0,
    rank_limit: int = 0,
) -> dict[str, Any]:
    """Scan an explicit symbol universe via gRPC ScreenSymbols (feature 061, read-only).

    ``criteria`` is a list of plain dicts (JSON-shaped) mapped into ``ScreenCriterion`` protos;
    ``kind`` / ``op`` accept either the enum name (e.g. ``"SCREEN_KIND_FUNDAMENTAL"``,
    ``"COMPARATOR_GTE"``) or a numeric value. For technical kinds
    (``SCREEN_KIND_TECHNICAL_*``) supply a ``component`` dict (same shape as a strategy
    component: ``ref_name`` / ``kind`` / ``indicator`` / ``formula_id`` / ``params``) — it is
    mapped via ``_build_component`` and is required by the analysis side to score the criterion
    (feature 090). Defaults of ``0`` / ``0.0`` let the analysis side apply its own config-driven
    defaults (e.g. ``analysis.screener.default_rank_limit``).
    Read-only: carries no admin ``x-access-scope``.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415
    from gen.common.v1 import common_pb2  # noqa: PLC0415

    req_criteria = [
        analysis_pb2.ScreenCriterion(
            ref_name=c.get("ref_name", ""),
            kind=(
                analysis_pb2.ScreenKind.Value(c["kind"])
                if isinstance(c.get("kind"), str)
                else c.get("kind", 0)
            ),
            metric_name=c.get("metric_name", ""),
            op=(
                analysis_pb2.Comparator.Value(c["op"])
                if isinstance(c.get("op"), str)
                else c.get("op", 0)
            ),
            threshold=c.get("threshold", 0.0),
            threshold_high=c.get("threshold_high", 0.0),
            weight=c.get("weight", 0.0),
            hard_filter=c.get("hard_filter", False),
            component=(_build_component(c["component"]) if c.get("component") else None),
        )
        for c in (criteria or [])
    ]
    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ScreenSymbols(
            analysis_pb2.ScreenSymbolsRequest(
                symbols=list(symbols),
                criteria=req_criteria,
                signal_sources=list(signal_sources or []),
                signal_weight=signal_weight,
                technical_weight=technical_weight,
                min_conviction=min_conviction,
                rank_limit=rank_limit,
            ),
            metadata=_metadata(),
        )
    return {
        "results": [
            {
                "symbol": r.symbol,
                "score": r.score,
                "criterion_scores": dict(r.criterion_scores),
                "passed": r.passed,
                "status": analysis_pb2.ScreenResultStatus.Name(r.status),
            }
            for r in resp.results
        ],
        "coverage_gaps": [
            {
                "symbol": g.symbol,
                "timeframe": common_pb2.Timeframe.Name(g.timeframe),
                # int64 fields serialize as JSON strings (matches run_backtest bars contract).
                "bars_have": str(g.bars_have),
                "bars_need": str(g.bars_need),
            }
            for g in resp.coverage_gaps
        ],
    }


async def manage_strategy(
    operation: str,
    definition: dict[str, Any],
    update_mask: list[str] | None = None,
    access_scope: int = 0,
) -> dict[str, Any]:
    """Register/update/deactivate a stored strategy via gRPC ManageStrategy (admin-scoped).

    ``update_mask`` (feature 070) applies to ``update`` only: the listed top-level paths are the
    *only* ones taken from ``definition``; everything else is preserved server-side. A path in the
    mask whose key is absent from ``definition`` is an explicit clear. Omitting the mask entirely
    means full replace — the pre-070 behavior.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    op_map = {
        "register": analysis_pb2.STRATEGY_OPERATION_REGISTER,
        "update": analysis_pb2.STRATEGY_OPERATION_UPDATE,
        "deactivate": analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
        "reactivate": analysis_pb2.STRATEGY_OPERATION_REACTIVATE,
    }
    if operation not in op_map:
        raise ValueError(
            f"unknown operation '{operation}' (expected register/update/deactivate/reactivate)"
        )

    components = [_build_component(c) for c in definition.get("components", [])]

    pb_def = analysis_pb2.StrategyDefinition(
        strategy_id=definition.get("strategy_id", ""),
        display_name=definition.get("display_name", ""),
        components=components,
        entry_rule=definition.get("entry_rule", ""),
        exit_rule=definition.get("exit_rule", ""),
        # feature 070: `active` is deliberately NOT sent. It is column-authoritative — the server
        # overlays it at read time and never writes it from the definition — so including it only
        # injected an unrequested key into the stored definition_json.
        # protobuf treats field=None as omitted for an optional field, so an absent key stays unset
        # and an explicit 0 sets presence (feature 069 — no post-construction assignment needed).
        cooldown_days=definition.get("cooldown_days"),
        exit_cooldown_days=definition.get("exit_cooldown_days"),
    )
    signal_params = definition.get("signal_params")
    if signal_params:
        sp = Struct()
        sp.update(signal_params)
        pb_def.signal_params.CopyFrom(sp)

    req = analysis_pb2.ManageStrategyRequest(operation=op_map[operation], definition=pb_def)
    if update_mask is not None:
        req.update_mask.paths.extend(update_mask)

    # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7). Analysis
    # does the role check on the propagated x-access-scope (admin bit), so it rejects a non-admin.
    meta = [*_metadata(), ("x-access-scope", str(access_scope))]
    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ManageStrategy(req, metadata=meta)
    return MessageToDict(resp)


async def get_strategy(strategy_id: str) -> dict[str, Any]:
    """Fetch a stored strategy definition via gRPC GetStrategy.

    Returns **snake_case** keys (feature 070). The consumer is the `get_strategy` MCP tool, whose
    purpose is fetch → edit → resend into `manage_strategy`, and that input is snake_case
    (`ref_name`, `entry_rule`). Matches the projection used by `run_backtest` and
    `trigger_backfill`. Safe to change: the tool is this wrapper's only caller.

    `always_print_fields_with_no_presence` applies only to fields *without* presence, so
    `optional int32 cooldown_days` stays absent when unset — a fetch→edit→resend round-trip
    cannot fabricate an explicit 0 (the inverse of the feature-069 trap).
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.GetStrategy(
            analysis_pb2.GetStrategyRequest(strategy_id=strategy_id),
            metadata=_metadata(),
        )
    return MessageToDict(
        resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True
    )


async def list_strategy_definitions(include_inactive: bool = False) -> list[dict[str, Any]]:
    """List stored strategy definitions via gRPC ListStrategyDefinitions."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ListStrategyDefinitions(
            analysis_pb2.ListStrategyDefinitionsRequest(include_inactive=include_inactive),
            metadata=_metadata(),
        )
    # Feature 087: snake_case to match get_strategy (avoids a third casing across list→get→manage).
    return [MessageToDict(d, preserving_proto_field_name=True) for d in resp.definitions]


async def execute_formula(
    formula_source: str,
    input_data: dict[str, Any] | None = None,
    input_params: dict[str, Any] | None = None,
    parameters: list[dict[str, Any]] | None = None,
    timeout_ms_override: int = 0,
) -> dict[str, Any]:
    """Dry-run inline formula source in the sandbox via gRPC ExecuteFormula (feature 087).

    Registers nothing — read-only (`_metadata()`, no admin scope; ExecuteFormula performs no
    scope/author check, the subprocess sandbox is the security boundary). Non-finite output values
    are scrubbed to null so the projection never 500s on the median unvalidated-source case.
    """
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    req = indicators_pb2.ExecuteFormulaRequest(
        formula_source=formula_source,
        timeout_ms_override=int(timeout_ms_override or 0),
    )
    if input_data:
        req.input_data.CopyFrom(ParseDict(input_data, Struct()))
    if input_params:
        req.input_params.CopyFrom(ParseDict(input_params, Struct()))
    if parameters:
        for d in parameters:
            req.parameters.append(_build_formula_parameter(d))

    async with grpc.aio.insecure_channel(INDICATORS_ENDPOINT) as channel:
        stub = indicators_pb2_grpc.IndicatorsServiceStub(channel)
        resp = await stub.ExecuteFormula(req, metadata=_metadata())
    _scrub_struct_nonfinite(resp.output)
    try:
        return MessageToDict(
            resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True
        )
    except ValueError as e:  # defence in depth — a non-finite slipped past the scrub
        return {"success": False, "error": f"could not serialize formula output: {e}"}


async def cancel_backfill(job_id: str, access_scope: int = 0) -> dict[str, Any]:
    """Cancel a queued/running backfill job via gRPC CancelBackfill (admin-scoped, feature 087).

    Mirrors trigger_backfill: CancelBackfill is admin-gated server-side, so it forwards the
    caller's derived x-access-scope (feature 092 — no hardcoded admin). Returns the updated job in
    the same {"job": …} envelope as get_backfill_status.
    """
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.CancelBackfill(
            ingest_pb2.CancelBackfillRequest(job_id=job_id),
            metadata=[*_metadata(), ("x-access-scope", str(access_scope))],
        )
    return {
        "job": MessageToDict(
            resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True
        )
    }


async def manage_formula(
    operation: str,
    formula: dict[str, Any],
) -> dict[str, Any]:
    """Register/update/delete a custom formula via gRPC indicators RPCs.

    Formula management is ownership-based (the indicators backend checks user_id vs author).
    """
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415

    if operation not in ("register", "update", "delete"):
        raise ValueError(f"unknown operation '{operation}' (expected register/update/delete)")

    parameters = [_build_formula_parameter(d) for d in formula.get("parameters", [])]

    def _build_output(d: dict):
        # Feature 086: mirror _build_formula_parameter for declared output series (FormulaOutput).
        return indicators_pb2.FormulaOutput(
            name=d.get("name", ""),
            description=d.get("description", ""),
        )

    outputs = [_build_output(d) for d in formula.get("outputs", [])]
    warmup_period = int(formula.get("warmup_period") or 0)

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
                    parameters=parameters,
                    outputs=outputs,
                    warmup_period=warmup_period,
                ),
                metadata=_metadata(),
            )
            return {"formula_id": resp.formula_id}
        if operation == "update":
            from google.protobuf import field_mask_pb2  # noqa: PLC0415

            req = indicators_pb2.UpdateFormulaRequest(
                formula_id=formula["formula_id"],
                user_id=formula["user_id"],
                name=formula.get("name", ""),
                description=formula.get("description", ""),
                source=formula.get("source", ""),
                is_public=formula.get("is_public", False),
                parameters=parameters,
                outputs=outputs,
                warmup_period=warmup_period,
            )
            # Feature 086: AIP-161 partial update. When update_mask is supplied, only the named
            # paths are applied server-side (unlisted fields are preserved); absent = full replace.
            update_mask = formula.get("update_mask")
            if update_mask:
                req.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=list(update_mask)))
            resp = await stub.UpdateFormula(req, metadata=_metadata())
            return MessageToDict(resp.formula)
        resp = await stub.DeleteFormula(
            indicators_pb2.DeleteFormulaRequest(
                formula_id=formula["formula_id"],
                user_id=formula["user_id"],
            ),
            metadata=_metadata(),
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


async def get_formula(formula_id: str) -> dict[str, Any]:
    """Fetch one formula definition via gRPC GetFormula (feature 086 read tool).

    The returned dict includes the ``deleted`` flag, so a caller can do safe read-modify-write
    and see whether a formula has been soft-deleted.
    """
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(INDICATORS_ENDPOINT) as channel:
        stub = indicators_pb2_grpc.IndicatorsServiceStub(channel)
        resp = await stub.GetFormula(
            indicators_pb2.GetFormulaRequest(formula_id=formula_id),
            metadata=_metadata(),
        )
    return MessageToDict(resp)


async def manage_signal_source(
    operation: str,
    source: dict[str, Any],
    credentials_ref: str | None = None,
    update_mask: list[str] | None = None,
    access_scope: int = 0,
) -> dict[str, Any]:
    """Register/update/reactivate/deactivate a signal source via gRPC ManageSignalSource (admin).

    Feature 088: honest verbs. `operation` maps to the SignalSourceOperation enum; on `update`,
    `update_mask` selects the fields to merge (omitted fields are preserved server-side).
    FR-12: credentials_ref is forwarded to the backend but never echoed in the response.
    """
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415
    from google.protobuf import field_mask_pb2  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    op_enum = {
        "register": ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER,
        "update": ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE,
        "reactivate": ingest_pb2.SIGNAL_SOURCE_OPERATION_REACTIVATE,
        "deactivate": ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE,
    }.get(operation, ingest_pb2.SIGNAL_SOURCE_OPERATION_UNSPECIFIED)

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

    req = ingest_pb2.ManageSignalSourceRequest(source=src, operation_enum=op_enum)
    # credentials_ref: set whenever provided (including "" to clear on a masked update); the
    # update_mask decides whether the server applies it or preserves the stored ref.
    if credentials_ref is not None:
        req.credentials_ref = credentials_ref
    if update_mask:
        req.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=list(update_mask)))

    # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7); ingest's
    # role check (x-access-scope & 0x04) rejects a non-admin.
    meta = [*_metadata(), ("x-access-scope", str(access_scope))]
    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.ManageSignalSource(req, metadata=meta)

    # FR-12: never echo credentials_ref back to the caller.
    return {
        "slug": resp.source.slug,
        "display_name": resp.source.display_name,
        "source_type": resp.source.source_type,
        "extractor_module": resp.source.extractor_module,
        "active": resp.source.active,
        "has_credentials": resp.source.has_credentials,
    }


# ── OAuth 2.1 backend gRPC helpers (feature 049 Part B) ──────────────────────
# These call identity's OAuth RPCs over gRPC. DCR + the OAuth handshake happen before any
# inbound user context exists, so they carry only _metadata() (empty since feature 097) — there
# is no x-user-id/x-access-scope to forward at the pre-token stage.


async def register_oauth_client(redirect_uris: list[str], client_name: str) -> dict[str, Any]:
    """RFC 7591 DCR — register a public OAuth client via identity RegisterOAuthClient."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.RegisterOAuthClient(
            identity_pb2.RegisterOAuthClientRequest(
                redirect_uris=redirect_uris, client_name=client_name
            ),
            metadata=_metadata(),
        )
    return {"client_id": resp.client_id, "redirect_uris": list(resp.redirect_uris)}


async def get_oauth_client(client_id: str) -> dict[str, Any]:
    """Fetch a registered OAuth client (for exact-redirect validation at /oauth/authorize)."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.GetOAuthClient(
            identity_pb2.GetOAuthClientRequest(client_id=client_id), metadata=_metadata()
        )
    return {"client_id": resp.client_id, "redirect_uris": list(resp.redirect_uris)}


async def issue_auth_code(
    user_id: str, client_id: str, redirect_uri: str, code_challenge: str, resource: str
) -> str:
    """Mint a single-use authorization code via identity IssueAuthCode."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.IssueAuthCode(
            identity_pb2.IssueAuthCodeRequest(
                user_id=user_id,
                client_id=client_id,
                redirect_uri=redirect_uri,
                code_challenge=code_challenge,
                resource=resource,
            ),
            metadata=_metadata(),
        )
    return resp.code


async def validate_token(token: str) -> dict[str, Any]:
    """Validate a session/access JWT via identity ValidateToken; returns the claims dict.

    Used by /oauth/callback to derive a trustworthy user_id from the same-origin session
    cookie (never from a query param).
    """
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        claims = await stub.ValidateToken(
            identity_pb2.ValidateTokenRequest(token=token), metadata=_metadata()
        )
    return {
        "user_id": claims.user_id,
        "email": claims.email,
        "roles": list(claims.roles),
        "aud": claims.aud,
    }


async def exchange_auth_code(
    code: str, code_verifier: str, redirect_uri: str, client_id: str, resource: str
) -> dict[str, Any]:
    """Exchange an authorization code for tokens via identity ExchangeAuthCode (PKCE verified)."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.ExchangeAuthCode(
            identity_pb2.ExchangeAuthCodeRequest(
                code=code,
                code_verifier=code_verifier,
                redirect_uri=redirect_uri,
                client_id=client_id,
                resource=resource,
            ),
            metadata=_metadata(),
        )
    return {
        "access_token": resp.access_token,
        "token_type": resp.token_type,
        "expires_in": resp.expires_in,
        "refresh_token": resp.refresh_token,
    }


async def refresh_oauth_token(refresh_token: str, resource: str) -> dict[str, Any]:
    """Rotate + refresh OAuth tokens via identity RefreshOAuthToken."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.RefreshOAuthToken(
            identity_pb2.RefreshOAuthTokenRequest(refresh_token=refresh_token, resource=resource),
            metadata=_metadata(),
        )
    return {
        "access_token": resp.access_token,
        "token_type": resp.token_type,
        "expires_in": resp.expires_in,
        "refresh_token": resp.refresh_token,
    }


async def get_user_metadata(user_id: str) -> dict:
    """Fetch the calling user's own profile metadata from identity."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.GetUserMetadata(
            identity_pb2.GetUserMetadataRequest(),
            metadata=[*_metadata(), ("x-user-id", user_id)],
        )
    m = resp.user_metadata
    return {
        "userId": m.user_id,
        "email": m.email,
        "phone": m.phone if m.HasField("phone") else None,
        "displayName": m.display_name if m.HasField("display_name") else None,
        "metadata": dict(m.metadata) if m.metadata else {},
        "metadataUpdatedAt": (
            m.metadata_updated_at.ToJsonString() if m.HasField("metadata_updated_at") else None
        ),
    }


async def update_user_metadata(
    user_id: str,
    phone: str | None = None,
    display_name: str | None = None,
    metadata: dict | None = None,
) -> dict:
    """Partial-update the calling user's own profile metadata."""
    from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415
    from google.protobuf.struct_pb2 import Struct  # noqa: PLC0415

    req = identity_pb2.UpdateUserMetadataRequest()
    if phone is not None:
        req.phone = phone
    if display_name is not None:
        req.display_name = display_name
    if metadata is not None:
        s = Struct()
        s.update(metadata)
        req.metadata.CopyFrom(s)

    async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
        stub = identity_pb2_grpc.IdentityServiceStub(channel)
        resp = await stub.UpdateUserMetadata(
            req,
            metadata=[*_metadata(), ("x-user-id", user_id)],
        )
    m = resp.user_metadata
    return {
        "userId": m.user_id,
        "email": m.email,
        "phone": m.phone if m.HasField("phone") else None,
        "displayName": m.display_name if m.HasField("display_name") else None,
        "metadata": dict(m.metadata) if m.metadata else {},
        "metadataUpdatedAt": (
            m.metadata_updated_at.ToJsonString() if m.HasField("metadata_updated_at") else None
        ),
    }


async def set_strategy_live(
    strategy_id: str, live_enabled: bool, access_scope: int = 0
) -> dict[str, Any]:
    """Enable/disable live evaluation via SetStrategyLive RPC (admin-scoped).

    feature 092: forwards the caller's REAL derived scope (was a hardcoded admin 7) so the internal
    analysis service's role check (admin bit) rejects a non-admin.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    meta = [*_metadata(), ("x-access-scope", str(access_scope))]
    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.SetStrategyLive(
            analysis_pb2.SetStrategyLiveRequest(strategy_id=strategy_id, live_enabled=live_enabled),
            metadata=meta,
        )
    defn = resp.definition
    return {
        "strategy_id": defn.strategy_id,
        "display_name": defn.display_name,
        "live_enabled": defn.live_enabled,
        "active": defn.active,
    }


async def get_config_value(
    key: str, *, namespace: str, environment: str, trading_mode: str = "all"
) -> str | None:
    """Resolve one config value via a one-shot, ENVIRONMENT-SCOPED GetConfig gRPC call.

    Feature 093 fixed three bugs in this helper:
    - **Scope (AC-1):** ``namespace`` and ``environment`` are now REQUIRED — the old body hardcoded
      ``namespace="agent"`` and sent no environment (config defaulted to dev), so a production agent
      read the dev row. Callers pass their real scope (see ``scopes.resolve_scope``).
    - **Typed projection (O1):** returns the ACTIVE oneof stringified, mirroring ``get_config``
      (:872-875). The old ``string_val``-only read returned ``None`` for a non-string key
      (``signal.alert_threshold`` is ``value_type='float'``), so the value never resolved regardless
      of scope.
    - **Error surfacing (AC-2):** a transport error propagates, not swallowed to ``None``.
      ``None`` now means only "key genuinely absent".
    """
    from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

    env, mode = _config_scope(environment, trading_mode)
    try:
        async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
            stub = config_pb2_grpc.ConfigServiceStub(channel)
            snapshot = await stub.GetConfig(
                config_pb2.GetConfigRequest(
                    namespace=namespace, environment=env, trading_mode=mode
                ),
                metadata=_metadata(),
            )
    except grpc.aio.AioRpcError:
        # AC-2: surface a transport failure, never swallow it to None (which is reserved for an
        # absent key). The caller decides whether to fail or fall back to a default.
        log.warning("get_config_value: GetConfig failed for %s.%s", namespace, key)
        raise
    cv = snapshot.values.get(key)
    if cv is None:
        return None
    which = cv.WhichOneof("value")
    return str(getattr(cv, which)) if which else None


# ── backfill client (feature 066) ────────────────────────────────────────────

# Mirror of ingest's accepted timeframe strings and enum values
# (services/xstockstrat-ingest/app/handlers/servicer.py _TF_ALIASES/_STR_TO_ENUM).
# Accepted drift risk: if ingest adds a timeframe, extend these maps (design.md, feature 066).
_TF_ALIASES = {"15m": "15m", "15Min": "15m", "1h": "1h", "1Hour": "1h", "1d": "1d", "1Day": "1d"}
_TF_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}  # common.v1.Timeframe values
_FILL_MODE_MAP = {"full": 1, "gaps_only": 2}  # ingest.v1.FillMode; None → UNSPECIFIED (server FULL)
_BACKFILL_MAX_SYMBOLS = 50  # client-side cost-sanity cap on a paid-fetch operation


async def trigger_backfill(
    symbols: list[str],
    timeframe: str = "1d",
    start: str | None = None,
    end: str | None = None,
    overwrite: bool = False,
    fill_mode: str | None = None,
    access_scope: int = 0,
) -> dict[str, Any]:
    """Trigger a historical OHLCV backfill via gRPC TriggerBackfill (admin-scoped write).

    Ingest queues unconditionally (no synchronous input validation), so the ValueError
    guards below are the caller's only immediate feedback — bad input that passes them
    surfaces later as a terminal FAILED/PARTIAL job via get_backfill_status.
    """
    from gen.common.v1 import common_pb2  # noqa: PLC0415
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415

    if not symbols:
        raise ValueError("symbols must be a non-empty list of tickers")
    if len(symbols) > _BACKFILL_MAX_SYMBOLS:
        raise ValueError(
            f"too many symbols ({len(symbols)}) — max {_BACKFILL_MAX_SYMBOLS} per call"
        )
    if timeframe not in _TF_ALIASES:
        raise ValueError(f"unknown timeframe '{timeframe}' (expected 15m/15Min/1h/1Hour/1d/1Day)")
    if fill_mode is not None and fill_mode not in _FILL_MODE_MAP:
        raise ValueError(f"unknown fill_mode '{fill_mode}' (expected full/gaps_only)")

    start_ts = _iso_to_timestamp(start) if start else None
    end_ts = _iso_to_timestamp(end) if end else None
    if (
        start_ts is not None
        and end_ts is not None
        and (start_ts.seconds, start_ts.nanos) > (end_ts.seconds, end_ts.nanos)
    ):
        raise ValueError("start must not be after end")

    canonical = _TF_ALIASES[timeframe]
    req = ingest_pb2.TriggerBackfillRequest(
        symbols=list(symbols),
        # Dual-field send (FR-2): the deprecated string is populated with the canonical
        # form alongside the enum — never the string alone (ingest persists it raw).
        timeframe=canonical,
        timeframe_enum=_TF_TO_ENUM[canonical],
        overwrite=overwrite,
        fill_mode=_FILL_MODE_MAP[fill_mode] if fill_mode else 0,
    )
    if start_ts is not None or end_ts is not None:
        tr = common_pb2.TimeRange()
        if start_ts is not None:
            tr.start.CopyFrom(start_ts)
        if end_ts is not None:
            tr.end.CopyFrom(end_ts)
        # One-sided ranges are safe: ingest treats an unset bound (seconds == 0) as open.
        req.range.CopyFrom(tr)

    # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7); ingest's
    # new TriggerBackfill gate (x-access-scope & 0x04) rejects a non-admin.
    meta = [*_metadata(), ("x-access-scope", str(access_scope))]
    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.TriggerBackfill(req, metadata=meta)
    return {"job_id": resp.job_id, "status": ingest_pb2.BackfillStatus.Name(resp.status)}


async def get_backfill_status(
    job_id: str = "",
    status_filter: str | None = None,
    symbol: str = "",
    limit: int = 0,
    page_token: str = "",
) -> dict[str, Any]:
    """Check one backfill job or list recent jobs (read-only — no admin scope).

    With ``job_id``: gRPC GetBackfillStatus → ``{"job": {...}}``. Without: gRPC
    ListBackfillJobs → ``{"jobs": [...], "next_page_token": ...}`` — discriminated
    one-key envelopes so callers never key-sniff. AioRpcError (incl. NOT_FOUND)
    propagates; mapping to a tool error happens in the tool layer.
    """
    from gen.common.v1 import common_pb2  # noqa: PLC0415
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415

    if job_id:
        async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
            stub = ingest_pb2_grpc.IngestServiceStub(channel)
            resp = await stub.GetBackfillStatus(
                ingest_pb2.GetBackfillStatusRequest(job_id=job_id), metadata=_metadata()
            )
        # run_backtest's MessageToDict variant: snake_case keys, zero-valued fields
        # (bars_processed=0 while queued) stay visible during polling.
        return {
            "job": MessageToDict(
                resp,
                preserving_proto_field_name=True,
                always_print_fields_with_no_presence=True,
            )
        }

    if status_filter is None or status_filter == "unspecified":
        mapped = 0
    else:
        try:
            mapped = ingest_pb2.BackfillStatus.Value("BACKFILL_STATUS_" + status_filter.upper())
        except ValueError as e:
            raise ValueError(
                f"unknown status_filter '{status_filter}' "
                "(expected queued/running/completed/failed/partial/canceled/unspecified)"
            ) from e
    req = ingest_pb2.ListBackfillJobsRequest(
        status_filter=mapped,
        symbol=symbol,
        page=common_pb2.PageRequest(page_size=limit, page_token=page_token),
    )
    async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:
        stub = ingest_pb2_grpc.IngestServiceStub(channel)
        resp = await stub.ListBackfillJobs(req, metadata=_metadata())
    return {
        "jobs": [
            MessageToDict(
                j,
                preserving_proto_field_name=True,
                always_print_fields_with_no_presence=True,
            )
            for j in resp.jobs
        ],
        "next_page_token": resp.page.next_page_token,
    }


# ── xstockstrat-config: read/write config (feature 073) ──────────────────────────────────────
#
# These deliberately do NOT reuse get_config_value() above, which hardcodes namespace="agent",
# forwards no metadata, and swallows every exception. Errors here must reach the tool layer so
# AGENT-5's mapping can turn them into a useful message -- PERMISSION_DENIED in particular.


def _config_scope(environment: str, trading_mode: str) -> tuple:
    """Translate the caller's scope strings into the proto enums ConfigService expects."""
    from gen.common.v1 import common_pb2  # noqa: PLC0415

    env = (
        common_pb2.ENVIRONMENT_PRODUCTION
        if environment == "production"
        else common_pb2.ENVIRONMENT_DEV
    )
    if trading_mode == "live":
        mode = common_pb2.TRADING_MODE_LIVE
    elif trading_mode == "paper":
        mode = common_pb2.TRADING_MODE_PAPER
    else:
        mode = common_pb2.TRADING_MODE_UNSPECIFIED
    return env, mode


async def get_config(namespace: str, environment: str, trading_mode: str) -> dict:
    """One-shot ConfigService.GetConfig. Read path — no admin scope (AGENT-3)."""
    from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

    env, mode = _config_scope(environment, trading_mode)
    async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
        stub = config_pb2_grpc.ConfigServiceStub(channel)
        resp = await stub.GetConfig(
            config_pb2.GetConfigRequest(namespace=namespace, environment=env, trading_mode=mode),
            metadata=_metadata(),
        )
        values = {}
        for key, cv in resp.values.items():
            which = cv.WhichOneof("value")
            values[key] = {
                "value": getattr(cv, which) if which else None,
                "value_type": (which or "").removesuffix("_val") or "string",
                "is_secret": cv.is_secret,
            }
        return {
            "namespace": resp.namespace,
            "version": resp.version,
            "environment": environment,
            "trading_mode": trading_mode,
            "values": values,
        }


async def list_config_keys(namespace: str, environment: str, trading_mode: str) -> dict:
    """ConfigService.ListKeys — metadata only, never values. Read path, no admin scope."""
    from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

    env, mode = _config_scope(environment, trading_mode)
    async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
        stub = config_pb2_grpc.ConfigServiceStub(channel)
        resp = await stub.ListKeys(
            config_pb2.ListKeysRequest(namespace=namespace, environment=env, trading_mode=mode),
            metadata=_metadata(),
        )
        return {
            "namespace": namespace,
            "environment": environment,
            "trading_mode": trading_mode,
            "keys": [
                {
                    "key": k.key,
                    "description": k.description,
                    "default_value": k.default_value,
                    "is_secret": k.is_secret,
                    "consuming_service": k.consuming_service,
                }
                for k in resp.keys
            ],
        }


async def set_config(
    namespace: str,
    key: str,
    value_type: str,
    value: str,
    environment: str,
    trading_mode: str,
    author: str,
    reason: str,
    access_scope: int,
    create_key: bool = False,
) -> dict:
    """ConfigService.SetConfig, forwarding the REAL caller's access scope.

    Feature 073 introduced caller-derived scope here; feature 092 generalized it to every management
    tool (the hardcoded-admin ``_admin_metadata()`` was removed), so this is no longer an exception.
    The server-side ADMIN-bit gate (feature 074) is what enforces it, so a non-admin caller gets
    PERMISSION_DENIED here rather than a silent success.
    """
    from gen.config.v1 import config_pb2, config_pb2_grpc  # noqa: PLC0415

    env, mode = _config_scope(environment, trading_mode)
    cv = config_pb2.ConfigValue()
    if value_type == "int":
        cv.int_val = int(value)
    elif value_type == "float":
        cv.float_val = float(value)
    elif value_type == "bool":
        cv.bool_val = value.strip().lower() in ("true", "1", "yes")
    else:
        cv.string_val = value

    async with grpc.aio.insecure_channel(CONFIG_ENDPOINT) as channel:
        stub = config_pb2_grpc.ConfigServiceStub(channel)
        resp = await stub.SetConfig(
            config_pb2.SetConfigRequest(
                namespace=namespace,
                key=key,
                value=cv,
                author=author,
                reason=reason,
                environment=env,
                trading_mode=mode,
                create_key=create_key,
            ),
            # The caller's real derived scope, so the server's gate decides (feature 092: every
            # management tool now does this; the hardcoded-admin path was removed).
            metadata=[*_metadata(), ("x-access-scope", str(access_scope))],
        )
        return {"version": resp.version, "updated_at": resp.updated_at.ToDatetime().isoformat()}
