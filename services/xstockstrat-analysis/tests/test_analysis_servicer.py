"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
import inspect
import json
import logging
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from gen.ingest.v1 import ingest_pb2
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer, _InsufficientData
from app.services import warmup as warmup_sizing
from app.services.evaluator import FormulaExecutionError, StrategyEvaluator


def make_servicer() -> AnalysisServicer:
    """Return an AnalysisServicer with fully mocked dependencies."""
    cfg = MagicMock()
    # Make get_float return the default argument (mirrors real watcher behaviour)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    # feature 116: get_int_present (not get_int) is used for exit_cooldown_days' platform
    # default, since a configured 0 is meaningful and must not be zero-trapped.
    cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)
    # feature 022: get_float_present backs the signal-decay half-life (a configured 0 disables
    # decay and must not be zero-trapped). Default → no override, so existing signal fixtures
    # (no ingested_at → age unknown → decay_multiplier 1.0) are unaffected.
    cfg.get_float_present = MagicMock(side_effect=lambda key, default: default)
    return AnalysisServicer(
        cfg,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )


def _owned_ctx():
    """A gRPC context carrying x-user-id (feature 133) so ownership-gated RPCs resolve a caller."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(
        return_value=[("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]
    )
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


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


def _eligible_cell(symbol="AAPL", days=100, sharpe=2.0, drawdown=0.0, win_rate=1.0, trades=3):
    """A backtest_run_symbols row as fetch_eligible would return it (feature 065)."""
    return {
        "symbol": symbol,
        "sharpe_ratio": sharpe,
        "max_drawdown": drawdown,
        "win_rate": win_rate,
        "total_return": 0.12,
        "total_trades": trades,
        "trading_days": days,
    }


def _derivation_svc(cells, definition_json=None, strategy_id="s1"):
    """A no-DB servicer wired with a registered strategy row + a cells repo returning ``cells``.

    Reproduces the derived-headline path (feature 065): ScoreStrategy / recompute resolve the
    strategy row, read eligible cells, aggregate, and persist through the score funnel.
    """
    svc = make_servicer()
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._strategies_repo = AsyncMock()
    _drow = {
        "strategy_id": strategy_id,
        "user_id": "u1",
        "display_name": "S1",
        "active": True,
        "live_enabled": False,
        "definition_json": definition_json or {"entry_rule": "x"},
    }
    svc._strategies_repo.get_by_id = AsyncMock(return_value=_drow)
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_drow)
    # feature 133: ListStrategies owner-filters against repo.list(user_id); return this strategy.
    svc._strategies_repo.list = AsyncMock(return_value=([{"strategy_id": strategy_id}], 1))
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(return_value=cells)
    svc._scores_repo = AsyncMock()
    return svc


# ---------------------------------------------------------------------------
# ScoreStrategy
# ---------------------------------------------------------------------------


# feature 071: GetBars is paged now, so a fake response must carry a page whose token says
# "no more pages" — an auto-created MagicMock token would read as "another page exists".
_EOF_PAGE = SimpleNamespace(next_page_token="")


class TestScoreFromMetrics:
    """Grade-blend + letter-grade math (extracted from the old _score_from_result, feature 065)."""

    def test_blend_and_components(self):
        from app.handlers.servicer import _score_from_metrics

        overall, comps = _score_from_metrics(1.0, 0.2, 0.5, 0.4, 0.3, 0.3)
        # sharpe 1.0/2=0.5; drawdown 1-0.2/0.5=0.6; win_rate 0.5
        assert comps == pytest.approx({"sharpe": 0.5, "drawdown": 0.6, "win_rate": 0.5})
        assert overall == pytest.approx(0.4 * 0.5 + 0.3 * 0.6 + 0.3 * 0.5)

    def test_components_clamped(self):
        from app.handlers.servicer import _score_from_metrics

        _, comps = _score_from_metrics(10.0, 1.0, 5.0, 0.4, 0.3, 0.3)
        assert comps["sharpe"] == 1.0  # clamped
        assert comps["drawdown"] == 0.0  # 1 - 1/0.5 = -1 → 0
        assert comps["win_rate"] == 1.0  # clamped

    @pytest.mark.parametrize(
        "overall,grade",
        [
            (0.85, "A"),
            (0.8, "A"),
            (0.7, "B"),
            (0.65, "B"),
            (0.55, "C"),
            (0.5, "C"),
            (0.4, "D"),
            (0.35, "D"),
            (0.2, "F"),
            (0.0, "F"),
        ],
    )
    def test_grade_thresholds(self, overall, grade):
        from app.handlers.servicer import _grade

        assert _grade(overall) == grade


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

        result = await svc.RunBacktest(req, context=_owned_ctx())
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
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._legacy_req(["AAPL"]), context=_owned_ctx())

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
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        await svc.RunBacktest(self._legacy_req(["AAPL"]), context=_owned_ctx())

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
        resp = await svc.ListStrategies(req, context=_owned_ctx())
        assert len(resp.strategies) == 0

    @pytest.mark.asyncio
    async def test_returns_all_strategies(self):
        svc = make_servicer()
        svc._strategies["s1"] = analysis_pb2.StrategyScore(strategy_id="s1", overall_score=0.7)
        svc._strategies["s2"] = analysis_pb2.StrategyScore(strategy_id="s2", overall_score=0.5)

        req = MagicMock()
        resp = await svc.ListStrategies(req, context=_owned_ctx())
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
        report = await svc.GetStrategyReport(req, context=_owned_ctx())
        assert report.strategy_id == "s1"


# ---------------------------------------------------------------------------
# RunBacktest auto-scoring + run-history persistence
# ---------------------------------------------------------------------------


class TestRunBacktestPersistence:
    def _empty_req(self, strategy_id="s1", symbols=None):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.symbols = symbols if symbols is not None else []
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_ok_run_no_longer_upserts_per_run_headline(self):
        """feature 065: the headline is DERIVED from evidence cells, not upserted per-run.
        With no strategy registered (no strategies_repo), an OK run records history + cells but
        writes NO headline score (the derivation recompute early-returns for an ad-hoc id)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        # No per-run headline upsert — the run's own aggregate never becomes the grade.
        svc._scores_repo.upsert.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ok_run_appends_history_row(self):
        """Every OK run is appended to the durable history table with its score."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1", ["AAPL"]), context=_owned_ctx())

        svc._backtest_runs_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["backtest_id"] == result.backtest_id
        assert kwargs["strategy_id"] == "s1"
        assert kwargs["status"] == "BACKTEST_STATUS_OK"
        assert kwargs["symbols"] == ["AAPL"]
        assert kwargs["overall_score"] is not None
        assert kwargs["rating"] in ("A", "B", "C", "D", "F")

    @pytest.mark.asyncio
    async def test_insufficient_run_records_history_without_score(self):
        """An INSUFFICIENT_DATA run is still recorded in history, but earns no score."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()
        svc._backtest_runs_repo = AsyncMock()
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few → INSUFFICIENT_DATA
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        req = self._empty_req("s1", ["AAPL"])
        result = await svc.RunBacktest(req, context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._scores_repo.upsert.assert_not_awaited()  # no score for an unusable run
        svc._backtest_runs_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["status"] == "BACKTEST_STATUS_INSUFFICIENT_DATA"
        assert kwargs["overall_score"] is None
        assert kwargs["rating"] is None

    @pytest.mark.asyncio
    async def test_score_persist_failure_never_fails_run(self):
        """A DB error while persisting the score/history is swallowed — the run still returns."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()
        svc._scores_repo.upsert = AsyncMock(side_effect=Exception("db down"))
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.insert = AsyncMock(side_effect=Exception("db down"))

        result = await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())
        assert result.strategy_id == "s1"


class TestListBacktests:
    def _row(self, backtest_id="bt-1", status="BACKTEST_STATUS_OK", overall=0.72, rating="B"):
        return {
            "backtest_id": backtest_id,
            "strategy_id": "s1",
            "status": status,
            "completed_at": None,
            "symbols": ["AAPL"],
            "total_return": 0.12,
            "annualized_return": 0.1,
            "sharpe_ratio": 1.5,
            "max_drawdown": 0.08,
            "win_rate": 0.6,
            "total_trades": 4,
            "profit_factor": 1.3,
            "overall_score": overall,
            "rating": rating,
        }

    @pytest.mark.asyncio
    async def test_returns_typed_summaries(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(
            return_value=[self._row("bt-2"), self._row("bt-1")]
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0  # → server default
        resp = await svc.ListBacktests(req, context=_owned_ctx())

        assert [r.backtest_id for r in resp.runs] == ["bt-2", "bt-1"]
        assert resp.runs[0].status == analysis_pb2.BACKTEST_STATUS_OK
        assert resp.runs[0].rating == "B"
        assert resp.runs[0].symbols == ["AAPL"]
        # limit 0 defaults to 20 at the servicer.
        assert svc._backtest_runs_repo.list_by_strategy.await_args.kwargs["limit"] == 20

    @pytest.mark.asyncio
    async def test_honours_explicit_limit(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(return_value=[])
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 5
        await svc.ListBacktests(req, context=_owned_ctx())
        assert svc._backtest_runs_repo.list_by_strategy.await_args.kwargs["limit"] == 5

    @pytest.mark.asyncio
    async def test_insufficient_run_maps_to_zero_score(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(
            return_value=[
                self._row(status="BACKTEST_STATUS_INSUFFICIENT_DATA", overall=None, rating=None)
            ]
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0
        resp = await svc.ListBacktests(req, context=_owned_ctx())
        assert resp.runs[0].status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert resp.runs[0].overall_score == 0.0
        assert resp.runs[0].rating == ""

    @pytest.mark.asyncio
    async def test_no_repo_returns_empty(self):
        svc = make_servicer()  # no DB → _backtest_runs_repo is None
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0
        resp = await svc.ListBacktests(req, context=_owned_ctx())
        assert list(resp.runs) == []


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

    # feature 022 — get_float_present: presence-aware read that does NOT collapse a stored 0.0.
    def test_get_float_present_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_float_present("k", 24.0) == 24.0

    def test_get_float_present_missing_key_returns_default(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_float_present("k", 24.0) == 24.0

    def test_get_float_present_positive_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(float_val=12.5))
        w._snapshot = snap
        assert w.get_float_present("k", 24.0) == 12.5

    def test_get_float_present_explicit_zero_is_not_trapped(self):
        # FR-3 rollback contract: a configured 0.0 disables decay and must survive the read;
        # get_float would collapse it to the default 24.0 (the zero-trap this method fixes).
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(float_val=0.0))
        w._snapshot = snap
        assert w.get_float_present("k", 24.0) == 0.0
        assert w.get_float("k", 24.0) == 24.0  # contrast: the old zero-trap

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
    ctx.invocation_metadata = MagicMock(return_value=[("x-user-id", "u1"), ("x-access-scope", "7")])
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
        context.invocation_metadata = MagicMock(
            return_value=[("x-user-id", "u1"), ("x-access-scope", "1")]
        )  # READ only
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context)
        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_returns_definition(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)  # feature 089: not existing
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
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
        _stub_update_repo(svc, _row_for(definition))
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
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
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
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.GetStrategyRequest(strategy_id="sma_x")
        result = await svc.GetStrategy(req, context=_owned_ctx())
        assert result.strategy_id == "sma_x"


class TestListStrategyDefinitions:
    @pytest.mark.asyncio
    async def test_empty_when_no_repo(self):
        svc = make_servicer()
        svc._strategies_repo = None
        req = analysis_pb2.ListStrategyDefinitionsRequest()
        resp = await svc.ListStrategyDefinitions(req, context=_owned_ctx())
        assert list(resp.definitions) == []
        assert resp.total_count == 0

    @pytest.mark.asyncio
    async def test_returns_definitions(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.list = AsyncMock(return_value=([_row_for(definition)], 1))
        req = analysis_pb2.ListStrategyDefinitionsRequest(include_inactive=False)
        resp = await svc.ListStrategyDefinitions(req, context=_owned_ctx())
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

        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.strategy_id == "legacy"
        assert result.backtest_id
        assert "legacy" in svc._backtests


# ---------------------------------------------------------------------------
# Technical-only backtest scoring (feature 097, Option 2 — Step 14/15)
# ---------------------------------------------------------------------------


class TestBacktestTechnicalOnly:
    """The strategy backtest score is technical-only: a strategy_params signal blend no longer
    affects the score, and RunBacktest no longer fetches signals. Red against the pre-097 tree,
    where signal_weight>0 blended a signal_score into conviction and called QuerySignals."""

    # 6 bars; fast=2, slow=3 → golden cross (entry) then death cross (exit): a real trade whose
    # conviction a blend WOULD have moved.
    _BARS = [(10, 11, 12, 13, 14, 9)]
    _FAST = [9, 10, 12, 13, 9]
    _SLOW = [11, 11, 11, 11]

    def _svc(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        bars = [_bar(1000 + i, c) for i, c in enumerate(self._BARS[0])]
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(self._FAST), _points(self._SLOW)]
        )
        # A QuerySignals spy — it must NOT be called from the backtest scoring path anymore.
        svc._ingest = MagicMock()
        svc._ingest.QuerySignals = AsyncMock(
            return_value=SimpleNamespace(signals=[], page=_EOF_PAGE)
        )
        return svc

    def _req(self, *, with_signals):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
        )
        params = {"fast_period": 2, "slow_period": 3}
        if with_signals:
            params.update({"signal_sources": ["uw"], "signal_weight": 0.8, "technical_weight": 0.2})
        req.strategy_params.update(params)
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    @pytest.mark.asyncio
    async def test_signal_params_do_not_change_the_score(self):
        """AC-4: a signal-weighted strategy_params produces the SAME result as one without it —
        the blend no longer affects a strategy's internal score."""
        r_plain = await self._svc().RunBacktest(self._req(with_signals=False), MagicMock())
        r_signal = await self._svc().RunBacktest(self._req(with_signals=True), MagicMock())
        assert r_plain.status == analysis_pb2.BACKTEST_STATUS_OK
        assert r_signal.total_trades == r_plain.total_trades
        assert abs(r_signal.total_return - r_plain.total_return) < 1e-12
        assert abs(r_signal.sharpe_ratio - r_plain.sharpe_ratio) < 1e-12
        assert abs(r_signal.max_drawdown - r_plain.max_drawdown) < 1e-12
        # Per-bar conviction is the pure-technical mapping, identical either way.
        plain_conv = [b.conviction for b in r_plain.diagnostics[0].bars]
        signal_conv = [b.conviction for b in r_signal.diagnostics[0].bars]
        assert plain_conv == signal_conv
        assert all(b.signal_score == 0.0 for b in r_signal.diagnostics[0].bars)

    @pytest.mark.asyncio
    async def test_signal_weighted_run_does_not_query_signals(self):
        """A signal-weighted strategy_params no longer triggers a QuerySignals call from the
        backtest path (the fetch was removed with the blend)."""
        svc = self._svc()
        await svc.RunBacktest(self._req(with_signals=True), MagicMock())
        assert svc._ingest.QuerySignals.await_count == 0

    def test_screener_still_blends_via_scoring(self):
        """FR-4: scoring.combine_score is retained (unused by RunBacktest now) and still used by
        the screener — deleting it was rejected in design."""
        from app.services import scoring
        from app.services import screener as screener_module

        # The blend function is intact and still blends when signals are weighted + present.
        blended = scoring.combine_score(1.0, 0.2, 0.8, 0.2, signals_present=True)
        pure_tech = scoring.combine_score(1.0, 0.2, 0.0, 1.0, signals_present=False)
        assert blended != pure_tech
        # And the screener path still references it (the retained consumer).
        assert "combine_score" in inspect.getsource(screener_module)


# ---------------------------------------------------------------------------
# SetStrategyLive (feature 048)
# ---------------------------------------------------------------------------


class TestSetStrategyLive:
    @pytest.mark.asyncio
    async def test_unauthenticated_caller_denied(self):
        # feature 133: admin scope no longer gates SetStrategyLive — but an unauthenticated caller
        # (no x-user-id) can never own a strategy, so the live toggle is PERMISSION_DENIED.
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # no x-user-id
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_permits_admin_scope(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        # Feature 089: enabling precondition-checks active + signal_params.symbols via get_by_id.
        live_row = {
            "strategy_id": "s1",
            "display_name": "S1",
            "active": True,
            "live_enabled": True,
            "definition_json": {"strategy_id": "s1", "signal_params": {"symbols": ["AAPL"]}},
        }
        svc._strategies_repo.get_by_id = AsyncMock(return_value=live_row)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=live_row)
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=live_row)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [
            ("x-user-id", "u1"),
            ("x-access-scope", "7"),
        ]  # ADMIN|WRITE|READ
        resp = await svc.SetStrategyLive(req, ctx)
        assert resp.definition.strategy_id == "s1"
        assert resp.definition.live_enabled is True

    @pytest.mark.asyncio
    async def test_returns_not_found_for_missing_strategy(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        # Feature 089: on enable the NOT_FOUND now comes from the get_by_id precondition fetch.
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=None)
        req = MagicMock()
        req.strategy_id = "missing"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-user-id", "u1"), ("x-access-scope", "7")]
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
        # feature 083 — the screener now computes RSI/ATR raw columns per symbol; give the
        # indicators stub an awaitable ComputeIndicator so those best-effort calls succeed.
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(result=[SimpleNamespace(value=1.0)])
        )
        # feature 134 — ScreenSymbols now sources weights from ingest ListSignalSources (FR-4
        # repoint off the analysis.signals.source_weights config key). Empty → neutral 1.0.
        svc._ingest = MagicMock()
        svc._ingest.ListSignalSources = AsyncMock(return_value=SimpleNamespace(sources=[]))
        return svc

    @staticmethod
    def _bars(closes):
        from types import SimpleNamespace

        from gen.marketdata.v1 import marketdata_pb2

        return SimpleNamespace(page=_EOF_PAGE, bars=[marketdata_pb2.Bar(close=c) for c in closes])

    @staticmethod
    def _formula_resp(value):
        from types import SimpleNamespace

        from google.protobuf.struct_pb2 import Struct

        out = Struct()
        out.update({"value": value})
        return SimpleNamespace(success=True, output=out, error="")

    @pytest.mark.asyncio
    async def test_repoints_off_config_to_ingest_reliability_weights(self):
        """feature 134 FR-4 (genuine replace): ScreenSymbols no longer reads
        analysis.signals.source_weights from config — it sources the weight map from ingest
        ListSignalSources and passes it into ScreenerEngine unchanged."""
        from unittest.mock import patch

        svc = self._svc()
        svc._portfolio = None  # skip the held cross-ref
        svc._ingest.ListSignalSources = AsyncMock(
            return_value=SimpleNamespace(
                sources=[SimpleNamespace(slug="uw", reliability_weight=0.5)]
            )
        )
        captured = {}

        class _FakeEngine:
            def __init__(self, _md, _ind, _ing, _cfg, source_weights):
                captured["weights"] = source_weights

            async def screen(self, _request, _meta):
                return SimpleNamespace(results=[])

        req = analysis_pb2.ScreenSymbolsRequest(symbols=["AAA"])
        with patch("app.handlers.servicer.ScreenerEngine", _FakeEngine):
            await svc.ScreenSymbols(req, self._ctx())
        # The ingest-derived weight map reached the engine.
        assert captured["weights"] == {"uw": 0.5}
        # The now-inert config key is never consulted (the repoint, not a fallback).
        called_keys = [c.args[0] for c in svc._cfg.get_str.call_args_list if c.args]
        assert "analysis.signals.source_weights" not in called_keys

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
    async def test_fundamental_unavailable_yields_insufficient_data_not_a_silent_pass(self):
        """Bug fix: a fundamental criterion whose data source failed must report
        INSUFFICIENT_DATA/passed=false, never a misleading OK/passed=true."""
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
        assert resp.results[0].status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
        assert resp.results[0].passed is False

    @pytest.mark.asyncio
    async def test_unknown_metric_aborts_invalid_argument(self):
        """feature 090: a fundamental metric_name typo → INVALID_ARGUMENT, not a silent skip."""
        from gen.analysis.v1 import analysis_pb2
        from gen.marketdata.v1 import marketdata_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._marketdata.GetFundamentalsMulti = AsyncMock(
            return_value=SimpleNamespace(
                fundamentals=[marketdata_pb2.Fundamentals(symbol="AAA", pe_ratio=15.0)]
            )
        )
        ctx = self._ctx()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))

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
        with pytest.raises(Exception, match="aborted"):
            await svc.ScreenSymbols(req, ctx)
        assert ctx.abort.await_args.args[0].name == "INVALID_ARGUMENT"


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
        ctx.invocation_metadata.return_value = [
            ("x-user-id", "u1"),
            ("x-access-scope", "1"),
        ]  # READ only
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
        ctx.invocation_metadata.return_value = [
            ("x-user-id", "u1"),
            ("x-access-scope", "7"),
        ]  # admin
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
        ctx.invocation_metadata.return_value = [("x-user-id", "u1"), ("x-access-scope", "7")]
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
    # Real ComputeIndicator contract: warm-up rows are omitted from the result, so a
    # shorter list describes the LAST len(values) bars (the servicer tail-aligns it).
    return SimpleNamespace(result=[SimpleNamespace(value=v) for v in values])


