"""Tests for app/tools.py — MCP tool definitions."""

import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx
from mcp.server.mcpserver import MCPServer

from app import client
from app.tools import _EXTRACTOR_TOOL_MAP, register_tools
from tests.conftest import ADMIN, _ctx  # feature 092: shared ctx/claims helpers


def _make_server() -> MCPServer:
    server = MCPServer("test-agent")
    register_tools(server)
    return server


def _tool_fn(server: MCPServer, name: str):
    return server._tool_manager.get_tool(name).fn


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
async def test_extract_website_content_sends_request_headers():
    """extract_website_content forwards config_json.request_headers on the fetch
    (e.g. the User-Agent SEC EDGAR requires)."""
    sources_with_headers = [
        {
            "slug": "edgar",
            "display_name": "EDGAR",
            "source_type": "mediated_simple_website",
            "config_json": {
                "url": "https://example.com/",
                "scrape_selector": "entry",
                "request_headers": {"User-Agent": "xstockstrat contact@example.com"},
            },
            "has_credentials": False,
        },
    ]
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources_with_headers)):
        with respx.mock(base_url="https://example.com") as site_mock:
            route = site_mock.get("/").mock(
                return_value=httpx.Response(200, text="<entry>8-K</entry>")
            )
            server = _make_server()
            result = await _tool_fn(server, "extract_website_content")(source_slug="edgar")
            assert "8-K" in result["raw_text"]
            sent = route.calls.last.request.headers
            assert sent["User-Agent"] == "xstockstrat contact@example.com"


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


# ── feature 093: a source requiring credentials is loudly UNSUPPORTED ─────────


@pytest.mark.asyncio
async def test_extract_email_content_raises_when_credentials_required():
    """A has_credentials=True source RAISES RuntimeError (secure resolution unsupported) rather
    than silently reading a plaintext config credential and fetching unauthenticated."""
    from tests.conftest import credentialed_source

    src = credentialed_source(slug="cred_email", source_type="mediated_email_attachment")
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=[src])):
        with patch.object(client, "get_config_value", AsyncMock()) as read:
            server = _make_server()
            with pytest.raises(RuntimeError, match="not supported yet"):
                await _tool_fn(server, "extract_email_content")(
                    source_slug="cred_email", attachments_b64=["dGVzdA=="]
                )
        read.assert_not_awaited()  # no credential config read happens at all


@pytest.mark.asyncio
async def test_extract_website_content_raises_when_credentials_required():
    from tests.conftest import credentialed_source

    src = credentialed_source(slug="cred_site")
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=[src])):
        with patch.object(client, "get_config_value", AsyncMock()) as read:
            server = _make_server()
            with pytest.raises(RuntimeError, match="not supported yet"):
                await _tool_fn(server, "extract_website_content")(source_slug="cred_site")
        read.assert_not_awaited()


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
    # deduplicated=False set explicitly (feature 111) — proves the alert guard reads the key
    # rather than accidentally over-suppressing on a missing key.
    mock_ingest = AsyncMock(return_value={"signal_id": 7, "deduplicated": False})
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
    # feature 093: the threshold read is env-scoped in the `agent` namespace (was env-blind).
    kw = mock_config.await_args.kwargs
    assert kw["namespace"] == "agent"
    assert kw["environment"] in ("dev", "production")


@pytest.mark.asyncio
async def test_ingest_signal_suppresses_alert_when_deduplicated():
    """feature 111 (FR-4/AC-3): a deduplicated submission must NOT emit a duplicate alert,
    even when conviction is above the threshold."""
    mock_ingest = AsyncMock(return_value={"signal_id": 7, "deduplicated": True})
    mock_alert = AsyncMock(return_value={"alert_id": "a1"})
    mock_config = AsyncMock(return_value="0.6")
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "emit_alert", mock_alert),
        patch.object(client, "get_config_value", mock_config),
    ):
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=0.8,
        )
    assert result["deduplicated"] is True
    mock_alert.assert_not_called()


@pytest.mark.asyncio
async def test_ingest_signal_returns_deduplicated_field_in_payload():
    """The tool's returned dict includes the deduplicated key end-to-end (feature 111)."""
    mock_ingest = AsyncMock(return_value={"signal_id": 42, "deduplicated": False})
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
        )
    assert result == {"signal_id": 42, "deduplicated": False}


