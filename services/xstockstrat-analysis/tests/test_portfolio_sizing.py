"""Feature 150 — portfolio sizing model (Step 6 tests).

Exercises the additive per-bar intent return of the two simulators and the pure
``_simulate_portfolio`` helper in isolation (it is NOT yet routed into RunBacktest — that is
Step 7/8). Each test names the ``@AC-*`` scenario it covers.

Red-before-green (P-06): every assertion here fails against the pre-Step-5 tree — ``BarIntent``,
the simulators' 5th (intent) return element, and ``_simulate_portfolio`` did not exist.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.common.v1 import common_pb2
from google.protobuf.timestamp_pb2 import Timestamp

from app.handlers.servicer import BarIntent, _compute_metrics

from .test_analysis_servicer import _EOF_PAGE, _points, make_servicer

# A fixed tz-aware anchor so the cooldown calendar math (feature 069 parity) is exercised.
_ANCHOR = datetime(2024, 1, 1, tzinfo=UTC)


def _ts(day: int) -> Timestamp:
    """A proto Timestamp `day` days after the anchor (daily-bar aligned across symbols)."""
    ts = Timestamp()
    ts.FromDatetime(_ANCHOR + timedelta(days=day))
    return ts


def _intent(day: int, close: float, entry: bool = False, exit_: bool = False, conv: float = 0.0):
    return BarIntent(_ts(day), close, entry, exit_, conv)


async def _sim(svc, symbol_intents, *, weight=0.10, max_conc=9, cooldown=0, exit_cooldown=0):
    return await svc._simulate_portfolio(
        symbol_intents,
        initial_capital=100_000.0,
        position_weight=weight,
        max_concurrent=max_conc,
        commission=0.0,
        slippage=0.0,
        cooldown_days=cooldown,
        exit_cooldown_days=exit_cooldown,
    )


def _total_return(curve) -> float:
    equity = [p.equity for p in curve]
    return _compute_metrics(equity, [], 100_000.0)["total_return"]


class TestPortfolioSimulator:
    @pytest.mark.asyncio
    async def test_no_lookahead_on_mid_series_gap(self):
        """@AC-1/@AC-2 look-ahead RED: a symbol missing a bar on a date others have is marked to
        market at its LAST ON-OR-BEFORE close, never a future close."""
        svc = make_servicer()
        # GAP holds a bar on day 0 (entry) and day 3, but is MISSING day 1 and day 2 — the days
        # OTHER (present every day) trades on. On day 1/2 GAP must MTM at its day-0 close (100),
        # not its future day-3 close (200).
        intents = {
            "GAP": [
                _intent(0, 100.0, entry=True, conv=1.0),
                _intent(3, 200.0, exit_=True, conv=0.0),
            ],
            "OTHER": [
                _intent(0, 50.0, conv=0.5),
                _intent(1, 50.0, conv=0.5),
                _intent(2, 50.0, conv=0.5),
                _intent(3, 50.0, conv=0.5),
            ],
        }
        curve, skips, trades = await _sim(svc, intents)
        by_day = {p.timestamp.ToDatetime(tzinfo=UTC): p.equity for p in curve}
        # GAP bought 10% of 100k = 10k at close 100 → 100 shares. On day 1/2 (no GAP bar) equity
        # must reflect 100 shares × 100 (last-known), i.e. flat 100k — NOT 100 shares × 200.
        d1 = by_day[_ANCHOR + timedelta(days=1)]
        d2 = by_day[_ANCHOR + timedelta(days=2)]
        assert d1 == pytest.approx(100_000.0), "day-1 MTM used a future close (look-ahead)"
        assert d2 == pytest.approx(100_000.0), "day-2 MTM used a future close (look-ahead)"

    @pytest.mark.asyncio
    async def test_aggregate_is_order_independent_and_not_the_parlay(self):
        """@AC-1: the portfolio aggregate is order-independent and is NOT the serial parlay."""
        svc = make_servicer()

        def series(gain):
            # entry day0 @100, exit day2 @ 100*(1+gain); flat middle bar to force an in-window day.
            return [
                _intent(0, 100.0, entry=True, conv=1.0),
                _intent(1, 100.0, conv=0.5),
                _intent(2, 100.0 * (1 + gain), exit_=True, conv=0.0),
            ]

        base = {"AAA": series(0.20), "BBB": series(0.20), "CCC": series(0.20)}
        reversed_order = {k: base[k] for k in reversed(list(base))}

        curve_a, _, _ = await _sim(svc, base)
        curve_b, _, _ = await _sim(svc, reversed_order)
        ret_a = _total_return(curve_a)
        ret_b = _total_return(curve_b)

        assert ret_a == pytest.approx(ret_b, abs=1e-9), "aggregate depends on symbol ordering"
        # Each position commits 10% of initial capital and gains 20% → +2k each → +6k on 100k.
        assert ret_a == pytest.approx(0.06, abs=1e-9)
        # The serial parlay Π(1+rᵢ)−1 over three +20% legs is 0.728 — provably different.
        parlay = (1.20**3) - 1
        assert abs(ret_a - parlay) > 0.5, "aggregate collapsed to the serial parlay"

    @pytest.mark.asyncio
    async def test_shared_pool_and_per_bar_equity(self):
        """@AC-2: concurrent positions share one pool; each EquityPoint = cash + Σ MTM."""
        svc = make_servicer()
        intents = {
            "AAA": [_intent(0, 100.0, entry=True, conv=1.0), _intent(1, 110.0, conv=0.5)],
            "BBB": [_intent(0, 100.0, entry=True, conv=1.0), _intent(1, 120.0, conv=0.5)],
        }
        curve, skips, trades = await _sim(svc, intents, weight=0.10, max_conc=2)
        assert skips == []  # pool has room for both at 10% each
        # Day 0: 2 × 10k committed → cash 80k, each 100 shares @100 → MTM 20k → equity 100k.
        d0 = curve[0]
        assert d0.equity == pytest.approx(100_000.0)
        # Day 1: AAA 100sh×110 + BBB 100sh×120 = 11k + 12k = 23k; cash 80k → 103k.
        d1 = curve[1]
        assert d1.equity == pytest.approx(103_000.0)
        # Committed capital never exceeds the pool.
        assert d0.equity <= 100_000.0 + 1e-6

    @pytest.mark.asyncio
    async def test_capital_skip_when_pool_full(self):
        """@AC-6: an entry the fully-committed pool can't open is a PortfolioCapitalSkip, not a
        zero-sized fill; the skipped run has strictly fewer trades than the unconstrained run."""
        svc = make_servicer()
        # Two symbols both signal entry on day 0; both stay in through day 1 (terminal).
        intents = {
            "AAA": [_intent(0, 100.0, entry=True, conv=1.0), _intent(1, 100.0, conv=0.5)],
            "BBB": [_intent(0, 100.0, entry=True, conv=1.0), _intent(1, 100.0, conv=0.5)],
        }
        curve, skips, trades = await _sim(svc, intents, weight=0.10, max_conc=1)
        # symbol-ASC: AAA opens, BBB is skipped (capacity full).
        assert len(skips) == 1
        assert skips[0].symbol == "BBB"
        assert skips[0].intended_weight == pytest.approx(10_000.0)  # 0.10 × 100k
        assert skips[0].available_cash == pytest.approx(90_000.0)  # after AAA's 10k
        # Only AAA round-trips (terminal force-close) → 1 trade.
        assert len(trades) == 1
        assert trades[0].symbol == "AAA"
        # Raising max_concurrent so nothing is skipped yields strictly more trades.
        _, skips2, trades2 = await _sim(svc, intents, weight=0.10, max_conc=2)
        assert skips2 == []
        assert len(trades2) > len(trades)

    @pytest.mark.asyncio
    async def test_cooldown_parity_blocks_reentry_in_window(self):
        """@AC-7 (FR-6): a re-entry inside the re-entry cooldown window is blocked, gated on the
        portfolio's own ephemeral per-symbol exit time — never analysis.strategy_cooldowns."""
        svc = make_servicer()
        # AAA: enter day0, exit day5, re-signal entry day10 (< 31d after exit) → blocked;
        # re-signal entry day40 (> 31d after exit) → allowed.
        intents = {
            "AAA": [
                _intent(0, 100.0, entry=True, conv=1.0),
                _intent(5, 110.0, exit_=True, conv=0.0),
                _intent(10, 110.0, entry=True, conv=1.0),
                _intent(40, 110.0, entry=True, conv=1.0),
            ]
        }
        curve, skips, trades = await _sim(svc, intents, cooldown=31)
        # No capital skip: the block is a cooldown, not a capacity/cash exhaustion.
        assert skips == []
        # The day-10 re-entry is suppressed; only the day-0→5 round trip and the day-40 entry
        # (force-closed at terminal) execute → exactly 2 trades.
        assert len(trades) == 2
        entry_days = sorted(t.entry_time.ToDatetime(tzinfo=UTC).day for t in trades)
        # day-of-month: Jan 1 (entry day0) and Feb 10 (entry day40) — never Jan 11 (day10).
        assert (_ANCHOR + timedelta(days=10)).day not in [
            t.entry_time.ToDatetime(tzinfo=UTC).day
            for t in trades
            if t.entry_time.ToDatetime(tzinfo=UTC).month == 1
        ]
        assert len(entry_days) == 2

    @pytest.mark.asyncio
    async def test_no_repo_access(self):
        """FR-6/FR-7: the simulator consults no DB — ephemeral locals, not strategy_cooldowns."""
        svc = make_servicer()
        svc._strategy_cooldowns_repo = AsyncMock()
        intents = {"AAA": [_intent(0, 100.0, entry=True, conv=1.0), _intent(1, 110.0, exit_=True)]}
        await _sim(svc, intents, cooldown=31)
        svc._strategy_cooldowns_repo.assert_not_called()


