"""Feature 224 — a strategy component whose formula its owner cannot read (indicators NOT_FOUND).

Non-backtest surfaces skip the component (all-None series) and warn, never the feature-185
``"unavailable"`` marker; backtest stamps FORMULA_ERROR and excludes the symbol from evidence.
"""

import asyncio
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from google.protobuf import json_format
from google.protobuf.struct_pb2 import Struct

from app.engine.durable_schedule import DurableSchedule
from app.handlers.servicer import _definition_fingerprint
from app.services.evaluator import FormulaExecutionError, StrategyEvaluator, _empty_readiness
from tests.conftest import RecordingStub, aio_rpc_error, ctx_with
from tests.test_analysis_servicer import (
    _EOF_PAGE,
    _FIRING_BARS,
    _GT_100,
    _HEADERS,
    _bar,
    _ctx,
    _FakeReadinessCache,
    _list_opps,
    _materialized_svc,
    _sig,
    _strat_row,
    _unavailable_served_row,
    _wl,
    make_servicer,
)
from tests.test_opportunity_refresh import _mock_pool
from tests.test_owner_header_guard import _BOB, _ingest, _live_loop
from tests.test_readiness_cache import _cache_svc
from tests.test_readiness_materializer import _due_schedule, _materializer_svc, _upserted_rows
from tests.test_readiness_opportunities_source_symbol import _real_bars

_WARNING = "formula f-zscore not readable by owner"


def _not_found():
    return aio_rpc_error(grpc.StatusCode.NOT_FOUND, "formula not found")


def _definition(z_ref="z", formula_id="f-zscore", strategy_id="s-1"):
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name=strategy_id.upper(),
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 2.0},
            ),
            analysis_pb2.StrategyComponent(
                ref_name="z",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id=formula_id,
            ),
        ],
        entry_rule=json.dumps(
            {
                "op": "AND",
                "conditions": [
                    {"fn": ">", "lhs": "sma", "rhs": 100.0},
                    {"fn": ">", "lhs": z_ref, "rhs": 0},
                ],
            }
        ),
        signal_eligible=True,
    )


def _row(definition=None):
    definition = definition or _definition()
    return {
        "strategy_id": definition.strategy_id,
        "user_id": "bob",
        "display_name": definition.display_name,
        "active": True,
        "live_enabled": True,
        "created_at": datetime(2024, 1, 1, tzinfo=UTC),
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _sma_resp(req):
    return SimpleNamespace(result=[SimpleNamespace(value=v, extra={}) for v in req.values])


# ── AC-5: live loop skips + warns, GetStrategy warns ─────────────────────────────────────────────


async def test_ac5_live_loop_skips_unreadable_component_as_owner():
    indicators = RecordingStub(
        {
            "ExecuteFormula": _not_found(),
            "GetFormula": _not_found(),
            "ComputeIndicator": _sma_resp,
        }
    )
    loop = _live_loop(_ingest(), indicators, [_row()])
    seen = []
    real = StrategyEvaluator.evaluate_with_series

    async def _spy(self, *args, **kwargs):
        out = await real(self, *args, **kwargs)
        seen.append((self, out[1]))
        return out

    with patch.object(StrategyEvaluator, "evaluate_with_series", _spy):
        await loop._run_cycle()

    executes = indicators.of("ExecuteFormula")
    assert executes, "the unreadable component was never attempted"
    for _m, _req, meta in executes:
        assert dict(meta).get("x-user-id") == "bob"
        assert "x-internal-caller" not in dict(meta)
    assert seen, "evaluation aborted instead of skipping the unreadable component"
    evaluator, series = seen[-1]
    assert series["z"] and all(v is None for v in series["z"])
    assert evaluator.unreadable_formulas == {"f-zscore"}


async def test_ac5_get_strategy_warns_not_readable():
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row())
    svc._indicators = RecordingStub({"GetFormula": _not_found()})

    resp = await svc.GetStrategy(analysis_pb2.GetStrategyRequest(strategy_id="s-1"), ctx_with(_BOB))

    assert _WARNING in resp.warnings
    assert {dict(m)["x-user-id"] for _n, _r, m in svc._indicators.of("GetFormula")} == {"bob"}


