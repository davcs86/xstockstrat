"""
AnalysisServicer — strategy backtesting and scoring.

RunBacktest implements a real SMA crossover engine that:
  1. Fetches OHLCV bars from xstockstrat-marketdata
  2. Computes SMA indicators via xstockstrat-indicators
  3. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies
  4. Simulates trades bar-by-bar and computes performance metrics

ScoreStrategy grades backtests using Sharpe ratio, max drawdown, and win rate.
"""

import logging
import math
import uuid

import grpc
import numpy as np
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher

log = logging.getLogger(__name__)


class AnalysisServicer(analysis_pb2_grpc.AnalysisServiceServicer):
    def __init__(
        self,
        config_watcher: ConfigWatcher,
        marketdata_channel,
        indicators_channel,
        ingest_channel,
        ledger_channel,
    ):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._indicators = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)
        self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._backtests: dict[str, analysis_pb2.BacktestResult] = {}
        self._strategies: dict[str, analysis_pb2.StrategyScore] = {}

    async def RunBacktest(self, request, context):
        backtest_id = str(uuid.uuid4())
        commission = self._cfg.get_float("analysis.backtest.default_commission_pct", 0.001)
        slippage = self._cfg.get_float("analysis.backtest.default_slippage_pct", 0.0005)

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

        all_trades: list[analysis_pb2.TradeRecord] = []
        equity = float(request.initial_capital) if request.initial_capital > 0 else 100_000.0
        initial_equity = equity
        daily_equity: list[float] = [equity]

        for symbol in request.symbols:
            try:
                trades, equity, daily_eq = await self._backtest_symbol(
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
                    propagation_meta=propagation_meta,
                )
                all_trades.extend(trades)
                daily_equity.extend(daily_eq)
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
        self._backtests[backtest_id] = result
        # Index by strategy_id for ScoreStrategy lookup
        self._backtests[request.strategy_id] = result

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
        propagation_meta=(),
    ):
        """Run SMA crossover backtest for a single symbol.

        Returns (trades, final_equity, daily_equity).
        """

        # 1. Fetch OHLCV bars from marketdata
        bars_resp = await self._marketdata.GetBars(
            marketdata_pb2.GetBarsRequest(
                symbol=symbol,
                timeframe="1Day",
                range=range_msg,
            ),
            metadata=propagation_meta,
        )
        bars = list(bars_resp.bars)
        if len(bars) < slow_period + 2:
            log.warning(
                "symbol %s has insufficient bars (%d < %d)", symbol, len(bars), slow_period + 2
            )
            return [], initial_equity, [initial_equity]

        closes = [b.close for b in bars]

        # 2. Compute fast and slow SMAs via indicators service
        fast_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(fast_period)},
                symbol=symbol,
                timeframe="1Day",
            ),
            metadata=propagation_meta,
        )
        slow_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(slow_period)},
                symbol=symbol,
                timeframe="1Day",
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

        # 4. Simulate trades bar by bar
        trades = []
        equity = initial_equity
        position = 0.0  # shares held
        entry_price = 0.0
        entry_time = None
        daily_equity = [equity]

        for i in range(1, len(bars)):
            bar = bars[i]
            price = bar.close

            # Skip until both SMAs are available
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
            signal_score = _compute_signal_score(signals_map, bar, signal_sources)

            # Combined conviction
            if signal_weight > 0 and signals_map:
                combined = (
                    technical_weight * (tech_signal * 0.5 + 0.5) + signal_weight * signal_score
                )
            else:
                # Pure technical: map tech_signal to 0-1 for threshold comparison
                combined = tech_signal * 0.5 + 0.5  # -1→0, 0→0.5, +1→1

            # Entry: no position + combined above threshold → buy
            buy_threshold = max(0.5 + min_conviction * 0.5, 0.55)
            sell_threshold = 0.45

            if position == 0.0 and combined >= buy_threshold:
                # Buy: use 95% of equity (keep 5% as buffer)
                fill_price = price * (1 + slippage)
                shares = (equity * 0.95) / fill_price
                cost = shares * fill_price * (1 + commission)
                if cost <= equity:
                    position = shares
                    entry_price = fill_price
                    entry_time = bar.timestamp
                    equity -= cost

            elif position > 0.0 and combined <= sell_threshold:
                # Sell: close position
                fill_price = price * (1 - slippage)
                proceeds = position * fill_price * (1 - commission)
                pnl = proceeds - (position * entry_price * (1 + commission))

                exit_ts = Timestamp()
                exit_ts.CopyFrom(bar.timestamp)
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

            portfolio_value = equity + position * price
            daily_equity.append(portfolio_value)

        # Close any open position at last bar price
        if position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = position * fill_price * (1 - commission)
            pnl = proceeds - (position * entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.timestamp)
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

        return trades, equity, daily_equity

    async def ScoreStrategy(self, request, context):
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
        drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
        winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)

        # Find most recent backtest for this strategy
        result = self._backtests.get(request.strategy_id)
        if result is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND,
                f"no backtest found for strategy {request.strategy_id}; run RunBacktest first",
            )
            return

        # Normalize each metric to 0.0–1.0
        sharpe_component = min(max(result.sharpe_ratio / 2.0, 0.0), 1.0)
        drawdown_component = max(1.0 - (result.max_drawdown / 0.5), 0.0)
        winrate_component = min(max(result.win_rate, 0.0), 1.0)

        overall = (
            sharpe_weight * sharpe_component
            + drawdown_weight * drawdown_component
            + winrate_weight * winrate_component
        )

        if overall >= 0.8:
            rating = "A"
        elif overall >= 0.65:
            rating = "B"
        elif overall >= 0.5:
            rating = "C"
        elif overall >= 0.35:
            rating = "D"
        else:
            rating = "F"

        score = analysis_pb2.StrategyScore(
            strategy_id=request.strategy_id,
            overall_score=overall,
            rating=rating,
            component_scores={
                "sharpe": sharpe_component,
                "drawdown": drawdown_component,
                "win_rate": winrate_component,
            },
        )
        self._strategies[request.strategy_id] = score

        # Emit ledger event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update(
            {"strategy_id": request.strategy_id, "overall_score": overall, "rating": rating}
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


# ── Helpers ───────────────────────────────────────────────────────────────────


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


def _compute_signal_score(signals_map: dict, bar, signal_sources: list) -> float:
    """Return a 0.0–1.0 signal score from active newsletter signals for this bar."""
    if not signals_map or not signal_sources:
        return 0.5

    bar_ts = bar.timestamp.ToDatetime()
    buy_conviction = 0.0
    sell_conviction = 0.0
    count = 0

    for source in signal_sources:
        for sig in signals_map.get(source, []):
            valid_from = sig.valid_from.ToDatetime() if sig.valid_from.seconds > 0 else None
            valid_until = sig.valid_until.ToDatetime() if sig.valid_until.seconds > 0 else None
            if valid_from and bar_ts < valid_from:
                continue
            if valid_until and bar_ts > valid_until:
                continue
            conviction = sig.conviction if sig.conviction > 0 else 0.5
            if sig.direction == "buy":
                buy_conviction += conviction
            elif sig.direction == "sell":
                sell_conviction += conviction
            count += 1

    if count == 0:
        return 0.5  # neutral

    net = (buy_conviction - sell_conviction) / count
    return (net + 1.0) / 2.0  # map -1..1 to 0..1


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