@pytest.mark.asyncio
async def test_ingest_signal_survives_threshold_read_failure():
    """feature 093: the post-commit threshold read is best-effort — a transport error must NOT
    fail ingest_signal (the signal is already persisted); it falls back to the default 0.6."""
    import grpc

    err = grpc.aio.AioRpcError(grpc.StatusCode.UNAVAILABLE, None, None, details="config down")
    mock_ingest = AsyncMock(return_value={"signal_id": 9})
    mock_alert = AsyncMock(return_value={"alert_id": "a1"})
    with (
        patch.object(client, "ingest_signal", mock_ingest),
        patch.object(client, "emit_alert", mock_alert),
        patch.object(client, "get_config_value", AsyncMock(side_effect=err)),
    ):
        server = _make_server()
        result = await _tool_fn(server, "ingest_signal")(
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=0.8,  # ≥ default 0.6 → alert still fires
        )
    assert result == {"signal_id": 9}  # ingest did not fail
    mock_alert.assert_called_once()  # default threshold used


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
            context=None,
            tags=None,
            correlation_id="",
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
        # feature 072: the tool now returns content blocks, not a dict — the summary is block 0.
        summary = json.loads(result[0].text)
        assert summary["backtest_id"] == "bt-1"
        mock_backtest.assert_called_once_with(
            strategy_id="sma_crossover",
            symbols=["NVDA", "AAPL"],
            initial_capital=50000.0,
            # feature 071: omitted window forwards as None/None, so the servicer applies its
            # rolling default — the pre-071 behavior (FR-2).
            start=None,
            end=None,
        )


class TestRunBacktestWindow:
    """feature 071 — the tool's optional start/end evaluation window."""

    @pytest.mark.asyncio
    async def test_window_is_forwarded_to_the_client(self):
        mock_backtest = AsyncMock(return_value={"backtest_id": "bt-2"})
        with patch.object(client, "run_backtest", mock_backtest):
            server = _make_server()
            await _tool_fn(server, "run_backtest")(
                strategy_id="sma",
                symbols=["NVDA"],
                start="2024-01-01",
                end="2024-06-30",
            )
        assert mock_backtest.call_args.kwargs["start"] == "2024-01-01"
        assert mock_backtest.call_args.kwargs["end"] == "2024-06-30"

    @pytest.mark.asyncio
    async def test_one_sided_window_forwards_only_the_supplied_bound(self):
        """Either bound may be given alone — the other stays None so the servicer defaults it."""
        mock_backtest = AsyncMock(return_value={"backtest_id": "bt-3"})
        with patch.object(client, "run_backtest", mock_backtest):
            server = _make_server()
            await _tool_fn(server, "run_backtest")(
                strategy_id="sma", symbols=["NVDA"], start="2024-01-01"
            )
        assert mock_backtest.call_args.kwargs["start"] == "2024-01-01"
        assert mock_backtest.call_args.kwargs["end"] is None

    @pytest.mark.asyncio
    async def test_start_and_end_are_exposed_on_the_tool_schema(self):
        """The MCP schema is the agent's only discovery surface — an un-advertised parameter is
        an un-usable one, so the window must appear in the published inputSchema."""
        server = _make_server()
        tools = await server.list_tools()
        schema = next(t for t in tools if t.name == "run_backtest").input_schema
        assert "start" in schema["properties"]
        assert "end" in schema["properties"]
        # optional — an agent that omits them still gets the rolling default
        assert "start" not in schema.get("required", [])
        assert "end" not in schema.get("required", [])


