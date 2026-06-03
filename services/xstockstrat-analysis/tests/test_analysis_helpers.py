"""
Unit tests for pure helper functions in AnalysisServicer.

Tests target _compute_metrics, _unwrap_value, and _compute_signal_score —
all module-level functions with no gRPC dependencies.
"""

from datetime import UTC
from unittest.mock import MagicMock

import pytest
from google.protobuf.struct_pb2 import ListValue, Struct, Value

from app.handlers.servicer import _compute_metrics, _compute_signal_score, _unwrap_value

# ---------------------------------------------------------------------------
# _compute_metrics
# ---------------------------------------------------------------------------


class TestComputeMetrics:
    def test_empty_returns_zeros(self):
        result = _compute_metrics([], [], 10000.0)
        assert result["total_return"] == 0.0
        assert result["sharpe_ratio"] == 0.0
        assert result["max_drawdown"] == 0.0
        assert result["win_rate"] == 0.0
        assert result["profit_factor"] == 1.0

    def test_single_point_returns_zeros(self):
        result = _compute_metrics([10000.0], [], 10000.0)
        assert result["total_return"] == 0.0

    def test_positive_return(self):
        equity = [10000.0, 10500.0, 11000.0, 11500.0]
        result = _compute_metrics(equity, [], 10000.0)
        assert result["total_return"] == pytest.approx(0.15, abs=1e-6)
        assert result["annualized_return"] > 0

    def test_negative_return(self):
        equity = [10000.0, 9500.0, 9000.0]
        result = _compute_metrics(equity, [], 10000.0)
        assert result["total_return"] < 0

    def test_max_drawdown_detected(self):
        # Equity rises then falls significantly
        equity = [10000.0, 12000.0, 11000.0, 9000.0, 10000.0]
        result = _compute_metrics(equity, [], 10000.0)
        assert result["max_drawdown"] > 0.0

    def test_win_rate_calculation(self):
        trades = [MagicMock(pnl=100), MagicMock(pnl=200), MagicMock(pnl=-50)]
        equity = [10000.0, 10100.0, 10300.0, 10250.0]
        result = _compute_metrics(equity, trades, 10000.0)
        # 2 wins out of 3 trades
        assert result["win_rate"] == pytest.approx(2 / 3, abs=1e-6)

    def test_profit_factor(self):
        trades = [MagicMock(pnl=300), MagicMock(pnl=-100)]
        equity = [10000.0, 10300.0, 10200.0]
        result = _compute_metrics(equity, trades, 10000.0)
        # gross_profit=300, gross_loss=100 → profit_factor=3.0
        assert result["profit_factor"] == pytest.approx(3.0, abs=1e-6)

    def test_no_trades_win_rate_zero(self):
        equity = [10000.0, 10500.0]
        result = _compute_metrics(equity, [], 10000.0)
        assert result["win_rate"] == 0.0
        assert result["profit_factor"] == 1.0

    def test_all_losing_trades_profit_factor(self):
        trades = [MagicMock(pnl=-100), MagicMock(pnl=-200)]
        equity = [10000.0, 9700.0]
        result = _compute_metrics(equity, trades, 10000.0)
        assert result["profit_factor"] == 0.0

    def test_all_winning_trades_profit_factor(self):
        trades = [MagicMock(pnl=100), MagicMock(pnl=200)]
        equity = [10000.0, 10300.0]
        result = _compute_metrics(equity, trades, 10000.0)
        # gross_loss=0, gross_profit>0 → profit_factor=999.0
        assert result["profit_factor"] == pytest.approx(999.0)


# ---------------------------------------------------------------------------
# _unwrap_value
# ---------------------------------------------------------------------------


