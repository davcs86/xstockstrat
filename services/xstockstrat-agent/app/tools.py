"""
MCP tool definitions for xstockstrat-agent.

Fourteen tools:
  list_signal_sources  — lists active sources from ingest, enriched with extractor_tool
  extract_email_content — extracts raw text from email attachments or gated URLs
  extract_website_content — fetches and returns raw text from a registered website source
  ingest_signal        — ingests a trading signal via gRPC IngestSignal
  emit_alert           — emits an alert via gRPC EmitAlert
  run_backtest         — triggers a backtest via gRPC RunBacktest
  screen_symbols       — scans a symbol universe via gRPC ScreenSymbols (read-only)
  manage_strategy     — registers/updates/deactivates stored strategies (update = partial merge)
  get_strategy        — reads a stored strategy's full definition (read-only)
  manage_formula      — registers/updates/deletes custom formulas in indicators
  manage_signal_source — registers/updates/deactivates signal sources in ingest
  set_strategy_live   — enables/disables live alert evaluation for a strategy
  trigger_backfill    — triggers an OHLCV history backfill via gRPC TriggerBackfill (admin-scoped)
  get_backfill_status — checks a backfill job / lists recent jobs (read-only)
"""

import base64
import logging

import grpc
from mcp.server import FastMCP

from app import client

_ALERT_THRESHOLD_DEFAULT = 0.6
_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"

log = logging.getLogger(__name__)


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


