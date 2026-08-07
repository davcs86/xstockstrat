"""Source-health tests (feature 083): health derivation, ListSignalSources enrichment,
and the IngestSignal last_seen_at/signals_fed bookkeeping."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.ingest.v1 import ingest_pb2

from app.handlers.servicer import IngestServicer
from app.repositories.signal_sources import derive_health_status
from tests._helpers import transaction_conn

NOW = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)


def _servicer(db):
    """Minimal IngestServicer with real int config (the ctor builds a Semaphore from it)."""
    cfg = MagicMock()
    cfg.backfill_max_concurrent_jobs = 5
    cfg.backfill_retry_on_failure = True
    cfg.backfill_max_retry_attempts = 3
    cfg.backfill_max_concurrent_chunks = 5
    cfg.backfill_chunk_window_days = 400
    cfg.backfill_chunk_max_bars = 10_000_000
    cfg.dedup_window_hours = 24
    svc = IngestServicer(cfg, MagicMock(), MagicMock(), db_pool=db)
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return svc


def _ctx():
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=[("x-user-id", "u1"), ("x-trace-id", "t1")])
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


# ---------------------------------------------------------------------------
# derive_health_status (pure)
# ---------------------------------------------------------------------------


class TestDeriveHealth:
    def test_fresh_is_live(self):
        assert derive_health_status(NOW - timedelta(hours=1), None, NOW) == "live"

    def test_aged_is_stale(self):
        assert derive_health_status(NOW - timedelta(days=2), None, NOW) == "stale"

    def test_old_is_down(self):
        assert derive_health_status(NOW - timedelta(days=30), None, NOW) == "down"

    def test_never_seen_is_unspecified(self):
        assert derive_health_status(None, None, NOW) == "unspecified"

    def test_never_seen_with_error_is_down(self):
        assert derive_health_status(None, "boom", NOW) == "down"

    def test_recent_feed_overrides_old_error(self):
        # a fresh feed clears the health picture even if an error string lingers.
        assert derive_health_status(NOW - timedelta(minutes=5), "old", NOW) == "live"


# ---------------------------------------------------------------------------
# ListSignalSources enrichment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_sources_enriched_with_health():
    db = MagicMock()
    db.fetch = AsyncMock(
        return_value=[
            {
                "slug": "uw",
                "display_name": "Unusual Whales",
                "source_type": "simple_email",
                "extractor_module": "app.extractors.noop",
                "credentials_ref": None,
                "active": True,
                "config_json": None,
                "created_at": None,
                "last_seen_at": datetime.now(UTC) - timedelta(hours=1),
                "last_error": None,
                "signals_fed": 42,
            }
        ]
    )
    svc = _servicer(db)
    resp = await svc.ListSignalSources(
        ingest_pb2.ListSignalSourcesRequest(include_inactive=True), _ctx()
    )
    src = resp.sources[0]
    assert src.health == ingest_pb2.SOURCE_HEALTH_STATUS_LIVE
    assert src.signals_fed == 42
    assert src.last_error == ""
    assert src.last_seen_at.seconds > 0


@pytest.mark.asyncio
async def test_list_sources_down_when_stale_and_error():
    db = MagicMock()
    db.fetch = AsyncMock(
        return_value=[
            {
                "slug": "mw",
                "display_name": "MarketWatch",
                "source_type": "simple_website",
                "extractor_module": "app.extractors.noop",
                "credentials_ref": "vault://x",
                "active": True,
                "config_json": None,
                "created_at": None,
                "last_seen_at": datetime.now(UTC) - timedelta(days=30),
                "last_error": "scrape failed",
                "signals_fed": 3,
            }
        ]
    )
    svc = _servicer(db)
    resp = await svc.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(), _ctx())
    src = resp.sources[0]
    assert src.health == ingest_pb2.SOURCE_HEALTH_STATUS_DOWN
    assert src.last_error == "scrape failed"
    assert src.has_credentials is True


# ---------------------------------------------------------------------------
# IngestSignal bookkeeping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_signal_bumps_fed_count():
    db, conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "uw"}],
        conn_fetchrow_side_effect=[{"id": 7}, {"signal_id": 7}],
    )
    db.execute = AsyncMock(return_value="UPDATE 1")
    svc = _servicer(db)
    signal = ingest_pb2.ExternalSignal(source="uw", symbol="aapl", direction="buy", conviction=0.8)
    resp = await svc.IngestSignal(ingest_pb2.IngestSignalRequest(signal=signal), _ctx())
    assert resp.signal_id == 7
    # mark_source_fed issued the freshness/count UPDATE for the source.
    update_sql = db.execute.await_args.args[0]
    assert "signals_fed = signals_fed + 1" in update_sql
    assert "last_seen_at = NOW()" in update_sql
    assert db.execute.await_args.args[1] == "uw"
