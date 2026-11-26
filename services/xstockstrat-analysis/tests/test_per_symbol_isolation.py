"""Feature 308 — per-symbol isolation at the readiness callers (@AC-2, @AC-3 kick + materializer)
and in the opportunities compute (@AC-1).

One failing symbol degrades only itself: EvaluateReadiness returns it empty and unstaged; the kick
and the materializer cache the bar_epoch = -1 sentinel for it; the opportunities compute keeps its
row, marked `unavailable` (transient) or `evaluation_failed`. CancelledError always propagates.
C-13: the servicer harnesses, bars and strategy fixtures are imported from sibling test modules.
"""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import _composite_score
from app.repositories.opportunities import EVALUATION_FAILED_PROVENANCE
from app.services.evaluator import FormulaExecutionError, StrategyEvaluator
from app.services.readiness import compute_readiness_row
from tests.conftest import aio_rpc_error, ctx_with
from tests.test_analysis_servicer import (
    _FIRING_BARS,
    _GT_100,
    _HEADERS,
    _ctx,
    _list_opps,
    _materialized_svc,
    _strat_row,
    _wl,
)
from tests.test_owner_header_guard import _BOB
from tests.test_readiness_cache import _cache_svc
from tests.test_readiness_materializer import _due_schedule, _materializer_svc, _upserted_rows
from tests.test_readiness_opportunities_source_symbol import _real_bars
from tests.test_unreadable_formula import (
    _CLOSES,
    _META,
    _classifier_spy,
    _definition,
    _drain,
    _find,
    _held_definition,
    _mysz_svc,
    _ok_formula,
    _row,
)

_SYMBOLS = ["AAPL", "MSFT", "NVDA"]
_FAILING = "NVDA"
_HEALTHY = [s for s in _SYMBOLS if s != _FAILING]
# The failing symbol's bars are the only ones ExecuteFormula sees in this order.
_OUTAGE_CLOSES = _CLOSES[::-1]
_STRATEGY = _row(_definition())
_WATCHLIST_REQ = analysis_pb2.GetWatchlistReadinessRequest(watchlist_id="wl1")


def _bars():
    return {s: _real_bars(s, _CLOSES) for s in _SYMBOLS}


def _outage_bars():
    return {s: _real_bars(s, _OUTAGE_CLOSES if s == _FAILING else _CLOSES) for s in _SYMBOLS}


def _raise_in_compute(svc, exc):
    async def _compute(symbol, **kwargs):
        if symbol == _FAILING:
            raise exc
        return await compute_readiness_row(symbol, **kwargs)

    return patch("app.handlers.servicer.compute_readiness_row", _compute)


def _raise_in_snapshot_loader(svc, exc):
    real = svc._load_fundamentals_snapshot

    async def _load(definition, symbol, *args, **kwargs):
        if symbol == _FAILING:
            raise exc
        return await real(definition, symbol, *args, **kwargs)

    return patch.object(svc, "_load_fundamentals_snapshot", _load)


def _execute_with_outage(req, **_kw):
    if list(req.input_data["close"]) == _OUTAGE_CLOSES:
        raise aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "down")
    return _ok_formula(req)


def _with_formula(svc):
    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute_with_outage)
    return svc


def _kick_svc(bars):
    svc = _with_formula(_cache_svc(bars, strategy_row=_STRATEGY))
    svc._portfolio = MagicMock()
    svc._portfolio.GetWatchlist = AsyncMock(
        return_value=SimpleNamespace(
            watchlist=SimpleNamespace(
                bindings=[
                    SimpleNamespace(symbol=s, strategy_id=_STRATEGY["strategy_id"])
                    for s in _SYMBOLS
                ]
            )
        )
    )
    return svc


def _owner_materializer_svc(bars):
    bindings = {_STRATEGY["user_id"]: [(s, _STRATEGY["strategy_id"]) for s in _SYMBOLS]}
    return _with_formula(_materializer_svc([_STRATEGY], bindings, bars))


