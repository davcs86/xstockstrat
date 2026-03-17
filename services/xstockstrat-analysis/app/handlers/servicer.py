"""
AnalysisServicer — strategy backtesting and scoring.
"""
import logging
import uuid

import grpc
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc

log = logging.getLogger(__name__)


class AnalysisServicer(analysis_pb2_grpc.AnalysisServiceServicer):

    def __init__(self, config_watcher: ConfigWatcher, marketdata_channel, indicators_channel, ledger_channel):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._indicators = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._backtests: dict[str, analysis_pb2.BacktestResult] = {}
        self._strategies: dict[str, analysis_pb2.StrategyScore] = {}

    async def RunBacktest(self, request, context):
        backtest_id = str(uuid.uuid4())
        max_duration = self._cfg.get_int("analysis.backtest.max_duration_seconds", 300)
        commission = self._cfg.get_float("analysis.backtest.default_commission_pct", 0.001)

        log.info("running backtest id=%s strategy=%s symbols=%s",
                 backtest_id, request.strategy_id, list(request.symbols))

        # Emit start event
        from google.protobuf.struct_pb2 import Struct
        payload = Struct()
        payload.update({"backtest_id": backtest_id, "strategy_id": request.strategy_id})
        await self._ledger.AppendEvent(ledger_pb2.AppendEventRequest(
            event_type="analysis.backtest.started",
            source_service="xstockstrat-analysis",
            stream_key=f"backtest:{backtest_id}",
            payload=payload,
        ))

        # Stub: return synthetic result
        # TODO: implement real backtesting engine using marketdata + indicators
        now = Timestamp()
        now.GetCurrentTime()

        result = analysis_pb2.BacktestResult(
            backtest_id=backtest_id,
            strategy_id=request.strategy_id,
            total_return=0.142,
            annualized_return=0.089,
            sharpe_ratio=1.34,
            max_drawdown=0.087,
            win_rate=0.56,
            total_trades=48,
            profit_factor=1.82,
            completed_at=now,
        )
        self._backtests[backtest_id] = result

        # Emit completion event
        payload2 = Struct()
        payload2.update({
            "backtest_id": backtest_id,
            "total_return": result.total_return,
            "sharpe_ratio": result.sharpe_ratio,
        })
        await self._ledger.AppendEvent(ledger_pb2.AppendEventRequest(
            event_type="analysis.backtest.completed",
            source_service="xstockstrat-analysis",
            stream_key=f"backtest:{backtest_id}",
            payload=payload2,
        ))

        return result

    async def ScoreStrategy(self, request, context):
        sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
        drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
        winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)

        # Stub scoring — replace with real computation from backtest results
        overall = 0.72
        rating = "B" if overall >= 0.6 else "C"

        score = analysis_pb2.StrategyScore(
            strategy_id=request.strategy_id,
            overall_score=overall,
            rating=rating,
            component_scores={
                "sharpe": 0.78,
                "drawdown": 0.65,
                "win_rate": 0.74,
            },
        )
        self._strategies[request.strategy_id] = score
        return score

    async def ListStrategies(self, request, context):
        strategies = list(self._strategies.values())
        return analysis_pb2.ListStrategiesResponse(strategies=strategies)

    async def GetStrategyReport(self, request, context):
        score = self._strategies.get(request.strategy_id)
        if score is None:
            await context.abort(grpc.StatusCode.NOT_FOUND,
                                f"strategy {request.strategy_id} not found")
            return
        return analysis_pb2.StrategyReport(
            strategy_id=request.strategy_id,
            score=score,
        )
