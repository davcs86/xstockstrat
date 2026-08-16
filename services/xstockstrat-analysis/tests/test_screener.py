"""Engine unit tests for the screener (feature 060)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
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


# ── Bug fix: fundamentals unavailable must never report OK/passed=true ─────────
# (previously the scan degraded silently: a fundamental criterion whose data source was
# unavailable was dropped from criterion_scores but the result still reported OK/passed=true —
# indistinguishable from "this candidate genuinely passed", which made the screener look inert
# no matter what fundamental criterion/value a caller picked.)


async def test_fundamentals_unavailable_yields_insufficient_data():
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
    assert "cheap" not in r.criterion_scores
    assert r.status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
    assert r.passed is False
    # Not a bars gap — fundamentals unavailability carries no CoverageGap.
    assert resp.coverage_gaps == []


async def test_fundamentals_unavailable_bails_even_for_rank_only_criteria():
    """`needs_fundamentals` doesn't check hard_filter — a rank-only fundamental criterion with no
    data source is just as unable to contribute a score as a hard-filter one."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    md.GetFundamentalsMulti = AsyncMock(side_effect=grpc.RpcError())
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
                hard_filter=False,
            )
        ],
    )
    resp = await engine.screen(req)
    assert resp.results[0].status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA


async def test_fundamental_hard_filter_missing_for_one_symbol_fails_closed():
    """Fundamentals ARE available for the batch, but the source omitted one symbol — that
    symbol's hard filter must fail closed rather than silently pass."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[marketdata_pb2.Fundamentals(symbol="AAA", pe_ratio=15.0)]
        )
    )
    ind = AsyncMock()
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB"],  # the fundamentals source only returned AAA
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
    by_symbol = {r.symbol: r for r in resp.results}
    assert by_symbol["AAA"].passed is True  # evaluated normally: 15 < 20
    assert "cheap" not in by_symbol["BBB"].criterion_scores  # skipped for BBB specifically
    # Not a whole-batch outage — BBB still reports OK, just fails the filter it couldn't verify.
    assert by_symbol["BBB"].status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    assert by_symbol["BBB"].passed is False


async def test_fundamental_hard_filter_missing_field_fails_closed_not_lte_zero():
    """Bug fix: a known fundamental field the provider never supplied (marked via
    `missing_metrics`, wire-default 0.0) must never be read as a real 0.0 — an `lte` hard
    filter comparing a missing value against a positive threshold used to evaluate
    `0.0 <= threshold` and silently "pass" a symbol whose metric was never actually fetched.
    """
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[
                # pe_ratio never supplied by the provider — wire value defaults to 0.0,
                # which `0.0 <= 20.0` would satisfy if missing_metrics weren't checked.
                marketdata_pb2.Fundamentals(symbol="AAA", missing_metrics=["pe_ratio"]),
                # BBB genuinely has pe_ratio == 0.0 (present, not missing) and must still pass.
                marketdata_pb2.Fundamentals(symbol="BBB", pe_ratio=0.0),
            ]
        )
    )
    ind = AsyncMock()
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="cheap",
                kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                metric_name="pe_ratio",
                op=analysis_pb2.COMPARATOR_LTE,
                threshold=20.0,
                hard_filter=True,
            )
        ],
    )
    resp = await engine.screen(req)
    by_symbol = {r.symbol: r for r in resp.results}
    # AAA's pe_ratio was never fetched — the hard filter must fail closed, not silently pass.
    assert "cheap" not in by_symbol["AAA"].criterion_scores
    assert by_symbol["AAA"].status == analysis_pb2.SCREEN_RESULT_STATUS_OK  # not a batch outage
    assert by_symbol["AAA"].passed is False
    # BBB's pe_ratio is a genuine 0.0 (present) — must still evaluate and pass normally.
    assert "cheap" in by_symbol["BBB"].criterion_scores
    assert by_symbol["BBB"].passed is True


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


# ── feature 090 (AC-2): min_conviction is a hard floor ────────────────────────


async def test_min_conviction_filters_low_score_symbols():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    # AAA→0.1 (norm 0.0), BBB→0.9 (norm ~0.89), CCC→1.0 (norm 1.0); pure-technical score == norm.
    ind.ExecuteFormula = AsyncMock(
        side_effect=[formula_resp([0.1]), formula_resp([0.9]), formula_resp([1.0])]
    )
    engine = make_engine(md, ind)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB", "CCC"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
        min_conviction=0.1,  # buy_threshold = max(0.55, 0.55) = 0.55
    )
    resp = await engine.screen(req)
    # AAA (0.0) is below the 0.55 floor and dropped; BBB and CCC clear it.
    symbols = {r.symbol for r in resp.results}
    assert symbols == {"BBB", "CCC"}
    assert "AAA" not in symbols


# ── feature 090 (AC-4): gaps come from the full list, before truncation ───────


async def test_coverage_gaps_survive_rank_limit_truncation():
    md = AsyncMock()
    # AAA/BBB have bars; CCC has none → INSUFFICIENT_DATA, ranked last, truncated by rank_limit=1.
    md.GetBars = AsyncMock(side_effect=[bars([1.0, 2.0, 3.0]), bars([1.0, 2.0, 3.0]), bars([])])
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(side_effect=[formula_resp([0.9]), formula_resp([0.1])])
    engine = make_engine(md, ind)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB", "CCC"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
        rank_limit=1,
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 1  # truncated to the single top result
    # CCC's gap still surfaces even though it was truncated out of results.
    gap_symbols = {g.symbol for g in resp.coverage_gaps}
    assert gap_symbols == {"CCC"}


# ── feature 090: unknown fundamental metric_name → ValueError ─────────────────


async def test_unknown_fundamental_metric_raises():
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[marketdata_pb2.Fundamentals(symbol="AAA", pe_ratio=15.0)]
        )
    )
    ind = AsyncMock()
    engine = make_engine(md, ind)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="cheap",
                kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                metric_name="pe_ration",  # typo of pe_ratio
                op=analysis_pb2.COMPARATOR_LT,
                threshold=20.0,
            )
        ],
    )
    with pytest.raises(ValueError, match="pe_ration"):
        await engine.screen(req)


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


# ── feature 125 (FR-8): single-symbol raw per-criterion values + pass/fail ────


async def test_single_symbol_criterion_raw_values_and_passed():
    """FR-8: single-symbol screening exposes each criterion's real raw reading and pass/fail,
    where the universe-relative `criterion_scores` collapse to a content-free 0.5 (min==max)."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    # One symbol, three formula criteria → three ExecuteFormula calls in criteria order:
    #   f_pass raw 0.8 (GT 0.5 → pass), f_fail raw 0.8 (GT 0.9 → fail),
    #   f_skip → formula error (skipped)
    ind.ExecuteFormula = AsyncMock(
        side_effect=[
            formula_resp([0.8]),
            formula_resp([0.8]),
            SimpleNamespace(success=False, output=Struct(), error="boom"),
        ]
    )
    engine = make_engine(md, ind)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA"],
        criteria=[
            formula_criterion("f_pass", "fid_pass", analysis_pb2.COMPARATOR_GT, 0.5),
            formula_criterion("f_fail", "fid_fail", analysis_pb2.COMPARATOR_GT, 0.9),
            formula_criterion("f_skip", "fid_skip", analysis_pb2.COMPARATOR_GT, 0.0),
        ],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 1
    r = resp.results[0]
    # Raw values are the real formula readings — NOT the universe-collapsed 0.5.
    assert r.criterion_raw_values["f_pass"] == pytest.approx(0.8)
    assert r.criterion_raw_values["f_fail"] == pytest.approx(0.8)
    # The contrast that motivates the new field: a single-symbol universe collapses scores to 0.5.
    assert r.criterion_scores["f_pass"] == pytest.approx(0.5)
    # Pass/fail reflects the comparator against the raw value, not the collapsed score.
    assert r.criterion_passed["f_pass"] is True
    assert r.criterion_passed["f_fail"] is False
    # A skipped criterion (formula unavailable) is absent from BOTH new maps
    # (mirrors criterion_scores).
    assert "f_skip" not in r.criterion_raw_values
    assert "f_skip" not in r.criterion_passed
    assert "f_skip" not in r.criterion_scores
