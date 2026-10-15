"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.
"""

import asyncio
import contextvars
import functools
import pathlib
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest


def _setup_gen_path() -> None:
    """Register the proto gen directory as the 'gen' namespace package."""
    service_root = pathlib.Path(__file__).resolve().parents[1]
    proto_gen = (service_root / "../../packages/proto/gen/python").resolve()

    if not proto_gen.exists():
        return

    if str(proto_gen) not in sys.path:
        sys.path.insert(0, str(proto_gen))

    if "gen" not in sys.modules:
        gen_mod = types.ModuleType("gen")
        gen_mod.__path__ = [str(proto_gen)]
        gen_mod.__package__ = "gen"
        sys.modules["gen"] = gen_mod


_setup_gen_path()

from datetime import date  # noqa: E402

from app.services.evaluator import FundamentalPeriod  # noqa: E402


def fund_period(filed_date, **values):
    """One evaluator PIT filing (feature 215 fixtures)."""
    return FundamentalPeriod(filed_date=filed_date, values=dict(values))


# Feature 215 PIT fixtures: SCHD (an ETF) has no SEC filings; AAPL has quarterly filings carrying
# all six seeded fscore inputs (pe, pb, dividend_yield, roe, debt_to_equity, eps).
SCHD_PIT_PERIODS = []
AAPL_PIT_PERIODS = [
    fund_period(
        filed,
        pe_ratio=30.0,
        pb_ratio=45.0,
        dividend_yield=0.005,
        roe=1.5,
        debt_to_equity=1.8,
        eps=6.0,
    )
    for filed in (date(2024, 5, 3), date(2024, 8, 2), date(2024, 11, 1))
]


def ctx_with(headers):
    """A gRPC servicer context replaying ``headers`` ([(key, value)]); ``abort`` raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers))
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


