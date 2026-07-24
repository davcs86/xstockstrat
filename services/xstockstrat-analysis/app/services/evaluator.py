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
import math
from dataclasses import dataclass
from typing import Any

from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.json_format import MessageToDict
from google.protobuf.struct_pb2 import Struct

log = logging.getLogger(__name__)


class FormulaExecutionError(Exception):
    """A custom-formula component failed to execute or returned an out-of-contract
    series (feature 067). Carries the ``formula_id`` and the indicators ``resp.error``
    so the RunBacktest loop can stamp a distinct ``NO_TRADE_REASON_FORMULA_ERROR``
    diagnostic. Mirrors the failure-carrying shape of ``servicer._InsufficientData``."""

    def __init__(self, formula_id: str, error: str):
        super().__init__(f"formula {formula_id} failed: {error}")
        self.formula_id = formula_id
        self.error = error


def _finite_or_none(v) -> float | None:
    """Normalize a decoded series element: ``None``/``NaN``/``Inf`` → ``None``,
    otherwise the value as a ``float``. A non-numeric element is treated as ``None``
    (out of a numeric series' contract)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


_SUPPORTED_INDICATORS = {"SMA", "EMA", "RSI", "MACD", "BB", "ATR", "VWAP", "STOCH"}

# Output series each built-in indicator emits. The first entry ("value") is the
# primary series a bare ref_name resolves to; the rest are addressable in rules via
# the dotted form "<ref_name>.<series>" (e.g. "bb.upper", "macd.signal", "stoch.d").
# Mirrors the extra-key shape produced by xstockstrat-indicators' indicators_engine.py.
_INDICATOR_SERIES = {
    "SMA": ("value",),
    "EMA": ("value",),
    "RSI": ("value",),
    "MACD": ("value", "signal", "histogram"),
    "BB": ("value", "upper", "lower"),
    "ATR": ("value",),
    "VWAP": ("value",),
    "STOCH": ("value", "d"),
}

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

        Thin back-compat wrapper: returns only the ``list[BarDecision]`` so existing callers
        (the feature-048 live loop, list-mocking tests) are unaffected. Diagnostics-bearing
        callers use ``evaluate_with_series`` for the computed component series (feature 064).
        """
        decisions, _ = await self.evaluate_with_series(definition, bars, signals_map)
        return decisions

    async def evaluate_with_series(
        self,
        definition,  # analysis_pb2.StrategyDefinition
        bars: list,  # list of OHLCV bar proto messages with .close, .timestamp
        signals_map: dict[str, list] | None = None,
    ) -> tuple[list[BarDecision], dict[str, list]]:
        """
        Like ``evaluate`` but also returns the computed ``component_series`` dict (feature 064).

        Steps:
        1. Validate definition (FR-5): check components, entry_rule, exit_rule.
        2. Compute component series for all bars (no look-ahead).
        3. Evaluate entry_rule and exit_rule condition trees bar by bar.
        4. Return (one BarDecision per bar, component_series).

        ``component_series`` maps a bare ``ref_name`` to its primary series and every emitted
        series to ``<ref_name>.<series>`` — the same keys ``_eval_condition`` resolves against.
        """
        if not bars:
            return [], {}

        # Step 1: validate definition
        _validate_definition(definition)

        closes = [b.close for b in bars]

        # Step 2: compute component series
        # Each component may emit several series (e.g. Bollinger Bands → value/upper/lower).
        # A bare ref_name resolves to the primary "value" series; every emitted series is
        # also addressable in rules as "<ref_name>.<series>" (e.g. "bb.upper").
        component_series = {}
        for comp in definition.components:
            series_map = await self._compute_component(comp, closes)
            primary = series_map.get("value", [None] * len(closes))
            component_series[comp.ref_name] = primary  # bare ref → primary series
            for series_name, series in series_map.items():
                component_series[f"{comp.ref_name}.{series_name}"] = series

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
        return decisions, component_series

    async def _compute_component(self, comp, closes: list[float]) -> dict[str, list[float | None]]:
        """
        Compute a single component's output series over all bars.

        Returns a mapping of series name → aligned list (len == len(closes)). Every
        component yields at least a "value" series (the primary output); multi-output
        indicators/formulas add extra named series (e.g. "upper"/"lower" for BB,
        "signal"/"histogram" for MACD), which become addressable in rules as
        "<ref_name>.<series>".
        """
        n = len(closes)
        if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
            resp = await self._indicators.ComputeIndicator(
                indicators_pb2.ComputeIndicatorRequest(
                    indicator=comp.indicator,
                    values=closes,
                    params=dict(comp.params),
                ),
                metadata=self._meta,
            )
            return align_indicator_points(resp.result, n)
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
                # feature 067: a failed formula is a genuine error, not an all-None series.
                raise FormulaExecutionError(comp.formula_id, resp.error)
            # feature 067: MessageToDict recursively converts the Struct (incl. ListValue)
            # to native python — dict(resp.output) leaves a list output as a ListValue,
            # which the old isinstance(list, tuple) gate dropped → all-None (canonical
            # decode: screener.py). Formula output must contain a "value" key with a list;
            # any additional list-valued outputs become secondary series ("<ref_name>.<key>").
            # MessageToDict refuses to serialize NaN/Inf number_values (JSON has no such
            # literal); a formula emitting them is out-of-contract, so surface it as a
            # visible FORMULA_ERROR rather than letting the ValueError degrade silently.
            # A legitimate warm-up head is a null (None) element, which decodes cleanly.
            try:
                output = MessageToDict(resp.output)
            except ValueError as e:
                raise FormulaExecutionError(comp.formula_id, resp.error or str(e)) from e
            series: dict[str, list[float | None]] = {}
            for key, raw in output.items():
                # Non-list (scalar) values are dropped; scalar-broadcast is deferred
                # (design § Rejected).
                if not isinstance(raw, list):
                    continue
                # Custom-formula length policy: require len == n and raise on any
                # mismatch (len<n, len>n, empty). Unlike the builtin path, an arbitrary
                # user formula has no contiguous warm-up-head invariant to tail-align
                # against, so tail-aligning a short list would silently misalign bars.
                if len(raw) != n:
                    raise FormulaExecutionError(
                        comp.formula_id,
                        resp.error or f"series '{key}' length {len(raw)} != {n} bars",
                    )
                series[key] = [_finite_or_none(v) for v in raw]
            if "value" not in series:
                # An absent/empty "value" series is the AC-3 failure, not a silent
                # [None] * n. (An all-None/all-NaN len==n series passes through above as
                # a legitimate warm-up range.)
                raise FormulaExecutionError(
                    comp.formula_id, resp.error or "formula output missing a 'value' series"
                )
            return series
        return {"value": [None] * n}