def _assert_sentinel_for_failing_pair(rows):
    assert set(rows) == set(_SYMBOLS)
    assert rows[_FAILING]["bar_epoch"] == -1
    assert rows[_FAILING]["readiness_json"] == {}
    for symbol in _HEALTHY:
        assert rows[symbol]["bar_epoch"] >= 0
        assert rows[symbol]["readiness_json"]["total_conditions"] > 0


# ── @AC-2: EvaluateReadiness ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "inject", [_raise_in_compute, _raise_in_snapshot_loader], ids=["compute", "snapshot_loader"]
)
async def test_evaluate_readiness_degrades_only_the_failing_symbol(inject, caplog):
    svc = _cache_svc(_bars())
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=_SYMBOLS)

    with inject(svc, ZeroDivisionError("boom")), caplog.at_level(logging.WARNING):
        resp = await svc.EvaluateReadiness(req, _ctx(_HEADERS))

    assert [r.symbol for r in resp.readiness] == _SYMBOLS
    by_symbol = {r.symbol: r for r in resp.readiness}
    for symbol in _HEALTHY:
        assert by_symbol[symbol].total_conditions > 0
    failing = by_symbol[_FAILING]
    assert (failing.passing_conditions, failing.total_conditions) == (0, 0)
    svc._readiness_cache_repo.upsert_many.assert_awaited_once()
    staged = svc._readiness_cache_repo.upsert_many.await_args.args[0]
    assert [r["symbol"] for r in staged] == _HEALTHY
    assert "evaluate_readiness: 1/3" in caplog.text


# ── @AC-3: readiness kick and materializer cache the -1 sentinel ─────────────────────────────────


async def test_kick_caches_sentinel_for_failing_pair_and_keeps_siblings(caplog):
    svc = _kick_svc(_outage_bars())

    with caplog.at_level(logging.WARNING):
        await svc.GetWatchlistReadiness(_WATCHLIST_REQ, ctx_with(_BOB))
        await _drain(lambda: svc._readiness_kicking)

    assert "readiness refresh kick failed" not in caplog.text
    assert "readiness_kick: 1/3" in caplog.text
    rows = {r["symbol"]: r for r in svc._readiness_cache_repo.upsert_many.await_args.args[0]}
    _assert_sentinel_for_failing_pair(rows)

    svc._readiness_cache_repo.read_many = AsyncMock(return_value=rows)
    resp = await svc.GetWatchlistReadiness(_WATCHLIST_REQ, ctx_with(_BOB))
    states = {r.symbol: r.state for r in resp.rows}
    assert states[_FAILING] == analysis_pb2.READINESS_STATE_UNKNOWN
    for symbol in _HEALTHY:
        assert states[symbol] == analysis_pb2.READINESS_STATE_RESOLVED


async def test_materializer_caches_sentinel_for_failing_pair_and_keeps_siblings(caplog):
    svc = _owner_materializer_svc(_outage_bars())

    with caplog.at_level(logging.WARNING):
        await svc._readiness_materializer_tick(_due_schedule())

    assert "readiness materializer failed for owner" not in caplog.text
    assert "readiness_materializer: 1/3" in caplog.text
    _assert_sentinel_for_failing_pair({r["symbol"]: r for r in _upserted_rows(svc)})


# ── CancelledError is never isolated (credited by the `except BaseException` mutation run) ──────


async def test_evaluate_readiness_propagates_cancellation():
    svc = _cache_svc(_bars())
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=_SYMBOLS)

    with _raise_in_compute(svc, asyncio.CancelledError()), pytest.raises(asyncio.CancelledError):
        await svc.EvaluateReadiness(req, _ctx(_HEADERS))

    svc._readiness_cache_repo.upsert_many.assert_not_awaited()


async def test_kick_propagates_cancellation():
    svc = _kick_svc(_bars())
    before = asyncio.all_tasks()

    with _raise_in_compute(svc, asyncio.CancelledError()):
        svc._kick_readiness_refresh(
            _STRATEGY["user_id"], {_STRATEGY["strategy_id"]: list(_SYMBOLS)}, _META
        )
        (task,) = asyncio.all_tasks() - before
        with pytest.raises(asyncio.CancelledError):
            await task

    svc._readiness_cache_repo.upsert_many.assert_not_awaited()
    assert not svc._readiness_kicking