def register_tools(server: FastMCP) -> None:

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
        Returns {raw_text: str}. Credentials are never exposed in the response."""
        if not attachments_b64 and not urls:
            raise ValueError("At least one of attachments_b64 or urls must be provided")

        src = await _get_source(source_slug)

        password: str | None = None
        if src.get("has_credentials"):
            # Credentials are stored in config under the conventional key source.<slug>.credentials
            password = await client.get_config_value(f"source.{source_slug}.credentials")

        texts: list[str] = []

        if attachments_b64:
            for b64_data in attachments_b64:
                raw = base64.b64decode(b64_data)
                text = _extract_from_bytes(raw, password=password)
                texts.append(text)

        if urls:
            for url in urls:
                text = await _fetch_url(url, password=password)
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
        Returns {raw_text: str}. Credentials are never exposed in the response."""
        src = await _get_source(source_slug)

        config_json = src.get("config_json") or {}
        url = config_json.get("url")
        if not url:
            raise ValueError(f"Source '{source_slug}' has no url in config_json")

        password: str | None = None
        if src.get("has_credentials"):
            # Credentials are stored in config under the conventional key source.<slug>.credentials
            password = await client.get_config_value(f"source.{source_slug}.credentials")

        # Optional per-source request headers (e.g. SEC EDGAR rejects requests
        # without a declared User-Agent identifying the caller).
        request_headers = config_json.get("request_headers")
        if not isinstance(request_headers, dict):
            request_headers = None

        text = await _fetch_url(url, password=password, headers=request_headers)
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
        conviction: float 0.0-1.0 (optional, ingest applies source default if absent).
        Returns signal_id on success; raises on unknown source slug (INVALID_ARGUMENT)."""
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
        threshold_str = await client.get_config_value(_ALERT_THRESHOLD_CONFIG_KEY)
        try:
            alert_threshold = (
                float(threshold_str) if threshold_str is not None else _ALERT_THRESHOLD_DEFAULT
            )
        except (ValueError, TypeError):
            alert_threshold = _ALERT_THRESHOLD_DEFAULT
        if conviction is not None and conviction >= alert_threshold:
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
        severity: str,
        category: str,
        title: str,
        body: str,
        source_service: str = "xstockstrat-agent",
        target_user_id: str = "",
    ) -> dict:
        """Emit an alert via xstockstrat-notify.
        severity: e.g. 'info', 'warning', 'critical'.
        category: alert category e.g. 'signal', 'system'.
        Use for system-level alerts or alerts not tied to a specific ingested signal."""
        return await client.emit_alert(
            severity=severity,
            category=category,
            title=title,
            body=body,
            source_service=source_service,
            target_user_id=target_user_id,
        )

    @server.tool()
    async def run_backtest(
        strategy_id: str,
        symbols: list[str],
        initial_capital: float = 100000.0,
    ) -> dict:
        """Trigger a backtest via xstockstrat-analysis.
        strategy_id: identifies the strategy (e.g. 'sma_crossover'). Must be a REGISTERED strategy
          definition — the run executes that definition and earns evidence toward its derived
          headline grade (feature 065). An unregistered id returns NOT_FOUND (the legacy ad-hoc
          SMA-crossback path is no longer reachable from the agent).
        symbols: list of ticker symbols e.g. ['NVDA', 'AAPL'].
        initial_capital: starting capital in USD (default 100000).
        Returns the full backtest result including per-symbol `diagnostics`: a day-by-day list of
        bars (OHLCV, computed indicator values, warm-up flag, entry/exit/conviction decision) and a
        `no_trade_reason` per symbol — use these to explain why a strategy produced 0 trades and to
        suggest changes to the strategy or its indicators."""
        return await client.run_backtest(
            strategy_id=strategy_id,
            symbols=symbols,
            initial_capital=initial_capital,
        )

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
            (e.g. 'SCREEN_KIND_FUNDAMENTAL'|'SCREEN_KIND_TECHNICAL_FORMULA'|'SCREEN_KIND_SIGNAL'),
            metric_name, op (e.g. 'COMPARATOR_GTE'), threshold, threshold_high, weight, hard_filter.
        signal_sources/signal_weight/technical_weight/min_conviction: optional signal-blend params.
        rank_limit: cap on returned results (0 = analysis default). Read-only, no admin scope."""
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
        operation: str,
        strategy_id: str,
        display_name: str | None = None,
        components: list[dict] | None = None,
        entry_rule: str | None = None,
        exit_rule: str | None = None,
        signal_params: dict | None = None,
        cooldown_days: int | None = None,
        clear_fields: list[str] | None = None,
    ) -> dict:
        """Register/update/deactivate a stored strategy in xstockstrat-analysis.
        operation: 'register' | 'update' | 'deactivate'.
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
        signal_params) changes the strategy's definition fingerprint, so its derived grade is
        cleared until a fresh backtest supplies new evidence. A rename does not."""
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

        try:
            return await client.manage_strategy(
                operation=operation, definition=definition, update_mask=update_mask
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    @server.tool()
    async def manage_formula(
        operation: str,
        name: str = "",
        description: str = "",
        source: str = "",
        is_public: bool = False,
        formula_id: str = "",
        author: str = "",
        formula_author_user_id: str = "",
        parameters: list[dict] | None = None,
    ) -> dict:
        """Register/update/delete a custom formula in xstockstrat-indicators.
        operation: 'register' | 'update' | 'delete'.
        name/description/source/is_public: for register and update.
        author: stored immutably on register.
        formula_id: required for update/delete.
        formula_author_user_id: required for update/delete; must match the formula's original
            author (the indicators backend returns PERMISSION_DENIED otherwise).
        parameters: typed parameter definitions for register/update — a list of
            {name, type, default, description, required, min, max} where type is one of
            'int'|'float'|'bool'|'string' and min/max apply to numeric params only. Values
            are read inside the formula via params["<name>"].

        source: plain Python, executed in a subprocess sandbox (no filesystem/network access).
            Two dicts are already in scope — data (series input, e.g. data["close"], a list of
            floats) and params (validated typed scalars, e.g. params["period"]) — and the
            formula must assign its output to a `result` dict with at least a "value" key (the
            primary series); any other keys are declared output series (see the `outputs` field
            on the underlying RegisterFormula RPC, e.g. for a z-score or efficiency-ratio
            indicator that emits more than one series).
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
        formula: dict = {
            "formula_id": formula_id,
            "user_id": formula_author_user_id,
            "name": name,
            "description": description,
            "source": source,
            "is_public": is_public,
            "author": author,
            "parameters": parameters or [],
        }
        try:
            return await client.manage_formula(operation=operation, formula=formula)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="formula not found")) from e

    @server.tool()
    async def manage_signal_source(
        operation: str,
        slug: str,
        display_name: str = "",
        source_type: str = "",
        config_json: dict | None = None,
        extractor_module: str = "",
        credentials_ref: str | None = None,
    ) -> dict:
        """Register/update/deactivate a signal source in xstockstrat-ingest.
        operation: 'register' | 'update' | 'deactivate'.
        slug/display_name/source_type/extractor_module/config_json: SignalSource fields.
        credentials_ref: optional reference forwarded to the ingest backend. It is NEVER
            echoed back in the response and never exposed to the caller (FR-12)."""
        source: dict = {
            "slug": slug,
            "display_name": display_name,
            "source_type": source_type,
            "extractor_module": extractor_module,
            "config_json": config_json or {},
        }
        try:
            return await client.manage_signal_source(
                operation=operation,
                source=source,
                credentials_ref=credentials_ref,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="signal source not found")) from e

    @server.tool()
    async def set_strategy_live(
        strategy_id: str,
        live_enabled: bool,
    ) -> dict:
        """Enable or disable live alert evaluation for a strategy.
        strategy_id: ID of the strategy to toggle (from list_strategy_definitions/manage_strategy).
        live_enabled: true to enable continuous live evaluation + alerting; false to disable.
        Returns the updated strategy definition with live_enabled reflected."""
        try:
            return await client.set_strategy_live(
                strategy_id=strategy_id, live_enabled=live_enabled
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e

    @server.tool()
    async def trigger_backfill(
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
        start / end: optional ISO 8601 datetimes bounding the range; one-sided allowed;
            both omitted = the service's default range.
        overwrite: true re-fetches bars that already exist.
        fill_mode: 'full' | 'gaps_only'; omitted = server default FULL. 'gaps_only'
            fetches only missing ranges (cheaper on provider quota).
        Returns {"job_id", "status"}. Ingest performs NO synchronous input validation —
        it queues unconditionally and bad input surfaces as a terminal FAILED/PARTIAL
        job; poll get_backfill_status with the returned job_id to observe the outcome."""
        try:
            return await client.trigger_backfill(
                symbols=symbols,
                timeframe=timeframe,
                start=start,
                end=end,
                overwrite=overwrite,
                fill_mode=fill_mode,
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
        List mode returns {"jobs": [...], "next_page_token": "..."}."""
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
    async def get_strategy(strategy_id: str) -> dict:
        """Fetch a stored strategy's full definition from xstockstrat-analysis (read-only).
        strategy_id: the strategy identifier, e.g. 'range_mean_reversion_v3'.
        Returns the complete stored definition — display_name, every component with its
        formula_id and params, entry_rule/exit_rule, signal_params, cooldown_days, and the
        active/live_enabled flags.
        Use this before editing a strategy to see what is actually stored, and after editing to
        verify the change landed. Keys are snake_case, matching manage_strategy's input, so a
        fetch → edit → resend round-trip works directly."""
        try:
            return await client.get_strategy(strategy_id=strategy_id)
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e


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
