"""
Unit tests for the shared StrategyEvaluator (feature 047-strategy-engine).

Covers definition validation (FR-5), condition-tree evaluation with no look-ahead,
and the async evaluate() entry point with a mocked indicators stub.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.services.evaluator import (
    StrategyEvaluator,
    _eval_condition,
    _validate_definition,
)


def _builtin(ref_name="sma_fast", indicator="SMA", period=10.0):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator=indicator,
        params={"period": period},
    )


def _formula(ref_name="myf", formula_id="f-1"):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
        formula_id=formula_id,
    )


# ---------------------------------------------------------------------------
# _validate_definition (FR-5)
# ---------------------------------------------------------------------------


class TestValidateDefinition:
    def test_accepts_builtin_and_formula(self):
        d = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_builtin(), _formula()],
            entry_rule=json.dumps({"fn": ">", "lhs": "sma_fast", "rhs": 100}),
        )
        _validate_definition(d)  # should not raise

    def test_rejects_unknown_indicator(self):
        d = analysis_pb2.StrategyDefinition(components=[_builtin(indicator="NOPE")])
        with pytest.raises(ValueError, match="Unknown built-in indicator"):
            _validate_definition(d)

    def test_rejects_missing_formula_id(self):
        comp = analysis_pb2.StrategyComponent(
            ref_name="f", kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA
        )
        d = analysis_pb2.StrategyDefinition(components=[comp])
        with pytest.raises(ValueError, match="formula_id"):
            _validate_definition(d)

    def test_rejects_duplicate_ref_name(self):
        d = analysis_pb2.StrategyDefinition(components=[_builtin(), _builtin()])
        with pytest.raises(ValueError, match="Duplicate ref_name"):
            _validate_definition(d)

    def test_rejects_undefined_rule_ref(self):
        d = analysis_pb2.StrategyDefinition(
            components=[_builtin()],
            entry_rule=json.dumps({"fn": ">", "lhs": "missing", "rhs": 1}),
        )
        with pytest.raises(ValueError, match="not defined as a component ref_name"):
            _validate_definition(d)

    def test_rejects_invalid_json(self):
        d = analysis_pb2.StrategyDefinition(components=[_builtin()], entry_rule="{not json")
        with pytest.raises(ValueError, match="not valid JSON"):
            _validate_definition(d)


# ---------------------------------------------------------------------------
# _eval_condition — no look-ahead
# ---------------------------------------------------------------------------


class TestEvalCondition:
    def test_greater_than(self):
        series = {"a": [1.0, 2.0, 3.0]}
        node = {"fn": ">", "lhs": "a", "rhs": 2.5}
        assert _eval_condition(node, series, 0) is False
        assert _eval_condition(node, series, 2) is True

    def test_less_than(self):
        series = {"a": [5.0, 1.0]}
        node = {"fn": "<", "lhs": "a", "rhs": 2.0}
        assert _eval_condition(node, series, 0) is False
        assert _eval_condition(node, series, 1) is True

    def test_crosses_above_no_lookahead_at_bar0(self):
        series = {"a": [1.0, 3.0], "b": [2.0, 2.0]}
        node = {"fn": "crosses_above", "lhs": "a", "rhs": "b"}
        # bar 0 must always be False (no previous bar)
        assert _eval_condition(node, series, 0) is False
        # a goes 1->3 crossing above b=2
        assert _eval_condition(node, series, 1) is True

    def test_crosses_below(self):
        series = {"a": [3.0, 1.0], "b": [2.0, 2.0]}
        node = {"fn": "crosses_below", "lhs": "a", "rhs": "b"}
        assert _eval_condition(node, series, 1) is True

    def test_and_or(self):
        series = {"a": [10.0], "b": [1.0]}
        node = {
            "op": "AND",
            "conditions": [
                {"fn": ">", "lhs": "a", "rhs": 5},
                {"fn": "<", "lhs": "b", "rhs": 5},
            ],
        }
        assert _eval_condition(node, series, 0) is True


# ---------------------------------------------------------------------------
# StrategyEvaluator.evaluate (async)
# ---------------------------------------------------------------------------


class TestEvaluate:
    @pytest.mark.asyncio
    async def test_evaluate_produces_per_bar_decisions(self):
        closes = [90.0, 95.0, 105.0, 110.0]
        bars = [SimpleNamespace(close=c, timestamp=None) for c in closes]
        # indicators stub returns an aligned SMA series == closes
        result_points = [SimpleNamespace(value=c) for c in closes]
        stub = AsyncMock()
        stub.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=result_points))

        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_builtin(ref_name="fast")],
            entry_rule=json.dumps({"fn": ">", "lhs": "fast", "rhs": 100}),
            exit_rule=json.dumps({"fn": "<", "lhs": "fast", "rhs": 100}),
        )

        evaluator = StrategyEvaluator(stub, propagation_meta=())
        decisions = await evaluator.evaluate(definition, bars, None)

        assert len(decisions) == len(bars)
        # fast > 100 at indices 2 and 3
        assert decisions[0].entry is False
        assert decisions[2].entry is True
        assert decisions[3].entry is True
        # exit (fast < 100) at indices 0 and 1
        assert decisions[0].exit is True
        assert decisions[2].exit is False

    @pytest.mark.asyncio
    async def test_evaluate_empty_bars(self):
        evaluator = StrategyEvaluator(AsyncMock(), propagation_meta=())
        definition = analysis_pb2.StrategyDefinition(components=[_builtin()])
        assert await evaluator.evaluate(definition, [], None) == []

    @pytest.mark.asyncio
    async def test_formula_component_forwards_input_params(self):
        """CUSTOM_FORMULA numeric params ride input_params; series stays in input_data."""
        from google.protobuf.struct_pb2 import Struct

        closes = [90.0, 95.0, 105.0, 110.0]
        bars = [SimpleNamespace(close=c, timestamp=None) for c in closes]
        output = Struct()
        output.update({"value": closes})
        resp = SimpleNamespace(success=True, output=output, error="")
        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(return_value=resp)

        comp = analysis_pb2.StrategyComponent(
            ref_name="myf",
            kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
            formula_id="f-1",
            params={"period": 14.0},
        )
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[comp],
            entry_rule=json.dumps({"fn": ">", "lhs": "myf", "rhs": 100}),
        )

        evaluator = StrategyEvaluator(stub, propagation_meta=())
        decisions = await evaluator.evaluate(definition, bars, None)

        assert len(decisions) == len(bars)
        stub.ExecuteFormula.assert_awaited()
        req = stub.ExecuteFormula.await_args.args[0]
        assert dict(req.input_params)["period"] == 14.0
        assert "close" in dict(req.input_data)
