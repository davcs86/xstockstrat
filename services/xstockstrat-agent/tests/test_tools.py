"""Tests for app/tools.py — all six MCP tool definitions."""
import base64
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from mcp.server import FastMCP

from app.tools import register_tools, _EXTRACTOR_TOOL_MAP


def _make_server() -> FastMCP:
    server = FastMCP("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: FastMCP, name: str):
    return server._tool_manager._tools[name].fn


# ── list_signal_sources ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_signal_sources_adds_extractor_tool():
    """list_signal_sources enriches response with extractor_tool from type mapping."""
    sources_payload = {
        "sources": [
            {"slug": "s1", "display_name": "S1", "source_type": "mediated_email_attachment",
             "config_json": {}, "credentials_ref": "secret.s1.pass"},
            {"slug": "s2", "display_name": "S2", "source_type": "mediated_simple_email",
             "config_json": {}, "credentials_ref": None},
            {"slug": "s3", "display_name": "S3", "source_type": "mediated_simple_website",
             "config_json": {"url": "https://example.com"}, "credentials_ref": None},
        ]
    }
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json=sources_payload)
        )
        server = _make_server()
        result = await _tool_fn(server, "list_signal_sources")()
        enriched = result["sources"]
        # Confirm extractor_tool values
        assert enriched[0]["extractor_tool"] == "extract_email_content"
        assert enriched[1]["extractor_tool"] is None
        assert enriched[2]["extractor_tool"] == "extract_website_content"
        # Confirm credentials_ref is NOT in any enriched source
        for src in enriched:
            assert "credentials_ref" not in src


@pytest.mark.asyncio
async def test_list_signal_sources_source_type_filter():
    """source_type filter returns only matching sources."""
    sources_payload = {
        "sources": [
            {"slug": "s1", "display_name": "S1", "source_type": "mediated_email_attachment",
             "config_json": {}},
            {"slug": "s2", "display_name": "S2", "source_type": "mediated_simple_email",
             "config_json": {}},
        ]
    }
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json=sources_payload)
        )
        server = _make_server()
        result = await _tool_fn(server, "list_signal_sources")(
            source_type=["mediated_email_attachment"]
        )
        assert len(result["sources"]) == 1
        assert result["sources"][0]["slug"] == "s1"


# ── extract_email_content ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_email_content_no_inputs_raises():
    """extract_email_content with no attachments_b64 or urls raises ValueError."""
    server = _make_server()
    with pytest.raises(ValueError, match="At least one"):
        await _tool_fn(server, "extract_email_content")(source_slug="s1")


@pytest.mark.asyncio
async def test_extract_email_content_unknown_slug_raises():
    """extract_email_content with unknown slug raises ValueError."""
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json={"sources": []})
        )
        server = _make_server()
        with pytest.raises(ValueError, match="Unknown or inactive source slug"):
            await _tool_fn(server, "extract_email_content")(
                source_slug="nonexistent",
                attachments_b64=["dGVzdA=="],
            )


@pytest.mark.asyncio
async def test_extract_email_content_text_attachment():
    """extract_email_content with plain text bytes returns raw_text."""
    sources_payload = {
        "sources": [
            {"slug": "s1", "display_name": "S1", "source_type": "mediated_email_attachment",
             "config_json": {}, "credentials_ref": None},
        ]
    }
    test_text = b"Buy NVDA at market open."
    b64 = base64.b64encode(test_text).decode()
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json=sources_payload)
        )
        # Mock fitz to avoid real PDF parsing
        with patch("app.tools.fitz", create=True) as mock_fitz:
            mock_doc = mock_fitz.open.return_value
            mock_doc.is_encrypted = False
            mock_doc.__iter__ = lambda self: iter([])
            # Fall back to UTF-8 decode path by raising on fitz.open
            mock_fitz.open.side_effect = Exception("not a pdf")
            server = _make_server()
            result = await _tool_fn(server, "extract_email_content")(
                source_slug="s1",
                attachments_b64=[b64],
            )
            assert "Buy NVDA" in result["raw_text"]
            # Confirm credentials not in response
            assert "credentials_ref" not in result
            assert "password" not in result


