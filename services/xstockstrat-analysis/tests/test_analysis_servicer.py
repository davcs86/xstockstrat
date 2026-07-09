"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from google.protobuf import json_format

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer


def make_servicer() -> AnalysisServicer:
    """Return an AnalysisServicer with fully mocked dependencies."""
    cfg = MagicMock()
    # Make get_float return the default argument (mirrors real watcher behaviour)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    return AnalysisServicer(
        cfg,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )


def _make_backtest(
    strategy_id: str = "strat-1",
    sharpe: float = 1.5,
    drawdown: float = 0.08,
    win_rate: float = 0.6,
) -> analysis_pb2.BacktestResult:
    return analysis_pb2.BacktestResult(
        backtest_id="bt-1",
        strategy_id=strategy_id,
        sharpe_ratio=sharpe,
        max_drawdown=drawdown,
        win_rate=win_rate,
    )


# ---------------------------------------------------------------------------
# ScoreStrategy
# ---------------------------------------------------------------------------


class TestScoreStrategy:
    @pytest.mark.asyncio
    async def test_aborts_when_no_backtest(self):
        svc = make_servicer()
        req = MagicMock()
        req.strategy_id = "unknown"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_score_with_rating(self):
        svc = make_servicer()
        svc._backtests["strat-a"] = _make_backtest(
            "strat-a", sharpe=1.5, drawdown=0.05, win_rate=0.65
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "strat-a"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        assert score.strategy_id == "strat-a"
        assert 0.0 <= score.overall_score <= 1.0
        assert score.rating in ("A", "B", "C", "D", "F")
        assert "strat-a" in svc._strategies

    @pytest.mark.asyncio
    async def test_rating_A_for_high_score(self):
        svc = make_servicer()
        # Sharpe=2.0 → component=1.0; drawdown=0 → component=1.0; win_rate=1.0 → component=1.0
        svc._backtests["s"] = _make_backtest("s", sharpe=2.0, drawdown=0.0, win_rate=1.0)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "A"

    @pytest.mark.asyncio
    async def test_rating_F_for_poor_score(self):
        svc = make_servicer()
        # Sharpe=0, drawdown=0.5, win_rate=0 → overall near 0
        svc._backtests["s"] = _make_backtest("s", sharpe=0.0, drawdown=0.5, win_rate=0.0)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "F"

    @pytest.mark.asyncio
    async def test_ledger_error_is_swallowed(self):
        svc = make_servicer()
        svc._backtests["s"] = _make_backtest("s")
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(side_effect=Exception("ledger down"))

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        # Should complete normally despite ledger failure
        assert score.strategy_id == "s"

    @pytest.mark.asyncio
    async def test_rating_C(self):
        svc = make_servicer()
        # sharpe=1.0→0.5, drawdown=0.2→0.6, win_rate=0.5→0.5; overall=0.4*0.5+0.3*0.6+0.3*0.5=0.53
        svc._backtests["s"] = _make_backtest("s", sharpe=1.0, drawdown=0.2, win_rate=0.5)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "C"

    @pytest.mark.asyncio
    async def test_rating_D(self):
        svc = make_servicer()
        # sharpe=0.8→0.4, drawdown=0.25→0.5, win_rate=0.4→0.4; overall=0.4*0.4+0.3*0.5+0.3*0.4=0.43
        svc._backtests["s"] = _make_backtest("s", sharpe=0.8, drawdown=0.25, win_rate=0.4)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "D"


# ---------------------------------------------------------------------------
# RunBacktest with empty symbols — covers setup + teardown path
# ---------------------------------------------------------------------------


class TestRunBacktest:
    @pytest.mark.asyncio
    async def test_empty_symbols_returns_result(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.strategy_id == "s1"
        assert "s1" in svc._backtests

    def _legacy_req(self, symbols):
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = symbols
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)  # no params/inline/ref → legacy SMA path
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_insufficient_data_returns_structured_gap(self):
        """AC-2: too few bars → INSUFFICIENT_DATA + coverage_gaps, not a fake flat success."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        # Only 3 bars — far below the default slow_period(50)+2.
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._legacy_req(["AAPL"]), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert result.total_trades == 0
        assert len(result.coverage_gaps) == 1
        gap = result.coverage_gaps[0]
        assert gap.symbol == "AAPL"
        assert gap.bars_have == 3
        assert gap.bars_need == 52  # slow_period(50) + 2

    @pytest.mark.asyncio
    async def test_getbars_called_with_normalized_timeframe(self):
        """AC-3: the GetBars call uses canonical "1d" + enum, not the legacy "1Day"."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock()]  # insufficient → short-circuits after GetBars
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        await svc.RunBacktest(self._legacy_req(["AAPL"]), context=MagicMock())

        called_req = svc._marketdata.GetBars.await_args.args[0]
        assert called_req.timeframe == "1d"
        assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY


# ---------------------------------------------------------------------------
# ListStrategies
# ---------------------------------------------------------------------------


class TestListStrategies:
    @pytest.mark.asyncio
    async def test_returns_empty_when_no_strategies(self):
        svc = make_servicer()
        req = MagicMock()
        resp = await svc.ListStrategies(req, context=MagicMock())
        assert len(resp.strategies) == 0

    @pytest.mark.asyncio
    async def test_returns_all_strategies(self):
        svc = make_servicer()
        svc._strategies["s1"] = analysis_pb2.StrategyScore(strategy_id="s1", overall_score=0.7)
        svc._strategies["s2"] = analysis_pb2.StrategyScore(strategy_id="s2", overall_score=0.5)

        req = MagicMock()
        resp = await svc.ListStrategies(req, context=MagicMock())
        assert len(resp.strategies) == 2


# ---------------------------------------------------------------------------
# GetStrategyReport
# ---------------------------------------------------------------------------


class TestGetStrategyReport:
    @pytest.mark.asyncio
    async def test_aborts_when_not_found(self):
        svc = make_servicer()
        req = MagicMock()
        req.strategy_id = "missing"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetStrategyReport(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_report_when_found(self):
        svc = make_servicer()
        svc._strategies["s1"] = analysis_pb2.StrategyScore(strategy_id="s1", overall_score=0.7)
        svc._backtests["s1"] = _make_backtest("s1")

        req = MagicMock()
        req.strategy_id = "s1"
        report = await svc.GetStrategyReport(req, context=MagicMock())
        assert report.strategy_id == "s1"


# ---------------------------------------------------------------------------
# ConfigWatcher getters (same _StubWatcher pattern as ingest)
# ---------------------------------------------------------------------------


class _StubWatcher(ConfigWatcher):
    def __init__(self):
        self.endpoint = "localhost:50060"
        self.namespace = "analysis"
        self._snapshot = None
        self._snapshot_event = asyncio.Event()


class TestConfigWatcherGetters:
    def test_get_str_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_str("any.key", default="x") == "x"

    def test_get_str_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_str("missing", default="d") == "d"

    def test_get_str_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(string_val="v"))
        w._snapshot = snap
        assert w.get_str("k") == "v"

    def test_get_int_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_int("k", default=5) == 5

    def test_get_int_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_int("k", default=7) == 7

    def test_get_int_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(int_val=42))
        w._snapshot = snap
        assert w.get_int("k") == 42

    def test_get_bool_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_bool("k", default=True) is True

    def test_get_bool_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_bool("k", default=False) is False

    def test_get_bool_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(bool_val=True))
        w._snapshot = snap
        assert w.get_bool("k") is True

    def test_get_float_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_float("k", default=1.5) == 1.5

    def test_get_float_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_float("k", default=2.5) == 2.5

    def test_get_float_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(float_val=0.75))
        w._snapshot = snap
        assert w.get_float("k") == 0.75

    def test_sandbox_timeout_default(self):
        w = _StubWatcher()
        assert w.sandbox_timeout_ms == 5000

    def test_sandbox_memory_default(self):
        w = _StubWatcher()
        assert w.sandbox_memory_bytes == 128 * 1024 * 1024

    def test_sandbox_allowed_imports_default(self):
        w = _StubWatcher()
        imports = w.sandbox_allowed_imports
        assert "numpy" in imports
        assert "pandas" in imports

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_succeeds(self):
        w = _StubWatcher()
        w._snapshot_event.set()
        await w.wait_for_snapshot(timeout_seconds=1.0)

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_timeout(self):
        w = _StubWatcher()
        with pytest.raises(RuntimeError, match="Timed out"):
            await w.wait_for_snapshot(timeout_seconds=0.01)


