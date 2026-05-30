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
