"""Unit tests for the traced evaluator + deterministic conviction ordinal (feature 083).

Pins the PASS/SOFT/FAIL classification, the per-leaf lhs_value/threshold trace, and the
conviction ordinal (passing/total + normalized worst-distance) — the C-01 "formula must be
defined, not estimated" requirement. Also a teeth test: conviction must move when a leaf flips.

An inline StrategyDefinition literal is the single consumer here → inline is C-13 compliant.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.services.evaluator import (
    StrategyEvaluator,
    _conviction_ordinal,
    _eval_leaf_traced,
    _leaf_state,
    _readiness_from_evals,
)

PASS = analysis_pb2.CONDITION_STATE_PASS
SOFT = analysis_pb2.CONDITION_STATE_SOFT
FAIL = analysis_pb2.CONDITION_STATE_FAIL
UNSPEC = analysis_pb2.CONDITION_STATE_UNSPECIFIED


def _builtin(ref_name="sma", indicator="SMA", period=3.0):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator=indicator,
        params={"period": period},
    )


# ---------------------------------------------------------------------------
# (a) each supported fn emits the correct state
# ---------------------------------------------------------------------------


class TestLeafState:
    def test_gt(self):
        assert _leaf_state(3.0, 2.0, ">")[0] == PASS
        assert _leaf_state(2.0, 2.0, ">")[0] == SOFT  # equal → not passing (strict), within band
        assert _leaf_state(1.0, 2.0, ">")[0] == FAIL  # margin -1, norm -0.5 < -band

    def test_gte(self):
        assert _leaf_state(2.0, 2.0, ">=")[0] == PASS  # equal passes inclusive

    def test_lt(self):
        assert _leaf_state(1.0, 2.0, "<")[0] == PASS
        assert _leaf_state(2.0, 2.0, "<")[0] == SOFT
        assert _leaf_state(3.0, 2.0, "<")[0] == FAIL

    def test_lte(self):
        assert _leaf_state(2.0, 2.0, "<=")[0] == PASS

    def test_crosses_above(self):
        assert _leaf_state(3.0, 2.0, "crosses_above")[0] == PASS  # currently above
        assert _leaf_state(1.0, 2.0, "crosses_above")[0] == FAIL

    def test_crosses_below(self):
        assert _leaf_state(1.0, 2.0, "crosses_below")[0] == PASS  # currently below
        assert _leaf_state(3.0, 2.0, "crosses_below")[0] == FAIL

    def test_warmup_unresolved_is_unspecified(self):
        assert _leaf_state(None, 2.0, ">")[0] == UNSPEC
        assert _leaf_state(3.0, None, ">")[0] == UNSPEC

    def test_distance_sign(self):
        # passing → positive normalized margin; failing → negative.
        assert _leaf_state(3.0, 2.0, ">")[1] > 0
        assert _leaf_state(1.0, 2.0, ">")[1] < 0


def test_eval_leaf_traced_reports_values():
    series = {"a": [1.0, 3.0]}
    leaf = {"fn": ">", "lhs": "a", "rhs": 2.0}
    ev = _eval_leaf_traced(leaf, series, 1)
    assert ev["ref_name"] == "a"
    assert ev["lhs_value"] == 3.0
    assert ev["threshold"] == 2.0
    assert ev["fn"] == ">"
    assert ev["state"] == PASS


def test_eval_leaf_traced_ref_threshold():
    # rhs as a series ref resolves to that series' value at bar i.
    series = {"a": [5.0], "b": [4.0]}
    ev = _eval_leaf_traced({"fn": ">", "lhs": "a", "rhs": "b"}, series, 0)
    assert ev["lhs_value"] == 5.0 and ev["threshold"] == 4.0 and ev["state"] == PASS


# ---------------------------------------------------------------------------
# (b) passing/soft/fail mix → exact ordinal passing/total
# ---------------------------------------------------------------------------


def test_ordinal_exact_ratio_and_bounds():
    evals = [
        {"state": PASS, "distance_to_threshold": 0.5},
        {"state": PASS, "distance_to_threshold": 0.2},
        {"state": SOFT, "distance_to_threshold": -0.02},
        {"state": FAIL, "distance_to_threshold": -0.9},
    ]
    r = _readiness_from_evals("AAPL", evals)
    assert r["passing_conditions"] == 2
    assert r["total_conditions"] == 4
    # conviction sits inside the 2/4 bucket: >= 0.5 (ratio) and < 3/4 (never reaches next bucket).
    assert 0.5 <= r["conviction"] < 0.75


def test_ordinal_all_pass_is_one_none_is_zero():
    all_pass = [{"state": PASS, "distance_to_threshold": 0.1}] * 3
    assert _conviction_ordinal(3, 3, all_pass) == 1.0
    assert _conviction_ordinal(0, 0, []) == 0.0


# ---------------------------------------------------------------------------
# (c) teeth — conviction moves when a leaf flips (guards an inert formula)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_conviction_moves_when_leaf_flips():
    # entry_rule = AND(sma > 100, sma < 200). Feed a last-bar SMA that flips the 2nd leaf.
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s",
        display_name="S",
        components=[_builtin(ref_name="sma")],
        entry_rule=json.dumps(
            {
                "op": "AND",
                "conditions": [
                    {"fn": ">", "lhs": "sma", "rhs": 100},
                    {"fn": "<", "lhs": "sma", "rhs": 200},
                ],
            }
        ),
    )

    async def _readiness_for(last_close: float) -> dict:
        closes = [120.0, 130.0, last_close]
        bars = [SimpleNamespace(close=c, timestamp=None) for c in closes]
        points = [SimpleNamespace(value=c) for c in closes]
        stub = AsyncMock()
        stub.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=points))
        evaluator = StrategyEvaluator(stub, propagation_meta=())
        return await evaluator.evaluate_conditions_traced(definition, bars, "AAPL")

    both_pass = await _readiness_for(150.0)  # 100 < 150 < 200 → both pass
    one_fails = await _readiness_for(250.0)  # 250 > 100 ok; 250 < 200 fails

    assert both_pass["passing_conditions"] == 2 and both_pass["conviction"] == 1.0
    assert one_fails["passing_conditions"] == 1
    assert one_fails["conviction"] < both_pass["conviction"]  # teeth: it moved
    # the failing leaf is reported with its fn + values
    fail_leaf = [c for c in one_fails["conditions"] if c["state"] == FAIL][0]
    assert (
        fail_leaf["fn"] == "<"
        and fail_leaf["lhs_value"] == 250.0
        and fail_leaf["threshold"] == 200.0
    )


@pytest.mark.asyncio
async def test_no_bars_is_empty_readiness():
    stub = AsyncMock()
    evaluator = StrategyEvaluator(stub, propagation_meta=())
    r = await evaluator.evaluate_conditions_traced(
        analysis_pb2.StrategyDefinition(strategy_id="s"), [], "AAPL"
    )
    assert r == {
        "symbol": "AAPL",
        "conviction": 0.0,
        "passing_conditions": 0,
        "total_conditions": 0,
        "conditions": [],
    }
