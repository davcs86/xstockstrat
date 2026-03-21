"""
Unit tests for pure helper functions in AnalysisServicer.

Tests target _compute_metrics, _unwrap_value, and _compute_signal_score —
all module-level functions with no gRPC dependencies.
"""
import math
from unittest.mock import MagicMock

import pytest
from google.protobuf.struct_pb2 import Value, ListValue, Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.handlers.servicer import _compute_metrics, _unwrap_value, _compute_signal_score


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
    from datetime import datetime, timezone
    return datetime.fromtimestamp(seconds, tz=timezone.utc).replace(tzinfo=None)


def _make_signal(direction: str, conviction: float, valid_from_sec: int = 0, valid_until_sec: int = 0) -> MagicMock:
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