class TestRunBacktestAttachment:
    """feature 072 — the tool returns a compact summary block plus one attachment.

    The fixture is deliberately **non-echoing**: per-bar rows carry a sentinel that appears nowhere
    in the FR-2 summary key set, so a test cannot pass by reading the wrong half of the split.
    """

    SENTINEL = "sentinel_only_in_attachment"

    @staticmethod
    def _result(symbols: int = 1, bars: int = 50, **overrides) -> dict:
        """A realistic `client.run_backtest` dict.

        `coverage_gaps` is exactly ONE entry regardless of `symbols`: gaps are per-symbol on OK runs
        too, so a factory that scaled them would push the linearity test past its slope and go red
        for the wrong reason. `profit_factor` is finite (1.8) — the producer clamps and never emits
        `Infinity`. `volume` is a string int64 while `bar_index` stays an int.
        """
        result = {
            "backtest_id": "bt-abc123",
            "strategy_id": "sma",
            "status": "BACKTEST_STATUS_OK",
            "total_return": 0.15,
            "total_trades": 42,
            "profit_factor": 1.8,
            "initial_capital": 100000.0,
            "trades": [{"symbol": "AAPL", "pnl": 680.0}],
            "coverage_gaps": [{"symbol": "AAPL", "bars_have": "120", "bars_need": "504"}],
            "diagnostics": [
                {
                    "symbol": f"SYM{s}",
                    "bars_total": bars,
                    "warmup_bars": 20,
                    "no_trade_reason": "NO_TRADE_REASON_ENTRY_NEVER_TRUE",
                    "bars": [
                        {
                            "symbol": f"SYM{s}",
                            "bar_index": i,
                            "volume": "51234567",
                            "indicators": {TestRunBacktestAttachment.SENTINEL: 1.0},
                        }
                        for i in range(bars)
                    ],
                }
                for s in range(symbols)
            ],
        }
        result.update(overrides)
        return result

    @staticmethod
    async def _call(result: dict):
        with patch.object(client, "run_backtest", AsyncMock(return_value=result)):
            server = _make_server()
            return await _tool_fn(server, "run_backtest")(strategy_id="sma", symbols=["AAPL"])

    @pytest.mark.asyncio
    async def test_inline_summary_has_no_per_bar_detail(self):
        """AC-1 — the bounded half."""
        out = await self._call(self._result(symbols=2))
        assert out[0].type == "text"
        assert self.SENTINEL not in out[0].text
        summary = json.loads(out[0].text)
        assert "trades" not in summary
        for entry in summary["diagnostics"]:
            assert "bars" not in entry

    @pytest.mark.asyncio
    async def test_inline_summary_is_independent_of_window_length(self):
        """AC-1 — NOT byte-identity: `bars_total` tracks bar count, so demanding equality could
        only be met by pinning it, which is an inert fixture."""
        a = json.loads((await self._call(self._result(bars=50)))[0].text)
        b = json.loads((await self._call(self._result(bars=5000)))[0].text)
        a_totals = [d.pop("bars_total") for d in a["diagnostics"]]
        b_totals = [d.pop("bars_total") for d in b["diagnostics"]]
        assert a == b
        assert a_totals == [50] and b_totals == [5000]
        assert abs(len(json.dumps(a)) - len(json.dumps(b))) < 16

    @pytest.mark.asyncio
    async def test_inline_summary_is_linear_in_symbol_count(self):
        """AC-1 — same instrument as the backtest_view test: assert the slope, not the intercept.

        Note this measures `result[0].text`, which the tool builds with `indent=2`, where the
        sibling measures compact `json.dumps`. Both bounds hold; the shared form is the point.
        """
        r1 = (await self._call(self._result(symbols=1)))[0].text
        r10 = (await self._call(self._result(symbols=10)))[0].text
        assert len(r10) - len(r1) < 9 * 250
        assert len(r10) < 8_000

    @pytest.mark.asyncio
    async def test_attachment_round_trips_to_the_complete_result(self):
        """AC-2 / FR-3 — the attachment IS the result the client returned."""
        result = self._result(symbols=2)
        out = await self._call(result)
        assert json.loads(out[1].resource.text) == result
        assert self.SENTINEL in out[1].resource.text

    @pytest.mark.asyncio
    async def test_the_published_tool_returns_two_content_blocks(self):
        """The only test that crosses the wire: every other test here calls the raw undecorated
        function via `_tool_fn`, so the return never passes through `convert_result`.

        This guards the **return shape**, not the decorator — `structured_output=False` is a no-op
        for a bare `-> list`. The ordering assertion is the live half: it fails on `main-dev`, where
        the tool returns a dict.
        """
        from mcp.types import EmbeddedResource, TextContent

        with patch.object(client, "run_backtest", AsyncMock(return_value=self._result())):
            server = _make_server()
            args = {"strategy_id": "sma", "symbols": ["A"]}
            result = await server.call_tool("run_backtest", args)
            content = result.content
        assert isinstance(content[0], TextContent)
        assert isinstance(content[1], EmbeddedResource)

    @pytest.mark.asyncio
    async def test_zero_trade_run_is_diagnosable_from_the_summary_alone(self):
        """AC-3 — the feature-064 promise, kept from the inline half alone.

        Overrides the base fixture: a real 0-trade run emits `profit_factor: 1.0` (both gross sums
        are 0), not the base 1.8 and never the string "Infinity", which the producer cannot emit.
        """
        out = await self._call(self._result(profit_factor=1.0, total_trades=0))
        summary = json.loads(out[0].text)
        assert summary["total_trades"] == 0
        assert summary["profit_factor"] == 1.0
        for entry in summary["diagnostics"]:
            assert entry["no_trade_reason"] == "NO_TRADE_REASON_ENTRY_NEVER_TRUE"
            assert "bars_total" in entry and "warmup_bars" in entry

    @pytest.mark.asyncio
    async def test_insufficient_data_run_has_coverage_gaps_inline_and_no_attachment(self):
        """AC-4 — the case with no attachment at all, so the inline path is the only path."""
        out = await self._call(
            self._result(
                status="BACKTEST_STATUS_INSUFFICIENT_DATA",
                trades=[],
                diagnostics=[],
            )
        )
        assert len(out) == 1
        summary = json.loads(out[0].text)
        assert summary["coverage_gaps"][0]["bars_have"] == "120"
        assert summary["attachments"] == []

    @pytest.mark.asyncio
    async def test_attachment_failure_degrades_to_summary_only(self):
        """FR-5 — a presentation failure must not fail a backtest that succeeded."""
        from app import tools as tools_mod

        with patch.object(
            tools_mod.backtest_view, "build_blocks", side_effect=RuntimeError("boom")
        ):
            out = await self._call(self._result())
        assert len(out) == 1
        summary = json.loads(out[0].text)
        assert summary["backtest_id"] == "bt-abc123"
        assert summary["attachments"] == []
        assert "attachments_error" in summary
        # Never str(e): a pydantic repr can embed the whole payload this feature keeps out.
        assert "boom" not in summary["attachments_error"]

    @pytest.mark.asyncio
    async def test_summary_advertises_its_attachments(self):
        """FR-5 — a client that renders no attachment affordance still learns detail exists."""
        out = await self._call(self._result())
        refs = json.loads(out[0].text)["attachments"]
        assert len(refs) == 1
        assert refs[0]["mime_type"] == "application/json"
        assert "bt-abc123" in refs[0]["uri"]


