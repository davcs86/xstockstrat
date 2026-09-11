"""Feature 180 — shared readiness compute + pure freshness/valid-until units (AC-1 byte-identity).

C-13: reuses `_cache_svc`/`_verdicts` from the sibling `test_readiness_cache.py` (the canonical
single-consumer home for the readiness servicer mock) and the `_real_bars`/`_simple_strategy_row`
fixtures it re-exports — this module declares no new fixtures.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.services.readiness import (
    compute_readiness_row,
    is_readiness_row_fresh,
    readiness_valid_until,
)

from .test_analysis_servicer import _HEADERS, _ctx
from .test_readiness_cache import _cache_svc, _verdicts
from .test_readiness_opportunities_source_symbol import _real_bars

# ── Pure: is_readiness_row_fresh ────────────────────────────────────────────


def _row(*, fingerprint="fp", valid_until=None, bar_epoch=100):
    return {
        "def_fingerprint": fingerprint,
        "valid_until": valid_until or (datetime.now(UTC) + timedelta(hours=1)),
        "bar_epoch": bar_epoch,
    }


def test_is_readiness_row_fresh_all_conditions_met():
    now = datetime.now(UTC)
    row = _row(fingerprint="fp", valid_until=now + timedelta(hours=1), bar_epoch=100)
    assert is_readiness_row_fresh(row, now=now, fingerprint="fp", latest_bar_epoch=100) is True
    # A row strictly newer than the latest known bar is still fresh (>=).
    assert is_readiness_row_fresh(row, now=now, fingerprint="fp", latest_bar_epoch=90) is True


def test_is_readiness_row_fresh_stale_on_fingerprint_mismatch():
    now = datetime.now(UTC)
    row = _row(fingerprint="fp-old", valid_until=now + timedelta(hours=1), bar_epoch=100)
    assert is_readiness_row_fresh(row, now=now, fingerprint="fp-new", latest_bar_epoch=100) is False


def test_is_readiness_row_fresh_stale_on_expired_window():
    now = datetime.now(UTC)
    row = _row(fingerprint="fp", valid_until=now - timedelta(seconds=1), bar_epoch=100)
    assert is_readiness_row_fresh(row, now=now, fingerprint="fp", latest_bar_epoch=100) is False


def test_is_readiness_row_fresh_stale_on_new_daily_bar():
    now = datetime.now(UTC)
    row = _row(fingerprint="fp", valid_until=now + timedelta(hours=1), bar_epoch=100)
    # A newer bar exists (latest_bar_epoch > row.bar_epoch) → busted even inside the window.
    assert is_readiness_row_fresh(row, now=now, fingerprint="fp", latest_bar_epoch=101) is False


# ── Pure: readiness_valid_until ─────────────────────────────────────────────


def test_readiness_valid_until_adds_window():
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    assert readiness_valid_until(now, valid_window_hours=24) == now + timedelta(hours=24)


def test_readiness_valid_until_floors_at_one_hour():
    now = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
    assert readiness_valid_until(now, valid_window_hours=0) == now + timedelta(hours=1)
    assert readiness_valid_until(now, valid_window_hours=-5) == now + timedelta(hours=1)


# ── Feature 181 R-E: bar_epoch = -1 data-unavailable sentinel (Step 3) ──────
#
# The exception (primary-bars-fetch raised) path must stamp bar_epoch = -1 — the sole UNKNOWN
# discriminant the feature-181 classifier reads. A successful-but-empty fetch must NOT: it keeps
# bar_epoch = max(0, benchmark_epoch) so it stays RESOLVED best-effort (design.md Round-5 (d)).
# The @AC-1 (all-conditions-fresh) and @AC-2 (new-daily-bar busts) freshness units above are the
# feature-177 re-verification required by design R-A — the shared-compute edit must not change them.


def _fake_evaluator():
    return SimpleNamespace(evaluate_conditions_traced=AsyncMock(return_value={}))


async def _compute(fetch_bars, *, benchmark_epoch):
    import asyncio

    return await compute_readiness_row(
        "AAPL",
        fetch_bars=fetch_bars,
        bars_sem=asyncio.Semaphore(1),
        evaluator=_fake_evaluator(),
        definition={},
        range_msg=None,
        propagation_meta=[],
        benchmark_bars=[],
        rule="entry",
        fingerprint="fp",
        strategy_id="s1",
        user_id="u1",
        now=datetime.now(UTC),
        valid_until=datetime.now(UTC) + timedelta(hours=1),
        benchmark_epoch=benchmark_epoch,
    )


@pytest.mark.asyncio
async def test_compute_readiness_row_exception_stamps_minus_one_sentinel():
    """R-E: a primary-bars-fetch that RAISES stamps bar_epoch = -1 even when a benchmark epoch is
    present (RED before Step 3 — today it is max(0, benchmark_epoch) = benchmark_epoch)."""
    row = await _compute(AsyncMock(side_effect=RuntimeError("boom")), benchmark_epoch=500)
    assert row["bar_epoch"] == -1


@pytest.mark.asyncio
async def test_compute_readiness_row_successful_empty_keeps_benchmark_epoch():
    """R-E guard: a successful-but-empty fetch (no raise) is NOT the sentinel — it keeps
    bar_epoch = max(0, benchmark_epoch), so an empty-coverage symbol stays RESOLVED best-effort."""
    row = await _compute(AsyncMock(return_value=[]), benchmark_epoch=500)
    assert row["bar_epoch"] == 500


# ── AC-1: byte-identity of the shared SLOW compute path ─────────────────────


@pytest.mark.asyncio
async def test_slow_compute_row_shape_is_byte_identical():
    """AC-1: after the Step-1 refactor delegates the SLOW body to compute_readiness_row, a SLOW
    EvaluateReadiness yields the same staged-row shape and verdicts as before (one compute path)."""
    svc = _cache_svc(
        {
            "AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0]),
            "MSFT": _real_bars("MSFT", [90.0, 95.0, 99.0]),
        }
    )
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL", "MSFT"])
    resp = await svc.EvaluateReadiness(req, _ctx(_HEADERS))

    # Verdicts are produced for every requested symbol (order preserved).
    assert [v[0] for v in _verdicts(resp)] == ["AAPL", "MSFT"]

    # The staged rows carry the full readiness_cache shape (unchanged by the refactor).
    staged = {r["symbol"]: r for r in svc._readiness_cache_repo.upsert_many.await_args.args[0]}
    assert set(staged) == {"AAPL", "MSFT"}
    for row in staged.values():
        assert set(row) == {
            "user_id",
            "strategy_id",
            "rule",
            "symbol",
            "def_fingerprint",
            "bar_epoch",
            "readiness_json",
            "computed_at",
            "valid_until",
        }
        assert row["strategy_id"] == "s1"
        assert row["rule"] == "entry"
        assert row["bar_epoch"] > 0


# ── AC-7 / AC-1 / AC-5: the interactive bar_epoch-aware FAST gate (Step 3) ───


@pytest.mark.asyncio
async def test_new_daily_bar_busts_fast_gate_but_same_day_serves_fast():
    """AC-7: a cached in-window row is served FAST while GetDataCoverage reports the same latest bar
    (same trading day), but is recomputed (SLOW) once a newer daily bar appears — not on valid_until
    alone. AC-1 is the same-day FAST leg."""
    bars = _real_bars("AAPL", [120.0, 130.0, 150.0])
    svc = _cache_svc({"AAPL": bars})
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"])

    # SLOW warm, then feed the upserted row back as the cache.
    resp1 = await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    upserted = svc._readiness_cache_repo.upsert_many.await_args.args[0]
    row = {r["symbol"]: r for r in upserted}["AAPL"]
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={"AAPL": row})

    # Same trading day (coverage latest == row.bar_epoch) → FAST, no GetBars.
    svc._marketdata.GetBars.reset_mock()
    resp2 = await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count == 0  # FAST
    assert _verdicts(resp2) == _verdicts(resp1)

    # A new daily bar lands: coverage latest advances past the row's bar_epoch → SLOW recompute.
    svc._marketdata.GetBars.reset_mock()
    newer = row["bar_epoch"] + 86_400
    svc._marketdata.GetDataCoverage = AsyncMock(
        return_value=SimpleNamespace(latest=SimpleNamespace(seconds=newer))
    )
    await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count >= 1  # busted → SLOW re-fetch


@pytest.mark.asyncio
async def test_uncovered_pair_computes_on_demand_and_writes_row():
    """AC-5: an uncovered pair computes synchronously (SLOW) and writes a row, never blank."""
    svc = _cache_svc({"TSLA": _real_bars("TSLA", [200.0, 210.0, 220.0])})
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={})  # uncovered
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["TSLA"])

    resp = await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert [v[0] for v in _verdicts(resp)] == ["TSLA"]  # verdict returned, not blank
    assert svc._marketdata.GetBars.await_count >= 1  # SLOW
    written = {r["symbol"] for r in svc._readiness_cache_repo.upsert_many.await_args.args[0]}
    assert "TSLA" in written  # row written for subsequent reads