async def test_materializer_propagates_cancellation():
    svc = _owner_materializer_svc(_bars())

    with _raise_in_compute(svc, asyncio.CancelledError()), pytest.raises(asyncio.CancelledError):
        await svc._readiness_materializer_tick(_due_schedule())

    svc._readiness_cache_repo.upsert_many.assert_not_awaited()


# ── @AC-1: the opportunities compute degrades only the failing candidate's row ──────────────────

_UNSPECIFIED = analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED


def _opp_svc(bindings=None):
    bindings = bindings or [(s, "sx") for s in _SYMBOLS]
    return _materialized_svc(
        watchlists=[_wl(bindings=bindings)],
        strategies={sid: _strat_row(sid, entry=_GT_100) for _, sid in bindings},
        bars={s: _FIRING_BARS for s, _ in bindings},
    )


def _raise_in_eval(_svc, exc, *, strategy=None, yields=0):
    real = StrategyEvaluator.evaluate_conditions_traced

    async def _eval(self, definition, bars, symbol, *args, **kwargs):
        if definition.strategy_id == strategy if strategy else symbol == _FAILING:
            for _ in range(yields):
                await asyncio.sleep(0)
            raise exc
        return await real(self, definition, bars, symbol, *args, **kwargs)

    return patch.object(StrategyEvaluator, "evaluate_conditions_traced", _eval)


def _failing_formula(svc, exit_reason):
    svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))
    svc._indicators.ExecuteFormula = AsyncMock(
        return_value=SimpleNamespace(success=False, error="boom", exit_reason=exit_reason)
    )
    return svc


def _assert_marked(row):
    assert EVALUATION_FAILED_PROVENANCE in row["provenance"]
    assert "unavailable" not in row["provenance"]


@pytest.mark.parametrize(
    ("inject", "exc"),
    [
        (_raise_in_eval, FormulaExecutionError("f-1", "boom")),
        (_raise_in_eval, ZeroDivisionError("boom")),
        (_raise_in_snapshot_loader, ZeroDivisionError("boom")),
    ],
    ids=["formula_error", "zero_division", "snapshot_loader"],
)
async def test_opportunities_compute_marks_only_the_failing_row(inject, exc, caplog):
    svc = _opp_svc()

    with inject(svc, exc), _classifier_spy() as spy, caplog.at_level(logging.WARNING):
        rows = await svc._compute_opportunities("u1", _META)

    spy.assert_called_once_with(exc)
    for symbol in _HEALTHY:
        healthy = _find(rows, "sx", symbol)
        assert healthy["readiness_json"]["total_conditions"] > 0
        assert EVALUATION_FAILED_PROVENANCE not in healthy["provenance"]
    failing = _find(rows, "sx", _FAILING)
    _assert_marked(failing)
    assert failing["conviction"] == 0.0
    assert failing["action"] == _UNSPECIFIED
    assert "opportunity_compute: 1/3" in caplog.text


@pytest.mark.parametrize(
    "exit_reason",
    [
        indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
        indicators_pb2.SANDBOX_EXIT_REASON_IMPORT_BLOCKED,
        indicators_pb2.SANDBOX_EXIT_REASON_MEMORY_EXCEEDED,
        indicators_pb2.SANDBOX_EXIT_REASON_UNSPECIFIED,
    ],
    ids=["runtime_error", "import_blocked", "memory_exceeded", "unspecified"],
)
async def test_opportunities_terminal_exit_reason_is_evaluation_failed(exit_reason):
    svc = _failing_formula(_mysz_svc(), exit_reason)

    with _classifier_spy() as spy:
        row = _find(await svc._compute_opportunities("u1", _META), "s-1")

    (received,) = [call.args[0] for call in spy.call_args_list]
    assert isinstance(received, FormulaExecutionError)
    assert received.exit_reason == exit_reason
    _assert_marked(row)