# ── screen_symbols (feature 061) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_screen_symbols_calls_client():
    """screen_symbols delegates to client.screen_symbols with the forwarded kwargs."""
    mock_screen = AsyncMock(
        return_value={
            "results": [{"symbol": "NVDA", "score": 0.9, "passed": True}],
            "coverage_gaps": [],
        }
    )
    criteria = [{"ref_name": "pe", "kind": "SCREEN_KIND_FUNDAMENTAL", "op": "COMPARATOR_LTE"}]
    with patch.object(client, "screen_symbols", mock_screen):
        server = _make_server()
        result = await _tool_fn(server, "screen_symbols")(
            symbols=["NVDA", "AAPL"],
            criteria=criteria,
            rank_limit=5,
        )
        assert result["results"][0]["symbol"] == "NVDA"
        mock_screen.assert_called_once_with(
            symbols=["NVDA", "AAPL"],
            criteria=criteria,
            signal_sources=None,
            signal_weight=0.0,
            technical_weight=1.0,
            min_conviction=0.0,
            rank_limit=5,
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
        with patch.object(
            client, "manage_strategy", AsyncMock(return_value={"strategy_id": "sma_x"})
        ) as m:
            result = await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN),
                operation="register",
                strategy_id="sma_x",
                display_name="SMA X",
                components=[{"ref_name": "fast", "kind": "builtin", "indicator": "SMA"}],
                entry_rule="{}",
            )
        assert result == {"strategy_id": "sma_x"}
        kwargs = m.call_args.kwargs
        assert kwargs["operation"] == "register"
        assert kwargs["definition"]["strategy_id"] == "sma_x"

    @pytest.mark.asyncio
    async def test_forwards_cooldown_days(self):
        """FR-10: an explicit cooldown_days (incl. 0) is forwarded; omitting it omits the key."""
        server = _make_server()
        with patch.object(
            client, "manage_strategy", AsyncMock(return_value={"strategy_id": "s"})
        ) as m:
            # Non-zero value forwarded.
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="register", strategy_id="s", cooldown_days=14
            )
            assert m.call_args.kwargs["definition"]["cooldown_days"] == 14

            # Explicit 0 (no cooldown) must NOT be dropped by a truthy check.
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="register", strategy_id="s", cooldown_days=0
            )
            defn = m.call_args.kwargs["definition"]
            assert "cooldown_days" in defn and defn["cooldown_days"] == 0

            # Omitted → key absent (server applies the platform default).
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="register", strategy_id="s"
            )
            assert "cooldown_days" not in m.call_args.kwargs["definition"]

    @pytest.mark.asyncio
    async def test_grpc_error_reraised_as_clear_message(self):
        import grpc  # noqa: PLC0415

        server = _make_server()
        err = _rpc_error(grpc.StatusCode.NOT_FOUND, "nope")
        with patch.object(client, "manage_strategy", AsyncMock(side_effect=err)):
            with pytest.raises(RuntimeError, match="strategy not found"):
                # supply a field: an empty update is now rejected client-side before the RPC
                await _tool_fn(server, "manage_strategy")(
                    ctx=_ctx(ADMIN), operation="update", strategy_id="x", display_name="X"
                )


class TestManageFormulaTool:
    @pytest.mark.asyncio
    async def test_register_and_delete_paths(self):
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formula_id": "f-1"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="register", name="rsi2", source="x = 1"
            )
            await _tool_fn(server, "manage_formula")(
                operation="delete",
                formula_id="f-1",
                formula_author_user_id="u1",
            )
        assert m.call_count == 2
        assert m.call_args_list[0].kwargs["operation"] == "register"
        assert m.call_args_list[1].kwargs["operation"] == "delete"

    @pytest.mark.asyncio
    async def test_register_carries_parameter_definitions(self):
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formula_id": "f-2"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="register",
                name="rsi3",
                source="result = params['period']",
                parameters=[
                    {
                        "name": "period",
                        "type": "int",
                        "default": 14,
                        "required": True,
                        "min": 1,
                        "max": 200,
                    }
                ],
            )
        formula = m.call_args.kwargs["formula"]
        assert formula["parameters"] == [
            {
                "name": "period",
                "type": "int",
                "default": 14,
                "required": True,
                "min": 1,
                "max": 200,
            }
        ]


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
                ctx=_ctx(ADMIN),
                operation="register",
                slug="uw",
                display_name="UW",
                source_type="newsletter",
                credentials_ref="secret-ref",
            )
        assert "credentials_ref" not in result  # FR-12
        assert m.call_args.kwargs["credentials_ref"] == "secret-ref"


