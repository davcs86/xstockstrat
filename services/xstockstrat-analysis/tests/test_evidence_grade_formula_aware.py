"""Feature 327 — the derived grade reads evidence by the formula-aware fingerprint.

Covers @AC-1 (a referenced-formula edit stops pre-edit evidence feeding the grade), @AC-3 (a
score-time refusal grades on the newest formula-aware evidence, never on pre-feature cells) and
@AC-4 (gate off + GetFormula outage → UNAVAILABLE, grade untouched), plus the mixed-formula pin
(O-19) and owner isolation of digests through the boot pass.
"""

import logging
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format

from app.handlers.servicer import _definition_fingerprint, _evidence_fingerprint, _formula_digest
from tests.test_analysis_servicer import _derivation_svc, _owned_ctx
from tests.test_grade_fundamentals_exclusion import _UNKNOWN_MSG, _cell, _rpc_error

_GATE = "backtest.fundamentals.enabled"
_SID = "s1"
_GATE_OFF_MSG = "formula version unavailable — grade unchanged"
_RUN_A_BACKTEST = "no eligible evidence — run a backtest"


class _CellsRepo:
    """In-memory cells keyed by fingerprint, so a test proves which fingerprint is asked for."""

    def __init__(self, rows=()):
        self.rows = list(rows)  # (user_id, strategy_id, fingerprint, cell)
        self.asked: list[tuple[str, str, str]] = []

    def _match(self, user_id, strategy_id, fingerprint):
        return [
            c
            for u, s, fp, c in self.rows
            if u == user_id and s == strategy_id and fp == fingerprint
        ]

    async def fetch_eligible(self, user_id, strategy_id, fingerprint):
        self.asked.append((user_id, strategy_id, fingerprint))
        return self._match(user_id, strategy_id, fingerprint)

    async def fetch_all_for_fingerprint(self, user_id, strategy_id, fingerprint):
        self.asked.append((user_id, strategy_id, fingerprint))
        return self._match(user_id, strategy_id, fingerprint)

    async def latest_formula_fingerprint(self, user_id, strategy_id, def_hash):
        prefixed = [
            (c["completed_at"], fp)
            for u, s, fp, c in self.rows
            if u == user_id and s == strategy_id and fp and fp.startswith(def_hash + ".")
        ]
        return max(prefixed)[1] if prefixed else None

    async def insert_many(self, rows):
        self.rows.extend(rows)


def _definition(*fids):
    comps = [
        analysis_pb2.StrategyComponent(
            ref_name=f"f{i}", kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id=fid
        )
        for i, fid in enumerate(fids)
    ]
    return json_format.MessageToDict(
        analysis_pb2.StrategyDefinition(
            strategy_id=_SID, display_name="S1", components=comps, entry_rule='{"op": "AND"}'
        )
    )


def _formula(fid="f-9", source="close > open", author="alice"):
    return indicators_pb2.FormulaDefinition(formula_id=fid, name=fid, source=source, author=author)


_DJ = _definition("f-9")
_V1 = _formula()
_V2 = _formula(source="close < open")
_FP_V1 = _evidence_fingerprint(_DJ, {"f-9": _formula_digest(_V1)})


def _svc(repo, *, gate, formula=None, dj=_DJ):
    svc = _derivation_svc([], definition_json=dj, strategy_id=_SID)
    svc._backtest_run_symbols_repo = repo
    svc._cfg.get_bool = MagicMock(side_effect=lambda k, d=False: gate if k == _GATE else d)
    svc._indicators = MagicMock()
    svc._indicators.GetFormula = AsyncMock(return_value=formula or _V1)
    return svc


def _rows(fingerprint, symbols, *, user_id="u1", done=date(2025, 2, 1)):
    return [(user_id, _SID, fingerprint, _cell(s, trades=3, done=done)) for s in symbols]


