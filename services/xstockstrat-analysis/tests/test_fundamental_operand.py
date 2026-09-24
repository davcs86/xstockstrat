"""Feature 198 — historical-fundamentals strategy operand: point-in-time as-of resolution
with strict T+1 (no look-ahead) carry-forward.

The load-bearing test is the T+1 boundary probe (``@AC-4``): a filing filed on day D is
invisible on every bar dated on or before D and visible only from D+1 — the strict
``filed_date < bar_date`` gate. Also covers between-filings carry-forward, the pre-first-filing
hold (``@AC-3``), the unset-operand baseline byte-identity (``@AC-1 @feature-152``), and the
servicer proto→``FundamentalPeriod`` mapping (missing_metrics→None, filed_date-unset drop).

Real ``marketdata_pb2.Bar`` instances (``bar.time``), never MagicMock — Ledger 2026-08-06 trap.
"""

import json
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.handlers.servicer import _fundamental_periods_from_response
from app.services.evaluator import (
    FundamentalPeriod,
    StrategyEvaluator,
    _fundamental_as_of_series,
    _validate_definition,
)


def _bar(day: datetime, close: float = 100.0) -> marketdata_pb2.Bar:
    b = marketdata_pb2.Bar(symbol="AAPL", open=close, high=close, low=close, close=close)
    b.time.FromDatetime(day)
    return b


def _fundamental_comp(ref_name="pe", metric="pe_ratio"):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_FUNDAMENTAL,
        fundamental_metric=metric,
    )


# ---------------------------------------------------------------------------
# _fundamental_as_of_series — the pure carry-forward core (no look-ahead, T+1)
# ---------------------------------------------------------------------------


class TestFundamentalAsOfSeries:
    def test_t_plus_1_boundary_strict(self):
        """@AC-4: a filing filed on 2020-01-29 is invisible on bars dated on/before 2020-01-29
        (strict ``filed_date < bar_date``) and visible from 2020-01-30 onward."""
        eval_dates = [date(2020, 1, d) for d in (27, 28, 29, 30, 31)]
        funds = [FundamentalPeriod(filed_date=date(2020, 1, 29), values={"pe_ratio": 12.0})]
        series = _fundamental_as_of_series("pe_ratio", eval_dates, funds)
        # 27, 28, 29 → None (29 is the boundary: strict < means the file-day itself is invisible)
        assert series[:3] == [None, None, None]
        # 30, 31 → the filing is now available
        assert series[3:] == [12.0, 12.0]

    def test_carry_forward_between_filings(self):
        """A later bar carries forward the LAST available filing, never a future one."""
        eval_dates = [date(2020, 3, d) for d in (1, 15, 31)]
        funds = [
            FundamentalPeriod(filed_date=date(2020, 2, 1), values={"pe_ratio": 20.0}),
            FundamentalPeriod(filed_date=date(2020, 3, 20), values={"pe_ratio": 8.0}),
        ]
        series = _fundamental_as_of_series("pe_ratio", eval_dates, funds)
        # Mar 1 + Mar 15 carry the Feb-1 filing; Mar 31 sees the Mar-20 filing (never before it).
        assert series == [20.0, 20.0, 8.0]

    def test_none_before_first_filing(self):
        """@AC-3: before the first available filing the metric is None (leaf holds)."""
        eval_dates = [date(2020, 1, 1), date(2020, 1, 2)]
        funds = [FundamentalPeriod(filed_date=date(2020, 6, 1), values={"pe_ratio": 10.0})]
        assert _fundamental_as_of_series("pe_ratio", eval_dates, funds) == [None, None]

    def test_none_valued_metric_span(self):
        """A filing that did not report the metric (value None) yields None for its span,
        distinct from a numeric 0.0 (marketdata missing_metrics contract)."""
        eval_dates = [date(2020, 2, 1), date(2020, 2, 2)]
        funds = [FundamentalPeriod(filed_date=date(2020, 1, 15), values={"pe_ratio": None})]
        assert _fundamental_as_of_series("pe_ratio", eval_dates, funds) == [None, None]

    def test_empty_inputs(self):
        assert _fundamental_as_of_series("pe_ratio", [], None) == []
        assert _fundamental_as_of_series("pe_ratio", [date(2020, 1, 1)], None) == [None]


# ---------------------------------------------------------------------------
# evaluate_with_series — the operand wired end-to-end through a strategy rule
# ---------------------------------------------------------------------------


