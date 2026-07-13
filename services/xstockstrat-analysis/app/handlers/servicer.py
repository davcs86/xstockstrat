"""
AnalysisServicer — strategy backtesting and scoring.

RunBacktest implements a real SMA crossover engine that:
  1. Fetches OHLCV bars from xstockstrat-marketdata
  2. Computes SMA indicators via xstockstrat-indicators
  3. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies
  4. Simulates trades bar-by-bar and computes performance metrics

ScoreStrategy grades backtests using Sharpe ratio, max drawdown, and win rate.
"""

import asyncio
import hashlib
import json
import logging
import math
import uuid

import grpc
import numpy as np
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.notify.v1 import notify_pb2_grpc
from gen.portfolio.v1 import portfolio_pb2_grpc
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.repositories.backtest_run_symbols import BacktestRunSymbolsRepository
from app.repositories.backtest_runs import BacktestRunsRepository
from app.repositories.strategies import StrategiesRepository
from app.repositories.strategy_scores import StrategyScoresRepository
from app.services import scoring
from app.services.evaluator import StrategyEvaluator, _validate_definition, referenced_refs
from app.services.screener import ScreenerEngine

# Backward-compat alias: the source-weighted signal math moved to app.services.scoring
# (feature 060). Re-exported so existing imports of `_compute_signal_score` from this
# module stay valid.
_compute_signal_score = scoring.compute_signal_score

log = logging.getLogger(__name__)


class _InsufficientData(Exception):
    """Raised by a per-symbol backtest when there are too few bars to run it.

    Carries the data needed to build an ``analysis_pb2.CoverageGap`` instead of silently
    fabricating a flat-equity "success" (feature 053, FR-2 / AC-2).
    """

    def __init__(self, symbol: str, bars_have: int, bars_need: int):
        super().__init__(f"{symbol}: have {bars_have} bars, need {bars_need}")
        self.symbol = symbol
        self.bars_have = bars_have
        self.bars_need = bars_need


