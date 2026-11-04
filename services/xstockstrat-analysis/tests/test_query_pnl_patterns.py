"""
Tests for QueryPnLPatterns (feature 042) — the query-time quantile bucketing + ranked factor RPC.

The pure ``bucket_pnl_factors`` helper carries the AC-3 substance (bucketing, min-sample drop,
factor_type); the RPC test drives ``AnalysisServicer.QueryPnLPatterns`` with a fake samples repo.
asyncio_mode = auto.
"""

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2

from app.handlers.servicer import bucket_pnl_factors
from app.repositories.pnl_pattern_samples import PnLPatternSamplesRepository
from tests.conftest import OWNER_HEADERS, ctx_with, snapshot_watcher
from tests.test_analysis_servicer import make_servicer


def _ind(value, pnl, name="RSI"):
    return {
        "factor_name": name,
        "factor_type": "indicator",
        "indicator_value": value,
        "signal_present": None,
        "realized_pnl": pnl,
    }


def _sig(pnl, name="uw"):
    return {
        "factor_name": name,
        "factor_type": "signal",
        "indicator_value": None,
        "signal_present": True,
        "realized_pnl": pnl,
    }


# ── bucket_pnl_factors — the pure AC-3 logic ────────────────────────────────


def test_bucket_indicator_quantiles_and_signal_grouping():
    # 10 RSI samples: low bucket (20-24) all +100, high bucket (70-74) all -100.
    samples = [_ind(20 + i, 100) for i in range(5)] + [_ind(70 + i, -100) for i in range(5)]
    samples += [_sig(50) for _ in range(5)]  # a present signal, avg +50
    factors = bucket_pnl_factors(samples, min_sample=3, bucket_count=2)

    inds = [f for f in factors if f.factor_type == analysis_pb2.FACTOR_TYPE_INDICATOR]
    sigs = [f for f in factors if f.factor_type == analysis_pb2.FACTOR_TYPE_SIGNAL]
    assert len(inds) == 2, "two quantile buckets survive"
    assert {round(f.avg_pnl_impact) for f in inds} == {100, -100}
    # low bucket carries the low value range, high bucket the high range
    low = min(inds, key=lambda f: f.value_range_low)
    assert low.value_range_low == 20 and low.value_range_high == 24
    assert len(sigs) == 1 and sigs[0].avg_pnl_impact == 50
    for f in factors:
        assert f.factor_name and f.sample_count >= 3


def test_min_sample_drop_has_teeth():
    # A factor whose only bucket has < min_sample is dropped entirely.
    samples = [_ind(30, 10), _ind(31, 10)]  # 2 samples
    assert bucket_pnl_factors(samples, min_sample=5, bucket_count=5) == []


# ── AC-3: the RPC returns ranked positive + negative factors ────────────────


class _FakeSamplesRepo:
    """In-memory samples keyed by owner: ``pairs`` is ``[(user_id, row), ...]``."""

    def __init__(self, pairs):
        self._pairs = pairs
        self.calls = []

    async def query(self, *, user_id, symbol, strategy_id="", from_ts=None, to_ts=None):
        self.calls.append(user_id)
        return [row for owner, row in self._pairs if owner == user_id]


async def test_ac3_query_returns_ranked_positive_and_negative():
    servicer = make_servicer()
    rows = (
        [_ind(20 + i, 100) for i in range(5)]  # positive indicator bucket
        + [_ind(70 + i, -80) for i in range(5)]  # negative indicator bucket
        + [_sig(50) for _ in range(5)]  # positive signal factor
    )
    servicer._pnl_samples_repo = _FakeSamplesRepo([("u-1", r) for r in rows])
    servicer._cfg.get_int = lambda k, d: {
        "analysis.patterns.min_sample_count": 3,
        "analysis.patterns.indicator_bucket_count": 2,
    }.get(k, d)

    resp = await servicer.QueryPnLPatterns(
        analysis_pb2.QueryPnLPatternsRequest(symbol="AAPL", limit=10), ctx_with(OWNER_HEADERS)
    )
    assert len(resp.positive_factors) >= 1
    assert len(resp.negative_factors) >= 1
    for f in list(resp.positive_factors) + list(resp.negative_factors):
        assert f.factor_name
        assert f.factor_type in (
            analysis_pb2.FACTOR_TYPE_INDICATOR,
            analysis_pb2.FACTOR_TYPE_SIGNAL,
        )
        assert f.sample_count >= 3
    # positive ranked by |impact| desc: the +100 indicator outranks the +50 signal
    assert abs(resp.positive_factors[0].avg_pnl_impact) >= abs(
        resp.positive_factors[-1].avg_pnl_impact
    )


