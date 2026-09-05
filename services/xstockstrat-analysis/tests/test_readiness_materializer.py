"""Feature 180 — readiness materializer loop (AC-1, AC-2, AC-3, AC-4, AC-6).

Drives ``_readiness_materializer_tick`` directly (unit-level, like test_opportunity_refresh.py)
against a due DurableSchedule stub. C-13: reuses the sibling readiness fixtures
(``_real_bars``/``_simple_strategy_row``) and ``make_servicer``; declares no new fixture module.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.handlers.servicer import _definition_fingerprint

from .test_analysis_servicer import _EOF_PAGE, _HEADERS, _ctx, make_servicer
from .test_readiness_opportunities_source_symbol import _real_bars, _simple_strategy_row

pytestmark = pytest.mark.asyncio


def _live_row(user_id, strategy_id):
    return {**_simple_strategy_row(), "user_id": user_id, "strategy_id": strategy_id}


def _due_schedule():
    """A DurableSchedule stub that is always due and records advance() calls."""
    sched = MagicMock()
    sched.next_sleep_seconds = AsyncMock(return_value=0.0)
    sched.advance = AsyncMock()
    return sched


class _CountingSem:
    """A drop-in async-context semaphore that counts entries (to prove which sem the loop uses)."""

    def __init__(self):
        self.entered = 0

    async def __aenter__(self):
        self.entered += 1

    async def __aexit__(self, *exc):
        return False


def _materializer_svc(live_rows, bindings_by_owner, bars_by_symbol, *, enabled=True, existing=None):
    svc = make_servicer()
    svc._db_pool = MagicMock()  # truthy loop guard; the tick uses the schedule stub, not the pool
    svc._cfg.get_bool = MagicMock(return_value=enabled)
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.list_live_enabled = AsyncMock(return_value=live_rows)

    svc._portfolio = MagicMock()

    async def _list_watchlists(req, metadata=None):
        owner = dict(metadata or []).get("x-user-id")
        binds = bindings_by_owner.get(owner, [])
        wl = SimpleNamespace(
            bindings=[SimpleNamespace(symbol=s, strategy_id=sid) for (s, sid) in binds],
            symbols=[],
        )
        return SimpleNamespace(watchlists=[wl], page=SimpleNamespace(next_page_token=""))

    svc._portfolio.ListWatchlists = AsyncMock(side_effect=_list_watchlists)

    svc._marketdata = MagicMock()

    async def _get_bars(req, metadata=None):
        return SimpleNamespace(page=_EOF_PAGE, bars=bars_by_symbol.get(req.symbol, []))

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)

    async def _get_coverage(req, metadata=None):
        bars = bars_by_symbol.get(req.symbol, [])
        return SimpleNamespace(latest=SimpleNamespace(seconds=bars[-1].time.seconds if bars else 0))

    svc._marketdata.GetDataCoverage = AsyncMock(side_effect=_get_coverage)

    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    svc._readiness_cache_repo = AsyncMock()
    svc._readiness_cache_repo.read_many = AsyncMock(return_value=existing or {})
    svc._readiness_cache_repo.upsert_many = AsyncMock()
    return svc


def _upserted_rows(svc):
    return [
        r for call in svc._readiness_cache_repo.upsert_many.await_args_list for r in call.args[0]
    ]


async def test_owner_scoped_derivation_from_bindings():
    """AC-2: rows are materialized from actual watchlist bindings, each keyed under the binding's
    true owner; no cross-user leak."""
    live = [_live_row("U1", "STR-1"), _live_row("U2", "STR-2")]
    bindings = {"U1": [("MSFT", "STR-1")], "U2": [("NVDA", "STR-2")]}
    bars = {
        "MSFT": _real_bars("MSFT", [90.0, 95.0, 99.0]),
        "NVDA": _real_bars("NVDA", [1.0, 2.0, 3.0]),
    }
    svc = _materializer_svc(live, bindings, bars)

    await svc._readiness_materializer_tick(_due_schedule())

    keyed = {(r["user_id"], r["symbol"], r["strategy_id"]) for r in _upserted_rows(svc)}
    assert ("U1", "MSFT", "STR-1") in keyed
    assert ("U2", "NVDA", "STR-2") in keyed
    # No row is ever written under a user for a binding they do not own.
    assert not any(
        r["user_id"] == "U1" and r["strategy_id"] == "STR-2" for r in _upserted_rows(svc)
    )
    # Each owner's watchlist was drained under that owner's own x-user-id.
    owners_read = {
        dict(c.kwargs["metadata"])["x-user-id"]
        for c in svc._portfolio.ListWatchlists.await_args_list
    }
    assert owners_read == {"U1", "U2"}


async def test_non_live_binding_skipped_cycle_not_halted():
    """AC-6: a binding to a non-live strategy is skipped (never fabricated), and the cycle still
    materializes the owner's live binding without raising."""
    live = [_live_row("U1", "STR-1")]  # STR-4 is NOT live
    bindings = {"U1": [("AMD", "STR-4"), ("AAPL", "STR-1")]}
    bars = {"AMD": _real_bars("AMD", [1.0, 2.0, 3.0]), "AAPL": _real_bars("AAPL", [1.0, 2.0, 3.0])}
    svc = _materializer_svc(live, bindings, bars)

    await svc._readiness_materializer_tick(_due_schedule())  # must not raise

    keyed = {(r["symbol"], r["strategy_id"]) for r in _upserted_rows(svc)}
    assert ("AMD", "STR-4") not in keyed  # non-live binding skipped
    assert ("AAPL", "STR-1") in keyed  # live binding still materialized