# ── Feature 275 AC-1/AC-7: backtest-path refusal mapping (unit level) ──────────────────────────


_ADMIN_REFUSAL = "admins cannot execute another user's formula"


def _evaluator(error, *, raise_unreadable):
    indicators = MagicMock()
    indicators.ExecuteFormula = AsyncMock(side_effect=error)
    return StrategyEvaluator(indicators, (("x-user-id", "bob"),), raise_unreadable=raise_unreadable)


async def _execute(ev, sink=None):
    return await ev._execute_formula(
        SimpleNamespace(formula_id="f-zscore", ref_name="z"), MagicMock(), unreadable_sink=sink
    )


async def test_backtest_permission_denied_maps_to_formula_error_with_code():
    ev = _evaluator(
        aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, _ADMIN_REFUSAL), raise_unreadable=True
    )
    with pytest.raises(FormulaExecutionError) as excinfo:
        await _execute(ev)
    exc = excinfo.value
    assert exc.code == "PERMISSION_DENIED"
    assert exc.formula_id == "f-zscore"
    assert "admins cannot" not in str(exc)
    assert "admins cannot" not in exc.error


async def test_backtest_not_found_maps_to_formula_error_with_code():
    ev = _evaluator(_not_found(), raise_unreadable=True)
    with pytest.raises(FormulaExecutionError) as excinfo:
        await _execute(ev)
    assert excinfo.value.code == "NOT_FOUND"


def test_contract_error_formula_error_has_no_code():
    assert FormulaExecutionError("f-1", "boom").code == ""


async def test_live_path_permission_denied_still_reraises():
    ev = _evaluator(
        aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, _ADMIN_REFUSAL), raise_unreadable=False
    )
    with pytest.raises(grpc.aio.AioRpcError):
        await _execute(ev)


async def test_live_path_not_found_still_skips():
    ev = _evaluator(_not_found(), raise_unreadable=False)
    assert await _execute(ev) is None
    assert ev.unreadable_formulas == {"f-zscore"}


async def test_backtest_unavailable_still_reraises():
    ev = _evaluator(aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "down"), raise_unreadable=True)
    with pytest.raises(grpc.aio.AioRpcError):
        await _execute(ev)


# ── feature 289: traced-evaluator private sink → 0/0 formula_unreadable marker ──────────────────


_TRACED_BARS = [_bar(86400 * (i + 1), c) for i, c in enumerate(_FIRING_BARS)]
_TIMEOUT = "Formula execution timed out after 5000ms"
_MARKER = {
    "symbol": "MYSZ",
    "conviction": 0.0,
    "passing_conditions": 0,
    "total_conditions": 0,
    "conditions": [],
    "formula_unreadable": True,
}


def _permission_denied():
    return aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, _ADMIN_REFUSAL)


def _traced_evaluator(execute_side_effect, *, component_sem):
    indicators = MagicMock()
    indicators.ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))
    indicators.ExecuteFormula = AsyncMock(side_effect=execute_side_effect)
    return StrategyEvaluator(indicators, (("x-user-id", "bob"),), component_sem=component_sem)


def _definition_two_formulas():
    definition = _definition()
    definition.components.append(
        analysis_pb2.StrategyComponent(
            ref_name="z2", kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id="f-timeout"
        )
    )
    rule = json.loads(definition.entry_rule)
    rule["conditions"].append({"fn": ">", "lhs": "z2", "rhs": 0})
    definition.entry_rule = json.dumps(rule)
    return definition


def _warnings(caplog):
    return [r.getMessage() for r in caplog.records].count(_WARNING)


_SEMS = pytest.mark.parametrize("sem", [None, 2], ids=["serial", "concurrent"])
_REFUSALS = pytest.mark.parametrize(
    "refusal", [_permission_denied, _not_found], ids=["permission_denied", "not_found"]
)