def align_indicator_points(result_points, n: int) -> dict[str, list[float | None]]:
    """Tail-align ``ComputeIndicatorResponse.result`` points to the ``n`` input bars.

    The indicators servicer omits warm-up rows (the engine's contiguous NaN head)
    from its result without preserving indices, so a shorter result describes the
    LAST ``len(result_points)`` bars. Placing point ``i`` at bar
    ``i + (n - len(result_points))`` restores bar alignment; the leading bars stay
    ``None`` as warm-up. Relies on the invariant that the only absent rows are that
    contiguous head — true for every built-in engine (rolling-window NaN heads).

    Each ``IndicatorPoint`` carries the primary ``.value`` plus an ``.extra`` map of
    secondary series (upper/lower/signal/…); all are captured and aligned.
    """
    series: dict[str, list[float | None]] = {"value": [None] * n}
    offset = max(0, n - len(result_points))
    for i, p in enumerate(result_points):
        idx = i + offset
        if idx >= n:
            break
        series["value"][idx] = p.value
        for k, v in dict(getattr(p, "extra", {}) or {}).items():
            series.setdefault(k, [None] * n)[idx] = v
    return series


def _validate_definition(definition, formula_outputs: dict | None = None) -> None:
    """FR-5: Validate at write time. Raises ValueError on invalid definition.

    ``formula_outputs`` optionally maps a custom-formula ``formula_id`` to the set of
    series it exposes (always including the implicit ``"value"``). When supplied, a
    dotted ``<ref_name>.<series>`` reference into a formula component is checked against
    that set — a formula that declares no extra outputs exposes only ``"value"``. When
    omitted (e.g. the runtime evaluate path, already validated at write time), formula
    series references are not statically checked.
    """
    ref_names = set()
    ref_to_comp = {}
    for comp in definition.components:
        if not comp.ref_name:
            raise ValueError("Each component must have a non-empty ref_name")
        if comp.ref_name in ref_names:
            raise ValueError(f"Duplicate ref_name: {comp.ref_name}")
        ref_names.add(comp.ref_name)
        ref_to_comp[comp.ref_name] = comp
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

    # Re-entry cooldown (feature 069, FR-6): a negative value is rejected at write time. Unset never
    # triggers this (no HasField); an explicit 0 (no-cooldown) passes.
    if definition.HasField("cooldown_days") and definition.cooldown_days < 0:
        raise ValueError("cooldown_days must be >= 0")

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
        _validate_rule_refs(rule, ref_to_comp, rule_name, formula_outputs)