class TestBacktestDiagnostics:
    def _svc_with(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
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
        fast = [9, 10, 12, 13, 9]  # 5 points → warm-up row dropped, tail-aligned to bars 1..5
        slow = [11, 11, 11, 11]  # 4 points → bars 2..5
        svc = self._svc_with(bars, fast, slow)

        result = await svc.RunBacktest(self._legacy_req(), context=_owned_ctx())

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
        fast = [8, 8, 8, 8]
        slow = [11, 11, 11]
        svc = self._svc_with(bars, fast, slow)
        result = await svc.RunBacktest(self._legacy_req(), context=_owned_ctx())
        assert result.total_trades == 0
        sd = result.diagnostics[0]
        assert sd.warmup_bars < sd.bars_total
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE

    @pytest.mark.asyncio
    async def test_ledger_completed_event_has_no_diagnostics(self):
        # AC-5: the completion ledger payload carries only summary metrics, never diagnostics.
        bars = [_bar(3000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc = self._svc_with(bars, [9, 10, 12, 13, 9], [11, 11, 11, 11])
        await svc.RunBacktest(self._legacy_req(), context=_owned_ctx())
        completed = svc._ledger.AppendEvent.await_args_list[-1].args[0]
        assert completed.event_type == "analysis.backtest.completed"
        assert "diagnostics" not in dict(completed.payload.fields)

    @pytest.mark.asyncio
    async def test_no_look_ahead_warmup_and_series(self):
        # AC-4: a bar's warmup flag + indicators are identical whether the range ends there
        # or extends beyond it.
        full = [_bar(4000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc_full = self._svc_with(full, [9, 10, 12, 13, 9], [11, 11, 11, 11])
        r_full = await svc_full.RunBacktest(self._legacy_req(), context=_owned_ctx())
        trunc = full[:5]
        svc_tr = self._svc_with(trunc, [9, 10, 12, 13], [11, 11, 11])
        r_tr = await svc_tr.RunBacktest(self._legacy_req(), context=_owned_ctx())
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
            return_value=SimpleNamespace(
                page=_EOF_PAGE, bars=[_bar(1, 10), _bar(2, 11), _bar(3, 12)]
            )
        )
        result = await svc.RunBacktest(self._legacy_req(), context=_owned_ctx())
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
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
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
        result = await svc.RunBacktest(self._def_req(definition), context=_owned_ctx())
        keys = set(dict(result.diagnostics[0].bars[2].indicators))
        assert "bb" in keys and "bb.upper" in keys and "bb.lower" in keys
        assert "bb.value" not in keys  # redundant alias dropped

    @pytest.mark.asyncio
    async def test_formula_warmup_uses_declared_not_observed(self):
        # An all-None formula primary series must NOT inflate warmup to len(bars); the declared
        # warmup_period (via GetFormula) is used → ENTRY_NEVER_TRUE, not ENTIRE_RANGE_WARMUP.
        # feature 067: an all-null (warm-up) series is produced legitimately (success=True with
        # a length-n null "value"), not via success=False — a failed formula now raises
        # FormulaExecutionError (→ NO_TRADE_REASON_FORMULA_ERROR), a distinct outcome.
        from google.protobuf.struct_pb2 import Struct

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
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        # A legitimate all-warm-up series: success=True with a full-length null "value".
        out = Struct()
        out.update({"value": [None] * len(bars)})
        svc._indicators.ExecuteFormula = AsyncMock(
            return_value=SimpleNamespace(success=True, output=out, error="")
        )
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=3)
        )
        result = await svc.RunBacktest(self._def_req(definition), context=_owned_ctx())
        sd = result.diagnostics[0]
        assert sd.warmup_bars == 3  # declared, not len(bars)=6
        assert result.total_trades == 0
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE
        svc._indicators.GetFormula.assert_awaited()


class TestFormulaErrorSurfacing:
    """feature 067 — a failing custom-formula surfaces a distinct FORMULA_ERROR diagnostic,
    and an all-failed run reports INSUFFICIENT_DATA without persisting a spurious score."""

    def _req(self, definition, symbols):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=symbols, initial_capital=100_000.0
        )
        req.inline_definition.CopyFrom(definition)
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    def _formula_def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )

    def _wire(self, svc, bars, execute_side_effect):
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ExecuteFormula = AsyncMock(side_effect=execute_side_effect)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=0)
        )

    @pytest.mark.asyncio
    async def test_partial_run_stamps_formula_error_and_keeps_sibling(self):
        from google.protobuf.struct_pb2 import Struct

        bars = [_bar(7000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        ok_out = Struct()
        ok_out.update({"value": [1.0] * len(bars)})  # sibling trades (ff > 0)
        # AAPL formula fails (success=False → FormulaExecutionError); MSFT succeeds.
        side_effect = [
            SimpleNamespace(success=False, output=Struct(), error="boom"),
            SimpleNamespace(success=True, output=ok_out, error=""),
        ]
        svc = make_servicer()
        self._wire(svc, bars, side_effect)
        persisted_cells = {}

        async def _spy(cells, **kw):
            persisted_cells["cells"] = list(cells)

        svc._persist_symbol_cells = AsyncMock(side_effect=_spy)

        result = await svc.RunBacktest(
            self._req(self._formula_def(), ["AAPL", "MSFT"]), MagicMock()
        )

        by_symbol = {d.symbol: d for d in result.diagnostics}
        assert by_symbol["AAPL"].no_trade_reason == analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
        assert not by_symbol["AAPL"].bars  # bars=[] for the failed symbol
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # partial success stays OK
        # MSFT kept its feature-065 evidence cell.
        cell_symbols = {c["symbol"] for c in persisted_cells.get("cells", [])}
        assert "MSFT" in cell_symbols
        assert "AAPL" not in cell_symbols

    @pytest.mark.asyncio
    async def test_all_failed_run_is_insufficient_and_unscored(self):
        from google.protobuf.struct_pb2 import Struct

        bars = [_bar(7100 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        side_effect = [
            SimpleNamespace(success=False, output=Struct(), error="boom"),
            SimpleNamespace(success=False, output=Struct(), error="boom"),
        ]
        svc = make_servicer()
        self._wire(svc, bars, side_effect)
        svc._persist_backtest_run = AsyncMock()

        result = await svc.RunBacktest(
            self._req(self._formula_def(), ["AAPL", "MSFT"]), MagicMock()
        )

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert result.total_trades == 0
        # Both symbols surface a FORMULA_ERROR diagnostic.
        reasons = {d.symbol: d.no_trade_reason for d in result.diagnostics}
        assert reasons == {
            "AAPL": analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR,
            "MSFT": analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR,
        }
        # No per-run score persisted for a no-usable-evidence run.
        svc._persist_backtest_run.assert_awaited_once()
        assert svc._persist_backtest_run.await_args.args[2] is None  # score arg

    def test_classify_no_trade_reason_never_returns_formula_error(self):
        from app.handlers.servicer import _classify_no_trade_reason

        # FORMULA_ERROR is stamped ONLY by the RunBacktest loop branch, never by classification.
        for trades in ([], [object()]):
            for warmup in (0, 3, 10):
                for n in (0, 3, 6):
                    assert (
                        _classify_no_trade_reason(trades, warmup, n)
                        != analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
                    )


class TestBacktestRangeCap:
    def _svc(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        # Enough bars so the legacy path runs (>= slow_period(3)+2); values irrelevant here.
        # feature 071: they straddle DAY (the explicit start these tests use) so an
        # explicit-start run has the pre-window history the warm-up prefix now requires.
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                page=_EOF_PAGE, bars=[_bar(i * 86_400, 10) for i in range(8)]
            )
        )
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=lambda *a, **k: _points([9, 10, 11, 12, 13])
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
        # Start at day 4 so 4 pre-window bars exist — slow_period(3) needs 3 (feature 071).
        req = self._req(4 * 86_400, 4 * 86_400 + 700 * 86_400)  # 700-day span < 730 cap
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
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])

        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=_owned_ctx())

        svc._scores_repo.upsert.assert_awaited_once()
        args = svc._scores_repo.upsert.await_args.args
        assert args[0] == "s1"
        assert args[1] == pytest.approx(score.overall_score)
        assert args[2] == score.rating
        assert set(args[3].keys()) == {"sharpe", "drawdown", "win_rate"}

    @pytest.mark.asyncio
    async def test_fr7_persist_failure_does_not_lose_read(self):
        """A swallowed DB write still returns the score AND keeps it readable (AC-6)."""
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])
        svc._scores_repo.upsert.side_effect = Exception("db down")

        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=_owned_ctx())

        # No abort/raise — the score is returned despite the write failure.
        assert score.strategy_id == "s1"
        # Reads serve from memory, so the caller reads its own write back.
        resp = await svc.ListStrategies(MagicMock(), context=_owned_ctx())
        assert any(s.strategy_id == "s1" for s in resp.strategies)

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


# ---------------------------------------------------------------------------
# feature 065 — definition fingerprint (module-level, no DB)
# ---------------------------------------------------------------------------


class TestDefinitionFingerprint:
    def test_display_name_active_live_excluded(self):
        from app.handlers.servicer import _definition_fingerprint

        base = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}', "display_name": "A"}
        renamed = {**base, "display_name": "Totally Different Name"}
        toggled = {**base, "active": False, "live_enabled": True}
        assert _definition_fingerprint(base) == _definition_fingerprint(renamed)
        assert _definition_fingerprint(base) == _definition_fingerprint(toggled)

    def test_entry_rule_change_changes_hash(self):
        from app.handlers.servicer import _definition_fingerprint

        a = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}'}
        b = {"strategy_id": "s1", "entry_rule": '{"op":"OR"}'}
        assert _definition_fingerprint(a) != _definition_fingerprint(b)

    def test_key_order_shuffle_same_hash(self):
        from app.handlers.servicer import _definition_fingerprint

        a = {"strategy_id": "s1", "entry_rule": "x", "exit_rule": "y"}
        b = {"exit_rule": "y", "entry_rule": "x", "strategy_id": "s1"}
        assert _definition_fingerprint(a) == _definition_fingerprint(b)

    def test_none_and_empty_handled(self):
        from app.handlers.servicer import _definition_fingerprint

        assert _definition_fingerprint(None) == _definition_fingerprint({})
        assert isinstance(_definition_fingerprint({}), str)


# ---------------------------------------------------------------------------
# feature 065 — per-symbol evidence cell buffering + fingerprint stamping
# ---------------------------------------------------------------------------


class TestRunBacktestCells:
    def _req(self, strategy_id="s1", strategy_id_ref="", symbols=("AAPL", "MSFT")):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.strategy_id_ref = strategy_id_ref
        req.symbols = list(symbols)
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    def _wire(self, svc):
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()

    @staticmethod
    def _fake_sma():
        # AAPL: 2 winning trades over 10 trading days; MSFT: zero trades over 5 days.
        trade = analysis_pb2.TradeRecord(pnl=1.0)
        diag = analysis_pb2.SymbolDiagnostics()

        def fake_symbol(symbol=None, **kwargs):
            # feature 150: simulators now return a 5th element (per-bar intent list); the legacy
            # RunBacktest path ignores it, so an empty list is a faithful stand-in here.
            if symbol == "AAPL":
                return ([trade, trade], 101_000.0, [100_000.0] * 11, diag, [])
            return ([], 101_000.0, [101_000.0] * 6, diag, [])

        return fake_symbol

    @pytest.mark.asyncio
    async def test_ok_run_buffers_one_cell_per_symbol_incl_zero_trade(self):
        svc = make_servicer()
        self._wire(svc)
        svc._backtest_symbol = AsyncMock(side_effect=self._fake_sma())

        result = await svc.RunBacktest(self._req(), context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        svc._backtest_run_symbols_repo.insert_many.assert_awaited_once()
        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        by_symbol = {c["symbol"]: c for c in cells}
        assert set(by_symbol) == {"AAPL", "MSFT"}
        assert by_symbol["AAPL"]["total_trades"] == 2
        assert by_symbol["AAPL"]["trading_days"] == 10
        # Zero-trade cell IS buffered — non-participation counts as evidence.
        assert by_symbol["MSFT"]["total_trades"] == 0
        assert by_symbol["MSFT"]["trading_days"] == 5
        # bare strategy_id (no ref) → no fingerprint on any cell.
        assert all(c["definition_fingerprint"] is None for c in cells)

    @pytest.mark.asyncio
    async def test_registered_own_run_stamps_fingerprint(self):
        from app.handlers.servicer import _definition_fingerprint

        svc = make_servicer()
        self._wire(svc)
        definition_json = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}'}
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(
            return_value={
                "strategy_id": "s1",
                "display_name": "S1",
                "active": True,
                "live_enabled": False,
                "definition_json": definition_json,
            }
        )
        svc._strategies_repo.get_by_owner_and_id = svc._strategies_repo.get_by_id
        diag = analysis_pb2.SymbolDiagnostics()
        curve = [100_000.0, 100_100.0, 100_200.0]
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, curve, diag, [])
        )

        req = self._req(strategy_id="s1", strategy_id_ref="s1", symbols=("AAPL",))
        await svc.RunBacktest(req, context=_owned_ctx())

        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        expected = _definition_fingerprint(definition_json)
        assert cells and all(c["definition_fingerprint"] == expected for c in cells)

    @pytest.mark.asyncio
    async def test_id_mismatch_stamps_none(self):
        svc = make_servicer()
        self._wire(svc)
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(
            return_value={
                "strategy_id": "other",
                "display_name": "Other",
                "active": True,
                "live_enabled": False,
                "definition_json": {"entry_rule": "x"},
            }
        )
        svc._strategies_repo.get_by_owner_and_id = svc._strategies_repo.get_by_id
        diag = analysis_pb2.SymbolDiagnostics()
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, [100_000.0, 100_100.0], diag, [])
        )
        # strategy_id "s1" differs from strategy_id_ref "other" → cells carry no fingerprint.
        req = self._req(strategy_id="s1", strategy_id_ref="other", symbols=("AAPL",))
        await svc.RunBacktest(req, context=_owned_ctx())

        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        assert cells and all(c["definition_fingerprint"] is None for c in cells)

    @pytest.mark.asyncio
    async def test_insufficient_run_flushes_no_cells(self):
        svc = make_servicer()
        self._wire(svc)
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few → INSUFFICIENT
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._req(symbols=("AAPL",)), context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._backtest_run_symbols_repo.insert_many.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cells_flush_failure_never_fails_run(self):
        svc = make_servicer()
        self._wire(svc)
        svc._backtest_run_symbols_repo.insert_many = AsyncMock(side_effect=Exception("db down"))
        svc._backtest_symbol = AsyncMock(side_effect=self._fake_sma())

        result = await svc.RunBacktest(self._req(), context=_owned_ctx())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # swallowed

    @pytest.mark.asyncio
    async def test_range_passed_to_run_history_insert(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()
        req = self._req(symbols=())
        req.range.start.seconds = 1_600_000_000
        req.range.end.seconds = 1_600_864_000  # 10 days, within cap

        await svc.RunBacktest(req, context=_owned_ctx())

        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["range_start"] is not None
        assert kwargs["range_end"] is not None


# ---------------------------------------------------------------------------
# feature 065 — _aggregate_cells (empirical-Bayes shrinkage)
# ---------------------------------------------------------------------------


class TestAggregateCells:
    def test_perfect_evidence_reaches_A_threshold(self):
        from app.handlers.servicer import _aggregate_cells, _grade

        # OQ-1 anchor: total W=375 trading days of perfect (s=1.0) evidence, k=250 → exactly 0.8.
        cells = [(375, 1.0, {"sharpe": 1.0, "drawdown": 1.0, "win_rate": 1.0})]
        overall, comps, n, days = _aggregate_cells(cells, k=250)
        assert overall == pytest.approx(0.8)  # (375 + 0.5*250) / (375 + 250)
        assert _grade(overall) == "A"
        assert n == 1 and days == 375

    def test_single_short_perfect_cell_shrinks_below_B(self):
        from app.handlers.servicer import _aggregate_cells, _grade

        # OQ-1 anchor: one 60-day perfect cell → (60 + 125)/310 ≈ 0.597 (< 0.65 B threshold).
        overall, comps, n, days = _aggregate_cells([(60, 1.0, {"sharpe": 1.0})], k=250)
        assert overall == pytest.approx(185 / 310, abs=1e-9)
        assert _grade(overall) == "C"

    def test_zero_weight_returns_none(self):
        from app.handlers.servicer import _aggregate_cells

        assert _aggregate_cells([(0, 1.0, {"sharpe": 1.0})], k=250) is None
        assert _aggregate_cells([], k=250) is None

    def test_component_weighted_mean_then_shrunk(self):
        from app.handlers.servicer import _aggregate_cells

        # weights 100 & 300 (sum ≠ 1 → renormalized); component 'sharpe' 0.9 and 0.5.
        cells = [(100, 0.9, {"sharpe": 0.9}), (300, 0.5, {"sharpe": 0.5})]
        overall, comps, n, days = _aggregate_cells(cells, k=200)
        # weighted sharpe numerator = 100*0.9 + 300*0.5 = 240; shrunk = (240 + 0.5*200)/(400+200).
        assert comps["sharpe"] == pytest.approx(340 / 600)
        # overall uses the same weighted s values → identical shrinkage here.
        assert overall == pytest.approx(340 / 600)
        assert days == 400

    def test_nonfinite_component_value_never_emitted(self):
        from app.handlers.servicer import _aggregate_cells

        cells = [(100, 0.5, {"drawdown": 0.5, "sharpe": float("inf")})]
        overall, comps, n, days = _aggregate_cells(cells, k=100)
        assert all(math.isfinite(v) for v in comps.values())
        assert math.isfinite(overall)
        assert "drawdown" in comps

    def test_zero_trade_cell_pulls_blend_down(self):
        from app.handlers.servicer import _aggregate_cells, _score_from_metrics

        # A zero-trade cell scores ≈ 0.3 (drawdown 1.0 only); it drags a strong cell down.
        s_zero, c_zero = _score_from_metrics(0.0, 0.0, 0.0, 0.4, 0.3, 0.3)  # ≈ 0.3
        s_good, c_good = _score_from_metrics(2.0, 0.0, 1.0, 0.4, 0.3, 0.3)  # = 1.0
        strong_only = _aggregate_cells([(200, s_good, c_good)], k=250)[0]
        with_zero = _aggregate_cells([(200, s_good, c_good), (200, s_zero, c_zero)], k=250)[0]
        assert with_zero < strong_only


# ---------------------------------------------------------------------------
# feature 065 — recompute triggers (RunBacktest / ManageStrategy UPDATE / ScoreStrategy)
# ---------------------------------------------------------------------------


def _rule(rhs=1):
    """A valid entry-rule tree referencing component 'a'. Vary `rhs` to change the fingerprint."""
    return json.dumps({"fn": ">", "lhs": "a", "rhs": rhs})


def _update_req(strategy_id="s1", rhs=1, mask_paths=None):
    """A REAL ManageStrategyRequest — not a MagicMock.

    feature 070 reads `request.HasField("update_mask")`, and a MagicMock returns a truthy
    sentinel for that, which would silently drive every test down the partial-merge path.
    The rule must also be valid JSON now: the UPDATE branch validates the merged definition
    directly (with pre-fetched formula outputs) instead of via the stubbable
    `_validate_definition_proto`.
    """
    definition = analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="a",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 10.0},
            )
        ],
        entry_rule=_rule(rhs),
    )
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
    )
    if mask_paths is not None:
        req.update_mask.paths.extend(mask_paths)
    return req


def _stub_update_repo(svc, current_row):
    """Wire a strategies repo for the feature-070 merge path.

    `update_locked` genuinely invokes the apply_fn against `current_row`, so tests exercise the
    real merge / erasure-guard / validation logic instead of mocking past it.
    """
    repo = AsyncMock()
    repo.get_by_id = AsyncMock(return_value=current_row)
    repo.get_by_owner_and_id = AsyncMock(return_value=current_row)

    async def _locked(user_id, strategy_id, apply_fn):
        name, new_json = await apply_fn(current_row)
        return {**current_row, "display_name": name, "definition_json": new_json}

    repo.update_locked = AsyncMock(side_effect=_locked)
    svc._strategies_repo = repo
    return repo


def _updated_row(strategy_id="s1", rhs=1):
    return {
        "strategy_id": strategy_id,
        "display_name": "S1",
        "active": True,
        "live_enabled": False,
        "definition_json": {
            "components": [
                {
                    "ref_name": "a",
                    "kind": "COMPONENT_KIND_BUILTIN_INDICATOR",
                    "indicator": "SMA",
                    "params": {"period": 10.0},
                }
            ],
            "entry_rule": _rule(rhs),
        },
    }


class TestHeadlineTriggers:
    @pytest.mark.asyncio
    async def test_ok_run_derives_headline_from_cells(self):
        # A registered own run: the persisted grade comes from the cells (400-day perfect),
        # not the single run's own (flat, near-zero) aggregate.
        svc = _derivation_svc([_eligible_cell(days=400, sharpe=2.0, drawdown=0.0, win_rate=1.0)])
        svc._backtest_run_symbols_repo.insert_many = AsyncMock()
        diag = analysis_pb2.SymbolDiagnostics()
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, [100_000.0, 100_050.0], diag, [])
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.strategy_id_ref = "s1"
        req.symbols = ["AAPL"]
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        await svc.RunBacktest(req, context=_owned_ctx())

        svc._scores_repo.upsert.assert_awaited()
        kwargs = svc._scores_repo.upsert.await_args.kwargs
        assert kwargs["n_symbols"] == 1
        assert kwargs["total_trading_days"] == 400
        assert kwargs["provisional"] is True  # 1 < 3 symbols and 400 < 500 days
        assert svc._strategies["s1"].evidence_days == 400

    @pytest.mark.asyncio
    async def test_update_clears_inmemory_even_when_delete_raises(self):
        svc = _derivation_svc([])  # zero eligible cells after the definition change
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        _stub_update_repo(svc, _updated_row())
        svc._scores_repo.delete = AsyncMock(side_effect=Exception("db down"))
        svc._has_admin_scope = lambda ctx: True

        await svc.ManageStrategy(_update_req(), context=_owned_ctx())

        # Unconditional pop FIRST — the stale grade is gone even though recompute/delete failed.
        assert "s1" not in svc._strategies

    @pytest.mark.asyncio
    async def test_update_recompute_no_deadlock(self):
        # UPDATE holds the lock then calls the inner (non-reentrant) recompute — must not deadlock.
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C", "D")])
        _stub_update_repo(svc, _updated_row())
        svc._has_admin_scope = lambda ctx: True

        await asyncio.wait_for(svc.ManageStrategy(_update_req(), context=_owned_ctx()), timeout=2.0)

        svc._scores_repo.upsert.assert_awaited_once()  # recompute ran under the same lock