@_SEMS
@_REFUSALS
async def test_traced_referenced_refusal_returns_marker(sem, refusal, caplog):
    sem = asyncio.Semaphore(sem) if sem else None
    ev = _traced_evaluator(refusal(), component_sem=sem)
    with caplog.at_level(logging.WARNING):
        out = await ev.evaluate_conditions_traced(_definition(), _TRACED_BARS, "MYSZ")
    assert out == _MARKER
    assert _warnings(caplog) == 1


@_SEMS
@_REFUSALS
async def test_traced_unreferenced_refusal_is_skipped_without_marker(sem, refusal, caplog):
    sem = asyncio.Semaphore(sem) if sem else None
    ev = _traced_evaluator(refusal(), component_sem=sem)
    with caplog.at_level(logging.WARNING):
        out = await ev.evaluate_conditions_traced(_definition(z_ref="sma"), _TRACED_BARS, "MYSZ")
    assert "formula_unreadable" not in out
    assert out["total_conditions"] == 2
    assert _warnings(caplog) == 1


@_SEMS
async def test_traced_refusal_mixed_with_timeout_still_raises(sem):
    def _dispatch(req, **_kw):
        if req.formula_id == "f-zscore":
            raise _permission_denied()
        return SimpleNamespace(success=False, error=_TIMEOUT)

    sem = asyncio.Semaphore(sem) if sem else None
    ev = _traced_evaluator(_dispatch, component_sem=sem)
    with pytest.raises(FormulaExecutionError) as excinfo:
        await ev.evaluate_conditions_traced(_definition_two_formulas(), _TRACED_BARS, "MYSZ")
    assert excinfo.value.formula_id == "f-timeout"


@_SEMS
async def test_traced_benchmark_component_refusal_returns_marker(sem):
    definition = _definition()
    definition.components[1].source_symbol = "SPY"
    sem = asyncio.Semaphore(sem) if sem else None
    ev = _traced_evaluator(_permission_denied(), component_sem=sem)
    out = await ev.evaluate_conditions_traced(
        definition, _TRACED_BARS, "MYSZ", benchmark_bars={"SPY": _TRACED_BARS}
    )
    assert out == _MARKER


@_REFUSALS
async def test_execute_formula_sink_collects_ref_and_skips(refusal):
    ev = _evaluator(refusal(), raise_unreadable=False)
    sink: set[str] = set()
    assert await _execute(ev, sink) is None
    assert sink == {"z"}


@_REFUSALS
async def test_execute_formula_raise_unreadable_is_checked_before_sink(refusal):
    ev = _evaluator(refusal(), raise_unreadable=True)
    sink: set[str] = set()
    with pytest.raises(FormulaExecutionError):
        await _execute(ev, sink)
    assert sink == set()


@_SEMS
async def test_shared_evaluator_marks_every_gathered_candidate_logs_once(sem, caplog):
    sem = asyncio.Semaphore(sem) if sem else None
    ev = _traced_evaluator(_permission_denied(), component_sem=sem)
    with caplog.at_level(logging.WARNING):
        first, second = await asyncio.gather(
            ev.evaluate_conditions_traced(_definition(), _TRACED_BARS, "MYSZ"),
            ev.evaluate_conditions_traced(_definition(), _TRACED_BARS, "AAPL"),
        )
    assert first == _MARKER
    assert second == {**_MARKER, "symbol": "AAPL"}
    assert _warnings(caplog) == 1


# ── AC-30: write-time warning ────────────────────────────────────────────────────────────────────


def _write_svc():
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
    svc._strategies_repo.create = AsyncMock(
        side_effect=lambda uid, sid, name, dj: {**_row(), "definition_json": dj}
    )
    svc._indicators = RecordingStub({"GetFormula": _not_found()})
    return svc


def _register(definition):
    return analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
    )


async def test_ac30_register_returns_not_readable_warning():
    svc = _write_svc()
    resp = await svc.ManageStrategy(_register(_definition()), ctx_with(_BOB))
    assert _WARNING in resp.warnings
    svc._strategies_repo.create.assert_awaited_once()  # an unreadable formula warns, never refuses


