"""Descriptor-parity + partial-update tests for the manage_formula request builders (feature 086).

Mirrors tests/test_backtest_view.py::test_summary_key_set_covers_every_proto_field — the C-10 /
RC-1 antidote: a hand-written dict→proto builder that silently drops a newly-added proto field must
fail a test, not ship. We populate every field with a NON-default value, capture the request the
client actually built, and assert its set-field names (plus an explicitly justified opt-out set)
equal the message's full field set.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client

# RegisterFormulaRequest: the agent intentionally does not author `input_schema` (a legacy advisory
# map, retained but not validated per the indicators service — see its CLAUDE.md). Every other field
# is sent. If a new RegisterFormulaRequest field is added, this test fails until the builder carries
# it or it is justified here.
_REGISTER_INTENTIONALLY_UNSET = {"input_schema"}
# UpdateFormulaRequest: the builder sets every field, including the meta `update_mask`.
# user_id is deprecated on the wire — the caller identity is forwarded as the x-user-id header and
# resolved server-side, so the builder no longer sets the request-body field.
_UPDATE_INTENTIONALLY_UNSET: set[str] = {"user_id"}


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


async def _capture_register_request():
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.RegisterFormula = AsyncMock(
        return_value=indicators_pb2.RegisterFormulaResponse(formula_id="f")
    )
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
            await client.manage_formula(
                operation="register",
                formula={
                    "name": "n",
                    "description": "d",
                    "source": "x=1",
                    "is_public": True,
                    "author": "u",
                    "parameters": [{"name": "p", "type": "int"}],
                    "outputs": [{"name": "o", "description": "series"}],
                    "warmup_period": 5,
                },
            )
    return mock_stub.RegisterFormula.call_args[0][0]


async def _capture_update_request():
    from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.UpdateFormula = AsyncMock(
        return_value=indicators_pb2.UpdateFormulaResponse(
            formula=indicators_pb2.FormulaDefinition(formula_id="f")
        )
    )
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
            await client.manage_formula(
                operation="update",
                formula={
                    "formula_id": "f-1",
                    "user_id": "u",
                    "name": "n",
                    "description": "d",
                    "source": "x=1",
                    "is_public": True,
                    "parameters": [{"name": "p", "type": "int"}],
                    "outputs": [{"name": "o", "description": "series"}],
                    "warmup_period": 5,
                    "update_mask": ["name", "description", "source"],
                },
            )
    return mock_stub.UpdateFormula.call_args[0][0]


class TestFormulaBuilderParity:
    @pytest.mark.asyncio
    async def test_register_builder_covers_every_proto_field(self):
        from gen.indicators.v1 import indicators_pb2  # type: ignore

        req = await _capture_register_request()
        set_fields = {f.name for f, _ in req.ListFields()}
        assert set_fields | _REGISTER_INTENTIONALLY_UNSET == set(
            indicators_pb2.RegisterFormulaRequest.DESCRIPTOR.fields_by_name
        )

    @pytest.mark.asyncio
    async def test_update_builder_covers_every_proto_field(self):
        from gen.indicators.v1 import indicators_pb2  # type: ignore

        req = await _capture_update_request()
        set_fields = {f.name for f, _ in req.ListFields()}
        assert set_fields | _UPDATE_INTENTIONALLY_UNSET == set(
            indicators_pb2.UpdateFormulaRequest.DESCRIPTOR.fields_by_name
        )


class TestFormulaBuilderBehavior:
    @pytest.mark.asyncio
    async def test_register_sends_outputs_and_warmup(self):
        req = await _capture_register_request()
        assert req.warmup_period == 5
        assert [o.name for o in req.outputs] == ["o"]

    @pytest.mark.asyncio
    async def test_update_sets_field_mask(self):
        req = await _capture_update_request()
        assert list(req.update_mask.paths) == ["name", "description", "source"]

    @pytest.mark.asyncio
    async def test_update_without_mask_is_maskless(self):
        # A client caller that omits update_mask keeps the pre-086 full-replace (the UI path).
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.UpdateFormula = AsyncMock(
            return_value=indicators_pb2.UpdateFormulaResponse(
                formula=indicators_pb2.FormulaDefinition(formula_id="f")
            )
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                await client.manage_formula(
                    operation="update",
                    formula={"formula_id": "f-1", "user_id": "u", "name": "n"},
                )
        req = mock_stub.UpdateFormula.call_args[0][0]
        assert not req.HasField("update_mask")

    @pytest.mark.asyncio
    async def test_get_formula_returns_deleted_flag(self):
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", deleted=True)
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                result = await client.get_formula("f-1")
        assert result["deleted"] is True
