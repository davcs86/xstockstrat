"""Feature 224 — a strategy component whose formula its owner cannot read (indicators NOT_FOUND).

Non-backtest surfaces skip the component (all-None series) and warn, never the feature-185
``"unavailable"`` marker; backtest stamps FORMULA_ERROR and excludes the symbol from evidence.
"""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
from gen.analysis.v1 import analysis_pb2
from google.protobuf import json_format
from google.protobuf.struct_pb2 import Struct

from app.services.evaluator import StrategyEvaluator
from tests.conftest import RecordingStub, ctx_with
from tests.test_analysis_servicer import (
    _EOF_PAGE,
    _FIRING_BARS,
    _bar,
    _list_opps,
    _materialized_svc,
    _wl,
    make_servicer,
)
from tests.test_owner_header_guard import _BOB, _ingest, _live_loop

_WARNING = "formula f-zscore not readable by owner"


def _not_found():
    return grpc.aio.AioRpcError(
        grpc.StatusCode.NOT_FOUND, grpc.aio.Metadata(), grpc.aio.Metadata(), "formula not found"
    )


def _definition(z_ref="z"):
    return analysis_pb2.StrategyDefinition(
        strategy_id="s-1",
        display_name="S-1",
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
                formula_id="f-zscore",
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
        "strategy_id": "s-1",
        "user_id": "bob",
        "display_name": "S-1",
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
    assert opp.data_unavailable is False
    assert (opp.passing_conditions, opp.total_conditions) == (1, 2)  # z holds, sma passes
