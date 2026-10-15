"""Request-scoped DB budget for analysis read paths (feature 226, design.md §1)."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import asyncpg.exceptions as apg

log = logging.getLogger(__name__)

_READ_DB_BACKSTOP_GRACE_S = 2.0
_RELEASE_TIMEOUT_S = 1.0
_ROLLBACK_WINDOW_S = 1.0
_RELEASE_FLOOR_S = 0.05

_TRANSIENT = (
    OSError,
    apg.PostgresConnectionError,
    apg.InterfaceError,
    apg.TooManyConnectionsError,
    apg.QueryCanceledError,
    apg.AdminShutdownError,
    apg.CrashShutdownError,
    apg.CannotConnectNowError,
    apg.IdleSessionTimeoutError,
)
_NOT_TRANSIENT = (ValueError, apg.UnsupportedClientFeatureError, apg.UnsupportedServerFeatureError)


def is_transient_db_error(e: BaseException) -> bool:
    return not isinstance(e, _NOT_TRANSIENT) and isinstance(e, _TRANSIENT)


class BudgetedConn:
    # Single-task: DB-phase statements must be strictly sequential, each re-arming the
    # statement_timeout to the remaining budget.
    def __init__(self, con, deadline: float):
        self._con = con
        self._deadline = deadline

    async def _arm(self) -> None:
        ms = int((self._deadline - time.monotonic()) * 1000)
        if ms <= 0:
            raise TimeoutError("read DB budget exhausted")
        await self._con.execute(f"SET LOCAL statement_timeout = {ms}")

    async def fetch(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetch(*args, **kwargs)

    async def fetchval(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetchval(*args, **kwargs)

    async def fetchrow(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetchrow(*args, **kwargs)


@asynccontextmanager
async def budgeted_read(pool, budget_s: float):
    deadline = time.monotonic() + budget_s
    con, tr, stage = None, None, "acquire"
    # The backstop must never wrap cleanup, or a late expiry would replace the original error.
    backstop = asyncio.timeout(budget_s + _READ_DB_BACKSTOP_GRACE_S)
    try:
        async with backstop:
            con = await pool.acquire(timeout=budget_s)
            stage = "begin"
            tr = con.transaction(readonly=True)
            await tr.start()
            stage = "open"
            yield BudgetedConn(con, deadline)
            stage = "commit"
            await tr.commit()
            stage = "done"
    except BaseException as e:
        cancelled = isinstance(e, asyncio.CancelledError) or backstop.expired()
        if con is None:
            action = "no connection held"
        elif stage == "open" and not cancelled:
            action = "rolling back and releasing"
        else:
            action = "terminating connection"
        log.warning(
            "budgeted_read: read DB phase failed at %s (%s: %s); %s",
            stage,
            type(e).__name__,
            e,
            action,
        )
        if con is not None:
            try:
                # Rollback only at stage "open" (tr STARTED); every other stage terminates.
                if stage == "open" and not cancelled and not con.is_closed():
                    await _rollback_then_release(pool, con, tr)
                else:
                    con.terminate()
            except Exception as ce:
                log.warning(
                    "budgeted_read: cleanup after %s skipped/failed (%s: %s) — connection may "
                    "already be released by asyncpg; original error re-raised",
                    stage,
                    type(ce).__name__,
                    ce,
                )
        raise
    try:
        await pool.release(con, timeout=_RELEASE_TIMEOUT_S)
    except Exception as re:
        log.warning(
            "budgeted_read: read connection release failed (%s: %s); connection terminated",
            type(re).__name__,
            re,
        )


async def _rollback_then_release(pool, con, tr) -> None:
    window_end = time.monotonic() + _ROLLBACK_WINDOW_S
    try:
        async with asyncio.timeout(_ROLLBACK_WINDOW_S):
            await tr.rollback()
    except (Exception, asyncio.CancelledError) as e:
        log.warning(
            "budgeted_read: rollback failed (%s: %s); connection terminated",
            type(e).__name__,
            e,
        )
        con.terminate()
        if isinstance(e, asyncio.CancelledError):
            raise
        return
    try:
        await pool.release(con, timeout=max(window_end - time.monotonic(), _RELEASE_FLOOR_S))
    except Exception as e:
        log.warning(
            "budgeted_read: read connection release after rollback failed (%s: %s)",
            type(e).__name__,
            e,
        )