class TestSetStrategyLiveTool:
    @pytest.mark.asyncio
    async def test_calls_client(self):
        server = _make_server()
        returned = {
            "strategy_id": "s1",
            "display_name": "S1",
            "live_enabled": True,
            "active": True,
        }
        with patch.object(client, "set_strategy_live", AsyncMock(return_value=returned)) as m:
            result = await _tool_fn(server, "set_strategy_live")(
                ctx=_ctx(ADMIN), strategy_id="s1", live_enabled=True
            )
        assert result == returned
        assert m.call_args.kwargs["strategy_id"] == "s1"
        assert m.call_args.kwargs["live_enabled"] is True


@pytest.mark.asyncio
async def test_run_backtest_projects_full_result_with_diagnostics():
    """feature 064: client.run_backtest returns the full result (snake_case keys, zero-valued
    metrics preserved, per-bar diagnostics with readable enum names)."""
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc

    result = analysis_pb2.BacktestResult(
        backtest_id="bt-9", strategy_id="s", total_return=0.0, total_trades=0
    )
    sd = result.diagnostics.add()
    sd.symbol = "AAPL"
    sd.no_trade_reason = analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE
    bar = sd.bars.add()
    bar.symbol = "AAPL"
    bar.bar_index = 0
    bar.close = 10.0
    bar.warmup = True
    bar.action = analysis_pb2.BAR_ACTION_WARMUP

    class _Chan:
        async def __aenter__(self):
            return MagicMock()

        async def __aexit__(self, *a):
            return False

    stub = MagicMock()
    stub.RunBacktest = AsyncMock(return_value=result)
    with (
        patch.object(client.grpc.aio, "insecure_channel", return_value=_Chan()),
        patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=stub),
    ):
        out = await client.run_backtest(strategy_id="s", symbols=["AAPL"], initial_capital=100000.0)

    assert out["backtest_id"] == "bt-9"
    # zero-valued metrics stay present (the "0 trades / 0% return" debugging case)
    assert out["total_return"] == 0.0
    assert out["total_trades"] == 0
    # per-bar diagnostics surfaced with snake_case keys + readable enum names
    diag = out["diagnostics"][0]
    assert diag["symbol"] == "AAPL"
    assert diag["no_trade_reason"] == "NO_TRADE_REASON_ENTRY_NEVER_TRUE"
    assert diag["bars"][0]["action"] == "BAR_ACTION_WARMUP"
    assert diag["bars"][0]["bar_index"] == 0


@pytest.mark.asyncio
async def test_run_backtest_sends_strategy_id_ref_for_registered_definition():
    """feature 065: agent-triggered runs must execute the REGISTERED definition, so the client
    sends strategy_id_ref == strategy_id (earning fingerprinted evidence for the headline grade).
    Unregistered ids now surface NOT_FOUND instead of silently running a legacy SMA backtest.

    Asserted at the stub-capture level (the constructed RunBacktestRequest) — NOT in
    test_run_backtest_calls_grpc, which mocks client.run_backtest wholesale so no request object
    is ever constructed there.
    """
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc

    class _Chan:
        async def __aenter__(self):
            return MagicMock()

        async def __aexit__(self, *a):
            return False

    stub = MagicMock()
    stub.RunBacktest = AsyncMock(
        return_value=analysis_pb2.BacktestResult(backtest_id="bt-1", strategy_id="sma")
    )
    with (
        patch.object(client.grpc.aio, "insecure_channel", return_value=_Chan()),
        patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=stub),
    ):
        await client.run_backtest(strategy_id="sma", symbols=["AAPL"], initial_capital=100000.0)

    sent = stub.RunBacktest.call_args.args[0]
    assert sent.strategy_id == "sma"
    assert sent.strategy_id_ref == "sma"