class AnalysisServicer(analysis_pb2_grpc.AnalysisServiceServicer):
    def __init__(
        self,
        config_watcher: ConfigWatcher,
        marketdata_channel,
        indicators_channel,
        ingest_channel,
        ledger_channel,
        db_pool=None,
        notify_channel=None,
        portfolio_channel=None,
    ):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._indicators = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)
        self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None
        # Portfolio stub (feature 062) — used by the fundamentals signal producer for the
        # watchlist universe read. nil when PORTFOLIO_ENDPOINT is not wired (tests).
        self._portfolio = (
            portfolio_pb2_grpc.PortfolioServiceStub(portfolio_channel)
            if portfolio_channel
            else None
        )
        self._backtests: dict[str, analysis_pb2.BacktestResult] = {}
        self._strategies: dict[str, analysis_pb2.StrategyScore] = {}
        self._strategies_repo = StrategiesRepository(db_pool) if db_pool else None
        # Durable backup for the in-memory _strategies dict (feature 064). Reads stay
        # in-memory; this persists on score and hydrates it at boot. None in the no-DB
        # test path so make_servicer()-based tests are unaffected.
        self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None
        # Durable backtest-run history (fixes "cannot see past run results"). RunBacktest
        # appends a summary row here; the ListBacktests RPC reads it back. None in the no-DB
        # test path so make_servicer()-based tests are unaffected.
        self._backtest_runs_repo = BacktestRunsRepository(db_pool) if db_pool else None
        # Per-symbol evidence cells for the derived headline grade (feature 065). RunBacktest
        # buffers one cell per symbol on an OK run and flushes here; _recompute_headline reads
        # them back. None in the no-DB test path.
        self._backtest_run_symbols_repo = BacktestRunSymbolsRepository(db_pool) if db_pool else None
        # Per-strategy recompute serialization (feature 065). asyncio.Lock is non-reentrant, so
        # a trigger already holding the lock calls only _recompute_headline_locked. Single-process
        # protection only (documented). Keyed by strategy_id, created lazily.
        self._recompute_locks: dict[str, asyncio.Lock] = {}
        # Set by main.py after the fundamentals signal loop is constructed (feature 062);
        # RunFundamentalsScan invokes its shared run_once path.
        self._fundsignal_loop = None

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04).

        Internal services trust the access scope set by the entry points (UI BFF via JWT,
        MCP agent via its SSE auth layer) and do a role check at most — they do not
        re-authenticate. Shared by ManageStrategy and (feature 048) SetStrategyLive.
        """
        metadata = dict(context.invocation_metadata())
        try:
            access_scope = int(metadata.get("x-access-scope", "0"))
        except (TypeError, ValueError):
            access_scope = 0
        return bool(access_scope & 0x04)

    async def _fetch_formula_outputs(self, definition, propagation_meta) -> dict:
        """Map each custom-formula component's formula_id to the set of series it exposes.

        Always includes the implicit "value" series. Used at strategy write time to
        validate dotted ``<ref_name>.<series>`` references against the formula's declared
        outputs. A formula that can't be fetched defaults to {"value"} (strict).
        """
        formula_outputs: dict[str, set[str]] = {}
        for comp in definition.components:
            if comp.kind != analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                continue
            if not comp.formula_id or comp.formula_id in formula_outputs:
                continue
            allowed = {"value"}
            try:
                formula = await self._indicators.GetFormula(
                    indicators_pb2.GetFormulaRequest(formula_id=comp.formula_id),
                    metadata=propagation_meta,
                )
                allowed.update(o.name for o in formula.outputs)
            except grpc.aio.AioRpcError as e:
                log.warning("could not fetch formula %s outputs: %s", comp.formula_id, e)
            formula_outputs[comp.formula_id] = allowed
        return formula_outputs

    async def _validate_definition_proto(self, definition, context) -> None:
        """Validate a StrategyDefinition; abort INVALID_ARGUMENT on failure."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        formula_outputs = await self._fetch_formula_outputs(definition, propagation_meta)
        try:
            _validate_definition(definition, formula_outputs)
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))

    async def RunBacktest(self, request, context):
        backtest_id = str(uuid.uuid4())
        commission = self._cfg.get_float("analysis.backtest.default_commission_pct", 0.001)
        slippage = self._cfg.get_float("analysis.backtest.default_slippage_pct", 0.0005)
        _weights_raw = self._cfg.get_str("analysis.signals.source_weights", default="{}")
        try:
            source_weights = (
                {k: max(0.0, min(1.0, float(v))) for k, v in json.loads(_weights_raw).items()}
                if _weights_raw
                else {}
            )
        except (ValueError, TypeError):
            log.warning("analysis.signals.source_weights is not valid JSON — using empty weights")
            source_weights = {}

        log.info(
            "running backtest id=%s strategy=%s symbols=%s",
            backtest_id,
            request.strategy_id,
            list(request.symbols),
        )

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

        # Emit start event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update({"backtest_id": backtest_id, "strategy_id": request.strategy_id})
        await self._ledger.AppendEvent(
            ledger_pb2.AppendEventRequest(
                event_type="analysis.backtest.started",
                source_service="xstockstrat-analysis",
                stream_key=f"backtest:{backtest_id}",
                payload=payload,
            ),
            metadata=propagation_meta,
        )

        # Extract strategy params from the Struct
        params = {}
        if request.HasField("strategy_params"):
            params = dict(request.strategy_params.fields)
            params = {k: _unwrap_value(v) for k, v in params.items()}

        fast_period = int(params.get("fast_period", 20))
        slow_period = int(params.get("slow_period", 50))
        signal_sources = params.get("signal_sources", [])
        signal_weight = float(params.get("signal_weight", 0.0))
        technical_weight = float(params.get("technical_weight", 1.0))
        min_conviction = float(params.get("min_conviction", 0.0))

        # Normalize weights so they sum to 1
        total_weight = signal_weight + technical_weight
        if total_weight > 0:
            signal_weight /= total_weight
            technical_weight /= total_weight

        # Resolve strategy definition: inline takes precedence over strategy_id_ref (FR-7).
        # If neither is supplied, fall through to the legacy SMA-crossover path (FR-8).
        active_definition = None
        executed_row = None
        if request.HasField("inline_definition"):
            active_definition = request.inline_definition
        elif request.strategy_id_ref:
            if self._strategies_repo:
                row = await self._strategies_repo.get_by_id(request.strategy_id_ref)
                if row:
                    active_definition = _row_to_strategy_definition(row)
                    executed_row = row
                else:
                    await context.abort(
                        grpc.StatusCode.NOT_FOUND,
                        f"strategy '{request.strategy_id_ref}' not found",
                    )
                    return

        # feature 065: fingerprint the executed definition only when the run executes the
        # strategy's OWN registered definition (strategy_id == strategy_id_ref). Inline runs,
        # the legacy-SMA fallback, id-mismatches, and unregistered ids leave the cells'
        # fingerprint NULL so they never contribute to that strategy's headline grade. The hash
        # is taken from the DB-returned definition_json (post-_to_dict), never a request dict
        # (design.md § fingerprint — the canonicalization rule the fingerprint fn documents).
        run_fingerprint = None
        if (
            request.strategy_id_ref
            and request.strategy_id == request.strategy_id_ref
            and executed_row is not None
        ):
            run_fingerprint = _definition_fingerprint(executed_row["definition_json"])

        # feature 064 (FR-4b): cap every backtest to `analysis.backtest.max_range_days` (~2 years).
        # Both bounds set + span over the cap → reject (reproducibility, not silent clamp). An unset
        # bound (e.g. the agent sends no range) is defaulted so ALL backtests stay bounded.
        max_range_days = self._cfg.get_int("analysis.backtest.max_range_days", 730)
        cap_seconds = max_range_days * 86_400
        start_set = request.range.start.seconds > 0
        end_set = request.range.end.seconds > 0
        if start_set and end_set:
            span_seconds = request.range.end.seconds - request.range.start.seconds
            if span_seconds > cap_seconds:
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"backtest range span {span_seconds // 86_400} days exceeds the "
                    f"{max_range_days}-day (~2 year) maximum",
                )
                return
        else:
            now_ts = Timestamp()
            now_ts.GetCurrentTime()
            end_sec = request.range.end.seconds if end_set else now_ts.seconds
            start_sec = request.range.start.seconds if start_set else max(end_sec - cap_seconds, 0)
            request.range.start.seconds = start_sec
            request.range.start.nanos = 0
            request.range.end.seconds = end_sec
            request.range.end.nanos = 0

        all_trades: list[analysis_pb2.TradeRecord] = []
        equity = float(request.initial_capital) if request.initial_capital > 0 else 100_000.0
        initial_equity = equity
        daily_equity: list[float] = [equity]
        coverage_gaps: list[analysis_pb2.CoverageGap] = []
        all_diagnostics: list[analysis_pb2.SymbolDiagnostics] = []  # feature 064
        # feature 065: one per-symbol evidence cell buffered per traded symbol; flushed on OK.
        symbol_cells: list[dict] = []
        # feature 064: declared formula warm-ups fetched once per run, reused across symbols.
        formula_warmup_cache: dict[str, int] = {}

        for symbol in request.symbols:
            try:
                if active_definition is not None:
                    trades, equity, daily_eq, sym_diag = await self._backtest_symbol_evaluated(
                        symbol=symbol,
                        range_msg=request.range,
                        definition=active_definition,
                        initial_equity=equity,
                        commission=commission,
                        slippage=slippage,
                        propagation_meta=propagation_meta,
                        formula_warmup_cache=formula_warmup_cache,
                    )
                else:
                    trades, equity, daily_eq, sym_diag = await self._backtest_symbol(
                        symbol=symbol,
                        range_msg=request.range,
                        fast_period=fast_period,
                        slow_period=slow_period,
                        signal_sources=signal_sources,
                        signal_weight=signal_weight,
                        technical_weight=technical_weight,
                        min_conviction=min_conviction,
                        initial_equity=equity,
                        commission=commission,
                        slippage=slippage,
                        source_weights=source_weights,
                        propagation_meta=propagation_meta,
                    )
                # feature 065: buffer one evidence cell for this symbol before merging into the
                # aggregate curve. daily_eq[0] is the symbol's own (compounded) starting equity,
                # so the cell metrics are per-symbol, not aggregate. Symbols with no usable curve
                # (<= the seed point) contribute nothing. Zero-trade cells ARE buffered —
                # non-participation is evidence (traded-first dedup keeps it from shadowing).
                if len(daily_eq) > 1:
                    cell_m = _compute_metrics(daily_eq, trades, daily_eq[0])
                    symbol_cells.append(
                        {
                            "symbol": symbol,
                            "sharpe_ratio": cell_m["sharpe_ratio"],
                            "max_drawdown": cell_m["max_drawdown"],
                            "win_rate": cell_m["win_rate"],
                            "total_return": cell_m["total_return"],
                            "total_trades": len(trades),
                            "trading_days": len(daily_eq) - 1,
                        }
                    )
                all_trades.extend(trades)
                daily_equity.extend(daily_eq)
                all_diagnostics.append(sym_diag)
            except _InsufficientData as ins:
                # FR-2: surface a structured coverage gap instead of faking flat equity.
                log.warning(
                    "backtest symbol %s insufficient data: have %d, need %d",
                    ins.symbol,
                    ins.bars_have,
                    ins.bars_need,
                )
                coverage_gaps.append(
                    analysis_pb2.CoverageGap(
                        symbol=ins.symbol,
                        timeframe=common_pb2.Timeframe.TIMEFRAME_1DAY,
                        requested_range=request.range,
                        bars_have=ins.bars_have,
                        bars_need=ins.bars_need,
                        gap=request.range,
                    )
                )
                continue
            except grpc.RpcError as e:
                log.warning("backtest symbol %s failed: %s — skipping", symbol, e)
                continue
            except Exception as e:
                log.warning("backtest symbol %s error: %s — skipping", symbol, e)
                continue

        # Compute aggregate metrics
        metrics = _compute_metrics(daily_equity, all_trades, initial_equity)

        now = Timestamp()
        now.GetCurrentTime()

        result = analysis_pb2.BacktestResult(
            backtest_id=backtest_id,
            strategy_id=request.strategy_id,
            total_return=metrics["total_return"],
            annualized_return=metrics["annualized_return"],
            sharpe_ratio=metrics["sharpe_ratio"],
            max_drawdown=metrics["max_drawdown"],
            win_rate=metrics["win_rate"],
            total_trades=len(all_trades),
            profit_factor=metrics["profit_factor"],
            completed_at=now,
            trades=all_trades,
        )
        # FR-2: if every symbol was insufficient (no trades, no usable bars beyond the seed
        # equity point), report INSUFFICIENT_DATA instead of a fabricated flat-equity success.
        # A partial multi-symbol backtest stays OK but still carries the per-symbol gaps.
        if coverage_gaps and not all_trades and len(daily_equity) <= 1:
            result.status = analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        else:
            result.status = analysis_pb2.BACKTEST_STATUS_OK
        if coverage_gaps:
            result.coverage_gaps.extend(coverage_gaps)
        if all_diagnostics:  # feature 064 — per-bar diagnostics for every simulated symbol
            result.diagnostics.extend(all_diagnostics)
        self._backtests[backtest_id] = result
        # Index by strategy_id for ScoreStrategy lookup
        self._backtests[request.strategy_id] = result

        # feature 065: the backtest range (always fully set after the defaulting block above) is
        # stamped on the run-history row and on every evidence cell.
        range_start_dt = (
            request.range.start.ToDatetime() if request.range.start.seconds > 0 else None
        )
        range_end_dt = request.range.end.ToDatetime() if request.range.end.seconds > 0 else None

        # feature 065: persist per-symbol evidence cells for OK runs — the breadth+duration base
        # the derived headline grade aggregates over. Best-effort (mirrors the score/history
        # persists): a cells-flush failure never fails the run.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            await self._persist_symbol_cells(
                symbol_cells,
                backtest_id=backtest_id,
                strategy_id=request.strategy_id,
                fingerprint=run_fingerprint,
                range_start=range_start_dt,
                range_end=range_end_dt,
            )

        # Grade THIS run for the run-history row only (feature 065: the headline grade is no
        # longer last-run-wins — it is derived from the strategy's full evidence base below).
        # OK runs earn a per-run score; INSUFFICIENT_DATA runs record history with score = None.
        score = None
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
            drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
            winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)
            score = _score_from_result(
                request.strategy_id, result, sharpe_weight, drawdown_weight, winrate_weight
            )
        await self._persist_backtest_run(
            result,
            list(request.symbols),
            score,
            range_start=range_start_dt,
            range_end=range_end_dt,
        )

        # feature 065: recompute the headline grade from the strategy's full evidence base (all
        # eligible cells) now that this run's cells have landed. Best-effort — a recompute failure
        # never fails the run — and ordered BEFORE the completion emit so a subscriber that reads
        # the grade on completion sees the post-run value.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            try:
                await self._recompute_headline(request.strategy_id)
            except Exception as e:
                log.warning("failed to recompute headline score: %s", e)

        # Emit completion event
        payload2 = Struct()
        payload2.update(
            {
                "backtest_id": backtest_id,
                "total_return": result.total_return,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
                "total_trades": result.total_trades,
            }
        )
        await self._ledger.AppendEvent(
            ledger_pb2.AppendEventRequest(
                event_type="analysis.backtest.completed",
                source_service="xstockstrat-analysis",
                stream_key=f"backtest:{backtest_id}",
                payload=payload2,
            ),
            metadata=propagation_meta,
        )

        return result

    async def _backtest_symbol(
        self,
        symbol,
        range_msg,
        fast_period,
        slow_period,
        signal_sources,
        signal_weight,
        technical_weight,
        min_conviction,
        initial_equity,
        commission,
        slippage,
        source_weights,
        propagation_meta=(),
    ):
        """Run SMA crossover backtest for a single symbol.

        Returns (trades, final_equity, daily_equity, diagnostics) — feature 064.
        """

        # 1. Fetch OHLCV bars from marketdata
        bars_resp = await self._marketdata.GetBars(
            marketdata_pb2.GetBarsRequest(
                symbol=symbol,
                timeframe="1d",  # canonical: matches the backfill path's stored "1d" bars
                timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                range=range_msg,
            ),
            metadata=propagation_meta,
        )
        bars = list(bars_resp.bars)
        if len(bars) < slow_period + 2:
            log.warning(
                "symbol %s has insufficient bars (%d < %d)", symbol, len(bars), slow_period + 2
            )
            raise _InsufficientData(symbol, len(bars), slow_period + 2)

        closes = [b.close for b in bars]

        # 2. Compute fast and slow SMAs via indicators service
        fast_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(fast_period)},
                symbol=symbol,
                timeframe="1d",
            ),
            metadata=propagation_meta,
        )
        slow_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(slow_period)},
                symbol=symbol,
                timeframe="1d",
            ),
            metadata=propagation_meta,
        )

        # Build aligned SMA arrays (points only available after warm-up period)
        fast_values = {i: p.value for i, p in enumerate(fast_resp.result) if p.value != 0}
        slow_values = {i: p.value for i, p in enumerate(slow_resp.result) if p.value != 0}

        # 3. Fetch newsletter signals if signal_sources specified
        signals_map: dict[str, list] = {}
        if signal_sources and signal_weight > 0:
            try:
                sig_resp = await self._ingest.QuerySignals(
                    ingest_pb2.QuerySignalsRequest(
                        symbol=symbol,
                        active_window=range_msg,
                    ),
                    metadata=propagation_meta,
                )
                for sig in sig_resp.signals:
                    if sig.source in signal_sources:
                        key = sig.source
                        if key not in signals_map:
                            signals_map[key] = []
                        signals_map[key].append(sig)
            except grpc.RpcError as e:
                log.warning(
                    "QuerySignals failed for %s: %s — proceeding without signals", symbol, e
                )

        n = len(bars)
        # feature 064: warm-up = first bar where BOTH SMAs are resolved (observed Option-C).
        warmup_bars = max(min(fast_values, default=n - 1), min(slow_values, default=n - 1))

        # feature 064: one diagnostic row per bar, iterated independently of the trade loop
        # (which starts at index 1) so bar 0 is captured. Present-only indicators map.
        diags = []
        for i in range(n):
            indicators = {}
            if i in fast_values:
                indicators["sma_fast"] = fast_values[i]
            if i in slow_values:
                indicators["sma_slow"] = slow_values[i]
            diags.append(
                _build_bar_diagnostic(
                    symbol=symbol,
                    bar_index=i,
                    bar=bars[i],
                    indicators=indicators,
                    signal_score=0.0,
                    conviction=0.0,
                    action=analysis_pb2.BAR_ACTION_HOLD_FLAT,
                    warmup=False,
                )
            )

        # 4. Simulate trades bar by bar
        trades = []
        equity = initial_equity
        position = 0.0  # shares held
        entry_price = 0.0
        entry_time = None
        daily_equity = [equity]
        buy_threshold = scoring.buy_threshold(min_conviction)
        sell_threshold = scoring.sell_threshold()

        for i in range(1, n):
            bar = bars[i]
            price = bar.close

            # Skip until both SMAs are available (these are warm-up bars — labelled below)
            if i not in fast_values or i not in slow_values:
                daily_equity.append(equity + position * price)
                continue

            prev_fast = fast_values.get(i - 1)
            prev_slow = slow_values.get(i - 1)
            curr_fast = fast_values[i]
            curr_slow = slow_values[i]

            if prev_fast is None or prev_slow is None:
                daily_equity.append(equity + position * price)
                continue

            # Technical signal: +1 (bullish crossover), -1 (bearish crossover), 0 (no change)
            if prev_fast <= prev_slow and curr_fast > curr_slow:
                tech_signal = 1.0
            elif prev_fast >= prev_slow and curr_fast < curr_slow:
                tech_signal = -1.0
            else:
                tech_signal = 0.0

            # Signal score from newsletter signals active on this bar's date
            signal_score = scoring.compute_signal_score(
                signals_map, bar, signal_sources, source_weights=source_weights
            )

            # Combined conviction (pure scoring module — identical to the screener, FR-4)
            combined = scoring.combine_score(
                tech_signal,
                signal_score,
                signal_weight,
                technical_weight,
                signals_present=bool(signals_map),
            )
            diags[i].signal_score = signal_score
            diags[i].conviction = combined
            bar_action = (
                analysis_pb2.BAR_ACTION_HOLD_LONG
                if position > 0.0
                else analysis_pb2.BAR_ACTION_HOLD_FLAT
            )

            if position == 0.0 and combined >= buy_threshold:
                # Buy: use 95% of equity (keep 5% as buffer)
                fill_price = price * (1 + slippage)
                shares = (equity * 0.95) / fill_price
                cost = shares * fill_price * (1 + commission)
                if cost <= equity:
                    position = shares
                    entry_price = fill_price
                    entry_time = bar.time
                    equity -= cost
                    # feature 064: label ENTER only when the fill actually happens
                    bar_action = analysis_pb2.BAR_ACTION_ENTER_LONG

            elif position > 0.0 and combined <= sell_threshold:
                # Sell: close position
                fill_price = price * (1 - slippage)
                proceeds = position * fill_price * (1 - commission)
                pnl = proceeds - (position * entry_price * (1 + commission))

                exit_ts = Timestamp()
                exit_ts.CopyFrom(bar.time)
                entry_ts = Timestamp()
                entry_ts.CopyFrom(entry_time)

                trades.append(
                    analysis_pb2.TradeRecord(
                        symbol=symbol,
                        side="long",
                        qty=position,
                        entry_price=entry_price,
                        exit_price=fill_price,
                        pnl=pnl,
                        entry_time=entry_ts,
                        exit_time=exit_ts,
                    )
                )
                equity += proceeds
                position = 0.0
                entry_price = 0.0
                entry_time = None
                bar_action = analysis_pb2.BAR_ACTION_EXIT_LONG

            diags[i].action = bar_action
            portfolio_value = equity + position * price
            daily_equity.append(portfolio_value)

        # Close any open position at last bar price
        if position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = position * fill_price * (1 - commission)
            pnl = proceeds - (position * entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(entry_time)
            trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=position,
                    entry_price=entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            equity += proceeds
            daily_equity[-1] = equity
            # feature 064: the forced close labels the last bar an exit (AC-3)
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades)
        return trades, equity, daily_equity, symbol_diag

    async def _backtest_symbol_evaluated(
        self,
        symbol,
        range_msg,
        definition,
        initial_equity,
        commission,
        slippage,
        propagation_meta=(),
        formula_warmup_cache=None,
    ):
        """Run a stored/inline StrategyDefinition for one symbol via the shared evaluator.

        Drives entry/exit from StrategyEvaluator decisions (backtest/live parity).
        Returns (trades, final_equity, daily_equity, diagnostics) — feature 064.
        """
        bars_resp = await self._marketdata.GetBars(
            marketdata_pb2.GetBarsRequest(
                symbol=symbol,
                timeframe="1d",  # canonical: matches the backfill path's stored "1d" bars
                timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                range=range_msg,
            ),
            metadata=propagation_meta,
        )
        bars = list(bars_resp.bars)
        if len(bars) < 2:
            log.warning("symbol %s has insufficient bars (%d)", symbol, len(bars))
            raise _InsufficientData(symbol, len(bars), 2)

        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        # feature 064: also capture the computed component series for diagnostics.
        decisions, component_series = await evaluator.evaluate_with_series(definition, bars, None)

        n = len(bars)
        warmup_bars = await self._compute_evaluated_warmup(
            definition, component_series, n, formula_warmup_cache, propagation_meta
        )

        # feature 064: per-bar diagnostics (independent of the trade loop → bar 0 captured).
        # Present-only indicators map, dropping the redundant "<ref>.value" alias (the bare
        # ref_name already carries the primary series).
        diags = []
        for i in range(n):
            indicators = {
                key: series[i]
                for key, series in component_series.items()
                if not key.endswith(".value") and i < len(series) and series[i] is not None
            }
            diags.append(
                _build_bar_diagnostic(
                    symbol=symbol,
                    bar_index=i,
                    bar=bars[i],
                    indicators=indicators,
                    signal_score=0.0,  # evaluator path carries no newsletter signals (FR-4a)
                    conviction=decisions[i].conviction,
                    action=analysis_pb2.BAR_ACTION_HOLD_FLAT,
                    warmup=False,
                )
            )

        trades = []
        equity = initial_equity
        position = 0.0
        entry_price = 0.0
        entry_time = None
        daily_equity = [equity]

        for i in range(1, n):
            bar = bars[i]
            price = bar.close
            decision = decisions[i]
            bar_action = (
                analysis_pb2.BAR_ACTION_HOLD_LONG
                if position > 0.0
                else analysis_pb2.BAR_ACTION_HOLD_FLAT
            )

            if position == 0.0 and decision.entry:
                fill_price = price * (1 + slippage)
                shares = (equity * 0.95) / fill_price
                cost = shares * fill_price * (1 + commission)
                if cost <= equity:
                    position = shares
                    entry_price = fill_price
                    entry_time = bar.time
                    equity -= cost
                    bar_action = analysis_pb2.BAR_ACTION_ENTER_LONG
            elif position > 0.0 and decision.exit:
                fill_price = price * (1 - slippage)
                proceeds = position * fill_price * (1 - commission)
                pnl = proceeds - (position * entry_price * (1 + commission))
                exit_ts = Timestamp()
                exit_ts.CopyFrom(bar.time)
                entry_ts = Timestamp()
                entry_ts.CopyFrom(entry_time)
                trades.append(
                    analysis_pb2.TradeRecord(
                        symbol=symbol,
                        side="long",
                        qty=position,
                        entry_price=entry_price,
                        exit_price=fill_price,
                        pnl=pnl,
                        entry_time=entry_ts,
                        exit_time=exit_ts,
                    )
                )
                equity += proceeds
                position = 0.0
                entry_price = 0.0
                entry_time = None
                bar_action = analysis_pb2.BAR_ACTION_EXIT_LONG

            diags[i].action = bar_action
            daily_equity.append(equity + position * price)

        # Close any open position at the last bar price
        if position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = position * fill_price * (1 - commission)
            pnl = proceeds - (position * entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(entry_time)
            trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=position,
                    entry_price=entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            equity += proceeds
            daily_equity[-1] = equity
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades)
        return trades, equity, daily_equity, symbol_diag

    async def _compute_evaluated_warmup(
        self, definition, component_series, n, formula_warmup_cache, propagation_meta
    ):
        """Option-C hybrid warm-up length for the evaluator path: the max lookback over the
        components the active entry/exit rules reference. Built-in → observed first-resolved
        index (capped n-1). Custom formula → its *declared* warmup_period via GetFormula
        (cached by formula_id across symbols; never observed, so an all-None formula series
        can't inflate the warm-up — design.md Open Risk mitigation)."""
        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None
        refs = referenced_refs(entry_rule) | referenced_refs(exit_rule)
        if not refs:
            return 0
        if formula_warmup_cache is None:
            formula_warmup_cache = {}
        ref_to_comp = {c.ref_name: c for c in definition.components}
        warmup = 0
        for ref in refs:
            comp = ref_to_comp.get(ref)
            if comp is None:
                continue
            if comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                fid = comp.formula_id
                if fid not in formula_warmup_cache:
                    try:
                        formula = await self._indicators.GetFormula(
                            indicators_pb2.GetFormulaRequest(formula_id=fid),
                            metadata=propagation_meta,
                        )
                        formula_warmup_cache[fid] = int(getattr(formula, "warmup_period", 0) or 0)
                    except grpc.RpcError:
                        formula_warmup_cache[fid] = 0
                warmup = max(warmup, formula_warmup_cache[fid])
            else:
                warmup = max(warmup, _first_resolved_index(component_series.get(ref, []), n))
        return warmup

    async def ScoreStrategy(self, request, context):
        """Manually recompute a strategy's headline grade from its evidence cells (feature 065).

        Repurposed from the old "re-score the latest in-memory backtest": the headline grade is
        now derived from the strategy's full (symbol × window) evidence base, so this RPC is the
        manual refresh after a scoring-config change (RunBacktest / ManageStrategy UPDATE recompute
        automatically). ``ScoreStrategyRequest.range`` is IGNORED — the evidence base is the whole
        eligible cell set, not a window. Unlike the best-effort trigger path, this RPC surfaces
        errors: unregistered → NOT_FOUND, no eligible evidence → clear stale grade + NOT_FOUND,
        cells/store error → UNAVAILABLE.
        """
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        row = await self._strategies_repo.get_by_id(request.strategy_id)
        if row is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "strategy not registered")
            return

        async with self._lock_for(request.strategy_id):
            try:
                score = await self._fetch_and_aggregate(request.strategy_id, row)
            except Exception as e:
                log.warning("failed to read evidence cells for score: %s", e)
                await context.abort(grpc.StatusCode.UNAVAILABLE, "evidence store unavailable")
                return
            if score is None:
                # No eligible evidence: clear any stale grade. Unlike the trigger path this delete
                # is NON-best-effort — a delete failure aborts UNAVAILABLE rather than silently
                # leaving a stale grade behind.
                self._strategies.pop(request.strategy_id, None)
                if self._scores_repo is not None:
                    try:
                        await self._scores_repo.delete(request.strategy_id)
                    except Exception as e:
                        log.warning("failed to clear stale score: %s", e)
                        await context.abort(grpc.StatusCode.UNAVAILABLE, "score store unavailable")
                        return
                await context.abort(
                    grpc.StatusCode.NOT_FOUND, "no eligible evidence — run a backtest"
                )
                return
            await self._persist_strategy_score(score)

        # Emit ledger event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update(
            {
                "strategy_id": request.strategy_id,
                "overall_score": score.overall_score,
                "rating": score.rating,
            }
        )
        try:
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="analysis.strategy.scored",
                    source_service="xstockstrat-analysis",
                    stream_key=f"strategy:{request.strategy_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit ledger event for score: %s", e)

        return score

    async def _persist_strategy_score(self, score) -> None:
        """Update the in-memory serving dict and best-effort durably persist a score.

        Reads serve from ``self._strategies``, so a swallowed write never loses the caller's
        read-your-writes (feature 064, FR-7). The ``math.isfinite`` filter guards the JSONB
        column against a non-finite component (NaN/Infinity would make Postgres reject it).
        Shared by ScoreStrategy and RunBacktest's auto-scoring so the two never diverge.
        """
        self._strategies[score.strategy_id] = score
        if self._scores_repo is None:
            return
        try:
            components = {k: v for k, v in dict(score.component_scores).items() if math.isfinite(v)}
            await self._scores_repo.upsert(
                score.strategy_id,
                score.overall_score,
                score.rating,
                components,
                n_symbols=score.evidence_symbols,
                total_trading_days=score.evidence_days,
                provisional=score.provisional,
            )
        except Exception as e:
            log.warning("failed to persist strategy score: %s", e)

    def _lock_for(self, strategy_id: str) -> asyncio.Lock:
        """Return the (lazily created) per-strategy recompute lock."""
        lock = self._recompute_locks.get(strategy_id)
        if lock is None:
            lock = asyncio.Lock()
            self._recompute_locks[strategy_id] = lock
        return lock

    def _derive_score_from_cells(self, strategy_id, strategy_row, cells):
        """Pure: score each eligible cell and aggregate into a headline StrategyScore.

        Returns the (unpersisted) StrategyScore with evidence provenance, or ``None`` when the
        cells carry zero evidence weight (``Σ trading_days == 0``). Does not touch the DB.
        """
        sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
        drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
        winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)
        scored: list[tuple[int, float, dict]] = []
        for c in cells:
            overall, comps = _score_from_metrics(
                c["sharpe_ratio"],
                c["max_drawdown"],
                c["win_rate"],
                sharpe_weight,
                drawdown_weight,
                winrate_weight,
            )
            scored.append((int(c["trading_days"]), overall, comps))
        k = self._cfg.get_int("analysis.scoring.shrinkage_days", 250)
        agg = _aggregate_cells(scored, k)
        if agg is None:
            return None
        overall, components, n_symbols, total_days = agg
        min_symbols = self._cfg.get_int("analysis.scoring.min_evidence_symbols", 3)
        min_days = self._cfg.get_int("analysis.scoring.min_evidence_days", 500)
        provisional = n_symbols < min_symbols or total_days < min_days
        return analysis_pb2.StrategyScore(
            strategy_id=strategy_id,
            overall_score=overall,
            rating=_grade(overall),
            component_scores=components,
            evidence_symbols=n_symbols,
            evidence_days=total_days,
            provisional=provisional,
        )

    async def _fetch_and_aggregate(self, strategy_id, strategy_row):
        """Read eligible cells for the strategy's CURRENT fingerprint and derive a score.

        Returns the derived (unpersisted) StrategyScore, or ``None`` when there is zero eligible
        evidence. Raises on a cells-read error so callers can choose best-effort vs. abort. Does
        NOT mutate in-memory or DB state — pure read + compute.
        """
        fingerprint = _definition_fingerprint(strategy_row["definition_json"])
        cells = await self._backtest_run_symbols_repo.fetch_eligible(strategy_id, fingerprint)
        if not cells:
            return None
        return self._derive_score_from_cells(strategy_id, strategy_row, cells)

    async def _recompute_headline(self, strategy_id: str):
        """Derive + persist a strategy's headline grade from its full evidence base.

        Resolves the strategy row BEFORE taking the lock (no lock leak from ad-hoc/unregistered
        ids → returns None). Best-effort trigger path (RunBacktest / ManageStrategy UPDATE);
        callers wrap it in try/except. Returns the new StrategyScore or None.
        """
        if self._strategies_repo is None:
            return None
        row = await self._strategies_repo.get_by_id(strategy_id)
        if row is None:
            return None
        async with self._lock_for(strategy_id):
            return await self._recompute_headline_locked(strategy_id, row)

    async def _recompute_headline_locked(self, strategy_id, strategy_row):
        """Recompute the headline grade; the caller MUST already hold the strategy's lock.

        Zero eligible evidence → clear any stale grade (in-memory pop + best-effort DB delete),
        return None. Otherwise derive, persist via the shared score funnel, return the score.
        asyncio.Lock is non-reentrant, so triggers already inside the lock call ONLY this variant.
        """
        score = await self._fetch_and_aggregate(strategy_id, strategy_row)
        if score is None:
            self._strategies.pop(strategy_id, None)
            if self._scores_repo is not None:
                try:
                    await self._scores_repo.delete(strategy_id)
                except Exception as e:
                    log.warning("failed to clear stale strategy score: %s", e)
            return None
        await self._persist_strategy_score(score)
        return score

    async def _persist_backtest_run(
        self, result, symbols, score, range_start=None, range_end=None
    ) -> None:
        """Best-effort append of a completed backtest to the durable run-history table.

        Fixes "cannot see past run results": the in-memory ``_backtests`` dict only holds
        the latest run per strategy and is lost on restart, so every run is also recorded
        here (summary metrics + the score it earned). No-op in the no-DB test path. The
        ``range_start``/``range_end`` (feature 065) record the window each run covered.
        """
        if self._backtest_runs_repo is None:
            return
        try:
            await self._backtest_runs_repo.insert(
                backtest_id=result.backtest_id,
                strategy_id=result.strategy_id,
                status=analysis_pb2.BacktestStatus.Name(result.status),
                metrics={
                    "total_return": result.total_return,
                    "annualized_return": result.annualized_return,
                    "sharpe_ratio": result.sharpe_ratio,
                    "max_drawdown": result.max_drawdown,
                    "win_rate": result.win_rate,
                    "total_trades": result.total_trades,
                    "profit_factor": result.profit_factor,
                },
                symbols=symbols,
                overall_score=score.overall_score if score is not None else None,
                rating=score.rating if score is not None else None,
                range_start=range_start,
                range_end=range_end,
            )
        except Exception as e:
            log.warning("failed to persist backtest run history: %s", e)

    async def _persist_symbol_cells(
        self, cells, *, backtest_id, strategy_id, fingerprint, range_start, range_end
    ) -> None:
        """Best-effort flush of per-symbol evidence cells for an OK run (feature 065).

        One row per traded symbol; stamps the shared backtest_id, strategy_id, definition
        fingerprint, and range. No-op in the no-DB test path or when the buffer is empty. A DB
        error is swallowed (mirrors the score/history persists) so a cells-flush failure never
        fails the run.
        """
        if self._backtest_run_symbols_repo is None or not cells:
            return
        try:
            rows = [
                {
                    "backtest_id": backtest_id,
                    "strategy_id": strategy_id,
                    "symbol": c["symbol"],
                    "sharpe_ratio": c["sharpe_ratio"],
                    "max_drawdown": c["max_drawdown"],
                    "win_rate": c["win_rate"],
                    "total_return": c["total_return"],
                    "total_trades": c["total_trades"],
                    "trading_days": c["trading_days"],
                    "definition_fingerprint": fingerprint,
                    "range_start": range_start,
                    "range_end": range_end,
                }
                for c in cells
            ]
            await self._backtest_run_symbols_repo.insert_many(rows)
        except Exception as e:
            log.warning("failed to persist backtest symbol cells: %s", e)

    async def hydrate_scores(self) -> None:
        """Load persisted scores from the DB into the in-memory serving dict at boot.

        Feature 064: makes ListStrategies/GetStrategyReport survive a restart. No-op when
        there is no DB pool (test path). Called best-effort from main.py; ListStrategies
        and GetStrategyReport stay unchanged (they serve self._strategies).
        """
        if self._scores_repo is None:
            return
        rows = await self._scores_repo.list()
        for r in rows:
            self._strategies[r["strategy_id"]] = _row_to_score(r)

    async def ListStrategies(self, request, context):
        strategies = list(self._strategies.values())
        return analysis_pb2.ListStrategiesResponse(strategies=strategies)

    async def GetStrategyReport(self, request, context):
        score = self._strategies.get(request.strategy_id)
        if score is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"strategy {request.strategy_id} not found"
            )
            return
        result = self._backtests.get(request.strategy_id)
        return analysis_pb2.StrategyReport(
            strategy_id=request.strategy_id,
            score=score,
            latest_backtest=result,
        )

    async def ListBacktests(self, request, context):
        """Return past backtest-run summaries for a strategy, newest first.

        Reads the durable ``analysis.backtest_runs`` table so past run results survive a
        restart (the in-memory ``_backtests`` dict only holds the latest per strategy). The
        full trades/diagnostics are intentionally not returned — history is a compact summary.
        Returns an empty list in the no-DB test path or on any read error.
        """
        if self._backtest_runs_repo is None:
            return analysis_pb2.ListBacktestsResponse()
        limit = request.limit if request.limit > 0 else 20
        try:
            rows = await self._backtest_runs_repo.list_by_strategy(request.strategy_id, limit=limit)
        except Exception as e:
            log.warning("failed to read backtest run history: %s", e)
            return analysis_pb2.ListBacktestsResponse()
        return analysis_pb2.ListBacktestsResponse(runs=[_row_to_backtest_summary(r) for r in rows])

    async def ManageStrategy(self, request, context):
        # Role check only — authn/authz is owned by the entry points (UI BFF / MCP agent).
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return

        definition = request.definition
        op = request.operation

        if op == analysis_pb2.STRATEGY_OPERATION_REGISTER:
            await self._validate_definition_proto(definition, context)
            definition_json = json_format.MessageToDict(
                definition, preserving_proto_field_name=True
            )
            row = await self._strategies_repo.create(
                definition.strategy_id, definition.display_name, definition_json
            )
            return _row_to_strategy_definition(row)
        if op == analysis_pb2.STRATEGY_OPERATION_UPDATE:
            await self._validate_definition_proto(definition, context)
            definition_json = json_format.MessageToDict(
                definition, preserving_proto_field_name=True
            )
            row = await self._strategies_repo.update(
                definition.strategy_id, definition.display_name, definition_json
            )
            if row is None:
                await context.abort(
                    grpc.StatusCode.NOT_FOUND,
                    f"strategy '{definition.strategy_id}' not found",
                )
                return
            # feature 065: a definition change usually changes the fingerprint, so the old
            # evidence base no longer applies. Under the strategy's lock, unconditionally clear
            # the stale in-memory grade FIRST, then best-effort recompute against the NEW
            # fingerprint (typically empty until a fresh backtest → grade cleared). The UPDATE
            # response never fails on a recompute error. (A display-name-only edit keeps the same
            # fingerprint, so recompute simply reinstates the same grade.)
            sid = definition.strategy_id
            async with self._lock_for(sid):
                self._strategies.pop(sid, None)
                try:
                    await self._recompute_headline_locked(sid, row)
                except Exception as e:
                    log.warning("failed to recompute headline after update: %s", e)
            return _row_to_strategy_definition(row)
        if op == analysis_pb2.STRATEGY_OPERATION_DEACTIVATE:
            row = await self._strategies_repo.deactivate(definition.strategy_id)
            if row is None:
                await context.abort(
                    grpc.StatusCode.NOT_FOUND,
                    f"strategy '{definition.strategy_id}' not found",
                )
                return
            return _row_to_strategy_definition(row)
        await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "unknown strategy operation")

    async def GetStrategy(self, request, context):
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        row = await self._strategies_repo.get_by_id(request.strategy_id)
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"strategy '{request.strategy_id}' not found"
            )
            return
        return _row_to_strategy_definition(row)

    async def ListStrategyDefinitions(self, request, context):
        if self._strategies_repo is None:
            return analysis_pb2.ListStrategyDefinitionsResponse()
        rows, total = await self._strategies_repo.list(
            include_inactive=request.include_inactive,
            page_size=request.page_size,
            page_offset=request.page_offset,
        )
        return analysis_pb2.ListStrategyDefinitionsResponse(
            definitions=[_row_to_strategy_definition(r) for r in rows],
            total_count=total,
        )

    async def SetStrategyLive(self, request, context):
        # Role check only — same gate as ManageStrategy (shared _has_admin_scope helper).
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return

        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

        row = await self._strategies_repo.set_live_enabled(
            request.strategy_id, request.live_enabled
        )
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"strategy '{request.strategy_id}' not found"
            )
            return

        # Best-effort ledger event (same swallow-exceptions pattern as ScoreStrategy).
        try:
            from google.protobuf.struct_pb2 import Struct

            payload = Struct()
            payload.update(
                {"strategy_id": request.strategy_id, "live_enabled": request.live_enabled}
            )
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="analysis.strategy.live_toggled",
                    source_service="xstockstrat-analysis",
                    stream_key=f"strategy:{request.strategy_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit live_toggled ledger event: %s", e)

        return analysis_pb2.SetStrategyLiveResponse(definition=_row_to_strategy_definition(row))

    async def ScreenSymbols(self, request, context):
        """Screen a symbol universe against weighted criteria (feature 060).

        Delegates to the pure-ish ScreenerEngine, reusing the same source-weighted scoring
        as a backtest (FR-4) and ExecuteFormula invocation (FR-3). Fundamental criteria
        degrade to skipped when marketdata's GetFundamentals is unavailable (FR-5). Does not
        touch RunBacktest/ScoreStrategy (FR-8).
        """
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

        _weights_raw = self._cfg.get_str("analysis.signals.source_weights", default="{}")
        try:
            source_weights = (
                {k: max(0.0, min(1.0, float(v))) for k, v in json.loads(_weights_raw).items()}
                if _weights_raw
                else {}
            )
        except (ValueError, TypeError):
            source_weights = {}

        engine = ScreenerEngine(
            self._marketdata, self._indicators, self._ingest, self._cfg, source_weights
        )

        # Enforce the overall scan deadline (default 120s).
        deadline = self._cfg.get_int("analysis.screener.max_duration_seconds", 120)
        try:
            return await asyncio.wait_for(
                engine.screen(request, propagation_meta), timeout=deadline
            )
        except TimeoutError:
            await context.abort(
                grpc.StatusCode.DEADLINE_EXCEEDED,
                f"screen exceeded {deadline}s deadline",
            )

    async def RunFundamentalsScan(self, request, context):
        """Manually trigger one fundamentals signal producer scan (feature 062, admin-scoped).

        Reuses the producer's single ``run_once`` path so the scheduled loop and the manual
        trigger never diverge. Forwards the caller's propagation metadata to all outbound calls.
        """
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        if self._fundsignal_loop is None:
            await context.abort(
                grpc.StatusCode.UNAVAILABLE, "fundamentals signal producer not initialized"
            )
            return

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        return await self._fundsignal_loop.run_once(
            force=request.force,
            dry_run=request.dry_run,
            override_symbols=list(request.symbols) or None,
            metadata=propagation_meta,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


# ── Backtest per-bar diagnostics helpers (feature 064-backtest-debug-info) ───────


def _build_bar_diagnostic(
    symbol, bar_index, bar, indicators, signal_score, conviction, action, warmup
):
    """Assemble one BarDiagnostic row. Shared by both backtest paths (DRY — avoids the
    jscpd block-clone). ``bar.time`` (the marketdata Bar timestamp field) is copied into
    ``timestamp``; ``indicators`` is present-only (unresolved series omitted)."""
    diag = analysis_pb2.BarDiagnostic(
        symbol=symbol,
        bar_index=bar_index,
        open=bar.open,
        high=bar.high,
        low=bar.low,
        close=bar.close,
        volume=bar.volume,
        vwap=bar.vwap,
        signal_score=signal_score,
        conviction=conviction,
        action=action,
        warmup=warmup,
    )
    diag.timestamp.CopyFrom(bar.time)
    for key, value in indicators.items():
        diag.indicators[key] = value
    return diag


def _first_resolved_index(series, n) -> int:
    """First index where ``series`` has a non-None value (observed built-in warm-up length),
    capped at ``n-1``. An all-None series yields ``n-1``."""
    for i, v in enumerate(series):
        if v is not None:
            return min(i, max(n - 1, 0))
    return max(n - 1, 0)


def _classify_no_trade_reason(trades, warmup_bars, n):
    """FR-6: reason a symbol produced 0 trades. Only meaningful when ``trades`` is empty;
    a traded symbol is UNSPECIFIED. INSUFFICIENT_CAPITAL is defined but not emitted (design.md)."""
    if trades:
        return analysis_pb2.NO_TRADE_REASON_UNSPECIFIED
    if warmup_bars >= n:
        return analysis_pb2.NO_TRADE_REASON_ENTIRE_RANGE_WARMUP
    return analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE


def _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades):
    """Apply the Option-C warm-up override pass (bar < warmup_bars → warmup=True, action=WARMUP)
    and classify no_trade_reason, then wrap the rows in a SymbolDiagnostics."""
    n = len(diags)
    for i in range(n):
        if i < warmup_bars:
            diags[i].warmup = True
            diags[i].action = analysis_pb2.BAR_ACTION_WARMUP
    return analysis_pb2.SymbolDiagnostics(
        symbol=symbol,
        bars=diags,
        no_trade_reason=_classify_no_trade_reason(trades, warmup_bars, n),
        bars_total=n,
        warmup_bars=warmup_bars,
    )


