"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.
"""

import asyncio
import contextvars
import functools
import glob
import os
import pathlib
import pwd
import shutil
import subprocess
import sys
import tempfile
import types
import uuid
from unittest.mock import AsyncMock, MagicMock

import asyncpg
import grpc
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

from gen.marketdata.v1 import marketdata_pb2  # noqa: E402

from app.services.evaluator import FundamentalPeriod  # noqa: E402


def fund_period(filed_date, **values):
    """One evaluator PIT filing (feature 215 fixtures)."""
    return FundamentalPeriod(filed_date=filed_date, values=dict(values))


def fundamentals_row(symbol, missing=(), **metrics):
    """A real ``marketdata.v1.Fundamentals`` row; ``missing`` is passed through verbatim."""
    return marketdata_pb2.Fundamentals(symbol=symbol, missing_metrics=list(missing), **metrics)


def snapshot_watcher(namespace="analysis", **values):
    """Canonical dial-free ConfigWatcher; rejects a key with its own `<namespace>.` prefix."""
    from gen.config.v1 import config_pb2

    from app.config.watcher import ConfigWatcher

    # __new__ bypasses __init__'s channel + watch-task dial (fails-074: never a live watcher).
    w = ConfigWatcher.__new__(ConfigWatcher)
    w.endpoint = "localhost:50060"
    w.namespace = namespace
    w._snapshot_event = asyncio.Event()
    snap = config_pb2.ConfigSnapshot()
    for key, val in values.items():
        if key.startswith(namespace + "."):
            raise ValueError(
                f"snapshot_watcher: key {key!r} is namespace-prefixed; "
                f"use the relative key {key[len(namespace) + 1 :]!r}"
            )
        # bool before int: bool is an int subclass.
        if isinstance(val, bool):
            snap.values[key].bool_val = val
        elif isinstance(val, int):
            snap.values[key].int_val = val
        elif isinstance(val, float):
            snap.values[key].float_val = val
        elif isinstance(val, str):
            snap.values[key].string_val = val
        else:
            raise TypeError(f"snapshot_watcher: unsupported value type for {key}: {type(val)!r}")
    w._snapshot = snap
    return w


def real_live_loop(ingest, indicators, rows, *, config_watcher, marketdata_stub):
    """A real ``LiveEvaluationLoop`` over ``rows`` with empty portfolio pages; no cooldowns repo."""
    from app.engine.live_loop import LiveEvaluationLoop
    from app.services.evaluator import StrategyEvaluator

    eof = types.SimpleNamespace(next_page_token="")
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows)
    portfolio = MagicMock()
    portfolio.ListPositions = AsyncMock(return_value=types.SimpleNamespace(positions=[], page=eof))
    portfolio.ListWatchlists = AsyncMock(
        return_value=types.SimpleNamespace(watchlists=[], page=eof)
    )
    return LiveEvaluationLoop(
        config_watcher=config_watcher,
        db_pool=db,
        marketdata_stub=marketdata_stub,
        ingest_stub=ingest,
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=StrategyEvaluator(indicators, ()),
        portfolio_stub=portfolio,
    )


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


def aio_rpc_error(code, details=""):
    """A ``grpc.aio.AioRpcError`` with ``code`` and ``details`` and empty metadata."""
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), details)


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


_BC_METHOD_FOR = {"count_for_user": "fetchval", "get": "fetchrow", "has_fresh": "fetchval"}


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


_PG_HOMEBREW_GLOBS = ("/opt/homebrew/opt/postgresql@*/bin", "/usr/local/opt/postgresql@*/bin")


def _pg_version_key(bin_dir):
    digits = "".join(ch for ch in pathlib.Path(bin_dir).parent.name if ch.isdigit())
    return int(digits) if digits else 0


def _pg_bin_dir():
    """``$XSTOCKSTRAT_PG_BIN``, else ``pg_ctl`` on PATH, else the newest Debian/Homebrew install."""
    override = os.environ.get("XSTOCKSTRAT_PG_BIN")
    if override:
        return override
    on_path = shutil.which("pg_ctl")
    if on_path:
        return os.path.dirname(on_path)
    for pattern in ("/usr/lib/postgresql/*/bin", *_PG_HOMEBREW_GLOBS):
        found = [d for d in glob.glob(pattern) if os.path.exists(os.path.join(d, "initdb"))]
        if found:
            return max(found, key=_pg_version_key)
    return None


@pytest.fixture(scope="session")
def local_pg():
    """A throwaway PostgreSQL on a Unix socket for the session (``real_pg`` tests); yields its DSN.
    Skips when it cannot start, except under ``CI=true``, where it fails instead."""

    def _unavailable(reason):
        if os.environ.get("CI") == "true":
            pytest.fail(f"local_pg: {reason}")
        pytest.skip(f"local_pg: {reason}")

    bin_dir = _pg_bin_dir()
    if bin_dir is None:
        _unavailable("no PostgreSQL binaries found (set XSTOCKSTRAT_PG_BIN)")
    # Under /tmp: the Unix-socket path must stay within the ~107-byte sun_path limit.
    root = tempfile.mkdtemp(dir="/tmp", prefix="xss-pg-")
    prefix = []
    if os.geteuid() == 0:  # initdb refuses to run as root
        try:
            pwd.getpwnam("postgres")
        except KeyError:
            shutil.rmtree(root, ignore_errors=True)
            _unavailable("running as root without a postgres user")
        shutil.chown(root, "postgres")
        prefix = ["runuser", "-u", "postgres", "--"]
    pgdata = os.path.join(root, "data")
    pg_ctl = os.path.join(bin_dir, "pg_ctl")

    def _run(*cmd):
        subprocess.run([*prefix, *cmd], check=True, capture_output=True, timeout=120)

    try:
        _run(
            os.path.join(bin_dir, "initdb"),
            "-D",
            pgdata,
            "-U",
            "postgres",
            "-A",
            "trust",
            "--no-sync",
        )
        _run(
            pg_ctl,
            "-D",
            pgdata,
            "-l",
            os.path.join(root, "postgres.log"),
            "-w",
            "start",
            "-o",
            f"-c fsync=off -c listen_addresses='' -k {root}",
        )
    except (OSError, subprocess.SubprocessError) as e:
        stderr = getattr(e, "stderr", b"") or b""
        shutil.rmtree(root, ignore_errors=True)
        _unavailable(f"PostgreSQL did not start ({e}): {stderr.decode(errors='replace')[-500:]}")
    try:
        yield f"postgresql:///postgres?host={root}&user=postgres"
    finally:
        subprocess.run(
            [*prefix, pg_ctl, "-D", pgdata, "-m", "immediate", "stop"],
            capture_output=True,
            timeout=60,
        )
        shutil.rmtree(root, ignore_errors=True)


_MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "migrations"
_PIPELINE_FINISHED = ("succeeded", "failed", "dead", "blocked")


async def pipeline_pool(dsn, size=4):
    """A pool on ``local_pg`` shaped like the service's PgBouncer pools (no statement cache)."""
    return await asyncpg.create_pool(dsn, min_size=1, max_size=size, statement_cache_size=0)


