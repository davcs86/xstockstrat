"""Tests for app/tools.py — all six MCP tool definitions."""
import base64
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from mcp.server import FastMCP

from app.tools import register_tools, _EXTRACTOR_TOOL_MAP
from app import client


def _make_server() -> FastMCP:
    server = FastMCP("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: FastMCP, name: str):
    return server._tool_manager._tools[name].fn


# Shared source list used by many tests
_SOURCES = [
    {"slug": "s1", "display_name": "S1", "source_type": "mediated_email_attachment",
     "config_json": {}, "has_credentials": False},
    {"slug": "s2", "display_name": "S2", "source_type": "mediated_simple_email",
     "config_json": {}, "has_credentials": False},
    {"slug": "s3", "display_name": "S3", "source_type": "mediated_simple_website",
     "config_json": {"url": "https://example.com"}, "has_credentials": False},
]


# ── list_signal_sources ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_signal_sources_adds_extractor_tool():
    """list_signal_sources enriches response with extractor_tool from type mapping."""
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=_SOURCES)):
        server = _make_server()
        result = await _tool_fn(server, "list_signal_sources")()
        enriched = result["sources"]
        assert enriched[0]["extractor_tool"] == "extract_email_content"
        assert enriched[1]["extractor_tool"] is None
        assert enriched[2]["extractor_tool"] == "extract_website_content"
        # Confirm credentials are NOT in any enriched source
        for src in enriched:
            assert "credentials_ref" not in src
            assert "has_credentials" not in src


@pytest.mark.asyncio
async def test_list_signal_sources_source_type_filter():
    """source_type filter returns only matching sources."""
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=_SOURCES)):
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
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=[])):
        server = _make_server()
        with pytest.raises(ValueError, match="Unknown or inactive source slug"):
            await _tool_fn(server, "extract_email_content")(
                source_slug="nonexistent",
                attachments_b64=["dGVzdA=="],
            )


@pytest.mark.asyncio
async def test_extract_email_content_text_attachment():
    """extract_email_content with plain text bytes returns raw_text."""
    test_text = b"Buy NVDA at market open."
    b64 = base64.b64encode(test_text).decode()
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=_SOURCES)):
        with patch("app.tools.fitz", create=True) as mock_fitz:
            mock_fitz.open.side_effect = Exception("not a pdf")
            server = _make_server()
            result = await _tool_fn(server, "extract_email_content")(
                source_slug="s1",
                attachments_b64=[b64],
            )
            assert "Buy NVDA" in result["raw_text"]
            assert "credentials_ref" not in result
            assert "password" not in result


# ── extract_website_content ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_website_content_fetches_url():
    """extract_website_content fetches the URL from config_json.url."""
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=_SOURCES)):
        with respx.mock(base_url="https://example.com") as site_mock:
            site_mock.get("/").mock(
                return_value=httpx.Response(200, text="NVDA: strong buy")
            )
            server = _make_server()
            result = await _tool_fn(server, "extract_website_content")(source_slug="s3")
            assert "NVDA" in result["raw_text"]
            assert "credentials_ref" not in result


@pytest.mark.asyncio
async def test_extract_website_content_no_url_raises():
    """extract_website_content raises if config_json has no url."""
    sources_no_url = [
        {"slug": "site1", "display_name": "Site", "source_type": "mediated_simple_website",
         "config_json": {}, "has_credentials": False},
    ]
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources_no_url)):
        server = _make_server()
        with pytest.raises(ValueError, match="no url in config_json"):
            await _tool_fn(server, "extract_website_content")(source_slug="site1")


# ── ingest_signal ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_ingest_signal_calls_grpc():
    """ingest_signal calls client.ingest_signal with required fields."""
    mock_ingest = AsyncMock(return_value={"signal_id": 42})
    mock_config = AsyncMock(return_value=None)
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=0.3,
        )
        assert result["signal_id"] == 42
        mock_ingest.assert_called_once()
        call_kwargs = mock_ingest.call_args.kwargs
        assert call_kwargs["source"] == "unusual_whales"
        assert call_kwargs["conviction"] == 0.3


@pytest.mark.asyncio
async def test_ingest_signal_auto_alert_above_threshold():
    """ingest_signal auto-emits alert when conviction >= threshold."""
    mock_ingest = AsyncMock(return_value={"signal_id": 7})
    mock_alert = AsyncMock(return_value={"alert_id": "a1"})
    mock_config = AsyncMock(return_value="0.6")
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "emit_alert", mock_alert),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        await _tool_fn(server, "ingest_signal")(
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=0.8,
        )
        mock_alert.assert_called_once()


# ── emit_alert ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_emit_alert_calls_grpc():
    """emit_alert calls client.emit_alert with correct args."""
    mock_alert = AsyncMock(return_value={"alert_id": "a1"})
    with patch.object(client, "emit_alert", mock_alert):
        server = _make_server()
        result = await _tool_fn(server, "emit_alert")(
            severity="info", category="signal", title="Test alert", body="Body text"
        )
        assert result == {"alert_id": "a1"}
        mock_alert.assert_called_once_with(
            severity="info",
            category="signal",
            title="Test alert",
            body="Body text",
            source_service="xstockstrat-agent",
            target_user_id="",
        )


# ── run_backtest ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_backtest_calls_grpc():
    """run_backtest calls client.run_backtest with correct args."""
    mock_backtest = AsyncMock(return_value={"backtest_id": "bt-1", "strategy_id": "sma"})
    with patch.object(client, "run_backtest", mock_backtest):
        server = _make_server()
        result = await _tool_fn(server, "run_backtest")(
            strategy_id="sma_crossover",
            symbols=["NVDA", "AAPL"],
            initial_capital=50000.0,
        )
        assert result["backtest_id"] == "bt-1"
        mock_backtest.assert_called_once_with(
            strategy_id="sma_crossover",
            symbols=["NVDA", "AAPL"],
            initial_capital=50000.0,
        )


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
