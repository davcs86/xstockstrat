"""Pure source-weighted scoring math (feature 060).

Extracted verbatim from the inline backtest loop in ``app/handlers/servicer.py`` so the
screener engine can score symbols **identically** to a backtest (FR-4) without duplicating
the math, and so the extraction can be pinned by a golden regression test (FR-8). No I/O,
no gRPC, no config object — pure functions only.
"""


def compute_signal_score(
    signals_map: dict, bar, signal_sources: list, source_weights: dict | None = None
) -> float:
    """Return a 0.0–1.0 signal score from active newsletter signals for this bar."""
    if not signals_map or not signal_sources:
        return 0.5

    bar_ts = bar.timestamp.ToDatetime()
    buy_conviction = 0.0
    sell_conviction = 0.0
    count = 0

    for source in signal_sources:
        weight = max(0.0, min(1.0, (source_weights or {}).get(source, 1.0)))
        for sig in signals_map.get(source, []):
            valid_from = sig.valid_from.ToDatetime() if sig.valid_from.seconds > 0 else None
            valid_until = sig.valid_until.ToDatetime() if sig.valid_until.seconds > 0 else None
            if valid_from and bar_ts < valid_from:
                continue
            if valid_until and bar_ts > valid_until:
                continue
            conviction = sig.conviction if sig.conviction > 0 else 0.5
            if sig.direction == "buy":
                buy_conviction += conviction * weight
            elif sig.direction == "sell":
                sell_conviction += conviction * weight
            count += 1

    if count == 0:
        return 0.5  # neutral

    net = (buy_conviction - sell_conviction) / count
    return (net + 1.0) / 2.0  # map -1..1 to 0..1


def combine_score(
    tech_signal: float,
    signal_score: float,
    signal_weight: float,
    technical_weight: float,
    signals_present: bool,
) -> float:
    """Blend the technical signal and the newsletter signal score into a 0–1 conviction.

    Moves the exact branch from ``_backtest_symbol``: when newsletter signals are weighted
    and present, blend; otherwise fall back to the pure-technical mapping (-1→0, 0→0.5, +1→1).
    """
    if signal_weight > 0 and signals_present:
        return technical_weight * (tech_signal * 0.5 + 0.5) + signal_weight * signal_score
    # Pure technical: map tech_signal to 0-1 for threshold comparison.
    return tech_signal * 0.5 + 0.5


def buy_threshold(min_conviction: float) -> float:
    """Entry threshold: ``max(0.5 + min_conviction * 0.5, 0.55)`` (verbatim)."""
    return max(0.5 + min_conviction * 0.5, 0.55)


def sell_threshold() -> float:
    """Exit threshold (constant 0.45, verbatim)."""
    return 0.45