class TestRunBacktestRangeOnTheWire:
    """feature 071 — what the client actually puts on the RunBacktestRequest.

    Asserted at the stub-capture level: the tool-layer tests above mock client.run_backtest
    wholesale, so no request proto is ever built there.
    """

    @staticmethod
    def _capture():
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc

        class _Chan:
            async def __aenter__(self):
                return MagicMock()

            async def __aexit__(self, *a):
                return False

        stub = MagicMock()
        stub.RunBacktest = AsyncMock(
            return_value=analysis_pb2.BacktestResult(backtest_id="bt-1", strategy_id="sma")
        )
        return stub, (
            patch.object(client.grpc.aio, "insecure_channel", return_value=_Chan()),
            patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=stub),
        )

    @pytest.mark.asyncio
    async def test_no_window_leaves_range_unset(self):
        """FR-2: omitting the window must be byte-identical to the pre-071 request, so the
        servicer's rolling default applies. An all-zero `range` would be indistinguishable
        from unset on the wire, but leaving the field unset keeps HasField honest."""
        stub, (p1, p2) = self._capture()
        with p1, p2:
            await client.run_backtest(strategy_id="sma", symbols=["AAPL"])
        assert not stub.RunBacktest.call_args.args[0].HasField("range")

    @pytest.mark.asyncio
    async def test_both_bounds_are_sent_as_a_timerange(self):
        stub, (p1, p2) = self._capture()
        with p1, p2:
            await client.run_backtest(
                strategy_id="sma", symbols=["AAPL"], start="2024-01-01", end="2024-06-30"
            )
        sent = stub.RunBacktest.call_args.args[0]
        assert sent.HasField("range")
        assert sent.range.start.ToDatetime().isoformat() == "2024-01-01T00:00:00"
        assert sent.range.end.ToDatetime().isoformat() == "2024-06-30T00:00:00"

    @pytest.mark.asyncio
    async def test_one_sided_range_leaves_the_other_bound_open(self):
        """The servicer reads an unset bound (seconds == 0) as open and defaults it
        independently, so a one-sided range must not fabricate the missing side."""
        stub, (p1, p2) = self._capture()
        with p1, p2:
            await client.run_backtest(strategy_id="sma", symbols=["AAPL"], start="2024-01-01")
        sent = stub.RunBacktest.call_args.args[0]
        assert sent.HasField("range")
        assert sent.range.start.seconds > 0
        assert sent.range.end.seconds == 0

    @pytest.mark.asyncio
    async def test_zulu_and_naive_datetimes_both_resolve_to_utc(self):
        """A 'Z' suffix and a bare datetime must land on the same instant — otherwise the same
        window expressed two ways would produce two different (non-comparable) runs."""
        stub, (p1, p2) = self._capture()
        with p1, p2:
            await client.run_backtest(
                strategy_id="sma", symbols=["AAPL"], start="2024-01-01T00:00:00Z"
            )
            zulu = stub.RunBacktest.call_args.args[0].range.start.seconds
            await client.run_backtest(strategy_id="sma", symbols=["AAPL"], start="2024-01-01")
            naive = stub.RunBacktest.call_args.args[0].range.start.seconds
        assert zulu == naive

    @pytest.mark.asyncio
    async def test_inverted_window_is_rejected_before_the_rpc(self):
        """Caught client-side: the servicer would otherwise default nothing and run an empty
        window, reporting a confusing INSUFFICIENT_DATA instead of naming the real mistake."""
        stub, (p1, p2) = self._capture()
        with p1, p2, pytest.raises(ValueError, match="start must not be after end"):
            await client.run_backtest(
                strategy_id="sma", symbols=["AAPL"], start="2024-06-30", end="2024-01-01"
            )
        stub.RunBacktest.assert_not_called()


# ── backfill tools (feature 066) ───────────────────────────────────────────


class TestTriggerBackfillTool:
    @pytest.mark.asyncio
    async def test_delegates_to_client_and_passes_result_through(self):
        server = _make_server()
        payload = {"job_id": "j-1", "status": "BACKFILL_STATUS_QUEUED"}
        with patch.object(client, "trigger_backfill", AsyncMock(return_value=payload)) as m:
            result = await _tool_fn(server, "trigger_backfill")(
                ctx=_ctx(ADMIN),
                symbols=["AAPL"],
                timeframe="1d",
                start="2020-01-01T00:00:00Z",
                end="2024-12-31T00:00:00Z",
            )
        assert result == payload
        kwargs = m.call_args.kwargs
        assert kwargs["symbols"] == ["AAPL"]
        assert kwargs["timeframe"] == "1d"
        assert kwargs["start"] == "2020-01-01T00:00:00Z"
        assert kwargs["end"] == "2024-12-31T00:00:00Z"

    @pytest.mark.asyncio
    async def test_any_grpc_error_maps_through_grpc_error_message(self):
        import grpc  # noqa: PLC0415

        server = _make_server()
        err = _rpc_error(grpc.StatusCode.UNAVAILABLE, "boom")
        with patch.object(client, "trigger_backfill", AsyncMock(side_effect=err)):
            with pytest.raises(RuntimeError, match="boom"):
                await _tool_fn(server, "trigger_backfill")(ctx=_ctx(ADMIN), symbols=["AAPL"])


class TestGetBackfillStatusTool:
    @pytest.mark.asyncio
    async def test_delegates_both_modes_kwargs(self):
        server = _make_server()
        with patch.object(client, "get_backfill_status", AsyncMock(return_value={"job": {}})) as m:
            await _tool_fn(server, "get_backfill_status")(job_id="j-1")
            assert m.call_args.kwargs["job_id"] == "j-1"
            await _tool_fn(server, "get_backfill_status")(
                status_filter="completed", symbol="AAPL", limit=5, page_token="10"
            )
        kwargs = m.call_args.kwargs
        assert kwargs["status_filter"] == "completed"
        assert kwargs["symbol"] == "AAPL"
        assert kwargs["limit"] == 5
        assert kwargs["page_token"] == "10"

    @pytest.mark.asyncio
    async def test_not_found_maps_to_backfill_job_not_found(self):
        import grpc  # noqa: PLC0415

        server = _make_server()
        err = _rpc_error(grpc.StatusCode.NOT_FOUND, "nope")
        with patch.object(client, "get_backfill_status", AsyncMock(side_effect=err)):
            with pytest.raises(RuntimeError, match="backfill job not found"):
                await _tool_fn(server, "get_backfill_status")(job_id="missing")


