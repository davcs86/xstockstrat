"""feature 200 — pure-function coverage for the symbol_score roll-up fold.

Covers the affine grade weight (`_strategy_weight`), the geometric rank-decay fold
(`_symbol_score`), and the shared compute/heal builder (`_symbol_score_for_group`) with no DB /
no servicer wiring. These functions did not exist before the feature-200 service step, so
importing them is the red-before-green gate.

Assertions use the DEFAULT γ=0.5, floor=0.5 (design worked numbers). The γ read-clamp to
[0, 0.99] lives at the compute read site (an un-clamped γ≥1 stops the fold diminishing); the
servicer-level test asserts that clamp — here we assert the diminishing-returns ordering the
clamp preserves at the default.
"""

import pytest

from app.handlers.servicer import (
    _strategy_weight,
    _symbol_score,
    _symbol_score_for_group,
)

# ── _symbol_score: geometric rank-decay fold ────────────────────────────────────────────────


def test_empty_terms_is_none():
    # No score-eligible opportunity for the symbol → None (never a computed 0.0).
    assert _symbol_score([], 0.5) is None


def test_single_term_is_the_term():
    assert _symbol_score([1.00], 0.5) == pytest.approx(1.00, abs=5e-4)


def test_ac2_two_moderate_outrank_one_strong():
    # AAPL two 0.80 terms (γ=0.5) → 0.80 + 0.40 = 1.20; MSFT one 1.00 term → 1.00.
    aapl = _symbol_score([0.80, 0.80], 0.5)
    msft = _symbol_score([1.00], 0.5)
    assert aapl == pytest.approx(1.20, abs=5e-4)
    assert msft == pytest.approx(1.00, abs=5e-4)
    # Breadth beats a single strong opportunity — flips the legacy MAX-over-opportunities ordering
    # (MAX would give AAPL 0.80 < MSFT 1.00).
    assert aapl > msft


def test_ac3_diminishing_returns_saturates():
    # PENNY six 0.30 terms (γ=0.5) → 0.30·Σ0.5^i(i=0..5) = 0.30·1.96875 = 0.590625; still below
    # AAPL's 1.20 — many weak opportunities never sum past a couple strong ones (saturation).
    penny = _symbol_score([0.30] * 6, 0.5)
    aapl = _symbol_score([0.80, 0.80], 0.5)
    assert penny == pytest.approx(0.590625, abs=5e-4)
    assert penny < aapl


def test_ac10_fold_is_order_insensitive():
    # Internal DESC sort makes the fold a function of the multiset, not the input order
    # (determinism; heal/compute byte-parity).
    assert _symbol_score([0.20, 0.90, 0.50], 0.5) == pytest.approx(
        _symbol_score([0.90, 0.50, 0.20], 0.5), abs=1e-9
    )


def test_gamma_at_least_one_would_invert_hence_the_read_clamp():
    # WHY the compute read-clamps γ to [0, 0.99]: at γ=2 the tail term gets a LARGER multiplier
    # than the head (2^1 > 2^0), so the smallest opportunity dominates — an inversion. The fold
    # itself is pure; the guard is the read-site clamp (asserted in the servicer test).
    inverted = _symbol_score([0.10, 0.90], 2.0)  # sorted desc [0.90, 0.10] → 0.90·1 + 0.10·2
    assert inverted == pytest.approx(1.10, abs=5e-4)


# ── _strategy_weight: affine grade weight, floor for absent/provisional ──────────────────────


def test_absent_grade_is_floor():
    assert _strategy_weight(None, False, 0.5) == pytest.approx(0.5, abs=1e-9)


def test_provisional_grade_is_floor():
    # A provisional grade (too little evidence) weights at the floor, not its raw overall_score.
    assert _strategy_weight(0.90, True, 0.5) == pytest.approx(0.5, abs=1e-9)


def test_graded_weight_is_affine():
    # grade-A (overall 0.90) → 0.5 + 0.5·0.90 = 0.95; grade-C (overall 0.55) → 0.775.
    assert _strategy_weight(0.90, False, 0.5) == pytest.approx(0.95, abs=1e-9)
    assert _strategy_weight(0.55, False, 0.5) == pytest.approx(0.775, abs=1e-9)


def test_ac7_floor_is_positive_so_unproven_still_contributes():
    # FR-4/@AC-7 — the neutral floor is strictly > 0, so an unproven strategy's opportunity still
    # adds a term (never zeroed out of the roll-up).
    assert _strategy_weight(None, False, 0.5) > 0.0


def test_overall_score_is_clamped():
    # A grade above 1.0 clamps to weight 1.0 (never exceeds the affine ceiling).
    assert _strategy_weight(1.5, False, 0.5) == pytest.approx(1.0, abs=1e-9)


# ── _symbol_score_for_group: the shared compute/heal builder ─────────────────────────────────


def _grades(mapping):
    """grade_lookup stub: strategy_id → (overall_score, provisional); default (None, False)."""
    return lambda sid: mapping.get(sid, (None, False))


def test_ac1_symbol_score_is_a_function_of_the_composites():
    rows = [
        {"strategy_id": "s1", "composite_score": 0.70},
        {"strategy_id": "s2", "composite_score": 0.60},
    ]
    base = _symbol_score_for_group(rows, _grades({}), 0.5, 0.5)
    # Bump one composite → the roll-up changes (it is a function of the group's composites).
    rows2 = [dict(rows[0], composite_score=0.90), rows[1]]
    bumped = _symbol_score_for_group(rows2, _grades({}), 0.5, 0.5)
    assert bumped > base


def test_ac6_null_composite_omitted_not_zeroed():
    with_null = _symbol_score_for_group(
        [
            {"strategy_id": "s1", "composite_score": 0.75},
            {"strategy_id": "s2", "composite_score": None},
        ],
        _grades({}),
        0.5,
        0.5,
    )
    without = _symbol_score_for_group(
        [{"strategy_id": "s1", "composite_score": 0.75}], _grades({}), 0.5, 0.5
    )
    # A NULL composite contributes NO term (skipped), so the two folds are identical.
    assert with_null == pytest.approx(without, abs=1e-9)


def test_ac6_all_null_group_is_none():
    allnull = _symbol_score_for_group(
        [
            {"strategy_id": "s1", "composite_score": None},
            {"strategy_id": "", "composite_score": None},
        ],
        _grades({}),
        0.5,
        0.5,
    )
    assert allnull is None


def test_ac4_higher_graded_strategy_outranks():
    # AAPL: grade-A (0.90) + grade-C (0.55), both composite 0.70.
    aapl = _symbol_score_for_group(
        [
            {"strategy_id": "A", "composite_score": 0.70},
            {"strategy_id": "C", "composite_score": 0.70},
        ],
        _grades({"A": (0.90, False), "C": (0.55, False)}),
        0.5,
        0.5,
    )
    # MSFT: two grade-C (0.55), both composite 0.70.
    msft = _symbol_score_for_group(
        [
            {"strategy_id": "C1", "composite_score": 0.70},
            {"strategy_id": "C2", "composite_score": 0.70},
        ],
        _grades({"C1": (0.55, False), "C2": (0.55, False)}),
        0.5,
        0.5,
    )
    # The higher-graded strategy lifts AAPL's weighted terms above MSFT's (FR-3 grade-weighting).
    assert aapl > msft
