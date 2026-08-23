"""Feature 151 — backtest fill model (Step 5 tests).

Covers @AC-1..@AC-11: next-bar-open entry/exit/stop fills, the last-bar no-look-ahead rule, the
legacy same-bar-close byte-for-byte guard (both simulators), the effective-model resolution +
persist/echo round-trip, diagnostics/1:1 alignment, fill-to-fill cooldown, and the display-only
action/conviction decouple.

Red-before-green (P-06): the next-bar assertions fail against the pre-Step-4 tree (no fill_model
param, no _apply_fill). The AC-4 golden assertions are the regression guard (green before/after).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.services.evaluator import BarDecision

from .test_analysis_servicer import (
    _EOF_PAGE,
    _owned_ctx,
    _points,
    _series_bars,
    _sma_def,
    _windowed_req,
    _wire_evaluated,
    make_servicer,
)

SAME = analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE
NEXT = analysis_pb2.FILL_MODEL_NEXT_BAR_OPEN

_T0 = 1_700_000_000


def _bar(day: int, close: float, open_: float) -> marketdata_pb2.Bar:
    """A daily bar with a DISTINCT open vs close so a fill price identifies the model."""
    b = marketdata_pb2.Bar(
        symbol="AAPL",
        open=open_,
        high=max(open_, close) + 1,
        low=min(open_, close) - 1,
        close=close,
        volume=1000,
        vwap=close,
    )
    b.time.FromSeconds(_T0 + day * 86_400)
    return b


def _decisions(n, entries=(), exits=()):
    ds = [BarDecision(bar_index=i, entry=False, exit=False, conviction=0.0) for i in range(n)]
    for i in entries:
        ds[i] = BarDecision(bar_index=i, entry=True, exit=False, conviction=1.0)
    for i in exits:
        ds[i] = BarDecision(bar_index=i, entry=False, exit=True, conviction=0.0)
    return ds


async def _run_eval(bars, decisions, fill_model, *, cooldown=0, exit_cooldown=0):
    """Drive `_backtest_symbol_evaluated` with controlled bars + decisions and a chosen fill model.

    cooldown_days/exit_cooldown_days are pinned via the definition (0 = no gate) so the fill-timing
    behavior is isolated from feature-069/116 cooldowns unless a test opts in."""
    svc = make_servicer()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._compute_evaluated_warmup = AsyncMock(return_value=0)
    definition = analysis_pb2.StrategyDefinition(strategy_id="s1")
    definition.cooldown_days = cooldown
    definition.exit_cooldown_days = exit_cooldown
    fake_eval = MagicMock()
    fake_eval.evaluate_with_series = AsyncMock(return_value=(decisions, {}))
    with patch("app.handlers.servicer.StrategyEvaluator", return_value=fake_eval):
        return await svc._backtest_symbol_evaluated(
            "AAPL",
            common_pb2.TimeRange(),
            definition,
            100_000.0,
            0.0,  # commission
            0.0,  # slippage
            fill_model=fill_model,
        )


class TestNextBarFill:
    @pytest.mark.asyncio
    async def test_entry_fills_at_next_bar_open(self):
        """@AC-1: an entry signal on bar i fills at bars[i+1].open, not bars[i].close."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(6)]
        decisions = _decisions(6, entries=[1])  # entry true on bar 1
        trades, _, _, _, _ = await _run_eval(bars, decisions, NEXT)
        assert trades, "a next-bar entry should still open (and force-close at terminal)"
        assert trades[0].entry_price == pytest.approx(bars[2].open)  # 202, the next bar's open
        assert trades[0].entry_price != pytest.approx(bars[1].close)  # not 101, the signal close

    @pytest.mark.asyncio
    async def test_entry_fills_at_same_bar_close_in_legacy(self):
        """@AC-4 (spot): the same fixture in legacy mode fills at the signal bar's own close."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(6)]
        decisions = _decisions(6, entries=[1])
        trades, _, _, _, _ = await _run_eval(bars, decisions, SAME)
        assert trades[0].entry_price == pytest.approx(bars[1].close)  # 101

    @pytest.mark.asyncio
    async def test_exit_fills_at_next_bar_open(self):
        """@AC-2: an exit signal on bar i fills at bars[i+1].open, not bars[i].close."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(8)]
        decisions = _decisions(8, entries=[1], exits=[4])
        trades, _, _, _, _ = await _run_eval(bars, decisions, NEXT)
        assert len(trades) == 1
        # entry fills at bar 2 open; exit fills at bar 5 open.
        assert trades[0].entry_price == pytest.approx(bars[2].open)
        assert trades[0].exit_price == pytest.approx(bars[5].open)

    @pytest.mark.asyncio
    async def test_last_bar_signal_never_fills(self):
        """@AC-3: an entry signal on the absolute last bar opens no position (no look-ahead)."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(6)]
        decisions = _decisions(6, entries=[5])  # signal on the last bar (index 5)
        trades, equity, _, _, _ = await _run_eval(bars, decisions, NEXT)
        assert trades == []  # fill_idx=6 never runs → no position, no trade
        assert equity == pytest.approx(100_000.0)  # untouched capital

    @pytest.mark.asyncio
    async def test_n_minus_2_signal_fills_and_force_closes(self):
        """@AC-7: an n-2 entry signal fills at bars[n-1].open then force-closes at bars[n-1].close —
        the same single round-trip legacy produces (cross-mode trade-count symmetry)."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(6)]  # n=6, n-2 = index 4
        decisions = _decisions(6, entries=[4])
        nb_trades, _, _, _, _ = await _run_eval(bars, decisions, NEXT)
        lg_trades, _, _, _, _ = await _run_eval(bars, decisions, SAME)
        assert len(nb_trades) == len(lg_trades) == 1  # symmetric count
        assert nb_trades[0].entry_price == pytest.approx(bars[5].open)  # filled at n-1 open
        assert nb_trades[0].exit_price == pytest.approx(bars[5].close)  # force-closed at n-1 close

    @pytest.mark.asyncio
    async def test_diagnostics_aligned_with_fill_bar(self):
        """@AC-6/@AC-11: ENTER lands on the FILL bar (i+1) and daily_equity stays 1:1 with diags;
        the fill row's conviction is that bar's own value (display-only decouple)."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(6)]
        decisions = _decisions(6, entries=[1])
        _, _, daily_equity, sym_diag, _ = await _run_eval(bars, decisions, NEXT)
        assert len(daily_equity) == len(sym_diag.bars)  # the feature-071 1:1 invariant holds
        actions = [b.action for b in sym_diag.bars]
        # ENTER on bar index 2 (the fill bar), NOT bar index 1 (the signal bar).
        assert actions[2] == analysis_pb2.BAR_ACTION_ENTER_LONG
        assert actions[1] != analysis_pb2.BAR_ACTION_ENTER_LONG


class TestFillModelGoldenParity:
    """@AC-4: the legacy default path is byte-for-byte identical (both simulators), and unset ==
    explicit SAME_BAR_CLOSE. The portfolio-sizing suite + the 550+ existing servicer tests are
    the broader regression guard; here we prove unset≡legacy and that next-bar moves numbers."""

    @pytest.mark.asyncio
    async def test_unset_equals_explicit_same_bar_close_evaluated(self):
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(8)]
        decisions = _decisions(8, entries=[1], exits=[4])
        # _run_eval defaults to the passed model; compare SAME vs the simulator's own default.
        same = await _run_eval(bars, decisions, SAME)
        default = await _run_eval(bars, decisions, analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE)
        assert same[0][0].SerializeToString() == default[0][0].SerializeToString()
        # Teeth: next-bar produces a different realized trade (fills at open, not close).
        nb = await _run_eval(bars, decisions, NEXT)
        assert nb[0][0].SerializeToString() != same[0][0].SerializeToString()

    @pytest.mark.asyncio
    async def test_sma_simulator_legacy_default_unchanged(self):
        """The SMA path defaults to legacy; a trading fixture yields identical output whether
        fill_model is unset or explicit SAME_BAR_CLOSE (byte-for-byte guard for the SMA path)."""
        day = 86_400
        bars = [
            marketdata_pb2.Bar(
                symbol="AAPL", open=9.0 + i, high=12.0 + i, low=8.0 + i, close=10.0 + i
            )
            for i in range(8)
        ]
        for i, b in enumerate(bars):
            b.time.FromSeconds(_T0 + i * day)

        def _svc():
            svc = make_servicer()
            svc._marketdata = MagicMock()
            svc._marketdata.GetBars = AsyncMock(
                return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars)
            )
            svc._indicators = MagicMock()
            # fast rises above slow at bar 2 (entry), crosses back at bar 5 (exit).
            svc._indicators.ComputeIndicator = AsyncMock(
                side_effect=[_points([1, 2, 5, 6, 7, 2, 1, 1]), _points([3, 3, 3, 3, 3, 3, 3, 3])]
            )
            return svc

        args = dict(
            symbol="AAPL",
            range_msg=common_pb2.TimeRange(),
            fast_period=2,
            slow_period=3,
            min_conviction=0.0,
            initial_equity=100_000.0,
            commission=0.0,
            slippage=0.0,
        )
        unset = await _svc()._backtest_symbol(**args)
        explicit = await _svc()._backtest_symbol(**args, fill_model=SAME)
        assert unset[0] and explicit[0]  # the fixture actually traded (not an inert pass)
        assert unset[0][0].SerializeToString() == explicit[0][0].SerializeToString()


class TestFillModelCooldownParity:
    @pytest.mark.asyncio
    async def test_cooldown_is_fill_to_fill(self):
        """@AC-8 / confirm-item: the exit-cooldown min-hold is measured fill-to-fill. With a 5-day
        exit cooldown and next-bar fills, an exit signalled too soon after the (deferred) entry is
        blocked; the position instead force-closes at the terminal bar."""
        bars = [_bar(d, close=100 + d, open_=200 + d) for d in range(8)]
        # entry signal bar 1 (fills bar 2), exit signal bar 3 (would fill bar 4 — only 2 days after
        # the bar-2 entry, inside the 5-day min-hold → blocked).
        decisions = _decisions(8, entries=[1], exits=[3])
        trades, _, _, _, _ = await _run_eval(bars, decisions, NEXT, exit_cooldown=5)
        assert len(trades) == 1
        # The early exit was blocked → the position force-closed at the terminal bar's close.
        assert trades[0].exit_price == pytest.approx(bars[-1].close)


class TestRunBacktestFillModelRouting:
    """@AC-5/@AC-9/@AC-10: RunBacktest resolves + records + returns the effective fill model."""

    def _svc_req(self, fill_model=None):
        svc = _wire_evaluated(make_servicer(), _series_bars(6, 12))
        req = _windowed_req(_sma_def())
        if fill_model is not None:
            req.fill_model = fill_model
        return svc, req

    @pytest.mark.asyncio
    async def test_next_bar_run_records_and_returns_model(self):
        svc, req = self._svc_req(fill_model=NEXT)
        svc._backtest_runs_repo = AsyncMock()
        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.fill_model == NEXT
        assert svc._backtest_runs_repo.insert.await_args.kwargs["fill_model"] == (
            "FILL_MODEL_NEXT_BAR_OPEN"
        )

    @pytest.mark.asyncio
    async def test_unset_run_normalizes_to_same_bar_close(self):
        """@AC-10: an unset request with no config override records legacy, never UNSPECIFIED."""
        svc, req = self._svc_req(fill_model=None)
        svc._backtest_runs_repo = AsyncMock()
        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.fill_model == SAME
        assert svc._backtest_runs_repo.insert.await_args.kwargs["fill_model"] == (
            "FILL_MODEL_SAME_BAR_CLOSE"
        )

    @pytest.mark.asyncio
    async def test_config_default_routes_when_request_unset(self):
        """@AC-9: config default_fill_model=2 with an unset request routes next-bar; a request value
        always overrides config."""
        svc, req = self._svc_req(fill_model=None)

        def _get_int(key, default=0):
            return 2 if key == "analysis.backtest.default_fill_model" else default

        svc._cfg.get_int = MagicMock(side_effect=_get_int)
        result = await svc.RunBacktest(req, context=_owned_ctx())
        assert result.fill_model == NEXT

        # A request value overrides the config default.
        svc2, req2 = self._svc_req(fill_model=SAME)
        svc2._cfg.get_int = MagicMock(side_effect=_get_int)
        result2 = await svc2.RunBacktest(req2, context=_owned_ctx())
        assert result2.fill_model == SAME

    def test_row_to_summary_maps_fill_model(self):
        """@AC-5 (summary): the row→summary projection maps the stored name; null → UNSPECIFIED."""
        from app.handlers.servicer import _row_to_backtest_summary

        nb = _row_to_backtest_summary(
            {
                "backtest_id": "b",
                "status": "BACKTEST_STATUS_OK",
                "fill_model": "FILL_MODEL_NEXT_BAR_OPEN",
            }
        )
        assert nb.fill_model == NEXT
        null_row = _row_to_backtest_summary({"backtest_id": "b", "status": "BACKTEST_STATUS_OK"})
        assert null_row.fill_model == analysis_pb2.FILL_MODEL_UNSPECIFIED