class TestManageStrategyPartialUpdate:
    """feature 070 — the MCP tool is a co-cause of the wipe, not just a victim.

    Pre-070 the tool defaulted display_name/components/entry_rule/exit_rule and shipped them
    unconditionally, so a cooldown-only update transmitted explicit empties. A server-side merge
    alone could not have fixed the incident; these pin the client half.
    """

    @pytest.mark.asyncio
    async def test_cooldown_only_update_sends_only_cooldown(self):
        """The incident, at the layer that caused it."""
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="update", strategy_id="range_mr_v3", cooldown_days=45
            )
        kwargs = m.await_args.kwargs
        assert kwargs["definition"] == {"strategy_id": "range_mr_v3", "cooldown_days": 45}
        assert kwargs["update_mask"] == ["cooldown_days"]
        # The fields that used to be fabricated are simply absent.
        for wiped in ("components", "entry_rule", "exit_rule", "display_name"):
            assert wiped not in kwargs["definition"]

    @pytest.mark.asyncio
    async def test_explicit_zero_cooldown_still_survives(self):
        """feature 069's explicit-presence contract: 0 means 'no cooldown', not 'unset'."""
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="update", strategy_id="x", cooldown_days=0
            )
        assert m.await_args.kwargs["definition"]["cooldown_days"] == 0
        assert m.await_args.kwargs["update_mask"] == ["cooldown_days"]

    @pytest.mark.asyncio
    async def test_clear_fields_joins_the_mask_without_a_value(self):
        """The only way to express erase: masked path, no value (AIP-161)."""
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN), operation="update", strategy_id="x", clear_fields=["exit_rule"]
            )
        kwargs = m.await_args.kwargs
        assert kwargs["update_mask"] == ["exit_rule"]
        assert "exit_rule" not in kwargs["definition"]

    @pytest.mark.asyncio
    async def test_empty_update_is_rejected_before_the_rpc(self):
        """The tool can never emit a maskless update, so the MCP path cannot full-replace by
        accident."""
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock()) as m:
            with pytest.raises(ValueError, match="at least one field to change"):
                await _tool_fn(server, "manage_strategy")(
                    ctx=_ctx(ADMIN), operation="update", strategy_id="x"
                )
        m.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_register_sends_no_mask(self):
        """The mask is update-only; register still means 'this is the whole definition'."""
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN),
                operation="register",
                strategy_id="x",
                display_name="X",
                entry_rule="{}",
            )
        assert m.await_args.kwargs["update_mask"] is None

    @pytest.mark.asyncio
    async def test_multi_field_update_masks_exactly_those_fields(self):
        server = _make_server()
        with patch.object(client, "manage_strategy", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_strategy")(
                ctx=_ctx(ADMIN),
                operation="update",
                strategy_id="x",
                display_name="New",
                entry_rule="{}",
            )
        assert sorted(m.await_args.kwargs["update_mask"]) == ["display_name", "entry_rule"]


class TestGetStrategyTool:
    """feature 070 FR-3 — the 14th tool, a thin read over the already-shipped client wrapper."""

    @pytest.mark.asyncio
    async def test_returns_the_definition(self):
        server = _make_server()
        stored = {"strategy_id": "x", "entry_rule": "{}", "components": []}
        with patch.object(client, "get_strategy", AsyncMock(return_value=stored)) as m:
            result = await _tool_fn(server, "get_strategy")(strategy_id="x")
        assert result == stored
        m.assert_awaited_once_with(strategy_id="x")

    @pytest.mark.asyncio
    async def test_not_found_is_a_clear_message(self):
        import grpc  # noqa: PLC0415

        server = _make_server()
        err = _rpc_error(grpc.StatusCode.NOT_FOUND, "nope")
        with patch.object(client, "get_strategy", AsyncMock(side_effect=err)):
            with pytest.raises(RuntimeError, match="strategy not found"):
                await _tool_fn(server, "get_strategy")(strategy_id="x")