# ---------------------------------------------------------------------------
# Strategy management RPCs (feature 047-strategy-engine)
# ---------------------------------------------------------------------------


def _valid_definition(strategy_id="sma_x", display_name="SMA X"):
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name=display_name,
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fast",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 10.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "fast", "rhs": 100}),
    )


def _row_for(definition):
    return {
        "strategy_id": definition.strategy_id,
        "display_name": definition.display_name,
        "active": definition.active,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _admin_ctx():
    """A gRPC context carrying the admin x-access-scope bit (7 = READ|WRITE|ADMIN)."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=[("x-access-scope", "7")])
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


class TestManageStrategy:
    @pytest.mark.asyncio
    async def test_admin_gate_aborts_when_not_admin(self):
        svc = make_servicer()
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
            definition=_valid_definition(),
        )
        context = MagicMock()
        context.invocation_metadata = MagicMock(return_value=[("x-access-scope", "1")])  # READ only
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context)
        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_returns_definition(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.strategy_id == "sma_x"
        assert result.components[0].indicator == "SMA"
        svc._strategies_repo.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_path(self):
        svc = make_servicer()
        definition = _valid_definition(display_name="Renamed")
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.update = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.display_name == "Renamed"

    @pytest.mark.asyncio
    async def test_deactivate_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.deactivate = AsyncMock(return_value=None)
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
            definition=_valid_definition(),
        )
        context = _admin_ctx()
        context.abort = AsyncMock(side_effect=Exception("not found"))
        with pytest.raises(Exception, match="not found"):
            await svc.ManageStrategy(req, context)


class TestGetStrategy:
    @pytest.mark.asyncio
    async def test_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        req = analysis_pb2.GetStrategyRequest(strategy_id="missing")
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("not found"))
        with pytest.raises(Exception, match="not found"):
            await svc.GetStrategy(req, context)

    @pytest.mark.asyncio
    async def test_success(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.GetStrategyRequest(strategy_id="sma_x")
        result = await svc.GetStrategy(req, context=MagicMock())
        assert result.strategy_id == "sma_x"


class TestListStrategyDefinitions:
    @pytest.mark.asyncio
    async def test_empty_when_no_repo(self):
        svc = make_servicer()
        svc._strategies_repo = None
        req = analysis_pb2.ListStrategyDefinitionsRequest()
        resp = await svc.ListStrategyDefinitions(req, context=MagicMock())
        assert list(resp.definitions) == []
        assert resp.total_count == 0

    @pytest.mark.asyncio
    async def test_returns_definitions(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.list = AsyncMock(return_value=([_row_for(definition)], 1))
        req = analysis_pb2.ListStrategyDefinitionsRequest(include_inactive=False)
        resp = await svc.ListStrategyDefinitions(req, context=MagicMock())
        assert resp.total_count == 1
        assert resp.definitions[0].strategy_id == "sma_x"


class TestRunBacktestBackwardCompat:
    @pytest.mark.asyncio
    async def test_legacy_strategy_params_uses_sma_path(self):
        """A call with only strategy_params (no strategy_id_ref/inline) stays on the
        legacy SMA path (FR-8). Empty symbols → valid result without DB access."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "legacy"
        req.strategy_id_ref = ""  # no stored-strategy lookup
        req.symbols = []
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)  # no inline_definition, no strategy_params
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.strategy_id == "legacy"
        assert result.backtest_id
        assert "legacy" in svc._backtests


