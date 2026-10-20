"""Feature 215 — does a strategy that needs fundamentals have any it can actually evaluate?

Pure (no I/O). Every guarded surface (backtest refusal, grade derivation, live deny-entry,
opportunity skip row) asks ``assess`` the same question over the same evaluator inputs, so a
symbol is judged by whether the evaluator would execute, not by a copied core-metric list.
"""

import enum
from collections.abc import Mapping
from datetime import timedelta

from gen.analysis.v1 import analysis_pb2

from app.services.evaluator import (
    _fundamental_as_of_series,
    component_would_execute,
    fundamental_component_inputs,
)


class Availability(enum.Enum):
    NOT_REQUIRED = "not_required"
    NOT_ASSESSED = "not_assessed"
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"
    DISABLED = "disabled"


_PRECEDENCE = (
    Availability.UNAVAILABLE,
    Availability.UNKNOWN,
    Availability.DISABLED,
    Availability.AVAILABLE,
)


def _definition_has_fundamental(definition) -> bool:
    """True when any component is a COMPONENT_KIND_FUNDAMENTAL operand (feature 198). Module-level
    so both the servicer backtest path and the live loop share one definition-scan predicate."""
    return any(c.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL for c in definition.components)


def _definition_wants_fundamentals_formula(definition, formula_fund_map) -> bool:
    """Feature 200 — True when any CUSTOM_FORMULA component's ``formula_id`` maps to a non-empty
    fundamental-metric list in ``formula_fund_map`` (built by ``_formula_fundamentals``). Distinct
    from ``_definition_has_fundamental`` (the feature-198 single-metric operand): a
    fundamentals-only formula declares its inputs on the formula, not on the component."""
    if not formula_fund_map:
        return False
    return any(
        c.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA and formula_fund_map.get(c.formula_id)
        for c in definition.components
    )


def requires_fundamentals(definition, formula_fund_map) -> bool:
    """True when the definition reads a fundamental operand or a fundamentals-declaring formula."""
    return _definition_has_fundamental(definition) or _definition_wants_fundamentals_formula(
        definition, formula_fund_map
    )


def epoch_eval_dates(start, end, periods) -> list:
    """The dates at which the as-of fundamentals state can differ within ``[start, end]``.

    A filing is visible from ``filed_date + 1`` (strict ``filed_date < d``), so ``start`` plus each
    in-window visibility day gives the same ``assess`` answer as checking every calendar day."""
    visible = {p.filed_date + timedelta(days=1) for p in periods or ()}
    return [start] + sorted(d for d in visible if start < d <= end)


def assess(
    definition,
    formula_fund_map,
    eval_dates,
    *,
    symbol,
    pit,
    snap,
    failures: Mapping,
    gate_enabled: bool,
    bars_failed: bool = False,
) -> Availability:
    """Classify whether ``symbol`` has fundamentals this definition can evaluate on ``eval_dates``.

    ``failures`` maps ``("pit"|"snap", symbol)`` to the UNKNOWN/DISABLED state its loader
    recorded, and ``("formula", formula_id)`` to a formula-map outage. The formula channel is
    ``snap`` when given, else ``pit`` (as ``evaluator._assemble_component_series``); the 198
    operand reads ``pit``.
    The whole definition is judged, so OR-branch and exit-only fundamentals strategies are guarded
    too. Precedence across required components: UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE.
    """
    if not gate_enabled:
        return Availability.NOT_REQUIRED
    fmap = formula_fund_map or {}
    failures = failures or {}
    required = [
        c
        for c in definition.components
        if c.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL
        or (
            c.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA
            and (fmap.get(c.formula_id) or ("formula", c.formula_id) in failures)
        )
    ]
    if not required:
        return Availability.NOT_REQUIRED
    if bars_failed or not eval_dates:
        return Availability.NOT_ASSESSED

    states = set()
    for comp in required:
        if comp.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL:
            channel, data = ("pit", symbol), pit
        elif ("formula", comp.formula_id) in failures:
            states.add(Availability.UNKNOWN)
            continue
        elif snap is not None:
            channel, data = ("snap", symbol), snap
        else:
            channel, data = ("pit", symbol), pit
        if channel in failures:
            states.add(failures[channel])
            continue
        if comp.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL:
            series = _fundamental_as_of_series(comp.fundamental_metric, eval_dates, data)
            ok = any(v is not None for v in series)
        else:
            ok = component_would_execute(
                *fundamental_component_inputs(fmap[comp.formula_id], eval_dates, data)
            )
        states.add(Availability.AVAILABLE if ok else Availability.UNAVAILABLE)
    return next(s for s in _PRECEDENCE if s in states)
