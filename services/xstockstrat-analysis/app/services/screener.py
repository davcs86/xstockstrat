"""Screener engine (feature 060).

Screens a symbol universe against weighted criteria and returns ranked results. It reuses
the pure scoring module (``app.services.scoring``) so a symbol's signal blend is computed
identically to a backtest (FR-4), calls ``ExecuteFormula`` exactly as a backtest formula
would (FR-3), and never injects signals/fundamentals into the indicators sandbox. It does
NOT touch ``RunBacktest``/``ScoreStrategy`` (FR-8).

Fundamental criteria consume marketdata's cached ``GetFundamentalsMulti`` (feature 059). When
that RPC is unavailable — FMP disabled by default (``FailedPrecondition``), quota-exhausted, or
the method absent — a symbol needing a fundamental criterion is reported
``SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`` (``passed=False``, no score) rather than a misleading
``OK``/passed result: a hard filter can never be confirmed passing on data that was never
fetched, and a criterion silently missing from ``criterion_scores`` with no other signal made the
whole screen look inert to the caller (bug fix — previously this degraded *too* gracefully: the
scan always reported OK/passed=true regardless of whether any fundamental criterion was ever
evaluated). The same fail-closed rule applies per-symbol when fundamentals were fetched for the
batch but a specific symbol's value is still missing (e.g. FMP omitted that symbol, or the metric
is an ``extra_metrics`` key that symbol doesn't carry): a hard-filter criterion with no raw value
never silently passes.

A *known* field (``_FUNDAMENTAL_FIELDS``) that is present for the symbol but individually
missing from the provider (e.g. ``dividend_yield`` never fetched because the extended metric
tier was off) is also fail-closed rather than read as its wire-default ``0.0`` (bug fix — a
known field has no wire presence, so the marketdata proto instead marks per-field absence via
``Fundamentals.missing_metrics``; ``_fundamental_value`` checks it before reading).
"""

import asyncio
import logging

import grpc
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from gen.ingest.v1 import ingest_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.json_format import MessageToDict
from google.protobuf.struct_pb2 import Struct

from app.services import scoring

log = logging.getLogger(__name__)

# Fundamental metric_name → attribute on the marketdata Fundamentals message.
_FUNDAMENTAL_FIELDS = {
    "market_cap",
    "pe_ratio",
    "pb_ratio",
    "dividend_yield",
    "eps",
    "beta",
    "roe",
    "debt_to_equity",
    "price",
    "year_high",
    "year_low",
}

_FUNDAMENTAL_KINDS = {analysis_pb2.SCREEN_KIND_FUNDAMENTAL}
_TECHNICAL_KINDS = {
    analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
    analysis_pb2.SCREEN_KIND_TECHNICAL_INDICATOR,
}


def _comparator_passes(op, value, threshold, threshold_high) -> bool:
    if op == analysis_pb2.COMPARATOR_LT:
        return value < threshold
    if op == analysis_pb2.COMPARATOR_LTE:
        return value <= threshold
    if op == analysis_pb2.COMPARATOR_GT:
        return value > threshold
    if op == analysis_pb2.COMPARATOR_GTE:
        return value >= threshold
    if op == analysis_pb2.COMPARATOR_BETWEEN:
        return threshold <= value <= threshold_high
    return True  # UNSPECIFIED → no gating


