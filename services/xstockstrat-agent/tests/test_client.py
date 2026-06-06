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
            result = await client.emit_alert(
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
    async def test_uses_analysis_endpoint_and_admin_metadata(self):
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
                    api_key="key-1",
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        meta = mock_stub.ManageStrategy.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert ("authorization", "Bearer key-1") in meta
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
                    api_key="k",
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INDICATORS_ENDPOINT
        assert result == {"formula_id": "f-9"}


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
                    api_key="k",
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INGEST_ENDPOINT
        assert "credentials_ref" not in result  # FR-12
        assert result["slug"] == "uw"