def _abort_ctx():
    context = MagicMock()
    context.invocation_metadata = MagicMock(
        return_value=[("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]
    )
    context.abort = AsyncMock(side_effect=Exception("aborted"))
    return context


class TestScoreStrategyRecompute:
    @pytest.mark.asyncio
    async def test_store_unavailable(self):
        svc = make_servicer()  # no strategies_repo
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE

    @pytest.mark.asyncio
    async def test_unregistered_not_found(self):
        svc = _derivation_svc([])
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        req = MagicMock()
        req.strategy_id = "nope"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_zero_eligible_clears_and_not_found(self):
        svc = _derivation_svc([])
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert "s1" not in svc._strategies  # stale grade popped
        svc._scores_repo.delete.assert_awaited_once()  # non-best-effort delete
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    @pytest.mark.asyncio
    async def test_cells_read_failure_unavailable_no_mutation(self):
        svc = _derivation_svc([])
        svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(side_effect=Exception("db down"))
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE
        assert "s1" in svc._strategies  # untouched — no prior-state mutation

    @pytest.mark.asyncio
    async def test_success_persists_provenance_and_emits(self):
        svc = _derivation_svc(
            [
                _eligible_cell(symbol=s, days=600, sharpe=2.0, drawdown=0.0, win_rate=1.0)
                for s in ("A", "B", "C")
            ]
        )
        req = MagicMock()
        req.strategy_id = "s1"

        score = await svc.ScoreStrategy(req, context=_owned_ctx())

        assert score.strategy_id == "s1"
        assert score.evidence_symbols == 3
        assert score.evidence_days == 1800
        assert score.provisional is False  # 3 >= 3 symbols and 1800 >= 500 days
        assert score.rating == "A"
        svc._scores_repo.upsert.assert_awaited_once()
        svc._ledger.AppendEvent.assert_awaited()  # guarded ledger emit still fires

    @pytest.mark.asyncio
    async def test_range_is_ignored(self):
        # ScoreStrategyRequest.range is documented as ignored — a set range changes nothing.
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])
        req = MagicMock()
        req.strategy_id = "s1"
        req.range = common_pb2.TimeRange(
            start=Timestamp(seconds=1_600_000_000), end=Timestamp(seconds=1_600_864_000)
        )
        score = await svc.ScoreStrategy(req, context=_owned_ctx())
        assert score.evidence_days == 1800  # whole eligible base, not a windowed subset


class TestHydrateProvenance:
    @pytest.mark.asyncio
    async def test_hydrate_preserves_provenance(self):
        svc = make_servicer()
        svc._scores_repo = AsyncMock()
        svc._scores_repo.list = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "overall_score": 0.7,
                    "rating": "B",
                    "component_scores": {"sharpe": 0.6},
                    "n_symbols": 5,
                    "total_trading_days": 900,
                    "provisional": False,
                }
            ]
        )
        await svc.hydrate_scores()
        got = svc._strategies["s1"]
        assert got.evidence_symbols == 5
        assert got.evidence_days == 900
        assert got.provisional is False

    def test_row_to_score_pre007_row_defaults(self):
        from app.handlers.servicer import _row_to_score

        # A pre-007 row has no provenance keys — must hydrate with zero/false defaults.
        row = {
            "strategy_id": "s1",
            "overall_score": 0.7,
            "rating": "B",
            "component_scores": {},
        }
        score = _row_to_score(row)
        assert score.evidence_symbols == 0
        assert score.evidence_days == 0
        assert score.provisional is False


class TestTradedFirstDedupContract:
    @pytest.mark.asyncio
    async def test_aggregation_consumes_fetch_eligible_result(self):
        # The traded-first dedup lives in the fetch_eligible SQL (asserted in
        # test_backtest_run_symbols_repo.py). The servicer trusts that result: given a symbol's
        # traded 100-day cell is what fetch_eligible returns, the grade reflects it (not a
        # hypothetical 500-day zero-trade cell that the SQL ordering would have discarded).
        traded = _eligible_cell(symbol="AAPL", days=100, sharpe=2.0, win_rate=1.0, trades=5)
        svc = _derivation_svc([traded])
        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=_owned_ctx())
        assert score.evidence_days == 100  # the traded cell's window, per fetch_eligible


# ---------------------------------------------------------------------------
# Feature 068 — engine equity capture (per-bar equity + effective initial capital)
# ---------------------------------------------------------------------------