@pytest.fixture
async def pipeline_pg(local_pg):
    """Feature 367: a pool over fresh ``analysis.pipeline_jobs`` / ``pipeline_job_deps`` tables,
    built by running the owning migration file alone (it is self-contained)."""
    (owner,) = sorted(_MIGRATIONS_DIR.glob("*_pipeline_job_graph.up.sql"))
    others = [
        p.name
        for p in sorted(_MIGRATIONS_DIR.glob("*.up.sql"))
        if p != owner and "pipeline_job" in p.read_text()
    ]
    assert others == [], others
    pool = await pipeline_pool(local_pg)
    try:
        await pool.execute(
            "CREATE SCHEMA IF NOT EXISTS analysis; "
            "DROP TABLE IF EXISTS analysis.pipeline_job_deps; "
            "DROP TABLE IF EXISTS analysis.pipeline_jobs;"
        )
        await pool.execute(owner.read_text())
        yield pool
    finally:
        await pool.close()


async def insert_pipeline_job(pool, **overrides):
    """Insert one job row in any state with consistent defaults; returns its ``job_id``.
    Time columns default to the database clock; pass a value to set one directly."""
    row = {
        "kind": "probe",
        "subject": "AAPL",
        "epoch": "2026-11-27",
        "run_id": "run-2026-11-27",
        "lane": 10,
        "state": "ready",
        "attempts": 0,
        "wait_round": 0,
    }
    row.update(overrides)
    exprs = {"next_attempt_at": "now()"}
    if row["state"] == "running":
        exprs["lease_token"] = "gen_random_uuid()"
        exprs["lease_expires_at"] = "now() + interval '60 seconds'"
    if row["state"] in _PIPELINE_FINISHED:
        exprs["finished_at"] = "now()"
    if row["state"] == "blocked":
        row.setdefault("verdict", "no_vendor_data")
    exprs = {k: v for k, v in exprs.items() if k not in row}
    columns = [*row, *exprs]
    values = [f"${i}" for i in range(1, len(row) + 1)] + list(exprs.values())
    return await pool.fetchval(
        f"INSERT INTO analysis.pipeline_jobs ({', '.join(columns)}) "
        f"VALUES ({', '.join(values)}) RETURNING job_id",
        *row.values(),
    )


