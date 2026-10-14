"""Feature 225 (FR-1) — every owner-scoped AnalysisService RPC runs the inbound identity gate first:
headerless → UNAUTHENTICATED, an ungranted ``system`` → PERMISSION_DENIED, body never entered."""

from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2

from app.handlers.servicer import AnalysisServicer
from tests.conftest import ctx_with
from tests.test_analysis_servicer import make_servicer

EXEMPT = {"RunFundamentalsScan"}
_SERVICE = analysis_pb2.DESCRIPTOR.services_by_name["AnalysisService"]
_METHODS = _SERVICE.methods
_GATED = sorted(m.name for m in _METHODS if m.name not in EXEMPT)
_HEADERLESS = [("x-trace-id", "t")]
_SYSTEM = [("x-user-id", "system")]


def test_descriptor_walk_gated_set_equals_non_exempt():
    undecorated = {
        m.name
        for m in _METHODS
        if not getattr(getattr(AnalysisServicer, m.name), "__owner_scoped__", False)
    }
    assert undecorated == EXEMPT


def _non_raising_ctx(headers):
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers))
    ctx.abort = AsyncMock()
    return ctx


@pytest.mark.parametrize("method", _GATED)
@pytest.mark.parametrize(
    "headers,code",
    [
        (_HEADERLESS, grpc.StatusCode.UNAUTHENTICATED),
        (_SYSTEM, grpc.StatusCode.PERMISSION_DENIED),
    ],
    ids=["headerless", "system"],
)
async def test_gate_rejects_before_body(method, headers, code):
    # A bare instance: any attribute the body touches raises, so entering the body fails the test.
    svc = AnalysisServicer.__new__(AnalysisServicer)
    request = getattr(analysis_pb2, _SERVICE.methods_by_name[method].input_type.name)()
    ctx = _non_raising_ctx(headers)
    assert await getattr(svc, method)(request, ctx) is None
    ctx.abort.assert_awaited_once()
    assert ctx.abort.await_args.args[0] == code


async def _abort_code(rpc, request, headers):
    ctx = ctx_with(headers)
    with pytest.raises(Exception, match="aborted"):
        await rpc(request, ctx)
    return ctx.abort.await_args.args[0]


async def test_ac8_headerless_list_strategies_unauthenticated():
    svc = make_servicer()
    code = await _abort_code(svc.ListStrategies, analysis_pb2.ListStrategiesRequest(), _HEADERLESS)
    assert code == grpc.StatusCode.UNAUTHENTICATED


async def test_ac16_ungranted_system_permission_denied():
    svc = make_servicer()
    code = await _abort_code(svc.ListStrategies, analysis_pb2.ListStrategiesRequest(), _SYSTEM)
    assert code == grpc.StatusCode.PERMISSION_DENIED


async def test_set_opportunity_action_headerless_unauthenticated():
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(opportunity_key="u-1|AAPL|s")
    code = await _abort_code(svc.SetOpportunityAction, req, _HEADERLESS)
    assert code == grpc.StatusCode.UNAUTHENTICATED
