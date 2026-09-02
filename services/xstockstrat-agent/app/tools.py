"""
MCP tool definitions for xstockstrat-agent.

Forty-two tools:
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
  run_fundamentals_scan — manually triggers the fundamentals signal producer (admin-scoped)
  trigger_backfill    — triggers an OHLCV history backfill via gRPC TriggerBackfill (admin-scoped)
  get_backfill_status — checks a backfill job / lists recent jobs (read-only)
  cancel_backfill     — cancels a queued/running backfill job (admin-scoped)
  test_formula        — dry-runs inline formula source in the sandbox, registers nothing (read-only)
  list_strategies     — lists stored strategy definitions (read-only)
  list_opportunities  — lists the caller's ranked Decide-queue with live enrichment (read-only)
  get_config          — reads a namespace's current config values, secrets redacted (read-only)
  list_config_keys    — lists a namespace's registered config keys, metadata only (read-only)
  set_config          — writes one config value incl. secrets (encrypted at rest; admin-scoped)
  get_user_metadata   — fetches the calling user's own profile metadata (read-only)
  set_user_metadata   — partial-updates the calling user's own profile metadata
  list_watchlists     — lists the caller's own watchlists from portfolio, paginated (read-only)
  get_watchlist       — reads one of the caller's watchlists incl. its stocks (read-only)
  manage_watchlist    — create/update(read-modify-write merge)/delete a caller-owned watchlist
  manage_watchlist_symbols — add/remove stocks on a caller-owned watchlist (add = MANUAL source)
  manage_offline_account — offline-account create/record/confirm + read orders/positions
  manage_account       — register/update_credentials/deregister a broker account (ownership-gated)
  list_accounts        — lists the caller's broker + offline accounts together (read-only)
  db_list_schemas     — list database schemas via postgres-mcp (admin-only)
  db_list_objects     — list objects in a schema via postgres-mcp (admin-only)
  db_get_object_details — get DDL/stats for a named DB object via postgres-mcp (admin-only)
  db_execute_sql      — execute SQL via postgres-mcp with FR-11 destructive-op gate (admin-only)
  db_explain_query    — explain a query's execution plan via postgres-mcp (admin-only)
  db_get_top_queries  — get top queries by total_time from pg_stat_statements (admin-only)
  db_analyze_workload_indexes — recommend indexes based on pg_stat_statements workload (admin-only)
  db_analyze_query_indexes — recommend indexes for a specific SQL query (admin-only)
  db_analyze_db_health — run comprehensive DB health checks via postgres-mcp (admin-only)
"""

import base64
import json
import logging
import re
import uuid
from typing import Literal

import grpc
import sqlglot
import sqlglot.errors
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import TextContent

from app import backtest_view, client, postgres_mcp_client
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


def _new_trace_id() -> str:
    """A fresh request trace id, minted at the agent edge when the caller carried none."""
    return uuid.uuid4().hex


def _claims_from_scope_state(request) -> dict | None:
    """The verified caller claims app/main.py's `_authorized` stamped on the ASGI request scope.

    Reads the same `scope["state"][MCP_CLAIMS_SCOPE_KEY]` that `_claims_from_context` reads, but
    from the raw transport request the middleware receives (``ServerRequestContext.request``) rather
    than a tool's `Context`. Returns None when absent (stdio has no request; an unauthenticated
    message never set it)."""
    scope = getattr(request, "scope", None) or {}
    claims = (scope.get("state") or {}).get(MCP_CLAIMS_SCOPE_KEY)
    return claims if isinstance(claims, dict) else None


class CallerPropagationMiddleware:
    """Forward ALL propagation headers on every backend gRPC a tool triggers (PR #994).

    The agent is a platform **edge**, so it forwards the full trio — ``x-user-id`` +
    ``x-access-scope`` + ``x-trace-id`` — on every outbound backend call (reversing the old AGENT-4
    "the agent originates, forwards nothing" stance). This one `ServerMiddleware` binds the caller's
    identity onto `client`'s per-request context for the duration of each `tools/call`, so every
    `client.*` helper the tool awaits picks it up via `client._metadata()` — no per-tool plumbing.

    Every header is sourced from the OAuth-verified claims (`app/main.py` `_authorized` stamped them
    on the request scope) — never a caller-supplied parameter, so the feature-111 anti-spoofing
    guarantees still hold — and a fresh ``x-trace-id`` is minted here when the claims carry none, so
    a trace spans the agent edge. The middleware runs in the handler's own task (the binding
    propagates via `contextvars`) and always resets in a `finally`, so nothing leaks across requests
    or onto a stdio call that carries no verified claims."""

    async def __call__(self, ctx, call_next):
        token = None
        if getattr(ctx, "method", None) == "tools/call":
            claims = _claims_from_scope_state(getattr(ctx, "request", None))
            if claims is not None:
                token = client.set_caller(
                    claims.get("user_id") or "",
                    roles_to_access_scope(claims.get("roles")),
                    claims.get("trace_id") or _new_trace_id(),
                )
        try:
            return await call_next(ctx)
        finally:
            if token is not None:
                client.reset_caller(token)


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


# ---------------------------------------------------------------------------
# FR-11 approval gate — fail-closed three-tier SQL destructiveness check.
# _DESTRUCTIVE_KEYS values verified via sqlglot v25.34.1 (context.md, Step 8):
#   UPDATE → 'update', DELETE → 'delete', DROP → 'drop', TRUNCATE TABLE → 'truncatetable'
# ---------------------------------------------------------------------------
_DESTRUCTIVE_KEYS = frozenset({"update", "delete", "drop", "truncatetable"})

_COMMENT_RE = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
_DESTRUCTIVE_RE = re.compile(r"\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b", re.IGNORECASE)


