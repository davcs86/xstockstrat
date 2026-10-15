"""read_budget against a real PostgreSQL (``local_pg``): AC-4, G2, F2 and G6."""

import asyncio
import logging
import time

import asyncpg
import asyncpg.exceptions as apg
import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.config.v1 import config_pb2

from app.repositories import read_budget
from app.repositories.opportunities import OpportunitiesRepository
from app.repositories.opportunity_compute_state import OpportunityComputeStateRepository
from app.repositories.read_budget import budgeted_read
from tests.test_analysis_servicer import _HEADERS, _ctx, _StubWatcher, make_servicer

pytestmark = pytest.mark.real_pg

_HANG_GUARD_S = 10


async def _pool(dsn, size, **kwargs):
    return await asyncpg.create_pool(
        dsn, min_size=size, max_size=size, statement_cache_size=0, **kwargs
    )


async def _pid_and_timeout(pool):
    async with pool.acquire() as con:
        assert await con.fetchval("SELECT 1") == 1
        return (
            await con.fetchval("SELECT pg_backend_pid()"),
            await con.fetchval("SHOW statement_timeout"),
        )


class _NoResetConnection(asyncpg.Connection):
    """Skips the pool's RESET ALL on release, so a leaked session setting stays observable."""

    def get_reset_query(self):
        return ""


# ---------------------------------------------------------------- @AC-4


async def test_ac4_exhausted_pool_fails_fast_at_acquire_with_unavailable(
    local_pg, monkeypatch, caplog
):
    terminated = []
    real_terminate = asyncpg.Connection.terminate

    def _spy_terminate(self):
        terminated.append(self)
        return real_terminate(self)

    monkeypatch.setattr(asyncpg.Connection, "terminate", _spy_terminate)
    pool = await _pool(local_pg, 2)
    held = []
    try:
        held = [await pool.acquire(), await pool.acquire()]
        svc = make_servicer()
        snap = config_pb2.ConfigSnapshot()
        snap.values["analysis.opportunity.read_db_budget_ms"].CopyFrom(
            config_pb2.ConfigValue(int_val=300)
        )
        svc._cfg = _StubWatcher()
        svc._cfg._snapshot = snap
        svc._db_pool = pool
        svc._opportunities_repo = OpportunitiesRepository(pool)
        svc._opportunity_compute_state_repo = OpportunityComputeStateRepository(pool)
        req = analysis_pb2.ListOpportunitiesRequest()

        ctx = _ctx(_HEADERS)
        t0 = time.monotonic()
        with caplog.at_level(logging.WARNING, logger=read_budget.__name__):
            resp = await asyncio.wait_for(svc.ListOpportunities(req, ctx), _HANG_GUARD_S)
        elapsed = time.monotonic() - t0

        assert resp is None
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE
        assert elapsed < 0.3 + 0.5
        msgs = [r.getMessage() for r in caplog.records]
        assert any("failed at acquire (TimeoutError" in m for m in msgs), msgs
        assert terminated == []
        assert not any(c.is_closed() for c in held)

        headerless = _ctx({})
        assert await asyncio.wait_for(svc.ListOpportunities(req, headerless), _HANG_GUARD_S) is None
        assert headerless.abort.await_args.args[0] == grpc.StatusCode.UNAUTHENTICATED
    finally:
        for con in held:
            await pool.release(con)
        await pool.close()


# ---------------------------------------------------------------- G2


async def test_g2_statement_timeout_rolls_back_and_keeps_the_connection(local_pg, caplog):
    pool = await _pool(local_pg, 1)
    try:
        pid, _ = await _pid_and_timeout(pool)

        async def run():
            async with budgeted_read(pool, 0.3) as bc:
                await bc.fetch("SELECT pg_sleep(5)")

        with caplog.at_level(logging.WARNING):
            with pytest.raises(apg.QueryCanceledError):
                await asyncio.wait_for(run(), _HANG_GUARD_S)
        assert not any(
            "Resetting connection with an active transaction" in r.getMessage()
            for r in caplog.records
        )
        assert await _pid_and_timeout(pool) == (pid, "0")
    finally:
        await pool.close()


# ---------------------------------------------------------------- F2


async def test_f2_set_local_does_not_leak_past_release(local_pg):
    pool = await _pool(local_pg, 1, connection_class=_NoResetConnection)
    try:
        pid, _ = await _pid_and_timeout(pool)

        async def run():
            async with budgeted_read(pool, 5.0) as bc:
                assert await bc.fetchval("SELECT 1") == 1

        await asyncio.wait_for(run(), _HANG_GUARD_S)
        assert await _pid_and_timeout(pool) == (pid, "0")

        # Negative control: a session-level SET does survive release on this pool.
        async with pool.acquire() as con:
            await con.execute("SET statement_timeout = 1234")
        assert await _pid_and_timeout(pool) == (pid, "1234ms")
    finally:
        await pool.close()


# ---------------------------------------------------------------- G6


async def test_g6_outer_timeout_terminates_the_connection(local_pg):
    pool = await _pool(local_pg, 1)
    try:
        pid, _ = await _pid_and_timeout(pool)

        async def run():
            async with asyncio.timeout(0.3):
                async with budgeted_read(pool, 10.0) as bc:
                    await bc.fetch("SELECT pg_sleep(30)")

        t0 = time.monotonic()
        with pytest.raises(TimeoutError) as ei:
            await asyncio.wait_for(run(), _HANG_GUARD_S)
        assert time.monotonic() - t0 < 1.0
        assert not isinstance(ei.value, apg.QueryCanceledError)
        new_pid, timeout = await asyncio.wait_for(_pid_and_timeout(pool), _HANG_GUARD_S)
        assert new_pid != pid and timeout == "0"
    finally:
        await pool.close()
