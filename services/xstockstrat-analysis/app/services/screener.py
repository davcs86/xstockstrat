"""Screener engine (feature 060).

Screens a symbol universe against weighted criteria and returns ranked results. It reuses
the pure scoring module (``app.services.scoring``) so a symbol's signal blend is computed
identically to a backtest (FR-4), calls ``ExecuteFormula`` exactly as a backtest formula
would (FR-3), and never injects signals/fundamentals into the indicators sandbox. It does
NOT touch ``RunBacktest``/``ScoreStrategy`` (FR-8).

Fundamental criteria consume marketdata's cached ``GetFundamentalsMulti`` (feature 059). When
that RPC is unavailable — FMP disabled by default (``FailedPrecondition``), quota-exhausted, or
the method absent — those criteria are reported **skipped** (absent from ``criterion_scores``,
never failing the scan), satisfying FR-5's graceful degradation.
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

# Fundamental metric_name → attribute on the marketdata Fundamentals message (feature 059).
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
        symbols = list(request.symbols)[:max_universe]  # OQ-060-d: truncate over-cap

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

        # Evaluate every symbol; collect raw per-criterion values for universe normalization.
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

        # FR-6: min-max normalize each criterion's raw values across the scanned universe.
        norm = self._normalize_universe(criteria, per_symbol)

        results = []
        for row in per_symbol:
            results.append(self._build_result(row, criteria, request, norm))

        # Rank descending by score; cap to rank_limit (default config).
        results.sort(key=lambda r: r.score, reverse=True)
        rank_limit = request.rank_limit or self._cfg.get_int(
            "analysis.screener.default_rank_limit", 50
        )
        if rank_limit > 0:
            results = results[:rank_limit]

        coverage_gaps = [
            r.gap
            for r in results
            if r.status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
        ]
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
        }

        # 1. Bars (latest window) for technical criteria.
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

        # 2. Signals for the source-weighted blend (same path as backtest).
        signals_map = await self._fetch_signals(symbol, request, propagation_meta)
        if signals_map:
            latest_bar = bars_resp.bars[-1] if closes else None
            if latest_bar is not None:
                row["signal_score"] = scoring.compute_signal_score(
                    signals_map, latest_bar, list(request.signal_sources), self._source_weights
                )

        # 3. Per-criterion raw values + hard-filter gating.
        for c in criteria:
            if c.kind in _FUNDAMENTAL_KINDS:
                if not fundamentals_available:
                    continue  # skipped (FR-5) — absent from raws/passes
                raw = self._fundamental_value(fundamentals.get(symbol.upper()), c.metric_name)
                if raw is None:
                    continue  # metric missing → skipped
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
        return row

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
            # MessageToDict recursively converts the Struct (incl. ListValue) to native
            # python — dict(Struct) leaves a list output as a ListValue.
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
    def _fundamental_value(fund, metric_name):
        if fund is None or not metric_name:
            return None
        if metric_name in _FUNDAMENTAL_FIELDS:
            return float(getattr(fund, metric_name))
        # Fall back to the open-ended extra_metrics map.
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
            return analysis_pb2.ScreenResult(
                symbol=row["symbol"],
                status=row["status"],
                gap=row["gap"],
                passed=False,
            )

        criterion_scores = {}
        weighted_sum = 0.0
        weight_total = 0.0
        passed = True
        signal_sub = row["signal_score"]

        for c in criteria:
            if c.ref_name not in row["raws"]:
                continue  # skipped
            sub = norm.get(c.ref_name, {}).get(row["symbol"], 0.5)
            criterion_scores[c.ref_name] = sub
            w = c.weight if c.weight > 0 else 1.0
            weighted_sum += w * sub
            weight_total += w
            if c.hard_filter and not row["passes"].get(c.ref_name, False):
                passed = False

        technical_score = weighted_sum / weight_total if weight_total > 0 else 0.5

        # Blend technical + signal exactly as a backtest does (FR-4). Map the technical
        # aggregate [0,1] → tech_signal [-1,1] so combine_score recovers a clean weighted blend.
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
            passed=passed,
            status=analysis_pb2.SCREEN_RESULT_STATUS_OK,
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