class TestEquityCapture:
    def test_finalize_stamps_equity_per_bar(self):
        """_finalize_symbol_diagnostics copies daily_equity[i] onto bars[i].equity."""
        from app.handlers.servicer import _build_bar_diagnostic, _finalize_symbol_diagnostics

        bars = [_bar(1000 + i, 10.0 + i) for i in range(4)]
        hold = analysis_pb2.BAR_ACTION_HOLD_FLAT
        diags = [
            _build_bar_diagnostic("AAPL", i, b, {}, 0.0, 0.0, hold, False)
            for i, b in enumerate(bars)
        ]
        daily_equity = [100_000.0, 100_100.0, 99_950.0, 100_200.0]
        sd = _finalize_symbol_diagnostics("AAPL", diags, 1, [], daily_equity)
        assert [b.equity for b in sd.bars] == daily_equity
        # forced-close consistency: the (patched) last daily_equity value lands on the last bar
        assert sd.bars[-1].equity == daily_equity[-1]

    @pytest.mark.asyncio
    async def test_full_backtest_bars_carry_equity_and_initial_capital(self):
        """End-to-end: a traded legacy run stamps per-bar equity and the effective seed."""
        bars = [_bar(1000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        fast = [9, 10, 12, 13, 9]
        slow = [11, 11, 11, 11]
        svc = TestBacktestDiagnostics()._svc_with(bars, fast, slow)
        req = TestBacktestDiagnostics()._legacy_req()

        result = await svc.RunBacktest(req, context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        assert result.initial_capital == 100_000.0
        sd = result.diagnostics[0]
        # bar 0 carries the seed; every bar carries a positive portfolio value
        assert sd.bars[0].equity == 100_000.0
        assert all(b.equity > 0 for b in sd.bars)
        # the traded run changes equity after entry (bar 3 onward differs from the seed)
        assert sd.bars[4].equity != 100_000.0

    @pytest.mark.asyncio
    async def test_effective_initial_capital_default(self):
        """request.initial_capital omitted/0 → the engine's 100k default is stamped."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 0.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.initial_capital == 100_000.0

    @pytest.mark.asyncio
    async def test_effective_initial_capital_explicit(self):
        """An explicit request capital is stamped verbatim."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 25_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.initial_capital == 25_000.0


# ---------------------------------------------------------------------------
# Feature 068 — detail persistence + GetBacktest (DB-only read path)
# ---------------------------------------------------------------------------


class TestBacktestDetailPersistence:
    def _empty_req(self, strategy_id="s1", symbols=None):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.symbols = symbols if symbols is not None else []
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_ok_run_persists_detail_bytes(self):
        """An OK run serializes the full result into the details repo with retention 20."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        svc._backtest_details_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_details_repo.insert.await_args.kwargs
        assert kwargs["backtest_id"] == result.backtest_id
        assert kwargs["strategy_id"] == "s1"
        assert kwargs["completed_at"] == result.completed_at.ToDatetime()
        assert kwargs["result_pb"] == result.SerializeToString()
        assert kwargs["retention"] == 20  # MagicMock cfg returns the call-site default

    @pytest.mark.asyncio
    async def test_retention_clamped_to_at_least_one(self):
        """A negative configured retention is clamped to 1, never passed to SQL raw."""
        svc = make_servicer()
        svc._cfg.get_int = MagicMock(
            side_effect=lambda key, default=0: (
                -5 if key == "analysis.backtest.detail_retention_per_strategy" else default
            )
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()

        await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())

        assert svc._backtest_details_repo.insert.await_args.kwargs["retention"] == 1

    @pytest.mark.asyncio
    async def test_insufficient_run_persists_no_detail(self):
        """INSUFFICIENT_DATA runs get a history row but never a detail row (FR-6)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few bars
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._empty_req("s1", ["AAPL"]), context=_owned_ctx())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._backtest_details_repo.insert.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_detail_persist_failure_never_fails_run(self):
        """A DB error while persisting detail is swallowed (best-effort)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.insert = AsyncMock(side_effect=RuntimeError("db down"))

        result = await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # run still returned

    @pytest.mark.asyncio
    async def test_parity_history_metrics_equal_detail_bytes(self):
        """AC-4 / C-10(b): the seven ListBacktests metrics equal the deserialized detail's."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_details_repo = AsyncMock()

        await svc.RunBacktest(self._empty_req("s1"), context=_owned_ctx())

        history = svc._backtest_runs_repo.insert.await_args.kwargs
        detail = analysis_pb2.BacktestResult()
        detail.ParseFromString(svc._backtest_details_repo.insert.await_args.kwargs["result_pb"])
        assert history["metrics"]["total_return"] == detail.total_return
        assert history["metrics"]["annualized_return"] == detail.annualized_return
        assert history["metrics"]["sharpe_ratio"] == detail.sharpe_ratio
        assert history["metrics"]["max_drawdown"] == detail.max_drawdown
        assert history["metrics"]["win_rate"] == detail.win_rate
        assert history["metrics"]["total_trades"] == detail.total_trades
        assert history["metrics"]["profit_factor"] == detail.profit_factor
        assert history["backtest_id"] == detail.backtest_id


class TestGetBacktest:
    @pytest.mark.asyncio
    async def test_hit_round_trips_persisted_bytes(self):
        svc = make_servicer()
        stored = analysis_pb2.BacktestResult(
            backtest_id="bt-1",
            strategy_id="s1",
            total_return=0.12,
            total_trades=3,
            initial_capital=100_000.0,
            status=analysis_pb2.BACKTEST_STATUS_OK,
        )
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(return_value=stored.SerializeToString())

        req = MagicMock()
        req.backtest_id = "bt-1"
        result = await svc.GetBacktest(req, context=_owned_ctx())

        assert result == stored  # byte-exact round trip
        svc._backtest_details_repo.get.assert_awaited_once_with("bt-1")

    @pytest.mark.asyncio
    async def test_miss_aborts_not_found(self):
        svc = make_servicer()
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(return_value=None)
        req = MagicMock()
        req.backtest_id = "bt-legacy"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        context.abort.assert_awaited_once()
        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"

    @pytest.mark.asyncio
    async def test_no_db_path_aborts_not_found(self):
        """Repo None (no DB) degrades to the same single FR-6 NOT_FOUND state."""
        svc = make_servicer()  # repos None by default
        req = MagicMock()
        req.backtest_id = "bt-1"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"

    @pytest.mark.asyncio
    async def test_read_error_aborts_not_found(self):
        """A DB read error logs a warning and aborts NOT_FOUND (never a 500 leak)."""
        svc = make_servicer()
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(side_effect=RuntimeError("db down"))
        req = MagicMock()
        req.backtest_id = "bt-1"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"


# ---------------------------------------------------------------------------
# Re-entry cooldown — backtest gate (feature 069, FR-7 / FR-6 / FR-9)
# ---------------------------------------------------------------------------


def _cooldown_bar(close, day):
    """A real marketdata Bar with a daily-incrementing tz-aware timestamp."""
    from gen.marketdata.v1 import marketdata_pb2

    bar = marketdata_pb2.Bar(
        symbol="AAPL", open=close, high=close, low=close, close=close, volume=1000, vwap=close
    )
    bar.time.FromSeconds(1_700_000_000 + day * 86_400)
    return bar


async def _run_evaluated(svc, definition, decisions, n_bars):
    """Drive _backtest_symbol_evaluated with a controlled decisions sequence.

    Patches StrategyEvaluator so entry/exit are exactly ``decisions`` (length ``n_bars``),
    and feeds daily bars so the cooldown's calendar-day math is exercised via bar.time.
    """
    from types import SimpleNamespace
    from unittest.mock import patch

    from gen.common.v1 import common_pb2

    bars = [_cooldown_bar(100.0, i) for i in range(n_bars)]
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._compute_evaluated_warmup = AsyncMock(return_value=0)
    fake_eval = MagicMock()
    fake_eval.evaluate_with_series = AsyncMock(return_value=(decisions, {}))
    with patch("app.handlers.servicer.StrategyEvaluator", return_value=fake_eval):
        # feature 150: drop the additive 5th (intent) element so these legacy tests keep their
        # 4-tuple unpack — the intent return is covered directly in TestPortfolioSizing.
        result = await svc._backtest_symbol_evaluated(
            "AAPL", common_pb2.TimeRange(), definition, 100_000.0, 0.0, 0.0
        )
        return result[:4]


def _decisions(n, entries=(), exits=()):
    from app.services.evaluator import BarDecision

    ds = [BarDecision(bar_index=i, entry=False, exit=False, conviction=0.0) for i in range(n)]
    for i in entries:
        ds[i].entry = True
        ds[i].conviction = 1.0
    for i in exits:
        ds[i].exit = True
    return ds


class TestBacktestCooldown:
    @pytest.mark.asyncio
    async def test_whipsaw_reentry_suppressed_by_default_cooldown(self):
        """AC-3: entry refiring on the bar right after an exit is suppressed by the default."""
        svc = make_servicer()
        # entry@1, exit@2, entry@3 (immediate re-entry attempt), nothing else.
        decisions = _decisions(40, entries=(1, 3), exits=(2,))
        definition = _valid_definition()  # cooldown_days unset → default 31
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        # Only the first trade (entry@1 → exit@2); the day-3 re-entry is gated, so no open
        # position remains to be force-closed at the last bar.
        assert len(trades) == 1

    @pytest.mark.asyncio
    async def test_explicit_zero_cooldown_allows_immediate_reentry(self):
        """Explicit cooldown_days=0 → immediate re-entry allowed (no gate)."""
        svc = make_servicer()
        decisions = _decisions(40, entries=(1, 3), exits=(2,))
        definition = _valid_definition()
        definition.cooldown_days = 0
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        # entry@1→exit@2 (trade 1) then entry@3 re-enters, held open, force-closed at last bar.
        assert len(trades) == 2

    @pytest.mark.asyncio
    async def test_reentry_allowed_after_window_elapses(self):
        """After the cooldown's calendar days pass, a later entry is allowed again."""
        svc = make_servicer()
        # entry@1, exit@2 (day 2), entry@3 (gated), entry@35 (day 35 > day2+31 → allowed).
        decisions = _decisions(40, entries=(1, 3, 35), exits=(2,))
        definition = _valid_definition()  # default 31
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        assert len(trades) == 2  # first trade + the post-window re-entry (open→force-closed)

    @pytest.mark.asyncio
    async def test_backtest_reproducible_across_runs(self):
        """AC-8 (FR-7): two runs of the same strategy/symbol produce identical trades.

        Cooldown state is a per-call local, never a shared/persisted store, so runs cannot
        cross-contaminate.
        """
        svc = make_servicer()
        decisions = _decisions(40, entries=(1, 3, 35), exits=(2,))
        definition = _valid_definition()
        t1, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        t2, _, _, _ = await _run_evaluated(
            svc, _valid_definition(), _decisions(40, (1, 3, 35), (2,)), 40
        )
        assert len(t1) == len(t2)
        assert [(round(t.pnl, 6), t.entry_time.seconds) for t in t1] == [
            (round(t.pnl, 6), t.entry_time.seconds) for t in t2
        ]

    def test_fingerprint_changes_with_cooldown_days(self):
        """AC-9 (FR-9): differing cooldown_days yield different fingerprints."""
        from app.handlers.servicer import _definition_fingerprint

        base = {"entry_rule": "x"}
        assert _definition_fingerprint(base) != _definition_fingerprint(
            {**base, "cooldown_days": 14}
        )

    @pytest.mark.asyncio
    async def test_manage_strategy_rejects_negative_cooldown(self):
        """AC-1: ManageStrategy register aborts INVALID_ARGUMENT on a negative cooldown."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(_valid_definition()))
        definition = _valid_definition()
        definition.cooldown_days = -1
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        code, _ = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT

    @pytest.mark.asyncio
    async def test_manage_strategy_accepts_zero_cooldown(self):
        """Explicit cooldown_days=0 passes write-time validation (register proceeds)."""
        svc = make_servicer()
        definition = _valid_definition()
        definition.cooldown_days = 0
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)  # feature 089: not existing
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.strategy_id == "sma_x"

    @pytest.mark.asyncio
    async def test_exit_platform_default_zero_is_a_noop(self):
        """AC-2: exit_cooldown_days unset (platform default 0) behaves exactly as before."""
        svc = make_servicer()
        decisions = _decisions(40, entries=(1,), exits=(2,))
        definition = _valid_definition()  # exit_cooldown_days unset → default 0
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        assert len(trades) == 1
        assert trades[0].exit_time.seconds == _cooldown_bar(100.0, 2).time.seconds

    @pytest.mark.asyncio
    async def test_exit_suppressed_while_min_hold_active(self):
        """An exit signal inside the minimum-hold window is gated; the next one fires."""
        svc = make_servicer()
        definition = _valid_definition()
        definition.exit_cooldown_days = 5
        # entry@1, exit signal@2 (1 day after entry — inside the 5-day min hold, gated),
        # exit signal@10 (9 days after entry — window elapsed, fires).
        decisions = _decisions(40, entries=(1,), exits=(2, 10))
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        assert len(trades) == 1
        assert trades[0].exit_time.seconds == _cooldown_bar(100.0, 10).time.seconds

    @pytest.mark.asyncio
    async def test_exit_allowed_once_min_hold_elapses(self):
        """An exit signal exactly at the minimum-hold boundary fires (half-open window)."""
        svc = make_servicer()
        definition = _valid_definition()
        definition.exit_cooldown_days = 5
        # entry@1, exit signal@6 — exactly 5 days after entry, the boundary is allowed.
        decisions = _decisions(40, entries=(1,), exits=(6,))
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        assert len(trades) == 1
        assert trades[0].exit_time.seconds == _cooldown_bar(100.0, 6).time.seconds

    def test_fingerprint_changes_with_exit_cooldown_days(self):
        """AC-9 (FR-9): differing exit_cooldown_days yield different fingerprints."""
        from app.handlers.servicer import _definition_fingerprint

        base = {"entry_rule": "x"}
        assert _definition_fingerprint(base) != _definition_fingerprint(
            {**base, "exit_cooldown_days": 14}
        )

    @pytest.mark.asyncio
    async def test_manage_strategy_rejects_negative_exit_cooldown(self):
        """FR-2: ManageStrategy register aborts INVALID_ARGUMENT on a negative exit cooldown."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(_valid_definition()))
        definition = _valid_definition()
        definition.exit_cooldown_days = -1
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        code, _ = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT

    @pytest.mark.asyncio
    async def test_manage_strategy_accepts_zero_exit_cooldown(self):
        """Explicit exit_cooldown_days=0 passes write-time validation (register proceeds)."""
        svc = make_servicer()
        definition = _valid_definition()
        definition.exit_cooldown_days = 0
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.strategy_id == "sma_x"


# ---------------------------------------------------------------------------
# feature 070 — partial strategy update (update_mask)
# ---------------------------------------------------------------------------


def _stored_row(strategy_id="s1", cooldown=None):
    """A fully-populated stored strategy — the thing the incident wiped."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="Range MR v3",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="z",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 20.0},
            )
        ],
        entry_rule=json.dumps({"fn": "<", "lhs": "z", "rhs": -1.0}),
        exit_rule=json.dumps({"fn": ">", "lhs": "z", "rhs": 1.0}),
    )
    if cooldown is not None:
        definition.cooldown_days = cooldown
    return {
        "strategy_id": strategy_id,
        "display_name": definition.display_name,
        "active": True,
        "live_enabled": False,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _masked_req(strategy_id="s1", paths=(), **fields):
    definition = analysis_pb2.StrategyDefinition(strategy_id=strategy_id, **fields)
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
    )
    req.update_mask.paths.extend(paths)
    return req


def _deny_def(symbols=None, denied=None, signal_eligible=False):
    """A StrategyDefinition carrying feature-132 fields (for resolve_universe/reject tests)."""
    from google.protobuf.struct_pb2 import Struct

    kwargs = {}
    if symbols is not None:
        sp = Struct()
        sp.update({"symbols": list(symbols)})
        kwargs["signal_params"] = sp
    return analysis_pb2.StrategyDefinition(
        denied_symbols=list(denied or []), signal_eligible=signal_eligible, **kwargs
    )


class TestResolveUniverse:
    """feature 132 — resolve_universe() 4-branch coverage (design decision 2). Pure function."""

    def test_allowlist_present_is_universe_minus_denied(self):
        from app.engine.live_loop import resolve_universe

        # (a) allowlist override applied verbatim (normalized), minus denied.
        d = _deny_def(symbols=["AAPL", "tsla"], denied=["TSLA"])
        r = resolve_universe(d, watchlist={"MSFT"}, held={"NVDA"}, signals={"GOOG"})
        assert r.union == {"AAPL", "TSLA"}  # allowlist wins, watchlist/held/signals ignored
        assert r.universe == {"AAPL"}  # TSLA denied and not held
        assert r.deny_entry == set()

    def test_no_allowlist_signal_ineligible_excludes_signals(self):
        from app.engine.live_loop import resolve_universe

        # (b) no allowlist, signal_eligible=false → watchlist ∪ held − denied (signals excluded).
        d = _deny_def(denied=["ZZZ"], signal_eligible=False)
        r = resolve_universe(d, watchlist={"MSFT"}, held={"NVDA"}, signals={"GOOG"})
        assert r.union == {"MSFT", "NVDA"}
        assert r.universe == {"MSFT", "NVDA"}
        assert "GOOG" not in r.universe

    def test_no_allowlist_signal_eligible_includes_signals(self):
        from app.engine.live_loop import resolve_universe

        # (c) no allowlist, signal_eligible=true → watchlist ∪ held ∪ signals − denied.
        d = _deny_def(signal_eligible=True)
        r = resolve_universe(d, watchlist={"MSFT"}, held={"NVDA"}, signals={"GOOG"})
        assert r.union == {"MSFT", "NVDA", "GOOG"}
        assert r.universe == {"MSFT", "NVDA", "GOOG"}

    def test_held_denied_retained_for_exit(self):
        from app.engine.live_loop import resolve_universe

        # (d) held ∩ denied → deny_entry non-empty; the held-denied symbol stays in universe (exit).
        d = _deny_def(denied=["NVDA"], signal_eligible=True)
        r = resolve_universe(d, watchlist=set(), held={"NVDA"}, signals={"NVDA"})
        assert r.deny_entry == {"NVDA"}
        assert "NVDA" in r.universe  # retained so exit still traces (entry-only deny)
        assert r.denied == {"NVDA"}


class TestDenyListMaskingAndValidation:
    """feature 132 — denied_symbols/signal_eligible masking + allowlist×eligible reject."""

    @pytest.mark.asyncio
    async def test_denied_symbols_masked_set_and_clear(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        # set
        result = await svc.ManageStrategy(
            _masked_req(paths=["denied_symbols"], denied_symbols=["TSLA", "NVDA"]),
            context=_admin_ctx(),
        )
        assert list(result.denied_symbols) == ["TSLA", "NVDA"]
        assert [c.ref_name for c in result.components] == ["z"]  # definition preserved
        # masked-clear (no value supplied → AIP-161 erase)
        _stub_update_repo(svc, _stored_row())
        cleared = await svc.ManageStrategy(
            _masked_req(paths=["denied_symbols"]), context=_admin_ctx()
        )
        assert list(cleared.denied_symbols) == []

    @pytest.mark.asyncio
    async def test_signal_eligible_masked_set_and_clear(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        result = await svc.ManageStrategy(
            _masked_req(paths=["signal_eligible"], signal_eligible=True), context=_admin_ctx()
        )
        assert result.signal_eligible is True
        assert json.loads(result.entry_rule)["lhs"] == "z"  # untouched
        _stub_update_repo(svc, _stored_row())
        cleared = await svc.ManageStrategy(
            _masked_req(paths=["signal_eligible"]), context=_admin_ctx()
        )
        assert cleared.signal_eligible is False

    @pytest.mark.asyncio
    async def test_register_rejects_allowlist_plus_signal_eligible(self):
        """A REGISTER with both a non-empty signal_params.symbols allowlist and signal_eligible=true
        is rejected INVALID_ARGUMENT (design decision 4)."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        definition = _valid_definition()
        from google.protobuf.struct_pb2 import Struct

        sp = Struct()
        sp.update({"symbols": ["AAPL"]})
        definition.signal_params.CopyFrom(sp)
        definition.signal_eligible = True
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        code, _ = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT

    @pytest.mark.asyncio
    async def test_two_step_masked_flip_onto_stored_allowlist_is_rejected(self):
        """The merged-definition validator catches the two-step evasion: a stored strategy that
        already carries an allowlist, then a masked update flipping signal_eligible=true → the
        MERGED definition has both → INVALID_ARGUMENT (proves validation runs on to_write)."""
        svc = make_servicer()
        stored = _stored_row()
        # stored row already carries an allowlist
        stored["definition_json"]["signal_params"] = {"symbols": ["AAPL"]}
        _stub_update_repo(svc, stored)
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                _masked_req(paths=["signal_eligible"], signal_eligible=True), ctx
            )
        code, _ = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT

    def test_definition_json_round_trip_needs_no_mapper_change(self):
        """decision 13: denied_symbols/signal_eligible ride definition_json — a MessageToDict →
        _row_to_strategy_definition round-trip preserves them with no column mapper line."""
        from app.handlers.servicer import _row_to_strategy_definition

        d = _deny_def(denied=["TSLA"], signal_eligible=True)
        d.strategy_id = "s1"
        row = {
            "strategy_id": "s1",
            "display_name": "s1",
            "active": True,
            "live_enabled": False,
            "definition_json": json_format.MessageToDict(d, preserving_proto_field_name=True),
        }
        back = _row_to_strategy_definition(row)
        assert list(back.denied_symbols) == ["TSLA"]
        assert back.signal_eligible is True


class TestPartialStrategyUpdate:
    """The reported incident: `manage_strategy update` with only cooldown_days wiped the
    strategy's components and rules. These pin the server half of the fix."""

    @pytest.mark.asyncio
    async def test_cooldown_only_update_preserves_components_and_rules(self):
        """AC-1 at the servicer layer — the exact shape that caused the incident."""
        svc = make_servicer()
        stored = _stored_row()
        repo = _stub_update_repo(svc, stored)

        req = _masked_req(paths=["cooldown_days"], cooldown_days=45)
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.cooldown_days == 45
        # The whole point: nothing else moved.
        assert [c.ref_name for c in result.components] == ["z"]
        assert result.components[0].indicator == "SMA"
        assert json.loads(result.entry_rule) == {"fn": "<", "lhs": "z", "rhs": -1.0}
        assert json.loads(result.exit_rule) == {"fn": ">", "lhs": "z", "rhs": 1.0}
        assert result.display_name == "Range MR v3"  # not blanked
        repo.update_locked.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_masked_rename_applies_without_touching_the_definition(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["display_name"], display_name="Renamed")
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.display_name == "Renamed"
        assert [c.ref_name for c in result.components] == ["z"]

    @pytest.mark.asyncio
    async def test_masked_but_absent_path_clears_the_field(self):
        """AIP-161: a masked path with no value in the request is an explicit erase. This is
        the only way to express 'clear', since proto3 gives these fields no presence."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["exit_rule"])  # exit_rule deliberately not supplied
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.exit_rule == ""
        assert json.loads(result.entry_rule)["lhs"] == "z"  # untouched

    @pytest.mark.asyncio
    async def test_cooldown_days_can_be_cleared_back_to_platform_default(self):
        """The inverse of the feature-069 explicit-presence trap: an explicit 0 must be
        settable AND revertible to unset. Masking without supplying does the revert."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row(cooldown=0))

        result = await svc.ManageStrategy(
            _masked_req(paths=["cooldown_days"]), context=_admin_ctx()
        )
        assert not result.HasField("cooldown_days")

    @pytest.mark.asyncio
    async def test_exit_cooldown_only_update_preserves_components_and_rules(self):
        """feature 116, mirrors test_cooldown_only_update_preserves_components_and_rules."""
        svc = make_servicer()
        stored = _stored_row()
        repo = _stub_update_repo(svc, stored)

        req = _masked_req(paths=["exit_cooldown_days"], exit_cooldown_days=5)
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.exit_cooldown_days == 5
        assert [c.ref_name for c in result.components] == ["z"]
        assert result.components[0].indicator == "SMA"
        assert json.loads(result.entry_rule) == {"fn": "<", "lhs": "z", "rhs": -1.0}
        assert json.loads(result.exit_rule) == {"fn": ">", "lhs": "z", "rhs": 1.0}
        assert result.display_name == "Range MR v3"
        repo.update_locked.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_exit_cooldown_days_can_be_cleared_back_to_platform_default(self):
        """feature 116, mirrors test_cooldown_days_can_be_cleared_back_to_platform_default."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        result = await svc.ManageStrategy(
            _masked_req(paths=["exit_cooldown_days"]), context=_admin_ctx()
        )
        assert not result.HasField("exit_cooldown_days")

    @pytest.mark.asyncio
    async def test_maskless_update_is_still_a_full_replace(self):
        """FR-5 / AC-6 regression guard: absent mask keeps pre-070 semantics, so the
        StrategyWizard (which always sends a complete definition) needs no change."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        replacement = _valid_definition(display_name="Wholly New")
        # Carry an exit_rule: the stored strategy has one, and the erasure guard applies to
        # maskless UPDATE too (see test_maskless_replace_cannot_silently_drop_a_rule).
        replacement.exit_rule = json.dumps({"fn": ">", "lhs": "fast", "rhs": 200})

        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=replacement
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.display_name == "Wholly New"
        assert [c.ref_name for c in result.components] == ["fast"]  # old 'z' gone
        assert json.loads(result.exit_rule)["rhs"] == 200

    @pytest.mark.asyncio
    async def test_maskless_replace_cannot_silently_drop_a_rule(self):
        """A deliberate, documented narrowing of the pre-070 contract.

        A maskless full replace that omits a rule the stored strategy HAS is now rejected —
        the guard cannot tell that apart from the incident. The StrategyWizard never trips it
        (its step gates require non-blank rules before submit), but a raw grpcurl/ops caller
        that legitimately wants to drop a rule must now say so via update_mask."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        replacement = _valid_definition(display_name="No Exit")  # no exit_rule
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=replacement
        )
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "refusing to blank 'exit_rule'" in msg

    @pytest.mark.asyncio
    async def test_maskless_wipe_is_rejected_even_from_an_unpatched_client(self):
        """FR-2b, fail-closed. This is the incident replayed byte-for-byte: an empty
        definition carrying only cooldown_days, no mask. The server alone must stop it."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        bare = analysis_pb2.StrategyDefinition(strategy_id="s1")
        bare.cooldown_days = 45
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=bare
        )
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "refusing to clear 'components'" in msg
        assert "update_mask" in msg  # names the escape hatch

    @pytest.mark.asyncio
    async def test_explicitly_masked_erasure_is_allowed(self):
        """The guard must not block a deliberate clear — only an accidental one."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["components", "entry_rule", "exit_rule"])
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert list(result.components) == []
        assert result.entry_rule == ""

    @pytest.mark.asyncio
    async def test_merged_result_is_validated_not_just_the_request(self):
        """FR-2a: swapping components out from under a stored rule must be caught. The
        request alone looks fine — only the MERGED definition is orphaned."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        # Replace 'z' with 'q'; the stored entry_rule still references 'z'.
        req = _masked_req(
            paths=["components"],
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="q",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 5.0},
                )
            ],
        )
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "not defined as a component ref_name" in msg

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["strategy_id", "active", "live_enabled"])
    async def test_column_authoritative_paths_are_rejected(self, path):
        """Masking these would write a value the next read silently discards."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=[path]), context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "column-authoritative" in msg

    @pytest.mark.asyncio
    async def test_unknown_mask_path_is_rejected(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=["nope"]), context=ctx)

        assert "unknown update_mask path" in ctx.abort.await_args.args[1]

    @pytest.mark.asyncio
    async def test_missing_strategy_is_not_found_before_any_write(self):
        svc = make_servicer()
        repo = AsyncMock()
        repo.get_by_id = AsyncMock(return_value=None)
        repo.get_by_owner_and_id = AsyncMock(return_value=None)
        svc._strategies_repo = repo
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=["display_name"]), context=ctx)

        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED
        repo.update_locked.assert_not_awaited()  # no write attempted


# ---------------------------------------------------------------------------
# feature 071 step 3 — trade_start_idx plumbing
# ---------------------------------------------------------------------------


class TestTradeStartIndex:
    """feature 071 — the pre-window prefix seeds indicators without becoming tradeable.

    `trade_start_idx` is DERIVED inside the engine by `_resolve_prefixed_bars`, so these drive
    the real path: bars that predate `range_msg.start` are the prefix, and `warmup_prefix=True`
    (set when the caller supplied an explicit start) turns the mechanism on.

    The invariant under test is `len(daily_equity) == len(diags)`, which
    `_finalize_symbol_diagnostics` stamps positionally and now asserts.
    """

    WINDOW_START = 1_000_000

    def _svc(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(fast_series), _points(slow_series)]
        )
        return svc

    def _bars(self, n_prefix, n_window):
        """n_prefix bars before WINDOW_START, then n_window at/after it (1 day apart)."""
        day = 86_400
        out = []
        for i in range(n_prefix):
            out.append(_bar(self.WINDOW_START - (n_prefix - i) * day, 10 + i))
        for i in range(n_window):
            out.append(_bar(self.WINDOW_START + i * day, 20 + i))
        return out

    async def _run(self, n_prefix, n_window, *, warmup_prefix=True, slow=3):
        bars = self._bars(n_prefix, n_window)
        total = len(bars)
        svc = self._svc(bars, [9] * (total - 1), [11] * (total - 2))
        rng = common_pb2.TimeRange()
        rng.start.seconds = self.WINDOW_START
        rng.end.seconds = self.WINDOW_START + 10 * 86_400
        # feature 150: drop the additive 5th (intent) element so these feature-071 tests keep
        # their 4-tuple unpack — the intent return is covered directly in TestPortfolioSizing.
        result = await svc._backtest_symbol(
            "AAPL",
            rng,
            fast_period=2,
            slow_period=slow,
            min_conviction=0.0,
            initial_equity=100_000.0,
            commission=0.0,
            slippage=0.0,
            warmup_prefix=warmup_prefix,
        )
        return result[:4]

    @pytest.mark.asyncio
    async def test_without_prefix_every_bar_is_in_scope(self):
        """warmup_prefix=False is the default/rolling path — unchanged pre-071 behavior."""
        _, _, daily_equity, sd = await self._run(0, 8, warmup_prefix=False)
        assert sd.bars_total == 8
        assert len(daily_equity) == len(sd.bars) == 8
        assert [b.bar_index for b in sd.bars][:3] == [0, 1, 2]

    @pytest.mark.asyncio
    async def test_prefix_bars_are_excluded_and_indices_renumbered(self):
        """slow_period=3 → 3 prefix bars required and consumed; only the window is reported."""
        _, _, daily_equity, sd = await self._run(3, 6)
        assert sd.bars_total == 6
        assert [b.bar_index for b in sd.bars] == list(range(6))
        assert len(daily_equity) == len(sd.bars)

    @pytest.mark.asyncio
    async def test_first_in_window_bar_keeps_its_real_timestamp(self):
        """Renumbering bar_index must not renumber time — the prefix is dropped, not shifted."""
        _, _, _, sd = await self._run(3, 6)
        assert sd.bars[0].bar_index == 0
        assert sd.bars[0].timestamp.seconds == self.WINDOW_START

    @pytest.mark.asyncio
    async def test_nothing_before_the_window_is_traded_or_reported(self):
        """FR-3: the prefix seeds indicators; it must never produce a trade or a diag row."""
        trades, _, _, sd = await self._run(3, 6)
        for t in trades:
            assert t.entry_time.seconds >= self.WINDOW_START
        for bar in sd.bars:
            assert bar.timestamp.seconds >= self.WINDOW_START

    @pytest.mark.asyncio
    async def test_surplus_prefix_is_discarded_deterministically(self):
        """Over-fetching is harmless: the engine keeps exactly the required prefix, which is
        what makes the bars→calendar-days conversion sizing-only rather than semantic."""
        _, _, _, sd_exact = await self._run(3, 6)
        _, _, _, sd_surplus = await self._run(9, 6)  # far more prefix than needed
        assert sd_exact.bars_total == sd_surplus.bars_total == 6
        assert [b.timestamp.seconds for b in sd_exact.bars] == [
            b.timestamp.seconds for b in sd_surplus.bars
        ]

    @pytest.mark.asyncio
    async def test_insufficient_prefix_reports_a_shortfall(self):
        """AC-4a / OQ-1: a clear error beats silently running short-warmed."""
        with pytest.raises(_InsufficientData) as ei:
            await self._run(1, 6)  # needs 3 prefix bars, only 1 available
        assert ei.value.bars_have == 1
        assert ei.value.bars_need == 3
        # The actionable backfill span is the PREFIX, not the caller's window.
        assert ei.value.gap_range is not None
        assert ei.value.gap_range.end.seconds == self.WINDOW_START


# ---------------------------------------------------------------------------
# feature 071 step 6 — parity & determinism
# ---------------------------------------------------------------------------

_DAY = 86_400
_W_START = 1_600_000_000  # a fixed, explicit window start used across this section
_W_END = _W_START + 30 * _DAY


def _windowed_req(definition, *, start=_W_START, end=_W_END, symbols=("AAPL",)):
    req = analysis_pb2.RunBacktestRequest(
        strategy_id="s1", symbols=list(symbols), initial_capital=100_000.0
    )
    req.inline_definition.CopyFrom(definition)
    req.range.start.seconds = start
    req.range.end.seconds = end
    return req


def _sma_def(period=3, ref="fast"):
    return analysis_pb2.StrategyDefinition(
        components=[
            analysis_pb2.StrategyComponent(
                ref_name=ref,
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": float(period)},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": ref, "rhs": 0}),
        exit_rule=json.dumps({"fn": "<", "lhs": ref, "rhs": 0}),
    )


def _series_bars(n_prefix, n_window, base=100.0):
    """n_prefix bars before _W_START then n_window from _W_START, 1 day apart.

    The close is a pure function of the bar's date, so lengthening the prefix prepends
    earlier bars without altering any bar the two fixtures share. Deriving it from the list
    index instead would make a longer prefix silently restate the whole series, and a test
    comparing two prefix lengths would be comparing two different price histories.
    """
    return [_bar(_W_START + off * _DAY, base + off) for off in range(-n_prefix, n_window)]


def _canonical(result):
    """Serialize a BacktestResult with its two inherently per-run fields cleared.

    `backtest_id` is a fresh uuid and `completed_at` is a wall-clock stamp — both differ on
    every run by construction, so leaving them in would make any byte-identity assertion
    vacuously false and tempt a weaker field-by-field comparison instead.
    """
    copy = analysis_pb2.BacktestResult()
    copy.CopyFrom(result)
    copy.backtest_id = ""
    copy.ClearField("completed_at")
    return copy.SerializeToString(deterministic=True)


def _wire_evaluated(svc, bars, *, capture=None):
    """Wire a servicer whose evaluator sees a real, length-n series per component.

    ComputeIndicator is mocked but *length-faithful*: it returns one point per input value,
    so the evaluator's tail-alignment is exercised and `capture` records exactly how many
    bars each component was computed over — which is the observable the anchor/cost tests
    are actually about.
    """
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._indicators = MagicMock()

    async def _compute(req, **kw):
        if capture is not None:
            capture.append((req.indicator, len(req.values)))
        # Monotone ramp so decisions are deterministic and non-trivial.
        return _points([float(i) for i in range(len(req.values))])

    svc._indicators.ComputeIndicator = AsyncMock(side_effect=_compute)
    return svc


class TestWindowDeterminism:
    """FR-4 — a run over an explicit window must not depend on the calendar day."""

    @staticmethod
    def _freeze(seconds):
        """Freeze the servicer's only wall-clock read (`Timestamp.GetCurrentTime`)."""

        def _set(self):
            self.seconds = seconds
            self.nanos = 0

        return patch.object(Timestamp, "GetCurrentTime", _set)

    @pytest.mark.asyncio
    async def test_explicit_window_is_identical_across_calendar_days(self):
        bars = _series_bars(6, 12)

        async def _run(now_seconds):
            svc = _wire_evaluated(make_servicer(), bars)
            with self._freeze(now_seconds):
                return await svc.RunBacktest(_windowed_req(_sma_def()), context=_owned_ctx())

        # "today" a full year apart
        day_one = await _run(_W_END + _DAY)
        day_later = await _run(_W_END + 365 * _DAY)
        assert _canonical(day_one) == _canonical(day_later)

    @pytest.mark.asyncio
    async def test_the_frozen_clock_test_has_teeth(self):
        """Guards the test above: without an explicit window the clock DOES move the result,
        so equality there is evidence of the window, not of an inert clock patch."""
        captured = []

        async def _effective_window(now_seconds):
            svc = _wire_evaluated(make_servicer(), _series_bars(0, 12))
            req = analysis_pb2.RunBacktestRequest(
                strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
            )
            req.inline_definition.CopyFrom(_sma_def())
            req.range.CopyFrom(common_pb2.TimeRange())  # no bounds → rolling default
            with self._freeze(now_seconds):
                await svc.RunBacktest(req, context=_owned_ctx())
            captured.append((req.range.start.seconds, req.range.end.seconds))

        await _effective_window(_W_END + _DAY)
        await _effective_window(_W_END + 365 * _DAY)
        assert captured[0] != captured[1]

    @pytest.mark.asyncio
    async def test_no_trade_opens_before_the_requested_start(self):
        """FR-3 at the RPC level: the prefix seeds indicators only."""
        svc = _wire_evaluated(make_servicer(), _series_bars(6, 12))
        result = await svc.RunBacktest(_windowed_req(_sma_def()), context=_owned_ctx())
        assert result.trades  # the assertion below is vacuous on an empty list
        assert all(t.entry_time.seconds >= _W_START for t in result.trades)
        assert all(b.timestamp.seconds >= _W_START for b in result.diagnostics[0].bars)


class TestPrefixSizingIsNotSemantic:
    """The bars→calendar-days conversion may only over-fetch, never change a result."""

    @pytest.mark.asyncio
    async def test_doubling_the_calendar_factor_is_byte_identical(self):
        """`prefix_calendar_days` widens the *fetch*; the engine then keeps exactly the
        required bars. Doubling its slack must therefore change nothing observable — that is
        what licenses the conversion to be approximate (F-07: no hidden tuned constant)."""
        bars = _series_bars(30, 12)  # generous history so a wider fetch is satisfiable

        async def _run():
            svc = _wire_evaluated(make_servicer(), bars)
            return await svc.RunBacktest(_windowed_req(_sma_def()), context=_owned_ctx())

        baseline = await _run()
        with patch.object(
            warmup_sizing, "_CALENDAR_SLACK_DAYS", warmup_sizing._CALENDAR_SLACK_DAYS * 2
        ):
            doubled = await _run()
        assert _canonical(baseline) == _canonical(doubled)

    @pytest.mark.asyncio
    async def test_surplus_history_beyond_the_prefix_is_ignored(self):
        """Same claim from the other side: more available history than the prefix needs must
        not shift the anchor. Otherwise a symbol's result would depend on how far back
        marketdata happens to hold data."""

        async def _run(n_prefix):
            svc = _wire_evaluated(make_servicer(), _series_bars(n_prefix, 12))
            return await svc.RunBacktest(_windowed_req(_sma_def()), context=_owned_ctx())

        assert _canonical(await _run(6)) == _canonical(await _run(40))


class TestVwapAnchorMovesWithPrefix:
    """Documented behavior change — VWAP is an expanding average anchored at index 0.

    Its own lookback is 0, but the prefix is the max over *all* referenced components, so a
    strategy mixing VWAP with a long SMA gets a prefix anyway and every in-window VWAP value
    shifts: the anchor moves from the requested start to the prefix start. Deterministic
    (FR-4 still holds), but different from an unprefixed run.
    """

    def _def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="vw",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="VWAP",
                ),
                analysis_pb2.StrategyComponent(
                    ref_name="slow",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 50.0},
                ),
            ],
            entry_rule=json.dumps(
                {"op": "AND", "conditions": [{"fn": ">", "lhs": "vw", "rhs": "slow"}]}
            ),
        )

    def test_vwap_alone_asks_for_no_prefix(self):
        vwap_only = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="vw",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="VWAP",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "vw", "rhs": 0}),
        )
        assert warmup_sizing.required_prefix_bars(vwap_only) == 0

    def test_a_long_sibling_drags_vwap_into_a_prefix(self):
        # SMA(50) is first valid at index 49 and usable at 50 (crossover reads i-1).
        assert warmup_sizing.required_prefix_bars(self._def()) == 50

    @pytest.mark.asyncio
    async def test_vwap_is_computed_over_the_prefixed_series(self):
        """The anchor shift, pinned at its cause: VWAP receives prefix+window closes, so its
        cumulative mean starts 50 bars earlier than the caller's window."""
        capture = []
        svc = _wire_evaluated(make_servicer(), _series_bars(50, 12), capture=capture)
        await svc.RunBacktest(_windowed_req(self._def()), context=_owned_ctx())
        by_indicator = dict(capture)
        assert by_indicator["VWAP"] == 62  # 50 prefix + 12 window, not 12
        assert by_indicator["SMA"] == 62


