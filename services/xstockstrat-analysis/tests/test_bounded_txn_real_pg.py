"""bounded_txn on a real PostgreSQL (``local_pg``): the asyncpg behaviour feature 367 rests on."""

import asyncio
import contextlib
import os
import signal
import time

import asyncpg
import asyncpg.exceptions as apg
import pytest

from app.repositories.read_budget import (
    DbBudgetExceeded,
    TxnNotCommitted,
    bounded_txn,
    control_pool_reset,
)

pytestmark = pytest.mark.real_pg

_HANG_GUARD_S = 10


async def _pool(dsn, size, **kwargs):
    kwargs.setdefault("min_size", size)
    return await asyncpg.create_pool(dsn, max_size=size, statement_cache_size=0, **kwargs)


async def _pid(pool):
    async with pool.acquire() as con:
        return await con.fetchval("SELECT pg_backend_pid()")


@pytest.fixture
def sent(monkeypatch):
    """Every query text a pooled connection sends through ``execute``/``fetch*``."""
    seen: list[str] = []
    for name in ("execute", "fetch", "fetchrow", "fetchval"):
        real = getattr(asyncpg.Connection, name)

        def _spy(self, query, *args, _real=real, **kwargs):
            seen.append(query)
            return _real(self, query, *args, **kwargs)

        monkeypatch.setattr(asyncpg.Connection, name, _spy)
    return seen


async def test_statement_over_budget_is_cancelled_by_the_server_and_the_backend_reused(local_pg):
    pool = await _pool(local_pg, 1)
    try:
        pid = await _pid(pool)

        async def run():
            async with bounded_txn(pool, 0.3) as tx:
                await tx.fetch("SELECT pg_sleep(5)")

        t0 = time.monotonic()
        with pytest.raises(apg.QueryCanceledError):
            await asyncio.wait_for(run(), _HANG_GUARD_S)
        assert time.monotonic() - t0 < 2.0
        assert await asyncio.wait_for(_pid(pool), _HANG_GUARD_S) == pid
    finally:
        await pool.close()


async def test_frozen_backend_is_cut_at_budget_plus_grace_and_the_pool_recovers(local_pg):
    pool = await _pool(local_pg, 1)
    pid = await _pid(pool)
    try:

        async def run():
            async with bounded_txn(pool, 0.3) as tx:
                os.kill(pid, signal.SIGSTOP)
                await tx.fetch("SELECT 1")

        t0 = time.monotonic()
        with pytest.raises(DbBudgetExceeded):
            await asyncio.wait_for(run(), _HANG_GUARD_S)
        elapsed = time.monotonic() - t0
        assert 2.0 <= elapsed < 3.5, elapsed
    finally:
        os.kill(pid, signal.SIGCONT)
    try:
        assert await asyncio.wait_for(_pid(pool), _HANG_GUARD_S) != pid
    finally:
        await pool.close()


async def test_cancel_inside_an_open_transaction_terminates_without_rollback(local_pg, sent):
    pool = await _pool(local_pg, 1)
    try:
        pid = await _pid(pool)
        inside = asyncio.Event()

        async def run():
            async with bounded_txn(pool, 5.0) as tx:
                inside.set()
                await tx.fetch("SELECT pg_sleep(5)")

        task = asyncio.create_task(run())
        await asyncio.wait_for(inside.wait(), _HANG_GUARD_S)
        await asyncio.sleep(0.1)
        sent.clear()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, _HANG_GUARD_S)
        assert "ROLLBACK" not in sent
        assert await asyncio.wait_for(_pid(pool), _HANG_GUARD_S) != pid
    finally:
        await pool.close()


async def test_commit_that_returns_rollback_raises(local_pg):
    pool = await _pool(local_pg, 1)
    try:
        pid = await _pid(pool)
        with pytest.raises(TxnNotCommitted):
            async with bounded_txn(pool, 5.0) as tx:
                with contextlib.suppress(apg.DivisionByZeroError):
                    await tx.execute("SELECT 1 / 0")
        assert await asyncio.wait_for(_pid(pool), _HANG_GUARD_S) == pid
    finally:
        await pool.close()


async def test_cancel_during_acquire_on_an_exhausted_pool_returns_the_connection(local_pg):
    pool = await _pool(local_pg, 1)
    try:
        held = await pool.acquire()
        waiting = asyncio.create_task(bounded_txn(pool, 5.0).__aenter__())
        await asyncio.sleep(0.1)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        await pool.release(held)
        for _ in range(2):
            async with bounded_txn(pool, 2.0) as tx:
                assert await tx.fetchval("SELECT 1") == 1
    finally:
        await pool.close()