# ---------------------------------------------------------------------------
# SetStrategyLive (feature 048)
# ---------------------------------------------------------------------------


class TestSetStrategyLive:
    @pytest.mark.asyncio
    async def test_requires_admin_scope(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "1")]  # READ only
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        ctx.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_permits_admin_scope(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.set_live_enabled = AsyncMock(
            return_value={
                "strategy_id": "s1",
                "display_name": "S1",
                "active": True,
                "live_enabled": True,
                "definition_json": {},
            }
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # ADMIN|WRITE|READ
        resp = await svc.SetStrategyLive(req, ctx)
        assert resp.definition.strategy_id == "s1"
        assert resp.definition.live_enabled is True

    @pytest.mark.asyncio
    async def test_returns_not_found_for_missing_strategy(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=None)
        req = MagicMock()
        req.strategy_id = "missing"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)


# ---------------------------------------------------------------------------
# ScreenSymbols (feature 060)
# ---------------------------------------------------------------------------


class TestScreenSymbols:
    @staticmethod
    def _ctx():
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(
            return_value=[
                ("x-user-id", "u1"),
                ("x-access-scope", "7"),
                ("x-trace-id", "t1"),
            ]
        )
        return ctx

    @staticmethod
    def _svc():
        svc = make_servicer()
        # screener reads get_int — return the supplied defaults.
        svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
        return svc

    @staticmethod
    def _bars(closes):
        from types import SimpleNamespace

        from gen.marketdata.v1 import marketdata_pb2

        return SimpleNamespace(bars=[marketdata_pb2.Bar(close=c) for c in closes])

    @staticmethod
    def _formula_resp(value):
        from types import SimpleNamespace

        from google.protobuf.struct_pb2 import Struct

        out = Struct()
        out.update({"value": value})
        return SimpleNamespace(success=True, output=out, error="")

    @pytest.mark.asyncio
    async def test_ranks_universe_and_forwards_headers(self):
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._indicators.ExecuteFormula = AsyncMock(
            side_effect=[
                self._formula_resp([0.1]),
                self._formula_resp([0.9]),
                self._formula_resp([0.5]),
            ]
        )

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA", "BBB", "CCC"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="f1",
                    kind=analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
                    component=analysis_pb2.StrategyComponent(formula_id="fid"),
                    op=analysis_pb2.COMPARATOR_GT,
                    threshold=0.0,
                    weight=1.0,
                )
            ],
        )
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 3
        assert resp.results[0].symbol == "BBB"  # highest normalized value
        # Header propagation forwarded to the new ExecuteFormula call.
        meta = dict(svc._indicators.ExecuteFormula.await_args.kwargs["metadata"])
        assert meta["x-user-id"] == "u1"
        assert meta["x-trace-id"] == "t1"

    @pytest.mark.asyncio
    async def test_insufficient_data_marked_not_dropped(self):
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([]))  # no bars
        svc._indicators.ExecuteFormula = AsyncMock(return_value=self._formula_resp([0.5]))

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="f1",
                    kind=analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
                    component=analysis_pb2.StrategyComponent(formula_id="fid"),
                    op=analysis_pb2.COMPARATOR_GT,
                    threshold=0.0,
                )
            ],
        )
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 1
        assert resp.results[0].status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA

    @pytest.mark.asyncio
    async def test_fundamental_skipped_when_rpc_absent(self):
        """FR-5: a fundamental hard-filter is skipped (scan completes) when fundamentals fail."""
        import grpc
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=grpc.RpcError())

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
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 1
        assert "cheap" not in resp.results[0].criterion_scores
        assert resp.results[0].passed is True