async def test_opportunities_held_row_keeps_its_action_and_carries_the_marker():
    svc = _failing_formula(
        _mysz_svc(_held_definition(), held=["MYSZ"]),
        indicators_pb2.SANDBOX_EXIT_REASON_RUNTIME_ERROR,
    )

    with _classifier_spy() as spy:
        row = _find(await svc._compute_opportunities("u1", _META), "s-1")

    assert isinstance(spy.call_args.args[0], FormulaExecutionError)
    _assert_marked(row)
    assert row["action"] == analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD


@pytest.mark.parametrize("yields", [0, 5], ids=["outage_first", "outage_last"])
async def test_opportunities_outage_is_row_local(yields):
    svc = _opp_svc([("AAPL", "sx"), ("AAPL", "sy")])
    exc = aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "down")

    with _raise_in_eval(svc, exc, strategy="sx", yields=yields), _classifier_spy() as spy:
        rows = await svc._compute_opportunities("u1", _META)

    spy.assert_called_once_with(exc)
    assert "unavailable" in _find(rows, "sx", "AAPL")["provenance"]
    sibling = _find(rows, "sy", "AAPL")
    assert "unavailable" not in sibling["provenance"]
    assert sibling["readiness_json"]["total_conditions"] > 0


async def test_opportunities_bars_outage_outranks_a_terminal_eval_fault():
    svc = _opp_svc()
    svc._marketdata.BatchGetBars = AsyncMock(side_effect=RuntimeError("down"))
    exc = FormulaExecutionError("f-1", "boom")

    with _raise_in_eval(svc, exc), _classifier_spy() as spy:
        failing = _find(await svc._compute_opportunities("u1", _META), "sx", _FAILING)

    spy.assert_called_once_with(exc)
    assert "unavailable" in failing["provenance"]
    assert EVALUATION_FAILED_PROVENANCE not in failing["provenance"]


async def test_opportunities_marker_clears_on_a_healthy_recompute():
    svc = _opp_svc()
    with _raise_in_eval(svc, ZeroDivisionError("boom")), _classifier_spy() as spy:
        first = _find(await svc._compute_opportunities("u1", _META), "sx", _FAILING)
    assert isinstance(spy.call_args.args[0], ZeroDivisionError)
    _assert_marked(first)

    second = _find(await svc._compute_opportunities("u1", _META), "sx", _FAILING)

    assert EVALUATION_FAILED_PROVENANCE not in second["provenance"]
    assert second["readiness_json"]["total_conditions"] > 0


async def test_list_opportunities_serves_the_marked_row_as_evaluated():
    svc = _opp_svc()

    with _raise_in_eval(svc, ZeroDivisionError("boom")), _classifier_spy() as spy:
        by_symbol, _ = await _list_opps(svc, min_conviction=0.9)

    assert isinstance(spy.call_args.args[0], ZeroDivisionError)
    served = by_symbol[_FAILING]  # the marker exempts it from the conviction floor
    assert served.data_unavailable is False
    assert EVALUATION_FAILED_PROVENANCE in served.provenance


async def test_opportunities_row_assembly_failure_drops_only_that_candidate(caplog):
    svc = _opp_svc()
    calls = []

    def _composite(scored, k):
        calls.append(scored)
        if len(calls) == 1:
            raise ZeroDivisionError("boom")
        return _composite_score(scored, k)

    with (
        patch("app.handlers.servicer._composite_score", _composite),
        caplog.at_level(logging.WARNING),
    ):
        rows = await svc._compute_opportunities("u1", _META)

    (dropped,) = set(_SYMBOLS) - {r["symbol"] for r in rows}
    assert len(rows) == len(_SYMBOLS) - 1
    (record,) = [r for r in caplog.records if r.getMessage().startswith("opportunity_compute:")]
    assert record.levelno == logging.WARNING
    assert record.getMessage().startswith("opportunity_compute: 1/3")
    assert f"{dropped}:ZeroDivisionError" in record.getMessage()


async def test_opportunities_compute_propagates_cancellation():
    svc = _opp_svc()

    with _raise_in_eval(svc, asyncio.CancelledError()), pytest.raises(asyncio.CancelledError):
        await svc._compute_opportunities("u1", _META)
