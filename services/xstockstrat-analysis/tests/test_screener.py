"""Engine unit tests for the screener (feature 060)."""

import asyncio
import logging
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.ingest.v1 import ingest_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.services import screener as screener_mod
from app.services.screener import ScreenerEngine, _comparator_passes
from tests.conftest import snapshot_watcher


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


async def test_insufficient_bars_logs_summarized_warning(caplog):
    # feature 140 FR-6: bars gaps, previously carried only in the response (INSUFFICIENT_DATA +
    # coverage_gaps), now also surface in the runtime logs as one summarized WARN per scan.
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([]))  # every symbol short on bars
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    with caplog.at_level(logging.WARNING, logger="app.services.screener"):
        await engine.screen(req)

    summaries = [
        r for r in caplog.records if "insufficient 1d bars for technical criteria" in r.getMessage()
    ]
    assert len(summaries) == 1  # one summary for the whole scan, not one per symbol
    msg = summaries[0].getMessage()
    assert "2/2" in msg and "AAA" in msg and "BBB" in msg


async def test_rpc_error_bars_not_double_counted_in_summary(caplog):
    # feature 140 FR-6: a symbol whose GetBars RAISES is already logged per-symbol; it must be
    # excluded from the summarized-gap WARN so an RPC failure is not double-reported.
    md = AsyncMock()
    md.GetBars = AsyncMock(side_effect=grpc.RpcError("boom"))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    with caplog.at_level(logging.WARNING, logger="app.services.screener"):
        await engine.screen(req)

    # The per-symbol RpcError WARN fires; the FR-6 summary does NOT (the only gap was an RPC error).
    assert [r for r in caplog.records if "GetBars failed for AAA" in r.getMessage()]
    assert not [
        r for r in caplog.records if "insufficient 1d bars for technical criteria" in r.getMessage()
    ]


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
    assert by_symbol["AAA"].score_unavailable is False
    assert "cheap" not in by_symbol["BBB"].criterion_scores  # skipped for BBB specifically
    # Not a whole-batch outage — BBB still reports OK, just fails the filter it couldn't verify.
    assert by_symbol["BBB"].status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    assert by_symbol["BBB"].passed is False
    # Bug fix (feature 144): BBB's only configured criterion was skipped, so its score is the
    # same neutral placeholder as before — now flagged rather than silently indistinguishable.
    assert by_symbol["BBB"].score_unavailable is True


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
    assert by_symbol["AAA"].score_unavailable is True  # feature 144: no usable criterion data
    # BBB's pe_ratio is a genuine 0.0 (present) — must still evaluate and pass normally.
    assert "cheap" in by_symbol["BBB"].criterion_scores
    assert by_symbol["BBB"].passed is True
    assert by_symbol["BBB"].score_unavailable is False


# ── Bug fix (feature 144): soft-criterion neutral-fallback score must not outrank real data ────
# (the hard-filter cases above already fail closed on `passed`; this is the sibling gap in the
# *ranking* `score` a soft/weighted criterion feeds — a candidate with zero usable data for every
# configured criterion previously scored a plausible-looking 0.500, indistinguishable from a
# genuinely-computed mid-range result, and could outrank candidates with real, worse-looking data.)