async def test_query_no_repo_returns_empty():
    servicer = make_servicer()  # no db → _pnl_samples_repo is None
    resp = await servicer.QueryPnLPatterns(
        analysis_pb2.QueryPnLPatternsRequest(symbol="AAPL"), ctx_with(OWNER_HEADERS)
    )
    assert list(resp.positive_factors) == [] and list(resp.negative_factors) == []


# ── feature 225 FR-7: QueryPnLPatterns is owner-scoped ──────────────────────


class _RecordingDb:
    def __init__(self):
        self.sql, self.args = None, None

    async def fetch(self, sql, *args):
        self.sql, self.args = sql, args
        return []


_OWNER_PREDICATE = (
    "position_id IN (SELECT position_id FROM analysis.pnl_positions "
    "WHERE user_id = ${n} AND symbol = $1)"
)


async def test_ac14_repository_binds_owner_predicate():
    db = _RecordingDb()
    await PnLPatternSamplesRepository(db).query(user_id="u-1", symbol="AAPL")
    assert _OWNER_PREDICATE.format(n=2) in db.sql
    assert db.args == ("AAPL", "u-1")


async def test_ac14_repository_owner_index_follows_optional_filters():
    db = _RecordingDb()
    await PnLPatternSamplesRepository(db).query(
        user_id="u-1", symbol="AAPL", strategy_id="s-1", from_ts="t0", to_ts="t1"
    )
    assert _OWNER_PREDICATE.format(n=5) in db.sql
    assert db.args == ("AAPL", "s-1", "t0", "t1", "u-1")


async def test_ac14_query_pnl_patterns_returns_only_callers_samples():
    servicer = make_servicer()
    pairs = [("u-1", _sig(50, name="sig:uw")) for _ in range(5)]
    pairs += [("u-2", _sig(-10, name="sig:uw")) for _ in range(6)]
    pairs += [("u-2", _sig(90, name="sig:newsletter-b")) for _ in range(5)]
    servicer._pnl_samples_repo = _FakeSamplesRepo(pairs)
    resp = await servicer.QueryPnLPatterns(
        analysis_pb2.QueryPnLPatternsRequest(symbol="AAPL"), ctx_with(OWNER_HEADERS)
    )
    factors = list(resp.positive_factors) + list(resp.negative_factors)
    assert factors and all(f.factor_name != "sig:newsletter-b" for f in factors)
    assert [(f.factor_name, f.sample_count) for f in factors] == [("sig:uw", 5)]
    assert servicer._pnl_samples_repo.calls == ["u-1"]


async def test_ac15_headerless_query_pnl_patterns_unauthenticated():
    servicer = make_servicer()
    servicer._pnl_samples_repo = _FakeSamplesRepo([("u-1", _sig(50))])
    ctx = ctx_with([("x-trace-id", "t")])
    with pytest.raises(Exception, match="aborted"):
        await servicer.QueryPnLPatterns(analysis_pb2.QueryPnLPatternsRequest(symbol="AAPL"), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAUTHENTICATED
    assert servicer._pnl_samples_repo.calls == []


async def test_stored_zero_min_sample_count_reaches_bucketing(monkeypatch):
    """Feature 244 @AC-12: a stored min_sample_count of 0 reaches the bucketing (was: 5)."""
    seen = []

    def _recorder(samples, *, min_sample, bucket_count):
        seen.append(min_sample)
        return []

    monkeypatch.setattr("app.handlers.servicer.bucket_pnl_factors", _recorder)
    servicer = make_servicer()
    servicer._pnl_samples_repo = _FakeSamplesRepo([])
    servicer._cfg = snapshot_watcher(**{"analysis.patterns.min_sample_count": 0})
    await servicer.QueryPnLPatterns(
        analysis_pb2.QueryPnLPatternsRequest(symbol="AAPL", limit=10), ctx_with(OWNER_HEADERS)
    )
    assert seen == [0]
