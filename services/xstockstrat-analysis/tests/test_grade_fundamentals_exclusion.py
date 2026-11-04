"""Feature 215 (H) — the derived headline grade excludes guard-refused evidence cells.

Covers @AC-11 (SCHD's 0-trade cells are excluded, never deleted; a refused-only RunBacktest still
recomputes; an outage keeps the previous grade) and the @AC-12 recompute clause (a >50-period
history is drained across pages). Plus the round-4 fixes: a GetFormula outage is UNKNOWN, refusal
filters before the traded-first dedup, interactive recomputes are bounded and never take the
background semaphore, and interactive calls forward the inbound header trio (C-03).
"""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format

from app.handlers.servicer import (
    _EXCLUDED_TRAILER_KEY,
    _EXCLUDED_TRAILER_MAX_BYTES,
    _INTERACTIVE_DERIVATION_CONCURRENCY,
    _GradeInputsUnknown,
)
from app.services.fundamentals_guard import Availability
from tests.conftest import AAPL_PIT_PERIODS, SCHD_PIT_PERIODS, fund_period
from tests.test_analysis_servicer import (
    _derivation_svc,
    _eligible_cell,
    _owned_ctx,
    _stub_update_repo,
    _update_req,
    _updated_row,
)
from tests.test_backtest_fundamentals_guard import (
    _FSCORE_INPUTS,
    _blend,
    _proto_page,
    _req,
    _svc,
)

_GATE = "analysis.backtest.fundamentals.enabled"
_SID = "fundamentals_macd_blend"
_UNKNOWN_MSG = "fundamentals availability unknown — grade unchanged"
_TRIO = {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _cell(symbol, *, trades=0, days=100, start=date(2024, 1, 1), end=date(2025, 1, 1), done=None):
    c = _eligible_cell(symbol=symbol, days=days, trades=trades)
    c["range_start"] = _dt(start) if start else None
    c["range_end"] = _dt(end) if end else None
    c["completed_at"] = _dt(done or date(2025, 2, 1))
    return c


def _rpc_error(code=grpc.StatusCode.UNAVAILABLE):
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "down")


def _wire(svc, cells, *, pit=None, gate=True):
    """Gate, a cells repo returning ``cells`` in eligibility order, and PIT/formula stubs."""
    svc._cfg.get_bool = MagicMock(side_effect=lambda k, d=False: gate if k == _GATE else d)
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint = AsyncMock(return_value=cells)
    pit = {"SCHD": SCHD_PIT_PERIODS, "AAPL": AAPL_PIT_PERIODS} if pit is None else pit
    md = MagicMock()
    md.GetHistoricalFundamentals = AsyncMock(
        side_effect=lambda req, metadata=None, timeout=None: _proto_page(pit[req.symbol])
    )
    svc._marketdata = md
    ind = MagicMock()
    ind.GetFormula = AsyncMock(
        return_value=indicators_pb2.FormulaDefinition(
            formula_id="fscore", name="fscore", fundamental_inputs=_FSCORE_INPUTS
        )
    )
    svc._indicators = ind
    return svc


def _blend_svc(cells, **kw):
    svc = _derivation_svc(
        cells, definition_json=json_format.MessageToDict(_blend()), strategy_id=_SID
    )
    return _wire(svc, cells, **kw)


def _repo_calls(svc):
    return {name for name, *_ in svc._backtest_run_symbols_repo.method_calls}


class _CountingSem(asyncio.Semaphore):
    def __init__(self, value=2):
        super().__init__(value)
        self.acquired = 0

    async def acquire(self):
        self.acquired += 1
        return await super().acquire()


