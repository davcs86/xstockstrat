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
from datetime import UTC
from typing import Any

import grpc
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.json_format import MessageToDict
from google.protobuf.struct_pb2 import Struct

log = logging.getLogger(__name__)

# Below this in-window overlap ratio between a benchmark (source_symbol) component's dates and
# the evaluated symbol's trading days, log a WARN so silent calendar-sparsity is observable.
_SOURCE_JOIN_SPARSITY_WARN = 0.5


def _bar_date(bar):
    """Trading-day date key for a marketdata bar (feature 152).

    Uses the same ``bar.time.ToDatetime(tzinfo=UTC)`` transform the live loop already
    relies on (``live_loop.py``); the date component is the join key that aligns a
    benchmark component's output series onto the evaluated symbol's timeline. Robust to
    per-symbol intraday timestamp differences, and lookahead-safe (benchmark date D maps
    only to evaluated date D — never a future bar). The real timestamp field is
    ``bar.time`` (NOT ``bar.timestamp``)."""
    return bar.time.ToDatetime(tzinfo=UTC).date()


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

# First entry ("value") is the primary series a bare ref_name resolves to; the rest are
# addressable as "<ref_name>.<series>". Must mirror xstockstrat-indicators' indicators_engine.py.
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

_SUPPORTED_FNS = {"crosses_above", "crosses_below", ">", "<", ">=", "<="}


@dataclass
class BarDecision:
    bar_index: int
    entry: bool
    exit: bool
    conviction: float  # 0.0–1.0