async def test_soft_criterion_missing_data_flags_score_unavailable_and_ranks_last():
    """Reproduces the exact QQQ defect: a soft (non-hard-filter) `pe_ratio < 20` criterion, one
    candidate (QQQ) has no P/E data at all. Pre-fix, QQQ's neutral 0.5 ranked it above MSFT's
    genuinely-computed, worse-looking score; post-fix it must be flagged and sorted last."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[
                marketdata_pb2.Fundamentals(symbol="GOOG", pe_ratio=17.3),
                marketdata_pb2.Fundamentals(symbol="MSFT", pe_ratio=27.7),
                # QQQ: an ETF with no P/E ratio ever reported — genuinely missing, not a real 0.0.
                marketdata_pb2.Fundamentals(symbol="QQQ", missing_metrics=["pe_ratio"]),
            ]
        )
    )
    ind = AsyncMock()
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["GOOG", "MSFT", "QQQ"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="cheap",
                kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                metric_name="pe_ratio",
                op=analysis_pb2.COMPARATOR_LT,
                threshold=20.0,
                weight=1.0,
                hard_filter=False,
            )
        ],
    )
    resp = await engine.screen(req)
    by_symbol = {r.symbol: r for r in resp.results}

    assert by_symbol["GOOG"].score_unavailable is False
    assert by_symbol["MSFT"].score_unavailable is False
    assert by_symbol["QQQ"].score_unavailable is True
    # Not a whole-batch outage or a bars gap — QQQ still reports OK, just an unscorable candidate.
    assert by_symbol["QQQ"].status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    assert "cheap" not in by_symbol["QQQ"].criterion_scores

    # The fix: QQQ never outranks a genuinely-scored candidate, regardless of its own numeric
    # score — GOOG (cheapest, real data) and MSFT (real, worse-looking data) both rank above it.
    assert [r.symbol for r in resp.results] == ["GOOG", "MSFT", "QQQ"]


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


async def test_stored_zero_default_rank_limit_returns_every_result():
    """Feature 244 @AC-12: a stored default_rank_limit of 0 disables the cap (was: 50)."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0]))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    cfg = snapshot_watcher(**{"analysis.screener.default_rank_limit": 0})
    engine = make_engine(md, ind, cfg=cfg)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=[f"S{i:02d}" for i in range(51)],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)
    assert len(resp.results) == 51


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


# ── feature 160 (@AC-1): signal-weighted screen returns OK, not a bar-time crash ──────────────
# The exact staging repro: compute_signal_score read `bar.timestamp`, but the marketdata Bar proto
# field is `time` — so any signal-weighted ScreenSymbols (signal_sources set AND signal_weight > 0)
# crashed with `AttributeError: timestamp` propagating unwrapped out of screen() (no per-symbol
# try/except). The bare `bars()` helper leaves `time` unset, so this test builds its own
# time-stamped bars (≥2 to clear the INSUFFICIENT_DATA short-circuit before the signal blend).


def _timed_bar(close, when):
    bar = marketdata_pb2.Bar(close=close)
    bar.time.FromDatetime(when)
    return bar


async def test_signal_weighted_screen_returns_ok_not_crash():
    """@AC-1: a signal-weighted screen (fundamentals source, signal_weight=1) returns OK for every
    symbol instead of crashing on the bar-time field-name bug (feature 160)."""
    last_bar_time = datetime(2024, 1, 2, 0, 0, 0)
    md = AsyncMock()
    md.GetBars = AsyncMock(
        return_value=SimpleNamespace(
            bars=[
                _timed_bar(10.0, datetime(2024, 1, 1, 0, 0, 0)),
                _timed_bar(11.0, last_bar_time),
            ]
        )
    )
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    # RSI/ATR display reads (_latest_indicator) are best-effort; a `.result` that iterates empty.
    ind.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=[]))

    # An in-window buy at conviction 0.8 whose validity window straddles the last bar's time, so
    # the blend actually contributes (compute_signal_score → (0.8+1)/2 = 0.9).
    sig = ingest_pb2.ExternalSignal(source="fundamentals", direction="buy", conviction=0.8)
    sig.valid_from.FromDatetime(datetime(2023, 12, 1, 0, 0, 0))
    sig.valid_until.FromDatetime(datetime(2024, 2, 1, 0, 0, 0))
    ingest = AsyncMock()
    ingest.QuerySignals = AsyncMock(return_value=ingest_pb2.QuerySignalsResponse(signals=[sig]))

    engine = make_engine(md, ind, ingest=ingest)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AARD", "BABA", "WLTH"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
        signal_sources=["fundamentals"],
        signal_weight=1.0,
        technical_weight=0.0,
    )

    resp = await engine.screen(req)  # RED pre-fix: AttributeError: timestamp escapes here.

    assert len(resp.results) == 3
    for r in resp.results:
        assert r.status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    # Positive "blend actually ran" assertion (design round-2 constraint): with signal_weight=1 and
    # technical_weight=0, combine_score returns the signal_score verbatim, so an in-window buy at
    # 0.8 lands the final score at 0.9 — materially off the 0.5 neutral default the blend falls back
    # to when no signal is in-window. A future earlier-return that never reached scoring.py would
    # leave 0.5 here, failing this assertion (so it can't pass without exercising the fixed line).
    for r in resp.results:
        assert r.score == pytest.approx(0.9)