# ── @AC-11: exclusion, NULL range_end, no deletes ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ac11_schd_cells_excluded_aapl_counted_nothing_deleted(caplog):
    cells = [
        _cell("AAPL", trades=3),
        _cell("SCHD"),
        _cell("SCHD", end=None, done=date(2025, 3, 1)),
    ]
    svc = _blend_svc(cells)
    with caplog.at_level(logging.INFO):
        score = await svc._recompute_headline("u1", _SID)
    assert score.evidence_symbols == 1
    assert score.evidence_days == 100
    assert _repo_calls(svc) == {"fetch_all_for_fingerprint"}
    svc._backtest_run_symbols_repo.fetch_eligible.assert_not_awaited()
    assert any(
        "grade-derivation excluded" in r.getMessage() and "SCHD" in r.getMessage()
        for r in caplog.records
    )


@pytest.mark.parametrize(("done", "kept"), [(date(2024, 6, 1), True), (date(2024, 5, 1), False)])
@pytest.mark.asyncio
async def test_null_range_end_uses_completed_at(done, kept):
    # AAPL's first filing (2024-05-03) is usable from 2024-05-04: inside a window that ends at
    # completed_at 2024-06-01, outside one that ends at 2024-05-01.
    svc = _blend_svc([_cell("AAPL", trades=3, end=None, done=done)])
    score = await svc._recompute_headline("u1", _SID)
    assert (score is not None) is kept


@pytest.mark.asyncio
async def test_all_excluded_clears_grade_and_score_strategy_names_schd():
    svc = _blend_svc([_cell("SCHD")])
    assert await svc._recompute_headline("u1", _SID) is None
    svc._scores_repo.delete.assert_awaited_with("u1", _SID)

    ctx = _owned_ctx()
    with pytest.raises(Exception, match="aborted"):
        await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)
    code, msg = ctx.abort.await_args.args
    assert code == grpc.StatusCode.NOT_FOUND
    assert "all evidence symbols excluded (fundamentals unavailable: SCHD)" in msg
    ctx.set_trailing_metadata.assert_not_called()


# ── @AC-11: triggers ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refused_single_schd_backtest_still_recomputes():
    svc = _svc()
    svc._recompute_headline = AsyncMock(return_value=None)
    result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
    svc._recompute_headline.assert_awaited_once()
    kw = svc._recompute_headline.await_args.kwargs
    assert "SCHD" in kw["fund_cache"]
    assert dict(kw["meta"]) == _TRIO
    assert kw.get("sem") is None


@pytest.mark.asyncio
async def test_run_level_cache_reused_by_recompute():
    svc = _svc()
    row = {
        "strategy_id": _SID,
        "user_id": "u1",
        "display_name": "Blend",
        "active": True,
        "definition_json": json_format.MessageToDict(_blend()),
    }
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=row)
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint = AsyncMock(
        return_value=[_cell("SCHD")]
    )
    svc._scores_repo = AsyncMock()
    await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint.assert_awaited_once()
    assert svc._marketdata.GetHistoricalFundamentals.await_count == 1  # the run's own load
    svc._scores_repo.delete.assert_awaited_with("u1", _SID)


# ── UNKNOWN keeps the previous grade ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_pit_outage_raises_and_score_strategy_aborts_unavailable():
    svc = _blend_svc([_cell("AAPL", trades=3), _cell("SCHD")])
    svc._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=_rpc_error())
    with pytest.raises(_GradeInputsUnknown):
        await svc._recompute_headline("u1", _SID)
    svc._scores_repo.delete.assert_not_awaited()
    svc._scores_repo.upsert.assert_not_awaited()

    ctx = _owned_ctx()
    with pytest.raises(Exception, match="aborted"):
        await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)
    assert ctx.abort.await_args.args == (grpc.StatusCode.UNAVAILABLE, _UNKNOWN_MSG)
    ctx.set_trailing_metadata.assert_not_called()
    svc._scores_repo.upsert.assert_not_awaited()
    svc._scores_repo.delete.assert_not_awaited()


# ── feature 283: ScoreStrategy's excluded-symbols trailer ────────────────────────────────────


def test_excluded_trailer_key_literal():
    assert _EXCLUDED_TRAILER_KEY == "x-score-excluded-symbols"
    assert _EXCLUDED_TRAILER_MAX_BYTES == 4096