# ---------------------------------------------------------------------------
# RunFundamentalsScan (feature 062)
# ---------------------------------------------------------------------------


def _scan_req(force=False, dry_run=False, symbols=()):
    req = MagicMock()
    req.force = force
    req.dry_run = dry_run
    req.symbols = list(symbols)
    return req


class TestRunFundamentalsScan:
    @pytest.mark.asyncio
    async def test_requires_admin_scope(self):
        svc = make_servicer()
        svc._fundsignal_loop = AsyncMock()
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "1")]  # READ only
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.RunFundamentalsScan(_scan_req(), ctx)
        ctx.abort.assert_called_once()
        svc._fundsignal_loop.run_once.assert_not_called()

    @pytest.mark.asyncio
    async def test_unavailable_when_loop_not_initialized(self):
        svc = make_servicer()
        svc._fundsignal_loop = None
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # admin
        ctx.abort = AsyncMock(side_effect=Exception("unavailable"))
        with pytest.raises(Exception, match="unavailable"):
            await svc.RunFundamentalsScan(_scan_req(), ctx)
        ctx.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_admin_happy_path_maps_summary(self):
        svc = make_servicer()
        summary = analysis_pb2.FundamentalsScanSummary(
            run_id="run-xyz",
            symbols_processed=10,
            signals_emitted=4,
            calls_spent=1,
            deferred_count=0,
            status="completed",
        )
        svc._fundsignal_loop = MagicMock()
        svc._fundsignal_loop.run_once = AsyncMock(return_value=summary)
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [
            ("x-access-scope", "7"),
            ("x-user-id", "u1"),
            ("x-trace-id", "t1"),
        ]
        resp = await svc.RunFundamentalsScan(_scan_req(symbols=["AAPL", "MSFT"]), ctx)
        assert resp.run_id == "run-xyz"
        assert resp.signals_emitted == 4
        assert resp.calls_spent == 1
        assert resp.deferred_count == 0
        assert resp.status == "completed"
        # Caller metadata is propagated and the explicit symbol override is forwarded.
        kwargs = svc._fundsignal_loop.run_once.call_args.kwargs
        assert kwargs["override_symbols"] == ["AAPL", "MSFT"]
        meta_keys = {k for k, _ in kwargs["metadata"]}
        assert meta_keys == {"x-access-scope", "x-user-id", "x-trace-id"}

    @pytest.mark.asyncio
    async def test_dry_run_passes_through(self):
        svc = make_servicer()
        svc._fundsignal_loop = MagicMock()
        svc._fundsignal_loop.run_once = AsyncMock(
            return_value=analysis_pb2.FundamentalsScanSummary(status="completed")
        )
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        await svc.RunFundamentalsScan(_scan_req(dry_run=True), ctx)
        assert svc._fundsignal_loop.run_once.call_args.kwargs["dry_run"] is True
        # No explicit symbols → override_symbols is None (use computed universe).
        assert svc._fundsignal_loop.run_once.call_args.kwargs["override_symbols"] is None