def _score_from_metrics(
    sharpe_ratio: float,
    max_drawdown: float,
    win_rate: float,
    sharpe_weight: float,
    drawdown_weight: float,
    winrate_weight: float,
) -> tuple[float, dict]:
    """Blend raw performance metrics into ``(overall, component_scores)``.

    Extracted from ``_score_from_result`` (feature 065) so a single BacktestResult and a
    per-symbol evidence cell grade through exactly one code path — the derived headline scores
    each cell with this before aggregating.
    """
    sharpe_component = min(max(sharpe_ratio / 2.0, 0.0), 1.0)
    drawdown_component = max(1.0 - (max_drawdown / 0.5), 0.0)
    winrate_component = min(max(win_rate, 0.0), 1.0)
    overall = (
        sharpe_weight * sharpe_component
        + drawdown_weight * drawdown_component
        + winrate_weight * winrate_component
    )
    return overall, {
        "sharpe": sharpe_component,
        "drawdown": drawdown_component,
        "win_rate": winrate_component,
    }


def _grade(overall: float) -> str:
    """Map an overall score in [0, 1] to a letter grade (A/B/C/D/F)."""
    if overall >= 0.8:
        return "A"
    if overall >= 0.65:
        return "B"
    if overall >= 0.5:
        return "C"
    if overall >= 0.35:
        return "D"
    return "F"


