"""Shared readiness compute + freshness helpers (feature 180).

One compute path and one freshness semantic, reused by both the interactive ``EvaluateReadiness``
handler and the background readiness materializer (feature 180) — so a materialized row is
byte-identical to an on-demand one and both are governed by the same FAST-gate predicate (no
two-policies-per-table trap). Pure units (``is_readiness_row_fresh`` / ``readiness_valid_until``)
carry no handler state so they are directly unit-testable.
"""

import logging
from datetime import datetime, timedelta

log = logging.getLogger(__name__)


def is_readiness_row_fresh(row, *, now, fingerprint, latest_bar_epoch) -> bool:
    """The single readiness FAST/skip-fresh predicate (feature 180 § @AC-2 reconciliation).

    A cached row serves without recompute only when its definition fingerprint matches, its window
    has not elapsed, AND no newer daily bar exists (``bar_epoch >= latest_bar_epoch``) — so a new
    daily bar busts the row even inside the window, and the same rule governs interactive and
    materialized rows alike.
    """
    return (
        row["def_fingerprint"] == fingerprint
        and now < row["valid_until"]
        and row["bar_epoch"] >= latest_bar_epoch
    )


def readiness_valid_until(now: datetime, *, valid_window_hours: int) -> datetime:
    """Backstop TTL for a materialized row's ``valid_until``. The authoritative freshness bust is
    the ``bar_epoch`` conjunct in ``is_readiness_row_fresh``; this window is only a floor/backstop,
    so a plain ``now + hours`` (min 1h) suffices."""
    return now + timedelta(hours=max(1, valid_window_hours))


async def compute_readiness_row(
    symbol,
    *,
    fetch_bars,
    bars_sem,
    evaluator,
    definition,
    range_msg,
    propagation_meta,
    benchmark_bars,
    rule,
    fingerprint,
    strategy_id,
    user_id,
    now,
    valid_until,
    benchmark_epoch,
) -> dict:
    """The shared SLOW readiness compute — a best-effort per-symbol bars fetch (gated by
    ``bars_sem``) + a traced condition evaluation, returning a staged ``analysis.readiness_cache``
    row. Behaviorally identical to the original inline ``EvaluateReadiness`` SLOW body (feature
    177); extracted verbatim so the interactive handler and the materializer produce identical rows.
    """
    async with bars_sem:
        fetch_ok = True
        try:
            bars = await fetch_bars(symbol, range_msg, propagation_meta)
        except Exception as e:  # bar fetch is best-effort per symbol
            log.warning("EvaluateReadiness: bars fetch failed for %s: %s", symbol, e)
            bars = []
            fetch_ok = False
        if fetch_ok and not bars:
            # A successful-but-empty fetch is WARN-logged; request-bounded, so a per-symbol WARN is
            # rate-safe (unlike the live loop / screener, which summarize).
            log.warning(
                "EvaluateReadiness: no 1d bars for %s (strategy %s) — readiness empty",
                symbol,
                strategy_id,
            )
        trace = await evaluator.evaluate_conditions_traced(
            definition, bars, symbol, rule=rule, benchmark_bars=benchmark_bars
        )
    # bar_epoch = newest served bar (evaluated symbol or benchmark) — never a slow-path reuse, so a
    # same-time.seconds intraday 1d bar update never freezes a day-one verdict (feature 177).
    bar_epoch = max(bars[-1].time.seconds if bars else 0, benchmark_epoch)
    return {
        "user_id": user_id,
        "strategy_id": strategy_id,
        "rule": rule,
        "symbol": symbol,
        "def_fingerprint": fingerprint,
        "bar_epoch": bar_epoch,
        "readiness_json": trace,  # {} when the trace is empty (never NULL)
        "computed_at": now,
        "valid_until": valid_until,
    }
