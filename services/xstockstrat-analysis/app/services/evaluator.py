"""
Shared strategy evaluator for xstockstrat-analysis.
Reused by RunBacktest (feature 047) and the live runtime (feature 048).

Entry point:
    evaluator = StrategyEvaluator(indicators_stub, propagation_meta=())
    decisions = await evaluator.evaluate(definition, bars, signals_map)
    # returns list[BarDecision] — one per bar

BarDecision has fields: bar_index (int), entry (bool), exit (bool), conviction (float).
"""

import json
import logging
from dataclasses import dataclass
from typing import Any

from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.struct_pb2 import Struct

log = logging.getLogger(__name__)

_SUPPORTED_INDICATORS = {"SMA", "EMA", "RSI", "MACD", "BB", "ATR", "VWAP", "STOCH"}

# Supported condition functions in leaf nodes (FR-3)
_SUPPORTED_FNS = {"crosses_above", "crosses_below", ">", "<", ">=", "<="}


@dataclass
class BarDecision:
    bar_index: int
    entry: bool
    exit: bool
    conviction: float  # 0.0–1.0 combined conviction


class StrategyEvaluator:
    """
    Evaluates a StrategyDefinition against a window of OHLCV bars.

    Design constraints (AC-5, feature 048 reuse):
    - No backtest-only imports, parameters, or side effects in this class.
    - Accepts StrategyDefinition proto message, a list of OHLCV bar dicts, and an
      active signals_map (dict[source, list[signal]]) matching the RunBacktest convention.
    - Returns per-bar BarDecision list; no look-ahead (bar i only uses data from bars 0..i).
    - feature 048 calls evaluate() directly with no signature changes.
    """

    def __init__(self, indicators_stub, propagation_meta=()):
        """
        indicators_stub: IndicatorsServiceStub — used to compute built-in indicators
                         and execute custom formulas bar by bar.
        propagation_meta: list of (key, value) tuples propagated from inbound request.
        """
        self._indicators = indicators_stub
        self._meta = propagation_meta

    async def evaluate(
        self,
        definition,  # analysis_pb2.StrategyDefinition
        bars: list,  # list of OHLCV bar proto messages with .close, .timestamp
        signals_map: dict[str, list] | None = None,
    ) -> list[BarDecision]:
        """
        Compute per-bar entry/exit decisions for the given strategy definition.

        Steps:
        1. Validate definition (FR-5): check components, entry_rule, exit_rule.
        2. Compute component series for all bars (no look-ahead).
        3. Evaluate entry_rule and exit_rule condition trees bar by bar.
        4. Return one BarDecision per bar.
        """
        if not bars:
            return []

        # Step 1: validate definition
        _validate_definition(definition)

        closes = [b.close for b in bars]

        # Step 2: compute component series
        component_series = {}
        for comp in definition.components:
            series = await self._compute_component(comp, closes)
            component_series[comp.ref_name] = series  # list[float | None], len == len(bars)

        # Step 3: parse rules
        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None

        # Step 4: evaluate bar by bar
        decisions = []
        for i in range(len(bars)):
            entry = _eval_condition(entry_rule, component_series, i) if entry_rule else False
            exit_ = _eval_condition(exit_rule, component_series, i) if exit_rule else False
            conviction = 1.0 if entry else 0.0
            decisions.append(
                BarDecision(bar_index=i, entry=entry, exit=exit_, conviction=conviction)
            )
        return decisions

    async def _compute_component(self, comp, closes: list[float]) -> list[float | None]:
        """Compute a single component's series over all bars."""
        if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
            resp = await self._indicators.ComputeIndicator(
                indicators_pb2.ComputeIndicatorRequest(
                    indicator=comp.indicator,
                    values=closes,
                    params=dict(comp.params),
                ),
                metadata=self._meta,
            )
            # Build aligned list — None for warm-up bars where result is absent
            result_map = {i: p.value for i, p in enumerate(resp.result)}
            return [result_map.get(i) for i in range(len(closes))]
        elif comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
            input_struct = Struct()
            input_struct.update({"close": closes})
            # Numeric component params travel in input_params (not input_data); the
            # series stays in input_data. The engine applies declared defaults for
            # anything omitted (FR-7).
            params_struct = Struct()
            params_struct.update(dict(comp.params))
            resp = await self._indicators.ExecuteFormula(
                indicators_pb2.ExecuteFormulaRequest(
                    formula_id=comp.formula_id,
                    input_data=input_struct,
                    input_params=params_struct,
                ),
                metadata=self._meta,
            )
            if not resp.success:
                log.warning("formula %s execution failed: %s", comp.formula_id, resp.error)
                return [None] * len(closes)
            # Formula output must contain a "value" key with a list
            output = dict(resp.output)
            raw = output.get("value", [])
            return [float(v) if v is not None else None for v in raw]
        return [None] * len(closes)