async def test_ac30_unknown_series_rejection_names_unreadable_formula():
    # Open risk: the outputs fetch swallows NOT_FOUND → {"value"}, so a dotted ref is "unknown";
    # the rejection must still surface the real cause, not only the misleading series error.
    svc = _write_svc()
    ctx = ctx_with(_BOB)
    try:
        await svc.ManageStrategy(_register(_definition(z_ref="z.upper")), ctx)
    except Exception:  # noqa: BLE001 — ctx.abort raises
        pass
    code, message = ctx.abort.await_args.args
    assert code == grpc.StatusCode.INVALID_ARGUMENT
    assert _WARNING in message
    svc._strategies_repo.create.assert_not_awaited()


async def test_ac30_update_returns_not_readable_warning():
    svc = _write_svc()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row())

    async def _update_locked(uid, sid, apply_fn):
        _name, new_json = await apply_fn(_row())
        return {**_row(), "definition_json": new_json}

    svc._strategies_repo.update_locked = AsyncMock(side_effect=_update_locked)
    svc._recompute_headline_locked = AsyncMock()
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=_definition()
    )
    resp = await svc.ManageStrategy(req, ctx_with(_BOB))
    assert _WARNING in resp.warnings


# ── ANALYSIS-2/3 / @feature-065: backtest FORMULA_ERROR, excluded from evidence ─────────────────


async def test_backtest_unreadable_formula_is_formula_error_and_excluded_from_evidence():
    bars = [_bar(7000 + i, c) for i, c in enumerate([110, 120, 130, 140, 150, 160])]
    ok = Struct()
    ok.update({"value": [1.0] * len(bars)})
    svc = make_servicer()
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())
    # AAPL's formula is unreadable; MSFT's sibling succeeds (keeps the exclusion non-vacuous).
    svc._indicators.ExecuteFormula = AsyncMock(
        side_effect=[_not_found(), SimpleNamespace(success=True, output=ok, error="")]
    )
    req = analysis_pb2.RunBacktestRequest(
        strategy_id="s-1", symbols=["AAPL", "MSFT"], initial_capital=100_000.0
    )
    req.inline_definition.CopyFrom(_definition())

    result = await svc.RunBacktest(req, ctx_with(_BOB))

    reasons = {d.symbol: d.no_trade_reason for d in result.diagnostics}
    assert reasons["AAPL"] == analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
    assert reasons["MSFT"] != analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
    inserted = [
        c["symbol"]
        for call in svc._backtest_run_symbols_repo.insert_many.await_args_list
        for c in call.args[0]
    ]
    assert "MSFT" in inserted
    assert "AAPL" not in inserted


# ── @feature-185: an unreadable formula is never the "unavailable" marker ───────────────────────


async def test_list_opportunities_unreadable_formula_is_not_unavailable():
    definition = _definition()
    svc = _materialized_svc(
        watchlists=[_wl(bindings=[("AAPL", "s-1")])],
        strategies={"s-1": _row(definition)},
        bars={"AAPL": _FIRING_BARS},
    )
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=_not_found())
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())

    by_symbol, _ = await _list_opps(svc)

    opp = by_symbol["AAPL"]
    assert opp.formula_unreadable is True
    assert opp.data_unavailable is False
    assert (opp.passing_conditions, opp.total_conditions) == (0, 0)


# ── feature 289 @AC-20: a FAST-served marked cache row carries the marker, no re-evaluation ─────


async def test_evaluate_readiness_fast_serves_formula_unreadable_marker():
    strategy = _row(_definition())
    now = datetime.now(UTC)
    cached = {
        "symbol": "MYSZ",
        "def_fingerprint": _definition_fingerprint(strategy["definition_json"]),
        "bar_epoch": 0,
        "computed_at": now,
        "valid_until": now + timedelta(hours=1),
        "readiness_json": {**_empty_readiness("MYSZ"), "formula_unreadable": True},
    }
    svc = make_servicer()
    svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=strategy))
    svc._marketdata = MagicMock()  # GetDataCoverage probe is best-effort; a miss reads as 0
    svc._indicators = MagicMock()
    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))
    svc._indicators.ExecuteFormula = AsyncMock()
    svc._readiness_cache_repo = MagicMock(read_many=AsyncMock(return_value={"MYSZ": cached}))

    resp = await svc.EvaluateReadiness(
        analysis_pb2.EvaluateReadinessRequest(strategy_id="s-1", symbols=["MYSZ"]),
        ctx_with(_BOB),
    )

    (readiness,) = resp.readiness
    assert readiness.formula_unreadable is True
    assert readiness.total_conditions == 0
    svc._indicators.ExecuteFormula.assert_not_awaited()


