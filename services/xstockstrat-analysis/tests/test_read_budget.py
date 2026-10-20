"""read_budget: the request-scoped DB budget (G1, G2 unit, G5, G7, classification)."""

import asyncio
import logging
import time

import asyncpg
import asyncpg.exceptions as apg
import pytest
from asyncpg.exceptions._base import DataError as InterfaceDataError

from app.repositories import read_budget
from app.repositories.read_budget import BudgetedConn, budgeted_read, is_transient_db_error
from tests.conftest import FakeConn, FakePool

_HANG_GUARD_S = 10


def _set_locals(conn):
    return [e for e in conn.log if e.startswith("SET LOCAL statement_timeout = ")]


class _LogIntoConn(logging.Handler):
    """Interleaves budgeted_read's log records into the conn log, so ordering is assertable."""

    def __init__(self, conn):
        super().__init__()
        self._conn = conn

    def emit(self, record):
        self._conn.log.append(f"LOG {record.getMessage()}")


# ---------------------------------------------------------------- success path


async def test_success_runs_begin_set_local_stmt_commit_release_in_order():
    conn = FakeConn()
    pool = FakePool(conn)
    async with budgeted_read(pool, 5.0) as bc:
        await bc.fetch("SELECT 1")
        await bc.fetchval("SELECT 1")
        await bc.fetchrow("SELECT 1")

    assert conn.log[0] == "BEGIN READ ONLY"
    assert conn.log[-2:] == ["COMMIT", "release"]
    body = conn.log[1:-2]
    assert [e for e in body if not e.startswith("SET LOCAL")] == ["fetch", "fetchval", "fetchrow"]
    assert body[0::2] == _set_locals(conn) and len(_set_locals(conn)) == 3
    ms = [int(s.rsplit(" ", 1)[1]) for s in _set_locals(conn)]
    assert all(0 < m <= 5000 for m in ms) and ms == sorted(ms, reverse=True)
    assert pool.acquire_timeouts == [5.0]
    assert pool.release_timeouts == [read_budget._RELEASE_TIMEOUT_S]
    assert conn.terminated == 0


# ---------------------------------------------------------------- G1


async def test_arm_after_deadline_raises_timeout_without_sending_set_local():
    conn = FakeConn()
    bc = BudgetedConn(conn, time.monotonic() - 0.001)
    with pytest.raises(TimeoutError, match="budget exhausted"):
        await bc.fetch("SELECT 1")
    assert conn.log == []


async def test_budget_exhausted_in_body_rolls_back_and_releases_without_terminate():
    conn = FakeConn()
    pool = FakePool(conn)

    async def run():
        async with budgeted_read(pool, 0.05) as bc:
            await asyncio.sleep(0.1)
            await bc.fetch("SELECT 1")

    with pytest.raises(TimeoutError, match="budget exhausted"):
        await asyncio.wait_for(run(), _HANG_GUARD_S)
    assert _set_locals(conn) == []
    assert conn.log == ["BEGIN READ ONLY", "ROLLBACK", "release"]
    assert conn.terminated == 0


async def test_acquire_timeout_fails_at_stage_acquire_without_terminate(caplog):
    pool = FakePool(acquire_raise=TimeoutError())
    with caplog.at_level(logging.WARNING, logger=read_budget.__name__):
        with pytest.raises(TimeoutError):
            async with budgeted_read(pool, 0.3):
                pytest.fail("body must not run without a connection")
    assert pool.acquire_timeouts == [0.3]
    assert pool.handed == []
    msgs = [r.getMessage() for r in caplog.records]
    assert any("failed at acquire (TimeoutError" in m for m in msgs), msgs


# ---------------------------------------------------------------- G2 unit


async def test_body_query_canceled_rolls_back_and_releases():
    conn = FakeConn(raise_on={"fetch": apg.QueryCanceledError("canceling statement")})
    pool = FakePool(conn)
    with pytest.raises(apg.QueryCanceledError):
        async with budgeted_read(pool, 5.0) as bc:
            await bc.fetch("SELECT pg_sleep(5)")
    assert conn.log[-2:] == ["ROLLBACK", "release"]
    assert conn.terminated == 0 and conn.released


@pytest.mark.parametrize("stage", ["begin", "commit"])
async def test_begin_or_commit_failure_terminates_without_rollback(stage):
    conn = FakeConn(raise_on={stage: apg.PostgresConnectionError("server closed the connection")})
    pool = FakePool(conn)
    with pytest.raises(apg.PostgresConnectionError):
        async with budgeted_read(pool, 5.0) as bc:
            await bc.fetch("SELECT 1")
    assert "ROLLBACK" not in conn.log
    assert conn.terminated == 1
    assert not conn.released and pool.release_timeouts == []


# ---------------------------------------------------------------- G5


@pytest.mark.parametrize("stage", ["begin", "set_local", "fetch", "commit"])
async def test_backstop_bounds_a_stall_at_every_stage_and_terminates_once(monkeypatch, stage):
    monkeypatch.setattr(read_budget, "_READ_DB_BACKSTOP_GRACE_S", 0.1)
    budget = 0.2
    conn = FakeConn(stall={stage})
    pool = FakePool(conn)

    async def run():
        async with budgeted_read(pool, budget) as bc:
            await bc.fetch("SELECT 1")

    t0 = time.monotonic()
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(run(), _HANG_GUARD_S)
    assert time.monotonic() - t0 < budget + 0.1 + 0.5
    assert conn.terminated == 1
    assert "ROLLBACK" not in conn.log and not conn.released