async def _score(svc):
    ctx = _owned_ctx()
    resp = await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)
    return resp, ctx


async def _score_aborts(svc):
    ctx = _owned_ctx()
    with pytest.raises(Exception, match="aborted"):
        await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)
    return ctx


@pytest.mark.asyncio
async def test_ac7_score_trailer_names_excluded_symbol():
    svc = _blend_svc(
        [_cell("AAPL", trades=3), _cell("MSFT", trades=3), _cell("SCHD")],
        pit={"AAPL": AAPL_PIT_PERIODS, "MSFT": AAPL_PIT_PERIODS, "SCHD": SCHD_PIT_PERIODS},
    )
    resp, ctx = await _score(svc)
    assert resp.evidence_symbols == 2
    ctx.set_trailing_metadata.assert_called_once_with(((_EXCLUDED_TRAILER_KEY, '["SCHD"]'),))


@pytest.mark.asyncio
async def test_score_trailer_present_and_empty_when_nothing_excluded():
    resp, ctx = await _score(_blend_svc([_cell("AAPL", trades=3)]))
    assert resp.evidence_symbols == 1
    ctx.set_trailing_metadata.assert_called_once_with(((_EXCLUDED_TRAILER_KEY, "[]"),))


@pytest.mark.asyncio
async def test_score_trailer_sorted_and_deduped():
    svc = _blend_svc(
        [
            _cell("AAPL", trades=3),
            _cell("SCHD"),
            _cell("QQQ"),
            _cell("SCHD", end=None, done=date(2025, 3, 1)),
        ],
        pit={"AAPL": AAPL_PIT_PERIODS, "SCHD": SCHD_PIT_PERIODS, "QQQ": SCHD_PIT_PERIODS},
    )
    _, ctx = await _score(svc)
    ctx.set_trailing_metadata.assert_called_once_with(((_EXCLUDED_TRAILER_KEY, '["QQQ","SCHD"]'),))


@pytest.mark.asyncio
async def test_score_trailer_over_cap_is_omitted_and_warned(monkeypatch, caplog):
    monkeypatch.setattr("app.handlers.servicer._EXCLUDED_TRAILER_MAX_BYTES", 5)
    svc = _blend_svc([_cell("AAPL", trades=3), _cell("SCHD")])
    with caplog.at_level(logging.WARNING):
        resp, ctx = await _score(svc)
    assert resp.evidence_symbols == 1
    ctx.set_trailing_metadata.assert_not_called()
    assert any(
        r.levelno == logging.WARNING and "trailer omitted" in r.getMessage() for r in caplog.records
    )


@pytest.mark.asyncio
async def test_ac3_no_evidence_aborts_not_found_without_trailer():
    svc = _blend_svc([])
    ctx = await _score_aborts(svc)
    assert ctx.abort.await_args.args == (
        grpc.StatusCode.NOT_FOUND,
        "no eligible evidence — run a backtest",
    )
    svc._scores_repo.delete.assert_awaited_with("u1", _SID)
    ctx.set_trailing_metadata.assert_not_called()