# ── feature 289 (Step 8a): servicer producer wiring — rows, readiness, scheduled passes, heal ───


_META = [("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]
_RPC_FAILED = "indicator RPC failed for MYSZ"
_AGED = timedelta(seconds=400)  # past the 300 s heal cooldown
_READINESS_REQ = analysis_pb2.EvaluateReadinessRequest(strategy_id="s-1", symbols=["MYSZ"])
_CLOSES = [120.0, 130.0, 150.0]


def _ok_formula(req, **_kw):
    out = Struct()
    out.update({"value": [1.0] * len(_FIRING_BARS)})
    return SimpleNamespace(success=True, output=out, error="")


def _held_definition():
    definition = _definition()
    definition.exit_rule = definition.entry_rule
    return definition


def _find(rows, strategy_id, symbol="MYSZ"):
    return next(r for r in rows if r["symbol"] == symbol and r["strategy_id"] == strategy_id)


def _refuse(svc, refusal):
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=refusal())


def _mysz_svc(definition=None, **kwargs):
    return _materialized_svc(
        watchlists=[_wl(bindings=[("MYSZ", "s-1")])],
        strategies={"s-1": _row(definition)},
        bars={"MYSZ": _FIRING_BARS},
        **kwargs,
    )


def _aged_row(provenance):
    return _unavailable_served_row(
        "MYSZ", "s-1", provenance=provenance, computed_at=datetime.now(UTC) - _AGED
    )


async def _drain(predicate):
    for _ in range(1000):
        if not predicate():
            break
        await asyncio.sleep(0)


@_REFUSALS
async def test_opportunities_refused_formula_marks_row_unreferenced_sibling_evaluated(
    refusal, caplog
):
    svc = _materialized_svc(
        watchlists=[_wl(bindings=[("MYSZ", "s-1"), ("MYSZ", "s-2")])],
        strategies={
            "s-1": _row(_definition()),
            "s-2": _row(_definition(z_ref="sma", strategy_id="s-2")),
        },
        bars={"MYSZ": _FIRING_BARS},
    )
    _refuse(svc, refusal)
    with caplog.at_level(logging.WARNING):
        await _list_opps(svc)
        resp = await svc.ListOpportunities(
            analysis_pb2.ListOpportunitiesRequest(min_conviction=0.9), _ctx(_HEADERS)
        )

    stored = svc._opportunities_repo.rows["u1"]
    marked = _find(stored, "s-1")
    assert "formula_unreadable" in marked["provenance"]
    assert "unavailable" not in marked["provenance"]
    assert marked["action"] == analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED
    assert (marked["conviction"], marked["signal_axis"]) == (0.0, 0.0)
    assert marked["composite_score"] is None
    sibling = _find(stored, "s-2")
    assert "formula_unreadable" not in sibling["provenance"]
    assert sibling["readiness_json"]["total_conditions"] == 2

    (opp,) = [o for o in resp.opportunities if o.strategy_id == "s-1"]  # survives the 0.9 floor
    assert opp.formula_unreadable is True
    assert opp.data_unavailable is False
    assert (opp.passing_conditions, opp.total_conditions) == (0, 0)
    assert opp.source != "formula_unreadable"
    assert "formula_unreadable" not in resp.available_sources
    assert _RPC_FAILED not in caplog.text
    assert _warnings(caplog) == 1


@pytest.mark.parametrize(
    ("signals", "action", "signal_kept"),
    [
        (
            [_sig("MYSZ", "sell", 0.7, source="uw")],
            analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE,
            True,
        ),
        ([], analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD, False),
    ],
    ids=["sell_signal_reduce", "no_signal_add"],
)
async def test_opportunities_held_refused_row_keeps_its_signal_action(signals, action, signal_kept):
    svc = _mysz_svc(_held_definition(), signals=signals, held=["MYSZ"])
    _refuse(svc, _permission_denied)

    row = _find(await svc._compute_opportunities("u1", _META), "s-1")

    assert "formula_unreadable" in row["provenance"]
    assert "unavailable" not in row["provenance"]
    assert row["action"] == action
    assert row["conviction"] == 0.0
    readiness = row["readiness_json"]
    assert (readiness["passing_conditions"], readiness["total_conditions"]) == (0, 0)
    assert (row["signal_axis"] > 0) is signal_kept
    assert (row["composite_score"] is not None) is signal_kept


@pytest.mark.parametrize("outage_yields", [0, 5], ids=["outage_first", "outage_last"])
async def test_opportunities_sibling_outage_never_flips_marked_rows(outage_yields, caplog):
    svc = _materialized_svc(
        watchlists=[_wl(bindings=[("MYSZ", "s-1"), ("MYSZ", "s-3"), ("MYSZ", "tech")])],
        strategies={
            "s-1": _row(_definition()),
            "s-3": _row(_definition(strategy_id="s-3")),
            "tech": _strat_row("tech", entry=_GT_100),
        },
        bars={"MYSZ": _FIRING_BARS},
    )
    _refuse(svc, _permission_denied)

    async def _compute(req, metadata=None):
        if req.params["period"] == 3.0:  # only the tech sibling's SMA(3) is down
            for _ in range(outage_yields):
                await asyncio.sleep(0)
            raise aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "down")
        return _sma_resp(req)

    svc._indicators.ComputeIndicator = AsyncMock(side_effect=_compute)
    with caplog.at_level(logging.WARNING):
        rows = await svc._compute_opportunities("u1", _META)

    for strategy_id in ("s-1", "s-3"):
        provenance = _find(rows, strategy_id)["provenance"]
        assert "formula_unreadable" in provenance
        assert "unavailable" not in provenance
    assert "unavailable" in _find(rows, "tech")["provenance"]
    assert _warnings(caplog) == 1


