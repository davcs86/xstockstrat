"""Tests for the seeded value+quality fundamentals formula (feature 063).

Runs the formula SOURCE directly through the indicators sandbox (no live service),
keeping the check a pure function of the formula — matching its "pure per-symbol
function" design.
"""

import pytest

from app.formulas.fundamentals_value_quality import (
    AUTHOR,
    DEFAULT_PARAMS,
    FORMULA_ID,
    IS_PUBLIC,
    OUTPUTS,
    PARAMETERS,
    SOURCE,
)
from app.services import parameters as params_validation
from app.services.sandbox import execute_formula


def run(fundamentals: dict, param_overrides: dict | None = None):
    params = dict(DEFAULT_PARAMS)
    if param_overrides:
        params.update(param_overrides)
    return execute_formula(
        source=SOURCE,
        input_data=fundamentals,
        allowed_imports=["math"],
        params=params,
    )


# ── AC-1: valid range ─────────────────────────────────────────────────────────


def test_outputs_in_unit_range():
    res = run(
        {
            "pe_ratio": 18,
            "pb_ratio": 2.5,
            "dividend_yield": 0.02,
            "roe": 0.15,
            "debt_to_equity": 1.0,
            "eps": 2.0,
        }
    )
    assert res.success is True
    out = res.output
    for key in ("value", "quality", "composite"):
        assert 0.0 <= out[key] <= 1.0, f"{key}={out[key]} out of range"


# ── AC-2: high / low composite ────────────────────────────────────────────────


def test_cheap_high_quality_scores_high():
    res = run(
        {
            "pe_ratio": 9,
            "pb_ratio": 0.9,
            "dividend_yield": 0.04,
            "roe": 0.28,
            "debt_to_equity": 0.25,
            "eps": 3.5,
        }
    )
    assert res.success is True
    assert res.output["composite"] > 0.7, res.output


def test_expensive_negative_eps_scores_low():
    res = run(
        {
            "pe_ratio": 60,
            "pb_ratio": 8,
            "dividend_yield": 0.0,
            "roe": 0.02,
            "debt_to_equity": 3.0,
            "eps": -1.0,
        }
    )
    assert res.success is True
    assert res.output["composite"] < 0.3, res.output


# ── AC-3: missing-data neutrality ─────────────────────────────────────────────


def test_missing_dividend_is_neutral_not_zeroing():
    # Omit dividend_yield entirely — must still succeed, stay valid, and not zero the
    # value sub-score (the remaining P/E + P/B contributors still average normally).
    res = run({"pe_ratio": 9, "pb_ratio": 0.9, "roe": 0.28, "debt_to_equity": 0.25, "eps": 3.5})
    assert res.success is True
    for key in ("value", "quality", "composite"):
        assert 0.0 <= res.output[key] <= 1.0
    # P/E=9 (<=10 -> 1.0) and P/B=0.9 (<=1.0 -> 1.0) average to 1.0 — not zeroed by the
    # missing dividend metric.
    assert res.output["value"] == pytest.approx(1.0)


def test_no_value_metrics_returns_neutral_half():
    res = run({"roe": 0.28, "debt_to_equity": 0.25, "eps": 3.5})  # only quality metrics
    assert res.success is True
    assert res.output["value"] == pytest.approx(0.5)


# ── FR-4 special cases ────────────────────────────────────────────────────────


def test_negative_pe_zeroes_pe_contribution():
    neg = run({"pe_ratio": -5, "pb_ratio": 1.0})  # pe -> 0, pb=1.0 -> 1.0 ; value = 0.5
    assert neg.success is True
    assert neg.output["value"] == pytest.approx(0.5)


def test_eps_sign_binary():
    pos = run({"eps": 0.01})
    zero = run({"eps": 0.0})
    assert pos.output["quality"] == pytest.approx(1.0)
    assert zero.output["quality"] == pytest.approx(0.0)


def test_negative_equity_zeroes_de():
    res = run({"debt_to_equity": -1.0})  # only contributor -> quality 0
    assert res.output["quality"] == pytest.approx(0.0)


