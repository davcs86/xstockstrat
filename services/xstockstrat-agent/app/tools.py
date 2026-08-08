"""
MCP tool definitions for xstockstrat-agent.

Twenty-two tools:
  list_signal_sources  — lists active sources from ingest, enriched with extractor_tool
  extract_email_content — extracts raw text from email attachments or gated URLs
  extract_website_content — fetches and returns raw text from a registered website source
  ingest_signal        — ingests a trading signal via gRPC IngestSignal
  emit_alert           — emits an alert via gRPC EmitAlert
  run_backtest         — triggers a backtest via gRPC RunBacktest
  screen_symbols       — scans a symbol universe via gRPC ScreenSymbols (read-only)
  manage_strategy     — register/update/deactivate/reactivate stored strategies (update = merge)
  get_strategy        — reads a stored strategy's full definition (read-only)
  manage_formula      — registers/updates(partial merge)/soft-deletes custom formulas in indicators
  get_formula         — reads one stored formula's full definition incl. `deleted` (read-only)
  list_formulas       — lists formula definitions, soft-deleted excluded (read-only)
  manage_signal_source — registers/updates/reactivates/deactivates signal sources in ingest
  set_strategy_live   — enables/disables live alert evaluation for a strategy
  trigger_backfill    — triggers an OHLCV history backfill via gRPC TriggerBackfill (admin-scoped)
  get_backfill_status — checks a backfill job / lists recent jobs (read-only)
  cancel_backfill     — cancels a queued/running backfill job (admin-scoped)
  test_formula        — dry-runs inline formula source in the sandbox, registers nothing (read-only)
  list_strategies     — lists stored strategy definitions (read-only)
  get_config          — reads a namespace's current config values, secrets redacted (read-only)
  list_config_keys    — lists a namespace's registered config keys, metadata only (read-only)
  set_config          — writes one non-secret config value (admin-scoped write)
"""

import base64
import json
import logging
from typing import Literal

import grpc
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import TextContent

from app import backtest_view, client
from app.scopes import MCP_CLAIMS_SCOPE_KEY, resolve_scope, roles_to_access_scope

_ALERT_THRESHOLD_DEFAULT = 0.6
_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"

# feature 093: secure per-source extract credentials are not yet supported. The old path read a
# plaintext `source.<slug>.credentials` config key — a C-05 / config-invariant-#6 violation (secrets
# are is_secret references that GetConfig redacts; a plaintext value would be disclosed unredacted).
# So a source that requires credentials raises loudly (AC-2) instead of silently fetching
# unauthenticated. The secure resolver (AC-3) is a deferred follow-up.
_CREDENTIALS_UNSUPPORTED = (
    "secure per-source credential resolution is not supported yet: source '{slug}' is registered "
    "with credentials (has_credentials=true), but the platform's secret store is not wired to the "
    "extract tools. This is a tracked follow-up (feature 093 AC-3); the tool refuses rather than "
    "fetch unauthenticated content."
)

log = logging.getLogger(__name__)


def _claims_from_context(ctx: Context) -> dict | None:
    """The verified caller claims app/main.py's `_authorized` put on this request's ASGI scope.

    Returns None whenever they are absent. Feature 079 removed the legacy SSE transport, whose
    `POST /messages` returned before `_authorized` ever ran, so on the surviving Streamable HTTP
    transport the claims are always present and this check is defence in depth. Keep it shaped
    this way: back when both transports existed, a check for a Starlette Request or an
    Authorization header would NOT have told them apart -- both carried both.
    """
    try:
        request = ctx.request_context.request
    except (ValueError, AttributeError):
        return None
    scope = getattr(request, "scope", None) or {}
    claims = (scope.get("state") or {}).get(MCP_CLAIMS_SCOPE_KEY)
    return claims if isinstance(claims, dict) else None


def _require_claims(ctx: Context, tool: str) -> dict:
    """Materialize and validate the caller's claims, raising if absent.

    Single choke point for "no verified claims on this request" — both
    ``_caller_access_scope`` (role-derived ``x-access-scope``) and ``_caller_user_id``
    (identity for ``emit_alert``/``manage_formula``) go through this so the raise condition
    and message live in exactly one place."""
    claims = _claims_from_context(ctx)
    if claims is None:
        raise RuntimeError(
            f"{tool} requires the Streamable HTTP transport, where the tool call itself "
            "is authenticated. No verified caller claims are present on this request, so the "
            "caller's role cannot be established. (The legacy SSE transport, which never "
            "authenticated individual tool calls, was removed by feature 079.)"
        )
    return claims


def _caller_access_scope(ctx: Context, tool: str) -> int:
    """Derive the REAL caller's ``x-access-scope`` from their verified claims.

    Feature 073 introduced this for ``set_config``; feature 092 generalized it to every management
    write tool (``manage_strategy``, ``manage_signal_source``, ``set_strategy_live``,
    ``trigger_backfill``) so admin is *verified by the backend gate*, not asserted via a hardcoded
    scope. Raises when no verified claims are present (the Streamable HTTP transport authenticates
    the tool call itself; the legacy SSE transport that didn't was removed by feature 079)."""
    claims = _require_claims(ctx, tool)
    return roles_to_access_scope(claims.get("roles"))


def _caller_user_id(ctx: Context, tool: str) -> str:
    """Derive the REAL caller's own user id from their verified claims, raising if empty.

    A thin wrapper over ``_require_claims`` for tools (``emit_alert``, ``manage_formula``)
    that need the caller's own identity rather than their access scope. Raises rather than
    returning "" on a falsy claims user_id: notify's EmitAlertRequest.target_user_id == ""
    means BROADCAST (packages/proto/notify/v1/notify.proto:34), so silently returning "" here
    would make a caller who explicitly chose not to broadcast broadcast anyway."""
    claims = _require_claims(ctx, tool)
    user_id = claims.get("user_id")
    if not user_id:
        raise RuntimeError(
            f"{tool} requires the caller's verified claims to carry a non-empty user_id, "
            "but none was present. Refusing rather than deriving an empty identity."
        )
    return user_id


def _grpc_error_message(exc: grpc.aio.AioRpcError, not_found: str = "not found") -> str:
    """Map a gRPC error to a concise, caller-facing message for an MCP tool."""
    code = exc.code()
    if code == grpc.StatusCode.NOT_FOUND:
        return not_found
    if code == grpc.StatusCode.UNAUTHENTICATED:
        return exc.details() or "unauthorized"
    if code == grpc.StatusCode.PERMISSION_DENIED:
        return exc.details() or "permission denied"
    if code == grpc.StatusCode.INVALID_ARGUMENT:
        return exc.details() or "invalid argument"
    return exc.details() or str(code)