class TestBacktestLiveParityUnchanged:
    """FR-7 / OQ-4 — 071 is a backtest-path change; the live loop is deliberately untouched.

    The real parity invariant is the evaluator contract — *same bar series ⇒ same decisions*.
    That still holds exactly. What now differs between the two callers is the series each one
    supplies, and that difference must stay visible rather than be quietly assumed away.
    """

    def test_the_live_loop_evaluated_symbol_uses_fixed_lookback(self):
        """The EVALUATED symbol's live window stays the fixed 365-day lookback. Feature 152
        deliberately wires the warm-up prefix into the live loop for BENCHMARK (source_symbol)
        components only (`_load_benchmark_bars`); the evaluated symbol's own `_recent_range()`
        fetch is unchanged. See docs/warmup.md § Backtest/live divergence (FR-7, feature 152)."""
        from app.engine import live_loop

        assert live_loop._LOOKBACK_DAYS == 365
        # The evaluated-symbol fetch in _eval_pair still uses the fixed _recent_range().
        source = Path(live_loop.__file__).read_text()
        assert "self._recent_range()" in source

    def test_the_evaluator_contract_takes_no_window_argument(self):
        """The prefix lives entirely in the servicer's fetch. The evaluator receives a plain
        bar list, so it cannot behave differently for a backtest than for the live loop."""
        from app.services.evaluator import StrategyEvaluator

        params = inspect.signature(StrategyEvaluator.evaluate).parameters
        assert "range" not in params
        assert "trade_start_idx" not in params
        assert "warmup_prefix" not in params


class TestPrefixFormulaCost:
    """The prefix is paid for in bars sent to ExecuteFormula — measured, not assumed."""

    def _def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )

    @pytest.mark.asyncio
    async def _run(self, declared_warmup, n_prefix, n_window):
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(n_prefix, n_window)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        sizes = []

        async def _execute(req, **kw):
            # The evaluator passes the close series in input_data (evaluator.py:193-194).
            n = len(req.input_data["close"])
            sizes.append(n)
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="f-1", warmup_period=declared_warmup
            )
        )
        await svc.RunBacktest(_windowed_req(self._def()), context=_owned_ctx())
        return sizes

    @pytest.mark.asyncio
    async def test_a_declared_warmup_costs_exactly_its_prefix(self):
        """A formula declaring warmup_period=W is evaluated over W+1 extra bars (the +1 is the
        crossover lookback), so the cost of the prefix is bounded by the declaration — not by
        an open-ended "fetch more to be safe"."""
        sizes = await self._run(declared_warmup=10, n_prefix=20, n_window=12)
        assert sizes == [11 + 12]

    @pytest.mark.asyncio
    async def test_a_zero_warmup_formula_costs_nothing_extra(self):
        """A formula that declares no warm-up must not be silently charged a prefix.

        n_prefix=0 because the GetBars mock ignores `range`: with no prefix requested the
        fetch is unfiltered, so any pre-window bars in the fixture would reach the engine and
        make this measure the fixture instead of the code.
        """
        sizes = await self._run(declared_warmup=0, n_prefix=0, n_window=12)
        assert sizes == [12]

    @pytest.mark.asyncio
    async def test_every_symbol_pays_the_same_prefix(self):
        """Regression: the declared warm-ups must be resolved BEFORE the symbol loop.

        `required_prefix_bars` reads the formula cache at the top of each symbol's run while
        `_compute_evaluated_warmup` fills it at the bottom, so a lazily-filled cache gave
        symbol 1 no prefix and symbols 2+ the full one — a result that depends on symbol order.
        """
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(20, 12)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        sizes = []

        async def _execute(req, **kw):
            n = len(req.input_data["close"])
            sizes.append(n)
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=10)
        )
        await svc.RunBacktest(
            _windowed_req(self._def(), symbols=("AAPL", "MSFT")), context=_owned_ctx()
        )
        assert sizes == [23, 23]
        # ...and the declaration is fetched once for the whole run, not once per symbol.
        assert svc._indicators.GetFormula.await_count == 1


# ---------------------------------------------------------------------------
# EvaluateReadiness + ListOpportunities (feature 083)
# ---------------------------------------------------------------------------


def _ctx(headers):
    """A gRPC context whose invocation_metadata replays the given headers."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers.items()))
    ctx.abort = AsyncMock()
    return ctx


_HEADERS = {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}


def _bars_resp(closes):
    """A GetBars page: one bar per close with a monotonic time cursor, no next page."""
    resp = MagicMock()
    bars = []
    for i, c in enumerate(closes):
        b = MagicMock()
        b.close = c
        b.time.seconds = 1_700_000_000 + i * 86_400
        b.time.nanos = 0
        bars.append(b)
    resp.bars = bars
    resp.page.next_page_token = ""
    return resp


def _strategy_row_single_gt(threshold=100.0):
    """A strategy row whose entry_rule is a single `sma > threshold` leaf (SMA≈close)."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": threshold}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition),
    }


