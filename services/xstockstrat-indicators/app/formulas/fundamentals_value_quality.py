"""Default "Value+Quality Composite" fundamentals scoring formula (feature 063).

This formula is delivered like any user formula: its ``SOURCE`` runs in the indicators
sandbox with the symbol's fundamentals injected as ``data`` and the tunable band
endpoints / weights as ``params``. It is seeded idempotently at startup
(``app/services/seed_formulas.py``) under a deterministic well-known id so Feature 062
can reference it by a stable ``scoring_formula_id`` without runtime discovery.

Well-known formula id (UUIDv5, NAMESPACE_URL, "xstockstrat:formula:fundamentals-value-quality-v1"):
    d1ff5e6b-6d9c-589d-b95e-defd862c702b

Outputs: the implicit primary series ``value`` plus declared ``quality`` and ``composite``.
"""

import uuid

from gen.indicators.v1 import indicators_pb2
from google.protobuf.struct_pb2 import Value

from app.formulas import SYSTEM_AUTHOR

# Deterministic id → re-seeding is idempotent and 062 can hardcode the reference.
FORMULA_ID = str(
    uuid.uuid5(uuid.NAMESPACE_URL, "xstockstrat:formula:fundamentals-value-quality-v1")
)

NAME = "Fundamentals Value+Quality Composite (v1)"
# Reserved system author (see app/formulas/SYSTEM_AUTHOR) — marks this as a platform-managed,
# read-only formula that UpdateFormula/DeleteFormula refuse to mutate.
AUTHOR = SYSTEM_AUTHOR
IS_PUBLIC = True
DESCRIPTION = (
    "Per-symbol value+quality composite over fundamental metrics. Value sub-score blends "
    "P/E, P/B and a triangular dividend-yield band; quality sub-score blends ROE, D/E and "
    "EPS sign. Missing metrics drop out neutrally. Band endpoints and weights are tunable "
    "formula params (no deploy needed to retune)."
)

# FR-4 default band endpoints + weights, exposed as tunable params.
_DEFAULTS: list[tuple[str, float, str]] = [
    ("value_weight", 0.5, "Weight of the value sub-score in the composite"),
    ("quality_weight", 0.5, "Weight of the quality sub-score in the composite"),
    ("pe_good", 10.0, "P/E at or below which the P/E score is 1.0 (Graham value floor)"),
    ("pe_bad", 35.0, "P/E at or above which the P/E score is 0.0"),
    ("pb_good", 1.0, "P/B at or below which the P/B score is 1.0"),
    ("pb_bad", 5.0, "P/B at or above which the P/B score is 0.0"),
    ("div_peak", 0.04, "Dividend yield at which the yield score peaks at 1.0"),
    (
        "div_zero_hi",
        0.10,
        "Dividend yield at or above which the yield score returns to 0.0 (trap guard)",
    ),
    ("roe_good", 0.25, "ROE at or above which the ROE score is 1.0"),
    ("roe_bad", 0.05, "ROE at or below which the ROE score is 0.0"),
    ("de_good", 0.3, "Debt/Equity at or below which the D/E score is 1.0"),
    ("de_bad", 2.0, "Debt/Equity at or above which the D/E score is 0.0"),
]


def _param(name: str, default: float, description: str) -> "indicators_pb2.FormulaParameter":
    return indicators_pb2.FormulaParameter(
        name=name,
        type=indicators_pb2.PARAMETER_TYPE_FLOAT,
        default_value=Value(number_value=default),
        description=description,
        required=False,
    )


PARAMETERS = [_param(n, d, desc) for (n, d, desc) in _DEFAULTS]

OUTPUTS = [
    indicators_pb2.FormulaOutput(name="quality", description="Quality sub-score in [0,1]"),
    indicators_pb2.FormulaOutput(
        name="composite", description="Weighted value+quality composite in [0,1]"
    ),
]

# DEFAULT_PARAMS mirrors the param defaults so tests and 062 can resolve the shipped
# defaults without re-deriving them from the proto messages.
DEFAULT_PARAMS = {n: d for (n, d, _) in _DEFAULTS}

# The sandbox contract: `data` = fundamentals dict, `params` = tunables, assign `result`.
# Written to be robust to missing/None metrics (FR-5) and to honor the FR-4 special cases.
SOURCE = """
def _get(key):
    v = data.get(key)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _clamp(x):
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _lin(x, good, bad):
    # Linear band to [0,1]. good < bad => lower-is-better; good > bad => higher-is-better.
    if good == bad:
        return 1.0
    if good < bad:
        if x <= good:
            return 1.0
        if x >= bad:
            return 0.0
        return (bad - x) / (bad - good)
    else:
        if x >= good:
            return 1.0
        if x <= bad:
            return 0.0
        return (x - bad) / (good - bad)


def _p(name, default):
    v = params.get(name)
    return float(v) if v is not None else default


value_weight = _p("value_weight", 0.5)
quality_weight = _p("quality_weight", 0.5)

# ── Value sub-score: P/E, P/B, dividend-yield (triangular) ────────────────────
value_parts = []

pe = _get("pe_ratio")
if pe is not None:
    # FR-4: non-positive P/E (loss-making) scores 0.
    value_parts.append(0.0 if pe <= 0 else _lin(pe, _p("pe_good", 10.0), _p("pe_bad", 35.0)))

pb = _get("pb_ratio")
if pb is not None:
    # FR-4: negative book value scores 0.
    value_parts.append(0.0 if pb < 0 else _lin(pb, _p("pb_good", 1.0), _p("pb_bad", 5.0)))

dy = _get("dividend_yield")
if dy is not None:
    peak = _p("div_peak", 0.04)
    zero_hi = _p("div_zero_hi", 0.10)
    if dy <= 0:
        div_score = 0.0
    elif dy <= peak:
        div_score = dy / peak if peak > 0 else 0.0
    elif dy >= zero_hi:
        div_score = 0.0
    else:
        div_score = (zero_hi - dy) / (zero_hi - peak)
    value_parts.append(_clamp(div_score))

value_sub = sum(value_parts) / len(value_parts) if value_parts else 0.5

# ── Quality sub-score: ROE, D/E, EPS sign ─────────────────────────────────────
quality_parts = []

roe = _get("roe")
if roe is not None:
    quality_parts.append(_lin(roe, _p("roe_good", 0.25), _p("roe_bad", 0.05)))

de = _get("debt_to_equity")
if de is not None:
    # FR-4: negative equity scores 0.
    quality_parts.append(0.0 if de < 0 else _lin(de, _p("de_good", 0.3), _p("de_bad", 2.0)))

eps = _get("eps")
if eps is not None:
    quality_parts.append(1.0 if eps > 0 else 0.0)

quality_sub = sum(quality_parts) / len(quality_parts) if quality_parts else 0.5

value_sub = _clamp(value_sub)
quality_sub = _clamp(quality_sub)
composite = _clamp(value_weight * value_sub + quality_weight * quality_sub)

result = {"value": value_sub, "quality": quality_sub, "composite": composite}
"""
