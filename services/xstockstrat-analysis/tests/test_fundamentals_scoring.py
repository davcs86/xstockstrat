"""Tests for the fundamentals-scoring consumer helper (feature 063)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.protobuf.struct_pb2 import Struct

from app.services.fundamentals_scoring import FundamentalsScoringError, score_fundamentals


def _resp(success=True, scores=None, error=""):
    output = Struct()
    if scores:
        output.update(scores)
    return SimpleNamespace(success=success, output=output, error=error, exit_reason=0)


async def test_parses_subscores_and_forwards_metadata():
    resp = _resp(scores={"value": 0.8, "quality": 0.6, "composite": 0.7})
    stub = AsyncMock()
    stub.ExecuteFormula = AsyncMock(return_value=resp)

    meta = [("x-trace-id", "t1"), ("x-user-id", "u1")]
    out = await score_fundamentals(
        stub,
        formula_id="f-123",
        fundamentals={"pe_ratio": 9, "roe": 0.28},
        metadata=meta,
        params={"value_weight": 0.6},
    )

    assert out == {"value": 0.8, "quality": 0.6, "composite": 0.7}
    # Propagation metadata forwarded verbatim.
    assert stub.ExecuteFormula.await_args.kwargs["metadata"] == meta
    # data/params split: fundamentals in input_data, tunables in input_params.
    req = stub.ExecuteFormula.await_args.args[0]
    assert "pe_ratio" in dict(req.input_data)
    assert dict(req.input_params)["value_weight"] == 0.6
    assert req.formula_id == "f-123"


async def test_missing_subscores_default_to_zero():
    resp = _resp(scores={"value": 0.5})  # quality/composite absent
    stub = AsyncMock()
    stub.ExecuteFormula = AsyncMock(return_value=resp)
    out = await score_fundamentals(stub, "f", {"pe_ratio": 10}, metadata=[])
    assert out == {"value": 0.5, "quality": 0.0, "composite": 0.0}


async def test_failed_run_raises():
    resp = _resp(success=False, error="boom")
    stub = AsyncMock()
    stub.ExecuteFormula = AsyncMock(return_value=resp)
    with pytest.raises(FundamentalsScoringError):
        await score_fundamentals(stub, "f", {"pe_ratio": 10}, metadata=[])
