"""ListOpportunities deadlines: the AC-1 enrichment deadline and the budgeted DB phase
(G3, G5, G6, G7, H5, O8, classification, identity gate)."""

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncpg
import asyncpg.exceptions as apg
import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.config.v1 import config_pb2

from app.handlers import servicer as servicer_mod
from app.handlers.servicer import (
    _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS,
    _OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS,
)
from app.repositories import read_budget
from tests.conftest import FakeConn, FakePool, bc_routed
from tests.test_analysis_servicer import (
    _HEADERS,
    _ctx,
    _FakeOppRepo,
    _StubWatcher,
    make_servicer,
)

_HANG_GUARD_S = 10
_READ_BUDGET_KEY = "analysis.opportunity.read_db_budget_ms"
_ENRICH_TIMEOUT_KEY = "analysis.opportunity.live_enrich_timeout_ms"


def _row(symbol, *, fresh=True, provenance=("uw",), age_s=0):
    now = datetime.now(UTC)
    return {
        "symbol": symbol,
        "action": 1,
        "conviction": 0.8,
        "signal_axis": 0.5,
        "opportunity_key": f"{symbol}:sx",
        "strategy_id": "sx",
        "thesis": "",
        "provenance": list(provenance),
        "readiness_json": {},
        "valid_until": now + timedelta(hours=1 if fresh else -1),
        "computed_at": now - timedelta(seconds=age_s),
    }


class _State:
    def __init__(self, valid_until=None):
        self._row = None if valid_until is None else {"valid_until": valid_until}

    async def get(self, user_id):
        return self._row


def _watcher(**values):
    w = _StubWatcher()
    snap = config_pb2.ConfigSnapshot()
    for key, value in values.items():
        snap.values[key].CopyFrom(value)
    w._snapshot = snap
    return w


def _svc(rows=(), state=None):
    svc = make_servicer()
    repo = _FakeOppRepo()
    repo.rows["u1"] = [dict(r) for r in rows]
    svc._opportunities_repo = repo
    svc._opportunity_compute_state_repo = state
    svc._marketdata.BatchGetLatestPrice = AsyncMock(return_value=SimpleNamespace(results=[]))
    return svc


def _pooled(svc, conn):
    """Put ``svc`` on the budgeted pool path over one ``conn``; returns the pool."""
    pool = FakePool(conn)
    svc._db_pool = pool
    svc._opps_repo_factory = bc_routed(svc._opportunities_repo)
    svc._state_repo_factory = bc_routed(svc._opportunity_compute_state_repo)
    return pool


def _record_kicks(svc):
    """Instance-level kick spies recording, per call, whether every pooled conn was released."""
    kicks = {"full": [], "retry": []}

    def _released():
        return all(c.released for c in getattr(svc._db_pool, "handed", []))

    svc._kick_opportunity_recompute = MagicMock(
        side_effect=lambda uid, meta: kicks["full"].append(_released())
    )
    svc._kick_opportunity_retry = MagicMock(
        side_effect=lambda uid, syms, meta: kicks["retry"].append((set(syms), _released()))
    )
    return kicks


def _messages(caplog):
    return [r.getMessage() for r in caplog.records]


def _abort_code(ctx):
    assert ctx.abort.await_count == 1, ctx.abort.await_args_list
    return ctx.abort.await_args.args[0]


async def _list(svc, ctx=None, **req):
    ctx = ctx or _ctx(_HEADERS)
    resp = await asyncio.wait_for(
        svc.ListOpportunities(analysis_pb2.ListOpportunitiesRequest(**req), ctx), _HANG_GUARD_S
    )
    return resp, ctx


# ---------------------------------------------------------------- @AC-1


async def test_ac1_stalled_enrichment_serves_stored_rows_unenriched_within_deadline(caplog):
    svc = _svc(rows=[_row("AAPL"), _row("MSFT")])
    svc._cfg = _watcher(**{_ENRICH_TIMEOUT_KEY: config_pb2.ConfigValue(int_val=200)})

    async def _never_returns(*args, **kwargs):
        await asyncio.Event().wait()

    svc._marketdata.BatchGetLatestPrice = _never_returns
    t0 = time.monotonic()
    with caplog.at_level(logging.WARNING):
        resp, ctx = await _list(svc)
    assert time.monotonic() - t0 < 0.2 + 1.5
    assert sorted(o.symbol for o in resp.opportunities) == ["AAPL", "MSFT"]
    assert not any(o.HasField("live_price") for o in resp.opportunities)
    assert not any(o.data_unavailable for o in resp.opportunities)
    assert any("BatchGetLatestPrice" in m and "TimeoutError" in m for m in _messages(caplog))
    assert svc._live_enrich_memo == {}
    assert ctx.abort.await_count == 0


