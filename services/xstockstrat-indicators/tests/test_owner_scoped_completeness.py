"""Feature 225 (FR-1) — every owner-scoped IndicatorsService RPC runs the identity gate first:
headerless → UNAUTHENTICATED, a `system` caller without the SAN-bound grant → PERMISSION_DENIED."""

from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.indicators.v1 import indicators_pb2

from app.formulas import SYSTEM_AUTHOR
from app.handlers.servicer import IndicatorsServicer
from tests.conftest import ctx_with

EXEMPT = {"ComputeIndicator", "ListIndicators", "ListFundamentalMetrics"}
_SERVICE = indicators_pb2.DESCRIPTOR.services_by_name["IndicatorsService"]
_METHODS = _SERVICE.methods
_GATED = sorted(m.name for m in _METHODS if m.name not in EXEMPT)
_ANALYSIS_SAN = ("xstockstrat-analysis",)
_HEADERLESS = [("x-trace-id", "t")]
_SYSTEM = [("x-user-id", SYSTEM_AUTHOR)]
_SYSTEM_GRANT = [*_SYSTEM, ("x-internal-caller", "analysis-fundsignal")]


def test_descriptor_walk_gated_set_equals_non_exempt():
    undecorated = {
        m.name
        for m in _METHODS
        if not getattr(getattr(IndicatorsServicer, m.name), "__owner_scoped__", False)
    }
    assert undecorated == EXEMPT


def _non_raising_ctx(headers, peer_sans=()):
    ctx = ctx_with(headers, peer_sans)
    ctx.abort = AsyncMock()
    return ctx


@pytest.mark.parametrize("method", _GATED)
@pytest.mark.parametrize(
    "headers,code",
    [
        (_HEADERLESS, grpc.StatusCode.UNAUTHENTICATED),
        (_SYSTEM, grpc.StatusCode.PERMISSION_DENIED),
        (_SYSTEM_GRANT, grpc.StatusCode.PERMISSION_DENIED),
    ],
    ids=["headerless", "system", "system-grant-without-san"],
)
async def test_gate_rejects_before_body(method, headers, code):
    # A bare instance: any attribute the body touches raises, so entering the body fails the test.
    svc = IndicatorsServicer.__new__(IndicatorsServicer)
    request = getattr(indicators_pb2, _SERVICE.methods_by_name[method].input_type.name)()
    ctx = _non_raising_ctx(headers)
    assert await getattr(svc, method)(request, ctx) is None
    ctx.abort.assert_awaited_once()
    assert ctx.abort.await_args.args[0] == code


async def test_granted_system_with_san_passes_gate():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    svc = IndicatorsServicer(config_watcher=cfg)
    svc._formulas["sys-1"] = indicators_pb2.FormulaDefinition(
        formula_id="sys-1", source="result = close", author=SYSTEM_AUTHOR
    )
    ctx = _non_raising_ctx(_SYSTEM_GRANT, _ANALYSIS_SAN)
    resp = await svc.GetFormula(indicators_pb2.GetFormulaRequest(formula_id="sys-1"), ctx)
    ctx.abort.assert_not_awaited()
    assert resp.formula_id == "sys-1"


async def test_ac1_headerless_list_formulas_unauthenticated():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    svc = IndicatorsServicer(config_watcher=cfg)
    svc._repo = AsyncMock()
    svc._repo.list_visible.return_value = ([{"author": SYSTEM_AUTHOR}], 1)
    ctx = ctx_with(_HEADERLESS)
    with pytest.raises(grpc.RpcError):
        await svc.ListFormulas(indicators_pb2.ListFormulasRequest(), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAUTHENTICATED
    svc._repo.list_visible.assert_not_awaited()
    svc._repo.list_owned.assert_not_awaited()