def _aggregate_cells(
    scored_cells: list[tuple[int, float, dict]], k: int
) -> tuple[float, dict, int, int] | None:
    """Aggregate per-symbol scored evidence cells into a shrunk headline score.

    ``scored_cells`` is ``[(trading_days, cell_overall, cell_components), ...]``. Evidence
    weights are ``wᵢ = trading_days`` (weight by evidence, never by outcome). The overall is an
    empirical-Bayes shrinkage toward a neutral 0.5 prior:
    ``overall = (Σ wᵢ·sᵢ + 0.5·k) / (Σ wᵢ + k)`` where ``k`` (``analysis.scoring.shrinkage_days``)
    is the pseudo-count in trading days. Each component is shrunk identically (same k, same 0.5
    prior) over its weighted mean (weights renormalized wᵢ/Σw), and non-finite aggregated
    components are dropped (mirrors ``_persist_strategy_score``'s isfinite guard). ``Σw == 0``
    (zero evidence) → ``None`` — never an equal-weighted fallback. Returns
    ``(overall, components, n_symbols, total_days)``.
    """
    total_w = sum(days for days, _s, _c in scored_cells)
    if total_w <= 0:
        return None
    kf = float(k)
    prior = 0.5
    denom = total_w + kf

    weighted_overall = sum(days * s for days, s, _c in scored_cells)
    overall = (weighted_overall + prior * kf) / denom

    comp_keys: set[str] = set()
    for _d, _s, comps in scored_cells:
        comp_keys.update(comps.keys())
    components: dict[str, float] = {}
    for key in comp_keys:
        weighted_c = sum(
            days * comps[key]
            for days, _s, comps in scored_cells
            if key in comps and math.isfinite(comps[key])
        )
        shrunk = (weighted_c + prior * kf) / denom
        if math.isfinite(shrunk):
            components[key] = shrunk

    return overall, components, len(scored_cells), int(total_w)