async def _score(svc):
    req = analysis_pb2.ScoreStrategyRequest(strategy_id=_SID)
    return await svc.ScoreStrategy(req, _owned_ctx())


async def _score_aborts(svc):
    ctx = _owned_ctx()
    with pytest.raises(Exception, match="aborted"):
        await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)
    return ctx.abort.await_args.args


def _seed_grade(svc, user_id="u1"):
    svc._strategies[(user_id, _SID)] = analysis_pb2.StrategyScore(
        strategy_id=_SID, overall_score=0.7, rating="B"
    )


# ── @AC-1 ────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("gate", [True, False], ids=["gate_on", "gate_off"])
@pytest.mark.asyncio
async def test_ac1_formula_edit_stops_pre_edit_evidence(gate):
    repo = _CellsRepo(_rows(_FP_V1, ["AAPL", "MSFT", "NVDA"]))
    svc = _svc(repo, gate=gate)
    assert (await _score(svc)).evidence_symbols == 3

    svc._indicators.GetFormula = AsyncMock(return_value=_formula(author="bob"))
    assert (await _score(svc)).evidence_symbols == 3  # author is DISPLAY

    svc._indicators.GetFormula = AsyncMock(return_value=_V2)
    assert await _score_aborts(svc) == (grpc.StatusCode.NOT_FOUND, _RUN_A_BACKTEST)
    assert ("u1", _SID) not in svc._strategies
    svc._scores_repo.delete.assert_awaited_with("u1", _SID)
    assert len(repo.rows) == 3  # @AC-11 @feature-215: cells are never deleted
    assert repo.asked[-1][2] == _evidence_fingerprint(_DJ, {"f-9": _formula_digest(_V2)})


# ── @AC-3 ────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("code", [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED])
@pytest.mark.parametrize("gate", [True, False], ids=["gate_on", "gate_off"])
@pytest.mark.asyncio
async def test_ac3_refusal_grades_on_newest_formula_aware_cells(gate, code):
    def_hash = _definition_fingerprint(_DJ)
    older = _evidence_fingerprint(_DJ, {"f-9": "0" * 64})
    repo = _CellsRepo(_rows(def_hash, ["AAPL", "MSFT"]) + _rows(older, ["AAPL"]))
    svc = _svc(repo, gate=gate)
    svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error(code))
    assert (await _score(svc)).evidence_symbols == 1
    assert repo.asked == [("u1", _SID, older)]


@pytest.mark.parametrize("code", [grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED])
@pytest.mark.asyncio
async def test_ac3_refusal_with_only_pre_feature_cells_names_the_formula(code):
    repo = _CellsRepo(_rows(_definition_fingerprint(_DJ), ["AAPL", "MSFT"]))
    svc = _svc(repo, gate=False)
    svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error(code))
    status, msg = await _score_aborts(svc)
    assert status == grpc.StatusCode.NOT_FOUND
    assert "f-9" in msg and "not readable" in msg
    assert msg != _RUN_A_BACKTEST
    assert repo.asked == []  # bare cells are never read
    svc._scores_repo.delete.assert_awaited_with("u1", _SID)


# ── @AC-4 ────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("gate", "msg"), [(False, _GATE_OFF_MSG), (True, _UNKNOWN_MSG)])
@pytest.mark.asyncio
async def test_ac4_gate_off_outage_aborts_unavailable_grade_untouched(gate, msg):
    repo = _CellsRepo(_rows(_FP_V1, ["AAPL"]))
    svc = _svc(repo, gate=gate)
    _seed_grade(svc)
    svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error())
    assert await _score_aborts(svc) == (grpc.StatusCode.UNAVAILABLE, msg)
    assert repo.asked == []
    svc._scores_repo.delete.assert_not_awaited()
    svc._scores_repo.upsert.assert_not_awaited()
    assert ("u1", _SID) in svc._strategies


# ── O-19: mixed refused and readable formulas use the newest composite as a whole ────────────


