"""bounded_txn cleanup branches on a fake connection and an injected clock; no database."""

import asyncio
import re

import pytest

from app.repositories.read_budget import DbBudgetExceeded, TxnNotCommitted, bounded_txn


class _Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


class _Con:
    def __init__(self, clock, *, commit_tag="COMMIT", fail_rollback=False):
        self.clock = clock
        self.sent: list[str] = []
        self.terminated = 0
        self.commit_tag = commit_tag
        self.fail_rollback = fail_rollback

    async def execute(self, query, *args):
        self.sent.append(query)
        if query == "COMMIT":
            return self.commit_tag
        if query == "ROLLBACK" and self.fail_rollback:
            raise OSError("socket gone")
        return "OK"

    async def fetchval(self, query, *args):
        self.sent.append(query)
        self.clock.t += 0.4
        return 1

    def terminate(self):
        self.terminated += 1


class _Pool:
    def __init__(self, con, clock, *, acquire_cost=0.0):
        self.con = con
        self.clock = clock
        self.acquire_cost = acquire_cost
        self.acquire_timeouts: list[float] = []
        self.released = 0

    async def acquire(self, timeout):
        self.acquire_timeouts.append(timeout)
        self.clock.t += self.acquire_cost
        return self.con

    async def release(self, con, timeout):
        self.released += 1


def _armed_ms(sent):
    return [int(m) for q in sent for m in re.findall(r"statement_timeout = (\d+)", q)]


async def test_deadline_is_fixed_before_the_acquire():
    clock = _Clock()
    con = _Con(clock)
    pool = _Pool(con, clock, acquire_cost=0.5)
    async with bounded_txn(pool, 2.0, monotonic=clock) as tx:
        assert tx.begin_sent_at == 100.5
    assert pool.acquire_timeouts == [2.0]
    assert _armed_ms(con.sent)[0] == 1500


async def test_rearmed_timeout_shrinks_across_statements():
    clock = _Clock()
    con = _Con(clock)
    async with bounded_txn(_Pool(con, clock), 2.0, monotonic=clock) as tx:
        await tx.fetchval("SELECT 1")
        await tx.fetchval("SELECT 2")
    armed = _armed_ms(con.sent)
    assert armed == sorted(armed, reverse=True) and armed[-1] < armed[1] < armed[0] + 1
    assert con.sent[-1] == "COMMIT"


async def test_exhausted_budget_before_a_statement_raises_budget_exceeded():
    clock = _Clock()
    con = _Con(clock)
    with pytest.raises(DbBudgetExceeded):
        async with bounded_txn(_Pool(con, clock), 0.7, monotonic=clock) as tx:
            await tx.fetchval("SELECT 1")
            await tx.fetchval("SELECT 2")
            await tx.fetchval("SELECT 3")
    assert con.sent[-1] == "ROLLBACK"


async def test_block_exception_rolls_back_and_reraises_the_original():
    clock = _Clock()
    con = _Con(clock)
    pool = _Pool(con, clock)
    with pytest.raises(KeyError):
        async with bounded_txn(pool, 2.0, monotonic=clock):
            raise KeyError("boom")
    assert con.sent[-1] == "ROLLBACK" and con.terminated == 0 and pool.released == 1


async def test_failed_rollback_terminates_and_skips_the_release():
    clock = _Clock()
    con = _Con(clock, fail_rollback=True)
    pool = _Pool(con, clock)
    with pytest.raises(KeyError):
        async with bounded_txn(pool, 2.0, monotonic=clock):
            raise KeyError("boom")
    assert con.terminated == 1 and pool.released == 0


async def test_commit_tag_other_than_commit_raises():
    clock = _Clock()
    con = _Con(clock, commit_tag="ROLLBACK")
    pool = _Pool(con, clock)
    with pytest.raises(TxnNotCommitted):
        async with bounded_txn(pool, 2.0, monotonic=clock):
            pass
    assert pool.released == 1


async def test_terminated_flag_suppresses_a_second_terminate_and_the_release():
    clock = _Clock()
    con = _Con(clock)
    pool = _Pool(con, clock)
    hooks = []
    with pytest.raises(KeyError):
        async with bounded_txn(
            pool, 2.0, monotonic=clock, on_terminate=lambda: hooks.append(1)
        ) as tx:
            tx.abort()
            tx.abort()
            raise KeyError("after abort")
    assert con.terminated == 1 and hooks == [1] and pool.released == 0
    assert "ROLLBACK" not in con.sent


async def test_cancellation_terminates_without_rollback_or_release():
    clock = _Clock()
    con = _Con(clock)
    pool = _Pool(con, clock)
    with pytest.raises(asyncio.CancelledError):
        async with bounded_txn(pool, 2.0, monotonic=clock):
            raise asyncio.CancelledError
    assert con.terminated == 1 and pool.released == 0 and "ROLLBACK" not in con.sent


async def test_on_acquired_failure_terminates_before_begin():
    clock = _Clock()
    con = _Con(clock)

    def _refuse():
        raise RuntimeError("stop pending")

    with pytest.raises(RuntimeError):
        async with bounded_txn(_Pool(con, clock), 2.0, monotonic=clock, on_acquired=_refuse):
            pass
    assert con.sent == [] and con.terminated == 1