def _score_from_result(
    strategy_id: str,
    result: "analysis_pb2.BacktestResult",
    sharpe_weight: float,
    drawdown_weight: float,
    winrate_weight: float,
) -> "analysis_pb2.StrategyScore":
    """Grade a single backtest into a StrategyScore (Sharpe / drawdown / win-rate blend).

    Keeps its signature and delegates to ``_score_from_metrics`` / ``_grade`` (feature 065) so
    the per-run history score and the derived headline share one scoring code path.
    """
    overall, components = _score_from_metrics(
        result.sharpe_ratio,
        result.max_drawdown,
        result.win_rate,
        sharpe_weight,
        drawdown_weight,
        winrate_weight,
    )
    return analysis_pb2.StrategyScore(
        strategy_id=strategy_id,
        overall_score=overall,
        rating=_grade(overall),
        component_scores=components,
    )


def _row_to_backtest_summary(row: dict) -> "analysis_pb2.BacktestRunSummary":
    """Convert an analysis.backtest_runs row to a BacktestRunSummary proto.

    ``status`` is stored as the enum name (e.g. "BACKTEST_STATUS_OK"); an unknown/blank value
    maps to UNSPECIFIED. A null score persists as 0 / "" (proto3 scalars have no null).
    """
    try:
        status = analysis_pb2.BacktestStatus.Value(row.get("status") or "")
    except ValueError:
        status = analysis_pb2.BACKTEST_STATUS_UNSPECIFIED
    summary = analysis_pb2.BacktestRunSummary(
        backtest_id=row.get("backtest_id", ""),
        strategy_id=row.get("strategy_id", ""),
        status=status,
        total_return=float(row.get("total_return") or 0.0),
        annualized_return=float(row.get("annualized_return") or 0.0),
        sharpe_ratio=float(row.get("sharpe_ratio") or 0.0),
        max_drawdown=float(row.get("max_drawdown") or 0.0),
        win_rate=float(row.get("win_rate") or 0.0),
        total_trades=int(row.get("total_trades") or 0),
        profit_factor=float(row.get("profit_factor") or 0.0),
        symbols=list(row.get("symbols") or []),
        overall_score=float(row["overall_score"]) if row.get("overall_score") is not None else 0.0,
        rating=row.get("rating") or "",
    )
    completed = row.get("completed_at")
    if completed is not None:
        ts = Timestamp()
        ts.FromDatetime(completed)
        summary.completed_at.CopyFrom(ts)
    return summary


