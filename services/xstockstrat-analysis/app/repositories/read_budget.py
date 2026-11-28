"""Request-scoped DB budget for analysis read paths."""

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


class DbBudgetExceeded(Exception):
    """The client timer cut a bounded transaction at its deadline plus grace; transient."""


class TxnNotCommitted(Exception):
    """COMMIT returned another tag: the server rolled the transaction back; transient."""


class BoundedTxn:
    """Handle of one `bounded_txn`; single-task, statements strictly sequential."""

    def __init__(self, con, deadline: float, monotonic, on_terminate):
        self._con = con
        self._deadline = deadline
        self._monotonic = monotonic
        self._on_terminate = on_terminate
        self.terminated = False
        self.expired = False
        self.begin_sent_at: float | None = None

    def _remaining_ms(self) -> int:
        ms = int((self._deadline - self._monotonic()) * 1000)
        if ms <= 0:
            raise DbBudgetExceeded("bounded transaction budget exhausted")
        return ms

    def _terminate(self) -> None:
        if self.terminated:
            return
        self.terminated = True
        try:
            self._con.terminate()
        except Exception as e:  # noqa: BLE001 — terminate is the last resort; never raise from it
            log.warning("bounded_txn: terminate failed (%s: %s)", type(e).__name__, e)
        if self._on_terminate is not None:
            try:
                self._on_terminate()
            except Exception:  # noqa: BLE001 — a hook must not mask the original error
                log.exception("bounded_txn: on_terminate hook failed")

    def _expire(self) -> None:
        if not self.terminated:
            self.expired = True
            self._terminate()

    def abort(self) -> None:
        self._terminate()

    async def _arm(self) -> None:
        await self._con.execute(f"SET LOCAL statement_timeout = {self._remaining_ms()}")

    async def fetch(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetch(*args, **kwargs)

    async def fetchrow(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetchrow(*args, **kwargs)

    async def fetchval(self, *args, **kwargs):
        await self._arm()
        return await self._con.fetchval(*args, **kwargs)

    async def execute(self, *args, **kwargs):
        await self._arm()
        return await self._con.execute(*args, **kwargs)


@asynccontextmanager
async def bounded_txn(
    pool, budget_s: float, *, on_acquired=None, on_terminate=None, monotonic=time.monotonic
):
    # No asyncio cancellation bounds the transaction: the server timeout and a terminate timer do.
    deadline = monotonic() + budget_s
    con = await pool.acquire(timeout=budget_s)
    txn = BoundedTxn(con, deadline, monotonic, on_terminate)
    if on_acquired is not None:
        try:
            on_acquired()
        except BaseException:
            txn.abort()
            raise
    loop = asyncio.get_running_loop()
    timer = loop.call_later(
        max(deadline + _READ_DB_BACKSTOP_GRACE_S - monotonic(), 0.0), txn._expire
    )
    stage = "begin"
    try:
        try:
            txn.begin_sent_at = monotonic()
            await con.execute(f"BEGIN; SET LOCAL statement_timeout = {txn._remaining_ms()}")
            stage = "open"
            yield txn
            stage = "commit"
            tag = await con.execute("COMMIT")
        except BaseException as e:
            if txn.expired:
                raise DbBudgetExceeded("bounded transaction cut at its deadline") from e
            if not txn.terminated:
                if isinstance(e, asyncio.CancelledError) or stage == "commit":
                    txn.abort()
                else:
                    await _rollback_or_terminate(txn, con)
            if txn.expired:
                raise DbBudgetExceeded("bounded transaction cut at its deadline") from e
            if not txn.terminated:
                await _release_bounded(pool, con)
            raise
        if tag != "COMMIT":
            await _release_bounded(pool, con)
            raise TxnNotCommitted(f"COMMIT returned {tag!r}")
        await _release_bounded(pool, con)
    finally:
        timer.cancel()


async def _rollback_or_terminate(txn: BoundedTxn, con) -> None:
    try:
        await con.execute("ROLLBACK")
    except BaseException as e:
        if not txn.terminated:
            log.warning(
                "bounded_txn: rollback failed (%s: %s); connection terminated",
                type(e).__name__,
                e,
            )
            txn.abort()
        if isinstance(e, asyncio.CancelledError):
            raise


async def _release_bounded(pool, con) -> None:
    try:
        await pool.release(con, timeout=_RELEASE_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 — asyncpg terminates a connection whose release fails
        log.warning(
            "bounded_txn: connection release failed (%s: %s); connection terminated",
            type(e).__name__,
            e,
        )


async def control_pool_reset(conn) -> None:
    """`create_pool(reset=…)` for the control pool: skips RESET ALL, so a release sends no query.

    asyncpg's own pre-reset rolls back (and reports) a connection released inside a transaction.
    """
