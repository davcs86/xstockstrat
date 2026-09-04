"""Pre-window warm-up sizing for windowed backtests (feature 071).

A backtest given an explicit ``start`` loads bars from *before* ``start`` so indicators are
already warm at the first in-window bar, instead of burning the caller's window on warm-up.
This module answers one question — **how many bars of history does this definition need?** —
and answers it from *declared* parameters only.

Declared, never observed
------------------------
The prefix length is needed **before** the fetch, so it cannot be derived from an actual
series. That is also why observing it would be wrong: :func:`_first_resolved_index` in the
servicer infers warm-up from a ``None`` head, but three built-ins never emit one —
``_ema``/``_macd`` use ``ewm(adjust=False)`` and ``_vwap`` uses ``cumsum``, all of which
return a finite float at index 0 (``xstockstrat-indicators``
``app/services/indicators_engine.py:48-51,62-84,110-118``). An observed lookback for those is
always ``0``, so a "verify at runtime" guard built on it can never fire for exactly the
path-dependent indicators a history prefix affects most.

The universal ``+1``
--------------------
Every rolling lookback below carries a ``+1`` that is **not** slack: ``crosses_above`` /
``crosses_below`` read index ``i-1`` (``app/services/evaluator.py:447-448``, ``:455-456``), so a
series first *valid* at index ``v`` is only *usable* at ``v+1``.

IIR indicators need a convergence multiple, not their period
------------------------------------------------------------
``ewm(span=p, adjust=False)`` is an infinite impulse response filter: at bar ``p`` the seed
still carries ``(1 - 2/(p+1))**p -> e**-2 ~= 13.5%`` of the weight. ``period`` is a convention,
not a bound, so EMA/MACD use ``_IIR_CONVERGENCE_MULTIPLE`` periods (residual < 0.3%). The extra
bars are fetched and then discarded, so this costs nothing but I/O.

Duplicated defaults
-------------------
The default periods below are duplicated from ``xstockstrat-indicators`` because
``app/services/evaluator.py:187`` forwards only ``dict(comp.params)`` — an omitted ``period``
silently becomes the engine's default, and ``INDICATOR_REGISTRY["…"]["required"]`` is never
enforced (its only consumer is ``ListIndicators``). A pinning test in *that* service names this
module as the consumer to update if the defaults ever move.
"""

from __future__ import annotations

import json
import math

# Weight remaining in an ewm(adjust=False) seed after k*period bars is e**(-2k).
# 3 -> e**-6 ~= 0.25%, which is below any price tick's significance.
_IIR_CONVERGENCE_MULTIPLE = 3

# Mirror the indicator engine's `int(params.get(..., D))` defaults; keep the int() truncation
# identical — a rounded period would desynchronize the prefix from the engine's own window.
_DEFAULT_PERIOD = 14
_DEFAULT_BB_PERIOD = 20
_DEFAULT_MACD_FAST = 12
_DEFAULT_MACD_SLOW = 26
_DEFAULT_MACD_SIGNAL = 9

# A crossover leaf reads index i-1, so a series valid at v is usable at v+1.
_CROSSOVER_LOOKBACK = 1


def _int_param(params, key: str, default: int) -> int:
    """Read a numeric component param with the engine's exact `int(...)` truncation."""
    try:
        return int(params.get(key, default))
    except (TypeError, ValueError):
        return default


