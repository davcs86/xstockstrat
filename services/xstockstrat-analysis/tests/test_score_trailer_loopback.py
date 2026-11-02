# Production wiring (GrpcAioInstrumentorServer + server_interceptors()) is installed on purpose:
# a green run without it does not prove a deployed server delivers the trailer.
"""Feature 283 — ScoreStrategy's excluded-symbols trailer over a real in-process aio server."""

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc
from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer

from app.telemetry import _CancelStatusInterceptor, server_interceptors
from tests.conftest import AAPL_PIT_PERIODS, SCHD_PIT_PERIODS
from tests.test_grade_fundamentals_exclusion import _blend_svc, _cell

_KEY = "x-score-excluded-symbols"
_METHOD = "/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy"
_SID = "fundamentals_macd_blend"
_META = [("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]


@pytest.fixture
def production_wiring(monkeypatch):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    inst = GrpcAioInstrumentorServer()
    inst.instrument()
    try:
        yield
    finally:
        inst.uninstrument()


async def _call(svc):
    interceptors = server_interceptors()
    assert any(isinstance(i, _CancelStatusInterceptor) for i in interceptors)
    server = grpc.aio.server(interceptors=interceptors)
    analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(svc, server)
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            call = channel.unary_unary(
                _METHOD,
                request_serializer=analysis_pb2.ScoreStrategyRequest.SerializeToString,
                response_deserializer=analysis_pb2.StrategyScore.FromString,
            )(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), metadata=_META)
            resp = await call
            return resp, dict(await call.trailing_metadata())
    finally:
        await server.stop(0)


@pytest.mark.asyncio
async def test_populated_trailer_reaches_the_wire(production_wiring):
    svc = _blend_svc(
        [_cell("AAPL", trades=3), _cell("SCHD")],
        pit={"AAPL": AAPL_PIT_PERIODS, "SCHD": SCHD_PIT_PERIODS},
    )
    resp, md = await _call(svc)
    assert resp.evidence_symbols == 1
    assert md.get(_KEY) == '["SCHD"]'


@pytest.mark.asyncio
async def test_empty_trailer_is_present_on_the_wire(production_wiring):
    _, md = await _call(_blend_svc([_cell("AAPL", trades=3)]))
    assert md.get(_KEY) == "[]"


@pytest.mark.asyncio
async def test_aborted_call_carries_no_trailer(production_wiring):
    with pytest.raises(grpc.aio.AioRpcError) as exc:
        await _call(_blend_svc([_cell("SCHD")]))
    assert exc.value.code() == grpc.StatusCode.NOT_FOUND
    assert _KEY not in dict(exc.value.trailing_metadata() or ())