async def shift_pipeline_job(pool, job_id, **columns_to_seconds):
    """Rewrite time columns to ``now()`` plus the given seconds (negative = past); never sleeps."""
    sets = ", ".join(
        f"{col} = now() + make_interval(secs => ${i}::float8)"
        for i, col in enumerate(columns_to_seconds, start=2)
    )
    await pool.execute(
        f"UPDATE analysis.pipeline_jobs SET {sets} WHERE job_id = $1",
        job_id,
        *columns_to_seconds.values(),
    )


async def seed_blocked_parents(pool, n):
    """Insert ``n`` waiting parents, each with a dead child (lower id) and a failed child."""
    await pool.execute(
        """
INSERT INTO analysis.pipeline_jobs
       (kind, subject, epoch, run_id, lane, state, next_attempt_at, finished_at, error_class)
SELECT 'probe', 'dead-' || g, 'e', 'r', 10, 'dead', now(), now(), 'transient'
  FROM generate_series(1, $1::int) g;
INSERT INTO analysis.pipeline_jobs
       (kind, subject, epoch, run_id, lane, state, next_attempt_at, finished_at, error_class)
SELECT 'probe', 'failed-' || g, 'e', 'r', 10, 'failed', now(), now(), 'permanent'
  FROM generate_series(1, $1::int) g;
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at)
SELECT 'probe', 'parent-' || g, 'e', 'r', 10, 'waiting', now() FROM generate_series(1, $1::int) g;
INSERT INTO analysis.pipeline_job_deps (parent_id, child_id)
SELECT p.job_id, c.job_id
  FROM analysis.pipeline_jobs p
  JOIN analysis.pipeline_jobs c
    ON c.subject IN ('dead-' || substr(p.subject, 8), 'failed-' || substr(p.subject, 8))
 WHERE p.subject LIKE 'parent-%';
""".replace("$1::int", str(int(n)))
    )


class VirtualTime:
    """Feature 367: the running loop's clock, moved only by ``advance`` (never by real time)."""

    def __init__(self, loop):
        self._loop = loop
        self.now = loop.time()

    async def _drain(self):
        for _ in range(60):
            await asyncio.sleep(0)

    async def advance(self, seconds: float) -> None:
        """Run every timer due within ``seconds`` in order, then stop the clock at the target."""
        target = self.now + seconds
        while True:
            await self._drain()
            due = [h.when() for h in self._loop._scheduled if not h.cancelled()]
            nxt = min(due, default=None)
            if nxt is None or nxt > target:
                break
            self.now = max(self.now, nxt)
        self.now = target
        await self._drain()


@pytest.fixture
async def virtual_time():
    loop = asyncio.get_running_loop()
    vt = VirtualTime(loop)
    loop.time = lambda: vt.now
    try:
        yield vt
    finally:
        del loop.time


