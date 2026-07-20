"""Tests for app/client.py — gRPC client helpers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client


def test_metadata_includes_mcp_secret():
    """When MCP_AGENT_SECRET is set, _metadata returns x-mcp-secret tuple."""
    assert ("x-mcp-secret", "test-secret") in client._metadata()


def test_metadata_empty_when_no_secret(monkeypatch):
    """When MCP_AGENT_SECRET is empty, _metadata returns empty list."""
    monkeypatch.setattr(client, "MCP_AGENT_SECRET", "")
    assert client._metadata() == []


def test_iso_to_timestamp_utc():
    """ISO Z string converts to Timestamp with correct seconds."""
    ts = client._iso_to_timestamp("2026-05-01T00:00:00Z")
    assert ts.seconds == 1777593600


def test_iso_to_timestamp_offset():
    """ISO string with offset converts correctly."""
    ts = client._iso_to_timestamp("2026-05-01T01:00:00+01:00")
    assert ts.seconds == 1777593600


def test_severity_map_coverage():
    """All expected severity levels are mapped to non-zero ints."""
    for level in ("info", "warning", "error", "critical"):
        assert client._SEVERITY_MAP[level] > 0


@pytest.mark.asyncio
async def test_emit_alert_sends_grpc_call():
    """emit_alert calls EmitAlert on the NotifyService stub."""
    mock_resp = MagicMock()
    mock_resp.alert_id = "alert-123"

    mock_stub = MagicMock()
    mock_stub.EmitAlert = AsyncMock(return_value=mock_resp)

    channel_cm = MagicMock()
    channel_cm.__aenter__ = AsyncMock(return_value=MagicMock())
    channel_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = channel_cm

        from gen.notify.v1 import notify_pb2_grpc  # type: ignore

        with patch.object(notify_pb2_grpc, "NotifyServiceStub", return_value=mock_stub):
            await client.emit_alert(
                severity="info",
                category="signal",
                title="Test Alert",
                body="Test body",
            )

    assert mock_stub.EmitAlert.called


# ── management client helpers (feature 047) ────────────────────────────────


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


class TestManageStrategyClient:
    @pytest.mark.asyncio
    async def test_uses_analysis_endpoint_and_admin_scope(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.StrategyDefinition(strategy_id="x", display_name="X")
        mock_stub = MagicMock()
        mock_stub.ManageStrategy = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.manage_strategy(
                    operation="register",
                    definition={
                        "strategy_id": "x",
                        "display_name": "X",
                        "components": [],
                        "entry_rule": "",
                        "exit_rule": "",
                    },
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        meta = mock_stub.ManageStrategy.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert ("x-access-scope", "7") in meta
        assert not any(k == "authorization" for k, _ in meta)
        assert result["strategyId"] == "x"

    @pytest.mark.asyncio
    async def test_unknown_operation_raises(self):
        with pytest.raises(ValueError):
            await client.manage_strategy(operation="bogus", definition={})


class TestManageFormulaClient:
    @pytest.mark.asyncio
    async def test_register_uses_indicators_endpoint(self):
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        resp = indicators_pb2.RegisterFormulaResponse(formula_id="f-9")
        mock_stub = MagicMock()
        mock_stub.RegisterFormula = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                result = await client.manage_formula(
                    operation="register",
                    formula={"name": "rsi2", "source": "x=1"},
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INDICATORS_ENDPOINT
        assert result == {"formula_id": "f-9"}


# ── screen_symbols client (feature 061) ────────────────────────────────────


class TestScreenSymbolsClient:
    @pytest.mark.asyncio
    async def test_screen_symbols_sends_grpc_call(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.ScreenSymbolsResponse(
            results=[
                analysis_pb2.ScreenResult(
                    symbol="NVDA",
                    score=0.91,
                    criterion_scores={"pe": 1.0},
                    passed=True,
                    status=analysis_pb2.SCREEN_RESULT_STATUS_OK,
                )
            ],
            coverage_gaps=[analysis_pb2.CoverageGap(symbol="TSLA")],
        )
        mock_stub = MagicMock()
        mock_stub.ScreenSymbols = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.screen_symbols(
                    symbols=["NVDA"],
                    criteria=[
                        {
                            "ref_name": "pe",
                            "kind": "SCREEN_KIND_FUNDAMENTAL",
                            "metric_name": "pe_ratio",
                            "op": "COMPARATOR_LTE",
                            "threshold": 25.0,
                            "hard_filter": True,
                        }
                    ],
                )
        # Channel opened against the (test-patched) analysis endpoint symbol.
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        # Read-only: carries x-mcp-secret, never an admin x-access-scope.
        meta = mock_stub.ScreenSymbols.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert not any(k == "x-access-scope" for k, _ in meta)
        # Response is shaped into a JSON-serializable dict.
        assert result["results"][0] == {
            "symbol": "NVDA",
            "score": pytest.approx(0.91),
            "criterion_scores": {"pe": 1.0},
            "passed": True,
            "status": "SCREEN_RESULT_STATUS_OK",
        }
        assert result["coverage_gaps"] == [{"symbol": "TSLA"}]
        # Enum-name criterion mapping reached the request unmodified.
        sent_req = mock_stub.ScreenSymbols.call_args[0][0]
        assert sent_req.criteria[0].kind == analysis_pb2.SCREEN_KIND_FUNDAMENTAL
        assert sent_req.criteria[0].op == analysis_pb2.COMPARATOR_LTE
        assert sent_req.criteria[0].hard_filter is True

    @pytest.mark.asyncio
    async def test_register_maps_parameter_definitions(self):
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        resp = indicators_pb2.RegisterFormulaResponse(formula_id="f-10")
        mock_stub = MagicMock()
        mock_stub.RegisterFormula = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                await client.manage_formula(
                    operation="register",
                    formula={
                        "name": "rsi3",
                        "source": "result = params['period']",
                        "parameters": [
                            {
                                "name": "period",
                                "type": "int",
                                "default": 14,
                                "required": True,
                                "min": 1,
                                "max": 200,
                            }
                        ],
                    },
                )
        req = mock_stub.RegisterFormula.call_args.args[0]
        assert len(req.parameters) == 1
        p = req.parameters[0]
        assert p.name == "period"
        assert p.type == indicators_pb2.PARAMETER_TYPE_INT
        assert p.required is True
        assert p.default_value.number_value == 14
        assert p.min == 1
        assert p.max == 200


class TestManageSignalSourceClient:
    @pytest.mark.asyncio
    async def test_uses_ingest_endpoint_and_omits_credentials_ref(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        resp = ingest_pb2.ManageSignalSourceResponse(
            source=ingest_pb2.SignalSource(slug="uw", display_name="UW")
        )
        mock_stub = MagicMock()
        mock_stub.ManageSignalSource = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                result = await client.manage_signal_source(
                    operation="register",
                    source={"slug": "uw", "display_name": "UW"},
                    credentials_ref="secret",
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INGEST_ENDPOINT
        assert "credentials_ref" not in result  # FR-12
        assert result["slug"] == "uw"


class TestSetStrategyLiveClient:
    @pytest.mark.asyncio
    async def test_uses_analysis_endpoint_and_admin_scope(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.SetStrategyLiveResponse(
            definition=analysis_pb2.StrategyDefinition(
                strategy_id="s1", display_name="S1", live_enabled=True
            )
        )
        mock_stub = MagicMock()
        mock_stub.SetStrategyLive = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.set_strategy_live(strategy_id="s1", live_enabled=True)
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        meta = mock_stub.SetStrategyLive.call_args.kwargs["metadata"]
        assert ("x-access-scope", "7") in meta
        assert not any(k == "authorization" for k, _ in meta)
        assert result["live_enabled"] is True