# ---------------------------------------------------------------- G3 (both paths)


async def test_g3_cold_read_past_max_failures_is_compute_failed(read_path):
    svc = _svc()
    kicks = _record_kicks(svc)
    svc._opportunity_compute_failures["u1"] = _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS
    resp, _ = await _list(svc)
    assert resp.compute_failed is True and resp.computing is False
    assert kicks["full"] == [True]


async def test_g3_cold_read_under_max_failures_is_computing(read_path):
    svc = _svc()
    kicks = _record_kicks(svc)
    svc._opportunity_compute_failures["u1"] = _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS - 1
    resp, _ = await _list(svc)
    assert resp.computing is True and resp.compute_failed is False
    assert kicks["full"] == [True]


async def test_g3_fresh_empty_stamp_sets_neither_flag_and_kicks(read_path):
    svc = _svc(state=_State(datetime.now(UTC) + timedelta(seconds=60)))
    kicks = _record_kicks(svc)
    resp, _ = await _list(svc)
    assert resp.computing is False and resp.compute_failed is False
    assert list(resp.opportunities) == []
    assert kicks["full"] == [True]


async def test_g3_stale_queue_serves_stale_kicks_and_uses_expired_facet(read_path):
    svc = _svc(rows=[_row("AAPL", fresh=False)])
    kicks = _record_kicks(svc)
    resp, _ = await _list(svc)
    assert [o.symbol for o in resp.opportunities] == ["AAPL"]
    assert list(resp.available_sources) == ["uw"]  # only an include_expired facet sees it
    assert kicks["full"] == [True] and kicks["retry"] == []


async def test_g3_fresh_queue_with_stale_unavailable_row_kicks_retry(read_path):
    svc = _svc(
        rows=[
            _row(
                "AAPL",
                provenance=("unavailable",),
                age_s=_OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS + 60,
            ),
            _row("MSFT"),
        ]
    )
    kicks = _record_kicks(svc)
    resp, _ = await _list(svc)
    assert sorted(o.symbol for o in resp.opportunities) == ["AAPL", "MSFT"]
    assert kicks["full"] == [] and kicks["retry"] == [({"AAPL"}, True)]


# ---------------------------------------------------------------- G5 (handler)


@pytest.mark.parametrize("stage", ["begin", "set_local", "fetch", "commit"])
async def test_g5_stall_at_every_stage_returns_unavailable_within_backstop(monkeypatch, stage):
    monkeypatch.setattr(read_budget, "_READ_DB_BACKSTOP_GRACE_S", 0.1)
    svc = _svc(rows=[_row("AAPL")])
    svc._cfg = _watcher(**{_READ_BUDGET_KEY: config_pb2.ConfigValue(int_val=200)})
    conn = FakeConn(stall={stage})
    _pooled(svc, conn)
    t0 = time.monotonic()
    resp, ctx = await _list(svc)
    assert time.monotonic() - t0 < 0.2 + 0.1 + 0.5
    assert resp is None
    assert _abort_code(ctx) == grpc.StatusCode.UNAVAILABLE
    assert conn.terminated == 1


# ---------------------------------------------------------------- G6 (unit)


async def test_g6_external_cancel_propagates_without_abort_or_error_log(caplog):
    svc = _svc(rows=[_row("AAPL")])
    conn = FakeConn(stall={"fetch"})
    _pooled(svc, conn)
    ctx = _ctx(_HEADERS)
    with caplog.at_level(logging.WARNING):
        task = asyncio.create_task(
            svc.ListOpportunities(analysis_pb2.ListOpportunitiesRequest(), ctx)
        )
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, _HANG_GUARD_S)
    assert ctx.abort.await_count == 0
    assert not any("opportunities read failed" in m for m in _messages(caplog))
    assert conn.terminated == 1


# ---------------------------------------------------------------- G7 (handler)


class _LostConn(FakeConn):
    """Connection lost mid-fetch: asyncpg detaches the proxy before the error surfaces."""

    async def fetch(self, *args, **kwargs):
        self.detached = True
        raise apg.ConnectionDoesNotExistError("connection was closed in the middle of operation")