OWNER_HEADERS = [("x-user-id", "u-1"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]
OTHER_HEADERS = [("x-user-id", "u-2"), ("x-access-scope", "1"), ("x-trace-id", "t-2")]


class RecordingStub:
    """A fake gRPC stub: every attribute is an AsyncMock recording ``(method, request, metadata)``
    into ``calls``. ``responses`` maps a method name to a return value, an exception to raise, or a
    function of the request; an unmapped method returns a ``MagicMock``."""

    def __init__(self, responses=None):
        self.calls: list[tuple[str, object, list]] = []
        self._responses = dict(responses or {})

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        async def _call(request, metadata=None, **_kw):
            self.calls.append((name, request, list(metadata or ())))
            resp = self._responses.get(name)
            if isinstance(resp, BaseException):
                raise resp
            if isinstance(resp, types.FunctionType):
                return resp(request)
            return MagicMock() if resp is None else resp

        mock = AsyncMock(side_effect=_call)
        setattr(self, name, mock)
        return mock

    def of(self, method):
        return [c for c in self.calls if c[0] == method]


class FakeTx:
    """A fake unmanaged asyncpg transaction recording BEGIN READ ONLY / COMMIT / ROLLBACK into its
    connection's ``log``; stall/raise injection is configured on the owning ``FakeConn``."""

    def __init__(self, conn):
        self._conn = conn

    async def start(self):
        await self._conn._hook("begin")
        self._conn.log.append("BEGIN READ ONLY")

    async def commit(self):
        await self._conn._hook("commit")
        self._conn.log.append("COMMIT")

    async def rollback(self):
        await self._conn._hook("rollback")
        self._conn.log.append("ROLLBACK")


class FakeConn:
    """A fake asyncpg pool connection. ``stall`` names stages that never return and ``raise_on``
    maps a stage to the exception it raises; stages: begin, commit, rollback, set_local, fetch,
    fetchval, fetchrow, terminate. ``detached`` makes every method raise ``InterfaceError``, as a
    proxy does once asyncpg has released it (``pool.terminate()`` or a lost connection)."""

    def __init__(self, *, stall=(), raise_on=None, detached=False, closed=False):
        self.log: list[str] = []
        self.stall = set(stall)
        self.raise_on = dict(raise_on or {})
        self.detached = detached
        self.closed = closed
        self.terminated = 0
        self.released = False

    def _check_detached(self):
        if self.detached:
            raise asyncpg.InterfaceError("cannot call Connection method: it has been released")

    async def _hook(self, stage):
        self._check_detached()
        exc = self.raise_on.get(stage)
        if exc is not None:
            raise exc
        if stage in self.stall:
            await asyncio.Event().wait()

    def transaction(self, readonly=False):
        assert readonly, "the read DB phase must open a READ ONLY transaction"
        return FakeTx(self)

    async def execute(self, sql, *args):
        await self._hook("set_local")
        self.log.append(sql)

    async def fetch(self, *args, **kwargs):
        await self._hook("fetch")
        self.log.append("fetch")
        return []

    async def fetchval(self, *args, **kwargs):
        await self._hook("fetchval")
        self.log.append("fetchval")
        return None

    async def fetchrow(self, *args, **kwargs):
        await self._hook("fetchrow")
        self.log.append("fetchrow")
        return None

    def is_closed(self):
        self._check_detached()
        return self.closed

    def terminate(self):
        self._check_detached()
        exc = self.raise_on.get("terminate")
        if exc is not None:
            raise exc
        self.terminated += 1


class FakePool:
    """A fake asyncpg pool handing out ``conns`` in order (a fresh ``FakeConn`` once exhausted).
    ``acquire_stall`` never returns; ``acquire_raise`` / ``release_raise`` raise on that call.
    ``release`` marks the connection ``released`` and appends "release" to its log."""

    def __init__(self, *conns, acquire_stall=False, acquire_raise=None, release_raise=None):
        self._pending = list(conns)
        self.handed: list[FakeConn] = []
        self.acquire_timeouts: list[float] = []
        self.release_timeouts: list[float] = []
        self.acquire_stall = acquire_stall
        self.acquire_raise = acquire_raise
        self.release_raise = release_raise

    async def acquire(self, timeout=None):
        self.acquire_timeouts.append(timeout)
        if self.acquire_raise is not None:
            raise self.acquire_raise
        if self.acquire_stall:
            await asyncio.Event().wait()
        con = self._pending.pop(0) if self._pending else FakeConn()
        self.handed.append(con)
        return con

    async def release(self, con, timeout=None):
        self.release_timeouts.append(timeout)
        if self.release_raise is not None:
            raise self.release_raise
        con.released = True
        con.log.append("release")


_BC_METHOD_FOR = {"count_for_user": "fetchval", "get": "fetchrow"}


class _BcRoutedRepo:
    def __init__(self, bc, repo):
        self._bc = bc
        self._repo = repo

    def __getattr__(self, name):
        target = getattr(self._repo, name)
        if not callable(target):
            return target

        async def _routed(*args, **kwargs):
            await getattr(self._bc, _BC_METHOD_FOR.get(name, "fetch"))(f"-- {name}")
            return await target(*args, **kwargs)

        return _routed


def bc_routed(fake_repo):
    """A repo factory ``bc -> wrapper``: each wrapper method issues exactly one ``bc.fetch`` /
    ``fetchval`` / ``fetchrow`` on the ``BudgetedConn`` then delegates to ``fake_repo``. A ``None``
    repo yields a factory returning ``None``, matching the direct path's absent state repo."""
    if fake_repo is None:
        return lambda bc: None
    return lambda bc: _BcRoutedRepo(bc, fake_repo)


_SET_LOCAL = "SET LOCAL statement_timeout = "
_BC_STATEMENTS = ("fetch", "fetchval", "fetchrow")


def assert_budgeted_read_order(conn, budget_ms):
    """One ``FakeConn``'s log is BEGIN READ ONLY → (SET LOCAL nᵢ → stmt)+ → COMMIT → release, with
    every nᵢ in (0, budget_ms] and the sequence non-increasing (the shared budget only drains)."""
    log = conn.log
    assert log[:1] == ["BEGIN READ ONLY"] and log[-2:] == ["COMMIT", "release"], log
    body = log[1:-2]
    assert body and len(body) % 2 == 0, log
    ms = []
    for set_local, stmt in zip(body[0::2], body[1::2], strict=True):
        assert set_local.startswith(_SET_LOCAL) and stmt in _BC_STATEMENTS, log
        ms.append(int(set_local[len(_SET_LOCAL) :]))
    assert all(0 < m <= budget_ms for m in ms), ms
    assert ms == sorted(ms, reverse=True), ms


_request_conns: contextvars.ContextVar = contextvars.ContextVar("_request_conns", default=None)


class _RequestTrackingPool(FakePool):
    """A shared ``FakePool`` that also files each handed-out conn under the acquiring request."""

    async def acquire(self, timeout=None):
        con = await super().acquire(timeout=timeout)
        conns = _request_conns.get()
        if conns is not None:
            conns.append(con)
        return con


def _assert_request_conns_released(where):
    conns = _request_conns.get()
    if conns:
        assert all(c.released for c in conns), f"read connection still held at {where}"


@pytest.fixture(params=["direct", "pool"])
def read_path(request, monkeypatch):
    """Runs a ``ListOpportunities`` test on the injected-repo path or the budgeted pool path. Pool
    mode routes the test's own fake repos through ``bc_routed`` and asserts, per request, exactly
    one acquired conn, its statement order, and that it is released before enrichment and kicks."""
    if request.param == "direct":
        return "direct"
    from app.handlers import servicer as servicer_mod

    cls = servicer_mod.AnalysisServicer
    orig_list = cls.ListOpportunities

    @functools.wraps(orig_list)
    async def list_opportunities(self, req, context):
        if not isinstance(self._db_pool, _RequestTrackingPool):
            self._db_pool = _RequestTrackingPool()
        self._opps_repo_factory = bc_routed(self._opportunities_repo)
        self._state_repo_factory = bc_routed(self._opportunity_compute_state_repo)
        conns: list = []
        token = _request_conns.set(conns)
        try:
            resp = await orig_list(self, req, context)
        finally:
            _request_conns.reset(token)
        if self._opportunities_repo is not None and resp is not None:
            assert len(conns) == 1, f"expected one budgeted read connection, got {len(conns)}"
            assert_budgeted_read_order(conns[0], servicer_mod._DEFAULT_OPP_READ_DB_BUDGET_MS)
        return resp

    def _released_first(name):
        orig = getattr(cls, name)

        @functools.wraps(orig)
        def checked(self, *args, **kwargs):
            _assert_request_conns_released(name)
            return orig(self, *args, **kwargs)

        monkeypatch.setattr(cls, name, checked)

    monkeypatch.setattr(cls, "ListOpportunities", list_opportunities)
    for name in (
        "_enrich_opportunities_live",
        "_kick_opportunity_recompute",
        "_kick_opportunity_retry",
    ):
        _released_first(name)
    return "pool"