async def test_control_pool_release_issues_no_query(local_pg, sent):
    pool = await _pool(local_pg, 2, min_size=0, reset=control_pool_reset)
    try:
        assert pool.get_size() == 0
        async with bounded_txn(pool, 2.0) as tx:
            assert await tx.fetchval("SELECT 1") == 1
        sent.clear()
        con = await pool.acquire()
        await pool.release(con)
        assert sent == []
    finally:
        await pool.close()


async def test_control_pool_rolls_back_a_stray_in_transaction_release(local_pg):
    # asyncpg 0.31 rolls back before the reset callback runs (Deviation Log, Step 6).
    pool = await _pool(local_pg, 1, min_size=0, reset=control_pool_reset)
    reported = []
    loop = asyncio.get_running_loop()
    previous = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, ctx: reported.append(ctx["message"]))
    try:
        con = await pool.acquire()
        pid = await con.fetchval("SELECT pg_backend_pid()")
        await con.execute("BEGIN")
        await pool.release(con)
        assert any("active transaction" in m for m in reported)
        async with pool.acquire() as again:
            assert await again.fetchval("SELECT pg_backend_pid()") == pid
            assert not again.is_in_transaction()
    finally:
        loop.set_exception_handler(previous)
        await pool.close()


class _ReleaseSpy:
    """Delegates to a real pool; records whether each released connection was in a transaction."""

    def __init__(self, pool):
        self._pool = pool
        self.in_txn_at_release: list[bool] = []

    async def acquire(self, timeout):
        return await self._pool.acquire(timeout=timeout)

    async def release(self, con, timeout):
        self.in_txn_at_release.append(con.is_in_transaction())
        await self._pool.release(con, timeout=timeout)


async def test_bounded_txn_never_releases_inside_a_transaction(local_pg):
    pool = await _pool(local_pg, 1, min_size=0, reset=control_pool_reset)
    try:
        spy = _ReleaseSpy(pool)
        async with bounded_txn(spy, 2.0) as tx:
            await tx.fetchval("SELECT 1")
        with pytest.raises(ValueError):
            async with bounded_txn(spy, 2.0) as tx:
                await tx.fetchval("SELECT 1")
                raise ValueError("block failed")
        with pytest.raises(TxnNotCommitted):
            async with bounded_txn(spy, 2.0) as tx:
                with contextlib.suppress(apg.DivisionByZeroError):
                    await tx.execute("SELECT 1 / 0")
        assert spy.in_txn_at_release == [False, False, False]
    finally:
        await pool.close()


async def test_hooks_run_in_order_and_on_terminate_once(local_pg, sent):
    pool = await _pool(local_pg, 1)
    try:
        await _pid(pool)
        sent.clear()
        async with bounded_txn(pool, 2.0, on_acquired=lambda: sent.append("acquired")) as tx:
            await tx.fetchval("SELECT 1")
        assert sent[0] == "acquired"
        assert sent[1].startswith("BEGIN;")

        calls: list[int] = []

        async def aborted():
            async with bounded_txn(pool, 5.0, on_terminate=lambda: calls.append(1)) as tx:
                tx.abort()
                tx.abort()
                await tx.fetchval("SELECT 1")

        with pytest.raises(asyncpg.InterfaceError):
            await asyncio.wait_for(aborted(), _HANG_GUARD_S)
        assert calls == [1]

        pid = await _pid(pool)
        calls.clear()

        async def timed_out():
            async with bounded_txn(pool, 0.2, on_terminate=lambda: calls.append(1)) as tx:
                os.kill(pid, signal.SIGSTOP)
                await tx.fetchval("SELECT 1")

        try:
            with pytest.raises(DbBudgetExceeded):
                await asyncio.wait_for(timed_out(), _HANG_GUARD_S)
        finally:
            os.kill(pid, signal.SIGCONT)
        assert calls == [1]
    finally:
        await pool.close()


async def test_set_local_statement_timeout_does_not_leak_past_the_transaction(local_pg):
    pool = await _pool(local_pg, 1)
    try:
        async with bounded_txn(pool, 2.0) as tx:
            assert await tx.fetchval("SHOW statement_timeout") != "0"
        async with pool.acquire() as con:
            assert await con.fetchval("SHOW statement_timeout") == "0"
    finally:
        await pool.close()
