"""Ingest poll, signal-outcome, backfill and template signals (feature 294 AC-28/29/30/39/53)."""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import pytest
from gen.ingest.v1 import ingest_pb2

from app.engine import mcp_client_loop as loop
from tests import test_telemetry
from tests._helpers import job_row, transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer
from tests.test_mcp_client_loop import (
    _FakeCfgWatcher,
    _FakeMcpClient,
    _FakeResult,
    _item,
    _mcp_source,
    _run_cycle_with,
)
from tests.test_source_templates import _instantiate
from tests.test_telemetry_instruments import _data_points

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

_SS = "app.handlers.servicer"


def _count(reader, name, **attrs):
    return sum(p.value for p in _data_points(reader, name) if dict(p.attributes) == attrs)


def _all_attribute_values(reader):
    data = reader.get_metrics_data()
    return [
        v
        for rm in (data.resource_metrics if data else [])
        for sm in rm.scope_metrics
        for m in sm.metrics
        for p in m.data.data_points
        for v in dict(p.attributes).values()
    ]


async def test_ac28_no_bearer_counted_and_logged_without_slug_label(
    metric_reader, monkeypatch, caplog
):
    caplog.set_level("WARNING", logger=loop.__name__)
    src = _mcp_source(slug="my-feed", credentials_ref=None)
    ingest, errors = await _run_cycle_with(monkeypatch, _FakeResult([]), source=src)

    assert _count(metric_reader, "ingest.source.poll", outcome="no_bearer") == 1
    assert any(
        r.getMessage() == "mcp_client loop: source my-feed bearer not configured"
        for r in caplog.records
    )
    assert "my-feed" not in _all_attribute_values(metric_reader)
    # Source-health derivation input is unchanged: exactly the pre-existing mark_source_error.
    assert errors == [("my-feed", "bearer not configured")]
    ingest.assert_not_awaited()


async def test_ac29_polled_dedup_counted_and_logged_at_debug(metric_reader, monkeypatch, caplog):
    caplog.set_level("DEBUG", logger=_SS)
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[_mcp_source()]))
    db, _conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "acme-mcp"}, {"signal_id": 41}],
        conn_fetchrow_side_effect=[{"id": 43}, None],  # speculative insert, then claim -> dedup
    )
    svc = make_servicer(db=db)
    svc._db = db
    mcp = _FakeMcpClient(result=_FakeResult([_item("AAPL")]))

    await loop.run_one_cycle(svc, _FakeCfgWatcher(), mcp)

    assert _count(metric_reader, "ingest.signal.outcome", path="mcp_poll", outcome="deduplicated")
    assert _count(metric_reader, "ingest.signal.outcome", path="mcp_poll", outcome="ingested") == 0
    dedup = [r for r in caplog.records if r.getMessage().startswith("deduplicated signal")]
    assert [r.levelno for r in dedup] == [logging.DEBUG]
    assert dedup[0].getMessage().endswith("-> signal_id=41")


async def test_ac30_resume_job_failure_logged_counted_and_reraised(metric_reader, caplog):
    caplog.set_level("ERROR", logger=_SS)
    svc = make_servicer(db=MagicMock())
    err = asyncpg.exceptions.ConnectionDoesNotExistError("connection was closed")
    with (
        patch(
            "app.repositories.backfill_jobs.get_job",
            AsyncMock(return_value=job_row("job-7", ingest_pb2.BACKFILL_STATUS_FAILED)),
        ),
        patch("app.repositories.backfill_jobs.update_job", AsyncMock()) as uj,
        patch("app.repositories.backfill_chunks.get_incomplete_chunks", AsyncMock(side_effect=err)),
        pytest.raises(asyncpg.exceptions.ConnectionDoesNotExistError) as excinfo,
    ):
        await svc._resume_job("job-7")

    assert excinfo.value is err
    assert uj.await_args.kwargs["status"] == ingest_pb2.BACKFILL_STATUS_RUNNING
    failures = [r for r in caplog.records if r.getMessage() == "_resume_job failed job=job-7"]
    assert [r.levelno for r in failures] == [logging.ERROR]
    assert _count(metric_reader, "ingest.backfill.jobs", outcome="failed") == 1


async def test_ac53_drops_counted_truncated_and_valid_items_ingested(
    metric_reader, monkeypatch, caplog
):
    caplog.set_level("WARNING", logger="app.extractors.mcp_client")
    items = [
        _item("AAPL"),
        _item("MSFT", direction="sideways"),
        _item("TSLA"),
        _item("NVDA", direction="up", headline="x" * 4000),
        _item("AMZN"),
    ]
    ingest, errors = await _run_cycle_with(
        monkeypatch, _FakeResult(items), source=_mcp_source(slug="my-feed")
    )

    durations = _data_points(metric_reader, "ingest.source.poll.duration")
    assert [p.count for p in durations] == [1]
    assert (
        _count(
            metric_reader, "ingest.signal.dropped", stage="extract", reason="bad_symbol_direction"
        )
        == 2
    )
    drops = [r.getMessage() for r in caplog.records if "bad symbol/direction" in r.getMessage()]
    assert len(drops) == 2
    for msg in drops:
        assert "(source my-feed)" in msg
        assert len(msg.split("): ", 1)[1]) <= 200
    assert any(len(msg.split("): ", 1)[1]) == 200 for msg in drops)
    assert [c.args[0].symbol for c in ingest.await_args_list] == ["AAPL", "TSLA", "AMZN"]
    assert errors == []


async def test_ac39_instantiate_template_success_counted(metric_reader):
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    req, patches, _ins, _stamp = _instantiate()
    with patches[0], patches[1], patches[2], patches[3]:
        await svc.InstantiateTemplate(req, _ctx("0", user_id="bob"))

    assert _count(metric_reader, "template.instantiate", service="ingest", outcome="ok") == 1