# ── extract_website_content ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_website_content_fetches_url():
    """extract_website_content fetches the URL from config_json.url."""
    sources_payload = {
        "sources": [
            {"slug": "site1", "display_name": "Site", "source_type": "mediated_simple_website",
             "config_json": {"url": "https://example.com/signals"}, "credentials_ref": None},
        ]
    }
    with respx.mock(base_url="http://ingest-test:8055") as ingest_mock:
        ingest_mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json=sources_payload)
        )
        with respx.mock(base_url="https://example.com") as site_mock:
            site_mock.get("/signals").mock(
                return_value=httpx.Response(200, text="NVDA: strong buy")
            )
            server = _make_server()
            result = await _tool_fn(server, "extract_website_content")(source_slug="site1")
            assert "NVDA" in result["raw_text"]
            assert "credentials_ref" not in result


@pytest.mark.asyncio
async def test_extract_website_content_no_url_raises():
    """extract_website_content raises if config_json has no url."""
    sources_payload = {
        "sources": [
            {"slug": "site1", "display_name": "Site", "source_type": "mediated_simple_website",
             "config_json": {}, "credentials_ref": None},
        ]
    }
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        mock.post("/xstockstrat.ingest.v1.IngestService/ListSignalSources").mock(
            return_value=httpx.Response(200, json=sources_payload)
        )
        server = _make_server()
        with pytest.raises(ValueError, match="no url in config_json"):
            await _tool_fn(server, "extract_website_content")(source_slug="site1")


# ── ingest_signal ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingest_signal_calls_webhook():
    """ingest_signal POSTs to /webhooks/ingest-signal with required fields."""
    with respx.mock(base_url="http://ingest-test:8055") as mock:
        route = mock.post("/webhooks/ingest-signal").mock(
            return_value=httpx.Response(200, json={"signal_id": 42})
        )
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=0.8,
        )
        assert result["signal_id"] == 42
        payload = json.loads(route.calls.last.request.content)
        assert payload["source"] == "unusual_whales"
        assert payload["conviction"] == 0.8


# ── emit_alert ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_emit_alert_calls_notify_webhook():
    """emit_alert POSTs to /webhooks/emit-alert."""
    with respx.mock(base_url="http://notify-test:8059") as mock:
        route = mock.post("/webhooks/emit-alert").mock(
            return_value=httpx.Response(200, json={"success": True})
        )
        server = _make_server()
        result = await _tool_fn(server, "emit_alert")(
            severity="info", category="signal", title="Test alert", body="Body text"
        )
        assert result == {"success": True}
        assert route.called


# ── run_backtest ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_backtest_calls_analysis_webhook():
    """run_backtest POSTs to /webhooks/run-backtest."""
    with respx.mock(base_url="http://analysis-test:8056") as mock:
        route = mock.post("/webhooks/run-backtest").mock(
            return_value=httpx.Response(200, json={"backtest_id": "bt-1"})
        )
        server = _make_server()
        result = await _tool_fn(server, "run_backtest")(
            strategy_id="sma_crossover",
            symbols=["NVDA", "AAPL"],
            initial_capital=50000.0,
        )
        assert result == {"backtest_id": "bt-1"}
        payload = json.loads(route.calls.last.request.content)
        assert payload["symbols"] == ["NVDA", "AAPL"]


# ── extractor_tool mapping ────────────────────────────────────────────────

def test_extractor_tool_map_values():
    """Verify the type-level extractor_tool mapping covers all mediated types."""
    assert _EXTRACTOR_TOOL_MAP["mediated_email_attachment"] == "extract_email_content"
    assert _EXTRACTOR_TOOL_MAP["mediated_linked_email"] == "extract_email_content"
    assert _EXTRACTOR_TOOL_MAP["mediated_simple_website"] == "extract_website_content"
    assert _EXTRACTOR_TOOL_MAP["mediated_authenticated_website"] == "extract_website_content"
    # mediated_simple_email and non-mediated types → null (absent from map, default None)
    assert _EXTRACTOR_TOOL_MAP.get("mediated_simple_email", None) is None
    assert _EXTRACTOR_TOOL_MAP.get("simple_email", None) is None
