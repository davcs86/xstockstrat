"""Feature 327 — formula digests ride the existing single ``GetFormula`` read (no extra RPC)."""

import json
from unittest.mock import AsyncMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import _UNREADABLE, _formula_digest, _FormulaRead
from app.services.fundamentals_guard import Availability
from tests.test_analysis_servicer import make_servicer

_META = [("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]


def _formula(fid="f-9", *, source="close * 2", author="alice", fundamental_inputs=()):
    return indicators_pb2.FormulaDefinition(
        formula_id=fid,
        name=fid,
        source=source,
        author=author,
        warmup_period=5,
        fundamental_inputs=list(fundamental_inputs),
    )


def _component(ref, fid):
    return analysis_pb2.StrategyComponent(
        ref_name=ref, kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id=fid
    )


def _definition(*components):
    comps = components or (_component("f", "f-9"),)
    rule = {"fn": "greater_than", "lhs": comps[0].ref_name, "rhs": 0}
    return analysis_pb2.StrategyDefinition(
        strategy_id="s-1", components=list(comps), entry_rule=json.dumps(rule)
    )


def _rpc_error(code):
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "down")


def _svc(get_formula):
    svc = make_servicer()
    svc._indicators.GetFormula = get_formula
    return svc


async def test_readable_formula_digest_and_cache():
    formula = _formula()
    svc = _svc(AsyncMock(return_value=formula))
    digests, cache = {}, {}
    out = await svc._formula_fundamentals(_definition(), _META, cache=cache, digests=digests)
    assert out == {}
    assert digests == {"f-9": _formula_digest(formula)}
    assert isinstance(cache["f-9"], _FormulaRead)
    assert cache["f-9"].digest == _formula_digest(formula)
    again = {}
    await svc._formula_fundamentals(_definition(), _META, cache=cache, digests=again)
    assert svc._indicators.GetFormula.await_count == 1
    assert again == digests


@pytest.mark.parametrize("code", [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED])
async def test_refused_formula_digest_is_unreadable(code):
    svc = _svc(AsyncMock(side_effect=_rpc_error(code)))
    digests, cache, failures = {}, {}, {}
    await svc._formula_fundamentals(
        _definition(), _META, cache=cache, failures=failures, digests=digests
    )
    assert digests["f-9"] is _UNREADABLE
    assert cache["f-9"] == _FormulaRead([], _UNREADABLE)
    assert failures == {}


async def test_outage_digest_is_none_and_records_unknown():
    svc = _svc(AsyncMock(side_effect=_rpc_error(grpc.StatusCode.UNAVAILABLE)))
    digests, failures = {}, {}
    await svc._formula_fundamentals(_definition(), _META, failures=failures, digests=digests)
    assert digests == {"f-9": None}
    assert failures[("formula", "f-9")] is Availability.UNKNOWN


async def test_prefetch_digests_every_formula_component_with_one_read_each():
    by_id = {"f-9": _formula("f-9"), "f-10": _formula("f-10", source="open")}
    svc = _svc(AsyncMock(side_effect=lambda req, metadata=None: by_id[req.formula_id]))
    definition = _definition(
        _component("f", "f-9"), _component("g", "f-10"), _component("h", "f-9")
    )
    digests, cache = {}, {}
    await svc._prefetch_formula_warmups(
        definition, cache, _META, fund_map={}, failures={}, digests=digests
    )
    assert svc._indicators.GetFormula.await_count == 2
    assert digests == {fid: _formula_digest(f) for fid, f in by_id.items()}
    before = dict(digests)
    await svc._declared_formula_warmup("f-9", cache, _META, digests=digests)
    assert svc._indicators.GetFormula.await_count == 2
    assert digests == before


@pytest.mark.parametrize("code", [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.UNAVAILABLE])
async def test_warmup_read_records_refusal_and_outage_digests(code):
    svc = _svc(AsyncMock(side_effect=_rpc_error(code)))
    digests = {}
    await svc._declared_formula_warmup("f-9", {}, _META, digests=digests)
    want = _UNREADABLE if code == grpc.StatusCode.NOT_FOUND else None
    assert digests["f-9"] is want


@pytest.mark.parametrize(
    "other,same", [(_formula(source="close * 3"), False), (_formula(author="bob"), True)]
)
async def test_ac1_source_edit_moves_digest_through_the_read(other, same):
    first, second = {}, {}
    await _svc(AsyncMock(return_value=_formula()))._formula_fundamentals(
        _definition(), _META, digests=first
    )
    await _svc(AsyncMock(return_value=other))._formula_fundamentals(
        _definition(), _META, digests=second
    )
    assert (first["f-9"] == second["f-9"]) is same


async def test_without_digests_the_fundamentals_map_is_unchanged():
    formula = _formula(fundamental_inputs=[1, 2])
    svc = _svc(AsyncMock(return_value=formula))
    assert await svc._formula_fundamentals(_definition(), _META) == {"f-9": [1, 2]}
