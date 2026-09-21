"""Feature 200 — fundamentals-only CUSTOM_FORMULA operand: a formula that declares
``fundamental_inputs`` is fed only those fundamentals (never OHLCV closes), scored once per
filing-boundary epoch, and broadcast across the span.

Covers @AC-1 (broadcast composite, rule fires on the dotted ``.composite``), @AC-2 (PIT epochs,
no look-ahead, one ExecuteFormula per epoch, mid-window transition), @AC-5 (missing/​error → None
hold, no fabrication), @AC-7 (a technical formula NOT declaring fundamentals is byte-identical),
and @AC-8 (partial row omits the absent metric — never 0.0 — the producer-divergent option b).

Real ``marketdata_pb2.Bar`` (``bar.time``), never MagicMock — Ledger 2026-08-06 / fails.md:727.
"""

import json
from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct

from app.services.evaluator import FormulaExecutionError, FundamentalPeriod, StrategyEvaluator

_PE = indicators_pb2.FUNDAMENTAL_METRIC_PE_RATIO
_ROE = indicators_pb2.FUNDAMENTAL_METRIC_ROE
_EPS = indicators_pb2.FUNDAMENTAL_METRIC_EPS


def _bar(day: datetime, close: float = 100.0) -> marketdata_pb2.Bar:
    b = marketdata_pb2.Bar(symbol="AAPL", open=close, high=close, low=close, close=close)
    b.time.FromDatetime(day)
    return b


def _formula_comp(ref_name="fscore", formula_id="value_quality"):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
        formula_id=formula_id,
    )


def _scalar_resp(**scalars):
    out = Struct()
    out.update(scalars)
    return SimpleNamespace(success=True, output=out, error="")


def _bars_jan(days):
    return [_bar(datetime(2020, 1, d, tzinfo=UTC)) for d in days]