async def test_opportunities_marker_clears_once_formula_is_readable():
    svc = _mysz_svc()
    _refuse(svc, _permission_denied)
    first = _find(await svc._compute_opportunities("u1", _META), "s-1")
    assert "formula_unreadable" in first["provenance"]

    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=_ok_formula)
    second = _find(await svc._compute_opportunities("u1", _META), "s-1")

    assert "formula_unreadable" not in second["provenance"]
    assert second["readiness_json"]["total_conditions"] == 2
    assert second["action"] == analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER


async def test_opportunities_execute_outage_stays_data_unavailable_without_marker():
    svc = _mysz_svc()
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())
    svc._indicators.ExecuteFormula = AsyncMock(
        side_effect=aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "down")
    )
    row = _find(await svc._compute_opportunities("u1", _META), "s-1")
    assert "unavailable" in row["provenance"]
    assert "formula_unreadable" not in row["provenance"]


async def test_opportunity_recompute_timeout_fails_and_keeps_stored_rows(caplog):
    svc = _mysz_svc()
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())
    svc._indicators.ExecuteFormula = AsyncMock(
        return_value=SimpleNamespace(success=False, error=_TIMEOUT)
    )
    stored = _unavailable_served_row(
        "MYSZ", "s-1", provenance=["watchlist"], computed_at=datetime.now(UTC)
    )
    svc._opportunities_repo.rows["u1"] = [stored]
    before = dict(stored)

    with caplog.at_level(logging.WARNING):
        svc._kick_opportunity_recompute("u1", _META)
        await _drain(lambda: "u1" in svc._opportunity_recomputing)

    assert "opportunity recompute failed" in caplog.text
    assert svc._opportunities_repo.rows["u1"] == [before]


