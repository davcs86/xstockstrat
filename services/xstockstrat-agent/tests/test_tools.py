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
    {
        "slug": "s1",
        "display_name": "S1",
        "source_type": "mediated_email_attachment",
        "config_json": {},
        "has_credentials": False,
    },
    {
        "slug": "s2",
        "display_name": "S2",
        "source_type": "mediated_simple_email",
        "config_json": {},
        "has_credentials": False,
    },
    {
        "slug": "s3",
        "display_name": "S3",
        "source_type": "mediated_simple_website",
        "config_json": {"url": "https://example.com"},
        "has_credentials": False,
    },
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
            site_mock.get("/").mock(return_value=httpx.Response(200, text="NVDA: strong buy"))
            server = _make_server()
            result = await _tool_fn(server, "extract_website_content")(source_slug="s3")
            assert "NVDA" in result["raw_text"]
            assert "credentials_ref" not in result


@pytest.mark.asyncio
async def test_extract_website_content_no_url_raises():
    """extract_website_content raises if config_json has no url."""
    sources_no_url = [
        {
            "slug": "site1",
            "display_name": "Site",
            "source_type": "mediated_simple_website",
            "config_json": {},
            "has_credentials": False,
        },
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


# ── strategy/formula/signal-source management tools (feature 047) ──────────


def _rpc_error(code, details=""):
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    return AioRpcError(code, Metadata(), Metadata(), details=details)


class TestManageStrategyTool:
    @pytest.mark.asyncio
    async def test_calls_client_with_args(self):
        server = _make_server()
        with (
            patch.object(client, "validate_admin", AsyncMock(return_value=True)),
            patch.object(
                client, "manage_strategy", AsyncMock(return_value={"strategy_id": "sma_x"})
            ) as m,
        ):
            result = await _tool_fn(server, "manage_strategy")(
                operation="register",
                strategy_id="sma_x",
                display_name="SMA X",
                components=[{"ref_name": "fast", "kind": "builtin", "indicator": "SMA"}],
                entry_rule="{}",
                admin_api_key="key-123",
            )
        assert result == {"strategy_id": "sma_x"}
        kwargs = m.call_args.kwargs
        assert kwargs["operation"] == "register"
        assert kwargs["api_key"] == "key-123"
        assert kwargs["definition"]["strategy_id"] == "sma_x"

    @pytest.mark.asyncio
    async def test_non_admin_rejected_at_entry(self):
        server = _make_server()
        with patch.object(client, "validate_admin", AsyncMock(return_value=False)):
            with pytest.raises(RuntimeError, match="admin API key required"):
                await _tool_fn(server, "manage_strategy")(
                    operation="register", strategy_id="x", admin_api_key="bad"
                )

    @pytest.mark.asyncio
    async def test_grpc_error_reraised_as_clear_message(self):
        import grpc  # noqa: PLC0415

        server = _make_server()
        err = _rpc_error(grpc.StatusCode.NOT_FOUND, "nope")
        with (
            patch.object(client, "validate_admin", AsyncMock(return_value=True)),
            patch.object(client, "manage_strategy", AsyncMock(side_effect=err)),
        ):
            with pytest.raises(RuntimeError, match="strategy not found"):
                await _tool_fn(server, "manage_strategy")(
                    operation="update", strategy_id="x", admin_api_key="good"
                )


class TestManageFormulaTool:
    @pytest.mark.asyncio
    async def test_register_and_delete_paths(self):
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formula_id": "f-1"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="register", name="rsi2", source="x = 1", admin_api_key="k"
            )
            await _tool_fn(server, "manage_formula")(
                operation="delete",
                formula_id="f-1",
                formula_author_user_id="u1",
                admin_api_key="k",
            )
        assert m.call_count == 2
        assert m.call_args_list[0].kwargs["operation"] == "register"
        assert m.call_args_list[1].kwargs["operation"] == "delete"


class TestManageSignalSourceTool:
    @pytest.mark.asyncio
    async def test_register_omits_credentials_ref(self):
        server = _make_server()
        returned = {
            "slug": "uw",
            "display_name": "UW",
            "source_type": "newsletter",
            "extractor_module": "",
            "active": True,
            "has_credentials": True,
        }
        with patch.object(client, "manage_signal_source", AsyncMock(return_value=returned)) as m:
            result = await _tool_fn(server, "manage_signal_source")(
                operation="register",
                slug="uw",
                display_name="UW",
                source_type="newsletter",
                credentials_ref="secret-ref",
                admin_api_key="k",
            )
        assert "credentials_ref" not in result  # FR-12
        assert m.call_args.kwargs["credentials_ref"] == "secret-ref"


class TestSetStrategyLiveTool:
    @pytest.mark.asyncio
    async def test_requires_admin(self):
        server = _make_server()
        with patch.object(client, "validate_admin", AsyncMock(return_value=False)):
            with pytest.raises(RuntimeError, match="admin API key required"):
                await _tool_fn(server, "set_strategy_live")(
                    strategy_id="s1", live_enabled=True, admin_api_key="bad"
                )

    @pytest.mark.asyncio
    async def test_calls_client_when_admin(self):
        server = _make_server()
        returned = {
            "strategy_id": "s1",
            "display_name": "S1",
            "live_enabled": True,
            "active": True,
        }
        with patch.object(client, "validate_admin", AsyncMock(return_value=True)):
            with patch.object(client, "set_strategy_live", AsyncMock(return_value=returned)) as m:
                result = await _tool_fn(server, "set_strategy_live")(
                    strategy_id="s1", live_enabled=True, admin_api_key="good"
                )
        assert result == returned
        assert m.call_args.kwargs["strategy_id"] == "s1"
        assert m.call_args.kwargs["api_key"] == "good"
