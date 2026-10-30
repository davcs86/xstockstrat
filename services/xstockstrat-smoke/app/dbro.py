"""Read-only database access for checks: every statement runs in a read-only transaction under a
statement timeout; a role that is not read-only degrades checks to ERROR instead of exiting."""

import logging
from contextlib import asynccontextmanager

import asyncpg

log = logging.getLogger(__name__)

DB_STATEMENT_TIMEOUT_MS = 5000

_WRITE_PRIVILEGE = """
SELECT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
         OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')))
"""


class DbDegraded(Exception):
    pass


class ReadOnlyDb:
    def __init__(self, dsn: str, *, statement_timeout_ms: int = DB_STATEMENT_TIMEOUT_MS):
        self._dsn = dsn
        self._timeout_ms = int(statement_timeout_ms)
        self._pool = None
        self.degraded: str | None = None if dsn else "db unavailable: DATABASE_URL unset"

    async def _get_pool(self):
        if self._pool is None:
            self._pool = await asyncpg.create_pool(self._dsn, min_size=0, max_size=1, timeout=10)
        return self._pool

    async def assert_read_only_role(self) -> None:
        if self.degraded:
            return
        try:
            pool = await self._get_pool()
            async with pool.acquire() as con:
                superuser = await con.fetchval(
                    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
                )
                writable = await con.fetchval(_WRITE_PRIVILEGE)
                read_only = await con.fetchval("SHOW default_transaction_read_only")
        except Exception as e:  # noqa: BLE001 — degrade, never exit
            self.degraded = f"db unavailable: {type(e).__name__}"
        else:
            reasons = [
                *(["superuser"] if superuser else []),
                *(["has write privilege"] if writable else []),
                *([] if read_only == "on" else ["default_transaction_read_only is off"]),
            ]
            if reasons:
                self.degraded = "db role not read-only: " + ", ".join(reasons)
        if self.degraded:
            log.error("smoke db degraded: %s", self.degraded)

    @asynccontextmanager
    async def _read(self):
        if self._dsn and self.degraded and self.degraded.startswith("db unavailable"):
            self.degraded = None
            await self.assert_read_only_role()
        if self.degraded:
            raise DbDegraded(self.degraded)
        pool = await self._get_pool()
        async with pool.acquire() as con, con.transaction(readonly=True):
            await con.execute(f"SET LOCAL statement_timeout = {self._timeout_ms}")
            yield con

    async def fetch(self, query: str, *args):
        async with self._read() as con:
            return await con.fetch(query, *args)

    async def fetchval(self, query: str, *args):
        async with self._read() as con:
            return await con.fetchval(query, *args)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