async def test_evaluate_readiness_timeout_raises_not_converted_to_marker():
    svc = _cache_svc({"MYSZ": _real_bars("MYSZ", _CLOSES)}, strategy_row=_row(_definition()))
    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ExecuteFormula = AsyncMock(
        return_value=SimpleNamespace(success=False, error=_TIMEOUT)
    )
    with pytest.raises(FormulaExecutionError):
        await svc.EvaluateReadiness(_READINESS_REQ, ctx_with(_BOB))


async def test_live_loop_permission_denied_pair_is_isolated_and_cycle_continues(caplog):
    indicators = RecordingStub(
        {
            "ExecuteFormula": _permission_denied(),
            "GetFormula": _not_found(),
            "ComputeIndicator": _sma_resp,
        }
    )
    loop = _live_loop(_ingest(), indicators, [_row()])
    with caplog.at_level(logging.WARNING, logger="app.engine.live_loop"):
        await loop._run_cycle()

    records = [
        r
        for r in caplog.records
        if r.name == "app.engine.live_loop" and r.levelno == logging.WARNING
    ]
    assert len(records) == 1
    pattern = r"live_loop: \(s-1,\w+\) error: .* — continuing"
    assert re.search(pattern, records[0].getMessage(), re.S)


async def test_evaluate_readiness_slow_returns_marker_then_fast_serves_it():
    svc = _cache_svc({"MYSZ": _real_bars("MYSZ", _CLOSES)}, strategy_row=_row(_definition()))
    _refuse(svc, _permission_denied)

    (slow,) = (await svc.EvaluateReadiness(_READINESS_REQ, ctx_with(_BOB))).readiness
    assert slow.formula_unreadable is True
    assert (slow.passing_conditions, slow.total_conditions) == (0, 0)

    upserted = svc._readiness_cache_repo.upsert_many.await_args.args[0]
    assert upserted[0]["bar_epoch"] >= 0
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={r["symbol"]: r for r in upserted})
    executes = svc._indicators.ExecuteFormula.await_count
    (fast,) = (await svc.EvaluateReadiness(_READINESS_REQ, ctx_with(_BOB))).readiness
    assert fast.formula_unreadable is True
    assert svc._indicators.ExecuteFormula.await_count == executes


async def test_kick_then_watchlist_readiness_resolves_marked_and_sibling(caplog):
    bars = {sym: _real_bars(sym, _CLOSES) for sym in ("MYSZ", "AAPL")}
    svc = _cache_svc(bars, strategy_row=_row(_definition()))
    svc._portfolio = MagicMock()
    svc._portfolio.GetWatchlist = AsyncMock(
        return_value=SimpleNamespace(
            watchlist=SimpleNamespace(
                bindings=[
                    SimpleNamespace(symbol="MYSZ", strategy_id="s-1"),
                    SimpleNamespace(symbol="AAPL", strategy_id="s-1"),
                ]
            )
        )
    )
    _refuse(svc, _permission_denied)
    req = analysis_pb2.GetWatchlistReadinessRequest(watchlist_id="wl1")

    with caplog.at_level(logging.WARNING):
        await svc.GetWatchlistReadiness(req, ctx_with(_BOB))
        await _drain(lambda: svc._readiness_kicking)
    assert "readiness refresh kick failed" not in caplog.text

    rows = svc._readiness_cache_repo.upsert_many.await_args.args[0]
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={r["symbol"]: r for r in rows})
    resp = await svc.GetWatchlistReadiness(req, ctx_with(_BOB))
    by_symbol = {r.symbol: r for r in resp.rows}
    assert by_symbol["MYSZ"].state == analysis_pb2.READINESS_STATE_RESOLVED
    assert by_symbol["MYSZ"].readiness.formula_unreadable is True
    assert by_symbol["MYSZ"].readiness.total_conditions == 0
    assert by_symbol["AAPL"].state == analysis_pb2.READINESS_STATE_RESOLVED


