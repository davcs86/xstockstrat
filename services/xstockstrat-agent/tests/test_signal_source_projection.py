"""Descriptor-parity test for the list_signal_sources client projection (feature 087).

Mirrors tests/test_backtest_view.py — the C-10 / RC-1 antidote: a hand-written projection that
silently drops a newly-added SignalSource field must fail a test, not ship. We call the client
against a fully-populated mock source, capture the projected keys, and assert they cover every
SignalSource proto field minus an explicitly justified opt-out set.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client

# The one SignalSource field the projection drops on purpose: `extractor_module` is superseded by
# the agent-derived `extractor_tool` (`_EXTRACTOR_TOOL_MAP` in tools.py) — the agent never surfaces
# the raw module name. Every other field (incl. `active` and feature-083 health) is projected.
_INTENTIONALLY_DROPPED = {"extractor_module"}


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_projection_covers_every_signal_source_field():
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

    src = ingest_pb2.SignalSource(
        slug="s",
        display_name="S",
        source_type="mediated_simple_email",
        extractor_module="app.extractors.x",
        active=True,
        has_credentials=False,
        health=1,
        last_error="",
        signals_fed=1,
    )
    src.last_seen_at.GetCurrentTime()
    resp = ingest_pb2.ListSignalSourcesResponse(sources=[src])
    mock_stub = MagicMock()
    mock_stub.ListSignalSources = AsyncMock(return_value=resp)
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
            result = await client.list_signal_sources()

    projected = set(result[0].keys())
    all_fields = set(ingest_pb2.SignalSource.DESCRIPTOR.fields_by_name)
    assert projected | _INTENTIONALLY_DROPPED == all_fields