@pytest.mark.asyncio
async def test_mixed_refused_and_readable_formulas_use_newest_composite():
    dj = _definition("f-9", "f-7")
    newest = _evidence_fingerprint(dj, {"f-9": "1" * 64, "f-7": "2" * 64})
    older = _evidence_fingerprint(dj, {"f-9": "3" * 64, "f-7": "4" * 64})
    repo = _CellsRepo(
        _rows(newest, ["AAPL"], done=date(2025, 3, 1))
        + _rows(older, ["AAPL", "MSFT"], done=date(2025, 1, 1))
    )
    svc = _svc(repo, gate=False, dj=dj)

    async def _get_formula(req, metadata=None):
        if req.formula_id == "f-9":
            raise _rpc_error(grpc.StatusCode.NOT_FOUND)
        return _formula("f-7")

    svc._indicators.GetFormula = AsyncMock(side_effect=_get_formula)
    assert (await _score(svc)).evidence_symbols == 1
    assert repo.asked == [("u1", _SID, newest)]


# ── owner isolation through the boot pass ────────────────────────────────────────────────────


@pytest.mark.parametrize("u1_refused", [False, True], ids=["both_readable", "u1_refused"])
@pytest.mark.parametrize("pairs", [["u1", "u2"], ["u2", "u1"]], ids=["u1_first", "u2_first"])
@pytest.mark.asyncio
async def test_boot_pass_reads_each_owners_own_fingerprint(pairs, u1_refused):
    by_owner = {"u1": _V1, "u2": _V2}
    fp = {u: _evidence_fingerprint(_DJ, {"f-9": _formula_digest(f)}) for u, f in by_owner.items()}
    u1_older = _evidence_fingerprint(_DJ, {"f-9": "5" * 64})
    repo = _CellsRepo(
        _rows(fp["u1"], ["AAPL", "MSFT", "NVDA"], user_id="u1")
        + _rows(u1_older, ["AAPL", "MSFT"], user_id="u1", done=date(2024, 1, 1))
        + _rows(fp["u2"], ["AAPL"], user_id="u2")
    )
    if u1_refused:
        repo.rows = [r for r in repo.rows if r[2] != fp["u1"]]
    svc = _svc(repo, gate=False)
    svc._scores_repo.list_unscored_pairs = AsyncMock(return_value=[(u, _SID) for u in pairs])

    async def _get_formula(req, metadata=None):
        user = dict(metadata)["x-user-id"]
        if user == "u1" and u1_refused:
            raise _rpc_error(grpc.StatusCode.NOT_FOUND)
        return by_owner[user]

    svc._indicators.GetFormula = AsyncMock(side_effect=_get_formula)
    assert await svc.recompute_unscored_pairs() == 2
    asked = {u: f for u, _, f in repo.asked}
    assert asked["u2"] == fp["u2"]
    assert asked["u1"] == (u1_older if u1_refused else fp["u1"])
    assert asked["u1"] != asked["u2"]
    assert svc._strategies[("u2", _SID)].evidence_symbols == 1
    assert svc._strategies[("u1", _SID)].evidence_symbols == (2 if u1_refused else 3)


@pytest.mark.asyncio
async def test_boot_pass_formula_outage_keeps_grade(caplog):
    repo = _CellsRepo(_rows(_FP_V1, ["AAPL"]))
    svc = _svc(repo, gate=False)
    _seed_grade(svc)
    svc._scores_repo.list_unscored_pairs = AsyncMock(return_value=[("u1", _SID)])
    svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error())
    with caplog.at_level(logging.WARNING):
        assert await svc.recompute_unscored_pairs() == 1
    svc._scores_repo.delete.assert_not_awaited()
    svc._scores_repo.upsert.assert_not_awaited()
    assert ("u1", _SID) in svc._strategies
    assert repo.asked == []
    assert any("boot recompute failed" in r.getMessage() for r in caplog.records)