async def test_external_cancel_terminates_and_propagates_cancelled():
    conn = FakeConn(stall={"fetch"})
    pool = FakePool(conn)

    async def run():
        async with budgeted_read(pool, 30.0) as bc:
            await bc.fetch("SELECT 1")

    task = asyncio.create_task(run())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, _HANG_GUARD_S)
    assert conn.terminated == 1 and "ROLLBACK" not in conn.log


# ---------------------------------------------------------------- G7


async def test_original_exception_reraised_and_logged_before_rollback():
    original = apg.QueryCanceledError("canceling statement due to statement timeout")
    conn = FakeConn(raise_on={"fetch": original})
    pool = FakePool(conn)
    handler = _LogIntoConn(conn)
    logging.getLogger(read_budget.__name__).addHandler(handler)
    try:
        with pytest.raises(apg.QueryCanceledError) as ei:
            async with budgeted_read(pool, 5.0) as bc:
                await bc.fetch("SELECT 1")
    finally:
        logging.getLogger(read_budget.__name__).removeHandler(handler)
    assert ei.value is original
    failed_at = next(i for i, e in enumerate(conn.log) if "read DB phase failed at open" in e)
    assert failed_at < conn.log.index("ROLLBACK")


async def test_detached_proxy_reraises_original_with_cleanup_warning_and_no_terminate(caplog):
    original = apg.ConnectionDoesNotExistError("connection was closed in the middle of operation")
    conn = FakeConn()
    pool = FakePool(conn)
    with caplog.at_level(logging.WARNING, logger=read_budget.__name__):
        with pytest.raises(apg.ConnectionDoesNotExistError) as ei:
            async with budgeted_read(pool, 5.0) as bc:
                await bc.fetch("SELECT 1")
                conn.detached = True
                raise original
    assert ei.value is original
    assert conn.terminated == 0
    msgs = [r.getMessage() for r in caplog.records]
    assert any("cleanup after open skipped/failed (InterfaceError" in m for m in msgs), msgs


async def test_terminate_raising_interface_error_still_reraises_original(caplog):
    original = apg.PostgresConnectionError("BEGIN failed")
    conn = FakeConn(
        raise_on={"begin": original, "terminate": asyncpg.InterfaceError("released")},
    )
    pool = FakePool(conn)
    with caplog.at_level(logging.WARNING, logger=read_budget.__name__):
        with pytest.raises(apg.PostgresConnectionError) as ei:
            async with budgeted_read(pool, 5.0):
                pass
    assert ei.value is original
    msgs = [r.getMessage() for r in caplog.records]
    assert any("cleanup after begin skipped/failed (InterfaceError" in m for m in msgs), msgs


async def test_rollback_raising_interface_error_terminates_and_reraises_original():
    original = apg.QueryCanceledError("canceling statement")
    conn = FakeConn(
        raise_on={"fetch": original, "rollback": asyncpg.InterfaceError("released")},
    )
    pool = FakePool(conn)
    with pytest.raises(apg.QueryCanceledError) as ei:
        async with budgeted_read(pool, 5.0) as bc:
            await bc.fetch("SELECT 1")
    assert ei.value is original
    assert conn.terminated == 1 and not conn.released


async def test_attached_closed_proxy_takes_the_defensive_terminate_branch():
    original = apg.QueryCanceledError("canceling statement")
    conn = FakeConn(raise_on={"fetch": original})
    pool = FakePool(conn)
    with pytest.raises(apg.QueryCanceledError) as ei:
        async with budgeted_read(pool, 5.0) as bc:
            conn.closed = True
            await bc.fetch("SELECT 1")
    assert ei.value is original
    assert conn.terminated == 1 and "ROLLBACK" not in conn.log


async def test_success_path_release_failure_is_logged_not_raised(caplog):
    conn = FakeConn()
    pool = FakePool(conn, release_raise=TimeoutError())
    with caplog.at_level(logging.WARNING, logger=read_budget.__name__):
        async with budgeted_read(pool, 5.0) as bc:
            await bc.fetch("SELECT 1")
    msgs = [r.getMessage() for r in caplog.records]
    assert any("read connection release failed (TimeoutError" in m for m in msgs), msgs


# ---------------------------------------------------------------- classification


@pytest.mark.parametrize(
    "exc",
    [
        apg.PostgresConnectionError("08000"),
        apg.ConnectionDoesNotExistError("08003"),
        apg.TooManyConnectionsError("53300"),
        apg.QueryCanceledError("57014"),
        apg.AdminShutdownError("57P01"),
        apg.CrashShutdownError("57P02"),
        apg.CannotConnectNowError("57P03"),
        apg.IdleSessionTimeoutError("57P05"),
        asyncpg.InterfaceError("released"),
        OSError("reset"),
        TimeoutError(),
    ],
    ids=lambda e: type(e).__name__,
)
def test_transient_errors_classify_transient(exc):
    assert is_transient_db_error(exc) is True


@pytest.mark.parametrize(
    "exc",
    [
        asyncpg.DataError("22000"),
        InterfaceDataError("bad input"),
        apg.ClientConfigurationError("bad config"),
        apg.UnsupportedClientFeatureError("no"),
        apg.UnsupportedServerFeatureError("no"),
        ValueError("plain"),
        apg.UndefinedTableError("42P01"),
    ],
    ids=lambda e: f"{type(e).__module__}.{type(e).__name__}",
)
def test_non_transient_errors_classify_not_transient(exc):
    assert is_transient_db_error(exc) is False
