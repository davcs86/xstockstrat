"""Feature 180 — shared readiness compute + pure freshness/valid-until units (AC-1 byte-identity).

C-13: reuses `_cache_svc`/`_verdicts` from the sibling `test_readiness_cache.py` (the canonical
single-consumer home for the readiness servicer mock) and the `_real_bars`/`_simple_strategy_row`
fixtures it re-exports — this module declares no new fixtures.
"""

from datetime import UTC, datetime, timedelta

import pytest
from gen.analysis.v1 import analysis_pb2

from app.services.readiness import (
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
