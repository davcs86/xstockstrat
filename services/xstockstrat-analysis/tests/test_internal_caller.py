"""indicators gates private-formula reads on x-internal-caller=analysis; every indicators call
analysis makes must carry it alongside the propagated metadata."""

import grpc

from app.internal_caller import InternalCallerInterceptor


async def test_appends_internal_caller_preserving_metadata():
    seen = {}

    async def continuation(details, request):
        seen["metadata"] = list(details.metadata)
        seen["request"] = request
        return "ok"

    details = grpc.aio.ClientCallDetails(
        method="/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula",
        timeout=None,
        metadata=[("x-user-id", "u1")],
        credentials=None,
        wait_for_ready=None,
    )
    out = await InternalCallerInterceptor().intercept_unary_unary(continuation, details, "req")
    assert out == "ok" and seen["request"] == "req"
    assert seen["metadata"] == [("x-user-id", "u1"), ("x-internal-caller", "analysis")]


async def test_handles_absent_metadata():
    seen = {}

    async def continuation(details, request):
        seen["metadata"] = list(details.metadata)

    details = grpc.aio.ClientCallDetails(
        method="/m", timeout=None, metadata=None, credentials=None, wait_for_ready=None
    )
    await InternalCallerInterceptor().intercept_unary_unary(continuation, details, None)
    assert seen["metadata"] == [("x-internal-caller", "analysis")]