def _strategy_row_entry_exit():
    """A strategy row whose entry_rule (`sma > 100`) and exit_rule (`sma > 200`) differ, so a trace
    of one is distinguishable from the other (feature 138). With SMA≈close bars ~150: entry → 1/1
    PASS, exit → 0/1 FAIL."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": 100.0}),
        exit_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": 200.0}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition),
    }


class TestEvaluateReadiness:
    def _svc(self, bars_by_symbol):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_strategy_row_single_gt())
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_strategy_row_single_gt())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            side_effect=lambda req, metadata=None: _bars_resp(bars_by_symbol[req.symbol])
        )
        # SMA ≈ close: return one point per close, value == close.
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=lambda req, metadata=None: SimpleNamespace(
                result=[SimpleNamespace(value=v, extra={}) for v in req.values]
            )
        )
        return svc

    @pytest.mark.asyncio
    async def test_firing_symbol_passes_high_conviction(self):
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.symbol == "AAPL"
        assert r.passing_conditions == 1 and r.total_conditions == 1
        assert r.conviction == 1.0
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_PASS

    @pytest.mark.asyncio
    async def test_empty_bars_logs_warning(self, caplog):
        # feature 140 FR-6: a successful-but-empty GetBars is no longer silent — it logs a WARN
        # naming the symbol + strategy. The response still returns an (empty) readiness row, so
        # the RPC shape is unchanged.
        svc = self._svc({"AAPL": []})
        with caplog.at_level(logging.WARNING, logger="app.handlers.servicer"):
            resp = await svc.EvaluateReadiness(
                analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
                _ctx(_HEADERS),
            )
        assert len(resp.readiness) == 1  # empty readiness still returned
        warns = [r for r in caplog.records if "no 1d bars for AAPL" in r.getMessage()]
        assert len(warns) == 1

    @pytest.mark.asyncio
    async def test_default_rule_traces_entry(self):
        """feature 138: an unset `rule` (READINESS_RULE_UNSPECIFIED) traces the entry rule —
        back-compat, so watchlist readiness is unchanged. Entry `sma > 100` fires at ~150 → 1/1."""
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(
            return_value=_strategy_row_entry_exit()
        )
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.passing_conditions == 1 and r.total_conditions == 1
        assert r.conditions[0].threshold == 100.0  # the ENTRY leaf
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_PASS

    @pytest.mark.asyncio
    async def test_exit_rule_traced_when_requested(self):
        """feature 138: READINESS_RULE_EXIT traces the exit rule instead — so a held REDUCE
        opportunity's panel explains the exit rule that fired. Exit `sma > 200` fails at ~150 →
        0/1, tracing the EXIT leaf (threshold 200), not the entry leaf (100)."""
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(
            return_value=_strategy_row_entry_exit()
        )
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(
                strategy_id="s1", symbols=["AAPL"], rule=analysis_pb2.READINESS_RULE_EXIT
            ),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.total_conditions == 1
        assert r.passing_conditions == 0
        assert r.conditions[0].threshold == 200.0  # the EXIT leaf, not the entry leaf
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_FAIL

    @pytest.mark.asyncio
    async def test_near_symbol_soft_with_distance(self):
        # last SMA 98 vs threshold 100 → within the 5% soft-band → SOFT, distance < 0.
        svc = self._svc({"AAPL": [95.0, 97.0, 98.0]})
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.passing_conditions == 0
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_SOFT
        assert r.conditions[0].distance_to_threshold < 0
        assert 0.0 < r.conviction < 1.0

    @pytest.mark.asyncio
    async def test_headers_reach_marketdata_and_indicators(self):
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        md_meta = dict(svc._marketdata.GetBars.await_args.kwargs["metadata"])
        ind_meta = dict(svc._indicators.ComputeIndicator.await_args.kwargs["metadata"])
        for meta in (md_meta, ind_meta):
            assert meta["x-user-id"] == "u1"
            assert meta["x-access-scope"] == "7"
            assert meta["x-trace-id"] == "t1"

    @pytest.mark.asyncio
    async def test_unknown_strategy_aborts_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        ctx = _ctx(_HEADERS)
        await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="nope", symbols=["AAPL"]), ctx
        )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED


def _sig(symbol, direction, conviction, source="src", ingested_at=None):
    sig = ingest_pb2.ExternalSignal(
        symbol=symbol,
        direction=direction,
        conviction=conviction,
        source=source,
        headline=f"{direction} {symbol}",
    )
    # feature 022 — optional platform ingestion time; when set, drives signal_axis age decay.
    if ingested_at is not None:
        sig.ingested_at.FromDatetime(ingested_at)
    return sig


# ── Materialized opportunity Universe (feature 097) ─────────────────────────────


class _FakeOppRepo:
    """In-memory stand-in for OpportunitiesRepository so the real ``_compute_opportunities``
    Universe logic runs end-to-end (no DB). ``replace_for_user`` stores the compute's row dicts
    verbatim; ``read`` re-applies the valid/action filter + rank the SQL would, so the assertions
    exercise the producer path, not a re-implementation of it."""

    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.actions: dict[tuple[str, str], dict] = {}  # (user, key) -> {action, snooze_until}

    async def replace_for_user(self, user_id, rows):
        self.rows[user_id] = [dict(r) for r in rows]

    async def count_for_user(self, user_id):
        return len(self.rows.get(user_id, []))

    async def has_fresh(self, user_id):
        now = datetime.now(UTC)
        return any(r["valid_until"] > now for r in self.rows.get(user_id, []))

    async def read(self, user_id, min_conviction, w, *, include_expired):
        now = datetime.now(UTC)
        ww = min(max(w, 0.0), 1.0)
        out = []
        for r in self.rows.get(user_id, []):
            if not include_expired and r["valid_until"] <= now:
                continue
            # feature 132: muted (deny-listed) rows are exempt from the conviction floor — they
            # carry conviction 0 by design (mirrors the SQL `OR provenance ? 'denied'`).
            if r["conviction"] < min_conviction and "denied" not in (r.get("provenance") or []):
                continue
            act = self.actions.get((user_id, r["opportunity_key"]))
            if act:
                if act["action"] == 2:  # DISMISS
                    continue
                if act["action"] == 1 and act.get("snooze_until") and act["snooze_until"] > now:
                    continue
            out.append(r)
        out.sort(key=lambda r: (1 - ww) * r["conviction"] + ww * r["signal_axis"], reverse=True)
        return out

    async def distinct_user_ids(self):
        return list(self.rows.keys())

    async def queue_share(self, user_id, strategy_id):
        now = datetime.now(UTC)
        rows = [r for r in self.rows.get(user_id, []) if r["valid_until"] > now]
        denom = sum(1 for r in rows if r["strategy_id"])
        if denom == 0:
            return 0.0
        return sum(1 for r in rows if r["strategy_id"] == strategy_id) / denom

    async def taken_count(self, user_id, strategy_id):
        c = 0
        for (uid, key), act in self.actions.items():
            if uid == user_id and act["action"] == 3:  # TAKE
                row = next(
                    (r for r in self.rows.get(user_id, []) if r["opportunity_key"] == key), None
                )
                if row and row["strategy_id"] == strategy_id:
                    c += 1
        return c


def _recent_bars_resp(closes):
    """A GetBars page whose newest bar is stamped ~now, one bar per close going back a day each.

    The materialized queue's ``valid_until`` = the compute's session date (newest fetched bar) +
    the valid window, so the fixture's last bar must be recent or every row reads as already
    expired. (``_bars_resp`` uses a fixed 2023 base, fine where validity is irrelevant.)"""
    resp = MagicMock()
    n = len(closes)
    now_s = int(datetime.now(UTC).timestamp())
    bars = []
    for i, c in enumerate(closes):
        b = MagicMock()
        b.close = c
        b.time.seconds = now_s - (n - 1 - i) * 86_400
        b.time.nanos = 0
        bars.append(b)
    resp.bars = bars
    resp.page.next_page_token = ""
    return resp


def _wl(bindings=None, symbols=None):
    """A Watchlist-shaped object: ``bindings`` = [(symbol, strategy_id), …]; ``symbols`` = the
    deprecated flat mirror for legacy-row coverage (FR-6)."""
    return SimpleNamespace(
        bindings=[SimpleNamespace(symbol=s, strategy_id=st) for s, st in (bindings or [])],
        symbols=list(symbols or []),
    )


def _strat_row(
    strategy_id,
    entry=None,
    exit_=None,
    active=True,
    live_enabled=True,
    symbols=None,
    created_at=None,
    denied=None,
    signal_eligible=False,
):
    """A strategy row (SMA≈close via the ComputeIndicator stub) with optional entry/exit rules.

    feature 131: pass ``symbols`` to give the row a live-firing universe
    (``signal_params.symbols``, read by ``strategy_symbols`` to build ``live_by_symbol``), and
    ``created_at`` (the ``_capped_live`` tiebreak key). Both default off so existing callers are
    unchanged (C-13: no speculative centralization); a row destined for ``list_live_enabled`` needs
    them, so passing ``symbols`` defaults ``created_at`` to a deterministic 2024-01-01."""
    kwargs = dict(
        strategy_id=strategy_id,
        display_name=strategy_id.upper(),
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps(entry) if entry else "",
        exit_rule=json.dumps(exit_) if exit_ else "",
    )
    if symbols is not None:
        from google.protobuf.struct_pb2 import Struct

        sp = Struct()
        sp.update({"symbols": list(symbols)})
        kwargs["signal_params"] = sp
    if denied is not None:  # feature 132 — entry-only deny list
        kwargs["denied_symbols"] = list(denied)
    if signal_eligible:  # feature 132 — join platform-wide signals
        kwargs["signal_eligible"] = True
    definition = analysis_pb2.StrategyDefinition(**kwargs)
    row = {
        "strategy_id": strategy_id,
        "display_name": strategy_id.upper(),
        "active": active,
        "live_enabled": live_enabled,
        "definition_json": json_format.MessageToDict(definition),
    }
    if created_at is None and symbols is not None:
        created_at = datetime(2024, 1, 1, tzinfo=UTC)
    if created_at is not None:
        row["created_at"] = created_at
    return row


_GT_100 = {"fn": ">", "lhs": "sma", "rhs": 100.0}  # fires when last close > 100
_FIRING_BARS = [120.0, 130.0, 150.0]  # SMA≈close, last 150 > 100 → PASS


def _materialized_svc(
    signals=(),
    held=(),
    watchlists=(),
    strategies=None,
    bars=None,
    source_weights=None,
    live_strategies=None,
):
    """A no-DB servicer wired with a _FakeOppRepo + all Universe-compute edges mocked.

    feature 131: ``held`` accepts a plain symbol (default market value) or a ``(symbol, value)``
    tuple; ``live_strategies`` seeds ``list_live_enabled`` (default ``[]``)."""
    strategies = strategies or {}
    bars = bars or {}
    svc = make_servicer()
    svc._opportunities_repo = _FakeOppRepo()
    svc._ingest = MagicMock()
    svc._ingest.QuerySignals = AsyncMock(
        return_value=SimpleNamespace(
            signals=list(signals), page=SimpleNamespace(next_page_token="")
        )
    )
    # feature 134: _compute_opportunities drains per-source reliability weights via
    # ListSignalSources. Empty → every source resolves to the neutral 1.0 multiplier (no change).
    _sw = source_weights or {}
    svc._ingest.ListSignalSources = AsyncMock(
        return_value=SimpleNamespace(
            sources=[SimpleNamespace(slug=slug, reliability_weight=w) for slug, w in _sw.items()]
        )
    )
    svc._portfolio = MagicMock()

    def _held_pos(h):
        # feature 131: _drain_held_symbols reads abs(market_value); accept a plain symbol
        # (default value) or a (symbol, market_value) tuple for value-ranked live-budget tests.
        sym, mv = h if isinstance(h, tuple) else (h, 1000.0)
        return SimpleNamespace(symbol=sym, market_value=mv)

    svc._portfolio.ListPositions = AsyncMock(
        return_value=SimpleNamespace(
            positions=[_held_pos(h) for h in held],
            page=SimpleNamespace(next_page_token=""),
        )
    )
    svc._portfolio.ListWatchlists = AsyncMock(
        return_value=SimpleNamespace(
            watchlists=list(watchlists), page=SimpleNamespace(next_page_token="")
        )
    )
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_id = AsyncMock(side_effect=lambda sid: strategies.get(sid))
    # feature 133: _load_strategy_definition resolves owner-scoped now; the test fixtures are all
    # under a single owner (_HEADERS x-user-id="u1"), so mirror get_by_id (owner-agnostic here).
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(
        side_effect=lambda uid, sid: strategies.get(sid)
    )
    # feature 131: _compute_opportunities builds live_by_symbol from list_live_enabled(user_id).
    # Default [] keeps every non-live test green — a bare AsyncMock would return a MagicMock and
    # the "for row in ..." build would raise TypeError.
    svc._strategies_repo.list_live_enabled = AsyncMock(return_value=list(live_strategies or []))
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(
        side_effect=lambda req, metadata=None: _recent_bars_resp(bars.get(req.symbol, []))
    )
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    return svc


async def _list_opps(svc, **kwargs):
    # feature 095: ListOpportunities now does read-time live-market enrichment (GetLatestPrice per
    # returned symbol). Give it a benign default so pre-095 tests that assert on compute-path
    # behavior (bars-fetch dedup, aggregated warnings) are not perturbed by the enrichment edge.
    from gen.marketdata.v1 import marketdata_pb2 as _md

    if not isinstance(getattr(svc._marketdata, "GetLatestPrice", None), AsyncMock):
        svc._marketdata.GetLatestPrice = AsyncMock(return_value=_md.LatestPrice())
    resp = await svc.ListOpportunities(
        analysis_pb2.ListOpportunitiesRequest(**kwargs), _ctx(_HEADERS)
    )
    return {o.symbol: o for o in resp.opportunities}, resp.opportunities


class TestListOpportunitiesMaterialized:
    @pytest.mark.asyncio
    async def test_watchlist_and_held_add_rows_with_real_readiness(self):
        """AC-1: a watchlisted symbol under strategy X and a held position each become their own
        row — not only signal-sourced symbols — the attributed one carries real passing/total."""
        svc = _materialized_svc(
            held=["TSLA"],  # unattributed held → its own row, 0/0
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS, "TSLA": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        assert set(by_symbol) == {"AAPL", "TSLA"}
        assert by_symbol["AAPL"].strategy_id == "sx"
        assert by_symbol["AAPL"].passing_conditions == 1
        assert by_symbol["AAPL"].total_conditions == 1
        # Held-but-unattributed: real row, no fabricated strategy/readiness (P-03).
        assert by_symbol["TSLA"].strategy_id == ""
        assert by_symbol["TSLA"].total_conditions == 0
        assert by_symbol["TSLA"].action == analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD

    @pytest.mark.asyncio
    async def test_watchlist_binding_to_disabled_strategy_traces_to_zero(self):
        """A watchlist binding to a strategy the operator turned off (live_enabled=False) must
        not fabricate readiness — it stays a candidate but traces 0/0, mirroring the live loop's
        own `live_enabled AND active` gate (live_loop.py) rather than surfacing a real-looking
        opportunity row for a disabled strategy."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100, live_enabled=False)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        row = by_symbol["AAPL"]
        assert row.strategy_id == "sx"
        assert row.passing_conditions == 0
        assert row.total_conditions == 0

    @pytest.mark.asyncio
    async def test_watchlist_binding_to_deactivated_strategy_traces_to_zero(self):
        """Same as above for a soft-deleted (active=False) strategy."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100, active=False)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        row = by_symbol["AAPL"]
        assert row.passing_conditions == 0
        assert row.total_conditions == 0

    @pytest.mark.asyncio
    async def test_signal_and_watchlist_collapse_into_one_row(self):
        """AC-2/FR-4: a signal + a watchlist binding for the same symbol collapse into one row
        keyed (user, symbol, strategy) whose provenance lists both origins."""
        svc = _materialized_svc(
            signals=[_sig("AAPL", "buy", 0.9, source="uw")],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, opps = await _list_opps(svc)
        assert len(opps) == 1
        row = by_symbol["AAPL"]
        assert row.strategy_id == "sx"
        assert row.opportunity_key == "u1|AAPL|sx"
        assert set(row.provenance) == {"watchlist", "uw"}

    @pytest.mark.asyncio
    async def test_held_exit_rule_firing_is_reduce_without_a_sell_signal(self):
        """AC-6/FR-8: a held position whose attributed strategy's exit_rule fires appears as a
        REDUCE row with real readiness, with no sell signal present."""
        svc = _materialized_svc(
            held=["AAPL"],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100, exit_=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        row = by_symbol["AAPL"]
        assert row.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
        assert row.passing_conditions == 1 and row.total_conditions == 1
        assert row.source == ""  # no signal drove it — the exit rule did

    @pytest.mark.asyncio
    async def test_readiness_is_independent_of_signal_presence(self):
        """AC-4/FR-3: a signal moves only signal_axis/rank, never passing/total. The strategy's
        readiness is identical with and without a signal on the symbol."""
        common = dict(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        svc_no_sig = _materialized_svc(**common)
        svc_sig = _materialized_svc(signals=[_sig("AAPL", "buy", 0.9)], **common)
        no_sig = (await _list_opps(svc_no_sig))[0]["AAPL"]
        sig = (await _list_opps(svc_sig))[0]["AAPL"]
        assert (no_sig.passing_conditions, no_sig.total_conditions) == (
            sig.passing_conditions,
            sig.total_conditions,
        )
        assert no_sig.conviction == sig.conviction  # readiness ordinal unchanged
        # The only thing the signal moved is the independent axis (stored, not in readiness).
        assert svc_no_sig._opportunities_repo.rows["u1"][0]["signal_axis"] == 0.0
        assert svc_sig._opportunities_repo.rows["u1"][0]["signal_axis"] == 0.9

    @pytest.mark.asyncio
    async def test_signal_axis_weighted_by_source_reliability(self):
        """feature 134 AC-2: a source weighted 0.5 contributes half the signal_axis of an
        otherwise-identical 1.0-weighted source. signal_axis = conviction * reliability_weight."""
        common = dict(
            signals=[_sig("AAPL", "buy", 0.9, source="uw")],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        svc_full = _materialized_svc(source_weights={"uw": 1.0}, **common)
        svc_half = _materialized_svc(source_weights={"uw": 0.5}, **common)
        await _list_opps(svc_full)
        await _list_opps(svc_half)
        full_axis = svc_full._opportunities_repo.rows["u1"][0]["signal_axis"]
        half_axis = svc_half._opportunities_repo.rows["u1"][0]["signal_axis"]
        assert full_axis == pytest.approx(0.9)
        assert half_axis == pytest.approx(0.45)  # 0.9 * 0.5
        assert half_axis == pytest.approx(full_axis * 0.5)

    # ── feature 022 — signal_axis age decay ──────────────────────────────────
    async def _axis_for_age(self, age_hours, half_life=24.0, conviction=0.8, *, set_ingested=True):
        """Compute a single AAPL signal's stored signal_axis under `half_life`, where the signal
        was ingested `age_hours` ago (or with ingested_at unset when set_ingested=False). Uses a
        curated watchlist+firing row so the candidate survives; reads the raw stored axis."""
        ingested_at = datetime.now(UTC) - timedelta(hours=age_hours) if set_ingested else None
        svc = _materialized_svc(
            signals=[_sig("AAPL", "buy", conviction, source="uw", ingested_at=ingested_at)],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        svc._cfg.get_float_present = MagicMock(
            side_effect=lambda key, default: (
                half_life if key == "analysis.scoring.signal_decay_half_life_hours" else default
            )
        )
        await _list_opps(svc)
        return svc._opportunities_repo.rows["u1"][0]["signal_axis"]

    @pytest.mark.asyncio
    async def test_decay_fresh_signal_undamped(self):
        """AC (t=0): a signal ingested ~now with half-life 24 → multiplier ≈ 1.0."""
        assert await self._axis_for_age(0.0) == pytest.approx(0.8, rel=1e-3)

    @pytest.mark.asyncio
    async def test_decay_one_half_life_halves(self):
        """AC-5 (t=half_life): ingested 24h ago, half-life 24 → half the raw conviction."""
        assert await self._axis_for_age(24.0) == pytest.approx(0.4, rel=1e-2)

    @pytest.mark.asyncio
    async def test_decay_two_half_lives_quarters(self):
        """AC-1 (t=2×half_life): ingested 48h ago, half-life 24 → a quarter of raw."""
        assert await self._axis_for_age(48.0) == pytest.approx(0.2, rel=1e-2)

    @pytest.mark.asyncio
    async def test_decay_three_half_lives_eighths(self):
        """AC-5 (t=3×half_life): ingested 72h ago, half-life 24 → an eighth of raw."""
        assert await self._axis_for_age(72.0) == pytest.approx(0.1, rel=1e-2)

    @pytest.mark.asyncio
    async def test_decay_disabled_by_zero_half_life(self):
        """AC-2/FR-3: half-life 0 disables decay → undamped regardless of age (rollback path)."""
        assert await self._axis_for_age(72.0, half_life=0.0) == pytest.approx(0.8, rel=1e-6)

    @pytest.mark.asyncio
    async def test_decay_disabled_by_negative_half_life(self):
        """AC-2/FR-3: a negative half-life is also treated as disabled (undamped)."""
        assert await self._axis_for_age(72.0, half_life=-5.0) == pytest.approx(0.8, rel=1e-6)

    @pytest.mark.asyncio
    async def test_missing_ingested_at_treated_as_fresh(self):
        """AC-5 (deploy-ordering race): a signal with ingested_at unset → age unknown →
        multiplier 1.0 regardless of half-life; must NOT underflow to 0.0."""
        assert await self._axis_for_age(0.0, set_ingested=False) == pytest.approx(0.8, rel=1e-6)

    @pytest.mark.asyncio
    async def test_missing_ingested_at_emits_exactly_one_aggregated_warning(self):
        """AC-7: N signals missing ingested_at → EXACTLY ONE aggregated log.warning per compute
        pass (never one-per-signal), reporting the count."""
        svc = _materialized_svc(
            signals=[
                _sig("GOOG", "buy", 0.9, source="uw"),  # both ingested_at unset
                _sig("NFLX", "buy", 0.8, source="uw"),
            ],
        )
        with patch("app.handlers.servicer.log.warning") as warn:
            await _list_opps(svc)
        assert warn.call_count == 1
        # The single call reports the missing count (2) and the total (2).
        args = warn.call_args.args
        assert args[1] == 2 and args[2] == 2

    @pytest.mark.asyncio
    async def test_no_warning_when_all_signals_carry_ingested_at(self):
        """The aggregated warning fires only when something is missing — a fully-stamped pass is
        silent."""
        svc = _materialized_svc(
            signals=[_sig("GOOG", "buy", 0.9, source="uw", ingested_at=datetime.now(UTC))],
        )
        with patch("app.handlers.servicer.log.warning") as warn:
            await _list_opps(svc)
        assert warn.call_count == 0

    @pytest.mark.asyncio
    async def test_drain_source_weights_maps_and_is_best_effort(self):
        """feature 134: _drain_source_weights returns {slug: reliability_weight} from one
        ListSignalSources call, and {} on grpc.RpcError (best-effort)."""
        svc = make_servicer()
        svc._ingest = MagicMock()
        svc._ingest.ListSignalSources = AsyncMock(
            return_value=SimpleNamespace(
                sources=[
                    SimpleNamespace(slug="uw", reliability_weight=0.5),
                    SimpleNamespace(slug="tw", reliability_weight=1.0),
                ]
            )
        )
        assert await svc._drain_source_weights([]) == {"uw": 0.5, "tw": 1.0}
        svc._ingest.ListSignalSources = AsyncMock(side_effect=grpc.RpcError("boom"))
        assert await svc._drain_source_weights([]) == {}

    @pytest.mark.asyncio
    async def test_ranked_by_conviction_and_signal_axis(self):
        """Rank = (1-w)·conviction + w·signal_axis. With default w=0.3, a firing watchlist row
        (conviction 1.0) outranks a pure signal row (conviction 0, signal_axis 0.9)."""
        svc = _materialized_svc(
            signals=[_sig("MSFT", "buy", 0.9)],  # speculative, unattributed → conviction 0
            watchlists=[_wl(bindings=[("AAPL", "sx")])],  # firing → conviction 1.0
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        _, opps = await _list_opps(svc)
        assert [o.symbol for o in opps] == ["AAPL", "MSFT"]

    @pytest.mark.asyncio
    async def test_speculative_sell_signal_without_position_is_dropped(self):
        """A bare sell signal on an un-held, un-watchlisted symbol is not actionable → no row
        (parity with the pre-097 behavior). A bare buy signal stands alone as ENTER."""
        svc = _materialized_svc(
            signals=[_sig("NVDA", "sell", 0.9), _sig("GOOG", "buy", 0.8)],
        )
        by_symbol, _ = await _list_opps(svc)
        assert "NVDA" not in by_symbol
        assert by_symbol["GOOG"].action == analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER

    @pytest.mark.asyncio
    async def test_min_conviction_filters_on_readiness(self):
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx"), ("MSFT", "sy")])],
            strategies={
                "sx": _strat_row("sx", entry=_GT_100),  # fires → conviction 1.0
                "sy": _strat_row("sy", entry={"fn": ">", "lhs": "sma", "rhs": 1000.0}),  # 0.0
            },
            bars={"AAPL": _FIRING_BARS, "MSFT": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc, min_conviction=0.5)
        assert set(by_symbol) == {"AAPL"}

    @pytest.mark.asyncio
    async def test_watchlist_call_propagates_headers(self):
        """C-03: the new ListWatchlists outbound call carries the x-user-id/scope/trace tuple."""
        svc = _materialized_svc(watchlists=[_wl(bindings=[("AAPL", "sx")])])
        await _list_opps(svc)
        meta = dict(svc._portfolio.ListWatchlists.await_args.kwargs["metadata"])
        assert meta == {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}

    @pytest.mark.asyncio
    async def test_cold_read_computes_synchronously_then_serves(self):
        """Cold (never-materialized) read runs the compute inline and serves the result."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        assert await svc._opportunities_repo.count_for_user("u1") == 0
        by_symbol, _ = await _list_opps(svc)
        assert "AAPL" in by_symbol  # served from the synchronous compute
        assert svc._ingest.QuerySignals.await_count == 1

    @pytest.mark.asyncio
    async def test_stale_read_serves_stale_and_kicks_recompute(self):
        """A user with only expired rows is served the stale rows and a background recompute is
        kicked (stale-while-revalidate)."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        expired = datetime(2000, 1, 1, tzinfo=UTC)
        svc._opportunities_repo.rows["u1"] = [
            {
                "opportunity_key": "u1|OLD|",
                "symbol": "OLD",
                "strategy_id": "",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 0.5,
                "readiness_json": {"passing_conditions": 0, "total_conditions": 0},
                "signal_axis": 0.0,
                "provenance": [],
                "thesis": "",
                "valid_until": expired,
            }
        ]
        by_symbol, _ = await _list_opps(svc)
        assert "OLD" in by_symbol  # stale row served immediately
        # The background recompute runs on the next loop turns; it recomputes the fresh Universe.
        for _ in range(5):
            await asyncio.sleep(0)
        assert svc._ingest.QuerySignals.await_count >= 1
        assert "u1" not in svc._opportunity_recomputing  # guard cleared after it ran

    # ── feature 131 — live-strategy symbol-coverage attribution ──────────────────
    # Scope waiver (design.md Open Risk "Test-helper incompatibility — CLOSED, explicit user
    # decision 2026-08-14): no dedicated multi-strategy-per-same-symbol test is added — _list_opps'
    # by-symbol grouping can't express it and the user chose not to require the harness extension.
    # FR-4's distinct-(symbol, strategy) rows still hold via _candidate's dict-key mechanism.

    @pytest.mark.asyncio
    async def test_held_symbol_in_live_universe_gets_real_exit_trace(self):
        """AC-1: a held symbol covered by a live strategy's signal_params.symbols (no watchlist
        binding) is attributed to that strategy with a REAL exit-rule trace + live_strategy
        provenance, instead of falling through to unattributed (0/0)."""
        row = _strat_row("sx", entry=_GT_100, exit_=_GT_100, symbols=["AAPL"])
        svc = _materialized_svc(
            held=["AAPL"],
            strategies={"sx": row},
            live_strategies=[row],
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        r = by_symbol["AAPL"]
        assert r.strategy_id == "sx"
        assert r.total_conditions == 1 and r.passing_conditions == 1  # real exit trace, not 0/0
        assert set(r.provenance) >= {"position", "live_strategy"}
        assert r.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE  # exit fired

    @pytest.mark.asyncio
    async def test_live_only_signal_symbol_gets_real_entry_trace_and_is_curated(self):
        """AC-2/FR-6: an active signal on a symbol with no watchlist/held but covered by a live
        strategy is attributed with a REAL entry-rule trace + live_strategy provenance, and is
        curated — this is the case the feature actually changes (held was already curated)."""
        row = _strat_row("sx", entry=_GT_100, symbols=["AAPL"])
        svc = _materialized_svc(
            signals=[_sig("AAPL", "buy", 0.9, source="uw")],
            strategies={"sx": row},
            live_strategies=[row],
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        r = by_symbol["AAPL"]
        assert r.strategy_id == "sx"
        assert r.total_conditions == 1 and r.passing_conditions == 1  # real entry trace
        assert set(r.provenance) >= {"uw", "live_strategy"}
        stored = svc._opportunities_repo.rows["u1"]
        assert any(x["symbol"] == "AAPL" and x["strategy_id"] == "sx" for x in stored)

    @pytest.mark.asyncio
    async def test_watchlist_and_live_same_strategy_collapse_to_one_row(self):
        """AC-3: a symbol bound in the watchlist to strategy sx that is ALSO live-covered by sx
        yields exactly one (symbol, sx) row whose provenance carries both origins."""
        row = _strat_row("sx", entry=_GT_100, symbols=["AAPL"])
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": row},
            live_strategies=[row],
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, opps = await _list_opps(svc)
        assert len(opps) == 1
        r = by_symbol["AAPL"]
        assert r.strategy_id == "sx"
        assert set(r.provenance) >= {"watchlist", "live_strategy"}

    @pytest.mark.asyncio
    async def test_non_live_strategy_never_attributes_live_candidate(self):
        """AC-5: an active but live_enabled=False strategy is absent from list_live_enabled (the
        repo predicate excludes it), so a signal on its symbol stays unattributed — no
        live_strategy provenance and no fabricated attribution."""
        off = _strat_row("sx", entry=_GT_100, symbols=["AAPL"], live_enabled=False)
        svc = _materialized_svc(
            signals=[_sig("AAPL", "buy", 0.9, source="uw")],
            strategies={"sx": off},
            live_strategies=[],  # predicate (live_enabled=TRUE AND active=TRUE) excludes it
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        r = by_symbol["AAPL"]
        assert "live_strategy" not in r.provenance
        assert r.strategy_id == ""  # unattributed signal-only row

    @pytest.mark.asyncio
    async def test_live_only_candidate_survives_tiny_universe_cap(self):
        """AC-4: a live-only (signal-covered, no watchlist/held) attributed candidate is curated —
        not dropped even when max_universe_size is smaller than the higher-axis speculative tail."""
        live = _strat_row("sx", entry=_GT_100, symbols=["AAPL"])
        svc = _materialized_svc(
            signals=[
                _sig("AAPL", "buy", 0.5, source="uw"),  # live-covered → curated
                _sig("ZZZ", "buy", 0.99, source="uw"),  # speculative, higher axis
                _sig("YYY", "buy", 0.98, source="uw"),  # speculative, higher axis
            ],
            strategies={"sx": live},
            live_strategies=[live],
            bars={"AAPL": _FIRING_BARS},
        )
        # Cap the universe at 1 (all other get_int keys keep their defaults, incl. the 3 caps).
        svc._cfg.get_int = MagicMock(
            side_effect=lambda key, default=0: (
                1 if key == "analysis.opportunity.max_universe_size" else default
            )
        )
        by_symbol, _ = await _list_opps(svc)
        assert "AAPL" in by_symbol  # curated live row survives the cut
        assert by_symbol["AAPL"].strategy_id == "sx"
        assert "live_strategy" in by_symbol["AAPL"].provenance

    # ── feature 132 — muted (deny-listed) rows ───────────────────────────────────

    @pytest.mark.asyncio
    async def test_held_denied_is_one_muted_row_with_exit_trace(self):
        """AC (132): a held+denied (sym, strat) is exactly ONE row, muted=True, with its exit trace
        preserved (deny is entry-only) — not a second standalone row, never conviction=0."""
        row = _strat_row("sx", entry=_GT_100, exit_=_GT_100, symbols=["AAPL"], denied=["AAPL"])
        svc = _materialized_svc(
            held=["AAPL"],
            strategies={"sx": row},
            live_strategies=[row],
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, opps = await _list_opps(svc)
        assert sum(1 for o in opps if o.symbol == "AAPL") == 1  # one row, not two
        r = by_symbol["AAPL"]
        assert r.muted is True
        assert "denied" in r.provenance
        assert r.total_conditions == 1  # exit rule still traced (entry-only deny)
        assert r.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE

    @pytest.mark.asyncio
    async def test_pure_denied_symbol_is_muted_unspecified_placeholder(self):
        """AC (132): a denied symbol in the strategy's coverage but not held/watchlisted/signalled
        is a 0/0 muted placeholder — kept (UNSPECIFIED action), never dropped by the action guard,
        never conviction=0-as-classifier."""
        row = _strat_row("sx", entry=_GT_100, symbols=["XYZ"], denied=["XYZ"])
        svc = _materialized_svc(strategies={"sx": row}, live_strategies=[row], bars={})
        by_symbol, _ = await _list_opps(svc)
        assert "XYZ" in by_symbol  # not dropped by the action-is-None guard
        r = by_symbol["XYZ"]
        assert r.muted is True
        assert "denied" in r.provenance
        assert r.total_conditions == 0  # trace skipped for a non-held muted row
        assert r.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED

    @pytest.mark.asyncio
    async def test_muted_row_survives_tiny_universe_cut(self):
        """AC (132): the muted_only bucket ranks above the speculative tail — a muted row is not
        dropped for a higher-conviction speculative signal when max_universe is tiny."""
        row = _strat_row("sx", entry=_GT_100, symbols=["XYZ"], denied=["XYZ"])
        svc = _materialized_svc(
            signals=[
                _sig("ZZZ", "buy", 0.99, source="uw"),
                _sig("YYY", "buy", 0.98, source="uw"),
            ],
            strategies={"sx": row},
            live_strategies=[row],
            bars={},
        )
        svc._cfg.get_int = MagicMock(
            side_effect=lambda key, default=0: (
                1 if key == "analysis.opportunity.max_universe_size" else default
            )
        )
        by_symbol, _ = await _list_opps(svc)
        assert "XYZ" in by_symbol  # muted row survives despite the higher-axis speculative pair
        assert by_symbol["XYZ"].muted is True

    @pytest.mark.asyncio
    async def test_muted_row_returned_despite_min_conviction_floor(self):
        """AC (132): a min_conviction>0 read still returns a muted (conviction-0) row (the
        `provenance ? 'denied'` OR-branch of the read query)."""
        row = _strat_row("sx", entry=_GT_100, symbols=["XYZ"], denied=["XYZ"])
        svc = _materialized_svc(strategies={"sx": row}, live_strategies=[row], bars={})
        by_symbol, _ = await _list_opps(svc, min_conviction=0.5)
        assert "XYZ" in by_symbol  # exempt from the floor
        assert by_symbol["XYZ"].muted is True


class TestOpportunityBarsFetchDedup:
    """feature 141 — per-pass bars dedup + cross-request semaphore fixing the "out of shared
    memory" (SQLSTATE 53200) bars-fetch failures caused by feature 131/132's widened candidate
    set (product-spec.md Root Cause Hypothesis)."""

    @pytest.mark.asyncio
    async def test_bars_fetch_deduped_at_documented_worst_case_scale(self):
        """Scale reasoning (design.md Open Risk 2): the real production candidate-set size that
        triggered the incident is unavailable, so this ~241-row / 30-symbol scenario is a
        REASONED SUBSTITUTE grounded in this service's own documented feature-131 worst-case
        ceiling (5 x (20+20) = 200, CLAUDE.md § Config Keys Consumed) — not a confirmed
        reproduction. It uses 8 watchlist strategies per symbol (recon: watchlist bindings are
        the UNCAPPED multiplier) to reach scale, rather than reproducing the live-strategy
        fan-out cap's exact mechanics — this test's job is the dedup invariant at scale, not a
        second proof of the already-shipped feature-131 cap. One muted-only row (feature 132) is
        included to prove muted placeholders never reach the bars-fetch gate at all."""
        symbols = [f"S{i:02d}" for i in range(30)]
        strat_ids = [f"wl{i}" for i in range(8)]
        strategies = {sid: _strat_row(sid, entry=_GT_100) for sid in strat_ids}
        strategies["muted0"] = _strat_row("muted0", entry=_GT_100, symbols=["M00"], denied=["M00"])
        bindings = [(sym, sid) for sym in symbols for sid in strat_ids]
        svc = _materialized_svc(
            watchlists=[_wl(bindings=bindings)],
            strategies=strategies,
            live_strategies=[strategies["muted0"]],
            bars={sym: _FIRING_BARS for sym in symbols},
        )

        # ListOpportunities paginates its read at _DEFAULT_OPP_PAGE_SIZE=50 (unrelated,
        # pre-existing RPC behavior) — request a page large enough to see the whole materialized
        # set in one read, so this assertion reflects what _compute_opportunities actually wrote,
        # not an artifact of read-side pagination.
        by_symbol, opps = await _list_opps(svc, page=common_pb2.PageRequest(page_size=300))

        assert (
            len(opps) >= 200
        )  # design's documented worst-case scale (240 watchlist rows + 1 muted)
        # Count only compute-path fetches (range-bearing) — feature 095's read-time sparkline
        # enrichment also calls GetBars, but with no range (page only), so it is excluded here.
        compute_calls = [
            c for c in svc._marketdata.GetBars.call_args_list if c.args[0].HasField("range")
        ]
        assert len(compute_calls) == 30  # one fetch per DISTINCT traced symbol —
        # never per candidate row, and the muted-only symbol below is never fetched at all
        fetched = {c.args[0].symbol for c in compute_calls}
        assert fetched == set(symbols)
        assert "M00" not in fetched
        assert by_symbol["M00"].muted is True
        assert (
            by_symbol["M00"].total_conditions == 0
        )  # never traced — placeholder, not a real 0/0 fetch

    @pytest.mark.asyncio
    async def test_failed_fetch_cached_once_and_every_sharing_candidate_resolves(self):
        """design.md § Chosen Approach: a fetch failure is cached as [] and NOT retried by a
        later candidate sharing the symbol this pass — an explicit, named trade-off. Also proves
        the companion "every candidate resolves" property: both candidates sharing the failing
        symbol still return a row (empty readiness), never an unhandled exception propagating out
        of ListOpportunities."""
        strategies = {
            "wl0": _strat_row("wl0", entry=_GT_100),
            "wl1": _strat_row("wl1", entry=_GT_100),
            "wl2": _strat_row("wl2", entry=_GT_100),
        }
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("BAD", "wl0"), ("BAD", "wl1"), ("OK", "wl2")])],
            strategies=strategies,
        )

        async def _flaky_get_bars(req, metadata=None):
            if req.symbol == "BAD":
                raise Exception("simulated shared-memory failure")
            return _recent_bars_resp(_FIRING_BARS)

        svc._marketdata.GetBars = AsyncMock(side_effect=_flaky_get_bars)

        by_symbol, opps = await _list_opps(svc)  # must not raise

        # Compute-path (range-bearing) calls only — feature 095's read-time sparkline enrichment
        # also calls GetBars for BAD (no range), which is a separate, best-effort read.
        bad_calls = [
            c
            for c in svc._marketdata.GetBars.call_args_list
            if c.args[0].symbol == "BAD" and c.args[0].HasField("range")
        ]
        assert len(bad_calls) == 1  # attempted exactly once for BAD despite 2 candidates sharing it
        assert len(opps) == 3  # wl0/BAD, wl1/BAD, wl2/OK all resolved
        bad_rows = [o for o in opps if o.symbol == "BAD"]
        assert len(bad_rows) == 2
        assert all(
            o.total_conditions == 0 and o.conviction == 0.0 for o in bad_rows
        )  # cached [] fallback
        assert (
            by_symbol["OK"].total_conditions == 1
        )  # unaffected sibling symbol still traces normally

    @pytest.mark.asyncio
    async def test_cross_user_concurrency_bounded_by_semaphore(self):
        """design.md Testing — mechanical proof (not a real-Postgres load test): asyncio.gather
        over N=6 concurrent ListOpportunities calls for 6 different user_ids against ONE shared
        servicer instance (mirrors production: AnalysisServicer is constructed once,
        instance_count=1 per .do/app.yaml:232), with the bars-fetch mocked to block on a shared
        counter. Asserts peak in-flight fetches == the configured max_concurrent_bars_fetches (2,
        default) — proving BOTH that fetches genuinely overlap (a "teeth" assertion — insights.md
        2026-07-27: an upper bound alone can pass vacuously if nothing ever overlaps) AND that the
        semaphore caps them at exactly the configured bound, not some other number."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("SOLO", "wl0")])],
            strategies={"wl0": _strat_row("wl0", entry=_GT_100)},
        )
        in_flight = 0
        peak = 0
        state_lock = asyncio.Lock()

        async def _blocking_get_bars(req, metadata=None):
            nonlocal in_flight, peak
            async with state_lock:
                in_flight += 1
                peak = max(peak, in_flight)
            await asyncio.sleep(0.05)
            async with state_lock:
                in_flight -= 1
            return _recent_bars_resp(_FIRING_BARS)

        svc._marketdata.GetBars = AsyncMock(side_effect=_blocking_get_bars)

        await asyncio.gather(
            *[
                svc.ListOpportunities(
                    analysis_pb2.ListOpportunitiesRequest(),
                    _ctx({"x-user-id": f"u{i}", "x-access-scope": "7", "x-trace-id": "t1"}),
                )
                for i in range(6)
            ]
        )

        assert peak == 2  # exactly the configured max_concurrent_bars_fetches default