class TestAdditiveTools:
    @pytest.mark.asyncio
    async def test_test_formula_dispatches_inline_source(self):
        server = _make_server()
        with patch.object(
            client, "execute_formula", AsyncMock(return_value={"success": True})
        ) as m:
            result = await _tool_fn(server, "test_formula")(
                source="result = {'value': 1}", input_data={"close": [1, 2]}
            )
        assert result == {"success": True}
        assert m.call_args.kwargs["formula_source"] == "result = {'value': 1}"

    @pytest.mark.asyncio
    async def test_cancel_backfill_dispatches(self):
        server = _make_server()
        with patch.object(
            client, "cancel_backfill", AsyncMock(return_value={"job": {"job_id": "j-1"}})
        ) as m:
            result = await _tool_fn(server, "cancel_backfill")(ctx=_ctx(ADMIN), job_id="j-1")
        m.assert_awaited_once_with("j-1", access_scope=15)  # admin roles → scope 15 (feature 092)
        assert result["job"]["job_id"] == "j-1"

    @pytest.mark.asyncio
    async def test_list_strategies_wraps_definitions(self):
        server = _make_server()
        with patch.object(
            client, "list_strategy_definitions", AsyncMock(return_value=[{"strategy_id": "s1"}])
        ):
            result = await _tool_fn(server, "list_strategies")(include_inactive=True)
        assert result == {"strategies": [{"strategy_id": "s1"}]}

    @pytest.mark.asyncio
    async def test_emit_alert_forwards_extra_fields(self):
        server = _make_server()
        with patch.object(client, "emit_alert", AsyncMock(return_value={"alert_id": "a1"})) as m:
            await _tool_fn(server, "emit_alert")(
                severity="info",
                category="system",
                title="t",
                body="b",
                context={"k": "v"},
                tags=["x"],
                correlation_id="c1",
            )
        kw = m.call_args.kwargs
        assert kw["context"] == {"k": "v"}
        assert kw["tags"] == ["x"]
        assert kw["correlation_id"] == "c1"


class TestFormulaPartialUpdateTool:
    @pytest.mark.asyncio
    async def test_update_derives_mask_from_supplied_fields(self):
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formulaId": "f-1"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="update",
                formula_id="f-1",
                formula_author_user_id="u1",
                description="tweak",
            )
        formula = m.call_args.kwargs["formula"]
        assert formula["update_mask"] == ["description"]

    @pytest.mark.asyncio
    async def test_update_is_public_false_is_masked(self):
        # is_public=False is a real value (unpublish), distinct from omitting it.
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formulaId": "f-1"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="update",
                formula_id="f-1",
                formula_author_user_id="u1",
                is_public=False,
            )
        assert m.call_args.kwargs["formula"]["update_mask"] == ["is_public"]

    @pytest.mark.asyncio
    async def test_update_omitted_field_not_in_mask(self):
        server = _make_server()
        with patch.object(
            client, "manage_formula", AsyncMock(return_value={"formulaId": "f-1"})
        ) as m:
            await _tool_fn(server, "manage_formula")(
                operation="update",
                formula_id="f-1",
                formula_author_user_id="u1",
                description="only this",
            )
        assert "is_public" not in m.call_args.kwargs["formula"]["update_mask"]

    @pytest.mark.asyncio
    async def test_update_with_no_fields_raises(self):
        server = _make_server()
        with pytest.raises(RuntimeError, match="at least one field"):
            await _tool_fn(server, "manage_formula")(
                operation="update", formula_id="f-1", formula_author_user_id="u1"
            )


class TestFormulaReadTools:
    @pytest.mark.asyncio
    async def test_get_formula_tool_registered(self):
        server = _make_server()
        with patch.object(
            client, "get_formula", AsyncMock(return_value={"formulaId": "f-1", "deleted": True})
        ) as m:
            result = await _tool_fn(server, "get_formula")(formula_id="f-1")
        m.assert_awaited_once_with("f-1")
        assert result["deleted"] is True

    @pytest.mark.asyncio
    async def test_list_formulas_tool_wraps_list(self):
        server = _make_server()
        with patch.object(client, "list_formulas", AsyncMock(return_value=[{"formulaId": "f-1"}])):
            result = await _tool_fn(server, "list_formulas")(author_filter="u1")
        assert result == {"formulas": [{"formulaId": "f-1"}]}


class TestManageSignalSourceVerbsTool:
    @pytest.mark.asyncio
    async def test_update_derives_mask_from_supplied_fields(self):
        server = _make_server()
        with patch.object(client, "manage_signal_source", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_signal_source")(
                ctx=_ctx(ADMIN), operation="update", slug="uw", display_name="New Name"
            )
        assert m.call_args.kwargs["update_mask"] == ["display_name"]

    @pytest.mark.asyncio
    async def test_update_credentials_ref_joins_mask(self):
        server = _make_server()
        with patch.object(client, "manage_signal_source", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_signal_source")(
                ctx=_ctx(ADMIN), operation="update", slug="uw", credentials_ref="secret.new"
            )
        assert "credentials_ref" in m.call_args.kwargs["update_mask"]

    @pytest.mark.asyncio
    async def test_update_with_no_fields_raises(self):
        server = _make_server()
        with pytest.raises(RuntimeError, match="at least one field"):
            await _tool_fn(server, "manage_signal_source")(
                ctx=_ctx(ADMIN), operation="update", slug="uw"
            )

    @pytest.mark.asyncio
    async def test_reactivate_forwards_operation(self):
        server = _make_server()
        with patch.object(client, "manage_signal_source", AsyncMock(return_value={})) as m:
            await _tool_fn(server, "manage_signal_source")(
                ctx=_ctx(ADMIN), operation="reactivate", slug="uw"
            )
        assert m.call_args.kwargs["operation"] == "reactivate"
        assert m.call_args.kwargs["update_mask"] is None
