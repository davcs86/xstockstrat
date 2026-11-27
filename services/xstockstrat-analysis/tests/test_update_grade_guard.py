"""Feature 327 — ManageStrategy UPDATE clears the in-memory grade only on a definition-hash change.

Covers @AC-5 (a rename during a GetFormula outage keeps the grade), the locked-row source of the
guard (never the unlocked `pre` read), the behavioural-edit pop and the no-evidence clear.
"""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format

from tests.test_analysis_servicer import (
    _derivation_svc,
    _eligible_cell,
    _owned_ctx,
    _stub_update_repo,
)
from tests.test_grade_fundamentals_exclusion import _rpc_error

_SID = "s1"
_KEY = ("u1", _SID)


def _definition(rhs=1, display_name="S1"):
    # user_id set as REGISTER persists it; the rename re-derives it from the column.
    return analysis_pb2.StrategyDefinition(
        strategy_id=_SID,
        user_id="u1",
        display_name=display_name,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="f", kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id="f-9"
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "f", "rhs": rhs}),
    )


def _row(rhs=1):
    return {
        "strategy_id": _SID,
        "user_id": "u1",
        "display_name": "S1",
        "active": True,
        "live_enabled": False,
        "definition_json": json_format.MessageToDict(
            _definition(rhs), preserving_proto_field_name=True
        ),
    }


def _rename_req():
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE,
        definition=analysis_pb2.StrategyDefinition(strategy_id=_SID, display_name="Renamed"),
    )
    req.update_mask.paths.append("display_name")
    return req


def _full_req(rhs):
    return analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=_definition(rhs)
    )


def _svc(locked_row, *, outage, cells=()):
    svc = _derivation_svc(list(cells), definition_json=locked_row["definition_json"])
    repo = _stub_update_repo(svc, locked_row)
    svc._indicators = MagicMock()
    if outage:
        svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error())
    else:
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-9", source="close")
        )
    seeded = analysis_pb2.StrategyScore(strategy_id=_SID, overall_score=0.7, rating="B")
    svc._strategies[_KEY] = seeded
    return svc, repo, seeded


def _record_presence_at_recompute(svc):
    """Wrap the real recompute; record whether the grade was still held when it started."""
    seen: list[bool] = []
    real = svc._recompute_headline_locked

    async def _wrapped(user_id, strategy_id, row, **kw):
        seen.append((user_id, strategy_id) in svc._strategies)
        return await real(user_id, strategy_id, row, **kw)

    svc._recompute_headline_locked = _wrapped
    return seen


@pytest.mark.asyncio
async def test_ac5_rename_during_formula_outage_keeps_grade():
    svc, _, seeded = _svc(_row(), outage=True)

    result = await svc.ManageStrategy(_rename_req(), context=_owned_ctx())

    assert result.display_name == "Renamed"
    assert svc._strategies[_KEY] is seeded
    svc._scores_repo.delete.assert_not_awaited()
    svc._scores_repo.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_guard_hashes_the_locked_row_not_the_pre_read():
    svc, repo, seeded = _svc(_row(rhs=1), outage=True)
    repo.get_by_owner_and_id = AsyncMock(return_value=_row(rhs=2))  # stale unlocked read

    await svc.ManageStrategy(_rename_req(), context=_owned_ctx())

    assert svc._strategies[_KEY] is seeded


@pytest.mark.asyncio
async def test_guard_pops_when_locked_row_differs_though_pre_matches_written():
    svc, repo, _ = _svc(_row(rhs=1), outage=True)
    repo.get_by_owner_and_id = AsyncMock(return_value=_row(rhs=2))  # pre == the written definition

    await svc.ManageStrategy(_full_req(rhs=2), context=_owned_ctx())

    assert _KEY not in svc._strategies


@pytest.mark.parametrize("outage", [True, False], ids=["outage", "readable"])
@pytest.mark.asyncio
async def test_behavioural_edit_pops_grade_before_recompute(outage):
    cells = [_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")]
    svc, _, seeded = _svc(_row(rhs=1), outage=outage, cells=cells)
    seen = _record_presence_at_recompute(svc)

    await svc.ManageStrategy(_full_req(rhs=2), context=_owned_ctx())

    assert seen == [False]
    if outage:
        assert _KEY not in svc._strategies  # documented limitation: no headline until recompute
    else:
        assert svc._strategies[_KEY] is not seeded
        svc._scores_repo.upsert.assert_awaited_once()


@pytest.mark.asyncio
async def test_unchanged_hash_with_zero_evidence_still_clears_grade():
    svc, _, _ = _svc(_row(), outage=False)
    seen = _record_presence_at_recompute(svc)

    await svc.ManageStrategy(_rename_req(), context=_owned_ctx())

    assert seen == [True]  # not popped up front; the recompute's no-evidence clear does it
    assert _KEY not in svc._strategies
    svc._scores_repo.delete.assert_awaited_once_with("u1", _SID)
