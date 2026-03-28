"""Unit tests for the built-in indicator computation engine.

These tests are pure-Python, numpy/pandas only — no gRPC or network calls.
Run with: pytest tests/
"""

import pytest

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
            # Each entry must have macd, signal, histogram keys.
            assert "macd" in r
            assert "signal" in r
            assert "histogram" in r

    def test_macd_histogram_equals_macd_minus_signal(self):
        result = compute("MACD", PRICES_20, {"fast": 3, "slow": 6, "signal": 3})
        for r in result:
            if r["macd"] is not None and r["signal"] is not None:
                assert r["histogram"] == pytest.approx(r["macd"] - r["signal"], abs=1e-6)


# ---------------------------------------------------------------------------
# Bollinger Bands
# ---------------------------------------------------------------------------


class TestBB:
    def test_bb_keys(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            assert "upper" in r
            assert "middle" in r
            assert "lower" in r

    def test_bb_upper_above_lower(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            if r["upper"] is not None and r["lower"] is not None:
                assert r["upper"] >= r["lower"]

    def test_bb_middle_between_bands(self):
        result = compute("BB", PRICES_20, {"period": 5, "std_dev": 2})
        for r in result:
            if all(r[k] is not None for k in ("upper", "middle", "lower")):
                assert r["lower"] <= r["middle"] <= r["upper"]


# ---------------------------------------------------------------------------
# Unknown indicator
# ---------------------------------------------------------------------------


class TestUnknownIndicator:
    def test_raises_value_error(self):
        with pytest.raises(ValueError, match="Unknown indicator"):
            compute("UNKNOWN_INDICATOR", [1.0, 2.0], {})
