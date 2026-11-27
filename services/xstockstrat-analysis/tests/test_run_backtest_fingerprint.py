"""Feature 327 — RunBacktest stamps the formula-aware evidence fingerprint (AC-1).

A registered own run of a CUSTOM_FORMULA strategy stamps ``_evidence_fingerprint`` over the run's
single formula read; an outage or a refusal stamps ``None`` (only an outage warns), and the run
seeds the headline recompute with its own ``_FormulaRead`` values so a run reads each formula once.
"""

import json
import logging
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import (
    _FORMULA_VERSION_WARNING,
    _UNREADABLE,
    _evidence_fingerprint,
    _formula_digest,
    _FormulaRead,
    _FormulaVersionUnknown,
)
from tests.test_analysis_servicer import _owned_ctx, _row_for, _windowed_req, make_servicer

_GATE = "backtest.fundamentals.enabled"
_F9 = indicators_pb2.FormulaDefinition(
    formula_id="f-9", name="F9", source="return close", author="alice"
)
_PATHS = pytest.mark.parametrize("prefixed", [True, False], ids=["prefixed", "unprefixed"])


def _cf_def(*formula_ids):
    """A CUSTOM_FORMULA strategy with one component per entry of ``formula_ids``."""
    refs = [f"c{i}" for i in range(len(formula_ids))]
    return analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name=ref, kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id=fid
            )
            for ref, fid in zip(refs, formula_ids, strict=True)
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": refs[0], "rhs": 0}),
    )


def _registered_req(definition, *, prefixed, strategy_id="s1"):
    if prefixed:
        req = _windowed_req(definition)
        req.ClearField("inline_definition")
        req.strategy_id = strategy_id
    else:
        req = analysis_pb2.RunBacktestRequest(
            strategy_id=strategy_id, symbols=["AAPL"], initial_capital=100_000.0
        )
    req.strategy_id_ref = "s1"
    return req


def _formulas(**by_id):
    """A GetFormula side effect: each formula id maps to a FormulaDefinition or a status code."""

    def _get(req, **kw):
        found = by_id[req.formula_id]
        if isinstance(found, grpc.StatusCode):
            raise grpc.aio.AioRpcError(found, grpc.aio.Metadata(), grpc.aio.Metadata(), "read")
        return found

    return _get


def _svc(definition, get_formula, *, gate=False):
    svc = make_servicer()
    svc._cfg.get_bool = MagicMock(side_effect=lambda k, d=False: gate if k == _GATE else d)
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
    svc._indicators = MagicMock()
    svc._indicators.GetFormula = AsyncMock(side_effect=get_formula)
    diag = analysis_pb2.SymbolDiagnostics()
    curve = [100_000.0, 100_100.0, 100_200.0]
    svc._backtest_symbol_evaluated = AsyncMock(
        side_effect=lambda symbol=None, **kw: ([], 100_000.0, curve, diag, [])
    )
    return svc


def _stamped(svc):
    cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
    stamps = {c["definition_fingerprint"] for c in cells}
    assert cells and len(stamps) == 1
    return stamps.pop()


async def _run(svc, req):
    return await svc.RunBacktest(req, context=_owned_ctx())


@_PATHS
@pytest.mark.asyncio
async def test_ac1_registered_run_stamps_formula_aware_fingerprint(prefixed):
    definition = _cf_def("f-9")
    definition_json = _row_for(definition)["definition_json"]
    edited_source = indicators_pb2.FormulaDefinition()
    edited_source.CopyFrom(_F9)
    edited_source.source = "return open"
    edited_author = indicators_pb2.FormulaDefinition()
    edited_author.CopyFrom(_F9)
    edited_author.author = "bob"
    stamps = {}
    for label, formula in (("base", _F9), ("source", edited_source), ("author", edited_author)):
        svc = _svc(definition, _formulas(**{"f-9": formula}))
        await _run(svc, _registered_req(definition, prefixed=prefixed))
        stamps[label] = _stamped(svc)
    assert stamps["base"] == _evidence_fingerprint(definition_json, {"f-9": _formula_digest(_F9)})
    assert stamps["source"] != stamps["base"]
    assert stamps["author"] == stamps["base"]


@_PATHS
@pytest.mark.asyncio
async def test_outage_stamps_none_and_warns_once(prefixed):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": grpc.StatusCode.UNAVAILABLE}))
    result = await _run(svc, _registered_req(definition, prefixed=prefixed))
    insert = svc._backtest_run_symbols_repo.insert_many.await_args
    cells = insert.args[0] if insert else []
    assert all(c["definition_fingerprint"] is None for c in cells)
    assert list(result.warnings).count(_FORMULA_VERSION_WARNING) == 1