@pytest.mark.asyncio
async def test_ac2_not_owned_aborts_permission_denied_without_trailer():
    svc = _blend_svc([_cell("AAPL", trades=3)])
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
    ctx = await _score_aborts(svc)
    assert ctx.abort.await_args.args == (
        grpc.StatusCode.PERMISSION_DENIED,
        "strategy not found or not owned",
    )
    ctx.set_trailing_metadata.assert_not_called()
    svc._scores_repo.upsert.assert_not_awaited()
    svc._scores_repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_backtest_keeps_grade_and_warns_on_unknown(caplog):
    svc = _svc()
    svc._recompute_headline = AsyncMock(side_effect=_GradeInputsUnknown("SCHD"))
    with caplog.at_level(logging.WARNING):
        result = await svc.RunBacktest(_req(_blend(), ["AAPL"]), context=_owned_ctx())
    assert result.status == analysis_pb2.BACKTEST_STATUS_OK
    assert any(_UNKNOWN_MSG in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_update_keeps_db_grade_and_forwards_trio(caplog):
    svc = _blend_svc([_cell("AAPL", trades=3)])
    _stub_update_repo(svc, _updated_row())
    svc._recompute_headline_locked = AsyncMock(side_effect=_GradeInputsUnknown("AAPL"))
    with caplog.at_level(logging.WARNING):
        resp = await svc.ManageStrategy(_update_req(), _owned_ctx())
    assert resp.strategy_id == "s1"
    assert dict(svc._recompute_headline_locked.await_args.kwargs["meta"]) == _TRIO
    assert svc._recompute_headline_locked.await_args.kwargs.get("sem") is None
    svc._scores_repo.delete.assert_not_awaited()
    assert any(
        "failed to recompute headline after update" in r.getMessage() for r in caplog.records
    )


@pytest.mark.asyncio
async def test_boot_pass_keeps_grade_on_unknown(caplog):
    svc = _blend_svc([_cell("AAPL", trades=3)])
    svc._scores_repo.list_unscored_pairs = AsyncMock(return_value=[("u1", _SID)])
    svc._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=_rpc_error())
    with caplog.at_level(logging.WARNING):
        assert await svc.recompute_unscored_pairs() == 1
    svc._scores_repo.delete.assert_not_awaited()
    svc._scores_repo.upsert.assert_not_awaited()
    assert any("boot recompute failed" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_formula_outage_keeps_grade_and_schd_not_counted():
    svc = _blend_svc([_cell("AAPL", trades=3), _cell("SCHD")])
    svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error())
    with pytest.raises(_GradeInputsUnknown):
        await svc._recompute_headline("u1", _SID)
    svc._scores_repo.upsert.assert_not_awaited()
    svc._scores_repo.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_level_failure_freezes_grade_with_older_eligible_cell():
    svc = _blend_svc([_cell("AAPL", trades=3, end=date(2024, 12, 1))])
    failures = {("pit", "AAPL"): Availability.UNKNOWN}
    with pytest.raises(_GradeInputsUnknown):
        await svc._fetch_and_aggregate(
            "u1", _SID, await svc._strategies_repo.get_by_owner_and_id("u1", _SID),
            fund_cache={"AAPL": []}, failures=failures,
        )  # fmt: skip
    svc._marketdata.GetHistoricalFundamentals.assert_not_awaited()


# ── round-4 fix 2: filter before dedup ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refused_window_does_not_shadow_eligible_window():
    # The traded cell ranks first but its window ends before AAPL's first filing; the lower-ranked
    # zero-trade window covers filings and must be the one kept.
    cells = [
        _cell("AAPL", trades=5, days=60, end=date(2024, 4, 1)),
        _cell("AAPL", trades=0, days=200, end=date(2024, 12, 31)),
    ]
    score = await _blend_svc(cells)._recompute_headline("u1", _SID)
    assert score.evidence_symbols == 1
    assert score.evidence_days == 200


# ── bounds, semaphore and header pinning ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_boot_pass_shares_cache_and_takes_background_sem():
    cells = [_cell("AAPL", trades=3), _cell("SCHD")]
    svc = _blend_svc(cells)
    svc._scores_repo.list_unscored_pairs = AsyncMock(return_value=[("u1", _SID), ("u2", _SID)])
    svc._readiness_materializer_bars_sem = _CountingSem()
    assert await svc.recompute_unscored_pairs() == 2
    assert svc._marketdata.GetHistoricalFundamentals.await_count == 2  # distinct symbols
    assert svc._indicators.GetFormula.await_count == 1
    assert svc._readiness_materializer_bars_sem.acquired == 2
    metas = [
        c.kwargs["metadata"] for c in svc._marketdata.GetHistoricalFundamentals.await_args_list
    ]
    assert all(list(m) == [("x-user-id", "u1")] for m in metas)


