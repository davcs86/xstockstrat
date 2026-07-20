"""Engine unit tests for the screener (feature 060)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct

from app.services.screener import ScreenerEngine, _comparator_passes


def make_cfg(**overrides):
    cfg = MagicMock()
    defaults = {
        "analysis.screener.max_universe_size": 100,
        "analysis.screener.max_duration_seconds": 120,
        "analysis.screener.default_rank_limit": 50,
        "analysis.screener.max_concurrent_formula_evals": 4,
    }
    defaults.update(overrides)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: defaults.get(key, default))
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    return cfg


def bars(closes):
    return SimpleNamespace(bars=[marketdata_pb2.Bar(close=c) for c in closes])


def formula_resp(value):
    out = Struct()
    out.update({"value": value})
    return SimpleNamespace(success=True, output=out, error="")


def formula_criterion(ref, formula_id, op, threshold, weight=1.0, hard=False):
    return analysis_pb2.ScreenCriterion(
        ref_name=ref,
        kind=analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
        component=analysis_pb2.StrategyComponent(formula_id=formula_id),
        op=op,
        threshold=threshold,
        weight=weight,
        hard_filter=hard,
    )


def make_engine(marketdata, indicators, ingest=None, cfg=None):
    return ScreenerEngine(marketdata, indicators, ingest or AsyncMock(), cfg or make_cfg(), {})


# ── comparator ────────────────────────────────────────────────────────────────


def test_comparator_evaluation():
    LT, LTE, GT, GTE, BETWEEN = (
        analysis_pb2.COMPARATOR_LT,
        analysis_pb2.COMPARATOR_LTE,
        analysis_pb2.COMPARATOR_GT,
        analysis_pb2.COMPARATOR_GTE,
        analysis_pb2.COMPARATOR_BETWEEN,
    )
    assert _comparator_passes(LT, 5, 10, 0) is True
    assert _comparator_passes(LT, 10, 10, 0) is False
    assert _comparator_passes(LTE, 10, 10, 0) is True
    assert _comparator_passes(GT, 11, 10, 0) is True
    assert _comparator_passes(GTE, 10, 10, 0) is True
    assert _comparator_passes(BETWEEN, 5, 1, 10) is True
    assert _comparator_passes(BETWEEN, 11, 1, 10) is False


# ── Acceptance #1: ranked, score-ordered results ──────────────────────────────


async def test_screen_ranks_three_symbols_by_formula():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    # Each symbol's formula returns a different latest value → distinct, ordered scores.
    ind.ExecuteFormula = AsyncMock(
        side_effect=[formula_resp([0.1]), formula_resp([0.9]), formula_resp([0.5])]
    )
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB", "CCC"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 3
    scores = [r.score for r in resp.results]
    assert scores == sorted(scores, reverse=True)  # descending
    # BBB (0.9) ranks first, AAA (0.1) last after universe min-max normalization.
    assert resp.results[0].symbol == "BBB"
    assert resp.results[-1].symbol == "AAA"
    for r in resp.results:
        assert "f1" in r.criterion_scores


# ── Acceptance #3: insufficient data → INSUFFICIENT_DATA + gap ─────────────────


async def test_insufficient_bars_returns_gap():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([]))  # no bars
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 1
    r = resp.results[0]
    assert r.status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
    assert r.gap.symbol == "AAA"
    assert len(resp.coverage_gaps) == 1


# ── Acceptance #4 / FR-5: fundamentals skipped when RPC unavailable ────────────


async def test_fundamental_criterion_skipped_when_unavailable():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))

    err = grpc.RpcError()
    md.GetFundamentalsMulti = AsyncMock(side_effect=err)
    ind = AsyncMock()
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="cheap",
                kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                metric_name="pe_ratio",
                op=analysis_pb2.COMPARATOR_LT,
                threshold=20.0,
                hard_filter=True,
            )
        ],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 1
    r = resp.results[0]
    # Skipped: absent from criterion_scores, scan completes, symbol not failed by the filter.
    assert "cheap" not in r.criterion_scores
    assert r.status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    assert r.passed is True


# ── FR-6: universe min-max normalization ──────────────────────────────────────


def test_normalize_universe_direction_aware():
    engine = make_engine(AsyncMock(), AsyncMock())
    crit_gt = formula_criterion("hi", "f", analysis_pb2.COMPARATOR_GT, 0.0)
    crit_lt = formula_criterion("lo", "f", analysis_pb2.COMPARATOR_LT, 0.0)
    per_symbol = [
        {"symbol": "A", "raws": {"hi": 0.0, "lo": 0.0}},
        {"symbol": "B", "raws": {"hi": 10.0, "lo": 10.0}},
    ]
    norm = engine._normalize_universe([crit_gt, crit_lt], per_symbol)
    # GT: higher raw → higher norm.
    assert norm["hi"]["A"] == 0.0 and norm["hi"]["B"] == 1.0
    # LT: lower raw → higher norm (inverted).
    assert norm["lo"]["A"] == 1.0 and norm["lo"]["B"] == 0.0


# ── rank-limit capping ────────────────────────────────────────────────────────


async def test_rank_limit_caps_results():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0]))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    engine = make_engine(md, ind)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["A", "B", "C", "D"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
        rank_limit=2,
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 2


# ── universe cap (OQ-060-d) ───────────────────────────────────────────────────


async def test_universe_truncated_to_cap():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0]))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    cfg = make_cfg(**{"analysis.screener.max_universe_size": 2})
    engine = make_engine(md, ind, cfg=cfg)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["A", "B", "C", "D", "E"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 2  # capped to 2