def _validate_definition(definition) -> None:
    """FR-5: Validate at write time. Raises ValueError on invalid definition."""
    ref_names = set()
    for comp in definition.components:
        if not comp.ref_name:
            raise ValueError("Each component must have a non-empty ref_name")
        if comp.ref_name in ref_names:
            raise ValueError(f"Duplicate ref_name: {comp.ref_name}")
        ref_names.add(comp.ref_name)
        if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
            if comp.indicator.upper() not in _SUPPORTED_INDICATORS:
                raise ValueError(
                    f"Unknown built-in indicator '{comp.indicator}'. "
                    f"Supported: {sorted(_SUPPORTED_INDICATORS)}"
                )
        elif comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
            if not comp.formula_id:
                raise ValueError("COMPONENT_KIND_CUSTOM_FORMULA component must have formula_id set")
        else:
            raise ValueError(f"Unknown ComponentKind: {comp.kind}")

    # Validate rule JSON parsability and ref_name references
    for rule_name, rule_json in [
        ("entry_rule", definition.entry_rule),
        ("exit_rule", definition.exit_rule),
    ]:
        if not rule_json:
            continue
        try:
            rule = json.loads(rule_json)
        except json.JSONDecodeError as e:
            raise ValueError(f"{rule_name} is not valid JSON: {e}") from e
        _validate_rule_refs(rule, ref_names, rule_name)


def _validate_rule_refs(node: Any, ref_names: set[str], rule_name: str) -> None:
    """Recursively validate that all lhs ref_names in leaf nodes exist as components."""
    if "op" in node and node["op"] in ("AND", "OR"):
        for child in node.get("conditions", []):
            _validate_rule_refs(child, ref_names, rule_name)
    elif "fn" in node:
        lhs = node.get("lhs", "")
        if isinstance(lhs, str) and lhs not in ref_names:
            raise ValueError(
                f"{rule_name}: leaf node lhs='{lhs}' is not defined as a component ref_name"
            )
        fn = node.get("fn", "")
        if fn not in _SUPPORTED_FNS:
            raise ValueError(
                f"{rule_name}: unsupported function '{fn}'. Supported: {sorted(_SUPPORTED_FNS)}"
            )
    else:
        raise ValueError(f"{rule_name}: unrecognized condition node structure: {node}")


def _eval_condition(node: Any, series: dict[str, list], i: int) -> bool:
    """
    Evaluate a condition tree at bar index i. No look-ahead: only series[*][0..i] are visible.
    Returns True if the condition is satisfied at bar i.
    """
    if "op" in node and node["op"] == "AND":
        return all(_eval_condition(c, series, i) for c in node.get("conditions", []))
    if "op" in node and node["op"] == "OR":
        return any(_eval_condition(c, series, i) for c in node.get("conditions", []))

    # Leaf node
    lhs_ref = node.get("lhs")
    rhs = node.get("rhs")
    fn = node.get("fn", "")

    lhs_val = _resolve_term(lhs_ref, series, i)
    rhs_val = _resolve_term(rhs, series, i) if isinstance(rhs, str) else float(rhs)

    if lhs_val is None or rhs_val is None:
        return False  # warm-up period — no signal

    if fn == ">":
        return lhs_val > rhs_val
    if fn == "<":
        return lhs_val < rhs_val
    if fn == ">=":
        return lhs_val >= rhs_val
    if fn == "<=":
        return lhs_val <= rhs_val
    if fn == "crosses_above":
        if i == 0:
            return False
        prev_lhs = _resolve_term(lhs_ref, series, i - 1)
        prev_rhs = _resolve_term(rhs, series, i - 1) if isinstance(rhs, str) else rhs_val
        if prev_lhs is None or prev_rhs is None:
            return False
        return prev_lhs <= prev_rhs and lhs_val > rhs_val
    if fn == "crosses_below":
        if i == 0:
            return False
        prev_lhs = _resolve_term(lhs_ref, series, i - 1)
        prev_rhs = _resolve_term(rhs, series, i - 1) if isinstance(rhs, str) else rhs_val
        if prev_lhs is None or prev_rhs is None:
            return False
        return prev_lhs >= prev_rhs and lhs_val < rhs_val
    return False


def _resolve_term(term: Any, series: dict[str, list], i: int) -> float | None:
    """Resolve a term to a float: look up ref_name in series, or pass through numeric."""
    if isinstance(term, str):
        s = series.get(term, [])
        return s[i] if i < len(s) else None
    return float(term) if term is not None else None
