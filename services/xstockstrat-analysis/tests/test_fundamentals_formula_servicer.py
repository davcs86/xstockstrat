"""Feature 200 — servicer/live-surface wiring for a fundamentals-only CUSTOM_FORMULA operand.

Complements the evaluator-level suite (``test_fundamentals_formula_operand.py``, @AC-1/2/5/7/8) with
the surface-integration guarantees:

- @AC-3 (@FR-3): on the LIVE path the formula is fed the current-snapshot fundamentals
  (``GetFundamentalsMulti``) and NO ``GetHistoricalFundamentals`` PIT lookup is issued — the 198 PIT
  channel stays dormant for a formula-only strategy (``_definition_has_fundamental`` is False).
- @AC-4 (@FR-5): a fully-populated snapshot row feeds the formula the SAME input_data keys the
  fundamentals-signal producer would (the declared metrics' snake keys, none omitted) and the rule
  reads the same ``composite`` output field — full-row producer/strategy parity.

Real ``StrategyEvaluator`` (never a mock) so the fundamentals-formula branch actually fires; real
``marketdata_pb2.Bar`` (``bar.time``) — Ledger 2026-08-06 / fails.md:727.
"""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct

from app.engine.live_loop import LiveEvaluationLoop
from app.services.evaluator import StrategyEvaluator

_PE = indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO
_ROE = indicators_pb2.FUNDAMENTAL_METRIC_ROE
_EPS = indicators_pb2.FUNDAMENTAL_METRIC_EPS


def _bar(day: int, close: float = 100.0) -> marketdata_pb2.Bar:
    b = marketdata_pb2.Bar(symbol="AAPL", open=close, high=close, low=close, close=close)
    b.time.FromDatetime(datetime(2026, 1, day, tzinfo=UTC))
    return b


def _formula_only_definition():
    return analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        user_id="u1",
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fscore",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id="value_quality",
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.5}),
    )


def _real_evaluator(execute_side_effect, fundamental_inputs):
    """A real StrategyEvaluator whose indicators stub returns a fundamentals-only formula and runs
    ``execute_side_effect`` for ExecuteFormula (so the fundamentals branch actually executes)."""
    indicators = MagicMock()
    indicators.GetFormula = AsyncMock(
        return_value=indicators_pb2.FormulaDefinition(
            formula_id="value_quality",
            name="Value/Quality",
            fundamental_inputs=fundamental_inputs,
        )
    )
    indicators.ExecuteFormula = AsyncMock(side_effect=execute_side_effect)
    return StrategyEvaluator(indicators, propagation_meta=(), component_sem=None), indicators


def _make_live_loop(evaluator, *, gate=True):
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)
    cfg.get_bool = MagicMock(side_effect=lambda key, default=False: gate)
    loop = LiveEvaluationLoop(
        config_watcher=cfg,
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=evaluator,
    )
    loop._notify.EmitAlert = AsyncMock(return_value=MagicMock())
    loop._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return loop


def _multi_resp(symbol="AAPL", missing=(), **metrics):
    row = marketdata_pb2.Fundamentals(symbol=symbol, missing_metrics=list(missing), **metrics)
    return marketdata_pb2.GetFundamentalsMultiResponse(fundamentals=[row])


class TestLiveSnapshotNotPIT:
    @pytest.mark.asyncio
    async def test_ac3_live_path_feeds_snapshot_and_skips_pit(self):
        """@AC-3: the live loop feeds the formula AAPL's current GetFundamentalsMulti snapshot and
        issues NO GetHistoricalFundamentals PIT lookup (the 198 PIT channel stays dormant for a
        formula-only strategy)."""
        fed = {}

        async def _exec(req, metadata=None):
            fed.update(dict(req.input_data))
            out = Struct()
            out.update({"value": 0.6, "composite": 0.72})
            return SimpleNamespace(success=True, output=out, error="")

        evaluator, _ind = _real_evaluator(_exec, [_PE, _ROE])
        loop = _make_live_loop(evaluator)
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar(1), _bar(2), _bar(3)])
        )
        loop._marketdata.GetFundamentalsMulti = AsyncMock(
            return_value=_multi_resp(pe_ratio=12.0, roe=0.3)
        )
        loop._marketdata.GetHistoricalFundamentals = AsyncMock()

        await loop._eval_pair(_formula_only_definition(), "AAPL", throttle=0)

        loop._marketdata.GetFundamentalsMulti.assert_awaited()  # snapshot fetched
        assert loop._marketdata.GetHistoricalFundamentals.await_count == 0  # no PIT on live path
        # The formula was fed the snapshot fundamentals (never OHLCV closes).
        assert fed == {"pe_ratio": 12.0, "roe": 0.3}

    @pytest.mark.asyncio
    async def test_ac3_gate_off_holds_and_skips_all_fundamentals_fetch(self):
        """@AC-3 corollary: with the kill-switch OFF the formula reads hold — no snapshot fetch,
        no PIT fetch, no formula execution (the platform-wide disable, mirroring the 198 gate)."""
        exec_mock = AsyncMock()
        evaluator, ind = _real_evaluator(exec_mock, [_PE])
        ind.ExecuteFormula = exec_mock
        loop = _make_live_loop(evaluator, gate=False)
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar(1), _bar(2)]))
        loop._marketdata.GetFundamentalsMulti = AsyncMock(return_value=_multi_resp(pe_ratio=12.0))
        loop._marketdata.GetHistoricalFundamentals = AsyncMock()

        await loop._eval_pair(_formula_only_definition(), "AAPL", throttle=0)

        assert loop._marketdata.GetFundamentalsMulti.await_count == 0
        assert loop._marketdata.GetHistoricalFundamentals.await_count == 0
        assert exec_mock.await_count == 0  # all-None hold → formula never runs (no fabricated 0.0)


class TestFullRowParity:
    @pytest.mark.asyncio
    async def test_ac4_full_row_feeds_all_declared_keys_same_output(self):
        """@AC-4: a fully-populated snapshot row (no missing_metrics) feeds the formula the SAME
        input_data keys the producer's scoring formula would — exactly the declared metrics' snake
        keys, none omitted — and the entry rule reads the same ``composite`` output field."""
        fed = {}

        async def _exec(req, metadata=None):
            fed.update(dict(req.input_data))
            out = Struct()
            out.update({"value": 0.5, "composite": 0.8})
            return SimpleNamespace(success=True, output=out, error="")

        # Declared inputs cover three metrics; the snapshot row supplies all three (full row).
        evaluator, _ind = _real_evaluator(_exec, [_PE, _ROE, _EPS])
        loop = _make_live_loop(evaluator)
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar(1), _bar(2)]))
        loop._marketdata.GetFundamentalsMulti = AsyncMock(
            return_value=_multi_resp(pe_ratio=12.0, roe=0.3, eps=5.0)  # no missing_metrics
        )
        loop._marketdata.GetHistoricalFundamentals = AsyncMock()

        await loop._eval_pair(_formula_only_definition(), "AAPL", throttle=0)

        # Same keys the producer feeds (the declared metrics' data keys), all present — no omission.
        assert set(fed) == {"pe_ratio", "roe", "eps"}
        assert fed == {"pe_ratio": 12.0, "roe": 0.3, "eps": 5.0}
