"""
MCP tool definitions for xstockstrat-agent.

Ten tools:
  list_signal_sources  — lists active sources from ingest, enriched with extractor_tool
  extract_email_content — extracts raw text from email attachments or gated URLs
  extract_website_content — fetches and returns raw text from a registered website source
  ingest_signal        — ingests a trading signal via gRPC IngestSignal
  emit_alert           — emits an alert via gRPC EmitAlert
  run_backtest         — triggers a backtest via gRPC RunBacktest
  manage_strategy     — registers/updates/deactivates stored strategies in analysis (admin-scoped)
  manage_formula      — registers/updates/deletes custom formulas in indicators (admin-scoped)
  manage_signal_source — registers/updates/deactivates signal sources in ingest (admin-scoped)
  set_strategy_live   — enables/disables live alert evaluation for a strategy (admin-scoped)
"""

import base64
import logging
from typing import Optional

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
        return "admin API key required"
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
        source_type: Optional[list[str]] = None,
    ) -> dict:
        """List active signal sources from xstockstrat-ingest.
        Returns slug, display_name, source_type, config_json, and extractor_tool per source.
        extractor_tool: 'extract_email_content' | 'extract_website_content' | null.
        Claude must follow extractor_tool exactly — do not infer routing from source_type.
        source_type: optional filter list (e.g. ['mediated_simple_email', 'mediated_email_attachment'])."""
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
        attachments_b64: Optional[list[str]] = None,
        urls: Optional[list[str]] = None,
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

        text = await _fetch_url(url, password=password)
        return {"raw_text": text}

    @server.tool()
    async def ingest_signal(
        source: str,
        symbol: str,
        direction: str,
        valid_from: str,
        conviction: Optional[float] = None,
        valid_until: Optional[str] = None,
        headline: Optional[str] = None,
        raw_url: Optional[str] = None,
        tags: Optional[list[str]] = None,
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
        strategy_id: identifies the strategy (e.g. 'sma_crossover').
        symbols: list of ticker symbols e.g. ['NVDA', 'AAPL'].
        initial_capital: starting capital in USD (default 100000)."""
        return await client.run_backtest(
            strategy_id=strategy_id,
            symbols=symbols,
            initial_capital=initial_capital,
        )

    @server.tool()
    async def manage_strategy(
        operation: str,
        strategy_id: str,
        display_name: str = "",
        components: list[dict] | None = None,
        entry_rule: str = "",
        exit_rule: str = "",
        signal_params: dict | None = None,
        admin_api_key: str = "",
    ) -> dict:
        """Register/update/deactivate a stored strategy in xstockstrat-analysis (admin-scoped).
        operation: 'register' | 'update' | 'deactivate'.
        strategy_id: lowercase/underscore identifier (e.g. 'sma_crossover').
        display_name: human-readable name.
        components: list of {ref_name, kind ('builtin'|'formula'), indicator, formula_id, params}.
        entry_rule / exit_rule: JSON-encoded condition trees.
        signal_params: optional signal-weighting params.
        admin_api_key: required; must carry the admin role (validated here at the agent entry)."""
        if not await client.validate_admin(admin_api_key):
            raise RuntimeError("admin API key required")
        definition: dict = {
            "strategy_id": strategy_id,
            "display_name": display_name,
            "components": components or [],
            "entry_rule": entry_rule,
            "exit_rule": exit_rule,
        }
        if signal_params:
            definition["signal_params"] = signal_params
        try:
            return await client.manage_strategy(
                operation=operation, definition=definition, api_key=admin_api_key
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
        admin_api_key: str = "",
    ) -> dict:
        """Register/update/delete a custom formula in xstockstrat-indicators (admin-scoped).
        operation: 'register' | 'update' | 'delete'.
        name/description/source/is_public: for register and update.
        author: stored immutably on register.
        formula_id: required for update/delete.
        formula_author_user_id: required for update/delete; must match the formula's original
            author (the indicators backend returns PERMISSION_DENIED otherwise).
        admin_api_key: required; validated by the indicators backend."""
        formula: dict = {
            "formula_id": formula_id,
            "user_id": formula_author_user_id,
            "name": name,
            "description": description,
            "source": source,
            "is_public": is_public,
            "author": author,
        }
        try:
            return await client.manage_formula(
                operation=operation, formula=formula, api_key=admin_api_key
            )
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
        admin_api_key: str = "",
    ) -> dict:
        """Register/update/deactivate a signal source in xstockstrat-ingest (admin-scoped).
        operation: 'register' | 'update' | 'deactivate'.
        slug/display_name/source_type/extractor_module/config_json: SignalSource fields.
        credentials_ref: optional reference forwarded to the ingest backend. It is NEVER
            echoed back in the response and never exposed to the caller (FR-12).
        admin_api_key: required; validated by the ingest backend."""
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
                api_key=admin_api_key,
            )
        except grpc.aio.AioRpcError as e:
            raise RuntimeError(_grpc_error_message(e, not_found="signal source not found")) from e

    @server.tool()
    async def set_strategy_live(
        strategy_id: str,
        live_enabled: bool,
        admin_api_key: str = "",
    ) -> dict:
        """Enable or disable live alert evaluation for a strategy. Admin scope required.
        strategy_id: ID of the strategy to toggle (from list_strategy_definitions/manage_strategy).
        live_enabled: true to enable continuous live evaluation + alerting; false to disable.
        admin_api_key: required; must carry the admin role (validated here at the agent entry).
        Returns the updated strategy definition with live_enabled reflected."""
        if not await client.validate_admin(admin_api_key):
            raise RuntimeError("admin API key required")
        try:
            return await client.set_strategy_live(
                strategy_id=strategy_id, live_enabled=live_enabled, api_key=admin_api_key
            )
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


async def _fetch_url(url: str, password: str | None = None) -> str:
    """Fetch URL content. For authenticated sources, passes password as Bearer token.
    Returns raw text."""
    import httpx  # noqa: PLC0415

    headers: dict[str, str] = {}
    if password:
        headers["Authorization"] = f"Bearer {password}"

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        return r.text
