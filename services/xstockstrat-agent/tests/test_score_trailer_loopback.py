"""Client half of the ScoreStrategy excluded-symbols trailer over a real gRPC channel (283).

@AC-1, @AC-7, @AC-11: `client.score_strategy` reads `x-score-excluded-symbols` from the trailing
metadata, with and without the production `GrpcAioInstrumentorClient` wrapping the channel.
"""

import logging

import pytest
from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorClient

from app import client

_TRAILER = "x-score-excluded-symbols"


@pytest.fixture(params=[False, True], ids=["plain", "instrumented"])
def instrument_client(request):
    """Install the production client instrumentor (app/telemetry.py); never via otel_reset."""
    instrumented = request.param
    instrumentor = GrpcAioInstrumentorClient()
    if instrumented:
        instrumentor.instrument()
    yield instrumented
    if instrumented:
        instrumentor.uninstrument()


def _score_answers(trailer_value: str | None) -> dict:
    from gen.analysis.v1 import analysis_pb2  # noqa: PLC0415

    score = analysis_pb2.StrategyScore(
        strategy_id="s",
        overall_score=0.7,
        rating="B",
        evidence_symbols=2,
        evidence_days=756,
        provisional=False,
    )
    if trailer_value is None:
        return {"ScoreStrategy": (0, score)}
    return {"ScoreStrategy": (0, score, ((_TRAILER, trailer_value),))}


def _client_warnings(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "app.client" and r.levelno == logging.WARNING]


async def test_populated_trailer_is_projected(hung_backend, instrument_client):
    hung_backend("ANALYSIS_ENDPOINT", answers=_score_answers('["SCHD"]'))

    result = await client.score_strategy("u-1", "s")

    assert result["excluded_symbols"] == ["SCHD"]
    assert result["evidence_symbols"] == 2
    assert isinstance(result["evidence_symbols"], int)
    assert result["evidence_days"] == 756
    assert result["provisional"] is False
    assert result["rating"] == "B"
    assert all(key == key.lower() for key in result)


@pytest.mark.parametrize("instrument_client", [True], ids=["instrumented"], indirect=True)
async def test_empty_trailer_is_empty_list(hung_backend, instrument_client):
    hung_backend("ANALYSIS_ENDPOINT", answers=_score_answers("[]"))

    result = await client.score_strategy("u-1", "s")

    assert result["excluded_symbols"] == []


@pytest.mark.parametrize("instrument_client", [True], ids=["instrumented"], indirect=True)
async def test_absent_trailer_is_null_with_one_warning(hung_backend, instrument_client, caplog):
    hung_backend("ANALYSIS_ENDPOINT", answers=_score_answers(None))

    with caplog.at_level(logging.WARNING, logger="app.client"):
        result = await client.score_strategy("u-1", "s")

    assert result["excluded_symbols"] is None
    assert len(_client_warnings(caplog)) == 1


@pytest.mark.parametrize("instrument_client", [True], ids=["instrumented"], indirect=True)
@pytest.mark.parametrize("raw", ["not json", '"SCHD"', "[1]", '{"a":1}'])
async def test_malformed_trailer_is_null_with_one_warning(
    hung_backend, instrument_client, caplog, raw
):
    hung_backend("ANALYSIS_ENDPOINT", answers=_score_answers(raw))

    with caplog.at_level(logging.WARNING, logger="app.client"):
        result = await client.score_strategy("u-1", "s")

    assert result["excluded_symbols"] is None
    assert len(_client_warnings(caplog)) == 1


def test_trailer_key_literal():
    assert client._EXCLUDED_TRAILER_KEY == "x-score-excluded-symbols"