class TestGetStrategyAnalytics:
    def _svc(self, runs, orders, signals_count):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(return_value=runs)
        sig_resp = MagicMock()
        sig_resp.signals = [MagicMock() for _ in range(signals_count)]
        svc._ingest = MagicMock()
        svc._ingest.QuerySignals = AsyncMock(return_value=sig_resp)
        ord_resp = MagicMock()
        ord_resp.orders = [MagicMock() for _ in range(orders)]
        svc._trading = MagicMock()
        svc._trading.ListOrders = AsyncMock(return_value=ord_resp)
        return svc

    @pytest.mark.asyncio
    async def test_expectancy_closed_form(self):
        # win_rate 0.6, profit_factor 1.5 → payoff 1.0 → expectancy 0.6*1.0 - 0.4 = 0.2
        svc = self._svc(
            runs=[
                {"win_rate": 0.6, "profit_factor": 1.5, "max_drawdown": 0.12, "total_trades": 10}
            ],
            orders=3,
            signals_count=5,
        )
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        assert abs(resp.expectancy - 0.2) < 1e-9
        assert abs(resp.blended_hit_rate - 0.6) < 1e-9
        assert abs(resp.max_drawdown - 0.12) < 1e-9
        assert resp.signals_30d == 5
        assert resp.taken == 3

    @pytest.mark.asyncio
    async def test_headers_reach_trading_edge(self):
        svc = self._svc(
            runs=[{"win_rate": 0.5, "profit_factor": 2.0, "max_drawdown": 0.1, "total_trades": 4}],
            orders=1,
            signals_count=0,
        )
        await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        meta = dict(svc._trading.ListOrders.await_args.kwargs["metadata"])
        assert meta == {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}
        # the ListOrders call is scoped to the strategy.
        assert svc._trading.ListOrders.await_args.args[0].strategy_id == "s1"

    @pytest.mark.asyncio
    async def test_no_runs_yields_zero_metrics(self):
        svc = self._svc(runs=[], orders=0, signals_count=0)
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        assert resp.expectancy == 0.0 and resp.max_drawdown == 0.0

    def _seed_queue(self, svc, rows, actions=None):
        repo = _FakeOppRepo()
        valid = datetime(2999, 1, 1, tzinfo=UTC)
        repo.rows["u1"] = [
            {
                "opportunity_key": f"u1|{sym}|{strat}",
                "symbol": sym,
                "strategy_id": strat,
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 1.0,
                "readiness_json": {"passing_conditions": 1, "total_conditions": 1},
                "signal_axis": 0.0,
                "provenance": [],
                "thesis": "",
                "valid_until": valid,
            }
            for sym, strat in rows
        ]
        repo.actions = actions or {}
        svc._opportunities_repo = repo
        return repo

    @pytest.mark.asyncio
    async def test_queue_share_is_real(self):
        """AC-5/FR-7: queue_share = strategy's attributed rows / all attributed rows; unattributed
        rows are excluded from the denominator."""
        svc = self._svc(runs=[], orders=0, signals_count=0)
        # sx: 2 rows, sy: 1 row, plus 1 unattributed → denom = 3 attributed.
        self._seed_queue(svc, rows=[("AAPL", "sx"), ("MSFT", "sx"), ("TSLA", "sy"), ("IBM", "")])
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sx"), _ctx(_HEADERS)
        )
        assert abs(resp.queue_share - (2 / 3)) < 1e-9

    @pytest.mark.asyncio
    async def test_queue_share_zero_when_strategy_absent(self):
        svc = self._svc(runs=[], orders=0, signals_count=0)
        self._seed_queue(svc, rows=[("AAPL", "sx")])
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sy"), _ctx(_HEADERS)
        )
        assert resp.queue_share == 0.0

    @pytest.mark.asyncio
    async def test_taken_reconciles_with_queue_takes(self):
        """FR-7: a queue TAKE on the strategy's opportunity counts even if ListOrders returns
        fewer — the two 'taken' sources read consistently (max reconciliation)."""
        svc = self._svc(runs=[], orders=0, signals_count=0)  # trading reports 0 orders
        self._seed_queue(
            svc,
            rows=[("AAPL", "sx")],
            actions={("u1", "u1|AAPL|sx"): {"action": 3, "snooze_until": None}},  # TAKE
        )
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sx"), _ctx(_HEADERS)
        )
        assert resp.taken == 1


class TestOpportunityRowParity:
    """OR-F: the materialized-row → Opportunity mapper is a producer↔reader↔UI contract point.
    A newly-added Opportunity proto field must fail until _row_to_opportunity carries it."""

    # Every Opportunity field the mapper populates (kept in lockstep with _row_to_opportunity).
    _MAPPED = {
        "symbol",
        "action",
        "conviction",
        "passing_conditions",
        "total_conditions",
        "thesis",
        "strategy_id",
        "source",
        "valid_until",
        "opportunity_key",
        "provenance",
        "muted",  # feature 132
        # feature 095 — compute-time strategy-derived fields carried by _row_to_opportunity.
        "target_price",
        "stop_price",
        "conditions",
        # feature 110 — raw max ExternalSignal.conviction, carried from readiness_json.
        "signal_confidence",
    }
    # feature 095 — live-market fields set at read time in ListOpportunities (post-ranking), not by
    # the mapper, so they join _INTENTIONALLY_UNSET rather than _MAPPED.
    _INTENTIONALLY_UNSET: set[str] = {"live_price", "change_pct", "sparkline"}

    def test_mapper_covers_every_proto_field(self):
        assert self._MAPPED | self._INTENTIONALLY_UNSET == set(
            analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name
        )

    def test_guard_has_teeth(self):
        # Dropping any mapped field must break the equality (proves a new field would too).
        assert (self._MAPPED - {"provenance"}) | self._INTENTIONALLY_UNSET != set(
            analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name
        )

    def test_mapper_populates_all_fields(self):
        from app.handlers.servicer import _row_to_opportunity

        valid = datetime(2999, 1, 1, tzinfo=UTC)
        row = {
            "opportunity_key": "u1|AAPL|sx",
            "symbol": "AAPL",
            "strategy_id": "sx",
            "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE),
            "conviction": 0.75,
            "readiness_json": {"passing_conditions": 2, "total_conditions": 3},
            "signal_axis": 0.9,
            "provenance": ["watchlist", "position", "uw"],
            "thesis": "exit firing",
            "valid_until": valid,
        }
        opp = _row_to_opportunity(row)
        assert opp.symbol == "AAPL"
        assert opp.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
        assert abs(opp.conviction - 0.75) < 1e-9
        assert opp.passing_conditions == 2 and opp.total_conditions == 3
        assert opp.thesis == "exit firing"
        assert opp.strategy_id == "sx"
        assert opp.source == "uw"  # first non-structural provenance entry
        assert opp.opportunity_key == "u1|AAPL|sx"
        assert list(opp.provenance) == ["watchlist", "position", "uw"]
        assert opp.valid_until.ToDatetime(tzinfo=UTC) == valid
        assert opp.muted is False  # feature 132 — no "denied" marker → not muted

    def test_muted_derived_from_denied_provenance(self):
        """feature 132: the mapper sets Opportunity.muted from the "denied" provenance marker (the
        persistence carrier), and _primary_source never leaks "denied" into Opportunity.source."""
        from app.handlers.servicer import _primary_source, _row_to_opportunity

        row = {
            "opportunity_key": "u1|XYZ|sx",
            "symbol": "XYZ",
            "strategy_id": "sx",
            "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED),
            "conviction": 0.0,
            "readiness_json": {"passing_conditions": 0, "total_conditions": 0},
            "signal_axis": 0.0,
            "provenance": ["position", "denied"],
            "thesis": "",
            "valid_until": datetime(2999, 1, 1, tzinfo=UTC),
        }
        opp = _row_to_opportunity(row)
        assert opp.muted is True
        assert opp.source == ""  # "denied" (like "watchlist"/"position") is a structural marker
        assert _primary_source(["denied"]) == ""


class TestScreenSymbolsHeld:
    @pytest.mark.asyncio
    async def test_held_marked_from_positions(self):
        svc = make_servicer()
        # No fundamental criteria → fundamentals not fetched; technical path over closes.
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                bars=[SimpleNamespace(close=c) for c in [10.0, 11.0, 12.0]]
            )
        )
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(result=[SimpleNamespace(value=50.0)])
        )
        svc._ingest = MagicMock()
        # feature 134 — ScreenSymbols drains reliability weights via ListSignalSources (empty→1.0).
        svc._ingest.ListSignalSources = AsyncMock(return_value=SimpleNamespace(sources=[]))
        # portfolio holds AAPL (single page).
        pos_resp = MagicMock()
        pos_resp.positions = [MagicMock(symbol="AAPL")]
        pos_resp.page.next_page_token = ""
        svc._portfolio = MagicMock()
        svc._portfolio.ListPositions = AsyncMock(return_value=pos_resp)

        req = analysis_pb2.ScreenSymbolsRequest(symbols=["AAPL", "MSFT"])
        resp = await svc.ScreenSymbols(req, _ctx(_HEADERS))
        by_symbol = {r.symbol: r.held for r in resp.results}
        assert by_symbol.get("AAPL") is True
        assert by_symbol.get("MSFT") is False


# ---------------------------------------------------------------------------
# Feature 089 — honest strategy lifecycle (reactivate + live preconditions)
# ---------------------------------------------------------------------------


def _live_row(active=True, symbols=("AAPL",)):
    sp = {"symbols": list(symbols)} if symbols else {}
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": active,
        "live_enabled": False,
        "definition_json": {"strategy_id": "s1", "display_name": "S1", "signal_params": sp},
    }