async def test_daily_refresh_with_owner_metadata_yields_marked_row():
    svc = _mysz_svc()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=["bob"])
    _refuse(svc, _not_found)  # owner metadata carries no admin bit → indicators answers NOT_FOUND
    pool = _mock_pool()

    await svc._opportunity_refresh_tick(
        DurableSchedule(pool, "opportunity", "wallclock", anchor_hour=lambda: 0)
    )

    row = _find(svc._opportunities_repo.rows["bob"], "s-1")
    assert "formula_unreadable" in row["provenance"]
    assert "unavailable" not in row["provenance"]
    assert pool.execute.await_count == 1
    assert list(svc._indicators.ExecuteFormula.await_args.kwargs["metadata"]) == [
        ("x-user-id", "bob")
    ]


def _refuse_unless_admin(req, metadata=None):
    if int(dict(metadata or []).get("x-access-scope", "0")) & 4:
        raise _permission_denied()
    raise _not_found()


def _always_denied(req, metadata=None):
    raise _permission_denied()


@pytest.mark.parametrize(
    "execute", [_refuse_unless_admin, _always_denied], ids=["owner_not_found", "denied"]
)
async def test_materializer_persists_marked_verdict_and_continues(execute):
    live = {**_row(_definition()), "user_id": "bob", "strategy_id": "s-1"}
    bars = {sym: _real_bars(sym, _CLOSES) for sym in ("MYSZ", "AAPL")}
    # _materializer_svc stubs get_bool → True, so the fundamentals gate is ON; harmless here.
    svc = _materializer_svc([live], {"bob": [("MYSZ", "s-1"), ("AAPL", "s-1")]}, bars)
    svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=execute)

    await svc._readiness_materializer_tick(_due_schedule())

    rows = {r["symbol"]: r for r in _upserted_rows(svc)}
    mysz = rows["MYSZ"]
    assert mysz["readiness_json"]["formula_unreadable"] is True
    assert mysz["readiness_json"]["total_conditions"] == 0
    assert mysz["bar_epoch"] >= 0
    assert mysz["valid_until"] > datetime.now(UTC)
    assert "AAPL" in rows
    for call in svc._indicators.ExecuteFormula.await_args_list:
        assert list(call.kwargs["metadata"]) == [("x-user-id", "bob")]


@pytest.mark.parametrize("held", [False, True], ids=["watchlist_entry", "held_exit"])
async def test_heal_refusal_rewrites_to_marker_and_is_not_reselected(held):
    svc = _mysz_svc(_held_definition() if held else None, held=["MYSZ"] if held else ())
    _refuse(svc, _permission_denied)
    svc._opportunities_repo.rows["u1"] = [
        _aged_row(["position" if held else "watchlist", "unavailable"])
    ]
    real = svc._opportunities_repo.replace_symbols
    spy = svc._opportunities_repo.replace_symbols = AsyncMock(side_effect=real)
    svc._readiness_cache_repo = _FakeReadinessCache()

    await svc._retry_unavailable_symbols("u1", {"MYSZ"}, _META)

    (healed,) = spy.await_args.args[1]
    assert "formula_unreadable" in healed["provenance"]
    assert "unavailable" not in healed["provenance"]
    assert healed["readiness_json"]["formula_unreadable"] is True
    assert healed["conviction"] == 0.0
    if held:
        assert "action" not in healed
        assert svc._readiness_cache_repo.upserted == []
    else:
        assert healed["action"] == analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED
        assert (healed["signal_axis"], healed["composite_score"]) == (0.0, None)
        (staged,) = svc._readiness_cache_repo.upserted
        assert staged["readiness_json"]["formula_unreadable"] is True
        assert staged["bar_epoch"] >= 0

    await svc._retry_unavailable_symbols("u1", {"MYSZ"}, _META)
    assert spy.await_count == 1


async def test_heal_recovery_restores_an_evaluated_row():
    svc = _mysz_svc()
    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=_ok_formula)
    svc._opportunities_repo.rows["u1"] = [_aged_row(["watchlist", "unavailable"])]

    await svc._retry_unavailable_symbols("u1", {"MYSZ"}, _META)

    (row,) = svc._opportunities_repo.rows["u1"]
    assert "unavailable" not in row["provenance"]
    assert "formula_unreadable" not in row["provenance"]
    assert row["readiness_json"]["total_conditions"] == 2