# ── FR-4 (feature 176) — the per-symbol fan-out is now concurrent, and the formula-eval
#    semaphore actually binds it (the old serial loop left the sem inert). ──────────────


async def test_formula_evals_bounded_by_semaphore():
    """AC-4 (teeth): 12 symbols scanned concurrently, but peak in-flight ExecuteFormula is EXACTLY
    the configured analysis.screener.max_concurrent_formula_evals (4) — the _sem now binds the
    fan-out. The serial pre-176 loop peaked at 1."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    in_flight = 0
    peak = 0
    lock = asyncio.Lock()

    async def _blocking_exec(req, metadata=None):
        nonlocal in_flight, peak
        async with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        await asyncio.sleep(0.02)
        async with lock:
            in_flight -= 1
        return formula_resp([0.5])

    ind.ExecuteFormula = AsyncMock(side_effect=_blocking_exec)
    engine = make_engine(
        md, ind, cfg=make_cfg(**{"analysis.screener.max_concurrent_formula_evals": 4})
    )

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=[f"S{i}" for i in range(12)],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)

    assert len(resp.results) == 12  # every symbol scored
    assert peak == 4


async def test_screen_ranking_unchanged_by_concurrent_fanout():
    """AC-4: the concurrent fan-out yields the same ranked set a serial scan would — distinct
    per-symbol formula values still rank descending after min-max normalization (regression guard
    that gather did not scramble the per-symbol assignment)."""
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(
        side_effect=[formula_resp([0.1]), formula_resp([0.9]), formula_resp([0.5])]
    )
    engine = make_engine(md, ind)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "BBB", "CCC"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    resp = await engine.screen(req)

    assert [r.symbol for r in resp.results] == ["BBB", "CCC", "AAA"]  # 0.9 > 0.5 > 0.1


# ── feature 245: per-symbol evaluation isolation ──────────────────────────────────────────────
# One symbol's non-RPC exception degrades only its own row (status OK, passed=false,
# score_unavailable=true, empty raws); CancelledError still propagates (FR-2).

_SIG_FROM = datetime(2023, 12, 1, 0, 0, 0)
_SIG_UNTIL = datetime(2024, 2, 1, 0, 0, 0)
_BAR_DAYS = [datetime(2024, 1, d, 0, 0, 0) for d in (1, 2, 3)]


def _in_window_signal(direction, conviction):
    sig = ingest_pb2.ExternalSignal(
        source="fundamentals", direction=direction, conviction=conviction
    )
    sig.valid_from.FromDatetime(_SIG_FROM)
    sig.valid_until.FromDatetime(_SIG_UNTIL)
    return sig


def _isolation_fixture(symbols, bad="BAD"):
    """Per-symbol data keyed by symbol name (never list position), so a shared symbol gets
    identical data in the 49- and 50-symbol runs. BAD carries the sentinel last close 999.0."""

    def _index(symbol):
        return 99 if symbol == bad else int(symbol[1:])

    def _get_bars(req, metadata=None):
        base = 10.0 + _index(req.symbol)
        closes = [base, base + 1, 999.0 if req.symbol == bad else base + 2]
        return SimpleNamespace(bars=[_timed_bar(c, d) for c, d in zip(closes, _BAR_DAYS)])

    def _compute_indicator(req, metadata=None):
        return SimpleNamespace(result=[SimpleNamespace(value=req.values[-1] / 10.0)])

    def _query_signals(req, metadata=None):
        conviction = 0.95 if req.symbol == bad else 0.1 + 0.01 * _index(req.symbol)
        return ingest_pb2.QuerySignalsResponse(signals=[_in_window_signal("buy", conviction)])

    md = AsyncMock()
    md.GetBars = AsyncMock(side_effect=_get_bars)
    ind = AsyncMock()
    ind.ComputeIndicator = AsyncMock(side_effect=_compute_indicator)
    ingest = AsyncMock()
    ingest.QuerySignals = AsyncMock(side_effect=_query_signals)
    sig = analysis_pb2.ScreenCriterion(
        ref_name="sig",
        kind=analysis_pb2.SCREEN_KIND_SIGNAL,
        op=analysis_pb2.COMPARATOR_GT,
        threshold=0.0,
    )
    rsi = analysis_pb2.ScreenCriterion(
        ref_name="rsi",
        kind=analysis_pb2.SCREEN_KIND_TECHNICAL_INDICATOR,
        component=analysis_pb2.StrategyComponent(indicator="RSI"),
        op=analysis_pb2.COMPARATOR_GT,
        threshold=0.0,
    )
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=symbols,
        criteria=[sig, rsi],
        signal_sources=["fundamentals"],
        signal_weight=1.0,
        technical_weight=1.0,
        rank_limit=50,
    )
    return md, ind, ingest, req


def _patch_compute_signal_score_raising_on_sentinel(monkeypatch, exc):
    original = screener_mod.scoring.compute_signal_score

    def _raising(signals_map, latest_bar, signal_sources, source_weights=None):
        if latest_bar.close == 999.0:
            raise exc("boom")
        return original(signals_map, latest_bar, signal_sources, source_weights)

    monkeypatch.setattr(screener_mod.scoring, "compute_signal_score", _raising)


def _patch_technical_value_raising_for(monkeypatch, exc, should_raise):
    original = ScreenerEngine._technical_value

    async def _raising(self, criterion, symbol, closes, propagation_meta):
        if should_raise(symbol):
            raise exc("boom")
        return await original(self, criterion, symbol, closes, propagation_meta)

    monkeypatch.setattr(ScreenerEngine, "_technical_value", _raising)


def _patch_latest_indicator_raising_on_sentinel(monkeypatch, exc):
    original = ScreenerEngine._latest_indicator

    async def _raising(self, indicator, closes, propagation_meta):
        if closes and closes[-1] == 999.0:
            raise exc("boom")
        return await original(self, indicator, closes, propagation_meta)

    monkeypatch.setattr(ScreenerEngine, "_latest_indicator", _raising)


@pytest.mark.parametrize(
    ("site", "exc"),
    [
        ("compute_signal_score", ZeroDivisionError),
        ("_technical_value", ArithmeticError),
        ("_latest_indicator", ValueError),
    ],
)
async def test_one_symbol_failure_degrades_only_its_row(caplog, monkeypatch, site, exc):
    """@AC-1: BAD's evaluation fault degrades only BAD's row; the other 49 rows equal a 49-symbol
    run without BAD, BAD ranks last, and exactly one WARN line names it."""
    others = [f"S{i:02d}" for i in range(49)]
    md, ind, ingest, req_49 = _isolation_fixture(others)
    baseline = await make_engine(md, ind, ingest=ingest).screen(req_49)

    if site == "compute_signal_score":
        _patch_compute_signal_score_raising_on_sentinel(monkeypatch, exc)
    elif site == "_technical_value":
        _patch_technical_value_raising_for(monkeypatch, exc, lambda s: s == "BAD")
    else:
        _patch_latest_indicator_raising_on_sentinel(monkeypatch, exc)

    md, ind, ingest, req_50 = _isolation_fixture(others + ["BAD"])
    with caplog.at_level(logging.WARNING, logger="app.services.screener"):
        resp = await make_engine(md, ind, ingest=ingest).screen(req_50)

    assert {r.symbol: r for r in resp.results if r.symbol != "BAD"} == {
        r.symbol: r for r in baseline.results
    }
    bad = next(r for r in resp.results if r.symbol == "BAD")
    assert bad.status == analysis_pb2.SCREEN_RESULT_STATUS_OK
    assert bad.passed is False
    assert bad.score_unavailable is True
    assert dict(bad.criterion_scores) == {}
    assert resp.results[-1].symbol == "BAD"
    assert len(resp.results) == 50
    recs = [r for r in caplog.records if r.levelno == logging.WARNING and "BAD" in r.getMessage()]
    assert len(recs) == 1
    assert f"BAD:{exc.__name__}" in recs[0].getMessage()


async def test_cancelled_error_in_symbol_eval_propagates(monkeypatch):
    """FR-2 (@AC-2, engine level): a CancelledError from one symbol's evaluation is never absorbed
    into a degraded row; it aborts screen() so the servicer deadline still fires."""

    async def _eval(self, symbol, *args):
        if symbol == "CXL":
            raise asyncio.CancelledError()
        return {"symbol": symbol}

    monkeypatch.setattr(ScreenerEngine, "_eval_symbol", _eval)
    engine = make_engine(AsyncMock(), AsyncMock())
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["CXL", "OK1"],
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    with pytest.raises(asyncio.CancelledError):
        await engine.screen(req)


def _soft_formula_fixture(symbols):
    md = AsyncMock()
    md.GetBars = AsyncMock(return_value=bars([1.0, 2.0, 3.0]))
    ind = AsyncMock()
    ind.ExecuteFormula = AsyncMock(return_value=formula_resp([0.5]))
    ind.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=[]))
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=symbols,
        criteria=[formula_criterion("f1", "fid", analysis_pb2.COMPARATOR_GT, 0.0)],
    )
    return md, ind, req


async def test_degraded_row_soft_only_criteria_is_not_passed(monkeypatch):
    """A soft-only scan never reports an evaluation-fault row as passed (it must not reach the
    `passed = True` default in _build_result)."""
    md, ind, req = _soft_formula_fixture(["AAA", "BAD"])
    _patch_technical_value_raising_for(monkeypatch, RuntimeError, lambda s: s == "BAD")

    resp = await make_engine(md, ind).screen(req)

    by_symbol = {r.symbol: r for r in resp.results}
    assert by_symbol["BAD"].passed is False
    assert by_symbol["BAD"].score_unavailable is True
    assert by_symbol["AAA"].passed is True
    assert by_symbol["AAA"].score_unavailable is False


async def test_all_symbols_failed_logs_error_not_warning(caplog, monkeypatch):
    md, ind, req = _soft_formula_fixture(["B1", "B2"])
    _patch_technical_value_raising_for(monkeypatch, RuntimeError, lambda s: True)

    with caplog.at_level(logging.WARNING, logger="app.services.screener"):
        resp = await make_engine(md, ind).screen(req)

    assert len(resp.results) == 2
    for r in resp.results:
        assert r.passed is False
        assert r.score_unavailable is True
    errors = [
        r
        for r in caplog.records
        if r.levelno == logging.ERROR and "2/2 scanned symbols failed evaluation" in r.getMessage()
    ]
    assert len(errors) == 1
    assert not [
        r
        for r in caplog.records
        if r.levelno == logging.WARNING and "failed evaluation" in r.getMessage()
    ]


async def test_degraded_row_sorts_after_feature144_zero_score_row(monkeypatch):
    """An evaluation-fault row sorts after a feature-144 score-unavailable row although both score
    exactly 0.0. BAD is listed first, so only the eval_failed sort key can put it last."""

    def _get_bars(req, metadata=None):
        last = 999.0 if req.symbol == "BAD" else 11.0
        return SimpleNamespace(
            bars=[_timed_bar(10.0, _BAR_DAYS[0]), _timed_bar(last, _BAR_DAYS[1])]
        )

    signals = {
        "GOOD": _in_window_signal("buy", 0.8),
        "NODATA": _in_window_signal("sell", 1.0),
        "BAD": _in_window_signal("buy", 0.5),
    }
    md = AsyncMock()
    md.GetBars = AsyncMock(side_effect=_get_bars)
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(
            fundamentals=[
                marketdata_pb2.Fundamentals(symbol="GOOD", pe_ratio=15.0),
                marketdata_pb2.Fundamentals(symbol="NODATA", missing_metrics=["pe_ratio"]),
                marketdata_pb2.Fundamentals(symbol="BAD", pe_ratio=15.0),
            ]
        )
    )
    ind = AsyncMock()
    ind.ComputeIndicator = AsyncMock(return_value=SimpleNamespace(result=[]))
    ingest = AsyncMock()
    ingest.QuerySignals = AsyncMock(
        side_effect=lambda req, metadata=None: ingest_pb2.QuerySignalsResponse(
            signals=[signals[req.symbol]]
        )
    )
    _patch_compute_signal_score_raising_on_sentinel(monkeypatch, ZeroDivisionError)

    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["BAD", "NODATA", "GOOD"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="cheap",
                kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                metric_name="pe_ratio",
                op=analysis_pb2.COMPARATOR_LT,
                threshold=20.0,
            )
        ],
        signal_sources=["fundamentals"],
        signal_weight=1.0,
        technical_weight=0.0,
    )
    resp = await make_engine(md, ind, ingest=ingest).screen(req)

    assert [r.symbol for r in resp.results] == ["GOOD", "NODATA", "BAD"]
    assert resp.results[1].score_unavailable is True
    assert resp.results[1].score == pytest.approx(0.0)


async def test_duplicate_symbol_healthy_copy_ranks_by_score(monkeypatch):
    closes = {"AAA": [1.0, 2.0, 3.0], "DUP": [1.0, 2.0, 5.0]}
    md = AsyncMock()
    md.GetBars = AsyncMock(side_effect=lambda req, metadata=None: bars(closes[req.symbol]))
    ind = AsyncMock()
    ind.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=req.values[-1] / 10.0)]
        )
    )
    original = ScreenerEngine._eval_symbol
    dup_calls = 0

    async def _eval(self, symbol, *args):
        nonlocal dup_calls
        if symbol == "DUP":
            dup_calls += 1
            if dup_calls == 1:
                raise RuntimeError("boom")
        return await original(self, symbol, *args)

    monkeypatch.setattr(ScreenerEngine, "_eval_symbol", _eval)
    req = analysis_pb2.ScreenSymbolsRequest(
        symbols=["AAA", "DUP", "DUP"],
        criteria=[
            analysis_pb2.ScreenCriterion(
                ref_name="rsi",
                kind=analysis_pb2.SCREEN_KIND_TECHNICAL_INDICATOR,
                component=analysis_pb2.StrategyComponent(indicator="RSI"),
                op=analysis_pb2.COMPARATOR_GT,
                threshold=0.0,
            )
        ],
    )
    resp = await make_engine(md, ind).screen(req)

    dups = [r for r in resp.results if r.symbol == "DUP"]
    assert [r.score_unavailable for r in dups].count(True) == 1
    assert resp.results[-1].symbol == "DUP"
    assert resp.results[-1].score_unavailable is True
    healthy = list(resp.results[:2])
    assert all(r.score_unavailable is False for r in healthy)
    # DUP's higher RSI reading ranks its healthy copy above AAA by -score.
    assert [r.symbol for r in healthy] == ["DUP", "AAA"]
    assert healthy[0].score > healthy[1].score


async def test_degraded_count_lands_on_current_span(monkeypatch):
    md, ind, req = _soft_formula_fixture(["AAA", "BAD"])
    _patch_technical_value_raising_for(monkeypatch, RuntimeError, lambda s: s == "BAD")
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    with provider.get_tracer("t").start_as_current_span("server"):
        await asyncio.wait_for(make_engine(md, ind).screen(req), timeout=5)

    (span,) = [s for s in exporter.get_finished_spans() if s.name == "server"]
    assert span.attributes["screener.degraded_count"] == 1
    assert [e.name for e in span.events] == ["exception"]