def _is_destructive(sql: str) -> bool:
    """Return True if sql contains a destructive statement (UPDATE, DELETE, DROP, TRUNCATE).

    Three-tier fail-closed (design.md §FR-11):
    1. sqlglot AST parse: match .key values against _DESTRUCTIVE_KEYS
    2. Command-node safe-default: unrecognized SQL (VACUUM, REINDEX, etc.) → True
    3. Regex fallback on sqlglot.ParseError (strips comments first)
    """
    try:
        exprs = sqlglot.parse(sql)
        if any(e.key in _DESTRUCTIVE_KEYS for e in exprs if e is not None):
            return True
        if any(e.key == "command" for e in exprs if e is not None):
            log.warning("sqlglot Command node in FR-11 gate; safe-defaulting destructive=True")
            return True
        return False
    except MemoryError:
        raise
    except sqlglot.errors.ParseError:
        log.warning("sqlglot ParseError in FR-11 gate; falling to regex fallback")
        return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))
    except Exception as exc:
        log.warning(
            "sqlglot unexpected error in FR-11 gate (%s); falling to regex fallback",
            type(exc).__name__,
        )
        return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))


def register_tools(server: MCPServer) -> None:
    # Edge header propagation (PR #994): one middleware binds the caller's verified identity for the
    # duration of each tools/call so every backend gRPC forwards x-user-id + x-access-scope +
    # x-trace-id — no per-tool plumbing. Registered before the tools so it wraps all of them.
    server.middleware.append(CallerPropagationMiddleware())

    @server.tool()
    async def list_signal_sources(
        source_type: list[str] | None = None,
    ) -> dict:
        """List active signal sources from xstockstrat-ingest.
        Returns slug, display_name, source_type, config_json, extractor_tool, and
        reliability_weight per source.
        extractor_tool: 'extract_email_content' | 'extract_website_content' | null.
        Claude must follow extractor_tool exactly — do not infer routing from source_type.
        reliability_weight: per-source ranking multiplier in [0, 1] (default 1.0); higher weights
            rank this source's signals higher, 0 effectively ignores the source (feature 134).
        source_type: optional filter list
            (e.g. ['mediated_simple_email', 'mediated_email_attachment'])."""
        sources = await client.list_signal_sources(include_inactive=False)
        # Enrich each source with extractor_tool derived from source_type.
        # feature 166 — the boolean has_credentials IS surfaced (product-spec-committed,
        # @AC-1/@AC-2);
        # the token / credentials_ref remain intentionally excluded — never exposed to Claude.
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
                    # feature 166 — whether a bearer/credential is configured (boolean only).
                    "has_credentials": src["has_credentials"],
                    # feature 161 — surface the per-source reliability weight (was dropped here).
                    "reliability_weight": src["reliability_weight"],
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
        ctx: Context,
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
        SIDE EFFECT: when direction='watchlist' and the signal is not deduplicated, the symbol is
            added to your system-managed signals watchlist in xstockstrat-portfolio (best-effort; a
            failure is logged and never fails the ingest).
        Returns {"signal_id": <int>, "deduplicated": <bool>} on success — deduplicated=true means
            this submission matched an existing signal within the dedup window and no new row was
            inserted (both the auto-alert and the watchlist auto-add above are suppressed in that
            case); raises on unknown source slug (INVALID_ARGUMENT)."""
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
        env = _resolve_scope("")
        try:
            threshold_str = await client.get_config_value(
                _ALERT_THRESHOLD_CONFIG_KEY, namespace="agent", environment=env
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
        # Auto-add to the caller's system-managed signals watchlist (feature 127) — post-commit,
        # best-effort, structurally identical to the auto-alert above. Gated on
        # direction='watchlist' and a non-deduplicated ingest (FR-4/FR-6). _caller_user_id raising
        # on the unauthenticated stdio transport is caught here → add skipped, signal ingested.
        if direction == "watchlist" and not result.get("deduplicated"):
            try:
                user_id = _caller_user_id(ctx, "ingest_signal")
                wl_id = await client.ensure_signal_watchlist(user_id)
                await client.add_watchlist_symbol(user_id, wl_id, symbol)
            except Exception as e:
                log.warning(
                    "Watchlist auto-add failed after ingest_signal (signal already ingested): %s", e
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
        ctx: Context,
        strategy_id: str,
        symbols: list[str],
        initial_capital: float = 100000.0,
        start: str | None = None,
        end: str | None = None,
        sizing_mode: str | None = None,
        fill_model: str | None = None,
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
        numbers — parse them before arithmetic.
        sizing_mode: capital-allocation model (feature 150). 'portfolio' runs a real shared-capital
          portfolio — concurrent positions out of one pool, one order-independent equity curve, so
          the aggregate metrics are directly comparable and need no manual per-symbol aggregation
          (the summary shows the mode + a `capital_skips` count for entries the pool couldn't open).
          Omitted/'legacy' (default) keeps the legacy serial per-symbol compounding, whose
          multi-symbol aggregate is an ordering-dependent sequential parlay — the footgun.
        fill_model: fill timing (feature 151). 'next_bar_open' fills a bar-i signal at bar (i+1)'s
          open — the standard bias-free convention. Omitted/'same_bar_close'/'legacy' (default)
          fills at the signal bar's own close, an optimistically-biased fill. The effective model is
          echoed in the summary. Note (display-only): in next-bar mode a diagnostics row can show an
          ENTER/EXIT on a bar whose conviction reads hold — the action lands on the fill bar while
          conviction stays that bar's own value; the grade is unaffected."""
        # feature 133: forward the caller's own user id so analysis resolves ownership from the
        # header — a non-owner strategy_id_ref is rejected PERMISSION_DENIED there. Wrap the RPC so
        # that denial surfaces as a tool-level error, not an unwrapped AioRpcError (AC-6).
        user_id = _caller_user_id(ctx, "run_backtest")
        try:
            result = await client.run_backtest(
                user_id=user_id,
                strategy_id=strategy_id,
                symbols=symbols,
                initial_capital=initial_capital,
                start=start,
                end=end,
                sizing_mode=sizing_mode,
                fill_model=fill_model,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e
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
        entry_rule: str | dict | None = None,
        exit_rule: str | dict | None = None,
        signal_params: dict | None = None,
        cooldown_days: int | None = None,
        exit_cooldown_days: int | None = None,
        denied_symbols: list[str] | None = None,
        signal_eligible: bool | None = None,
        clear_fields: list[str] | None = None,
    ) -> dict:
        """Register/update/deactivate/reactivate a stored strategy in xstockstrat-analysis.
        operation: 'register' | 'update' | 'deactivate' | 'reactivate'.
        strategy_id: lowercase/underscore identifier (e.g. 'sma_crossover').
        display_name: human-readable name.
        components: list of {ref_name, kind ('builtin'|'formula'), indicator, formula_id, params,
            source_symbol}.
            kind='builtin': indicator must be one of the built-in enum ATR, BB, EMA, MACD, RSI,
            SMA, STOCH, VWAP (case-insensitive). For an indicator outside this set (e.g. a
            z-score or efficiency-ratio calculation), register a custom formula first via
            manage_formula and reference it here as kind='formula', formula_id=<id>.
            source_symbol (optional, feature 152): a fixed benchmark/reference ticker (e.g.
            'VOO'). When set, the component is computed on THAT symbol's bars and its output is
            aligned onto the evaluated symbol's bar timeline — enabling cross-symbol
            'market-regime' gates like "buy only when VOO's 200-day is rising" (mkt > 0 where
            mkt is an SMA-slope on source_symbol='VOO'). Omitted/empty = computed on the
            evaluated symbol (unchanged). Normalized (uppercase/trim) server-side; a bar the
            benchmark lacks evaluates that leaf to hold/false (no forward-fill, no look-ahead).

        entry_rule / exit_rule: condition trees, accepted as EITHER a JSON string OR a JSON
            object (dict). A dict is serialized to the canonical JSON string (json.dumps) before
            forwarding, so both forms store the same value; a string is forwarded unchanged.
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
            (pass this as the entry_rule directly as the dict, or as its json.dumps(...) string —
            both are accepted.)
        signal_params: optional signal-weighting params.
        cooldown_days: optional per-symbol re-entry cooldown in calendar days — omit → platform
            default (31); 0 → no cooldown; negative → rejected (INVALID_ARGUMENT).
        exit_cooldown_days: optional per-symbol minimum holding period in calendar days before
            exit_rule may fire a sell — omit → platform default (0, no minimum hold); 0 → no
            minimum hold (immediate exit permitted); negative → rejected (INVALID_ARGUMENT).
        denied_symbols: optional list of normalized-uppercase symbols this strategy must never
            evaluate FOR ENTRY (feature 132 — entry-only deny). A held position on a denied symbol
            keeps exit tracing, so an operator can always exit what they already hold; deny only
            suppresses new entries. Omit to leave unchanged; pass [] (or clear_fields) to clear.
        signal_eligible: optional bool gating whether the platform-wide active-signal term joins
            this strategy's evaluation universe (feature 132; default false). Setting it true while
            signal_params.symbols is a non-empty allowlist is rejected INVALID_ARGUMENT (the
            allowlist is already an explicit universe override).
        clear_fields: optional list of field names to ERASE, e.g. ['exit_rule']. Use this to
            blank a rule or to revert cooldown_days to the platform default — passing a field
            with no value cannot express "erase" on its own. If a field is BOTH supplied a value
            and named in clear_fields, the value wins and the clear is silently dropped — to erase,
            name it in clear_fields ALONE. (A supplied empty-object rule {} / "{}" is not a clear;
            the server rejects a contentless rule INVALID_ARGUMENT.)

        UPDATE IS A PARTIAL MERGE (feature 070). On operation='update' only the fields you
        actually pass are changed; everything else is preserved server-side. So updating one
        parameter is safe:
            manage_strategy(operation='update', strategy_id='x', cooldown_days=45)
        leaves components, entry_rule, exit_rule and display_name untouched. Previously this
        wiped them. Call get_strategy first if you want to see the current definition.

        Note: changing any scoring-relevant field (components, rules, cooldown_days,
        exit_cooldown_days, signal_params) changes the strategy's definition fingerprint, so its
        derived grade is cleared until a fresh backtest supplies new evidence. A rename does not.
        A dict rule is serialized with json.dumps default separators, so it is NOT byte-identical
        to the same rule hand-written as a differently-spaced JSON string; since the fingerprint is
        content-sensitive, encode a given rule the same way each time to avoid needlessly clearing
        its grade.

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
        #
        # feature 149: a rule may arrive as a JSON object (dict) from an MCP client whose transport
        # pre-parses JSON arguments, or as a pre-encoded JSON string. Serialize a dict to the same
        # JSON string a string-passing caller would send. Bare json.dumps (NO sort_keys) so the
        # string path stays byte-for-byte; a str is never re-encoded. This runs BEFORE the mask
        # below, so an omitted None still drops out and an empty dict {} → "{}" (non-None) enters
        # the mask (the server then rejects a contentless rule, INVALID_ARGUMENT).
        if isinstance(entry_rule, dict):
            entry_rule = json.dumps(entry_rule)
        if isinstance(exit_rule, dict):
            exit_rule = json.dumps(exit_rule)
        definition: dict = {"strategy_id": strategy_id}
        supplied = {
            "display_name": display_name,
            "components": components,
            "entry_rule": entry_rule,
            "exit_rule": exit_rule,
            "signal_params": signal_params,
            "cooldown_days": cooldown_days,
            "exit_cooldown_days": exit_cooldown_days,
            "denied_symbols": denied_symbols,
            "signal_eligible": signal_eligible,
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

        # feature 092: forward the caller's REAL derived scope (was a hardcoded admin 7). NOTE
        # (feature 133): ManageStrategy is no longer admin-gated — it is ownership-gated. Analysis
        # resolves the owner from the propagated x-user-id header and returns PERMISSION_DENIED for
        # a non-owner; any authenticated caller acts on their OWN strategies regardless of admin.
        # The scope is still forwarded (harmless defence-in-depth), but it is no longer the gate.
        access_scope = _caller_access_scope(ctx, "manage_strategy")
        # feature 133: forward the caller's own user id so analysis resolves ownership from the
        # header (never the request body) — a non-owner is rejected PERMISSION_DENIED there.
        user_id = _caller_user_id(ctx, "manage_strategy")
        try:
            return await client.manage_strategy(
                user_id=user_id,
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
        reliability_weight: float | None = None,
        bearer_token: str | None = None,
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
        reliability_weight: per-source ranking multiplier in [0, 1] (default 1.0 on register);
            higher weights rank this source's signals higher, 0 effectively ignores the source
            (feature 134). On update it is applied ONLY when supplied — omit it to preserve the
            stored weight (an omitted value must never reset it to 0).
        bearer_token: the MCP bearer token for a `mcp_client` source (feature 166). Supplied on
            register of a `mcp_client` source; it is written FIRST to an encrypted config secret
            (`ingest.mcp_credential.<slug>`, is_secret=true) and then the source is registered with
            `credentials_ref` pointing at it. It is stored encrypted at rest and NEVER returned.
        `mcp_client` source_type (feature 166): a server-side MCP query source. Its `config_json`
            carries `mcp_endpoint` (the Streamable-HTTP MCP URL) and `mcp_tool` (the tool name),
            plus optional `mcp_arguments`. bearer_token is mandatory (register is rejected without
            it).
        Returns {"slug", "display_name", "source_type", "extractor_module", "active",
            "has_credentials", "reliability_weight"} — credentials_ref and bearer_token are never
            included."""
        source: dict = {"slug": slug}
        if display_name is not None:
            source["display_name"] = display_name
        if source_type is not None:
            source["source_type"] = source_type
        if extractor_module is not None:
            source["extractor_module"] = extractor_module
        if config_json is not None:
            source["config_json"] = config_json
        if reliability_weight is not None:
            source["reliability_weight"] = reliability_weight
        update_mask: list[str] | None = None
        if operation == "update":
            supplied = {
                "display_name": display_name,
                "source_type": source_type,
                "extractor_module": extractor_module,
                "config_json": config_json,
                "credentials_ref": credentials_ref,
                # feature 161: include reliability_weight in the mask ONLY when the caller
                # supplied it, so a field-only update never resets the stored weight to 0.0.
                "reliability_weight": reliability_weight,
            }
            update_mask = [field for field, val in supplied.items() if val is not None]
            if not update_mask:
                raise RuntimeError("update requires at least one field to change")
        access_scope = _caller_access_scope(ctx, "manage_signal_source")  # feature 092
        # feature 166 — mcp_client bearer orchestration (secret-first). When registering an
        # mcp_client source with a bearer token, write the token to an encrypted config secret
        # FIRST, then register the source pointing at it via credentials_ref. The token is never
        # placed in config_json and never echoed back (FR-12). A failed register after a successful
        # secret write leaves only a harmless redacted orphan secret (no compensating cleanup).
        if operation == "register" and source_type == "mcp_client" and bearer_token:
            secret_key = f"mcp_credential.{slug}"
            await client.set_config(
                namespace="ingest",
                key=secret_key,
                value_type="string",
                value=bearer_token,
                environment=_resolve_scope(""),
                author="manage_signal_source",
                reason=f"bearer for mcp_client source {slug}",
                access_scope=access_scope,
                create_key=True,
                is_secret=True,
            )
            credentials_ref = f"ingest.{secret_key}"
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
        # feature 133: forward the caller's own user id so analysis resolves ownership from the
        # header — a non-owner is rejected PERMISSION_DENIED there.
        user_id = _caller_user_id(ctx, "set_strategy_live")
        try:
            return await client.set_strategy_live(
                user_id=user_id,
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
        timeframe: '1d' or '1Day' (canonicalized; default '1d'). Only daily bars are supported.
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
    async def run_fundamentals_scan(
        ctx: Context,
        force: bool = False,
        dry_run: bool = False,
        symbols: list[str] | None = None,
    ) -> dict:
        """Manually trigger the fundamentals signal producer scan (admin-scoped write, feature 156).
        force: re-emit today's signals even if already emitted (clears the day's idempotency rows).
        dry_run: score + report what WOULD be scanned without emitting or spending cache calls.
        symbols: optional explicit universe override; omitted = the configured universe.
        Returns the FundamentalsScanSummary: {"run_id", "symbols_processed", "signals_emitted",
            "calls_spent", "deferred_count", "status", "finished_at"}. Admin-scoped — a non-admin
            caller is rejected PERMISSION_DENIED by the analysis backend gate."""
        access_scope = _caller_access_scope(ctx, "run_fundamentals_scan")  # feature 156
        try:
            return await client.run_fundamentals_scan(
                force=force, dry_run=dry_run, symbols=symbols, access_scope=access_scope
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
    async def list_strategies(ctx: Context, include_inactive: bool = False) -> dict:
        """List stored strategy definitions from xstockstrat-analysis (read-only).
        include_inactive: also include deactivated strategies (default false).
        Returns {"strategies": [<definition>, ...]} — each definition is snake_case, matching
            get_strategy (so a list → get → manage_strategy edit loop stays consistent).
        Only the calling user's OWN strategies are returned."""
        # feature 133: forward the caller's own user id so analysis filters to the caller's
        # strategies (never another user's) from the header.
        user_id = _caller_user_id(ctx, "list_strategies")
        try:
            return {"strategies": await client.list_strategy_definitions(user_id, include_inactive)}
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def list_opportunities(ctx: Context, min_conviction: float = 0.0) -> dict:
        """List the caller's ranked Decide-queue opportunities with live-market enrichment
        (xstockstrat-analysis ListOpportunities, feature 095, read-only).
        min_conviction: drop rows below this conviction floor (muted deny-list rows are exempt).
        Returns {"opportunities": [<opportunity>, ...]} — each carries symbol, action, conviction,
            thesis, strategy_id, source, provenance, muted, and (when the backend has them) the live
            enrichment: live_price, change_pct, target_price, stop_price, a sparkline (recent daily
            closes; a gap is null), and the traced conditions. Unavailable live values are OMITTED,
            never fabricated. Only the calling user's OWN queue is returned."""
        # feature 095: caller-scoped via x-user-id (like list_watchlists/list_strategies); no admin
        # scope — analysis resolves the owner from the header, never a request-body id.
        user_id = _caller_user_id(ctx, "list_opportunities")
        try:
            return await client.list_opportunities(user_id, min_conviction)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def get_strategy(ctx: Context, strategy_id: str) -> dict:
        """Fetch a stored strategy's full definition from xstockstrat-analysis (read-only).
        strategy_id: the strategy identifier, e.g. 'range_mean_reversion_v3'.
        Returns the complete stored definition — display_name, every component with its
        formula_id and params, entry_rule/exit_rule, signal_params, cooldown_days,
        exit_cooldown_days, and the active/live_enabled flags.
        Use this before editing a strategy to see what is actually stored, and after editing to
        verify the change landed. Keys are snake_case, matching manage_strategy's input, so a
        fetch → edit → resend round-trip works directly.
        Fetching a strategy the caller does not own is rejected PERMISSION_DENIED."""
        # feature 133: forward the caller's own user id so analysis resolves ownership from the
        # header — a non-owner is rejected PERMISSION_DENIED there.
        user_id = _caller_user_id(ctx, "get_strategy")
        try:
            return await client.get_strategy(user_id=user_id, strategy_id=strategy_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    # ── xstockstrat-config tools (feature 073) ───────────────────────────────────────────────
    #
    # Scope resolution lives in app/scopes.py `resolve_scope` (feature 093 lifted it there so
    # oauth_server.py, outside this closure, shares one normalizer). This thin wrapper keeps the
    # three tool call sites below unchanged.

    def _resolve_scope(environment: str) -> str:
        return resolve_scope(environment)

    @server.tool()
    async def get_config(namespace: str, user_id: str = "") -> dict:
        """Read the current config values for a namespace from xstockstrat-config (read-only).
        namespace: config namespace, e.g. 'marketdata', 'analysis', 'trading', 'platform'.
        user_id: optional per-user scope. Omit (empty) for the global values; pass a user id to see
        that user's per-user overrides layered over the global values.
        The config environment is always this agent deployment's own environment
        (production/staging, from APPLICATION_ENV) — it is a deployment property, not a caller
        choice, so this tool cannot read another environment's rows.
        Returns {namespace, version, environment, user_id, values} where each value is
        {value, value_type, is_secret}.
        Any key flagged is_secret has its value replaced with '[redacted]' — secret values are
        never returned by this tool (they are encrypted at rest and served only to allow-listed
        internal services via a separate resolver).
        Note: an unknown or empty namespace is NOT an error — it returns an empty `values` map, so
        an empty result does not confirm the namespace name. `version` is an opaque monotonic
        counter, not a timestamp."""
        env = _resolve_scope("")
        try:
            result = await client.get_config(namespace=namespace, environment=env, user_id=user_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="namespace not found")) from e
        # Redact on the is_secret flag, not on the key name: a flagged key need not be prefixed.
        for entry in result.get("values", {}).values():
            if entry.get("is_secret"):
                entry["value"] = "[redacted]"
        return result

    @server.tool()
    async def list_config_keys(namespace: str, user_id: str = "") -> dict:
        """List the config keys registered for a namespace, with metadata only (read-only).
        namespace: config namespace, e.g. 'marketdata', 'analysis', 'trading', 'platform'.
        user_id: optional per-user scope. Omit (empty) for the global keys; pass a user id to see
        that user's per-user overrides layered over the global keys.
        The config environment is always this agent deployment's own environment
        (production/staging, from APPLICATION_ENV) — a deployment property, not a caller choice.
        Returns {namespace, environment, user_id, keys[]} where each key carries key,
        description, default_value, is_secret and consuming_service.
        No values are returned by this RPC at all, so nothing here can leak a secret. Use it to
        discover what exists and which keys are secret before calling set_config.
        Note: an unknown or empty namespace is NOT an error — it returns an empty `keys` list, so
        an empty result does not confirm the namespace name."""
        env = _resolve_scope("")
        try:
            return await client.list_config_keys(
                namespace=namespace, environment=env, user_id=user_id
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
        user_id: str = "",
        create_key: bool = False,
    ) -> dict:
        """Write one config value in xstockstrat-config (admin-scoped write).
        namespace: config namespace, e.g. 'marketdata'.
        key: the config key, e.g. 'marketdata.fmp.enabled'. A write to a not-yet-registered key
          at this exact (namespace, environment, user_id) scope is REFUSED with NOT_FOUND
          ("config key not registered") unless you pass create_key=true — so a typo can no longer
          silently mint an orphan key. Call list_config_keys first and copy the key verbatim.
        value_type: one of string, int, float, bool. Pass JSON-valued config as a 'string' —
          that is byte-identical to what the server stores. NOTE value_type is only honored when
          CREATING a new key; for an existing key the stored type wins and this is ignored.
        value: the new value, as a string; it is converted according to value_type.
        author: who is making the change — required, and recorded in config.config_audit.
        reason: why — required, and recorded alongside author.
        user_id: optional per-user scope. Omit (empty) to write the global value; pass a user id to
          set that user's per-user override. Secret keys are global-scope only — a per-user write to
          a secret key is rejected INVALID_ARGUMENT by the backend.
        create_key: set true ONLY to deliberately register a brand-new key at this scope; leave
          false (the default) for every normal update so a mistyped key is rejected rather than
          created. Key creation is audited (config.config_audit) just like an update.
        The config environment is always this agent deployment's own environment
        (production/staging, from APPLICATION_ENV) — a deployment property, not a caller choice.
        Returns {version, updated_at}. Never echoes the value back.

        Authorization uses YOUR role, not a service-wide admin override: a global write (and any
        secret write) is rejected 'admin scope required' unless your session has the admin role.
        Secret keys ARE writable through this tool — the value is encrypted at rest by the config
        service (AES-256-GCM, row-authoritative is_secret) and is never echoed back or broadcast;
        only the ciphertext is stored and only allow-listed internal services can decrypt it via
        GetSecret. Requires the Streamable HTTP transport, the only remote transport the agent
        serves since feature 079 removed the legacy SSE one."""
        # feature 092: shared with the other management tools; fails fast when no verified claims
        # are present. The backend admin gate is what actually authorizes the write.
        access_scope = _caller_access_scope(ctx, "set_config")

        env = _resolve_scope("")

        try:
            return await client.set_config(
                namespace=namespace,
                key=key,
                value_type=value_type,
                value=value,
                environment=env,
                author=author,
                reason=reason,
                access_scope=access_scope,
                create_key=create_key,
                user_id=user_id,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="config key not found")) from e

    @server.tool()
    async def get_user_metadata(ctx: Context) -> dict:
        """Fetch the calling user's own profile metadata from xstockstrat-identity.
        Returns userId, email (read-only), phone, displayName, metadata, metadataUpdatedAt."""
        user_id = _caller_user_id(ctx, "get_user_metadata")
        try:
            return await client.get_user_metadata(user_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="user not found")) from e

    @server.tool()
    async def set_user_metadata(
        ctx: Context,
        phone: str | None = None,
        display_name: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        """Update the calling user's own profile metadata. Partial update — only provided
        fields are changed. Email is read-only and cannot be set.
        phone: optional phone number.
        display_name: optional display name.
        metadata: optional JSON object (max 8KB)."""
        user_id = _caller_user_id(ctx, "set_user_metadata")
        if phone is None and display_name is None and metadata is None:
            raise RuntimeError(
                "at least one field (phone, display_name, metadata) must be provided"
            )
        try:
            return await client.update_user_metadata(
                user_id,
                phone=phone,
                display_name=display_name,
                metadata=metadata,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="user not found")) from e

    # ── xstockstrat-portfolio watchlist tools (feature 148) ──────────────────────────────────
    # Thin ownership-gated wrappers over the existing PortfolioService watchlist RPCs. Each forwards
    # ONLY the caller's own x-user-id (never an admin x-access-scope) — portfolio enforces ownership
    # from the header and returns PERMISSION_DENIED for a non-owner, matching get_strategy (feature
    # 133). No user_id is ever taken from a tool argument.

    @server.tool()
    async def list_watchlists(ctx: Context, limit: int = 0, page_token: str = "") -> dict:
        """List the calling user's OWN watchlists from xstockstrat-portfolio (read-only).
        limit: max lists to return; 0 = server default. Pagination is stable across pages.
        page_token: opaque token from a prior call's next_page_token; "" starts at the first page.
        Returns {"watchlists": [<watchlist>, ...], "next_page_token": <str>} where each watchlist is
            snake_case with watchlist_id, name, description, bindings (each with
            symbol/strategy_id/source), the deprecated flat symbols mirror, system_managed, and
            created_at/updated_at timestamps. An empty next_page_token means no more pages.
        Only the caller's own lists are ever returned."""
        user_id = _caller_user_id(ctx, "list_watchlists")
        try:
            return await client.list_watchlists(user_id, limit=limit, page_token=page_token)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    @server.tool()
    async def get_watchlist(ctx: Context, watchlist_id: str) -> dict:
        """Fetch one of the caller's watchlists, including its stocks, from xstockstrat-portfolio
        (read-only).
        watchlist_id: the list identifier (from list_watchlists).
        Returns {"watchlist": <watchlist>} — snake_case, with the full bindings array (each entry's
            symbol, strategy_id — "" means an unbound bare symbol — and source) plus the deprecated
            flat symbols mirror, system_managed, and timestamps.
        Fetching a list the caller does not own is rejected (permission denied); an unknown id is
            "watchlist not found"."""
        user_id = _caller_user_id(ctx, "get_watchlist")
        try:
            return await client.get_watchlist(user_id, watchlist_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="watchlist not found")) from e

    @server.tool()
    async def manage_watchlist(
        ctx: Context,
        operation: str,
        watchlist_id: str = "",
        name: str | None = None,
        description: str | None = None,
        symbols: list[str] | None = None,
        bindings: list[dict] | None = None,
    ) -> dict:
        """Create, update, or delete one of the caller's watchlists in xstockstrat-portfolio.
        operation: 'create' | 'update' | 'delete'.
        watchlist_id: required for update/delete; ignored for create.
        name: list name. Required for create. On update, omit to keep the current name.
        description: optional list description. On update, omit to keep the current description.
        symbols: optional list of bare ticker symbols (unbound), e.g. ["NVDA","AAPL"].
        bindings: optional list of {"symbol": <ticker>, "strategy_id": <id or "">} objects — a set
            strategy_id makes the symbol a ready-made strategy candidate; "" (or omitted) is an
            unbound bare symbol. symbols and bindings may be combined in one call.

        CREATE: makes a new list owned by the caller from name (+ optional description/symbols/
            bindings). New entries are recorded as MANUAL (user-curated).

        UPDATE IS A READ-MODIFY-WRITE MERGE. The backend UpdateWatchlist is replace-all and requires
            a name, so this tool fetches the current list first and preserves every field you do NOT
            pass: an omitted name/description keeps the stored value, and omitting BOTH symbols and
            bindings preserves the existing stocks exactly (so 'update' with only a new name renames
            the list WITHOUT clearing its stocks). Passing symbols and/or bindings REPLACES the
            whole stock set with those MANUAL entries. To add or remove individual stocks without
            replacing the set, use manage_watchlist_symbols instead. (The read-then-write is not
            atomic — a concurrent add between the two steps could be lost by the replace.)

        DELETE: removes the list. The one system-managed signals watchlist per user is
            delete-protected and its deletion is refused by the backend.

        Returns {"watchlist": <watchlist>} for create/update (snake_case, as get_watchlist);
            {"deleted": true, "watchlist_id": <id>} for delete.
        Acting on a list the caller does not own is rejected (permission denied)."""
        user_id = _caller_user_id(ctx, "manage_watchlist")
        try:
            if operation == "create":
                if not name:
                    raise ValueError("manage_watchlist(operation='create') requires a name")
                return await client.create_watchlist(
                    user_id,
                    name=name,
                    description=description or "",
                    symbols=symbols,
                    bindings=bindings,
                )
            if operation == "update":
                if not watchlist_id:
                    raise ValueError("manage_watchlist(operation='update') requires a watchlist_id")
                return await client.update_watchlist(
                    user_id,
                    watchlist_id,
                    name=name,
                    description=description,
                    symbols=symbols,
                    bindings=bindings,
                )
            if operation == "delete":
                if not watchlist_id:
                    raise ValueError("manage_watchlist(operation='delete') requires a watchlist_id")
                return await client.delete_watchlist(user_id, watchlist_id)
            raise ValueError(f"unknown operation '{operation}' (expected create/update/delete)")
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="watchlist not found")) from e

    @server.tool()
    async def manage_watchlist_symbols(
        ctx: Context,
        operation: str,
        watchlist_id: str,
        symbols: list[str] | None = None,
        bindings: list[dict] | None = None,
    ) -> dict:
        """Add or remove stocks on one of the caller's watchlists in xstockstrat-portfolio.
        operation: 'add' | 'remove'.
        watchlist_id: required — the list to mutate.
        symbols: bare ticker symbols. For 'add' these are unbound entries; for 'remove' these are
            the symbols to drop.
        bindings: (add only) list of {"symbol": <ticker>, "strategy_id": <id or "">} objects to add
            with a strategy binding. symbols and bindings may be combined in one add call.

        ADD unions the given symbols/bindings into the list (an already-present symbol keeps its
            stored binding — first-writer-wins) and records new entries as MANUAL (user-curated),
            distinct from the SIGNAL entries the ingest_signal watchlist path adds. The per-list
            symbol cap is enforced by the backend. REMOVE drops the given symbols; symbols not on
            the list are ignored.

        Returns {"watchlist": <watchlist>} — the updated list (snake_case, as get_watchlist).
        Acting on a list the caller does not own is rejected (permission denied)."""
        user_id = _caller_user_id(ctx, "manage_watchlist_symbols")
        if not watchlist_id:
            raise ValueError("manage_watchlist_symbols requires a watchlist_id")
        try:
            if operation == "add":
                return await client.add_watchlist_symbols(
                    user_id, watchlist_id, symbols=symbols, bindings=bindings
                )
            if operation == "remove":
                return await client.remove_watchlist_symbols(
                    user_id, watchlist_id, symbols=symbols or []
                )
            raise ValueError(f"unknown operation '{operation}' (expected add/remove)")
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="watchlist not found")) from e

    @server.tool()
    async def manage_offline_account(
        ctx: Context,
        operation: str,
        account_id: str = "",
        display_name: str = "",
        symbol: str = "",
        side: str = "",
        order_type: str = "market",
        qty: float = 0.0,
        order_id: str = "",
        client_order_id: str = "",
        filled_qty: float = 0.0,
        filled_avg_price: float = 0.0,
        filled_at: str = "",
        as_of: str = "",
        client_snapshot_id: str = "",
        positions_json: str = "",
    ) -> dict:
        """Manage a manually-tracked OFFLINE account and its orders (feature 157).

        An offline account has no broker: orders are recorded by hand and their fills confirmed via
        ConfirmOrder, which recomputes the account's positions and P&L. All operations act on the
        CALLER's own account (ownership from the verified identity); broker accounts are rejected.

        operation:
          'create_account'  — create a new offline account. Requires display_name. Returns
              {"account": …}.
          'record_order'    — record a NEW order (no broker submit). Requires account_id, symbol,
              side ('buy'|'sell'), qty; order_type defaults 'market'. client_order_id is an optional
              idempotency nonce (auto-generated when omitted). Returns {"order": …} (status NEW,
              filled_qty 0).
          'confirm_order'   — write a fill. Requires order_id, filled_qty, filled_avg_price;
              filled_at is an optional ISO-8601 time (defaults to now). Status is derived
              server-side (NEW/PARTIALLY_FILLED/FILLED). Returns {"order": …}. Re-confirming
              replaces the fill (idempotent recompute from all confirmed orders); brokers rejected.
          'snapshot_positions' — set the effective-dated opening baseline from a brokerage statement
              (feature 163). Requires account_id and positions_json (a JSON array
              [{"symbol","qty","avg_cost_per_share"}, …]). as_of is the statement date (ISO-8601,
              defaults to now); client_snapshot_id is an idempotency nonce (auto-generated when
              omitted). Returns {"account_id", "committed_count", "rejected": [...],
              "warnings": [...]}.
          'get_order'       — read one order. Requires order_id. Returns {"order": …}.
          'list_orders'     — list an account's orders (reconciliation). Requires account_id.
              Returns {"orders": [...]}.
          'list_positions'  — list an account's positions (reconciliation). Requires account_id.
              Returns {"positions": [...]}. Each position includes source (ORDERS/BASELINE/MIXED)
              and as_of (baseline effective date) provenance fields (feature 163).

        This is the platform capability behind the monthly statement-reconciliation task: correct
        drift by recording/confirming orders (no separate set-positions path)."""
        user_id = _caller_user_id(ctx, "manage_offline_account")
        try:
            if operation == "create_account":
                if not display_name:
                    raise ValueError("create_account requires a display_name")
                return await client.register_offline_account(user_id, display_name)
            if operation == "record_order":
                if not account_id or not symbol or not side or qty <= 0:
                    raise ValueError("record_order requires account_id, symbol, side, and qty > 0")
                nonce = client_order_id or f"agent-{uuid.uuid4()}"
                return await client.record_offline_order(
                    user_id, account_id, symbol, side, order_type, qty, nonce
                )
            if operation == "confirm_order":
                if not order_id:
                    raise ValueError("confirm_order requires an order_id")
                return await client.confirm_offline_order(
                    user_id, order_id, filled_qty, filled_avg_price, filled_at or None
                )
            if operation == "get_order":
                if not order_id:
                    raise ValueError("get_order requires an order_id")
                return await client.get_order(user_id, order_id)
            if operation == "list_orders":
                if not account_id:
                    raise ValueError("list_orders requires an account_id")
                return await client.list_account_orders(user_id, account_id)
            if operation == "list_positions":
                if not account_id:
                    raise ValueError("list_positions requires an account_id")
                return await client.list_account_positions(user_id, account_id)
            if operation == "snapshot_positions":
                if not account_id or not positions_json:
                    raise ValueError("snapshot_positions requires account_id and positions_json")
                nonce = client_snapshot_id or f"agent-{uuid.uuid4()}"
                return await client.snapshot_offline_positions(
                    user_id, account_id, as_of or None, nonce, positions_json
                )
            raise ValueError(
                f"unknown operation '{operation}' (expected create_account/record_order/"
                "confirm_order/snapshot_positions/get_order/list_orders/list_positions)"
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(
                _grpc_error_message(e, not_found="account or order not found")
            ) from e

    @server.tool()
    async def manage_account(
        ctx: Context,
        operation: str,
        account_id: str = "",
        display_name: str = "",
        broker_type: str = "",
        credentials_json: str = "",
    ) -> dict:
        """Manage the CALLER's own BROKER accounts (Alpaca / IBKR) — feature 164.

        All operations act on the caller's own accounts (ownership from the verified identity's
        x-user-id); a non-owner is rejected PERMISSION_DENIED by the trading backend. Broker
        credentials pass through to the backend (encrypted at rest) and are NEVER echoed back — the
        returned account carries no credential field.

        operation:
          'register'          — register a new broker account. Requires display_name, broker_type
              ('alpaca' or 'ibkr'), and credentials_json (broker-specific blob:
              Alpaca {"api_key":…,"api_secret":…}; IBKR {"consumer_key":…,"access_token":…,
              "access_token_secret":…,"ibkr_account_id":…}). Returns {"account": …} (with
              credential_status). Offline accounts are NOT created here — use
              manage_offline_account.
          'update_credentials' — rotate an account's credentials. Requires account_id and
              credentials_json. Returns {"account": …}. The backend rejects offline accounts
              (FAILED_PRECONDITION) and invalid JSON (INVALID_ARGUMENT).
          'deregister'        — deactivate an account. Requires account_id. Works for broker and
              offline accounts. Returns {"deregistered": true, "account_id": …}.

        For a read of all your accounts (broker + offline together), use list_accounts."""
        user_id = _caller_user_id(ctx, "manage_account")
        try:
            if operation == "register":
                if broker_type.strip().lower() == "offline":
                    raise ValueError(
                        "offline accounts are created with manage_offline_account "
                        "(operation 'create_account'), not manage_account"
                    )
                if not display_name or not broker_type or not credentials_json:
                    raise ValueError(
                        "register requires display_name, broker_type ('alpaca' or 'ibkr'), "
                        "and credentials_json"
                    )
                return await client.register_broker_account(
                    user_id, display_name, broker_type, credentials_json
                )
            if operation == "update_credentials":
                if not account_id or not credentials_json:
                    raise ValueError("update_credentials requires account_id and credentials_json")
                return await client.update_broker_account_credentials(
                    user_id, account_id, credentials_json
                )
            if operation == "deregister":
                if not account_id:
                    raise ValueError("deregister requires an account_id")
                return await client.deregister_broker_account(user_id, account_id)
            raise ValueError(
                f"unknown operation '{operation}' (expected register/update_credentials/deregister)"
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="broker account not found")) from e

    @server.tool()
    async def list_accounts(ctx: Context) -> dict:
        """List the CALLER's own accounts — broker AND offline together (read-only, feature 164).

        Offline accounts (feature 157) appear alongside broker accounts, each distinguishable by its
        broker_type (BROKER_TYPE_ALPACA / BROKER_TYPE_IBKR / BROKER_TYPE_OFFLINE). Ownership is
        resolved server-side from the verified x-user-id. Credentials are not part of an account and
        are never returned. Returns {"accounts": [...]}."""
        user_id = _caller_user_id(ctx, "list_accounts")
        try:
            return await client.list_broker_accounts(user_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e)) from e

    # -----------------------------------------------------------------------
    # db_* tools — postgres-mcp co-process, admin-scoped, feature 169
    # -----------------------------------------------------------------------

    @server.tool()
    async def db_list_schemas(ctx: Context) -> list[TextContent]:
        """List all schemas in the TimescaleDB database. Admin-only (bit 0x04).
        Returns a text summary of schemas available to the xstockstrat_agent role."""
        tool = "db_list_schemas"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("list_schemas", {})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_list_objects(ctx: Context, schema: str = "public") -> list[TextContent]:
        """List tables, views, and other objects within a schema. Admin-only (bit 0x04).
        schema: target schema name (default 'public')."""
        tool = "db_list_objects"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("list_objects", {"schema": schema})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_get_object_details(
        ctx: Context, schema: str = "public", name: str = ""
    ) -> list[TextContent]:
        """Get detailed DDL and statistics for a specific table or view. Admin-only (bit 0x04).
        schema: target schema (default 'public'); name: table/view name."""
        tool = "db_get_object_details"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool(
            "get_object_details", {"schema": schema, "name": name}
        )
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_execute_sql(
        ctx: Context, sql: str = "", confirm: bool = False
    ) -> list[TextContent]:
        """Execute SQL via the xstockstrat_agent DML role. Admin-only (bit 0x04).

        Destructive statements (UPDATE / DELETE / DROP / TRUNCATE) return a dry-run preview
        and are NOT forwarded unless confirm=True is passed (FR-11 approval gate).
        SELECT and INSERT execute immediately without confirmation.
        sql: the SQL statement to execute.
        confirm: set True to execute a destructive statement (default False — dry run)."""
        tool = "db_execute_sql"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")

        if _is_destructive(sql) and not confirm:
            return [
                TextContent(
                    type="text",
                    text=(
                        "DRY RUN — destructive SQL detected. "
                        "Re-call with confirm=True to execute:\n\n" + sql
                    ),
                )
            ]

        result = await postgres_mcp_client.call_tool("execute_sql", {"sql": sql})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_explain_query(ctx: Context, sql: str = "") -> list[TextContent]:
        """Return the EXPLAIN ANALYZE plan for a SQL query. Admin-only (bit 0x04).
        sql: the query to explain."""
        tool = "db_explain_query"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("explain_query", {"sql": sql})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_get_top_queries(ctx: Context, limit: int = 10) -> list[TextContent]:
        """Return the top slow queries from pg_stat_statements. Admin-only (bit 0x04).
        limit: number of queries to return (default 10)."""
        tool = "db_get_top_queries"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("get_top_queries", {"limit": limit})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_analyze_workload_indexes(ctx: Context) -> list[TextContent]:
        """Recommend indexes based on pg_stat_statements workload. Admin-only (bit 0x04)."""
        tool = "db_analyze_workload_indexes"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("analyze_workload_indexes", {})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_analyze_query_indexes(ctx: Context, sql: str = "") -> list[TextContent]:
        """Recommend indexes for a specific SQL query. Admin-only (bit 0x04).
        sql: the query to analyze."""
        tool = "db_analyze_query_indexes"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool("analyze_query_indexes", {"sql": sql})
        return [TextContent(type="text", text=str(result))]

    @server.tool()
    async def db_analyze_db_health(ctx: Context, health_type: str = "all") -> list[TextContent]:
        """Run a comprehensive database health analysis. Admin-only (bit 0x04).
        health_type: 'all' (default) | 'index' | 'connection' | 'vacuum' | 'sequence' |
            'replication' | 'buffer' | 'constraint'."""
        tool = "db_analyze_db_health"
        access_scope = _caller_access_scope(ctx, tool)
        if not (access_scope & 0x04):
            raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
        result = await postgres_mcp_client.call_tool(
            "analyze_db_health", {"health_type": health_type}
        )
        return [TextContent(type="text", text=str(result))]


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