class ScreenerEngine:
    """Stateless engine; one instance per scan. Stubs + cfg are injected for testability."""

    def __init__(self, marketdata, indicators, ingest, cfg, source_weights):
        self._marketdata = marketdata
        self._indicators = indicators
        self._ingest = ingest
        self._cfg = cfg
        self._source_weights = source_weights or {}
        self._sem = asyncio.Semaphore(
            max(1, cfg.get_int("analysis.screener.max_concurrent_formula_evals", 4))
        )

    async def screen(self, request, propagation_meta=()) -> analysis_pb2.ScreenSymbolsResponse:
        max_universe = self._cfg.get_int("analysis.screener.max_universe_size", 100)
        symbols = list(request.symbols)[:max_universe]

        criteria = list(request.criteria)
        fundamental_criteria = [c for c in criteria if c.kind in _FUNDAMENTAL_KINDS]

        # Batch-fetch fundamentals once for the whole universe (single FMP chokepoint).
        # Unavailable → every fundamental criterion is skipped (FR-5).
        fundamentals = {}
        fundamentals_available = False
        if fundamental_criteria:
            fundamentals, fundamentals_available = await self._fetch_fundamentals(
                symbols, propagation_meta
            )

        # Reject a fundamental criterion whose metric_name is neither a closed _FUNDAMENTAL_FIELDS
        # field nor any fetched symbol's extra_metrics key — only when fundamentals exist.
        if fundamental_criteria and fundamentals_available:
            self._validate_fundamental_metrics(fundamental_criteria, fundamentals)

        per_symbol = []  # list of dicts: {symbol, raws, passes, signal_score, status, gap}
        for symbol in symbols:
            per_symbol.append(
                await self._eval_symbol(
                    symbol,
                    request,
                    criteria,
                    fundamentals,
                    fundamentals_available,
                    propagation_meta,
                )
            )

        # One summarized WARN per scan for insufficient-bars symbols; excludes symbols whose GetBars
        # raised (already logged per-symbol) so an RPC failure is not double-reported.
        dataless_bars = [
            r["symbol"]
            for r in per_symbol
            if r["status"] == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
            and r["gap"] is not None
            and not r["bars_errored"]
        ]
        if dataless_bars:
            log.warning(
                "screener: %d/%d scanned symbols had insufficient 1d bars for technical "
                "criteria; sample=%s",
                len(dataless_bars),
                len(per_symbol),
                dataless_bars[:10],
            )

        # Min-max normalize each criterion's raw values across the scanned universe.
        norm = self._normalize_universe(criteria, per_symbol)

        results = []
        for row in per_symbol:
            results.append(self._build_result(row, criteria, request, norm))

        # A score_unavailable result's score is a neutral placeholder, not real evidence — sort it
        # after every genuinely-scored result so it can never outrank real data.
        results.sort(key=lambda r: (r.score_unavailable, -r.score))

        # coverage_gaps come from the FULL sorted list, BEFORE min_conviction/rank_limit truncation,
        # so a below-cut symbol still surfaces its gap; HasField skips bars-specific no-gap case.
        coverage_gaps = [
            r.gap
            for r in results
            if r.status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA and r.HasField("gap")
        ]

        # Honor min_conviction as a hard floor: r.score is a min-max normalized [0,1] conviction, so
        # filter against scoring.buy_threshold (backtest entry transform), not a raw-scale compare.
        if request.min_conviction > 0:
            thr = scoring.buy_threshold(request.min_conviction)
            results = [r for r in results if r.score >= thr]

        # Cap to rank_limit LAST — after coverage_gaps and the min_conviction floor.
        rank_limit = request.rank_limit or self._cfg.get_int(
            "analysis.screener.default_rank_limit", 50
        )
        if rank_limit > 0:
            results = results[:rank_limit]

        return analysis_pb2.ScreenSymbolsResponse(results=results, coverage_gaps=coverage_gaps)

    async def _fetch_fundamentals(self, symbols, propagation_meta):
        """Return (by_symbol_dict, available). available=False degrades fundamentals to skipped."""
        getter = getattr(self._marketdata, "GetFundamentalsMulti", None)
        if getter is None:
            return {}, False
        try:
            resp = await getter(
                marketdata_pb2.GetFundamentalsMultiRequest(symbols=symbols),
                metadata=propagation_meta,
            )
        except grpc.RpcError as e:
            # FMP disabled (FailedPrecondition), quota exhausted, or unavailable → skip (FR-5).
            log.info("fundamentals unavailable, skipping fundamental criteria: %s", e)
            return {}, False
        by_symbol = {}
        for f in resp.fundamentals:
            by_symbol[f.symbol.upper()] = f
        return by_symbol, True

    async def _eval_symbol(
        self, symbol, request, criteria, fundamentals, fundamentals_available, propagation_meta
    ):
        row = {
            "symbol": symbol,
            "raws": {},  # ref_name -> raw numeric value (only for evaluated criteria)
            "passes": {},  # ref_name -> bool (hard-filter gate result)
            "signal_score": 0.5,
            "status": analysis_pb2.SCREEN_RESULT_STATUS_OK,
            "gap": None,
            # True when GetBars raised; kept out of the missing-data summary to avoid a double-log.
            "bars_errored": False,
        }

        closes = []
        try:
            bars_resp = await self._marketdata.GetBars(
                marketdata_pb2.GetBarsRequest(
                    symbol=symbol,
                    timeframe="1d",
                    timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                ),
                metadata=propagation_meta,
            )
            closes = [b.close for b in bars_resp.bars]
        except grpc.RpcError as e:
            log.warning("GetBars failed for %s: %s", symbol, e)
            row["bars_errored"] = True

        needs_technical = any(c.kind in _TECHNICAL_KINDS for c in criteria)
        if needs_technical and len(closes) < 2:
            row["status"] = analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
            row["gap"] = analysis_pb2.CoverageGap(
                symbol=symbol,
                timeframe=common_pb2.Timeframe.TIMEFRAME_1DAY,
                bars_have=len(closes),
                bars_need=2,
            )
            return row

        # A requested fundamental criterion with a failed/disabled batch fetch bails like the bars
        # case, rather than scoring on zero criteria and reporting OK/passed. No CoverageGap here.
        needs_fundamentals = any(c.kind in _FUNDAMENTAL_KINDS for c in criteria)
        if needs_fundamentals and not fundamentals_available:
            row["status"] = analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
            return row

        # Signals for the source-weighted blend (same path as backtest).
        signals_map = await self._fetch_signals(symbol, request, propagation_meta)
        if signals_map:
            latest_bar = bars_resp.bars[-1] if closes else None
            if latest_bar is not None:
                row["signal_score"] = scoring.compute_signal_score(
                    signals_map, latest_bar, list(request.signal_sources), self._source_weights
                )

        # Per-criterion raw values + hard-filter gating. needs_fundamentals already guaranteed
        # fundamentals_available above when any FUNDAMENTAL criterion is present.
        for c in criteria:
            if c.kind in _FUNDAMENTAL_KINDS:
                raw = self._fundamental_value(fundamentals.get(symbol.upper()), c.metric_name)
                if raw is None:
                    continue  # this symbol's value missing → skipped
            elif c.kind in _TECHNICAL_KINDS:
                raw = await self._technical_value(c, symbol, closes, propagation_meta)
                if raw is None:
                    continue
            elif c.kind == analysis_pb2.SCREEN_KIND_SIGNAL:
                raw = row["signal_score"]
            else:
                continue

            row["raws"][c.ref_name] = raw
            row["passes"][c.ref_name] = _comparator_passes(c.op, raw, c.threshold, c.threshold_high)

        # Raw display columns for the results table, best-effort. ATR is a close-only approximation
        # (indicators_engine.py) — surfaced as a known accuracy caveat, not exact.
        fund = fundamentals.get(symbol.upper()) if fundamentals_available else None
        row["pe"] = float(getattr(fund, "pe_ratio", 0.0)) if fund is not None else 0.0
        row["rev_growth"] = self._extra_metric(fund, "revenue_growth")
        row["rsi"] = await self._latest_indicator("RSI", closes, propagation_meta)
        row["atr"] = await self._latest_indicator("ATR", closes, propagation_meta)
        return row

    async def _latest_indicator(self, indicator, closes, propagation_meta) -> float:
        """Latest value of a built-in indicator over closes, best-effort (0.0 on failure)."""
        if len(closes) < 2:
            return 0.0
        try:
            resp = await self._indicators.ComputeIndicator(
                indicators_pb2.ComputeIndicatorRequest(
                    indicator=indicator, values=list(closes), params={}, timeframe="1d"
                ),
                metadata=propagation_meta,
            )
        except grpc.RpcError as e:
            log.warning("latest %s failed: %s", indicator, e)
            return 0.0
        vals = [p.value for p in resp.result if p.value != 0]
        return vals[-1] if vals else 0.0

    @staticmethod
    def _extra_metric(fund, key) -> float:
        """Best-effort read of an open-ended Fundamentals.extra_metrics value (0.0 when absent)."""
        if fund is None:
            return 0.0
        try:
            return float(fund.extra_metrics.get(key, 0.0))
        except (TypeError, ValueError):
            return 0.0

    async def _fetch_signals(self, symbol, request, propagation_meta):
        if not request.signal_sources or request.signal_weight <= 0:
            return {}
        signals_map = {}
        try:
            sig_resp = await self._ingest.QuerySignals(
                ingest_pb2.QuerySignalsRequest(symbol=symbol),
                metadata=propagation_meta,
            )
            for sig in sig_resp.signals:
                if sig.source in request.signal_sources:
                    signals_map.setdefault(sig.source, []).append(sig)
        except grpc.RpcError as e:
            log.warning("QuerySignals failed for %s: %s", symbol, e)
        return signals_map

    async def _technical_value(self, criterion, symbol, closes, propagation_meta):
        """Latest value of a formula (ExecuteFormula, FR-3) or built-in indicator."""
        comp = criterion.component
        if comp.formula_id:
            async with self._sem:  # bound concurrent evals (OQ-060-d)
                input_data = Struct()
                input_data.update({"close": list(closes)})
                input_params = Struct()
                if comp.params:
                    input_params.update(dict(comp.params))
                try:
                    resp = await self._indicators.ExecuteFormula(
                        indicators_pb2.ExecuteFormulaRequest(
                            formula_id=comp.formula_id,
                            input_data=input_data,
                            input_params=input_params,
                        ),
                        metadata=propagation_meta,
                    )
                except grpc.RpcError as e:
                    log.warning("ExecuteFormula failed for %s/%s: %s", symbol, comp.formula_id, e)
                    return None
            if not resp.success:
                return None
            # MessageToDict decodes the Struct; dict(Struct) leaves a list as a ListValue.
            return _latest_value(MessageToDict(resp.output).get("value"))
        if comp.indicator:
            try:
                resp = await self._indicators.ComputeIndicator(
                    indicators_pb2.ComputeIndicatorRequest(
                        indicator=comp.indicator,
                        values=list(closes),
                        params=dict(comp.params),
                        symbol=symbol,
                        timeframe="1d",
                    ),
                    metadata=propagation_meta,
                )
            except grpc.RpcError as e:
                log.warning("ComputeIndicator failed for %s/%s: %s", symbol, comp.indicator, e)
                return None
            vals = [p.value for p in resp.result if p.value != 0]
            return vals[-1] if vals else None
        return None

    @staticmethod
    def _validate_fundamental_metrics(fundamental_criteria, fundamentals):
        """feature 090: raise ValueError on a fundamental metric_name that is neither a closed
        `_FUNDAMENTAL_FIELDS` field nor an `extra_metrics` key any fetched symbol carries.

        Residual (documented in design.md): because `extra_metrics` is open-ended, a *legitimate*
        open metric that no scanned symbol happens to carry is indistinguishable from a typo and
        also raises here — honest, since such a criterion can score no symbol in this scan.
        """
        known = set(_FUNDAMENTAL_FIELDS)
        for fund in fundamentals.values():
            known.update(fund.extra_metrics.keys())
        for c in fundamental_criteria:
            if c.metric_name and c.metric_name not in known:
                raise ValueError(
                    f"unknown fundamental metric_name '{c.metric_name}' "
                    f"(not a known field and absent from every scanned symbol's extra_metrics)"
                )

    @staticmethod
    def _fundamental_value(fund, metric_name):
        if fund is None or not metric_name:
            return None
        if metric_name in _FUNDAMENTAL_FIELDS:
            # A known field has no wire presence; check missing_metrics first. Else a missing
            # value's wire-default 0.0 reads as a real 0.0 and an lte hard filter silently passes.
            if metric_name in fund.missing_metrics:
                return None
            return float(getattr(fund, metric_name))
        if metric_name in fund.extra_metrics:
            return float(fund.extra_metrics[metric_name])
        return None

    def _normalize_universe(self, criteria, per_symbol):
        """Direction-aware min-max normalization of each criterion across the universe (FR-6)."""
        norm = {}  # ref_name -> {symbol -> normalized [0,1]}
        for c in criteria:
            vals = {
                row["symbol"]: row["raws"][c.ref_name]
                for row in per_symbol
                if c.ref_name in row["raws"]
            }
            if not vals:
                continue
            lo = min(vals.values())
            hi = max(vals.values())
            per = {}
            for sym, raw in vals.items():
                if hi == lo:
                    base = 0.5
                else:
                    base = (raw - lo) / (hi - lo)
                # Lower-is-better comparators invert the ranking contribution.
                if c.op in (analysis_pb2.COMPARATOR_LT, analysis_pb2.COMPARATOR_LTE):
                    base = 1.0 - base
                elif c.op == analysis_pb2.COMPARATOR_BETWEEN:
                    base = (
                        1.0 if _comparator_passes(c.op, raw, c.threshold, c.threshold_high) else 0.0
                    )
                per[sym] = base
            norm[c.ref_name] = per
        return norm

    def _build_result(self, row, criteria, request, norm):
        if row["status"] == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA:
            result = analysis_pb2.ScreenResult(
                symbol=row["symbol"],
                status=row["status"],
                passed=False,
            )
            if row["gap"] is not None:
                result.gap.CopyFrom(row["gap"])
            return result

        criterion_scores = {}
        # Raw readings + pass/fail per criterion, for single-symbol screening where the relative
        # criterion_scores collapse to 0.5. Present only for evaluated criteria.
        criterion_raw_values = {}
        criterion_passed = {}
        weighted_sum = 0.0
        weight_total = 0.0
        passed = True
        signal_sub = row["signal_score"]

        for c in criteria:
            if c.ref_name not in row["raws"]:
                # Skipped (value unavailable): never scored, and a hard filter can't be confirmed
                # on data never evaluated, so fail closed rather than silently passing.
                if c.hard_filter:
                    passed = False
                continue
            sub = norm.get(c.ref_name, {}).get(row["symbol"], 0.5)
            criterion_scores[c.ref_name] = sub
            criterion_raw_values[c.ref_name] = row["raws"][c.ref_name]
            criterion_passed[c.ref_name] = row["passes"].get(c.ref_name, False)
            w = c.weight if c.weight > 0 else 1.0
            weighted_sum += w * sub
            weight_total += w
            if c.hard_filter and not row["passes"].get(c.ref_name, False):
                passed = False

        # weight_total==0 means every criterion was skipped for THIS candidate (not a zero-criteria
        # scan); the 0.5 fallback still feeds combine_score but is flagged score_unavailable.
        score_unavailable = weight_total <= 0 and len(criteria) > 0
        technical_score = weighted_sum / weight_total if weight_total > 0 else 0.5

        # Blend technical + signal exactly as a backtest does. Map the [0,1] aggregate → tech_signal
        # [-1,1] so combine_score recovers a clean weighted blend.
        tech_signal = 2.0 * technical_score - 1.0
        score = scoring.combine_score(
            tech_signal,
            signal_sub,
            request.signal_weight,
            request.technical_weight,
            signals_present=bool(request.signal_sources) and request.signal_weight > 0,
        )

        return analysis_pb2.ScreenResult(
            symbol=row["symbol"],
            score=score,
            criterion_scores=criterion_scores,
            criterion_raw_values=criterion_raw_values,
            criterion_passed=criterion_passed,
            passed=passed,
            status=analysis_pb2.SCREEN_RESULT_STATUS_OK,
            score_unavailable=score_unavailable,
            # Raw display columns; held is set by the servicer cross-ref.
            pe=row.get("pe", 0.0),
            rsi=row.get("rsi", 0.0),
            atr=row.get("atr", 0.0),
            rev_growth=row.get("rev_growth", 0.0),
        )


def _latest_value(series):
    """Return the last non-None value of a formula's `value` output (list or scalar)."""
    if series is None:
        return None
    if isinstance(series, (list, tuple)):
        for v in reversed(series):
            if v is not None:
                return float(v)
        return None
    try:
        return float(series)
    except (TypeError, ValueError):
        return None