@_PATHS
@pytest.mark.asyncio
async def test_refusal_stamps_none_without_the_warning(prefixed):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": grpc.StatusCode.NOT_FOUND}))
    result = await _run(svc, _registered_req(definition, prefixed=prefixed))
    assert _stamped(svc) is None
    assert _FORMULA_VERSION_WARNING not in result.warnings


@pytest.mark.parametrize("shape", ["inline", "id_mismatch"])
@pytest.mark.asyncio
async def test_a_run_that_records_no_evidence_carries_no_outage_warning(shape):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": grpc.StatusCode.UNAVAILABLE}))
    if shape == "inline":
        req = _windowed_req(definition)
    else:
        req = _registered_req(definition, prefixed=True, strategy_id="other")
    result = await _run(svc, req)
    assert _FORMULA_VERSION_WARNING not in result.warnings


@_PATHS
@pytest.mark.asyncio
async def test_recompute_is_seeded_with_the_runs_own_read(prefixed):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": _F9}))
    svc._recompute_headline = AsyncMock(return_value=None)
    await _run(svc, _registered_req(definition, prefixed=prefixed))
    seed = svc._recompute_headline.await_args.kwargs["formula_cache"]
    assert seed == {"f-9": _FormulaRead([], _formula_digest(_F9))}
    definition_json = _row_for(definition)["definition_json"]
    assert _stamped(svc) == _evidence_fingerprint(definition_json, {"f-9": seed["f-9"].digest})


@_PATHS
@pytest.mark.asyncio
async def test_recompute_seed_holds_refused_but_not_outage_formulas(prefixed):
    definition = _cf_def("f-9", "f-7", "f-5")
    reads = {"f-9": _F9, "f-7": grpc.StatusCode.NOT_FOUND, "f-5": grpc.StatusCode.UNAVAILABLE}
    svc = _svc(definition, _formulas(**reads))
    svc._recompute_headline = AsyncMock(return_value=None)
    await _run(svc, _registered_req(definition, prefixed=prefixed))
    seed = svc._recompute_headline.await_args.kwargs["formula_cache"]
    assert seed == {
        "f-9": _FormulaRead([], _formula_digest(_F9)),
        "f-7": _FormulaRead([], _UNREADABLE),
    }


@_PATHS
@pytest.mark.asyncio
async def test_one_formula_read_for_the_whole_run_with_the_real_recompute(prefixed):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": _F9}), gate=True)
    done = datetime(2025, 2, 1, tzinfo=UTC)
    cell = {
        "symbol": "AAPL",
        "sharpe_ratio": 2.0,
        "max_drawdown": 0.0,
        "win_rate": 1.0,
        "total_return": 0.12,
        "total_trades": 3,
        "trading_days": 100,
        "range_start": datetime(2024, 1, 1, tzinfo=UTC),
        "range_end": done,
        "completed_at": done,
    }
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint = AsyncMock(return_value=[cell])
    await _run(svc, _registered_req(definition, prefixed=prefixed))
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint.assert_awaited()
    assert svc._indicators.GetFormula.await_count == 1


@_PATHS
@pytest.mark.asyncio
async def test_duplicate_components_on_one_formula_stamp_one_digest(prefixed):
    definition = _cf_def("f-9", "f-9")
    svc = _svc(definition, _formulas(**{"f-9": _F9}))
    svc._recompute_headline = AsyncMock(return_value=None)
    await _run(svc, _registered_req(definition, prefixed=prefixed))
    definition_json = _row_for(definition)["definition_json"]
    assert _stamped(svc) == _evidence_fingerprint(definition_json, {"f-9": _formula_digest(_F9)})
    if prefixed:
        assert svc._indicators.GetFormula.await_count == 1


@pytest.mark.asyncio
async def test_formula_version_unknown_keeps_the_run_ok_and_logs(caplog):
    definition = _cf_def("f-9")
    svc = _svc(definition, _formulas(**{"f-9": _F9}))
    svc._recompute_headline = AsyncMock(side_effect=_FormulaVersionUnknown("f-9"))
    with caplog.at_level(logging.WARNING):
        result = await _run(svc, _registered_req(definition, prefixed=True))
    assert result.status == analysis_pb2.BACKTEST_STATUS_OK
    messages = [r.getMessage() for r in caplog.records]
    assert any("formula version unavailable — grade unchanged" in m for m in messages)
    assert not any("fundamentals availability unknown" in m for m in messages)