class TestStrategyLifecycle089:
    @pytest.mark.asyncio
    async def test_register_duplicate_returns_already_exists(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.ALREADY_EXISTS
        svc._strategies_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_register_unique_violation_maps_to_already_exists(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        svc._strategies_repo.create = AsyncMock(side_effect=asyncpg.UniqueViolationError("dup"))
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.ALREADY_EXISTS

    @pytest.mark.asyncio
    async def test_reactivate_sets_active(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
        reactivated = {**_row_for(definition), "active": True}
        svc._strategies_repo.reactivate = AsyncMock(return_value=reactivated)
        resp = await svc.ManageStrategy(
            analysis_pb2.ManageStrategyRequest(
                operation=analysis_pb2.STRATEGY_OPERATION_REACTIVATE, definition=definition
            ),
            _admin_ctx(),
        )
        assert resp.strategy_id == "sma_x"
        svc._strategies_repo.reactivate.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reactivate_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REACTIVATE,
                    definition=_valid_definition(),
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_enable_live_on_inactive_rejected(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_live_row(active=False))
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_live_row(active=False))
        req = MagicMock(strategy_id="s1", live_enabled=True)
        ctx = _admin_ctx()
        ctx.invocation_metadata.return_value = [("x-user-id", "u1"), ("x-access-scope", "7")]
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION

    @pytest.mark.asyncio
    async def test_enable_live_without_symbols_now_succeeds(self):
        """feature 132 (AC-1): the feature-089 empty-symbol precondition was REMOVED. An empty
        signal_params.symbols allowlist no longer blocks enabling live — the strategy fires its
        whole owner union (watchlist ∪ held ∪ signals-iff-eligible) minus the deny list."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_live_row(symbols=()))
        enabled = {
            "strategy_id": "s1",
            "display_name": "S1",
            "active": True,
            "live_enabled": True,
            "definition_json": {"strategy_id": "s1"},  # no signal_params.symbols
        }
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=enabled)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock(strategy_id="s1", live_enabled=True)
        ctx = _admin_ctx()
        ctx.invocation_metadata.return_value = [("x-user-id", "u1"), ("x-access-scope", "7")]
        resp = await svc.SetStrategyLive(req, ctx)
        ctx.abort.assert_not_called()
        assert resp.definition.live_enabled is True

    @pytest.mark.asyncio
    async def test_disable_live_always_allowed_even_when_inert(self):
        # Disabling skips the preconditions entirely — an operator can always turn live off.
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.set_live_enabled = AsyncMock(
            return_value=_live_row(active=False, symbols=())
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock(strategy_id="s1", live_enabled=False)
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-user-id", "u1"), ("x-access-scope", "7")]
        resp = await svc.SetStrategyLive(req, ctx)
        assert resp.definition.strategy_id == "s1"
        svc._strategies_repo.get_by_id.assert_not_awaited()  # no precondition fetch on disable


# Feature 086 — deleted-formula flagging (write refusal + backtest/live status)
# ---------------------------------------------------------------------------


def _custom_formula_definition(strategy_id="s-cf", formula_id="fid"):
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="CF strat",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="myf",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id=formula_id,
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "myf", "rhs": 0}),
    )


class TestDeletedFormulaFlag:
    @pytest.mark.asyncio
    async def test_warnings_helper_flags_deleted(self):
        svc = make_servicer()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        warnings = await svc._deleted_formula_warnings(_custom_formula_definition(), [])
        assert len(warnings) == 1
        assert "fid" in warnings[0] and "RSI" in warnings[0]

    @pytest.mark.asyncio
    async def test_warnings_helper_empty_when_live(self):
        svc = make_servicer()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="fid", deleted=False)
        )
        warnings = await svc._deleted_formula_warnings(_custom_formula_definition(), [])
        assert warnings == []

    @pytest.mark.asyncio
    async def test_register_refuses_deleted_formula_binding(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
            definition=_custom_formula_definition(),
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.INVALID_ARGUMENT
        svc._strategies_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_get_strategy_flags_deleted_formula(self):
        svc = make_servicer()
        definition = _custom_formula_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(return_value=[("x-user-id", "u1")])
        req = analysis_pb2.GetStrategyRequest(strategy_id="s-cf")
        result = await svc.GetStrategy(req, ctx)
        assert len(result.warnings) == 1
        assert "fid" in result.warnings[0]

    @pytest.mark.asyncio
    async def test_get_strategy_no_warning_when_formula_live(self):
        svc = make_servicer()
        definition = _custom_formula_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="fid", deleted=False)
        )
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(return_value=[("x-user-id", "u1")])
        req = analysis_pb2.GetStrategyRequest(strategy_id="s-cf")
        result = await svc.GetStrategy(req, ctx)
        assert list(result.warnings) == []


class TestBacktestDeletedFormulaWarning:
    @pytest.mark.asyncio
    async def test_backtest_flags_deleted_formula_and_fetches_once(self):
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(5, 12)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()

        async def _execute(req, **kw):
            n = len(req.input_data["close"])
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="f-1", name="RSI", warmup_period=3, deleted=True
            )
        )
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
        result = await svc.RunBacktest(_windowed_req(definition), context=_owned_ctx())
        assert any("f-1" in w for w in result.warnings)
        # The deletion was captured on the warm-up prefetch's single fetch — no extra GetFormula.
        assert svc._indicators.GetFormula.await_count == 1


# ─── feature 097: SetOpportunityAction ───────────────────────────────────────


class _AbortError(Exception):
    """Mimics grpc.aio context.abort raising to terminate the RPC."""

    def __init__(self, code, details):
        super().__init__(details)
        self.code = code


def _opp_ctx(user_id="user-1"):
    ctx = MagicMock()
    md = [("x-user-id", user_id)] if user_id is not None else []
    ctx.invocation_metadata = MagicMock(return_value=md)

    async def _abort(code, details):
        raise _AbortError(code, details)

    ctx.abort = _abort
    return ctx


@pytest.mark.asyncio
async def test_set_opportunity_action_snooze_explicit():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    ts = Timestamp()
    ts.FromDatetime(datetime(2026, 8, 5, 12, 0, tzinfo=UTC))
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="user-1|AAPL|strat-x",
        action=analysis_pb2.OPPORTUNITY_ACTION_SNOOZE,
        snooze_until=ts,
    )
    await svc.SetOpportunityAction(req, _opp_ctx("user-1"))
    svc._opportunity_actions_repo.upsert.assert_awaited_once()
    kw = svc._opportunity_actions_repo.upsert.await_args.kwargs
    assert kw["user_id"] == "user-1"
    assert kw["opportunity_key"] == "user-1|AAPL|strat-x"
    assert kw["action"] == analysis_pb2.OPPORTUNITY_ACTION_SNOOZE
    assert kw["snooze_until"] == datetime(2026, 8, 5, 12, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_set_opportunity_action_snooze_defaults_hours():
    svc = make_servicer()  # cfg.get_int returns default → snooze_default_hours = 24
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="k", action=analysis_pb2.OPPORTUNITY_ACTION_SNOOZE
    )
    before = datetime.now(UTC)
    await svc.SetOpportunityAction(req, _opp_ctx("u"))
    su = svc._opportunity_actions_repo.upsert.await_args.kwargs["snooze_until"]
    assert su is not None
    assert 23.9 <= (su - before).total_seconds() / 3600 <= 24.1


@pytest.mark.asyncio
async def test_set_opportunity_action_missing_user_invalid():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="k", action=analysis_pb2.OPPORTUNITY_ACTION_DISMISS
    )
    with pytest.raises(_AbortError) as ei:
        await svc.SetOpportunityAction(req, _opp_ctx(user_id=None))
    assert ei.value.code == grpc.StatusCode.INVALID_ARGUMENT
    svc._opportunity_actions_repo.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_opportunity_action_empty_key_invalid():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="", action=analysis_pb2.OPPORTUNITY_ACTION_TAKE
    )
    with pytest.raises(_AbortError) as ei:
        await svc.SetOpportunityAction(req, _opp_ctx("u"))
    assert ei.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_set_opportunity_action_dismiss_take_persist_enum():
    for action in (
        analysis_pb2.OPPORTUNITY_ACTION_DISMISS,
        analysis_pb2.OPPORTUNITY_ACTION_TAKE,
    ):
        svc = make_servicer()
        svc._opportunity_actions_repo = AsyncMock()
        req = analysis_pb2.SetOpportunityActionRequest(opportunity_key="k", action=action)
        await svc.SetOpportunityAction(req, _opp_ctx("u"))
        kw = svc._opportunity_actions_repo.upsert.await_args.kwargs
        assert kw["action"] == action
        assert kw["snooze_until"] is None  # only SNOOZE sets a timestamp


class TestFeature133Ownership:
    """Cross-user ownership isolation (feature 133) — AC-1/AC-2/AC-3 with an owner-aware repo."""

    @staticmethod
    def _owner_repo(rows):
        """rows: dict[(user_id, strategy_id)] -> row dict. Owner-aware fake strategies repo."""
        repo = AsyncMock()

        async def _goai(user_id, strategy_id):
            return rows.get((user_id, strategy_id))

        async def _list(user_id, include_inactive=False, page_size=0, page_offset=0):
            owned = [r for (u, _s), r in rows.items() if u == user_id]
            return owned, len(owned)

        repo.get_by_owner_and_id = AsyncMock(side_effect=_goai)
        repo.list = AsyncMock(side_effect=_list)
        return repo

    @staticmethod
    def _row(user_id, strategy_id):
        return {
            "strategy_id": strategy_id,
            "user_id": user_id,
            "display_name": strategy_id.upper(),
            "active": True,
            "live_enabled": False,
            "definition_json": {},
        }

    @pytest.mark.asyncio
    async def test_ac2_get_strategy_owner_mismatch_is_permission_denied(self):
        svc = make_servicer()
        svc._strategies_repo = self._owner_repo({("ua", "s1"): self._row("ua", "s1")})
        ctx = _ctx({"x-user-id": "ub", "x-access-scope": "7", "x-trace-id": "t"})
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.GetStrategy(analysis_pb2.GetStrategyRequest(strategy_id="s1"), ctx)
        # uniform PERMISSION_DENIED — user B can't tell whether s1 exists under user A
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_ac3_list_definitions_excludes_other_users(self):
        svc = make_servicer()
        svc._strategies_repo = self._owner_repo(
            {("ua", "s1"): self._row("ua", "s1"), ("ub", "s2"): self._row("ub", "s2")}
        )
        ctx = _ctx({"x-user-id": "ub", "x-access-scope": "7", "x-trace-id": "t"})
        resp = await svc.ListStrategyDefinitions(analysis_pb2.ListStrategyDefinitionsRequest(), ctx)
        assert {d.strategy_id for d in resp.definitions} == {"s2"}  # never user A's s1

    @pytest.mark.asyncio
    async def test_ac1_two_users_register_same_strategy_id_without_collision(self):
        svc = make_servicer()
        created = {}

        async def _goai(user_id, strategy_id):
            return created.get((user_id, strategy_id))

        async def _create(user_id, strategy_id, display_name, definition_json):
            row = {
                "strategy_id": strategy_id,
                "user_id": user_id,
                "display_name": display_name,
                "active": True,
                "live_enabled": False,
                "definition_json": definition_json,
            }
            created[(user_id, strategy_id)] = row
            return row

        repo = AsyncMock()
        repo.get_by_owner_and_id = AsyncMock(side_effect=_goai)
        repo.create = AsyncMock(side_effect=_create)
        svc._strategies_repo = repo
        svc._validate_definition_proto = AsyncMock()  # bypass formula validation

        for user in ("ua", "ub"):
            ctx = _ctx({"x-user-id": user, "x-access-scope": "7", "x-trace-id": "t"})
            req = analysis_pb2.ManageStrategyRequest(
                operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
                definition=analysis_pb2.StrategyDefinition(strategy_id="s1", display_name="X"),
            )
            resp = await svc.ManageStrategy(req, ctx)
            assert resp.user_id == user  # owner is server-set from the header
        assert set(created) == {("ua", "s1"), ("ub", "s1")}  # composite PK, no collision


class TestListLiveEnabled:
    """feature 131 — StrategiesRepository.list_live_enabled() + the shared predicate constant.

    C-13 verdict: the strategy-row literals here are single-consumer (this class) → inline
    compliant.
    """

    @pytest.mark.asyncio
    async def test_list_live_enabled_uses_shared_predicate_and_decodes(self):
        from app.repositories.strategies import LIVE_ENABLED_PREDICATE_SQL, StrategiesRepository

        db = MagicMock()
        db.fetch = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "active": True,
                    "live_enabled": True,
                    "created_at": None,
                    "definition_json": '{"display_name": "S1"}',
                },
                {
                    "strategy_id": "s2",
                    "user_id": "u2",
                    "active": True,
                    "live_enabled": True,
                    "created_at": None,
                    "definition_json": {"display_name": "S2"},
                },
            ]
        )
        repo = StrategiesRepository(db)
        rows = await repo.list_live_enabled()
        sql = db.fetch.call_args[0][0]
        assert LIVE_ENABLED_PREDICATE_SQL in sql
        assert "live_enabled = TRUE AND active = TRUE" in sql
        # _to_dict decodes the JSONB definition_json (string → dict) on every row.
        assert rows[0]["definition_json"] == {"display_name": "S1"}
        assert isinstance(rows[1]["definition_json"], dict)
        # Global (no owner filter) when called with no user_id — the live loop needs every owner.
        assert "user_id" not in sql

    @pytest.mark.asyncio
    async def test_list_live_enabled_owner_scoped_when_user_id_given(self):
        # feature 131 deviation (post-133 ownership): the per-user opportunity compute must not
        # attribute another user's live strategy, so passing user_id owner-scopes the query.
        from app.repositories.strategies import StrategiesRepository

        db = MagicMock()
        db.fetch = AsyncMock(return_value=[])
        repo = StrategiesRepository(db)
        await repo.list_live_enabled("u1")
        sql = db.fetch.call_args[0][0]
        assert "user_id = $1" in sql
        assert db.fetch.call_args[0][1] == "u1"


class TestGetIndicatorSeries:
    """feature 125 (FR-6) — the indicator-overlay-panel RPC. Per-component fault isolation and the
    None→unset-IndicatorValue (no fabricated 0.0) guarantee; owner-scoped like EvaluateReadiness."""

    def _definition(self, components):
        return analysis_pb2.StrategyDefinition(
            strategy_id="s1",
            display_name="S",
            components=components,
            entry_rule=json.dumps({"fn": ">", "lhs": components[0].ref_name, "rhs": 1}),
        )

    @pytest.mark.asyncio
    async def test_per_component_fault_isolation(self):
        """One component raising FormulaExecutionError never fails the whole RPC — its
        ComponentSeries carries the error and empty series; the healthy one is populated."""
        svc = make_servicer()
        definition = self._definition(
            [
                analysis_pb2.StrategyComponent(
                    ref_name="good",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 3.0},
                ),
                analysis_pb2.StrategyComponent(
                    ref_name="bad",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-bad",
                ),
            ]
        )
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))

        def fake_compute(comp, closes):
            if comp.ref_name == "bad":
                raise FormulaExecutionError("f-bad", "boom")
            return {"value": [None, 1.0, 2.0]}

        with patch.object(
            StrategyEvaluator, "_compute_component", new=AsyncMock(side_effect=fake_compute)
        ):
            req = analysis_pb2.GetIndicatorSeriesRequest(
                strategy_id="s1", symbol="AAPL", closes=[1.0, 2.0, 3.0]
            )
            resp = await svc.GetIndicatorSeries(req, _owned_ctx())

        by_ref = {c.ref_name: c for c in resp.components}
        assert set(by_ref) == {"good", "bad"}
        # Healthy component: no error, one "value" series with all points.
        assert by_ref["good"].error == ""
        assert len(by_ref["good"].series) == 1
        assert by_ref["good"].series[0].name == "value"
        assert len(by_ref["good"].series[0].values) == 3
        # Failed component: error populated, series empty — the RPC still succeeded.
        assert "boom" in by_ref["bad"].error
        assert len(by_ref["bad"].series) == 0

    @pytest.mark.asyncio
    async def test_none_maps_to_unset_indicator_value_not_zero(self):
        """A warm-up/gap None round-trips as an UNSET IndicatorValue (no presence), distinct from a
        real 0.0 (present) — the AC-4a no-fabricated-0.0 guarantee. This is the test that could not
        pass under the earlier `repeated DoubleValue` encoding (an empty DoubleValue is byte- and
        JSON-identical to 0.0)."""
        svc = make_servicer()
        definition = self._definition(
            [
                analysis_pb2.StrategyComponent(
                    ref_name="sma",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 2.0},
                )
            ]
        )
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row_for(definition))

        def fake_compute(comp, closes):
            # leading warm-up None · a genuine 0.0 reading · a finite value
            return {"value": [None, 0.0, 5.0]}

        with patch.object(
            StrategyEvaluator, "_compute_component", new=AsyncMock(side_effect=fake_compute)
        ):
            req = analysis_pb2.GetIndicatorSeriesRequest(
                strategy_id="s1", symbol="AAPL", closes=[1.0, 2.0, 3.0]
            )
            resp = await svc.GetIndicatorSeries(req, _owned_ctx())

        vals = resp.components[0].series[0].values
        assert len(vals) == 3
        # warm-up None → UNSET, never a fabricated 0.0
        assert vals[0].HasField("value") is False
        # a genuine 0.0 → SET (present) with value 0.0 — distinct from the gap above
        assert vals[1].HasField("value") is True
        assert vals[1].value == 0.0
        # a finite value → SET
        assert vals[2].HasField("value") is True
        assert vals[2].value == 5.0

    @pytest.mark.asyncio
    async def test_owner_scoped_permission_denied(self):
        """A non-owned/missing strategy aborts PERMISSION_DENIED, like EvaluateReadiness (133)."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)
        req = analysis_pb2.GetIndicatorSeriesRequest(
            strategy_id="nope", symbol="AAPL", closes=[1.0]
        )
        with pytest.raises(Exception, match="aborted"):
            await svc.GetIndicatorSeries(req, _owned_ctx())


# ---------------------------------------------------------------------------
# feature 150 — portfolio sizing routing (Steps 7/8): AC-3, AC-4, AC-5
# ---------------------------------------------------------------------------


def _canonical_pre150(result):
    """`_canonical` PLUS the three fields feature 150 adds, so a legacy run compares equal to a
    pre-feature golden. A legacy run now stamps sizing_mode=SIZING_MODE_LEGACY (field 17); a naive
    full-message equality would false-fail on that new field alone (impl-spec Step 8)."""
    copy = analysis_pb2.BacktestResult()
    copy.CopyFrom(result)
    copy.backtest_id = ""
    copy.ClearField("completed_at")
    copy.ClearField("sizing_mode")
    copy.ClearField("capital_skips")
    copy.ClearField("portfolio_equity_curve")
    return copy.SerializeToString(deterministic=True)


class TestPortfolioSizingRouting:
    """RunBacktest routing by sizing_mode — the legacy default must stay byte-for-byte identical
    (BacktestResult bytes are persisted verbatim, feature 068)."""

    def _run(self, sizing_mode=None, symbols=("AAPL", "MSFT")):
        svc = _wire_evaluated(make_servicer(), _series_bars(6, 12))
        req = _windowed_req(_sma_def(), symbols=symbols)
        if sizing_mode is not None:
            req.sizing_mode = sizing_mode
        return svc, req

    @pytest.mark.asyncio
    async def test_legacy_default_is_unchanged_and_portfolio_moves_numbers(self):
        """@AC-3: unset sizing_mode == explicit LEGACY, byte-for-byte (minus the additive/volatile
        fields); the portfolio branch has teeth (it moves the aggregate numbers)."""
        svc_a, req_a = self._run(sizing_mode=None)  # UNSPECIFIED → legacy
        unset = await svc_a.RunBacktest(req_a, context=_owned_ctx())

        svc_b, req_b = self._run(sizing_mode=analysis_pb2.SIZING_MODE_LEGACY)
        legacy = await svc_b.RunBacktest(req_b, context=_owned_ctx())

        # UNSPECIFIED and explicit LEGACY take the identical path → identical whole-message bytes
        # (minus backtest_id/completed_at/the three additive fields).
        assert _canonical_pre150(unset) == _canonical_pre150(legacy)
        # A legacy run stamps the mode; it never records UNSPECIFIED.
        assert unset.sizing_mode == analysis_pb2.SIZING_MODE_LEGACY
        assert not unset.portfolio_equity_curve and not unset.capital_skips

        # Teeth: the portfolio branch produces a genuinely different aggregate.
        svc_c, req_c = self._run(sizing_mode=analysis_pb2.SIZING_MODE_PORTFOLIO)
        portfolio = await svc_c.RunBacktest(req_c, context=_owned_ctx())
        assert portfolio.sizing_mode == analysis_pb2.SIZING_MODE_PORTFOLIO
        assert portfolio.total_return != pytest.approx(legacy.total_return)

    @pytest.mark.asyncio
    async def test_portfolio_run_returns_and_persists_mode(self):
        """@AC-4: a portfolio run returns PORTFOLIO, persists the mode name + resolved params."""
        svc, req = self._run(sizing_mode=analysis_pb2.SIZING_MODE_PORTFOLIO)
        svc._backtest_runs_repo = AsyncMock()
        result = await svc.RunBacktest(req, context=_owned_ctx())

        assert result.sizing_mode == analysis_pb2.SIZING_MODE_PORTFOLIO
        assert result.portfolio_equity_curve  # non-empty portfolio curve
        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["sizing_mode"] == "SIZING_MODE_PORTFOLIO"
        assert kwargs["position_weight"] == pytest.approx(0.10)
        assert kwargs["max_concurrent"] == 9

    @pytest.mark.asyncio
    async def test_legacy_run_persists_mode_with_null_params(self):
        """@AC-4: a legacy run persists SIZING_MODE_LEGACY but NULL portfolio params."""
        svc, req = self._run(sizing_mode=None)
        svc._backtest_runs_repo = AsyncMock()
        await svc.RunBacktest(req, context=_owned_ctx())

        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["sizing_mode"] == "SIZING_MODE_LEGACY"
        assert kwargs["position_weight"] is None
        assert kwargs["max_concurrent"] is None

    def test_row_to_summary_maps_sizing_mode(self):
        """@AC-4: the summary projection maps the stored mode name; a null row → UNSPECIFIED."""
        from app.handlers.servicer import _row_to_backtest_summary

        portfolio = _row_to_backtest_summary(
            {
                "backtest_id": "b",
                "status": "BACKTEST_STATUS_OK",
                "sizing_mode": "SIZING_MODE_PORTFOLIO",
            }
        )
        assert portfolio.sizing_mode == analysis_pb2.SIZING_MODE_PORTFOLIO
        null_row = _row_to_backtest_summary({"backtest_id": "b", "status": "BACKTEST_STATUS_OK"})
        assert null_row.sizing_mode == analysis_pb2.SIZING_MODE_UNSPECIFIED

    @pytest.mark.asyncio
    async def test_per_symbol_cells_identical_across_modes(self):
        """@AC-5: the per-symbol evidence cells (the derived-grade inputs) are identical between
        legacy and portfolio mode — portfolio aggregation never touches the per-symbol loop."""
        svc_l, req_l = self._run(sizing_mode=None)
        svc_l._backtest_run_symbols_repo = AsyncMock()
        await svc_l.RunBacktest(req_l, context=_owned_ctx())
        legacy_cells = svc_l._backtest_run_symbols_repo.insert_many.await_args.args[0]

        svc_p, req_p = self._run(sizing_mode=analysis_pb2.SIZING_MODE_PORTFOLIO)
        svc_p._backtest_run_symbols_repo = AsyncMock()
        await svc_p.RunBacktest(req_p, context=_owned_ctx())
        portfolio_cells = svc_p._backtest_run_symbols_repo.insert_many.await_args.args[0]

        # Drop the run-varying backtest_id so the comparison is on the grade-bearing fields.
        def _strip(cells):
            return [{k: v for k, v in c.items() if k != "backtest_id"} for c in cells]

        assert _strip(legacy_cells) == _strip(portfolio_cells)


class TestOpportunityLiveEnrichment:
    """feature 095 — read-time live-market enrichment + compute-time strategy-derived fields.
    Enrichment runs AFTER ranking, so it must never change conviction or ordering (FR-8/AC-14),
    and every live field is explicit-presence: unavailable → unset, never a fabricated 0 (AC-11)."""

    def test_row_carries_conditions_and_target_stop(self):
        """AC-5/AC-6/AC-8 — the mapper carries the persisted trace leaves + target/stop when
        present, leaves target/stop unset (never 0) when absent; unattributed → no conditions."""
        from app.handlers.servicer import _row_to_opportunity

        attributed = _row_to_opportunity(
            {
                "opportunity_key": "u1|CAPR|sx",
                "symbol": "CAPR",
                "strategy_id": "sx",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 0.8,
                "readiness_json": {
                    "passing_conditions": 1,
                    "total_conditions": 1,
                    "conditions": [
                        {
                            "ref_name": "close",
                            "lhs_value": 12.34,
                            "threshold": 12.0,
                            "fn": ">",
                            "state": int(analysis_pb2.CONDITION_STATE_PASS),
                            "distance_to_threshold": 0.028,
                        }
                    ],
                    "target_price": 14.0,
                    "stop_price": 11.5,
                },
                "provenance": ["watchlist"],
                "thesis": "entry firing",
            }
        )
        assert len(attributed.conditions) == 1
        assert attributed.conditions[0].ref_name == "close"
        assert attributed.HasField("target_price") and attributed.target_price == 14.0
        assert attributed.HasField("stop_price") and attributed.stop_price == 11.5

        # Unattributed row: no conditions (AC-6), target/stop absent → unset (AC-8, not a 0 line).
        bare = _row_to_opportunity(
            {
                "opportunity_key": "u1|XYZ|",
                "symbol": "XYZ",
                "strategy_id": "",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED),
                "conviction": 0.0,
                "readiness_json": {
                    "passing_conditions": 0,
                    "total_conditions": 0,
                    "conditions": [],
                },
                "provenance": ["watchlist"],
                "thesis": "",
            }
        )
        assert len(bare.conditions) == 0
        assert not bare.HasField("target_price")
        assert not bare.HasField("stop_price")

    def test_read_time_enrichment_sets_live_price_change_and_sparkline(self):
        """AC-1/AC-4 — GetLatestPrice sets live_price + the DERIVED change_pct; a GetBars page
        builds the sparkline, with an unset close for a non-finite (warm-up/missing) bar."""
        from gen.marketdata.v1 import marketdata_pb2

        svc = make_servicer()
        svc._marketdata = MagicMock()
        svc._marketdata.GetLatestPrice = AsyncMock(
            return_value=marketdata_pb2.LatestPrice(
                symbol="CAPR", last_price=12.34, prev_close=12.09
            )
        )
        svc._marketdata.GetBars = AsyncMock(
            return_value=marketdata_pb2.GetBarsResponse(
                bars=[
                    marketdata_pb2.Bar(symbol="CAPR", close=12.0),
                    marketdata_pb2.Bar(symbol="CAPR", close=float("nan")),  # a gap → unset close
                    marketdata_pb2.Bar(symbol="CAPR", close=12.34),
                ]
            )
        )
        opp = analysis_pb2.Opportunity(symbol="CAPR", conviction=0.8)
        asyncio.run(svc._enrich_opportunities_live([opp], []))

        assert opp.HasField("live_price") and abs(opp.live_price - 12.34) < 1e-9
        assert opp.HasField("change_pct")
        assert abs(opp.change_pct - (12.34 - 12.09) / 12.09) < 1e-9
        assert len(opp.sparkline) == 3
        assert opp.sparkline[0].HasField("close") and opp.sparkline[0].close == 12.0
        assert not opp.sparkline[1].HasField("close")  # AC-4: gap → unset, never NaN/0
        assert opp.sparkline[2].close == 12.34

    def test_missing_quote_leaves_live_fields_unset(self):
        """AC-11 — a GetLatestPrice returning no last_price leaves live_price/change_pct unset
        (omit, never fabricate)."""
        from gen.marketdata.v1 import marketdata_pb2

        svc = make_servicer()
        svc._marketdata = MagicMock()
        svc._marketdata.GetLatestPrice = AsyncMock(
            return_value=marketdata_pb2.LatestPrice(symbol="NEW")  # last_price/prev_close unset
        )
        svc._marketdata.GetBars = AsyncMock(return_value=marketdata_pb2.GetBarsResponse(bars=[]))
        opp = analysis_pb2.Opportunity(symbol="NEW", conviction=0.5)
        asyncio.run(svc._enrich_opportunities_live([opp], []))
        assert not opp.HasField("live_price")
        assert not opp.HasField("change_pct")
        assert len(opp.sparkline) == 0

    def test_enrichment_never_changes_ranking(self):
        """AC-14 — enrichment sets only live fields; conviction and list order are identical to
        the pre-enrichment ranking (the live quote never enters the ranking path)."""
        from gen.marketdata.v1 import marketdata_pb2

        svc = make_servicer()
        svc._marketdata = MagicMock()
        svc._marketdata.GetLatestPrice = AsyncMock(
            return_value=marketdata_pb2.LatestPrice(symbol="A", last_price=99.0, prev_close=90.0)
        )
        svc._marketdata.GetBars = AsyncMock(return_value=marketdata_pb2.GetBarsResponse(bars=[]))
        ranked = [
            analysis_pb2.Opportunity(symbol="A", conviction=0.9),
            analysis_pb2.Opportunity(symbol="B", conviction=0.4),
        ]
        before = [(o.symbol, o.conviction) for o in ranked]
        asyncio.run(svc._enrich_opportunities_live(ranked, []))
        after = [(o.symbol, o.conviction) for o in ranked]
        assert before == after  # same symbols, same order, same conviction


class TestSignalConfidence:
    """feature 110 — Opportunity.signal_confidence: the raw max ExternalSignal.conviction, carried
    from readiness_json as explicit-presence, kept distinct from the ordinal conviction (AC-1/4)."""

    def test_mapper_carries_signal_confidence_explicit_presence(self):
        from app.handlers.servicer import _row_to_opportunity

        with_sig = _row_to_opportunity(
            {
                "opportunity_key": "u1|CAPR|",
                "symbol": "CAPR",
                "strategy_id": "",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 0.5,
                "readiness_json": {
                    "passing_conditions": 1,
                    "total_conditions": 1,
                    "signal_confidence": 0.82,
                },
                "provenance": ["uw"],
                "thesis": "",
            }
        )
        assert with_sig.HasField("signal_confidence")
        assert abs(with_sig.signal_confidence - 0.82) < 1e-9
        # Read distinctly from the ordinal conviction (AC-1/AC-4) — a different value on the row.
        assert abs(with_sig.conviction - 0.5) < 1e-9

        without = _row_to_opportunity(
            {
                "opportunity_key": "u1|AAPL|",
                "symbol": "AAPL",
                "strategy_id": "",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 0.5,
                "readiness_json": {"passing_conditions": 0, "total_conditions": 0},
                "provenance": ["uw"],
                "thesis": "",
            }
        )
        assert not without.HasField("signal_confidence")  # no active signal → genuine unset (P-03)

    @pytest.mark.asyncio
    async def test_producer_selects_max_raw_conviction(self):
        """AC-4 — a symbol with two active signals (raw 0.30 and 0.90) yields signal_confidence 0.90
        (the max raw ExternalSignal.conviction), the sizing probability that is NOT the ordinal
        conviction. (The no-active-signal → unset case is covered by the mapper test above.)"""
        svc = _materialized_svc(
            signals=[
                _sig("CAPR", "buy", 0.30, source="uw"),
                _sig("CAPR", "buy", 0.90, source="uw"),
            ],
        )
        by_symbol, _ = await _list_opps(svc)
        capr = by_symbol["CAPR"]
        assert capr.HasField("signal_confidence")
        assert abs(capr.signal_confidence - 0.90) < 1e-9  # max raw, not the summed/averaged value
