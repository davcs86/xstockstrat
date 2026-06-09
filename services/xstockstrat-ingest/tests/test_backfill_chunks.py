"""Unit tests for the backfill_chunks repository + pure planner (feature 054)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.repositories import backfill_chunks


def _dt(y, m, d):
    return datetime(y, m, d, tzinfo=UTC)


class TestPlanChunks:
    def test_empty_inputs(self):
        assert (
            backfill_chunks.plan_chunks([], "1d", _dt(2024, 1, 1), _dt(2024, 6, 1), 90, 1000) == []
        )
        # end <= start
        assert (
            backfill_chunks.plan_chunks(["AAPL"], "1d", _dt(2024, 6, 1), _dt(2024, 1, 1), 90, 1000)
            == []
        )

    def test_splits_by_time_window(self):
        # 360 days / 90-day window = 4 windows; huge cap → 1 chunk per window.
        chunks = backfill_chunks.plan_chunks(
            ["AAPL"], "1d", _dt(2023, 1, 1), _dt(2023, 12, 27), 90, 10_000_000
        )
        assert len(chunks) == 4
        # contiguous, non-overlapping
        for a, b in zip(chunks, chunks[1:]):
            assert a["range_end"] == b["range_start"]

    def test_density_yields_more_chunks_for_1m_than_1d(self):
        # Same symbols + range; a cap small enough that 1m (390 bars/day) must split symbols
        # while 1d (1 bar/day) fits all symbols per window.
        symbols = ["AAPL", "TSLA", "MSFT"]
        start, end = _dt(2023, 1, 1), _dt(2023, 4, 1)
        cap = 5000
        oneday = backfill_chunks.plan_chunks(symbols, "1d", start, end, 90, cap)
        onemin = backfill_chunks.plan_chunks(symbols, "1m", start, end, 90, cap)
        assert len(onemin) > len(oneday)

    def test_no_chunk_exceeds_bar_cap(self):
        cap = 5000
        chunks = backfill_chunks.plan_chunks(
            ["AAPL", "TSLA", "MSFT", "NVDA"], "1h", _dt(2022, 1, 1), _dt(2024, 1, 1), 90, cap
        )
        bpd = backfill_chunks._BARS_PER_DAY["1h"]
        for c in chunks:
            wk = backfill_chunks._weekdays(c["range_start"], c["range_end"])
            assert len(c["symbols"]) * wk * bpd <= cap or len(c["symbols"]) == 1


class TestEstimateBars:
    def test_estimate_sums_chunks(self):
        chunks = [
            {"symbols": ["AAPL"], "range_start": _dt(2024, 1, 1), "range_end": _dt(2024, 1, 8)},
        ]
        # 5 weekdays * 1 bar/day * 1 symbol = 5
        assert backfill_chunks.estimate_bars(chunks, "1d") == 5


class TestChunkRepo:
    @pytest.mark.asyncio
    async def test_insert_chunks_returns_ids(self):
        pool = AsyncMock()
        pool.fetchrow = AsyncMock(side_effect=[{"chunk_id": "a"}, {"chunk_id": "b"}])
        ids = await backfill_chunks.insert_chunks(
            pool,
            "job-1",
            [
                {"symbols": ["AAPL"], "range_start": _dt(2024, 1, 1), "range_end": _dt(2024, 2, 1)},
                {"symbols": ["TSLA"], "range_start": _dt(2024, 2, 1), "range_end": _dt(2024, 3, 1)},
            ],
        )
        assert ids == ["a", "b"]

    @pytest.mark.asyncio
    async def test_get_incomplete_chunks_filters_pending_failed(self):
        pool = AsyncMock()
        pool.fetch = AsyncMock(return_value=[{"chunk_id": "a"}])
        rows = await backfill_chunks.get_incomplete_chunks(pool, "job-1")
        assert rows == [{"chunk_id": "a"}]
        sql = pool.fetch.await_args.args[0]
        assert "status IN ($2, $3)" in sql

    @pytest.mark.asyncio
    async def test_mark_chunk_completed_sets_bars(self):
        pool = AsyncMock()
        await backfill_chunks.mark_chunk_completed(pool, "c1", bars_written=42)
        args = pool.execute.await_args.args
        assert args[1] == backfill_chunks.CHUNK_COMPLETED
        assert args[2] == 42

    @pytest.mark.asyncio
    async def test_list_jobs_with_incomplete_chunks(self):
        pool = AsyncMock()
        pool.fetch = AsyncMock(return_value=[{"job_id": "j1"}, {"job_id": "j2"}])
        jobs = await backfill_chunks.list_jobs_with_incomplete_chunks(pool)
        assert jobs == ["j1", "j2"]