class TestFundamentalOperandEvaluate:
    @pytest.mark.asyncio
    async def test_entry_respects_t_plus_1(self):
        """@AC-4 look-ahead guard: entry ``pe_ratio < 15`` never fires on a bar dated on/before
        the filing's filed_date; it may fire from the next day. The filing (pe 12) is filed
        2020-01-29, so the boundary bar 2020-01-29 must NOT enter."""
        ev = StrategyEvaluator(AsyncMock(), propagation_meta=())
        days = [datetime(2020, 1, d, tzinfo=UTC) for d in (27, 28, 29, 30, 31)]
        bars = [_bar(d) for d in days]
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[_fundamental_comp()],
            entry_rule=json.dumps({"fn": "<", "lhs": "pe", "rhs": 15}),
        )
        funds = [FundamentalPeriod(filed_date=date(2020, 1, 29), values={"pe_ratio": 12.0})]
        decisions, series = await ev.evaluate_with_series(definition, bars, None, None, funds)
        entered = [d.entry for d in decisions]
        # 27, 28, 29 invisible (no entry); 30, 31 see pe 12 < 15 → entry.
        assert entered == [False, False, False, True, True]
        # The resolved operand series proves the boundary is None, not a fabricated value.
        assert series["pe"] == [None, None, None, 12.0, 12.0]

    @pytest.mark.asyncio
    async def test_unset_operand_baseline_byte_identical(self):
        """@AC-1 @feature-152: a definition with no fundamental operand is unaffected by the
        fundamentals arg — a supplied list is ignored, decisions are byte-identical to None."""

        async def _compute(req, metadata=None):
            from types import SimpleNamespace

            return SimpleNamespace(result=[SimpleNamespace(value=v) for v in req.values])

        stub = AsyncMock()
        stub.ComputeIndicator = AsyncMock(side_effect=_compute)
        ev = StrategyEvaluator(stub, propagation_meta=())
        bars = [_bar(datetime(2020, 1, d, tzinfo=UTC), close=100.0 + d) for d in (1, 2, 3, 4)]
        definition = analysis_pb2.StrategyDefinition(
            strategy_id="s",
            display_name="S",
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="sma",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 1.0},
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": 101}),
        )
        without, _ = await ev.evaluate_with_series(definition, bars, None, None, None)
        stray = [FundamentalPeriod(filed_date=date(2019, 1, 1), values={"pe_ratio": 1.0})]
        with_arg, _ = await ev.evaluate_with_series(definition, bars, None, None, stray)
        assert [d.entry for d in without] == [d.entry for d in with_arg]


# ---------------------------------------------------------------------------
# _validate_definition — write-time operand validation
# ---------------------------------------------------------------------------


class TestFundamentalValidation:
    def test_accepts_known_metric(self):
        d = analysis_pb2.StrategyDefinition(
            components=[_fundamental_comp()],
            entry_rule=json.dumps({"fn": "<", "lhs": "pe", "rhs": 15}),
        )
        _validate_definition(d)  # should not raise

    def test_rejects_unset_metric(self):
        d = analysis_pb2.StrategyDefinition(components=[_fundamental_comp(metric="")])
        with pytest.raises(ValueError):
            _validate_definition(d)

    def test_rejects_unknown_metric(self):
        d = analysis_pb2.StrategyDefinition(components=[_fundamental_comp(metric="not_a_metric")])
        with pytest.raises(ValueError):
            _validate_definition(d)


# ---------------------------------------------------------------------------
# _fundamental_periods_from_response — servicer proto → FundamentalPeriod mapping
# ---------------------------------------------------------------------------


class TestFundamentalPeriodMapping:
    def _period(self, filed, **fields):
        p = marketdata_pb2.HistoricalFundamentalsPeriod(symbol="AAPL", **fields)
        if filed is not None:
            p.filed_date.FromDatetime(filed)
        return p

    def test_maps_filed_date_and_value(self):
        """The PIT value marketdata computed (price-joined pe_ratio) is carried through keyed by
        the filing's filed_date — not a current snapshot (@AC-4, analysis-layer)."""
        resp = marketdata_pb2.GetHistoricalFundamentalsResponse(
            periods=[self._period(datetime(2020, 1, 29, tzinfo=UTC), pe_ratio=12.0, eps=3.0)]
        )
        out = _fundamental_periods_from_response(resp)
        assert len(out) == 1
        assert out[0].filed_date == date(2020, 1, 29)
        assert out[0].values["pe_ratio"] == 12.0
        assert out[0].values["eps"] == 3.0

    def test_missing_metric_maps_to_none_not_zero(self):
        """A metric named in missing_metrics is None (not a fabricated 0.0)."""
        resp = marketdata_pb2.GetHistoricalFundamentalsResponse(
            periods=[
                self._period(
                    datetime(2020, 1, 29, tzinfo=UTC),
                    pe_ratio=0.0,
                    missing_metrics=["pe_ratio"],
                )
            ]
        )
        out = _fundamental_periods_from_response(resp)
        assert out[0].values["pe_ratio"] is None

    def test_filed_date_unset_period_dropped(self):
        """A period with no filed_date has undefined PIT visibility → dropped (look-ahead guard)."""
        resp = marketdata_pb2.GetHistoricalFundamentalsResponse(
            periods=[self._period(None, pe_ratio=9.0)]
        )
        assert _fundamental_periods_from_response(resp) == []
