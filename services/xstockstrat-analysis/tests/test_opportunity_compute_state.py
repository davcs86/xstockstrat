"""Feature 177 FR-3 — empty-universe compute-state (AC-4).

A user whose universe legitimately yields zero opportunities must not force a synchronous recompute
on every poll. These tests drive ``ListOpportunities`` and the three empty-yielding compute paths,
asserting the compute-state gate: a fresh empty stamp serves empty (kicking a background self-heal),
an absent/elapsed stamp computes synchronously.

C-13: the ``_FakeComputeState`` stub and the sentinel opportunity-row literal are single-consumer to
this file (no other test needs an in-memory compute-state) → kept inline. Reuses ``make_servicer`` /
``_ctx`` / ``_HEADERS`` from the sibling servicer test module.
"""

import asyncio
import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

from app.engine.durable_schedule import DurableSchedule

from .test_analysis_servicer import _HEADERS, _ctx, make_servicer

pytestmark = pytest.mark.asyncio


class _FakeComputeState:
    """In-memory stand-in for OpportunityComputeStateRepository — get returns the last upserted row,
    upsert stamps it. AsyncMock wrappers record call args for the assertions."""

    def __init__(self):
        self.row = None

        def _get(user_id):
            return self.row

        def _upsert(user_id, valid_until):
            self.row = {"computed_at": datetime.now(UTC), "valid_until": valid_until}

        self.get = AsyncMock(side_effect=_get)
        self.upsert = AsyncMock(side_effect=_upsert)


def _opp_svc():
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._opportunities_repo.read = AsyncMock(return_value=[])
    svc._opportunities_repo.count_for_user = AsyncMock(return_value=0)
    svc._opportunities_repo.replace_for_user = AsyncMock()
    svc._opportunity_compute_state_repo = _FakeComputeState()
    svc._compute_opportunities = AsyncMock(return_value=[])
    return svc


async def test_empty_universe_recomputes_at_most_once_over_window():
    """AC-4: four polls of a legitimately-empty universe recompute synchronously at most once — the
    cold poll computes + stamps; polls 2-4 serve empty and only kick a background self-heal."""
    svc = _opp_svc()
    svc._kick_opportunity_recompute = MagicMock()
    req = analysis_pb2.ListOpportunitiesRequest(min_conviction=0.0)

    for _ in range(4):
        resp = await svc.ListOpportunities(req, _ctx(_HEADERS))
        assert len(resp.opportunities) == 0

    assert svc._compute_opportunities.await_count == 1  # only the cold poll computed
    assert svc._opportunity_compute_state_repo.upsert.await_count == 1  # stamped once
    assert svc._kick_opportunity_recompute.call_count == 3  # polls 2-4 self-heal in background


async def test_fresh_empty_serve_kicks_self_heal_and_writes_new_row():
    """empty→non-empty within one TTL: after the empty stamp, a poll kicks the background recompute,
    which surfaces the newly-appeared row (replace_for_user receives it) — the self-heal path."""
    svc = _opp_svc()
    svc._compute_opportunities = AsyncMock(side_effect=[[], [{"symbol": "AAPL"}]])
    req = analysis_pb2.ListOpportunitiesRequest(min_conviction=0.0)

    await svc.ListOpportunities(req, _ctx(_HEADERS))  # poll1: cold → empty stamp
    await svc.ListOpportunities(req, _ctx(_HEADERS))  # poll2: fresh stamp → kick self-heal
    # poll2 must NOT recompute synchronously — the fresh empty stamp serves empty and only kicks a
    # background revalidate (contrast the pre-FR-3 tree, which re-materializes on every empty poll).
    assert svc._compute_opportunities.await_count == 1
    for _ in range(3):  # let the fire-and-forget recompute task run
        await asyncio.sleep(0)

    assert svc._compute_opportunities.await_count == 2  # the background self-heal recomputed
    assert svc._opportunities_repo.replace_for_user.await_args.args[1] == [{"symbol": "AAPL"}]


async def test_stamp_helper_stamps_on_empty_not_on_nonempty():
    """The shared stamp helper upserts a future valid_until only when the compute yielded nothing;
    a non-empty replace never stamps compute-state."""
    svc = _opp_svc()

    await svc._replace_and_stamp_compute_state("u1", [], None)
    assert svc._opportunity_compute_state_repo.upsert.await_count == 1
    assert svc._opportunity_compute_state_repo.upsert.await_args.args[1] > datetime.now(UTC)

    await svc._replace_and_stamp_compute_state("u1", [{"symbol": "AAPL"}], None)
    assert svc._opportunity_compute_state_repo.upsert.await_count == 1  # non-empty never stamps


async def test_kick_run_stamps_compute_state_on_empty():
    """The background _kick recompute stamps compute-state on an empty completion (second of the
    three empty-yielding replace sites)."""
    svc = _opp_svc()
    svc._kick_opportunity_recompute("u1", [("x-user-id", "u1")])
    for _ in range(3):
        await asyncio.sleep(0)
    assert svc._opportunity_compute_state_repo.upsert.await_count == 1


async def test_daily_refresh_tick_stamps_and_still_advances_schedule():
    """The daily refresh tick stamps compute-state on an empty pass AND still advances the
    wall-clock schedule (feature-158 @AC-8/@AC-9 untouched — the helper only adds an upsert)."""
    svc = _opp_svc()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=["u1"])
    pool = AsyncMock()
    pool.fetchval = AsyncMock(return_value=0)  # blocked_until_ms 0 → due now
    pool.execute = AsyncMock()
    schedule = DurableSchedule(pool, "opportunity", "wallclock", anchor_hour=lambda: 0)

    now_ms = int(time.time() * 1000)
    sleep_s = await svc._opportunity_refresh_tick(schedule)

    assert sleep_s == 0.0
    assert svc._opportunity_compute_state_repo.upsert.await_count == 1  # empty pass stamped
    # schedule.advance still fired (its UPDATE writes a future blocked_until_ms via pool.execute).
    assert pool.execute.await_count >= 1
    assert pool.execute.await_args_list[-1].args[1] > now_ms
