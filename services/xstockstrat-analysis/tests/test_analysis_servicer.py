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