# ---------------------------------------------------------------------------
# Per-bar diagnostics (feature 064-backtest-debug-info) — Steps 8-11
# ---------------------------------------------------------------------------

from types import SimpleNamespace  # noqa: E402

from gen.indicators.v1 import indicators_pb2  # noqa: E402
from gen.marketdata.v1 import marketdata_pb2  # noqa: E402


def _bar(sec, close, o=None, h=None, low=None, vol=100):
    b = marketdata_pb2.Bar(
        open=o if o is not None else close,
        high=h if h is not None else close,
        low=low if low is not None else close,
        close=close,
        volume=vol,
        vwap=close,
    )
    b.time.seconds = sec
    return b


def _points(values):
    # servicer builds fast/slow dicts from points whose .value != 0
    return SimpleNamespace(result=[SimpleNamespace(value=v) for v in values])


class TestBacktestDiagnostics:
    def _svc_with(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(fast_series), _points(slow_series)]
        )
        return svc

    def _legacy_req(self, symbols=("AAPL",), fast=2, slow=3):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=list(symbols), initial_capital=100_000.0
        )
        req.strategy_params.update({"fast_period": fast, "slow_period": slow})
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    @pytest.mark.asyncio
    async def test_legacy_diagnostics_full_backtest(self):
        # 6 bars; fast=2, slow=3. Golden cross at bar 3 (entry), death cross at bar 5 (exit).
        bars = [_bar(1000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        fast = [0, 9, 10, 12, 13, 9]  # value 0 at idx0 = warm-up (excluded)
        slow = [0, 0, 11, 11, 11, 11]
        svc = self._svc_with(bars, fast, slow)

        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        assert len(result.diagnostics) == 1
        sd = result.diagnostics[0]
        # FR-1/2: one row per bar, bar 0 captured with correct OHLCV + timestamp
        assert sd.bars_total == 6
        assert len(sd.bars) == 6
        assert sd.bars[0].bar_index == 0
        assert sd.bars[0].close == 10.0
        assert sd.bars[0].timestamp.seconds == 1000
        # warm-up: warmup_bars = first bar where BOTH SMAs resolve (max(1, 2) = 2)
        assert sd.warmup_bars == 2
        assert sd.bars[0].warmup is True
        assert sd.bars[0].action == analysis_pb2.BAR_ACTION_WARMUP
        assert sd.bars[2].warmup is False
        # present-only indicators: bar 1 has sma_fast (idx1 resolved) but NOT sma_slow
        assert dict(sd.bars[1].indicators) == {"sma_fast": 9.0}
        assert dict(sd.bars[3].indicators) == {"sma_fast": 12.0, "sma_slow": 11.0}
        # AC-3: ENTER/EXIT bars match the TradeRecord entry/exit times
        assert len(result.trades) == 1
        trade = result.trades[0]
        assert sd.bars[3].action == analysis_pb2.BAR_ACTION_ENTER_LONG
        assert sd.bars[3].timestamp.seconds == trade.entry_time.seconds
        assert sd.bars[5].action == analysis_pb2.BAR_ACTION_EXIT_LONG
        assert sd.bars[5].timestamp.seconds == trade.exit_time.seconds
        assert sd.bars[4].action == analysis_pb2.BAR_ACTION_HOLD_LONG
        # traded symbol → no_trade_reason UNSPECIFIED
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_UNSPECIFIED

    @pytest.mark.asyncio
    async def test_no_trade_reason_entry_never_true(self):
        # fast never crosses above slow → 0 trades, past warm-up → ENTRY_NEVER_TRUE
        bars = [_bar(2000 + i, c) for i, c in enumerate([10, 10, 10, 10, 10])]
        fast = [0, 8, 8, 8, 8]
        slow = [0, 0, 11, 11, 11]
        svc = self._svc_with(bars, fast, slow)
        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        assert result.total_trades == 0
        sd = result.diagnostics[0]
        assert sd.warmup_bars < sd.bars_total
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE

    @pytest.mark.asyncio
    async def test_ledger_completed_event_has_no_diagnostics(self):
        # AC-5: the completion ledger payload carries only summary metrics, never diagnostics.
        bars = [_bar(3000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc = self._svc_with(bars, [0, 9, 10, 12, 13, 9], [0, 0, 11, 11, 11, 11])
        await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        completed = svc._ledger.AppendEvent.await_args_list[-1].args[0]
        assert completed.event_type == "analysis.backtest.completed"
        assert "diagnostics" not in dict(completed.payload.fields)

    @pytest.mark.asyncio
    async def test_no_look_ahead_warmup_and_series(self):
        # AC-4: a bar's warmup flag + indicators are identical whether the range ends there
        # or extends beyond it.
        full = [_bar(4000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc_full = self._svc_with(full, [0, 9, 10, 12, 13, 9], [0, 0, 11, 11, 11, 11])
        r_full = await svc_full.RunBacktest(self._legacy_req(), context=MagicMock())
        trunc = full[:5]
        svc_tr = self._svc_with(trunc, [0, 9, 10, 12, 13], [0, 0, 11, 11, 11])
        r_tr = await svc_tr.RunBacktest(self._legacy_req(), context=MagicMock())
        for i in range(5):
            a, b = r_full.diagnostics[0].bars[i], r_tr.diagnostics[0].bars[i]
            assert a.warmup == b.warmup
            assert dict(a.indicators) == dict(b.indicators)

    @pytest.mark.asyncio
    async def test_insufficient_data_yields_no_diagnostics_mislabel(self):
        # FR-9: insufficient-data symbols become CoverageGap, never a no_trade_reason mislabel.
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar(1, 10), _bar(2, 11), _bar(3, 12)])
        )
        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert len(result.coverage_gaps) == 1
        assert len(result.diagnostics) == 0  # never entered the bar loop

    def _def_req(self, definition):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
        )
        req.inline_definition.CopyFrom(definition)
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    @pytest.mark.asyncio
    async def test_evaluated_indicators_drops_value_alias(self):
        bars = [_bar(5000 + i, c) for i, c in enumerate([10, 20, 30])]
        definition = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="bb",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="BB",
                    params={"period": 2.0},
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "bb.upper", "rhs": 100}),
        )
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(
                result=[
                    SimpleNamespace(value=10.0, extra={"upper": 15.0, "lower": 5.0}),
                    SimpleNamespace(value=20.0, extra={"upper": 25.0, "lower": 15.0}),
                    SimpleNamespace(value=30.0, extra={"upper": 35.0, "lower": 25.0}),
                ]
            )
        )
        result = await svc.RunBacktest(self._def_req(definition), context=MagicMock())
        keys = set(dict(result.diagnostics[0].bars[2].indicators))
        assert "bb" in keys and "bb.upper" in keys and "bb.lower" in keys
        assert "bb.value" not in keys  # redundant alias dropped

    @pytest.mark.asyncio
    async def test_formula_warmup_uses_declared_not_observed(self):
        # An all-None formula primary series must NOT inflate warmup to len(bars); the declared
        # warmup_period (via GetFormula) is used → ENTRY_NEVER_TRUE, not ENTIRE_RANGE_WARMUP.
        bars = [_bar(6000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        definition = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=bars))
        svc._indicators = MagicMock()
        # formula execution "fails" → primary series is all None
        svc._indicators.ExecuteFormula = AsyncMock(
            return_value=SimpleNamespace(success=False, output={}, error="boom")
        )
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=3)
        )
        result = await svc.RunBacktest(self._def_req(definition), context=MagicMock())
        sd = result.diagnostics[0]
        assert sd.warmup_bars == 3  # declared, not len(bars)=6
        assert result.total_trades == 0
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE
        svc._indicators.GetFormula.assert_awaited()