class StrategyEvaluator:
    """
    Evaluates a StrategyDefinition against a window of OHLCV bars.

    Design constraints (AC-5, feature 048 reuse):
    - No backtest-only imports, parameters, or side effects in this class.
    - Accepts StrategyDefinition proto message, a list of OHLCV bar dicts, and an
      active signals_map (dict[source, list[signal]]) matching the RunBacktest convention.
    - Returns per-bar BarDecision list; no look-ahead (bar i only uses data from bars 0..i).
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
        benchmark_bars: dict | None = None,
    ) -> list[BarDecision]:
        """
        Compute per-bar entry/exit decisions for the given strategy definition.

        Thin back-compat wrapper: returns only the ``list[BarDecision]`` so existing callers
        (the feature-048 live loop, list-mocking tests) are unaffected. Diagnostics-bearing
        callers use ``evaluate_with_series`` for the computed component series (feature 064).

        ``benchmark_bars`` (feature 152) maps a component's ``source_symbol`` to that
        symbol's preloaded bars; a component with a ``source_symbol`` absent from the map
        resolves to hold (see ``_assemble_component_series``).
        """
        decisions, _ = await self.evaluate_with_series(
            definition, bars, signals_map, benchmark_bars
        )
        return decisions

    async def evaluate_with_series(
        self,
        definition,  # analysis_pb2.StrategyDefinition
        bars: list,  # list of OHLCV bar proto messages with .close, .timestamp
        signals_map: dict[str, list] | None = None,
        benchmark_bars: dict | None = None,
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

        _validate_definition(definition)

        closes = [b.close for b in bars]
        # Computed lazily: the no-source path must never touch bar.time, or list-mocked bars
        # without a .time field break and byte-identity is lost.
        eval_dates = (
            [_bar_date(b) for b in bars]
            if any(c.source_symbol for c in definition.components)
            else None
        )

        component_series = {}
        for comp in definition.components:
            series_map = await self._assemble_component_series(
                comp, closes, eval_dates, benchmark_bars
            )
            primary = series_map.get("value", [None] * len(closes))
            component_series[comp.ref_name] = primary
            for series_name, series in series_map.items():
                component_series[f"{comp.ref_name}.{series_name}"] = series

        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None

        decisions = []
        for i in range(len(bars)):
            entry = _eval_condition(entry_rule, component_series, i) if entry_rule else False
            exit_ = _eval_condition(exit_rule, component_series, i) if exit_rule else False
            conviction = 1.0 if entry else 0.0
            decisions.append(
                BarDecision(bar_index=i, entry=entry, exit=exit_, conviction=conviction)
            )
        return decisions, component_series

    async def evaluate_conditions_traced(
        self,
        definition,  # analysis_pb2.StrategyDefinition
        bars: list,
        symbol: str,
        signals_map: dict[str, list]
        | None = None,  # reserved (entry-rule leaves are component refs)
        *,
        rule: str = "entry",
        benchmark_bars: dict | None = None,
    ) -> dict:
        """Additive sibling (feature 083). Trace the ``entry_rule`` (default) or, with
        ``rule="exit"`` (feature 097), the ``exit_rule`` condition leaves at the LAST bar —
        each leaf's ``lhs_value``, ``threshold``, ``fn``, PASS/SOFT/FAIL ``state`` and
        normalized ``distance_to_threshold`` — plus a deterministic conviction ordinal.

        ``rule`` selects which rule tree is traced (``"entry"`` for signal/watchlist candidates,
        ``"exit"`` for held+attributed candidates); the default preserves every existing caller.

        Does NOT touch ``evaluate`` / ``evaluate_with_series`` / ``_eval_condition``'s bool
        contract — the live loop and the frozen backtest conviction depend on them
        (insights.md 2026-07-08). Reuses the same ``_compute_component`` / ``component_series``
        assembly, so the traced values come from the identical ``_resolve_term`` lookups.

        Returns a ``SymbolReadiness``-shaped dict (snake_case) the servicer maps to proto:
        ``{symbol, conviction, passing_conditions, total_conditions, conditions:[…]}``.
        """
        if not bars:
            # Empty-bars logging is the CALLER's responsibility, not this shared function's: it
            # also runs in _compute_opportunities' per-user compute, where a WARN here would flood.
            return _empty_readiness(symbol)
        _validate_definition(definition)
        closes = [b.close for b in bars]
        eval_dates = (
            [_bar_date(b) for b in bars]
            if any(c.source_symbol for c in definition.components)
            else None
        )
        component_series: dict[str, list] = {}
        for comp in definition.components:
            series_map = await self._assemble_component_series(
                comp, closes, eval_dates, benchmark_bars
            )
            primary = series_map.get("value", [None] * len(closes))
            component_series[comp.ref_name] = primary
            for series_name, series in series_map.items():
                component_series[f"{comp.ref_name}.{series_name}"] = series
        rule_src = definition.exit_rule if rule == "exit" else definition.entry_rule
        parsed_rule = json.loads(rule_src) if rule_src else None
        last = len(bars) - 1
        leaves = list(_iter_leaves(parsed_rule)) if parsed_rule else []
        evals = [_eval_leaf_traced(leaf, component_series, last) for leaf in leaves]
        return _readiness_from_evals(symbol, evals)

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
            # Numeric params go in input_params, never input_data (which carries only the series).
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
                # A failed formula is a genuine error, not an all-None series.
                raise FormulaExecutionError(comp.formula_id, resp.error)
            # MessageToDict (not dict(resp.output), which drops a ListValue → all-None) decodes the
            # Struct; it raises ValueError on NaN/Inf, surfaced as FORMULA_ERROR not silent degrade.
            try:
                output = MessageToDict(resp.output)
            except ValueError as e:
                raise FormulaExecutionError(comp.formula_id, resp.error or str(e)) from e
            series: dict[str, list[float | None]] = {}
            for key, raw in output.items():
                # Scalar (non-list) values are dropped; scalar-broadcast is deferred.
                if not isinstance(raw, list):
                    continue
                # Require len == n and raise on any mismatch: a user formula has no warm-up-head
                # invariant to tail-align against, so tail-aligning a short list misaligns bars.
                if len(raw) != n:
                    raise FormulaExecutionError(
                        comp.formula_id,
                        resp.error or f"series '{key}' length {len(raw)} != {n} bars",
                    )
                series[key] = [_finite_or_none(v) for v in raw]
            if "value" not in series:
                # An absent/empty "value" series is a failure, not a silent [None] * n.
                raise FormulaExecutionError(
                    comp.formula_id, resp.error or "formula output missing a 'value' series"
                )
            return series
        return {"value": [None] * n}

    async def declared_formula_warmups(self, definition) -> dict[str, int]:
        """Build ``{formula_id: declared warmup_period}`` for a definition's custom-formula
        components via ``GetFormula`` (feature 152).

        Used by the live loop to size a formula-*benchmark* component's warmup with
        ``warmup.required_prefix_bars`` — the live path has no formula-warmup cache of its
        own, so without this a custom-formula benchmark gate would silently under-warm on
        live. An unreachable formula caches 0 (never fails evaluation). The backtest servicer
        keeps its own cache variant (``_declared_formula_warmup``) that additionally records
        soft-delete warnings (feature 086); this method is the live counterpart."""
        cache: dict[str, int] = {}
        for comp in definition.components:
            if (
                comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA
                and comp.formula_id
                and comp.formula_id not in cache
            ):
                try:
                    formula = await self._indicators.GetFormula(
                        indicators_pb2.GetFormulaRequest(formula_id=comp.formula_id),
                        metadata=self._meta,
                    )
                    cache[comp.formula_id] = int(getattr(formula, "warmup_period", 0) or 0)
                except grpc.RpcError:
                    cache[comp.formula_id] = 0
        return cache

    async def _assemble_component_series(
        self,
        comp,
        closes: list[float],
        eval_dates: list,
        benchmark_bars: dict | None = None,
    ) -> dict[str, list[float | None]]:
        """Compute a component's output series, honoring an optional ``source_symbol``
        benchmark operand (feature 152).

        This is the single computation unit behind every StrategyComponent-consuming
        site (backtest, live, readiness/opportunities, GetIndicatorSeries), so a
        ``source_symbol`` component behaves identically everywhere.

        - Empty ``source_symbol`` → delegates to ``_compute_component(comp, closes)``
          unchanged (byte-identical to the pre-feature-152 path).
        - Truthy ``source_symbol`` → computes the indicator/formula on the *benchmark's*
          own contiguous closes (compute-then-align: ``align_indicator_points`` / the
          formula ``len==n`` policy assume a contiguous warm-up head, so a gap-injected
          input would misalign), then LEFT-JOINs each output series onto ``eval_dates``
          keyed on the trading-day date. A missing benchmark date → ``None`` (the leaf
          reads hold/false via ``_resolve_term``); no forward-fill; the evaluated symbol
          is never reindexed; no lookahead (date D → date D only).
        - Truthy ``source_symbol`` but no bars supplied for it → all-``None`` (safe hold),
          NEVER computed on the evaluated ``closes``. Callers that do not preload a
          benchmark therefore degrade to hold rather than to a wrong-symbol value.
        """
        n = len(closes)
        source_symbol = comp.source_symbol
        if not source_symbol:
            return await self._compute_component(comp, closes)

        bench_bars = (benchmark_bars or {}).get(source_symbol)
        if not bench_bars:
            return {"value": [None] * n}

        bench_closes = [b.close for b in bench_bars]
        bench_series = await self._compute_component(comp, bench_closes)

        # date → benchmark index (last bar wins on a duplicate date — daily bars are unique)
        idx_by_date: dict = {}
        for i, b in enumerate(bench_bars):
            idx_by_date[_bar_date(b)] = i

        matched = sum(1 for d in eval_dates if d in idx_by_date)
        if eval_dates and matched / len(eval_dates) < _SOURCE_JOIN_SPARSITY_WARN:
            log.warning(
                "benchmark source_symbol=%s ref=%s: only %d/%d evaluated bars matched a "
                "benchmark trading day — benchmark gate reads hold on the rest",
                source_symbol,
                comp.ref_name,
                matched,
                len(eval_dates),
            )

        aligned: dict[str, list[float | None]] = {}
        for name, series in bench_series.items():
            aligned[name] = [
                series[idx_by_date[d]] if d in idx_by_date else None for d in eval_dates
            ]
        return aligned


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

    # Negative rejected at write; unset (no HasField) and an explicit 0 (no cooldown) both pass.
    if definition.HasField("cooldown_days") and definition.cooldown_days < 0:
        raise ValueError("cooldown_days must be >= 0")

    # Negative rejected at write; unset (no HasField) and an explicit 0 (no min hold) both pass.
    if definition.HasField("exit_cooldown_days") and definition.exit_cooldown_days < 0:
        raise ValueError("exit_cooldown_days must be >= 0")

    # A non-empty signal_params.symbols allowlist and signal_eligible=true are contradictory (both
    # set the universe) — rejected on the MERGED definition, so a two-step masked update is caught.
    _allowlist = []
    if definition.HasField("signal_params"):
        _allowlist = MessageToDict(definition.signal_params).get("symbols") or []
    if _allowlist and definition.signal_eligible:
        raise ValueError(
            "signal_eligible=true conflicts with a non-empty signal_params.symbols allowlist "
            "(the allowlist is already an explicit universe override)"
        )

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


# ── Traced readiness / conviction ────────────────────────────────────────────
# Conviction is a DETERMINISTIC ORDINAL (passing/total leaves + normalized worst-distance
# tie-breaker), NOT a probability — the UI renders "N/M conditions", never a fabricated %.

# Fraction of the threshold within which a not-yet-passing leaf counts as SOFT.
_READINESS_SOFT_BAND = 0.05


def _iter_leaves(node: Any):
    """Yield every leaf (``fn``) node across an AND/OR condition tree. Non-raising:
    malformed/non-dict nodes are skipped."""
    if not isinstance(node, dict):
        return
    if node.get("op") in ("AND", "OR"):
        for child in node.get("conditions", []):
            yield from _iter_leaves(child)
    elif "fn" in node:
        yield node


def _leaf_state(
    lhs: float | None, threshold: float | None, fn: str, soft_band: float = _READINESS_SOFT_BAND
) -> tuple[int, float]:
    """Classify one leaf at the last bar into (ConditionState, normalized distance).

    ``distance`` is the signed margin on the PASSING side, normalized by the threshold
    magnitude: > 0 means comfortably passing, 0 at the threshold, < 0 not passing. A
    ``crosses_above``/``crosses_below`` leaf is read as its current above/below position
    (a cross is momentary; readiness reports proximity to the boundary)."""
    if lhs is None or threshold is None:
        return analysis_pb2.CONDITION_STATE_UNSPECIFIED, 0.0
    if fn in (">", ">=", "crosses_above"):
        margin = lhs - threshold
    elif fn in ("<", "<=", "crosses_below"):
        margin = threshold - lhs
    else:
        return analysis_pb2.CONDITION_STATE_UNSPECIFIED, 0.0
    denom = max(abs(threshold), abs(lhs), 1e-9)
    norm = margin / denom
    if fn in (">", "crosses_above"):
        passed = lhs > threshold
    elif fn == ">=":
        passed = lhs >= threshold
    elif fn in ("<", "crosses_below"):
        passed = lhs < threshold
    else:  # "<="
        passed = lhs <= threshold
    if passed:
        return analysis_pb2.CONDITION_STATE_PASS, norm
    if norm >= -soft_band:
        return analysis_pb2.CONDITION_STATE_SOFT, norm
    return analysis_pb2.CONDITION_STATE_FAIL, norm


def _eval_leaf_traced(leaf: dict, series: dict[str, list], i: int) -> dict:
    """Emit a ConditionEval-shaped dict for a single leaf at bar ``i`` using the same
    ``_resolve_term`` values ``_eval_condition`` reads."""
    lhs_ref = leaf.get("lhs")
    rhs = leaf.get("rhs")
    fn = leaf.get("fn", "")
    lhs_val = _resolve_term(lhs_ref, series, i)
    if isinstance(rhs, str):
        threshold = _resolve_term(rhs, series, i)
    else:
        threshold = float(rhs) if rhs is not None else None
    state, dist = _leaf_state(lhs_val, threshold, fn)
    return {
        "ref_name": lhs_ref if isinstance(lhs_ref, str) else "",
        "lhs_value": lhs_val if lhs_val is not None else 0.0,
        "threshold": threshold if threshold is not None else 0.0,
        "fn": fn,
        "state": state,
        "distance_to_threshold": dist,
    }


def _conviction_ordinal(passing: int, total: int, evals: list[dict]) -> float:
    """Deterministic conviction in [0, 1]: the passing/total ratio, nudged within a single
    ratio-bucket by how close the nearest not-yet-passing leaf sits to its threshold. Strictly
    monotone in ``passing`` (the nudge is < 1/total), so it moves whenever a leaf flips
    (guards against an inert formula, insights.md 2026-07-27)."""
    if total == 0:
        return 0.0
    if passing == total:
        return 1.0
    pass_ratio = passing / total
    soft_or_fail = [
        e["distance_to_threshold"]
        for e in evals
        if e["state"] in (analysis_pb2.CONDITION_STATE_SOFT, analysis_pb2.CONDITION_STATE_FAIL)
    ]
    if soft_or_fail and _READINESS_SOFT_BAND > 0:
        best = max(soft_or_fail)  # closest to the threshold (norm nearest 0, <= 0)
        closeness = min(max(1.0 + best / _READINESS_SOFT_BAND, 0.0), 1.0)
    else:
        closeness = 0.0
    return pass_ratio + (closeness * 0.999) / total


def _readiness_from_evals(symbol: str, evals: list[dict]) -> dict:
    """Assemble the SymbolReadiness-shaped dict from traced leaf evals."""
    total = len(evals)
    passing = sum(1 for e in evals if e["state"] == analysis_pb2.CONDITION_STATE_PASS)
    return {
        "symbol": symbol,
        "conviction": _conviction_ordinal(passing, total, evals),
        "passing_conditions": passing,
        "total_conditions": total,
        "conditions": evals,
    }


def _empty_readiness(symbol: str) -> dict:
    """Readiness for a symbol with no bars: zero conviction, no conditions."""
    return {
        "symbol": symbol,
        "conviction": 0.0,
        "passing_conditions": 0,
        "total_conditions": 0,
        "conditions": [],
    }
