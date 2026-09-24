"""feature 199 — pure-function coverage for the per-opportunity composite_score fusion.

Covers the empirical-Bayes shrinkage (`_composite_score`) and the direction-scoped signal
sub-score (`_composite_signal_subscore`) with no DB / no servicer wiring. These functions did not
exist before the feature-199 service step, so importing them is the red-before-green gate.

NOTE on the intended anchor/measure split (do NOT "fix" it — feature-199 design Open Risk):
`best_direction` is chosen by the main compute on the RAW ExternalSignal.conviction, while the
agree/conflict magnitudes are the DECAYED (age/source-weighted) convictions. The heal path
re-derives `best_direction` the same way (raw) so heal and compute agree byte-for-byte.
"""

import pytest

from app.handlers.servicer import (
    _clamp01,
    _composite_score,
    _composite_signal_subscore,
)

# ── _composite_score: shrinkage math, presence weighting, NULL boundary ──────────────────────


def test_ac2_shrinkage_blend_two_axes():
    # Two present axes at 0.90 / 0.70, unit weights, k=1 → (1.60 + 0.5)/(2 + 1) = 0.700.
    assert _composite_score([(1.0, 0.90), (1.0, 0.70)], 1.0) == pytest.approx(0.700, abs=5e-4)


def test_ac3_absent_axis_omits_weight_not_zero():
    # A single present axis (signal absent → its weight omitted, NOT s=0): (0.80 + 0.5)/(1 + 1).
    v = _composite_score([(1.0, 0.80)], 1.0)
    assert v == pytest.approx(0.650, abs=5e-4)
    assert v > 0.0


def test_ac4_present_contradicted_ranks_below_absent():
    # A PRESENT signal of 0.0 counts its weight (active pull-down): (0.80 + 0.0 + 0.5)/(2 + 1).
    contradicted = _composite_score([(1.0, 0.80), (1.0, 0.0)], 1.0)
    absent = _composite_score([(1.0, 0.80)], 1.0)
    assert contradicted == pytest.approx(0.4333, abs=5e-4)
    # present-but-contradicted MUST rank strictly below absent (0.433 < 0.650).
    assert contradicted < absent


def test_ac6_distinct_weights_are_applied():
    # Weight 2.0 on the 0.90 axis: (1.80 + 0.70 + 0.5)/(3 + 1) = 0.750 (unit weights give 0.700).
    assert _composite_score([(2.0, 0.90), (1.0, 0.70)], 1.0) == pytest.approx(0.750, abs=5e-4)
    assert _composite_score([(2.0, 0.90), (1.0, 0.70)], 1.0) != pytest.approx(0.700, abs=5e-4)


def test_ac10_ac12_no_axis_is_none_not_half():
    # Σw = 0 → None (the honest not-yet / nothing-to-fuse state), never a computed 0.5.
    assert _composite_score([], 1.0) is None


def test_zero_weight_axis_disables_it():
    # A configured weight of 0 on an axis omits it from Σw (get_float_present intent).
    assert _composite_score([(0.0, 0.90)], 1.0) is None
    assert _composite_score([(0.0, 0.90), (1.0, 0.70)], 1.0) == pytest.approx(
        _composite_score([(1.0, 0.70)], 1.0), abs=1e-9
    )


def test_band_edges():
    # A single maxed axis lands at 0.750; a corroborated maxed pair at 0.833 (usable band).
    assert _composite_score([(1.0, 1.0)], 1.0) == pytest.approx(0.750, abs=5e-4)
    assert _composite_score([(1.0, 1.0), (1.0, 1.0)], 1.0) == pytest.approx(0.833, abs=5e-4)


def test_determinism_and_order_insensitivity():
    # Same inputs → identical output (AC-7); term order must not change the sum (heal vs compute).
    a = _composite_score([(1.0, 0.90), (1.0, 0.70)], 1.0)
    b = _composite_score([(1.0, 0.70), (1.0, 0.90)], 1.0)
    assert a == b
    assert _composite_score([(1.0, 0.90), (1.0, 0.70)], 1.0) == a


# ── _composite_signal_subscore: direction-scoped multiplicative attenuation ──────────────────


def test_ac5_agree_beats_conflict():
    # agree-only: 0.70·(1 − 0) = 0.70; with an opposing 0.50: 0.70·(1 − 0.50) = 0.35.
    agree = _composite_signal_subscore([("buy", 0.70)], "buy")
    conflict = _composite_signal_subscore([("buy", 0.70), ("sell", 0.50)], "buy")
    assert agree == pytest.approx(0.70, abs=1e-9)
    assert conflict == pytest.approx(0.35, abs=1e-9)
    # And the resulting composite ranks agree above conflict (0.667 > 0.550).
    comp_agree = _composite_score([(1.0, 0.80), (1.0, agree)], 1.0)
    comp_conflict = _composite_score([(1.0, 0.80), (1.0, conflict)], 1.0)
    assert comp_agree == pytest.approx(0.667, abs=5e-4)
    assert comp_conflict == pytest.approx(0.550, abs=5e-4)
    assert comp_agree > comp_conflict


def test_hold_and_flat_contribute_to_neither():
    # hold/"" are neither agree (≠ best_direction) nor conflict (≠ opposing tradeable) → conflict 0.
    assert _composite_signal_subscore([("buy", 0.70), ("hold", 0.90)], "buy") == pytest.approx(
        0.70, abs=1e-9
    )
    assert _composite_signal_subscore([("buy", 0.70), ("", 0.90)], "buy") == pytest.approx(
        0.70, abs=1e-9
    )


def test_operands_clamped():
    # A source-weighted effective conviction can exceed 1; agree/conflict clamp to [0, 1].
    assert _composite_signal_subscore([("buy", 1.5)], "buy") == pytest.approx(1.0, abs=1e-9)
    assert _composite_signal_subscore([("buy", 1.0), ("sell", 1.5)], "buy") == pytest.approx(
        0.0, abs=1e-9
    )


def test_anchor_is_best_direction_not_the_decayed_max():
    # best_direction is the RAW-conviction winner. If it is "buy", a decayed-higher "sell" is
    # CONFLICT (pulls the sub-score down), never re-anchored as agree.
    s = _composite_signal_subscore([("buy", 0.40), ("sell", 0.90)], "buy")
    assert s == pytest.approx(0.40 * (1 - 0.90), abs=1e-9)


def test_clamp01():
    assert _clamp01(-0.2) == 0.0
    assert _clamp01(1.4) == 1.0
    assert _clamp01(0.3) == pytest.approx(0.3)