class TestBacktestRangeCap:
    def _svc(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        # enough bars so the legacy path runs (>= slow_period(3)+2); values irrelevant here
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar(1000 + i, 10) for i in range(6)])
        )
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=lambda *a, **k: _points([0, 9, 10, 11, 12, 13])
        )
        return svc

    def _req(self, start_sec, end_sec):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
        )
        req.strategy_params.update({"fast_period": 2, "slow_period": 3})
        if start_sec is not None:
            req.range.start.seconds = start_sec
        if end_sec is not None:
            req.range.end.seconds = end_sec
        return req

    @pytest.mark.asyncio
    async def test_over_cap_range_rejected(self):
        # span 800 days > 730-day cap → INVALID_ARGUMENT (AC-7)
        svc = self._svc()
        ctx = MagicMock()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        req = self._req(1, 800 * 86_400)
        with pytest.raises(Exception):
            await svc.RunBacktest(req, ctx)
        assert ctx.abort.await_args.args[0].name == "INVALID_ARGUMENT"

    @pytest.mark.asyncio
    async def test_at_cap_range_runs(self):
        svc = self._svc()
        req = self._req(1, 700 * 86_400)  # 700 days < 730 cap
        result = await svc.RunBacktest(req, MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK

    @pytest.mark.asyncio
    async def test_unset_range_defaulted_to_cap_window(self):
        svc = self._svc()
        req = self._req(None, None)  # both unset (agent case)
        result = await svc.RunBacktest(req, MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        # the range was defaulted in place to a ~730-day window ending "now"
        span = req.range.end.seconds - req.range.start.seconds
        assert span == 730 * 86_400
        assert req.range.end.seconds > 0
# Score persistence + hydrate (feature 064 — persist-strategy-scores)
# ---------------------------------------------------------------------------


class TestScorePersistence:
    @pytest.mark.asyncio
    async def test_score_persists_via_upsert(self):
        svc = make_servicer()
        svc._backtests["s"] = _make_backtest("s", sharpe=1.5, drawdown=0.05, win_rate=0.65)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        svc._scores_repo.upsert.assert_awaited_once()
        args = svc._scores_repo.upsert.await_args.args
        assert args[0] == "s"
        assert args[1] == pytest.approx(score.overall_score)
        assert args[2] == score.rating
        assert set(args[3].keys()) == {"sharpe", "drawdown", "win_rate"}

    @pytest.mark.asyncio
    async def test_fr7_persist_failure_does_not_lose_read(self):
        """A swallowed DB write still returns the score AND keeps it readable (AC-6)."""
        svc = make_servicer()
        svc._backtests["s"] = _make_backtest("s", sharpe=1.5, drawdown=0.05, win_rate=0.65)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()
        svc._scores_repo.upsert.side_effect = Exception("db down")

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        # No abort/raise — the score is returned despite the write failure.
        assert score.strategy_id == "s"
        # Reads serve from memory, so the caller reads its own write back.
        resp = await svc.ListStrategies(MagicMock(), context=MagicMock())
        assert any(s.strategy_id == "s" for s in resp.strategies)

    @pytest.mark.asyncio
    async def test_hydrate_scores_populates_memory_from_db(self):
        """Restart-survivability proof (AC-1/AC-7): DB rows -> in-memory dict."""
        svc = make_servicer()
        svc._scores_repo = AsyncMock()
        svc._scores_repo.list = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "overall_score": 0.82,
                    "rating": "A",
                    "component_scores": {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6},
                }
            ]
        )

        await svc.hydrate_scores()

        assert "s1" in svc._strategies
        got = svc._strategies["s1"]
        assert got.overall_score == pytest.approx(0.82)
        assert got.rating == "A"
        assert dict(got.component_scores) == pytest.approx(
            {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6}
        )

    @pytest.mark.asyncio
    async def test_hydrate_scores_noop_without_repo(self):
        svc = make_servicer()  # no db_pool -> _scores_repo is None
        assert svc._scores_repo is None
        await svc.hydrate_scores()  # must not raise
        assert svc._strategies == {}

    def test_row_to_score_roundtrip(self):
        from app.handlers.servicer import _row_to_score

        row = {
            "strategy_id": "s1",
            "overall_score": 0.5,
            "rating": "C",
            "component_scores": {"sharpe": 0.4, "drawdown": 0.6},
        }
        score = _row_to_score(row)
        assert score.strategy_id == "s1"
        assert score.overall_score == pytest.approx(0.5)
        assert score.rating == "C"
        assert dict(score.component_scores) == pytest.approx({"sharpe": 0.4, "drawdown": 0.6})