def _validate_term_ref(
    term: str, ref_to_comp: dict, rule_name: str, side: str, formula_outputs: dict | None
) -> None:
    """
    Validate a string operand: either a component ref_name, or the dotted form
    "<ref_name>.<series>" selecting a specific output series of that component.

    For built-in indicators the series must be one the indicator actually emits
    (see _INDICATOR_SERIES). For custom formulas the series is checked against the
    declared outputs in ``formula_outputs`` when available (a formula with no declared
    outputs exposes only "value"); when ``formula_outputs`` is None the formula series
    is not statically checked.
    """
    base, sep, series = term.partition(".")
    comp = ref_to_comp.get(base)
    if comp is None:
        raise ValueError(
            f"{rule_name}: leaf node {side}='{term}' is not defined as a component ref_name"
        )
    if not sep:
        return  # bare ref → primary "value" series, always valid
    if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
        allowed = _INDICATOR_SERIES.get(comp.indicator.upper(), ("value",))
        if series not in allowed:
            raise ValueError(
                f"{rule_name}: indicator '{comp.indicator}' (ref '{base}') has no output "
                f"series '{series}'. Available: {sorted(allowed)}"
            )
    elif comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA and formula_outputs is not None:
        # "value" is implicit; a formula with no declared outputs exposes only it.
        allowed = formula_outputs.get(comp.formula_id, {"value"})
        if series not in allowed:
            raise ValueError(
                f"{rule_name}: formula '{comp.formula_id}' (ref '{base}') does not declare output "
                f"series '{series}'. Available: {sorted(allowed)}"
            )


def _validate_rule_refs(
    node: Any, ref_to_comp: dict, rule_name: str, formula_outputs: dict | None = None
) -> None:
    """Recursively validate that leaf-node operands reference defined components/series."""
    if "op" in node and node["op"] in ("AND", "OR"):
        for child in node.get("conditions", []):
            _validate_rule_refs(child, ref_to_comp, rule_name, formula_outputs)
    elif "fn" in node:
        lhs = node.get("lhs", "")
        if isinstance(lhs, str):
            _validate_term_ref(lhs, ref_to_comp, rule_name, "lhs", formula_outputs)
        # rhs may be a numeric literal (threshold) or a string operand (ref / ref.series).
        rhs = node.get("rhs")
        if isinstance(rhs, str):
            _validate_term_ref(rhs, ref_to_comp, rule_name, "rhs", formula_outputs)
        fn = node.get("fn", "")
        if fn not in _SUPPORTED_FNS:
            raise ValueError(
                f"{rule_name}: unsupported function '{fn}'. Supported: {sorted(_SUPPORTED_FNS)}"
            )
    else:
        raise ValueError(f"{rule_name}: unrecognized condition node structure: {node}")


def _iter_leaf_terms(node: Any):
    """Yield every string operand (leaf ``lhs``, and ``rhs`` when it is a ref string) across a
    rule tree. Non-raising: malformed/non-dict nodes are skipped. Shared traversal primitive
    used by ``referenced_refs`` (a numeric ``rhs`` threshold is naturally skipped)."""
    if not isinstance(node, dict):
        return
    if node.get("op") in ("AND", "OR"):
        for child in node.get("conditions", []):
            yield from _iter_leaf_terms(child)
    elif "fn" in node:
        lhs = node.get("lhs")
        if isinstance(lhs, str):
            yield lhs
        rhs = node.get("rhs")
        if isinstance(rhs, str):
            yield rhs


def referenced_refs(rule: Any) -> set[str]:
    """Non-raising: the set of component ref_names a parsed rule tree references, with dotted
    ``<ref>.<series>`` operands collapsed to their base ``<ref>`` (feature 064 Option-C warm-up).
    Returns an empty set for a falsy/empty rule."""
    if not rule:
        return set()
    return {term.partition(".")[0] for term in _iter_leaf_terms(rule)}


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