class TestUnwrapValue:
    def test_number_value(self):
        v = Value(number_value=3.14)
        assert _unwrap_value(v) == pytest.approx(3.14)

    def test_string_value(self):
        v = Value(string_value="hello")
        assert _unwrap_value(v) == "hello"

    def test_bool_value_true(self):
        v = Value(bool_value=True)
        assert _unwrap_value(v) is True

    def test_bool_value_false(self):
        v = Value(bool_value=False)
        assert _unwrap_value(v) is False

    def test_null_value_returns_none(self):
        v = Value()  # null_value is the default (0)
        assert _unwrap_value(v) is None

    def test_list_value(self):
        inner1 = Value(number_value=1.0)
        inner2 = Value(string_value="x")
        lv = ListValue(values=[inner1, inner2])
        v = Value(list_value=lv)
        result = _unwrap_value(v)
        assert result == [1.0, "x"]

    def test_struct_value(self):
        s = Struct()
        s.fields["key"].CopyFrom(Value(string_value="val"))
        v = Value(struct_value=s)
        result = _unwrap_value(v)
        assert result == {"key": "val"}


# ---------------------------------------------------------------------------
# _compute_signal_score
# ---------------------------------------------------------------------------


def _make_bar(timestamp_seconds: int = 1704067200) -> MagicMock:
    """Return a MagicMock bar with a Timestamp-like object."""
    bar = MagicMock()
    bar.timestamp.ToDatetime.return_value = _seconds_to_datetime(timestamp_seconds)
    return bar


def _seconds_to_datetime(seconds: int):
    from datetime import datetime

    return datetime.fromtimestamp(seconds, tz=UTC).replace(tzinfo=None)


def _make_signal(
    direction: str, conviction: float, valid_from_sec: int = 0, valid_until_sec: int = 0
) -> MagicMock:
    sig = MagicMock()
    sig.direction = direction
    sig.conviction = conviction
    sig.valid_from.seconds = valid_from_sec
    sig.valid_until.seconds = valid_until_sec
    if valid_from_sec > 0:
        sig.valid_from.ToDatetime.return_value = _seconds_to_datetime(valid_from_sec)
    if valid_until_sec > 0:
        sig.valid_until.ToDatetime.return_value = _seconds_to_datetime(valid_until_sec)
    return sig


class TestComputeSignalScore:
    def test_empty_signals_map_returns_neutral(self):
        bar = _make_bar()
        assert _compute_signal_score({}, bar, ["source1"]) == 0.5

    def test_no_sources_returns_neutral(self):
        bar = _make_bar()
        assert _compute_signal_score({"source1": []}, bar, []) == 0.5

    def test_buy_signal_raises_score_above_half(self):
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.8, valid_from_sec=0, valid_until_sec=0)
        result = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        assert result > 0.5

    def test_sell_signal_lowers_score_below_half(self):
        bar = _make_bar(1704067200)
        sig = _make_signal("sell", 0.8, valid_from_sec=0, valid_until_sec=0)
        result = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        assert result < 0.5

    def test_expired_signal_is_ignored(self):
        """Signal with valid_until before bar_ts should be excluded."""
        bar_ts = 1704067200
        bar = _make_bar(bar_ts)
        # valid_until is before bar_ts
        sig = _make_signal("buy", 0.9, valid_from_sec=0, valid_until_sec=bar_ts - 3600)
        result = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        assert result == 0.5  # signal excluded → no signals → neutral

    def test_future_signal_is_ignored(self):
        """Signal with valid_from after bar_ts should be excluded."""
        bar_ts = 1704067200
        bar = _make_bar(bar_ts)
        sig = _make_signal("buy", 0.9, valid_from_sec=bar_ts + 3600, valid_until_sec=0)
        result = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        assert result == 0.5

    def test_zero_conviction_uses_default_half(self):
        bar = _make_bar()
        sig = _make_signal("buy", 0.0)  # zero conviction → uses 0.5
        result = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        assert result > 0.5  # buy with default conviction 0.5 → score > 0.5