async def test_g7_connection_lost_returns_unavailable_and_logs_original(caplog):
    svc = _svc(rows=[_row("AAPL")])
    conn = _LostConn()
    _pooled(svc, conn)
    with caplog.at_level(logging.WARNING):
        resp, ctx = await _list(svc)
    assert resp is None and _abort_code(ctx) == grpc.StatusCode.UNAVAILABLE
    assert conn.terminated == 0
    msgs = _messages(caplog)
    assert any("opportunities store unavailable (ConnectionDoesNotExistError" in m for m in msgs), (
        msgs
    )


# ---------------------------------------------------------------- H5


async def test_h5_success_path_release_failure_still_returns_rows(caplog):
    svc = _svc(rows=[_row("AAPL"), _row("MSFT")])
    pool = _pooled(svc, FakeConn())
    pool.release_raise = TimeoutError()
    with caplog.at_level(logging.WARNING):
        resp, ctx = await _list(svc)
    assert sorted(o.symbol for o in resp.opportunities) == ["AAPL", "MSFT"]
    assert any("read connection release failed" in m for m in _messages(caplog))
    assert ctx.abort.await_count == 0


# ---------------------------------------------------------------- classification (handler)


@pytest.mark.parametrize(
    "exc",
    [
        apg.PostgresConnectionError("08006"),
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
async def test_transient_db_error_returns_unavailable(caplog, exc):
    svc = _svc(rows=[_row("AAPL")])
    _pooled(svc, FakeConn(raise_on={"fetch": exc}))
    with caplog.at_level(logging.WARNING):
        resp, ctx = await _list(svc)
    assert resp is None
    assert ctx.abort.await_args.args == (
        grpc.StatusCode.UNAVAILABLE,
        "opportunities store unavailable; retry",
    )
    assert any("opportunities store unavailable" in m for m in _messages(caplog))


@pytest.mark.parametrize(
    "exc",
    [asyncpg.DataError("22000"), ValueError("plain"), apg.UndefinedTableError("42P01")],
    ids=lambda e: type(e).__name__,
)
async def test_non_transient_db_error_is_reraised_with_error_log(caplog, exc):
    svc = _svc(rows=[_row("AAPL")])
    _pooled(svc, FakeConn(raise_on={"fetch": exc}))
    ctx = _ctx(_HEADERS)
    with caplog.at_level(logging.WARNING):
        with pytest.raises(type(exc)) as ei:
            await _list(svc, ctx)
    assert ei.value is exc
    assert ctx.abort.await_count == 0
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("opportunities read failed" in m for m in errors), errors


async def test_compute_state_timeout_kicks_once_then_unavailable():
    svc = _svc(state=_State())
    kicks = _record_kicks(svc)
    _pooled(svc, FakeConn(raise_on={"fetchrow": TimeoutError()}))
    resp, ctx = await _list(svc)
    assert resp is None and _abort_code(ctx) == grpc.StatusCode.UNAVAILABLE
    assert kicks["full"] == [True]


# ---------------------------------------------------------------- O8


@pytest.mark.parametrize(
    "bad",
    [config_pb2.ConfigValue(float_val=5.0), config_pb2.ConfigValue(int_val=-5)],
    ids=["float-typed", "negative"],
)
async def test_o8_float_or_negative_ms_values_read_as_defaults(monkeypatch, bad):
    svc = _svc(rows=[_row("AAPL")])
    svc._cfg = _watcher(**{_READ_BUDGET_KEY: bad, _ENRICH_TIMEOUT_KEY: bad})
    conn = FakeConn()
    _pooled(svc, conn)
    timeouts = []
    real_wait_for = servicer_mod.asyncio.wait_for

    async def _spy_wait_for(aw, timeout):
        timeouts.append(timeout)
        return await real_wait_for(aw, timeout)

    monkeypatch.setattr(servicer_mod.asyncio, "wait_for", _spy_wait_for)
    await _list(svc)
    first_ms = int(next(e for e in conn.log if e.startswith("SET LOCAL")).rsplit(" ", 1)[1])
    assert 19000 < first_ms <= 20000
    assert 3.0 in timeouts


# ---------------------------------------------------------------- identity gate


async def test_headerless_call_is_unauthenticated_before_any_acquire():
    svc = _svc(rows=[_row("AAPL")])
    pool = _pooled(svc, FakeConn())
    resp, ctx = await _list(svc, _ctx({}))
    assert resp is None
    assert _abort_code(ctx) == grpc.StatusCode.UNAUTHENTICATED
    assert pool.acquire_timeouts == [] and pool.handed == []