def builtin_lookback_bars(indicator: str, params) -> int:
    """Bars of history a built-in indicator needs before its first *usable* value.

    Returns 0 for an unknown indicator: `_validate_definition` already rejects those at write
    time, so an unknown name here means a definition that cannot run anyway — inflating the
    prefix for it would be guesswork (Constitution F-04: never invent).
    """
    name = (indicator or "").upper()
    params = params or {}

    if name in ("SMA", "BB"):
        default = _DEFAULT_BB_PERIOD if name == "BB" else _DEFAULT_PERIOD
        period = _int_param(params, "period", default)
        # rolling(period) is first valid at index period-1.
        return max(0, period - 1) + _CROSSOVER_LOOKBACK

    if name in ("RSI", "ATR"):
        period = _int_param(params, "period", _DEFAULT_PERIOD)
        # .diff() puts a NaN at index 0, so rolling(period) is first valid at index period.
        return period + _CROSSOVER_LOOKBACK

    if name == "STOCH":
        period = _int_param(params, "period", _DEFAULT_PERIOD)
        # k = rolling(period) valid at period-1; d = k.rolling(3) valid at period+1.
        return max(0, period - 1) + 2 + _CROSSOVER_LOOKBACK

    if name == "EMA":
        period = _int_param(params, "period", _DEFAULT_PERIOD)
        return _IIR_CONVERGENCE_MULTIPLE * period + _CROSSOVER_LOOKBACK

    if name == "MACD":
        fast = _int_param(params, "fast", _DEFAULT_MACD_FAST)
        slow = _int_param(params, "slow", _DEFAULT_MACD_SLOW)
        signal = _int_param(params, "signal", _DEFAULT_MACD_SIGNAL)
        # max(), not slow: nothing validates fast <= slow (`_validate_definition` never
        # inspects params), so `fast=50, slow=26` makes `fast` the binding lookback.
        return _IIR_CONVERGENCE_MULTIPLE * (max(fast, slow) + signal) + _CROSSOVER_LOOKBACK

    if name == "VWAP":
        # Expanding cumulative average, defined at index 0 — no warm-up of its own. But it is
        # anchored at index 0, so a sibling-driven prefix shifts every in-window VWAP value.
        return 0

    return 0


def required_prefix_bars(definition, formula_warmup_cache: dict | None = None) -> int:
    """Bars of pre-window history this definition needs before its first in-window bar.

    Only components the **active rules reference** count — an unreferenced component never
    gates a decision. Mirrors the ref-walk `_compute_evaluated_warmup` already performs.

    ``formula_warmup_cache`` maps ``formula_id -> declared warmup_period`` and must be
    pre-populated by the caller (the servicer owns the ``GetFormula`` RPC; this module stays
    pure and does no I/O). A formula missing from the cache contributes 0.
    """
    from app.services.evaluator import referenced_refs  # noqa: PLC0415 — avoid a cycle

    entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
    exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None
    refs = referenced_refs(entry_rule) | referenced_refs(exit_rule)
    if not refs:
        return 0

    cache = formula_warmup_cache or {}
    ref_to_comp = {c.ref_name: c for c in definition.components}

    prefix = 0
    for ref in refs:
        comp = ref_to_comp.get(ref)
        if comp is None:
            continue
        if _is_custom_formula(comp):
            declared = int(cache.get(comp.formula_id, 0) or 0)
            prefix = max(prefix, declared + _CROSSOVER_LOOKBACK if declared else 0)
        else:
            prefix = max(prefix, builtin_lookback_bars(comp.indicator, comp.params))
    return prefix


def _is_custom_formula(comp) -> bool:
    from gen.analysis.v1 import analysis_pb2  # noqa: PLC0415 — lazy, mirrors servicer style

    return comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA


# Trading days per calendar day (252/365). Inverting it converts a bar requirement into a
# calendar span to request from marketdata.
_TRADING_DAY_RATIO = 252.0 / 365.0

# Absorbs holiday clustering, which hurts proportionally more at small bar counts.
_CALENDAR_SLACK_DAYS = 10


def prefix_calendar_days(prefix_bars: int) -> int:
    """Calendar days to reach back to obtain ``prefix_bars`` trading bars.

    **Sizing-only, and structurally so.** The engine keeps exactly ``prefix_bars`` after the
    fetch: a surplus is discarded deterministically and a deficit is reported as a coverage
    shortfall. So this conversion can only be too generous (bars thrown away) or too tight
    (reported, never silently accepted) — it can never quietly change a result. A test that
    doubles the factor and asserts a byte-identical BacktestResult pins that property.
    """
    if prefix_bars <= 0:
        return 0
    return math.ceil(prefix_bars / _TRADING_DAY_RATIO) + _CALENDAR_SLACK_DAYS