def test_dividend_yield_triangular_trap():
    peak = run({"dividend_yield": 0.04})  # peak -> 1.0
    trap = run({"dividend_yield": 0.12})  # >= zero_hi -> 0.0
    assert peak.output["value"] == pytest.approx(1.0)
    assert trap.output["value"] == pytest.approx(0.0)


# ── Definition validation (seed gate) ─────────────────────────────────────────


def test_definitions_and_outputs_validate():
    params_validation.validate_definitions(PARAMETERS)
    params_validation.validate_outputs(OUTPUTS)
    assert "value" not in [o.name for o in OUTPUTS]
    assert FORMULA_ID and AUTHOR == "system" and IS_PUBLIC is True


# ── Seeding upsert idempotency (DB-less) ──────────────────────────────────────


def test_upsert_uses_on_conflict_and_is_idempotent():
    from unittest.mock import AsyncMock

    from app.services.formulas_repository import FormulasRepository

    captured_sql = []

    async def fake_fetchrow(sql, *args):
        captured_sql.append(sql)
        return None

    pool = AsyncMock()
    pool.fetchrow = fake_fetchrow
    repo = FormulasRepository(pool)

    import asyncio

    async def call_twice():
        await repo.upsert(
            formula_id=FORMULA_ID,
            name="n",
            description="d",
            source=SOURCE,
            author=AUTHOR,
            is_public=True,
            input_schema={},
            parameters=[],
            outputs=[],
        )
        await repo.upsert(
            formula_id=FORMULA_ID,
            name="n",
            description="d",
            source=SOURCE,
            author=AUTHOR,
            is_public=True,
            input_schema={},
            parameters=[],
            outputs=[],
        )

    asyncio.run(call_twice())
    assert len(captured_sql) == 2
    assert all("ON CONFLICT" in s for s in captured_sql)


# ── Step 5: labeled-sample intuition check ────────────────────────────────────

_LABELED = [
    # (fundamentals, label)
    (
        {
            "pe_ratio": 9,
            "pb_ratio": 0.9,
            "dividend_yield": 0.035,
            "roe": 0.27,
            "debt_to_equity": 0.2,
            "eps": 4.0,
        },
        "buy",
    ),
    (
        {
            "pe_ratio": 12,
            "pb_ratio": 1.4,
            "dividend_yield": 0.03,
            "roe": 0.22,
            "debt_to_equity": 0.5,
            "eps": 2.5,
        },
        "buy",
    ),
    (
        {
            "pe_ratio": 70,
            "pb_ratio": 9,
            "dividend_yield": 0.0,
            "roe": 0.01,
            "debt_to_equity": 3.5,
            "eps": -2.0,
        },
        "avoid",
    ),
    (
        {
            "pe_ratio": 45,
            "pb_ratio": 6,
            "dividend_yield": 0.0,
            "roe": 0.03,
            "debt_to_equity": 2.5,
            "eps": 0.1,
        },
        "avoid",
    ),
    # yield-trap: very high yield must NOT inflate the value sub-score.
    (
        {
            "pe_ratio": 40,
            "pb_ratio": 5,
            "dividend_yield": 0.13,
            "roe": 0.04,
            "debt_to_equity": 2.2,
            "eps": 0.2,
        },
        "avoid",
    ),
]


def test_labeled_sample_ordering():
    scored = [(run(f).output, label) for f, label in _LABELED]
    buys = [o["composite"] for o, label in scored if label == "buy"]
    avoids = [o["composite"] for o, label in scored if label == "avoid"]
    assert min(buys) > max(avoids), f"buys={buys} avoids={avoids}"


def test_yield_trap_not_inflated():
    trap = run(
        {
            "pe_ratio": 40,
            "pb_ratio": 5,
            "dividend_yield": 0.13,
            "roe": 0.04,
            "debt_to_equity": 2.2,
            "eps": 0.2,
        }
    )
    peak = run(
        {
            "pe_ratio": 40,
            "pb_ratio": 5,
            "dividend_yield": 0.04,
            "roe": 0.04,
            "debt_to_equity": 2.2,
            "eps": 0.2,
        }
    )
    assert trap.output["value"] < peak.output["value"]