class FakeJobRepo:
    """Feature 367: an in-memory ``PipelineJobsRepository`` on the virtual clock.

    ``calls`` records every method called; ``fail[method]`` is a list of exceptions raised by the
    next calls; ``delay[method]`` is virtual seconds each call takes while it holds the lane;
    ``omit_renewals`` makes a committed heartbeat renew nothing.
    """

    def __init__(self, clock):
        self._clock = clock
        self._lane = asyncio.Lock()
        self.jobs: dict[int, dict] = {}
        self.edges: set[tuple[int, int]] = set()
        self.calls: list[str] = []
        self.fail: dict[str, list] = {}
        self.delay: dict[str, float] = {}
        self.lane_queue_max = 0
        self.omit_renewals = False
        self._next_id = 1

    def add(self, *, kind="probe", subject="AAPL", epoch="2026-11-27", lane=10, **fields):
        job_id = self._next_id
        self._next_id += 1
        self.jobs[job_id] = {
            "job_id": job_id,
            "kind": kind,
            "subject": subject,
            "epoch": epoch,
            "run_id": "run-2026-11-27",
            "lane": lane,
            "state": "ready",
            "attempts": 0,
            "wait_round": 0,
            "next_at": self._clock(),
            "lease_token": None,
            "expires": None,
            "verdict": None,
            **fields,
        }
        return job_id

    async def _enter(self, name):
        self.calls.append(name)
        if self.delay.get(name):
            await asyncio.sleep(self.delay[name])
        pending = self.fail.get(name)
        if pending:
            raise pending.pop(0)

    def lane(self):
        repo = self

        class _Lane:
            async def __aenter__(self):
                repo.lane_queue_max = max(repo.lane_queue_max, len(repo._lane._waiters or ()) + 1)
                await repo._lane.acquire()

            async def __aexit__(self, *exc):
                repo._lane.release()

        return _Lane()

    async def _laned(self, name, lane_held):
        if lane_held:
            await self._enter(name)
            return None
        await self._lane.acquire()
        try:
            await self._enter(name)
        except BaseException:
            self._lane.release()
            raise
        return self._lane

    def _row(self, j):
        keys = ("job_id", "kind", "subject", "epoch", "run_id", "lane", "attempts", "wait_round")
        return {**{k: j[k] for k in keys}, "lease_token": j["lease_token"]}

    async def claim(self, kinds, limit, lease_seconds, *, conn=None, lane_held=False):
        held = await self._laned("claim", lane_held)
        try:
            now = self._clock()
            ready = sorted(
                (
                    j
                    for j in self.jobs.values()
                    if j["state"] == "ready" and j["next_at"] <= now and j["kind"] in kinds
                ),
                key=lambda j: (-j["lane"], j["next_at"], j["job_id"]),
            )[:limit]
            for j in ready:
                j.update(
                    state="running",
                    attempts=j["attempts"] + 1,
                    lease_token=uuid.uuid4(),
                    expires=now + lease_seconds,
                )
            return [self._row(j) for j in ready], now
        finally:
            held and held.release()

    async def reap(self, max_attempts, *, conn=None):
        held = await self._laned("reap", False)
        try:
            now, requeued, dead = self._clock(), 0, 0
            for j in self.jobs.values():
                if j["state"] == "running" and j["expires"] < now:
                    if j["attempts"] >= max_attempts:
                        j.update(state="dead", last_error="lease_expired")
                        dead += 1
                    else:
                        j.update(state="ready", next_at=now)
                        requeued += 1
                    j.update(lease_token=None, expires=None)
            return requeued, dead
        finally:
            held.release()

    async def heartbeat(self, pairs, lease_seconds):
        await self._enter("heartbeat")
        now, renewed = self._clock(), set()
        for job_id, token in [] if self.omit_renewals else pairs:
            j = self.jobs.get(job_id)
            if j and j["state"] == "running" and j["lease_token"] == token:
                j["expires"] = now + lease_seconds
                renewed.add((job_id, token))
        return renewed, now

    async def report(
        self,
        job_id,
        lease_token,
        outcome,
        *,
        max_attempts,
        retry_delay_s=0,
        verdict=None,
        error=None,
        lane_held=False,
    ):
        held = await self._laned("report", lane_held)
        try:
            j = self.jobs.get(job_id)
            if not j or j["state"] != "running" or j["lease_token"] != lease_token:
                return None
            if outcome == "transient":
                state = "dead" if j["attempts"] >= max_attempts else "ready"
            else:
                state = {"succeeded": "succeeded", "permanent": "failed", "verdict": "blocked"}[
                    outcome
                ]
            j.update(
                state=state,
                lease_token=None,
                expires=None,
                verdict=verdict,
                last_error=error,
                next_at=self._clock() + retry_delay_s,
            )
            return state
        finally:
            held and held.release()

    async def park(self, job_id, lease_token, children, *, lane_held=False):
        held = await self._laned("park", lane_held)
        try:
            j = self.jobs.get(job_id)
            if not j or j["state"] != "running" or j["lease_token"] != lease_token:
                return False
            for kind, subject, epoch, lane in sorted(children, key=lambda c: c[:3]):
                found = [
                    c
                    for c in self.jobs.values()
                    if (c["kind"], c["subject"], c["epoch"]) == (kind, subject, epoch)
                ]
                child = (
                    found[0]["job_id"]
                    if found
                    else self.add(kind=kind, subject=subject, epoch=epoch, lane=lane or j["lane"])
                )
                self.edges.add((job_id, child))
            j.update(state="waiting", lease_token=None, expires=None, attempts=j["attempts"] - 1)
            return True
        finally:
            held and held.release()

    async def settle_batch(self, *, conn=None):
        held = await self._laned("settle_batch", False)
        try:
            woken = blocked = 0
            for j in self.jobs.values():
                if j["state"] != "waiting":
                    continue
                kids = [self.jobs[c] for p, c in sorted(self.edges) if p == j["job_id"]]
                bad = [c for c in kids if c["state"] in ("failed", "dead", "blocked")]
                if bad:
                    j.update(state="blocked", verdict=bad[0]["verdict"] or "dependency_failed")
                    blocked += 1
                elif all(c["state"] == "succeeded" for c in kids):
                    j.update(state="ready", wait_round=j["wait_round"] + 1, next_at=self._clock())
                    woken += 1
            return woken, blocked, False
        finally:
            held.release()

    async def enqueue(self, kind, subject, epoch, *, run_id, lane, conn=None):
        held = await self._laned("enqueue", False)
        try:
            for j in self.jobs.values():
                if (j["kind"], j["subject"], j["epoch"]) == (kind, subject, epoch):
                    return j["job_id"], False
            return self.add(
                kind=kind, subject=subject, epoch=epoch, lane=int(lane), run_id=run_id
            ), True
        finally:
            held.release()

    async def ready_stats(self, *, conn=None):
        held = await self._laned("ready_stats", False)
        try:
            now, stats = self._clock(), {10: (0, 0.0), 20: (0, 0.0)}
            for lane in stats:
                due = [
                    j["next_at"]
                    for j in self.jobs.values()
                    if j["lane"] == lane and j["state"] == "ready" and j["next_at"] <= now
                ]
                if due:
                    stats[lane] = (len(due), now - min(due))
            return stats
        finally:
            held.release()