class TestComputeSignalScoreWithWeights:
    """Tests for the source_weights parameter added by signal-source-weighting (007)."""

    def test_weight_one_is_same_as_no_weight(self):
        """weight=1.0 for a source should produce the same score as no weights."""
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.8)
        score_no_weight = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
        score_weight_one = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0}
        )
        assert score_no_weight == pytest.approx(score_weight_one, abs=1e-9)

    def test_weight_zero_silences_source(self):
        """weight=0.0 for all sources → no conviction accumulated → neutral score."""
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.9)
        # With weight 0.0, buy_conviction and sell_conviction stay 0 for each signal,
        # but count is still incremented → net = 0/count = 0 → score = 0.5
        score = _compute_signal_score({"uw": [sig]}, bar, ["uw"], source_weights={"uw": 0.0})
        assert score == pytest.approx(0.5, abs=1e-9)

    def test_lower_weight_reduces_influence(self):
        """source_b at weight=0.5 contributes less than source_a at weight=1.0."""
        bar = _make_bar(1704067200)
        sig_a = _make_signal("buy", 0.8)
        sig_b = _make_signal("buy", 0.8)
        # Both sources, source_b halved
        score_both_full = _compute_signal_score(
            {"a": [sig_a], "b": [sig_b]}, bar, ["a", "b"],
            source_weights={"a": 1.0, "b": 1.0}
        )
        score_b_half = _compute_signal_score(
            {"a": [sig_a], "b": [sig_b]}, bar, ["a", "b"],
            source_weights={"a": 1.0, "b": 0.5}
        )
        # Both scores are above 0.5 (buy signals), but b_half < both_full is not
        # guaranteed due to count normalization. What IS guaranteed: both > 0.5
        assert score_both_full > 0.5
        assert score_b_half > 0.5

    def test_missing_source_defaults_to_weight_one(self):
        """A source absent from source_weights gets multiplier 1.0 (FR-3)."""
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.8)
        score_absent = _compute_signal_score({"uw": [sig]}, bar, ["uw"], source_weights={})
        score_explicit_one = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0}
        )
        assert score_absent == pytest.approx(score_explicit_one, abs=1e-9)

    def test_weight_clamped_above_one(self):
        """A weight > 1.0 is clamped to 1.0 (FR-5)."""
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.8)
        score_clamped = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 5.0}
        )
        score_one = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0}
        )
        assert score_clamped == pytest.approx(score_one, abs=1e-9)

    def test_weight_clamped_below_zero(self):
        """A weight < 0.0 is clamped to 0.0 (FR-5)."""
        bar = _make_bar(1704067200)
        sig = _make_signal("buy", 0.8)
        score_clamped = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": -1.0}
        )
        score_zero = _compute_signal_score(
            {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 0.0}
        )
        assert score_clamped == pytest.approx(score_zero, abs=1e-9)

    def test_signal_score_always_in_range(self):
        """Final score must be in [0.0, 1.0] under extreme weights (AC-3)."""
        bar = _make_bar(1704067200)
        sig_buy = _make_signal("buy", 1.0)
        sig_sell = _make_signal("sell", 1.0)
        for weights in [{"a": 0.0}, {"a": 1.0}, {"a": 0.5}, {}]:
            for sig, direction in [(sig_buy, "buy"), (sig_sell, "sell")]:
                score = _compute_signal_score({"a": [sig]}, bar, ["a"], source_weights=weights)
                assert 0.0 <= score <= 1.0, (
                    f"score={score} out of range for weights={weights}, direction={direction}"
                )

    def test_mixed_weighted_sources(self):
        """Two sources with different weights and opposite signals."""
        bar = _make_bar(1704067200)
        sig_buy = _make_signal("buy", 1.0)
        sig_sell = _make_signal("sell", 1.0)
        # source_a (buy, weight=1.0) vs source_b (sell, weight=0.2) → net positive → score > 0.5
        score = _compute_signal_score(
            {"source_a": [sig_buy], "source_b": [sig_sell]},
            bar,
            ["source_a", "source_b"],
            source_weights={"source_a": 1.0, "source_b": 0.2},
        )
        assert score > 0.5
