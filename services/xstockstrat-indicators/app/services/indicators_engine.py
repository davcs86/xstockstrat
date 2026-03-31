"""
Built-in technical indicator computation engine.
Supports: SMA, EMA, RSI, MACD, BB (Bollinger Bands), ATR, VWAP, STOCH.
Uses numpy/pandas for efficient vectorized computation.
"""

import logging
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


def compute(indicator: str, values: list[float], params: dict[str, float]) -> list[dict[str, Any]]:
    """
    Compute a built-in indicator.
    Returns list of dicts with 'value' key (and extras for multi-output indicators).
    """
    indicator = indicator.upper()
    arr = np.array(values, dtype=float)

    dispatch = {
        "SMA": _sma,
        "EMA": _ema,
        "RSI": _rsi,
        "MACD": _macd,
        "BB": _bb,
        "ATR": _atr,
        "VWAP": _vwap,
        "STOCH": _stoch,
    }

    fn = dispatch.get(indicator)
    if fn is None:
        raise ValueError(f"Unknown indicator: {indicator}. Supported: {list(dispatch.keys())}")

    return fn(arr, params)


def _sma(arr: np.ndarray, params: dict) -> list[dict]:
    period = int(params.get("period", 14))
    series = pd.Series(arr).rolling(window=period).mean()
    return [{"value": float(v) if not np.isnan(v) else None} for v in series]


def _ema(arr: np.ndarray, params: dict) -> list[dict]:
    period = int(params.get("period", 14))
    series = pd.Series(arr).ewm(span=period, adjust=False).mean()
    return [{"value": float(v)} for v in series]


def _rsi(arr: np.ndarray, params: dict) -> list[dict]:
    period = int(params.get("period", 14))
    series = pd.Series(arr)
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(window=period).mean()
    loss = (-delta.clip(upper=0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.finfo(float).eps)
    rsi = 100 - (100 / (1 + rs))
    return [{"value": float(v) if not np.isnan(v) else None} for v in rsi]


def _macd(arr: np.ndarray, params: dict) -> list[dict]:
    fast = int(params.get("fast", 12))
    slow = int(params.get("slow", 26))
    signal_period = int(params.get("signal", 9))
    s = pd.Series(arr)
    ema_fast = s.ewm(span=fast, adjust=False).mean()
    ema_slow = s.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    histogram = macd_line - signal_line
    return [
        {
            "value": float(m),
            "signal": float(sig),
            "histogram": float(hist),
        }
        for m, sig, hist in zip(macd_line, signal_line, histogram)
    ]


def _bb(arr: np.ndarray, params: dict) -> list[dict]:
    period = int(params.get("period", 20))
    std_dev = float(params.get("std_dev", 2.0))
    s = pd.Series(arr)
    mid = s.rolling(window=period).mean()
    std = s.rolling(window=period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    return [
        {
            "value": float(m) if not np.isnan(m) else None,
            "upper": float(u) if not np.isnan(u) else None,
            "lower": float(lo) if not np.isnan(lo) else None,
        }
        for m, u, lo in zip(mid, upper, lower)
    ]


def _atr(arr: np.ndarray, params: dict) -> list[dict]:
    """ATR requires high, low, close. If only 1D array, approximates using range."""
    period = int(params.get("period", 14))
    # Simple approximation: use rolling max-min range as proxy
    s = pd.Series(arr)
    atr = s.diff().abs().rolling(window=period).mean()
    return [{"value": float(v) if not np.isnan(v) else None} for v in atr]


def _vwap(arr: np.ndarray, params: dict) -> list[dict]:
    """VWAP approximation without volume data — returns cumulative average."""
    cumsum = np.cumsum(arr)
    count = np.arange(1, len(arr) + 1, dtype=float)
    vwap = cumsum / count
    return [{"value": float(v)} for v in vwap]


def _stoch(arr: np.ndarray, params: dict) -> list[dict]:
    period = int(params.get("period", 14))
    s = pd.Series(arr)
    low_min = s.rolling(window=period).min()
    high_max = s.rolling(window=period).max()
    k = 100 * (s - low_min) / (high_max - low_min).replace(0, np.finfo(float).eps)
    d = k.rolling(window=3).mean()
    return [
        {
            "value": float(kv) if not np.isnan(kv) else None,
            "d": float(dv) if not np.isnan(dv) else None,
        }
        for kv, dv in zip(k, d)
    ]


INDICATOR_REGISTRY = {
    "SMA": {"description": "Simple Moving Average", "required": ["period"]},
    "EMA": {"description": "Exponential Moving Average", "required": ["period"]},
    "RSI": {"description": "Relative Strength Index", "required": ["period"]},
    "MACD": {"description": "MACD", "required": ["fast", "slow", "signal"]},  # noqa: E501
    "BB": {"description": "Bollinger Bands", "required": ["period", "std_dev"]},
    "ATR": {"description": "Average True Range", "required": ["period"]},
    "VWAP": {"description": "Volume Weighted Average Price", "required": []},
    "STOCH": {"description": "Stochastic Oscillator", "required": ["period"]},
}