# Type-level mapping: source_type → extractor_tool
# Derives extractor_tool from source_type at the agent layer only.
# The underlying ListSignalSources RPC and proto are unchanged.
_EXTRACTOR_TOOL_MAP: dict[str, str | None] = {
    "mediated_email_attachment": "extract_email_content",
    "mediated_linked_email": "extract_email_content",
    "mediated_simple_website": "extract_website_content",
    "mediated_authenticated_website": "extract_website_content",
    # All other types (mediated_simple_email and all non-mediated) → null
}


def register_tools(server: MCPServer) -> None:

    @server.tool()
    async def list_signal_sources(
        source_type: list[str] | None = None,
    ) -> dict:
        """List active signal sources from xstockstrat-ingest.
        Returns slug, display_name, source_type, config_json, and extractor_tool per source.
        extractor_tool: 'extract_email_content' | 'extract_website_content' | null.
        Claude must follow extractor_tool exactly — do not infer routing from source_type.
        source_type: optional filter list
            (e.g. ['mediated_simple_email', 'mediated_email_attachment'])."""
        sources = await client.list_signal_sources(include_inactive=False)
        # Enrich each source with extractor_tool derived from source_type.
        # has_credentials and credentials are intentionally excluded — never exposed to Claude.
        enriched = []
        for src in sources:
            st = src["source_type"]
            enriched.append(
                {
                    "slug": src["slug"],
                    "display_name": src["display_name"],
                    "source_type": st,
                    "config_json": src["config_json"],
                    "extractor_tool": _EXTRACTOR_TOOL_MAP.get(st, None),
                }
            )
        if source_type:
            enriched = [s for s in enriched if s["source_type"] in source_type]
        return {"sources": enriched}

    @server.tool()
    async def extract_email_content(
        source_slug: str,
        attachments_b64: list[str] | None = None,
        urls: list[str] | None = None,
    ) -> dict:
        """Extract raw text from email attachments or gated URLs for a registered source.
        Called only when a source's extractor_tool equals 'extract_email_content'.
        source_slug: slug from list_signal_sources.
        attachments_b64: list of base64-encoded attachment bytes (PDF, etc.).
        urls: list of URLs to fetch (for mediated_linked_email sources).
        At least one of attachments_b64 or urls must be provided.
        Returns {raw_text: str}. Credentials are never exposed in the response.
        CREDENTIAL CAVEAT (feature 093): a source that requires credentials (has_credentials=true)
            currently RAISES — secure per-source credential resolution is not yet supported, because
            the platform stores secrets as is_secret references that the config service redacts, so
            there is no safe way to resolve a password here. Only sources with has_credentials=false
            (no credentials needed) are extractable today. Secure resolution is a follow-up."""
        if not attachments_b64 and not urls:
            raise ValueError("At least one of attachments_b64 or urls must be provided")

        src = await _get_source(source_slug)

        if src.get("has_credentials"):
            raise RuntimeError(_CREDENTIALS_UNSUPPORTED.format(slug=source_slug))

        texts: list[str] = []

        if attachments_b64:
            for b64_data in attachments_b64:
                raw = base64.b64decode(b64_data)
                text = _extract_from_bytes(raw, password=None)
                texts.append(text)

        if urls:
            for url in urls:
                text = await _fetch_url(url, password=None)
                texts.append(text)

        return {"raw_text": "\n\n".join(texts)}

    @server.tool()
    async def extract_website_content(
        source_slug: str,
    ) -> dict:
        """Fetch and return raw text from a registered website source.
        Called only when a source's extractor_tool equals 'extract_website_content'.
        source_slug: slug from list_signal_sources.
        The URL is read from the source's config_json.url — Claude never constructs URLs.
        Returns {raw_text: str}. Credentials are never exposed in the response.
        CREDENTIAL CAVEAT (feature 093): a source that requires credentials (has_credentials=true)
            currently RAISES — secure per-source credential resolution is not yet supported (the
            platform stores secrets as is_secret references the config service redacts). Only
            has_credentials=false sources work today; secure resolution is a follow-up."""
        src = await _get_source(source_slug)

        config_json = src.get("config_json") or {}
        url = config_json.get("url")
        if not url:
            raise ValueError(f"Source '{source_slug}' has no url in config_json")

        if src.get("has_credentials"):
            raise RuntimeError(_CREDENTIALS_UNSUPPORTED.format(slug=source_slug))

        # Optional per-source request headers (e.g. SEC EDGAR rejects requests
        # without a declared User-Agent identifying the caller).
        request_headers = config_json.get("request_headers")
        if not isinstance(request_headers, dict):
            request_headers = None

        text = await _fetch_url(url, password=None, headers=request_headers)
        return {"raw_text": text}

    @server.tool()
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
    ) -> dict:
        """Ingest a trading signal into xstockstrat-ingest.
        source: slug from list_signal_sources (required, validated by ingest).
        symbol: ticker symbol e.g. 'NVDA'.
        direction: one of 'buy', 'sell', 'hold', 'watchlist'.
        valid_from: ISO 8601 datetime string e.g. '2026-05-01T00:00:00Z'.
        conviction: float in (0.0, 1.0], optional. There is NO source default — an omitted
            conviction is stored as NULL, not backfilled, so pass it explicitly whenever known. An
            out-of-range value (< 0.0 or > 1.0) or NaN is rejected INVALID_ARGUMENT at the ingest
            boundary; 0.0 (or an omitted conviction) is stored as NULL.
        SIDE EFFECT: on success this tool AUTO-EMITS an alert when conviction is present and >= the
            agent.signal.alert_threshold config value (default 0.6); an alert failure does not fail
            the ingest. Do NOT also call emit_alert for the same signal, or you will double-alert.
        Returns {"signal_id": <int>, "deduplicated": <bool>} on success — deduplicated=true means
            this submission matched an existing signal within the dedup window and no new row was
            inserted (the auto-alert above is suppressed in that case); raises on unknown source
            slug (INVALID_ARGUMENT)."""
        result = await client.ingest_signal(
            source=source,
            symbol=symbol,
            direction=direction,
            valid_from=valid_from,
            conviction=conviction,
            valid_until=valid_until,
            headline=headline,
            raw_url=raw_url,
            tags=tags,
        )
        # Auto-emit alert for high-conviction signals — deterministic rule, not model-driven.
        # feature 093: env-scoped read (was env-blind → always the dev row → the default). Broad
        # try/except because this read is POST-COMMIT (the signal is already persisted above), so it
        # must never fail ingest_signal — any error falls back to the default.
        env, mode = _resolve_scope("", "")
        try:
            threshold_str = await client.get_config_value(
                _ALERT_THRESHOLD_CONFIG_KEY, namespace="agent", environment=env, trading_mode=mode
            )
            alert_threshold = (
                float(threshold_str) if threshold_str is not None else _ALERT_THRESHOLD_DEFAULT
            )
        except Exception as e:
            log.warning("alert-threshold read failed, using default: %s", e)
            alert_threshold = _ALERT_THRESHOLD_DEFAULT
        if (
            not result.get("deduplicated")
            and conviction is not None
            and conviction >= alert_threshold
        ):
            try:
                alert_title = headline if headline else f"{direction.upper()} {symbol} via {source}"
                alert_body = f"Signal ingested: {direction} {symbol} (conviction {conviction:.2f})"
                if valid_until:
                    alert_body += f", valid until {valid_until}"
                await client.emit_alert(
                    severity="info",
                    category="signal",
                    title=alert_title,
                    body=alert_body,
                    source_service="xstockstrat-agent",
                    target_user_id="",
                )
            except Exception as e:
                log.warning(
                    "Auto-alert failed after ingest_signal (signal already ingested): %s", e
                )
        return result

    @server.tool()
    async def emit_alert(
        ctx: Context,
        severity: str,
        category: str,
        title: str,
        body: str,
        broadcast: bool,
        source_service: str = "xstockstrat-agent",
        context: dict | None = None,
        tags: list[str] | None = None,
        correlation_id: str = "",
    ) -> dict:
        """Emit an alert via xstockstrat-notify.
        severity: one of 'info', 'warning', 'error', 'critical' (case-insensitive). Any
            unrecognized value is silently coerced to 'info' — it is not rejected.
        category: alert category e.g. 'signal', 'system'.
        title/body: required and non-blank — an empty or whitespace-only title or body is
            rejected INVALID_ARGUMENT by notify, so populate both.
        broadcast: REQUIRED, no default. True sends a system-wide broadcast (unchanged semantic —
            target_user_id="" on the wire). False addresses the alert to the OAuth-authenticated
            caller's own derived identity — you can no longer address another user.
        context: optional structured JSON object stored and fanned out with the alert.
        tags: optional list of string tags for filtering/grouping.
        correlation_id: optional id to correlate related alerts.
        Use for system-level alerts or alerts not tied to a specific ingested signal (ingest_signal
            already auto-alerts high-conviction signals).
        Returns {"alert_id": <str>}."""
        target_user_id = "" if broadcast else _caller_user_id(ctx, "emit_alert")
        return await client.emit_alert(
            severity=severity,
            category=category,
            title=title,
            body=body,
            source_service=source_service,
            target_user_id=target_user_id,
            context=context,
            tags=tags,
            correlation_id=correlation_id,
        )

    # structured_output=False is forward-protection, not load-bearing today: for a bare `-> list`
    # the SDK builds no output schema either way. It becomes load-bearing only if the annotation is
    # ever parameterized (`list[ContentBlock]`), which would build one by default.
    @server.tool(structured_output=False)
    async def run_backtest(
        strategy_id: str,
        symbols: list[str],
        initial_capital: float = 100000.0,
        start: str | None = None,
        end: str | None = None,
    ) -> list:
        """Trigger a backtest via xstockstrat-analysis.
        strategy_id: identifies the strategy (e.g. 'sma_crossover'). Must be a REGISTERED strategy
          definition — the run executes that definition and earns evidence toward its derived
          headline grade (feature 065). An unregistered id returns NOT_FOUND (the legacy ad-hoc
          SMA-crossback path is no longer reachable from the agent).
        symbols: list of ticker symbols e.g. ['NVDA', 'AAPL'].
        initial_capital: starting capital in USD (default 100000).
        start / end: optional ISO date or datetime bounds ('2024-01-01', '2024-06-30T00:00:00Z')
          for the evaluation window. Supply BOTH to get a reproducible result — a run over an
          explicit window returns the same numbers on any calendar day, so it is comparable across
          strategies and across days. Omitting them keeps the rolling default (a window ending
          today), whose results drift day to day. Either bound may be given alone; the other stays
          at its default. Indicators are warmed on bars fetched from before `start`, so the whole
          window is evaluated fully warm and no trade opens before `start`. If the stored history
          does not reach back far enough to warm the indicators, the run reports
          BACKTEST_STATUS_INSUFFICIENT_DATA with `coverage_gaps` — use trigger_backfill to fill
          them, then re-run.
        Returns TWO parts. First, a compact JSON summary as a text block: `backtest_id`, `status`,
        the headline metrics, any `coverage_gaps`, and per symbol its `no_trade_reason`,
        `bars_total` and `warmup_bars` — enough to explain why a strategy produced 0 trades and
        suggest changes **without opening the attachment**. Second, an attached
        `application/json` resource carrying the COMPLETE result: the full per-bar `diagnostics`
        (OHLCV, computed indicator values, warm-up flag, entry/exit/conviction decision) and the
        full `trades` list. Open it when you need bar-level detail.
        A run with no diagnostics and no trades (e.g. BACKTEST_STATUS_INSUFFICIENT_DATA) has NO
        attachment — the summary with `coverage_gaps` is the whole result.
        `summary["attachments"]` names each attached resource's `uri` and `mime_type`, so you can
        tell the user detail exists even if your client shows no attachment affordance.
        Note: 64-bit integer fields in the attached full result (e.g. per-bar `volume`, and
        `bars_have`/`bars_need` inside `coverage_gaps`) are serialized as JSON STRINGS, not
        numbers — parse them before arithmetic."""
        result = await client.run_backtest(
            strategy_id=strategy_id,
            symbols=symbols,
            initial_capital=initial_capital,
            start=start,
            end=end,
        )
        # summarize() is deliberately OUTSIDE the try: a projection bug is a real failure. Only
        # attachment construction degrades.
        summary = backtest_view.summarize(result)
        blocks: list = []
        try:
            blocks = backtest_view.build_blocks(result)
            summary["attachments"] = backtest_view.attachment_refs(blocks)
        except Exception as e:  # presentation-only failure must not fail a successful backtest
            # Fixed string, never str(e): a pydantic ValidationError repr can embed the offending
            # input — i.e. the whole payload this feature exists to keep out of the inline block.
            log.warning("Backtest attachment construction failed (result unaffected): %s", e)
            blocks = []
            summary["attachments"] = []
            summary["attachments_error"] = "attachment could not be built; see server logs"
        return [TextContent(type="text", text=json.dumps(summary, indent=2)), *blocks]

    @server.tool()
    async def screen_symbols(
        symbols: list[str],
        criteria: list[dict] | None = None,
        signal_sources: list[str] | None = None,
        signal_weight: float = 0.0,
        technical_weight: float = 1.0,
        min_conviction: float = 0.0,
        rank_limit: int = 0,
    ) -> dict:
        """Scan a universe of symbols via xstockstrat-analysis and return ranked candidates.
        symbols: explicit ticker list to screen e.g. ['NVDA', 'AAPL'] (no watchlist resolution).
        criteria: list of criterion dicts, each with keys: ref_name, kind
            ('SCREEN_KIND_FUNDAMENTAL' | 'SCREEN_KIND_SIGNAL' | 'SCREEN_KIND_TECHNICAL_FORMULA' |
            'SCREEN_KIND_TECHNICAL_INDICATOR'), metric_name, op (e.g. 'COMPARATOR_GTE'),
            threshold, threshold_high, weight, hard_filter.
            For technical kinds supply a `component` dict (same shape as a strategy component:
            ref_name / kind ('builtin'|'formula') / indicator / formula_id / params) — it is now
            mapped and sent, so technical criteria are scored (feature 090). An unknown fundamental
            metric_name (a typo, or an open metric no scanned symbol carries) is REJECTED with
            INVALID_ARGUMENT rather than silently skipped.
        signal_sources/signal_weight/technical_weight: optional signal-blend params.
        min_conviction: honored as a hard floor (feature 090) — candidates whose relative
            conviction score is below the entry threshold for this min_conviction are dropped from
            results (coverage_gaps are unaffected).
        rank_limit: cap on returned results (0 = analysis default). Read-only, no admin scope.
        Returns {"results": [{"symbol", "score", "criterion_scores" (per-ref_name map), "passed"
            (bool), "status"}], "coverage_gaps": [{"symbol", "timeframe", "bars_have",
            "bars_need"}]}. coverage_gaps now carries the full gap detail (bars_have/bars_need as
            JSON strings — int64) and is computed BEFORE rank truncation, so an under-covered
            symbol ranked below the cut still surfaces (bars gaps only — see next line for
            fundamentals). A result is "SCREEN_RESULT_STATUS_INSUFFICIENT_DATA" (passed=false, no
            score, its ref_name absent from criterion_scores) whenever a requested criterion
            couldn't be evaluated for lack of data — too few bars, or the fundamentals source
            (FMP) unavailable while a fundamental criterion was requested; it is never reported
            OK/passed just because a criterion had no data. Filter candidates on `passed`."""
        return await client.screen_symbols(
            symbols=symbols,
            criteria=criteria,
            signal_sources=signal_sources,
            signal_weight=signal_weight,
            technical_weight=technical_weight,
            min_conviction=min_conviction,
            rank_limit=rank_limit,
        )

    @server.tool()
    async def manage_strategy(
        ctx: Context,
        operation: str,
        strategy_id: str,
        display_name: str | None = None,
        components: list[dict] | None = None,
        entry_rule: str | None = None,
        exit_rule: str | None = None,
        signal_params: dict | None = None,
        cooldown_days: int | None = None,
        exit_cooldown_days: int | None = None,
        clear_fields: list[str] | None = None,
    ) -> dict:
        """Register/update/deactivate/reactivate a stored strategy in xstockstrat-analysis.
        operation: 'register' | 'update' | 'deactivate' | 'reactivate'.
        strategy_id: lowercase/underscore identifier (e.g. 'sma_crossover').
        display_name: human-readable name.
        components: list of {ref_name, kind ('builtin'|'formula'), indicator, formula_id, params}.
            kind='builtin': indicator must be one of the built-in enum ATR, BB, EMA, MACD, RSI,
            SMA, STOCH, VWAP (case-insensitive). For an indicator outside this set (e.g. a
            z-score or efficiency-ratio calculation), register a custom formula first via
            manage_formula and reference it here as kind='formula', formula_id=<id>.

        entry_rule / exit_rule: JSON-encoded condition trees (a JSON string, not a raw object).
            Two node shapes, nestable to arbitrary depth:
              - Combinator node: {"op": "AND"|"OR", "conditions": [<node>, ...]}. There is no NOT.
              - Leaf/comparison node: {"fn": <op>, "lhs": <operand>, "rhs": <operand>}, where
                <op> is one of '>', '<', '>=', '<=', 'crosses_above', 'crosses_below'
                (no '==' or '!=').
            An <operand> is either a JSON number (a literal threshold, rhs only) or a string
            referencing a component: a bare ref_name (must match a components[].ref_name)
            resolves to that component's primary "value" series; the dotted form
            "<ref_name>.<series>" addresses a secondary output series of a multi-output
            component (e.g. 'bb.upper'/'bb.lower' for Bollinger Bands, 'macd.signal'/
            'macd.histogram', 'stoch.d'). Every ref referenced in a rule must resolve to a
            components[] entry or the strategy is rejected (INVALID_ARGUMENT) at write time.

            Worked example — entry when a z-score component 'z' is below -1.0 AND an
            efficiency-ratio component 'er' is below 0.25 (both registered as kind='formula'
            components, since neither is a built-in indicator):
                {
                  "op": "AND",
                  "conditions": [
                    {"fn": "<", "lhs": "z", "rhs": -1.0},
                    {"fn": "<", "lhs": "er", "rhs": 0.25}
                  ]
                }
            (pass this dict JSON-encoded, e.g. json.dumps(...), as the entry_rule string.)
        signal_params: optional signal-weighting params.
        cooldown_days: optional per-symbol re-entry cooldown in calendar days — omit → platform
            default (31); 0 → no cooldown; negative → rejected (INVALID_ARGUMENT).
        exit_cooldown_days: optional per-symbol minimum holding period in calendar days before
            exit_rule may fire a sell — omit → platform default (0, no minimum hold); 0 → no
            minimum hold (immediate exit permitted); negative → rejected (INVALID_ARGUMENT).
        clear_fields: optional list of field names to ERASE, e.g. ['exit_rule']. Use this to
            blank a rule or to revert cooldown_days to the platform default — passing a field
            with no value cannot express "erase" on its own.

        UPDATE IS A PARTIAL MERGE (feature 070). On operation='update' only the fields you
        actually pass are changed; everything else is preserved server-side. So updating one
        parameter is safe:
            manage_strategy(operation='update', strategy_id='x', cooldown_days=45)
        leaves components, entry_rule, exit_rule and display_name untouched. Previously this
        wiped them. Call get_strategy first if you want to see the current definition.

        Note: changing any scoring-relevant field (components, rules, cooldown_days,
        exit_cooldown_days, signal_params) changes the strategy's definition fingerprint, so its
        derived grade is cleared until a fresh backtest supplies new evidence. A rename does not.

        LIFECYCLE (feature 089): 'deactivate' is reversible via 'reactivate' (sets active=true and
        re-validates the stored definition — a reactivate can fail INVALID_ARGUMENT if a referenced
        formula went missing). Re-registering an existing strategy_id (active or deactivated)
        returns ALREADY_EXISTS and DROPS the submitted definition — it does not overwrite; use
        'update' to revise, or 'reactivate' to bring back a deactivated strategy.

        RESPONSE CASING: this tool returns the definition with camelCase keys (e.g. `refName`,
        `entryRule`), UNLIKE get_strategy, which returns snake_case. To round-trip an edit, fetch
        with get_strategy (snake_case matches this tool's INPUT), not from this response."""
        # feature 070: send ONLY what the caller supplied. The previous version defaulted these
        # to ""/[] and shipped them unconditionally, so `manage_strategy(operation="update",
        # strategy_id=..., cooldown_days=45)` transmitted explicit-empty components and rules and
        # a blanked display_name — which is what wiped stored strategies. Generalizes the
        # `is not None` treatment `cooldown_days` already had to every optional field.
        definition: dict = {"strategy_id": strategy_id}
        supplied = {
            "display_name": display_name,
            "components": components,
            "entry_rule": entry_rule,
            "exit_rule": exit_rule,
            "signal_params": signal_params,
            "cooldown_days": cooldown_days,
            "exit_cooldown_days": exit_cooldown_days,
        }
        mask = [name for name, value in supplied.items() if value is not None]
        for name in mask:
            definition[name] = supplied[name]

        # `clear_fields` names paths to erase. They join the mask but carry no value, which the
        # server reads as an explicit clear (AIP-161). This is the only way to blank a rule or
        # revert cooldown_days to the platform default.
        for name in clear_fields or []:
            if name not in mask:
                mask.append(name)

        update_mask = None
        if operation == "update":
            if not mask:
                raise ValueError(
                    "manage_strategy(operation='update') needs at least one field to change. "
                    "Pass the fields you want to update, or use clear_fields=[...] to erase one. "
                    "Sending nothing would be a no-op; sending everything empty would wipe the "
                    "strategy."
                )
            update_mask = mask

        # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7); the
        # analysis ManageStrategy backend enforces the ADMIN bit, so a non-admin is rejected there.
        access_scope = _caller_access_scope(ctx, "manage_strategy")
        try:
            return await client.manage_strategy(
                operation=operation,
                definition=definition,
                update_mask=update_mask,
                access_scope=access_scope,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    @server.tool()
    async def manage_formula(
        ctx: Context,
        operation: str,
        name: str | None = None,
        description: str | None = None,
        source: str | None = None,
        is_public: bool | None = None,
        formula_id: str = "",
        parameters: list[dict] | None = None,
        outputs: list[dict] | None = None,
        warmup_period: int | None = None,
    ) -> dict:
        """Register/update/delete a custom formula in xstockstrat-indicators.
        operation: 'register' | 'update' | 'delete'.
        name/description/source/is_public: for register and update. On UPDATE these are
            presence-detected — pass a field only if you want to change it (see UPDATE below).
        formula_id: required for update/delete.
        Ownership is always derived from the OAuth-authenticated caller's own verified identity —
            there is no author/formula_author_user_id parameter. On register, the caller becomes
            the formula's author. On update/delete, the caller's own identity is checked against
            the formula's stored author (PERMISSION_DENIED on mismatch) — you cannot assert
            someone else's ownership.
        parameters: typed parameter definitions — a list of
            {name, type, default, description, required, min, max} where type is one of
            'int'|'float'|'bool'|'string' and min/max apply to numeric params only. Values
            are read inside the formula via params["<name>"].
        outputs: declared secondary output series — a list of {name, description}. Declaring an
            output makes it addressable in strategy rules as "<ref>.<name>"; the implicit "value"
            series is always available and must NOT be declared here. A formula can therefore be
            genuinely multi-series (no more one-formula-per-series workaround).
        warmup_period: bars of warm-up before this formula's outputs are valid (int ≥ 0).

        UPDATE IS A PARTIAL MERGE (AIP-161): only the fields you actually pass are changed; every
            field you omit is preserved. Passing is_public=false unpublishes; omitting is_public
            leaves it as-is. `source` cannot be blanked. Use get_formula/list_formulas to read a
            formula back before editing. (At least one field must be supplied to update.)
        DELETE IS A SOFT DELETE: the formula is marked deleted (non-destructive), hidden from
            list_formulas, and can no longer be updated, but strategies that already reference it
            keep evaluating on its last-saved definition — and both their backtests
            (BacktestResult.warnings) and live status (get_strategy → warnings) flag the deletion
            to the user. You cannot bind a NEW strategy to a deleted formula.
        Returns per operation: register → {"formula_id": <str>}; update → the full stored formula
            in camelCase (incl. `deleted`); delete → {"success": <bool>}.

        source: plain Python, executed in a subprocess sandbox (no filesystem/network access).
            Two dicts are already in scope — data (series input, e.g. data["close"], a list of
            floats) and params (validated typed scalars, e.g. params["period"]) — and the
            formula must assign its output to a `result` dict with a "value" key (the primary
            series) plus one key per declared `outputs` entry.
            Only imports in the `indicators.sandbox.allowed_imports` config key are permitted
            (default: numpy, pandas, math, statistics). Within those, at least these functions
            are available for building custom indicators:
              - mean(), std(), diff(), shift() — pandas Series/DataFrame methods, e.g.
                pd.Series(data["close"]).rolling(20).mean() / .std() / .diff() / .shift(1)
                (or the numpy equivalents, e.g. np.mean(), np.std()).
              - sum(), abs() — plain Python builtins, no import needed.
            Example z-score formula body:
                import pandas as pd
                s = pd.Series(data["close"])
                mean = s.rolling(params["period"]).mean()
                std = s.rolling(params["period"]).std()
                result = {"value": ((s - mean) / std).tolist()}"""
        user_id = _caller_user_id(ctx, "manage_formula")
        formula: dict = {
            "formula_id": formula_id,
            "user_id": user_id,
            "author": user_id,
            "name": name or "",
            "description": description or "",
            "source": source or "",
            "is_public": bool(is_public),
            "parameters": parameters or [],
            "outputs": outputs or [],
            "warmup_period": warmup_period or 0,
        }
        if operation == "update":
            # Derive the AIP-161 update_mask from the fields actually supplied (non-None), so an
            # omitted field is preserved rather than wiped. Never fall back to a maskless full
            # replace from the tool.
            supplied = {
                "name": name,
                "description": description,
                "source": source,
                "is_public": is_public,
                "parameters": parameters,
                "outputs": outputs,
                "warmup_period": warmup_period,
            }
            mask = [field for field, val in supplied.items() if val is not None]
            if not mask:
                raise RuntimeError("update requires at least one field to change")
            formula["update_mask"] = mask
        try:
            return await client.manage_formula(operation=operation, formula=formula)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="formula not found")) from e

    @server.tool()
    async def get_formula(formula_id: str) -> dict:
        """Fetch one custom formula's stored definition from xstockstrat-indicators.
        formula_id: required.
        Returns the formula in camelCase incl. name, description, source, isPublic, parameters,
            outputs, warmupPeriod, and `deleted` (true when soft-deleted). Use this for safe
            read-modify-write: read the formula, change the fields you want, then call
            manage_formula(operation='update', ...) with only those fields."""
        try:
            return await client.get_formula(formula_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="formula not found")) from e

    @server.tool()
    async def list_formulas(author_filter: str = "", include_public: bool = True) -> dict:
        """List custom formula definitions from xstockstrat-indicators.
        author_filter: if non-empty, restrict to formulas authored by this user id.
        include_public: also include public formulas regardless of author_filter (default true).
        Soft-deleted formulas are excluded. Returns {"formulas": [<formula in camelCase>, ...]}."""
        try:
            return {"formulas": await client.list_formulas(author_filter, include_public)}
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def manage_signal_source(
        ctx: Context,
        operation: str,
        slug: str,
        display_name: str | None = None,
        source_type: str | None = None,
        config_json: dict | None = None,
        extractor_module: str | None = None,
        credentials_ref: str | None = None,
    ) -> dict:
        """Register/update/reactivate/deactivate a signal source in xstockstrat-ingest.
        operation: 'register' | 'update' | 'reactivate' | 'deactivate'. These are HONEST,
            distinct verbs (feature 088):
            - register: strict create — an existing slug returns ALREADY_EXISTS (no overwrite).
              Provide slug/display_name/source_type/extractor_module (+config_json/credentials_ref).
            - update: PARTIAL MERGE — pass only the fields to change; every omitted field is
              PRESERVED. An unknown slug returns NOT_FOUND. (At least one field must be supplied.)
            - reactivate: set active=true; decoupled from update (update never changes active).
            - deactivate: set active=false.
        slug: always required (the source key).
        credentials_ref: reference forwarded to the backend; NEVER echoed back (FR-12). On update it
            is preserved when omitted; pass "" to explicitly clear it. A `authenticated_website` or
            `mediated_authenticated_website` source requires a credential (validated on the merged
            result).
        Returns {"slug", "display_name", "source_type", "extractor_module", "active",
            "has_credentials"} — credentials_ref is never included."""
        source: dict = {"slug": slug}
        if display_name is not None:
            source["display_name"] = display_name
        if source_type is not None:
            source["source_type"] = source_type
        if extractor_module is not None:
            source["extractor_module"] = extractor_module
        if config_json is not None:
            source["config_json"] = config_json
        update_mask: list[str] | None = None
        if operation == "update":
            supplied = {
                "display_name": display_name,
                "source_type": source_type,
                "extractor_module": extractor_module,
                "config_json": config_json,
                "credentials_ref": credentials_ref,
            }
            update_mask = [field for field, val in supplied.items() if val is not None]
            if not update_mask:
                raise RuntimeError("update requires at least one field to change")
        access_scope = _caller_access_scope(ctx, "manage_signal_source")  # feature 092
        try:
            return await client.manage_signal_source(
                operation=operation,
                source=source,
                credentials_ref=credentials_ref,
                update_mask=update_mask,
                access_scope=access_scope,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="signal source not found")) from e

    @server.tool()
    async def set_strategy_live(
        ctx: Context,
        strategy_id: str,
        live_enabled: bool,
    ) -> dict:
        """Enable or disable live alert evaluation for a strategy.
        strategy_id: ID of the strategy to toggle (from manage_strategy / get_strategy).
        live_enabled: true to enable continuous live evaluation + alerting; false to disable.
        Enabling is REJECTED (FAILED_PRECONDITION, feature 089) on a configuration that could never
            fire: an inactive strategy, or one whose signal_params has no `symbols`. So a successful
            enable now guarantees the strategy satisfies the live loop's firing contract
            (live_enabled AND active, with symbols). Disabling is ALWAYS allowed, even on an inert
            config, so you can always turn live off.
        Returns a 4-field subset, NOT the full definition:
            {"strategy_id", "display_name", "live_enabled", "active"}."""
        access_scope = _caller_access_scope(ctx, "set_strategy_live")  # feature 092
        try:
            return await client.set_strategy_live(
                strategy_id=strategy_id,
                live_enabled=live_enabled,
                access_scope=access_scope,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    @server.tool()
    async def trigger_backfill(
        ctx: Context,
        symbols: list[str],
        timeframe: str = "1d",
        start: str | None = None,
        end: str | None = None,
        overwrite: bool = False,
        fill_mode: str | None = None,
    ) -> dict:
        """Trigger a historical OHLCV backfill in xstockstrat-ingest (admin-scoped write).
        symbols: explicit ticker list, e.g. ["AAPL", "MSFT"]; max 50 per call.
        timeframe: one of 15m/15Min/1h/1Hour/1d/1Day (canonicalized; default '1d').
        start / end: optional ISO 8601 datetimes bounding the range; one-sided allowed; both
            omitted = the service default, a 365-day lookback ending now (range_end − 365d).
        overwrite: true re-fetches bars that already exist.
        fill_mode: 'full' | 'gaps_only'; omitted = server default FULL. 'gaps_only'
            fetches only missing ranges (cheaper on provider quota).
        Client-side guards raise ValueError BEFORE anything is queued: empty symbols, > 50
            symbols, an unknown timeframe or fill_mode, or start after end.
        Returns {"job_id", "status"}. Ingest performs NO synchronous input validation —
        it queues unconditionally and bad input surfaces as a terminal FAILED/PARTIAL
        job; poll get_backfill_status with the returned job_id to observe the outcome."""
        access_scope = _caller_access_scope(ctx, "trigger_backfill")  # feature 092
        try:
            return await client.trigger_backfill(
                symbols=symbols,
                timeframe=timeframe,
                start=start,
                end=end,
                overwrite=overwrite,
                fill_mode=fill_mode,
                access_scope=access_scope,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def get_backfill_status(
        job_id: str = "",
        status_filter: str | None = None,
        symbol: str = "",
        limit: int = 0,
        page_token: str = "",
    ) -> dict:
        """Check one backfill job or list recent jobs (read-only — no admin scope).
        job_id: when set, returns {"job": {...}} with the BackfillJob fields (status,
            bars_processed, bars_total, chunks_completed, chunks_total, failed_symbols,
            error). When empty, lists recent jobs instead.
        status_filter: list mode only — queued/running/completed/failed/partial/canceled;
            omit or 'unspecified' = all statuses.
        symbol: list mode only — optional ticker filter.
        limit: list mode page size; 0 = server default (100).
        page_token: pass the previous response's next_page_token to fetch the next page.
        List mode returns {"jobs": [...], "next_page_token": "..."}.
        Note: bars_processed and bars_total are 64-bit integers serialized as JSON STRINGS, not
            numbers — parse before arithmetic."""
        try:
            return await client.get_backfill_status(
                job_id=job_id,
                status_filter=status_filter,
                symbol=symbol,
                limit=limit,
                page_token=page_token,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="backfill job not found")) from e

    @server.tool()
    async def cancel_backfill(ctx: Context, job_id: str) -> dict:
        """Cancel a queued or running OHLCV backfill job in xstockstrat-ingest (admin-scoped).
        job_id: the job to cancel (from trigger_backfill or get_backfill_status).
        Use this to stop a paid backfill you started that is no longer wanted. A job that has
            already completed/failed cannot be canceled.
        Returns {"job": {...}} with the updated BackfillJob (status should be canceled)."""
        access_scope = _caller_access_scope(ctx, "cancel_backfill")  # feature 092
        try:
            return await client.cancel_backfill(job_id, access_scope=access_scope)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="backfill job not found")) from e

    @server.tool()
    async def test_formula(
        source: str,
        input_data: dict | None = None,
        input_params: dict | None = None,
        parameters: list[dict] | None = None,
        timeout_ms: int = 0,
    ) -> dict:
        """Dry-run inline formula source in the sandbox WITHOUT registering it (read-only).
        Use this to validate a formula's behavior before manage_formula(operation='register').
        source: plain Python; assign the result to a `result` dict with a 'value' key. `data`
            (series input, e.g. data['close']) and `params` (typed scalars) are in scope.
        input_data: JSON object passed to the formula as `data` (e.g. {'close': [1,2,3]}).
        input_params: parameter VALUES exposed as `params` (e.g. {'period': 14}).
        parameters: optional typed parameter DEFINITIONS to validate input_params for this run.
        timeout_ms: 0 = use the configured sandbox timeout.
        Returns the full sandbox result: success, output (the result dict; NON-FINITE values such
            as NaN/Infinity are returned as null), stdout, stderr, error, exit_reason,
            parameter_errors, execution_ms (int64 as a JSON string)."""
        try:
            return await client.execute_formula(
                formula_source=source,
                input_data=input_data,
                input_params=input_params,
                parameters=parameters,
                timeout_ms_override=timeout_ms,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def list_strategies(include_inactive: bool = False) -> dict:
        """List stored strategy definitions from xstockstrat-analysis (read-only).
        include_inactive: also include deactivated strategies (default false).
        Returns {"strategies": [<definition>, ...]} — each definition is snake_case, matching
            get_strategy (so a list → get → manage_strategy edit loop stays consistent)."""
        try:
            return {"strategies": await client.list_strategy_definitions(include_inactive)}
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def get_strategy(strategy_id: str) -> dict:
        """Fetch a stored strategy's full definition from xstockstrat-analysis (read-only).
        strategy_id: the strategy identifier, e.g. 'range_mean_reversion_v3'.
        Returns the complete stored definition — display_name, every component with its
        formula_id and params, entry_rule/exit_rule, signal_params, cooldown_days,
        exit_cooldown_days, and the active/live_enabled flags.
        Use this before editing a strategy to see what is actually stored, and after editing to
        verify the change landed. Keys are snake_case, matching manage_strategy's input, so a
        fetch → edit → resend round-trip works directly."""
        try:
            return await client.get_strategy(strategy_id=strategy_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    # ── xstockstrat-config tools (feature 073) ───────────────────────────────────────────────
    #
    # Scope resolution lives in app/scopes.py `resolve_scope` (feature 093 lifted it there so
    # oauth_server.py, outside this closure, shares one normalizer). This thin wrapper keeps the
    # three tool call sites below unchanged.

    def _resolve_scope(environment: str, trading_mode: str) -> tuple[str, str]:
        return resolve_scope(environment, trading_mode)

    @server.tool()
    async def get_config(namespace: str, environment: str = "", trading_mode: str = "") -> dict:
        """Read the current config values for a namespace from xstockstrat-config (read-only).
        namespace: config namespace, e.g. 'marketdata', 'analysis', 'trading', 'platform'.
        environment: 'dev' or 'production'. Omit to use this agent deployment's own environment.
        trading_mode: 'paper', 'live' or 'all'. Omit to use this agent's own trading mode.
        Returns {namespace, version, environment, trading_mode, values} where each value is
        {value, value_type, is_secret}.
        Any key flagged is_secret has its value replaced with '[redacted]' — secret values are
        never returned by this tool. Note trading-mode scoping applies only to keys stored with a
        specific mode; keys stored as 'all' are returned for every mode.
        Note: an unknown or empty namespace is NOT an error — it returns an empty `values` map, so
        an empty result does not confirm the namespace name. `version` is an opaque monotonic
        counter, not a timestamp."""
        env, mode = _resolve_scope(environment, trading_mode)
        try:
            result = await client.get_config(
                namespace=namespace, environment=env, trading_mode=mode
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="namespace not found")) from e
        # Redact on the is_secret flag, not on the key name: a flagged key need not be prefixed.
        for entry in result.get("values", {}).values():
            if entry.get("is_secret"):
                entry["value"] = "[redacted]"
        return result

    @server.tool()
    async def list_config_keys(
        namespace: str, environment: str = "", trading_mode: str = ""
    ) -> dict:
        """List the config keys registered for a namespace, with metadata only (read-only).
        namespace: config namespace, e.g. 'marketdata', 'analysis', 'trading', 'platform'.
        environment: 'dev' or 'production'. Omit to use this agent deployment's own environment.
        trading_mode: 'paper', 'live' or 'all'. Omit to use this agent's own trading mode.
        Returns {namespace, environment, trading_mode, keys[]} where each key carries key,
        description, default_value, is_secret and consuming_service.
        No values are returned by this RPC at all, so nothing here can leak a secret. Use it to
        discover what exists and which keys are secret before calling set_config.
        Note: an unknown or empty namespace is NOT an error — it returns an empty `keys` list, so
        an empty result does not confirm the namespace name."""
        env, mode = _resolve_scope(environment, trading_mode)
        try:
            return await client.list_config_keys(
                namespace=namespace, environment=env, trading_mode=mode
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="namespace not found")) from e

    @server.tool()
    async def set_config(
        ctx: Context,
        namespace: str,
        key: str,
        value_type: Literal["string", "int", "float", "bool"],
        value: str,
        author: str,
        reason: str,
        environment: str = "",
        trading_mode: str = "",
        create_key: bool = False,
    ) -> dict:
        """Write one non-secret config value in xstockstrat-config (admin-scoped write).
        namespace: config namespace, e.g. 'marketdata'.
        key: the config key, e.g. 'marketdata.fmp.enabled'. A write to a not-yet-registered key
          at this exact (namespace, environment, trading_mode) scope is REFUSED with NOT_FOUND
          ("config key not registered") unless you pass create_key=true — so a typo can no longer
          silently mint an orphan key. Call list_config_keys first and copy the key verbatim.
        value_type: one of string, int, float, bool. Pass JSON-valued config as a 'string' —
          that is byte-identical to what the server stores. NOTE value_type is only honored when
          CREATING a new key; for an existing key the stored type wins and this is ignored.
        value: the new value, as a string; it is converted according to value_type.
        author: who is making the change — required, and recorded in config.config_audit.
        reason: why — required, and recorded alongside author.
        environment: 'dev' or 'production'. Omit to use this agent deployment's own environment.
        trading_mode: 'paper', 'live' or 'all'. Omit to use this agent's own trading mode.
        create_key: set true ONLY to deliberately register a brand-new key at this scope; leave
          false (the default) for every normal update so a mistyped key is rejected rather than
          created. Key creation is audited (config.config_audit) just like an update.
        Returns {version, updated_at}. Never echoes the value back.

        Authorization uses YOUR role, not a service-wide admin override: the write is rejected
        with 'admin scope required' unless your session has the admin role. Secret keys cannot be
        written here at all — credentials are delivered as type: SECRET environment variables.
        Requires the Streamable HTTP transport, the only remote transport the agent serves since
        feature 079 removed the legacy SSE one."""
        # Prong (b) first: a name check is the ONLY thing that can stop a brand-new secret key.
        # SetConfigRequest carries no is_secret field and the column defaults FALSE, so without
        # this a caller could create an unflagged row holding a plaintext credential.
        if key.startswith("secret."):
            raise RuntimeError(
                f"refusing to write '{key}': secret keys are not settable through MCP. "
                "Credentials are delivered as type: SECRET environment variables "
                "(see docs/patterns/config-governance.md)."
            )

        # feature 092: shared with the other management tools; still fails fast (before the
        # ListKeys network call) when no verified claims are present.
        access_scope = _caller_access_scope(ctx, "set_config")

        env, mode = _resolve_scope(environment, trading_mode)

        # Prong (a): the is_secret flag, looked up at the SAME scope as the pending write.
        # Fails CLOSED -- if the lookup errors we refuse, otherwise the guard is decorative.
        try:
            listing = await client.list_config_keys(
                namespace=namespace, environment=env, trading_mode=mode
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(
                f"cannot verify whether '{key}' is a secret key, refusing the write: "
                f"{_grpc_error_message(e)}"
            ) from e
        for meta in listing.get("keys", []):
            if meta.get("key") == key and meta.get("is_secret"):
                raise RuntimeError(
                    f"refusing to write '{key}': it is flagged is_secret. Credentials are "
                    "delivered as type: SECRET environment variables."
                )

        try:
            return await client.set_config(
                namespace=namespace,
                key=key,
                value_type=value_type,
                value=value,
                environment=env,
                trading_mode=mode,
                author=author,
                reason=reason,
                access_scope=access_scope,
                create_key=create_key,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="config key not found")) from e