_FINGERPRINT_EXCLUDED_KEYS = frozenset({"display_name", "active", "live_enabled"})


def _definition_fingerprint(definition_json: dict) -> str:
    """sha256 of a strategy's scoring-relevant definition — the evidence-cell eligibility key.

    Canonicalization rule (design.md § fingerprint, open-risk mitigation): only ever hash a
    DB-returned ``strategies`` row's ``definition_json`` (post-``StrategiesRepository._to_dict``),
    never a request proto dict — ``_row_to_strategy_definition`` overlays the column-authoritative
    fields (strategy_id/display_name/active/live_enabled) at read time, so a request dict would not
    canonicalize to the same bytes. ``display_name``/``active``/``live_enabled`` are excluded so a
    rename or a live-toggle never invalidates a strategy's accumulated evidence; a change to the
    entry/exit rules or components (which DO change scoring behavior) yields a new fingerprint and a
    fresh evidence base. ``None``/``{}`` hash identically.
    """
    filtered = {
        k: v for k, v in (definition_json or {}).items() if k not in _FINGERPRINT_EXCLUDED_KEYS
    }
    canonical = json.dumps(filtered, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _row_to_score(row: dict) -> "analysis_pb2.StrategyScore":
    """Convert an analysis.strategy_scores row to a StrategyScore proto (feature 064).

    Decodes the ``component_scores`` map (NOT ``definition_json`` — the copy-trap the design
    called out); the repo's _to_dict already JSON-decodes the JSONB column to a plain dict.
    """
    return analysis_pb2.StrategyScore(
        strategy_id=row["strategy_id"],
        overall_score=row["overall_score"],
        rating=row["rating"],
        component_scores=row.get("component_scores") or {},
        # Evidence provenance (feature 065); pre-007 rows lack these keys → defaults.
        evidence_symbols=int(row.get("n_symbols") or 0),
        evidence_days=int(row.get("total_trading_days") or 0),
        provisional=bool(row.get("provisional") or False),
    )


def _row_to_strategy_definition(row: dict) -> "analysis_pb2.StrategyDefinition":
    """Convert an analysis.strategies row (definition_json JSONB) to a StrategyDefinition proto."""
    definition_json = row.get("definition_json") or {}
    definition = json_format.ParseDict(
        definition_json, analysis_pb2.StrategyDefinition(), ignore_unknown_fields=True
    )
    # Column values are authoritative over the embedded JSON copy.
    definition.strategy_id = row["strategy_id"]
    definition.display_name = row["display_name"]
    definition.active = row["active"]
    # live_enabled column added by feature 048 (absent on rows predating that migration).
    definition.live_enabled = bool(row.get("live_enabled", False))
    return definition


def _unwrap_value(v):
    """Unwrap a google.protobuf.Value to a Python scalar."""
    kind = v.WhichOneof("kind")
    if kind == "number_value":
        return v.number_value
    if kind == "string_value":
        return v.string_value
    if kind == "bool_value":
        return v.bool_value
    if kind == "list_value":
        return [_unwrap_value(i) for i in v.list_value.values]
    if kind == "struct_value":
        return {k: _unwrap_value(vv) for k, vv in v.struct_value.fields.items()}
    return None


# _compute_signal_score moved to app.services.scoring.compute_signal_score (feature 060);
# the module-level alias near the imports preserves the old name for existing callers/tests.


def _compute_metrics(daily_equity: list[float], trades: list, initial_equity: float) -> dict:
    """Compute backtest performance metrics from daily equity curve and trade list."""
    if len(daily_equity) < 2:
        return {
            "total_return": 0.0,
            "annualized_return": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "profit_factor": 1.0,
        }

    equity = np.array(daily_equity, dtype=float)
    returns = np.diff(equity) / equity[:-1]
    returns = returns[np.isfinite(returns)]

    total_return = (equity[-1] - initial_equity) / initial_equity
    n_days = len(daily_equity) - 1
    annualized_return = (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0

    mean_r = float(np.mean(returns)) if len(returns) > 0 else 0.0
    std_r = float(np.std(returns)) if len(returns) > 1 else 1e-9
    sharpe_ratio = (mean_r / max(std_r, 1e-9)) * math.sqrt(252)

    # Max drawdown via cumulative high-water mark
    cummax = np.maximum.accumulate(equity)
    drawdowns = (equity - cummax) / cummax
    max_drawdown = float(abs(np.min(drawdowns))) if len(drawdowns) > 0 else 0.0

    pnls = [t.pnl for t in trades]
    win_rate = (sum(1 for p in pnls if p > 0) / len(pnls)) if pnls else 0.0
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    profit_factor = (
        (gross_profit / gross_loss) if gross_loss > 0 else (1.0 if gross_profit == 0 else 999.0)
    )

    return {
        "total_return": float(total_return),
        "annualized_return": float(annualized_return),
        "sharpe_ratio": float(sharpe_ratio),
        "max_drawdown": float(max_drawdown),
        "win_rate": float(win_rate),
        "profit_factor": float(profit_factor),
    }
