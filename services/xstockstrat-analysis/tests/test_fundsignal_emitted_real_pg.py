"""fundsignal_emitted claim, confirm and release against a real PostgreSQL (feature 260)."""

import pathlib
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import asyncpg
import grpc
import pytest

from tests.test_fundsignal_loop import _identity_loop, _rpc_error

pytestmark = pytest.mark.real_pg

_MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / "migrations"


@pytest.fixture
async def pool(local_pg):
    pool = await asyncpg.create_pool(local_pg, min_size=1, max_size=1, statement_cache_size=0)
    await pool.execute("CREATE SCHEMA IF NOT EXISTS analysis")
    for name in ("003_fundsignal_runs.up.sql", "004_fundsignal_emitted.up.sql"):
        await pool.execute((_MIGRATIONS / name).read_text())
    await pool.execute("TRUNCATE analysis.fundsignal_emitted, analysis.fundsignal_runs")
    try:
        yield pool
    finally:
        await pool.close()


def _pg_loop(pool, scores, ingest):
    loop = _identity_loop(ingest_responses={"IngestSignal": ingest})
    loop._db = pool
    loop._score = AsyncMock(return_value=(scores, []))
    return loop


async def test_failed_emit_releases_then_reclaims_and_confirms(pool):
    first = _pg_loop(pool, {"AAPL": 0.85}, _rpc_error(grpc.StatusCode.UNAVAILABLE))
    await first.run_once(override_symbols=["AAPL"])
    assert await pool.fetchval("SELECT count(*) FROM analysis.fundsignal_emitted") == 0

    second = _pg_loop(pool, {"AAPL": 0.85}, SimpleNamespace(signal_id=777))
    summary = await second.run_once(override_symbols=["AAPL"])
    row = await pool.fetchrow(
        "SELECT signal_id, run_id FROM analysis.fundsignal_emitted WHERE symbol='AAPL'"
    )
    assert row["signal_id"] == 777
    assert str(row["run_id"]) == summary.run_id


async def test_confirm_does_not_overwrite_a_foreign_run_claim(pool):
    foreign_run = str(uuid.uuid4())
    await pool.execute(
        "INSERT INTO analysis.fundsignal_runs (run_id, status) VALUES ($1::uuid, 'running')",
        foreign_run,
    )

    async def _reclaimed_then_accepted(request, metadata=None, **_kw):
        await pool.execute("UPDATE analysis.fundsignal_emitted SET run_id=$1::uuid", foreign_run)
        return SimpleNamespace(signal_id=9)

    loop = _pg_loop(pool, {"AAPL": 0.85}, None)
    # RecordingStub calls a response function synchronously; this one has to await the pool.
    loop._ingest.IngestSignal = AsyncMock(side_effect=_reclaimed_then_accepted)
    await loop.run_once(override_symbols=["AAPL"])
    row = await pool.fetchrow(
        "SELECT signal_id, run_id FROM analysis.fundsignal_emitted WHERE symbol='AAPL'"
    )
    assert row["signal_id"] is None
    assert str(row["run_id"]) == foreign_run


async def test_abort_deletes_only_the_unconfirmed_claim(pool):
    def _ingest(request):
        if request.signal.symbol == "MSFT":
            raise _rpc_error(grpc.StatusCode.NOT_FOUND)
        return SimpleNamespace(signal_id=501)

    loop = _pg_loop(pool, {"AAPL": 0.85, "MSFT": 0.90}, _ingest)
    summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
    assert summary.status == "failed"
    rows = await pool.fetch("SELECT symbol, signal_id FROM analysis.fundsignal_emitted")
    assert [(r["symbol"], r["signal_id"]) for r in rows] == [("AAPL", 501)]