class TestFundamentalsFormulaOperand:
    @pytest.mark.asyncio
    async def test_ac1_broadcast_composite_and_rule_fires(self):
        """@AC-1: the composite output broadcasts across the bars and an entry rule on the dotted
        ``fscore.composite`` fires; bare ``fscore`` resolves to the primary ``value`` sub-score."""
        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(
            return_value=_scalar_resp(value=0.5, quality=0.6, composite=0.72)
        )
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((27, 28, 29, 30, 31))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp()],
            entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.6}),
        )
        funds = [
            FundamentalPeriod(filed_date=date(2019, 1, 1), values={"pe_ratio": 12.0, "roe": 0.3})
        ]
        fmap = {"value_quality": [_PE, _ROE]}
        decisions, series = await ev.evaluate_with_series(definition, bars, None, None, funds, fmap)
        assert series["fscore.composite"] == [0.72] * 5  # broadcast
        assert series["fscore"] == [0.5] * 5  # bare ref → primary "value" sub-score
        assert [d.entry for d in decisions] == [True] * 5  # 0.72 > 0.6

    @pytest.mark.asyncio
    async def test_ac2_pit_epochs_no_lookahead_one_call_per_epoch(self):
        """@AC-2: eps 1.0 (filed 2019-10-30) on bars ≤ 2020-01-29, eps 3.0 (filed 2020-01-29) only
        from 2020-01-30; ExecuteFormula runs ONCE per epoch (O(filings)), mid-window."""
        calls = []

        async def _exec(req, metadata=None):
            fed = dict(req.input_data)
            calls.append(fed)
            return _scalar_resp(value=fed["eps"], composite=fed["eps"])

        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(side_effect=_exec)
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((27, 28, 29, 30, 31))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp()],
            entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 2.0}),
        )
        funds = [
            FundamentalPeriod(filed_date=date(2019, 10, 30), values={"eps": 1.0}),
            FundamentalPeriod(filed_date=date(2020, 1, 29), values={"eps": 3.0}),
        ]
        fmap = {"value_quality": [_EPS]}
        decisions, series = await ev.evaluate_with_series(definition, bars, None, None, funds, fmap)
        # Two epochs in-window (eps 1.0 then eps 3.0) → exactly two ExecuteFormula calls.
        assert stub.ExecuteFormula.await_count == 2
        assert [c["eps"] for c in calls] == [1.0, 3.0]
        # The broadcast composite series shows the mid-window transition at 2020-01-30 (index 3).
        assert series["fscore.composite"] == [1.0, 1.0, 1.0, 3.0, 3.0]
        assert [d.entry for d in decisions] == [False, False, False, True, True]  # >2.0

    @pytest.mark.asyncio
    async def test_ac5_whole_row_missing_holds_none_no_call(self):
        """@AC-5: no fundamentals for the span → None hold across all bars, ExecuteFormula never
        called (no fabricated 0.0)."""
        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(return_value=_scalar_resp(value=0.9, composite=0.9))
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((27, 28, 29))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp()],
            entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.5}),
        )
        fmap = {"value_quality": [_PE]}
        decisions, series = await ev.evaluate_with_series(definition, bars, None, None, None, fmap)
        assert series["fscore"] == [None, None, None]
        assert stub.ExecuteFormula.await_count == 0
        assert [d.entry for d in decisions] == [False, False, False]

    @pytest.mark.asyncio
    async def test_ac5_formula_error_raises(self):
        """@AC-5: a genuine formula failure propagates FormulaExecutionError (the servicer/backtest
        catches it per-symbol; the evaluator must not swallow it into an all-None series)."""
        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(
            return_value=SimpleNamespace(success=False, output=Struct(), error="boom")
        )
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((27, 28))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp()],
            entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.5}),
        )
        funds = [FundamentalPeriod(filed_date=date(2019, 1, 1), values={"pe_ratio": 12.0})]
        with pytest.raises(FormulaExecutionError):
            await ev.evaluate_with_series(
                definition, bars, None, None, funds, {"value_quality": [_PE]}
            )

    @pytest.mark.asyncio
    async def test_ac7_technical_formula_byte_identical(self):
        """@AC-7: a CUSTOM_FORMULA NOT in the formula_fundamentals map is fed {"close": closes} as
        before — the fundamentals branch never fires; no fundamentals input_data is added."""
        closes_seen = {}

        async def _exec(req, metadata=None):
            closes_seen["data"] = dict(req.input_data)
            out = Struct()
            out.update({"value": [b for b in req.input_data["close"]]})
            return SimpleNamespace(success=True, output=out, error="")

        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(side_effect=_exec)
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((1, 2, 3, 4))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp(ref_name="tech", formula_id="rsi_like")],
            entry_rule=json.dumps({"fn": ">", "lhs": "tech", "rhs": 100}),
        )
        # Empty map (or one omitting this formula_id) → the indicator-only path.
        _, series = await ev.evaluate_with_series(definition, bars, None, None, None, {})
        assert "close" in closes_seen["data"]
        assert not any(k in closes_seen["data"] for k in ("pe_ratio", "roe", "eps"))
        assert series["tech"] == [100.0, 100.0, 100.0, 100.0]  # echoed closes

    @pytest.mark.asyncio
    async def test_ac8_partial_row_omits_absent_metric(self):
        """@AC-8 (option b): a row missing roe (present pe_ratio) omits roe from input_data entirely
        — never fed as 0.0 — so the formula neutral-drops it (diverges from the producer)."""
        fed = {}

        async def _exec(req, metadata=None):
            fed.update(dict(req.input_data))
            return _scalar_resp(value=0.5, composite=0.5)

        stub = AsyncMock()
        stub.ExecuteFormula = AsyncMock(side_effect=_exec)
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = _bars_jan((27, 28))
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_formula_comp()],
            entry_rule=json.dumps({"fn": ">", "lhs": "fscore.composite", "rhs": 0.4}),
        )
        # roe is None on the filing (reported pe_ratio only).
        funds = [
            FundamentalPeriod(filed_date=date(2019, 1, 1), values={"pe_ratio": 12.0, "roe": None})
        ]
        await ev.evaluate_with_series(
            definition, bars, None, None, funds, {"value_quality": [_PE, _ROE]}
        )
        assert "pe_ratio" in fed
        assert "roe" not in fed  # omitted, NOT fed as 0.0