class TestSimulatorIntentReturn:
    """@AC-3 (half): the legacy simulators still return their original 4 values; intent is an
    additive 5th element computed independent of the position/capital gate."""

    def _sma_svc(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(fast_series), _points(slow_series)]
        )
        return svc

    @pytest.mark.asyncio
    async def test_backtest_symbol_returns_intent_as_additive_fifth(self):
        from gen.marketdata.v1 import marketdata_pb2

        day = 86_400
        bars = [
            marketdata_pb2.Bar(symbol="AAPL", close=10.0 + i, high=10.0 + i, low=10.0 + i)
            for i in range(8)
        ]
        for i, b in enumerate(bars):
            b.time.FromSeconds(1_700_000_000 + i * day)
        svc = self._sma_svc(bars, [9] * 8, [11] * 8)
        rng = common_pb2.TimeRange()
        result = await svc._backtest_symbol(
            "AAPL",
            rng,
            fast_period=2,
            slow_period=3,
            min_conviction=0.0,
            initial_equity=100_000.0,
            commission=0.0,
            slippage=0.0,
        )
        # 5-tuple now; the first four are the unchanged legacy contract.
        assert len(result) == 5
        trades, equity, daily_equity, diag, intents = result
        assert isinstance(trades, list)
        assert isinstance(equity, float)
        assert isinstance(daily_equity, list)
        assert all(isinstance(it, BarIntent) for it in intents)
        # Intent is produced for every simulated (non-seed) bar.
        assert len(intents) >= 1
