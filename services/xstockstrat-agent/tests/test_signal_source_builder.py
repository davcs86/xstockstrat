"""Descriptor-parity + verb tests for the manage_signal_source request builder (feature 088).

Mirrors test_backtest_view / test_formula_builders — the RC-1 antidote: a hand-written dict→proto
builder that drops a new proto field must fail a test, not ship.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client

# ManageSignalSourceRequest: the builder sets source(1), credentials_ref(2), update_mask(4),
# operation_enum(5). The deprecated string `operation`(3) is intentionally NOT set — it is
# superseded by operation_enum (feature 088). Any other new field must be carried or justified here.
_INTENTIONALLY_UNSET = {"operation"}

# SignalSource sub-message (feature 161): the builder is a WRITE path, so it sets only the
# client-writable fields. These are server-set/read-only and are never sent on a write — each
# justified individually:
#   has_credentials — derived by the backend from the stored credential ref
#   health          — derived from last_seen_at freshness (feature 083)
#   last_seen_at    — stamped by the backend on ingest
#   last_error      — recorded by the backend on a failed op
#   signals_fed     — a backend counter
# Any OTHER new SignalSource field must be carried by the builder or added here with a reason —
# this is the parity gap that let feature-134 reliability_weight ship dropped on the write path.
_INTENTIONALLY_UNSET_SOURCE = {
    "has_credentials",
    "health",
    "last_seen_at",
    "last_error",
    "signals_fed",
}


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


async def _capture_request(**kw):
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ManageSignalSource = AsyncMock(
        return_value=ingest_pb2.ManageSignalSourceResponse(
            source=ingest_pb2.SignalSource(slug="uw")
        )
    )
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
            await client.manage_signal_source(**kw)
    return mock_stub.ManageSignalSource.call_args[0][0]


class TestManageSignalSourceBuilderParity:
    @pytest.mark.asyncio
    async def test_builder_covers_every_proto_field(self):
        from gen.ingest.v1 import ingest_pb2  # type: ignore

        req = await _capture_request(
            operation="update",
            source={
                "slug": "uw",
                "display_name": "UW",
                "source_type": "simple_website",
                "extractor_module": "app.extractors.web",
                "config_json": {"url": "https://x.com", "scrape_selector": ".a"},
            },
            credentials_ref="secret.x",
            update_mask=["display_name"],
        )
        set_fields = {f.name for f, _ in req.ListFields()}
        assert set_fields | _INTENTIONALLY_UNSET == set(
            ingest_pb2.ManageSignalSourceRequest.DESCRIPTOR.fields_by_name
        )

    @pytest.mark.asyncio
    async def test_builder_covers_every_signal_source_subfield(self):
        # feature 161 (AC-9): the request-level parity test above does NOT recurse into the
        # `source` sub-message, which is exactly why feature-134 reliability_weight shipped dropped
        # on the write path. Recurse here: every client-writable SignalSource field must be set.
        from gen.ingest.v1 import ingest_pb2  # type: ignore

        req = await _capture_request(
            operation="update",
            source={
                "slug": "uw",
                "display_name": "UW",
                "source_type": "simple_website",
                "extractor_module": "app.extractors.web",
                "config_json": {"url": "https://x.com", "scrape_selector": ".a"},
                "reliability_weight": 0.5,
            },
            update_mask=["reliability_weight"],
        )
        source_fields = {f.name for f, _ in req.source.ListFields()}
        assert source_fields | _INTENTIONALLY_UNSET_SOURCE == set(
            ingest_pb2.SignalSource.DESCRIPTOR.fields_by_name
        )


class TestManageSignalSourceVerbs:
    @pytest.mark.asyncio
    async def test_register_maps_to_enum(self):
        from gen.ingest.v1 import ingest_pb2  # type: ignore

        req = await _capture_request(operation="register", source={"slug": "uw"})
        assert req.operation_enum == ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER

    @pytest.mark.asyncio
    async def test_update_sets_field_mask_and_enum(self):
        from gen.ingest.v1 import ingest_pb2  # type: ignore

        req = await _capture_request(
            operation="update",
            source={"slug": "uw", "display_name": "New"},
            update_mask=["display_name"],
        )
        assert req.operation_enum == ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE
        assert list(req.update_mask.paths) == ["display_name"]

    @pytest.mark.asyncio
    async def test_reactivate_maps_to_enum(self):
        from gen.ingest.v1 import ingest_pb2  # type: ignore

        req = await _capture_request(operation="reactivate", source={"slug": "uw"})
        assert req.operation_enum == ingest_pb2.SIGNAL_SOURCE_OPERATION_REACTIVATE

    @pytest.mark.asyncio
    async def test_empty_credentials_ref_is_sent_to_clear(self):
        # credentials_ref="" + masked "credentials_ref" → the server clears the stored ref.
        req = await _capture_request(
            operation="update",
            source={"slug": "uw"},
            credentials_ref="",
            update_mask=["credentials_ref"],
        )
        assert req.credentials_ref == ""
        assert "credentials_ref" in list(req.update_mask.paths)
