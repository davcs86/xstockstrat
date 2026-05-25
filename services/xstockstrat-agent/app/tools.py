"""
MCP tool definitions for xstockstrat-agent.

Six tools:
  list_signal_sources  — lists active sources from ingest, enriched with extractor_tool
  extract_email_content — extracts raw text from email attachments or gated URLs
  extract_website_content — fetches and returns raw text from a registered website source
  ingest_signal        — ingests a trading signal via ingest webhook
  emit_alert           — emits an alert via notify webhook
  run_backtest         — triggers a backtest via analysis webhook
"""
import base64
import logging
import os
from typing import Optional

from mcp.server import Server

from app import client

_ALERT_THRESHOLD = float(os.environ.get("MCP_ALERT_THRESHOLD", "0.6"))

log = logging.getLogger(__name__)

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


def register_tools(server: Server) -> None:

    @server.tool()
    async def list_signal_sources(
        source_type: Optional[list[str]] = None,
    ) -> dict:
        """List active signal sources from xstockstrat-ingest.
        Returns slug, display_name, source_type, config_json, and extractor_tool per source.
        extractor_tool: 'extract_email_content' | 'extract_website_content' | null.
        Claude must follow extractor_tool exactly — do not infer routing from source_type.
        source_type: optional filter list (e.g. ['mediated_simple_email', 'mediated_email_attachment'])."""
        result = await client.post_ingest(
            "/xstockstrat.ingest.v1.IngestService/ListSignalSources",
            {"includeInactive": False},
        )
        # Enrich each source with extractor_tool derived from source_type.
        # credentials_ref is intentionally excluded — never exposed to Claude.
        sources = result.get("sources", [])
        enriched = []
        for src in sources:
            st = src.get("source_type", "")
            enriched.append({
                "slug": src.get("slug", ""),
                "display_name": src.get("display_name", ""),
                "source_type": st,
                "config_json": src.get("config_json") or src.get("configJson", {}),
                "extractor_tool": _EXTRACTOR_TOOL_MAP.get(st, None),
            })
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

        credentials_ref = src.get("credentials_ref")
        password: str | None = None
        if credentials_ref:
            password = await client.get_config_value(credentials_ref)

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

        credentials_ref = src.get("credentials_ref")
        password: str | None = None
        if credentials_ref:
            password = await client.get_config_value(credentials_ref)

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
        payload: dict = {
            "source": source,
            "symbol": symbol,
            "direction": direction,
            "valid_from": valid_from,
        }
        if conviction is not None:
            payload["conviction"] = conviction
        if valid_until is not None:
            payload["valid_until"] = valid_until
        if headline is not None:
            payload["headline"] = headline
        if raw_url is not None:
            payload["raw_url"] = raw_url
        if tags is not None:
            payload["tags"] = tags
        result = await client.post_ingest("/webhooks/ingest-signal", payload)
        # Auto-emit alert for high-conviction signals — deterministic rule, not model-driven.
        if conviction is not None and conviction >= _ALERT_THRESHOLD:
            try:
                alert_title = headline if headline else f"{direction.upper()} {symbol} via {source}"
                alert_body = f"Signal ingested: {direction} {symbol} (conviction {conviction:.2f})"
                if valid_until:
                    alert_body += f", valid until {valid_until}"
                await client.post_notify(
                    "/webhooks/emit-alert",
                    {
                        "severity": "info",
                        "category": "signal",
                        "title": alert_title,
                        "body": alert_body,
                        "source_service": "xstockstrat-agent",
                        "target_user_id": "",
                    },
                )
            except Exception as e:
                log.warning("Auto-alert failed after ingest_signal (signal already ingested): %s", e)
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
        return await client.post_notify(
            "/webhooks/emit-alert",
            {
                "severity": severity,
                "category": category,
                "title": title,
                "body": body,
                "source_service": source_service,
                "target_user_id": target_user_id,
            },
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
        return await client.post_analysis(
            "/webhooks/run-backtest",
            {
                "strategy_id": strategy_id,
                "symbols": symbols,
                "initial_capital": initial_capital,
            },
        )


async def _get_source(source_slug: str) -> dict:
    """Fetch a single signal source by slug from the ingest registry.
    Raises ValueError if slug is not found or source is inactive."""
    result = await client.post_ingest(
        "/xstockstrat.ingest.v1.IngestService/ListSignalSources",
        {"includeInactive": False},
    )
    for src in result.get("sources", []):
        if src.get("slug") == source_slug:
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
            raise ValueError("PDF is password-protected but no credentials_ref is configured")
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