@pytest.mark.asyncio
async def test_interactive_recompute_is_bounded_forwards_trio_and_skips_background_sem():
    symbols = [f"S{i}" for i in range(10)]
    pit = {s: AAPL_PIT_PERIODS for s in symbols}
    svc = _blend_svc([_cell(s, trades=1) for s in symbols], pit=pit)
    svc._readiness_materializer_bars_sem = _CountingSem()
    state = {"inflight": 0, "peak": 0}

    async def _slow(req, metadata=None, timeout=None):
        state["inflight"] += 1
        state["peak"] = max(state["peak"], state["inflight"])
        await asyncio.sleep(0.01)
        state["inflight"] -= 1
        return _proto_page(pit[req.symbol])

    svc._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=_slow)
    resp = await svc.ScoreStrategy(
        analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), _owned_ctx()
    )
    assert resp.evidence_symbols == 10
    assert _INTERACTIVE_DERIVATION_CONCURRENCY == 4
    assert state["peak"] == _INTERACTIVE_DERIVATION_CONCURRENCY
    assert svc._readiness_materializer_bars_sem.acquired == 0
    for call in svc._marketdata.GetHistoricalFundamentals.await_args_list:
        assert dict(call.kwargs["metadata"]) == _TRIO
    assert dict(svc._indicators.GetFormula.await_args.kwargs["metadata"]) == _TRIO


@pytest.mark.asyncio
async def test_concurrent_backtest_and_score_serialize_under_lock():
    svc = _svc()
    row = {
        "strategy_id": _SID,
        "user_id": "u1",
        "display_name": "Blend",
        "active": True,
        "definition_json": json_format.MessageToDict(_blend()),
    }
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=row)
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint = AsyncMock(
        return_value=[_cell("AAPL", trades=3)]
    )
    svc._scores_repo = AsyncMock()
    bt, score = await asyncio.gather(
        svc.RunBacktest(_req(_blend(), ["AAPL"]), context=_owned_ctx()),
        svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), _owned_ctx()),
    )
    assert bt.status == analysis_pb2.BACKTEST_STATUS_OK
    assert score.evidence_symbols == 1
    assert svc._backtest_run_symbols_repo.fetch_all_for_fingerprint.await_count == 2


@pytest.mark.asyncio
async def test_non_fundamentals_strategy_makes_no_marketdata_calls_byte_identical():
    cells = [_eligible_cell("AAPL"), _eligible_cell("MSFT", trades=0)]
    svc = _derivation_svc(cells)
    _wire(svc, cells)
    row = await svc._strategies_repo.get_by_owner_and_id("u1", "s1")
    score = await svc._fetch_and_aggregate("u1", "s1", row)
    expected = svc._derive_score_from_cells("s1", row, cells)
    assert score.SerializeToString() == expected.SerializeToString()
    assert svc._marketdata.method_calls == []
    assert svc._indicators.method_calls == []
    svc._backtest_run_symbols_repo.fetch_all_for_fingerprint.assert_not_awaited()


@pytest.mark.asyncio
async def test_gate_off_keeps_today_path():
    svc = _blend_svc([_cell("SCHD")], gate=False)
    svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(return_value=[_cell("SCHD")])
    score = await svc._recompute_headline("u1", _SID)
    assert score.evidence_symbols == 1
    assert svc._marketdata.method_calls == []


# ── @AC-12 (recompute clause) ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ac12_paged_history_is_drained_not_excluded():
    old = [fund_period(date(2000, 1, 1) + timedelta(days=30 * i)) for i in range(60)]
    pages = {"": _proto_page(old, token="p2"), "p2": _proto_page(AAPL_PIT_PERIODS)}
    svc = _blend_svc([_cell("AAPL", trades=3)])
    svc._marketdata.GetHistoricalFundamentals = AsyncMock(
        side_effect=lambda req, metadata=None, timeout=None: pages[req.page.page_token]
    )
    score = await svc._recompute_headline("u1", _SID)
    assert score is not None and score.evidence_symbols == 1
    assert svc._marketdata.GetHistoricalFundamentals.await_count == 2
