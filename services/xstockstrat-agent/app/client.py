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
IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")


def _metadata() -> list[tuple[str, str]]:
    if MCP_AGENT_SECRET:
        return [("x-mcp-secret", MCP_AGENT_SECRET)]
    return []


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
    ``"COMPARATOR_GTE"``) or a numeric value. The ``component`` field (for technical kinds) is
    not mapped from string input in this thin wrapper. Defaults of ``0`` / ``0.0`` let the analysis
    side apply its own config-driven defaults (e.g. ``analysis.screener.default_rank_limit``).
    Carries only ``x-mcp-secret`` — no admin ``x-access-scope``.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

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
        "coverage_gaps": [{"symbol": g.symbol} for g in resp.coverage_gaps],
    }


async def manage_strategy(
    operation: str,
    definition: dict[str, Any],
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

    # Analysis does a role check on the propagated x-access-scope (admin bit).
    meta = list(_metadata()) + [("x-access-scope", "7")]
    async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
        stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
        resp = await stub.ManageStrategy(
            analysis_pb2.ManageStrategyRequest(operation=op_map[operation], definition=pb_def),
            metadata=meta,
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
) -> dict[str, Any]:
    """Register/update/delete a custom formula via gRPC indicators RPCs.

    Formula management is ownership-based (the indicators backend checks user_id vs author).
    """
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # noqa: PLC0415

    if operation not in ("register", "update", "delete"):
        raise ValueError(f"unknown operation '{operation}' (expected register/update/delete)")

    param_type_map = {
        "int": indicators_pb2.PARAMETER_TYPE_INT,
        "float": indicators_pb2.PARAMETER_TYPE_FLOAT,
        "bool": indicators_pb2.PARAMETER_TYPE_BOOL,
        "string": indicators_pb2.PARAMETER_TYPE_STRING,
    }

    def _build_parameter(d: dict):
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

    parameters = [_build_parameter(d) for d in formula.get("parameters", [])]

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
                ),
                metadata=_metadata(),
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
                    parameters=parameters,
                ),
                metadata=_metadata(),
            )
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


async def manage_signal_source(
    operation: str,
    source: dict[str, Any],
    credentials_ref: str | None = None,
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

    # Forward the admin access scope so ingest's role check (x-access-scope & 0x04) passes.
    meta = list(_metadata()) + [("x-access-scope", "7")]
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
# inbound user context exists, so they carry only _metadata() (x-mcp-secret) — there is no
# x-user-id/x-access-scope to forward at the pre-token stage.


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


async def set_strategy_live(strategy_id: str, live_enabled: bool) -> dict[str, Any]:
    """Enable/disable live evaluation via SetStrategyLive RPC (admin-scoped).

    Forwards the admin access scope so the internal analysis service's role check passes.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

    meta = list(_metadata()) + [("x-access-scope", "7")]
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
