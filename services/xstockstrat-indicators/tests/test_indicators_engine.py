"""Unit tests for the built-in indicator computation engine.

These tests are pure-Python, numpy/pandas only — no gRPC or network calls.
Run with: pytest tests/
"""

import inspect

import pytest

from app.services import indicators_engine
from app.services.indicators_engine import compute

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

PRICES_20 = [float(i + 100) for i in range(20)]  # 100..119


# ---------------------------------------------------------------------------
# SMA
# ---------------------------------------------------------------------------


class TestSMA:
    def test_basic_period_3(self):
        result = compute("SMA", [1.0, 2.0, 3.0, 4.0, 5.0], {"period": 3})
        assert len(result) == 5
        # First two values are NaN (rolling window not full)
        assert result[0]["value"] is None
        assert result[1]["value"] is None
        assert result[2]["value"] == pytest.approx(2.0)
        assert result[3]["value"] == pytest.approx(3.0)
        assert result[4]["value"] == pytest.approx(4.0)

    def test_default_period_14(self):
        result = compute("SMA", PRICES_20, {})
        assert len(result) == 20
        # First 13 values are NaN (period 14)
        for i in range(13):
            assert result[i]["value"] is None
        # 14th (index 13) should be mean of 100..113
        expected = sum(range(100, 114)) / 14
        assert result[13]["value"] == pytest.approx(expected)

    def test_lowercase_name(self):
        result = compute("sma", [10.0, 20.0, 30.0], {"period": 2})
        assert result[1]["value"] == pytest.approx(15.0)


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------


class TestEMA:
    def test_ema_converges(self):
        # EMA with period 3 on constant series should return that constant.
        result = compute("EMA", [5.0] * 10, {"period": 3})
        for r in result:
            assert r["value"] == pytest.approx(5.0, abs=1e-6)

    def test_ema_length_matches_input(self):
        result = compute("EMA", PRICES_20, {"period": 5})
        assert len(result) == 20

    def test_ema_no_none_values(self):
        # EMA always produces values (no NaN like SMA's window fill).
        result = compute("EMA", [1.0, 2.0, 3.0], {"period": 2})
        for r in result:
            assert r["value"] is not None


# ---------------------------------------------------------------------------
# RSI
# ---------------------------------------------------------------------------


class TestRSI:
    def test_rsi_range(self):
        # RSI must be between 0 and 100.
        import random

        random.seed(42)
        prices = [100 + random.gauss(0, 5) for _ in range(50)]
        result = compute("RSI", prices, {"period": 14})
        for r in result:
            if r.get("value") is not None:
                assert 0 <= r["value"] <= 100, f"RSI out of range: {r['value']}"

    def test_rsi_constant_series(self):
        # All gains, no loss → RSI near 100.
        prices = [float(i) for i in range(1, 20)]
        result = compute("RSI", prices, {"period": 5})
        last = next(r["value"] for r in reversed(result) if r.get("value") is not None)
        assert last > 90, f"Expected RSI near 100 for monotonic series, got {last}"


# ---------------------------------------------------------------------------
# MACD
# ---------------------------------------------------------------------------


class TestMACD:
    def test_macd_keys(self):
        result = compute("MACD", PRICES_20, {"fast": 3, "slow": 6, "signal": 3})
        for r in result:
            # Each entry must have value (MACD line), signal, histogram keys.
            assert "value" in r
            assert "signal" in r
            assert "histogram" in r

    def test_macd_histogram_equals_macd_minus_signal(self):
        result = compute("MACD", PRICES_20, {"fast": 3, "slow": 6, "signal": 3})
        for r in result:
            if r["value"] is not None and r["signal"] is not None:
                assert r["histogram"] == pytest.approx(r["value"] - r["signal"], abs=1e-6)


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------


class TestBB:
    def test_bb_keys(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            assert "upper" in r
            assert "value" in r
            assert "lower" in r

    def test_bb_upper_above_lower(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            if r["upper"] is not None and r["lower"] is not None:
                assert r["upper"] >= r["lower"]

    def test_bb_middle_between_bands(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            if all(r[k] is not None for k in ("upper", "value", "lower")):
                assert r["lower"] <= r["value"] <= r["upper"]


# ---------------------------------------------------------------------------
# Unknown indicator
# ---------------------------------------------------------------------------


class TestUnknownIndicator:
    def test_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown indicator"):
            compute("UNKNOWN_INDICATOR", [1.0, 2.0], {})


class TestIndicatorDefaultsPinning:
    """Pins the built-in default periods that xstockstrat-analysis duplicates.

    `app/services/evaluator.py` in xstockstrat-analysis forwards only `dict(comp.params)`, so an
    omitted `period` silently resolves to the default below — and `INDICATOR_REGISTRY[...]
    ["required"]` is never enforced (its only consumer is `ListIndicators`). Feature 071's
    pre-window warm-up sizing therefore has to mirror these numbers.

    If you change a default here, update the mirror in
    `services/xstockstrat-analysis/app/services/warmup.py` in the SAME PR, or windowed backtests
    will size their history prefix from a stale period.
    """

    CONSUMER = (
        "services/xstockstrat-analysis/app/services/warmup.py "
        "(feature 071 pre-window warm-up sizing)"
    )

    @pytest.mark.parametrize(
        ("indicator", "param", "expected"),
        [
            ("SMA", "period", 14),
            ("EMA", "period", 14),
            ("RSI", "period", 14),
            ("ATR", "period", 14),
            ("STOCH", "period", 14),
            ("BB", "period", 20),
            ("MACD", "fast", 12),
            ("MACD", "slow", 26),
            ("MACD", "signal", 9),
        ],
    )
    def test_default_period_is_pinned(self, indicator, param, expected):
        fn = getattr(indicators_engine, f"_{indicator.lower()}")
        src = inspect.getsource(fn)
        assert f'params.get("{param}", {expected})' in src, (
            f"{indicator} default for '{param}' is no longer {expected}. "
            f"Update the mirrored default in {self.CONSUMER}."
        )

    def test_iir_indicators_still_emit_no_none_head(self):
        """EMA/MACD/VWAP return a finite float at index 0 (no NaN warm-up head), which is why
        warm-up for them must be DECLARED rather than observed. If this ever changes, the
        observed-warm-up path in xstockstrat-analysis becomes viable again — revisit
        `services/xstockstrat-analysis/app/services/warmup.py`."""
        arr = [float(i) for i in range(1, 40)]
        for indicator in ("EMA", "MACD", "VWAP"):
            points = compute(indicator, arr, {})
            assert points[0]["value"] is not None, (
                f"{indicator} now emits a None head; the declared-warm-up rationale in "
                f"{self.CONSUMER} needs revisiting."
            )