async def _get_source(source_slug: str) -> dict:
    """Fetch a single signal source by slug from the ingest registry.
    Raises ValueError if slug is not found or source is inactive."""
    sources = await client.list_signal_sources(include_inactive=False)
    for src in sources:
        if src["slug"] == source_slug:
            return src
    raise ValueError(f"Unknown or inactive source slug: '{source_slug}'")


def _extract_from_bytes(data: bytes, password: str | None = None) -> str:
    """Extract text from bytes. Attempts PDF parsing first; falls back to UTF-8 decode."""
    try:
        import fitz  # PyMuPDF  # noqa: PLC0415

        doc = fitz.open(stream=data, filetype="pdf")
        if doc.is_encrypted and password:
            if not doc.authenticate(password):
                raise ValueError("Failed to decrypt PDF: incorrect password")
        elif doc.is_encrypted:
            raise ValueError("PDF is password-protected but no credentials are configured")
        return "\n".join(page.get_text() for page in doc)
    except Exception as pdf_err:
        log.debug("PDF parsing failed (%s), falling back to UTF-8 decode", pdf_err)
        try:
            return data.decode("utf-8", errors="replace")
        except Exception as e:
            raise ValueError(f"Cannot extract text from attachment: {e}") from e


async def _fetch_url(
    url: str, password: str | None = None, headers: dict[str, str] | None = None
) -> str:
    """Fetch URL content. For authenticated sources, passes password as Bearer token.
    headers: optional extra request headers; Authorization from password wins.
    Returns raw text."""
    import httpx  # noqa: PLC0415

    headers = {str(k): str(v) for k, v in (headers or {}).items()}
    if password:
        headers["Authorization"] = f"Bearer {password}"

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        return r.text