@pytest.fixture
def otel_reset(monkeypatch):
    """Isolate a test calling init_telemetry: the OTel providers are set-once per process."""
    import logging

    from opentelemetry import metrics, trace
    from opentelemetry._logs import _internal as logs_internal
    from opentelemetry.instrumentation.grpc import (
        GrpcAioInstrumentorClient,
        GrpcAioInstrumentorServer,
    )
    from opentelemetry.metrics import _internal as metrics_internal
    from opentelemetry.util._once import Once

    monkeypatch.setattr(trace, "_TRACER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", None)
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(metrics_internal, "_METER_PROVIDER", None)
    monkeypatch.setattr(logs_internal, "_LOGGER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(logs_internal, "_LOGGER_PROVIDER", None)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    monkeypatch.setattr(GrpcAioInstrumentorServer, "instrument", lambda self, **kw: None)
    monkeypatch.setattr(GrpcAioInstrumentorClient, "instrument", lambda self, **kw: None)
    root = logging.getLogger()
    handlers_before = list(root.handlers)
    yield
    for h in list(root.handlers):
        if h not in handlers_before:
            root.removeHandler(h)
    for provider in (
        trace.get_tracer_provider(),
        metrics.get_meter_provider(),
        logs_internal.get_logger_provider(),
    ):
        if hasattr(provider, "shutdown"):
            provider.shutdown()