async def test_stale_fingerprint_recomputed():
    """AC-3: a cached row whose def_fingerprint no longer matches is recomputed, not skipped."""
    live = [_live_row("U1", "STR-1")]
    bindings = {"U1": [("AAPL", "STR-1")]}
    bars = {"AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0])}
    existing = {
        "AAPL": {
            "symbol": "AAPL",
            "def_fingerprint": "fp-old",
            "bar_epoch": 10**12,  # huge → NOT busted by bar_epoch; only the fingerprint differs
            "readiness_json": {},
            "computed_at": datetime.now(UTC),
            "valid_until": datetime.now(UTC) + timedelta(hours=48),
        }
    }
    svc = _materializer_svc(live, bindings, bars, existing=existing)

    await svc._readiness_materializer_tick(_due_schedule())

    row = {r["symbol"]: r for r in _upserted_rows(svc)}["AAPL"]
    current_fp = _definition_fingerprint(_simple_strategy_row()["definition_json"])
    assert row["def_fingerprint"] == current_fp
    assert row["def_fingerprint"] != "fp-old"


async def test_uses_own_semaphore_not_interactive():
    """AC-4: the materializer's bars fetches go through its OWN semaphore, never the interactive
    _bars_fetch_sem (feature-176 priority-inversion guard); no new DB pool is created (F-06)."""
    live = [_live_row("U1", "STR-1")]
    bindings = {"U1": [("AAPL", "STR-1")]}
    bars = {"AAPL": _real_bars("AAPL", [1.0, 2.0, 3.0])}
    svc = _materializer_svc(live, bindings, bars)
    assert svc._readiness_materializer_bars_sem is not svc._bars_fetch_sem
    interactive, materializer = _CountingSem(), _CountingSem()
    svc._bars_fetch_sem = interactive
    svc._readiness_materializer_bars_sem = materializer

    await svc._readiness_materializer_tick(_due_schedule())

    assert materializer.entered >= 1  # the loop used its own semaphore
    assert interactive.entered == 0  # never the interactive one


async def test_skip_fresh_when_all_rows_current():
    """fails.md:118 steady state: when every row is fresh, no recompute or bars fetch runs."""
    live = [_live_row("U1", "STR-1")]
    bindings = {"U1": [("AAPL", "STR-1")]}
    bars = {"AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0])}
    current_fp = _definition_fingerprint(_simple_strategy_row()["definition_json"])
    latest = bars["AAPL"][-1].time.seconds
    existing = {
        "AAPL": {
            "symbol": "AAPL",
            "def_fingerprint": current_fp,
            "bar_epoch": latest,  # up to date
            "readiness_json": {},
            "computed_at": datetime.now(UTC),
            "valid_until": datetime.now(UTC) + timedelta(hours=48),
        }
    }
    svc = _materializer_svc(live, bindings, bars, existing=existing)

    await svc._readiness_materializer_tick(_due_schedule())

    assert svc._marketdata.GetBars.await_count == 0  # skip-fresh: nothing recomputed
    assert svc._readiness_cache_repo.upsert_many.await_count == 0


async def test_disabled_kill_switch_does_nothing():
    """The loop is OFF by default: a disabled tick enumerates nothing and writes nothing."""
    svc = _materializer_svc(
        [_live_row("U1", "STR-1")], {"U1": [("AAPL", "STR-1")]}, {}, enabled=False
    )

    await svc._readiness_materializer_tick(_due_schedule())

    svc._strategies_repo.list_live_enabled.assert_not_awaited()
    svc._readiness_cache_repo.upsert_many.assert_not_awaited()


async def test_materialized_row_serves_fast_on_read():
    """AC-1 (behavioral link): a materialized row serves a subsequent EvaluateReadiness FAST."""
    live = [_live_row("u1", "STR-1")]  # owner matches _HEADERS x-user-id
    bindings = {"u1": [("AAPL", "STR-1")]}
    bars = {"AAPL": _real_bars("AAPL", [120.0, 130.0, 150.0])}
    svc = _materializer_svc(live, bindings, bars)

    await svc._readiness_materializer_tick(_due_schedule())
    row = {r["symbol"]: r for r in _upserted_rows(svc)}["AAPL"]

    # Read the same pair back: the materialized row is fresh (fingerprint + latest bar) → FAST.
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_live_row("u1", "STR-1"))
    svc._readiness_cache_repo.read_many = AsyncMock(return_value={"AAPL": row})
    svc._marketdata.GetBars.reset_mock()
    req = analysis_pb2.EvaluateReadinessRequest(strategy_id="STR-1", symbols=["AAPL"])
    await svc.EvaluateReadiness(req, _ctx(_HEADERS))
    assert svc._marketdata.GetBars.await_count == 0  # served FAST from the materialized row
