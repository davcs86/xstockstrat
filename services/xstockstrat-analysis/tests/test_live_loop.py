"""
Unit tests for the LiveEvaluationLoop (feature 048-live-strategy-alert-engine).

Covers edge-triggered alerting (FR-4), the FR-6 no-trading safety guard, alert
throttling (FR-3), and per-(strategy, symbol) isolation (FR-8).
"""

import inspect
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2

import app.engine.live_loop as live_loop_module
from app.engine.live_loop import LiveEvaluationLoop
from app.services.evaluator import FormulaExecutionError

# Fixed default bar time; feature 069 made _eval_pair read bars[-1].time, so the mock bar must
# carry a real, tz-aware protobuf Timestamp (an object() stub has no .time).
_DEFAULT_BAR_DT = datetime(2026, 1, 1, tzinfo=UTC)


def _bar_at(dt: datetime):
    """A real marketdata Bar whose ``time`` is ``dt`` (tz-aware)."""
    bar = marketdata_pb2.Bar(symbol="AAPL", close=100.0)
    bar.time.FromDatetime(dt)
    return bar


def _make_loop(cooldowns_repo=None) -> LiveEvaluationLoop:
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    # feature 116: get_int_present (not get_int) resolves exit_cooldown_days' platform default.
    cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)
    loop = LiveEvaluationLoop(
        config_watcher=cfg,
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=AsyncMock(),
        cooldowns_repo=cooldowns_repo,
    )
    loop._marketdata.GetBars = AsyncMock(
        return_value=SimpleNamespace(bars=[_bar_at(_DEFAULT_BAR_DT)])
    )
    loop._notify.EmitAlert = AsyncMock(return_value=MagicMock())
    loop._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return loop


def _decision(entry: bool, exit_: bool, conviction: float = 1.0):
    return SimpleNamespace(entry=entry, exit=exit_, conviction=conviction)


class TestLiveEvaluationLoopStateTracking:
    @pytest.mark.asyncio
    async def test_entry_exit_edge_triggered(self):
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")

        # 1. Entry transition (False → True) fires one alert.
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1

        # 2. Steady-state (still entry, already in position) fires nothing.
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1

        # 3. Exit transition (True → False) fires the second alert.
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 2

    @pytest.mark.asyncio
    async def test_no_bars_no_alert(self):
        loop = _make_loop()
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[]))
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()


class TestLiveEvaluationLoopRequestShape:
    @pytest.mark.asyncio
    async def test_getbars_sends_canonical_string_and_enum(self):
        loop = _make_loop()
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, False)])
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")

        await loop._eval_pair(defn, "AAPL", throttle=0)

        called_req = loop._marketdata.GetBars.await_args.args[0]
        assert called_req.timeframe == "1d"
        assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY


class TestLiveEvaluationLoopThrottle:
    @pytest.mark.asyncio
    async def test_alert_suppressed_within_throttle(self):
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
        # Pretend an alert just fired for this pair.
        loop._last_alert_ts[("u1", "s1", "AAPL")] = time.monotonic()
        await loop._eval_pair(defn, "AAPL", throttle=10_000)
        loop._notify.EmitAlert.assert_not_called()


class TestLiveEvaluationLoopSafety:
    def test_no_trading_imports(self):
        src = inspect.getsource(live_loop_module)
        for forbidden in ("trading_pb2", "TradingService", "PlaceOrder", "portfolio_pb2"):
            assert forbidden not in src, f"FR-6 violation: {forbidden} present in live_loop"


class TestLiveEvaluationLoopIsolation:
    @pytest.mark.asyncio
    async def test_one_pair_error_does_not_block_others(self):
        loop = _make_loop()
        loop._db.fetch = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "display_name": "S1",
                    "active": True,
                    "live_enabled": True,
                    "definition_json": {},
                }
            ]
        )
        loop._symbols_for = MagicMock(return_value=["AAA", "BBB"])
        calls = []

        async def fake_eval(defn, symbol, throttle):
            calls.append(symbol)
            if symbol == "AAA":
                raise RuntimeError("boom")

        loop._eval_pair = fake_eval
        await loop._run_cycle()
        assert calls == ["AAA", "BBB"]  # BBB still evaluated despite AAA error

    @pytest.mark.asyncio
    async def test_formula_error_is_contained_by_the_loop(self):
        # feature 067: FormulaExecutionError is a plain Exception subclass, so the live
        # loop's existing broad `except Exception` already catches it and continues — no
        # new safety code (design § 5, confirm-only). A failing formula must not propagate
        # out of the cycle, and must leave _last_state untouched for the failed pair.
        loop = _make_loop()
        loop._db.fetch = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "user_id": "u1",
                    "display_name": "S1",
                    "active": True,
                    "live_enabled": True,
                    "definition_json": {},
                }
            ]
        )
        loop._symbols_for = MagicMock(return_value=["AAA", "BBB"])
        # Force the alert throttle to 0 so the healthy pair's entry alert is not suppressed.
        # (_run_cycle reads alert_throttle_seconds, default 300; on a freshly-booted host
        # time.monotonic() can be < 300, which would throttle the first-ever alert and make
        # the await_count assertion flaky — as it did on CI.)
        loop._cfg.get_int = MagicMock(
            side_effect=lambda key, default=0: (
                0 if key == "analysis.engine.alert_throttle_seconds" else default
            )
        )
        # The evaluator raises FormulaExecutionError for AAA, returns a clean entry for BBB.
        evaluated = []

        async def fake_evaluate(defn, bars, signals):
            symbol = "AAA" if not evaluated else "BBB"
            evaluated.append(symbol)
            if symbol == "AAA":
                raise FormulaExecutionError("f-1", "boom")
            return [_decision(True, False)]

        loop._evaluator.evaluate = AsyncMock(side_effect=fake_evaluate)

        # Must not raise out of the cycle.
        await loop._run_cycle()

        # Both pairs attempted; the loop continued past the AAA formula error.
        assert evaluated == ["AAA", "BBB"]
        # The failed pair recorded no state; the healthy pair fired its entry alert.
        assert ("u1", "s1", "AAA") not in loop._last_state
        assert loop._last_state.get(("u1", "s1", "BBB")) is True
        assert loop._notify.EmitAlert.await_count == 1


class TestLiveEvaluationLoopCooldown:
    """Feature 069 — durable re-entry cooldown on the live path (FR-8) + backtest/live parity."""

    @pytest.mark.asyncio
    async def test_entry_suppressed_inside_cooldown_window(self):
        """AC-4: an in-window re-entry emits no alert / no state flip; after the window it does."""
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(
            strategy_id="s1", user_id="u1", display_name="S1"
        )  # unset → 31
        key = ("u1", "s1", "AAPL")
        last_exit = datetime(2026, 3, 1, tzinfo=UTC)
        loop._last_exit_at[key] = last_exit
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])

        # Bar 5 days after the exit → inside the 31-day window → suppressed.
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(last_exit + timedelta(days=5))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()
        # feature 116: the replay-then-read step (this key's first-ever _eval_pair call) now
        # explicitly resolves and records _last_state[key] (False, matching the pre-116 default)
        # instead of leaving it absent — the gated entry attempt itself still writes nothing
        # further. Equivalent check to the old "key not in loop._last_state" for what actually
        # matters here: no transition was recorded.
        assert loop._last_state.get(key) is False

        # Bar 35 days after the exit → window elapsed → entry allowed.
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(last_exit + timedelta(days=35))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1
        assert loop._last_state[key] is True

    @pytest.mark.asyncio
    async def test_exit_persists_cooldown_via_repo(self):
        """An exit upserts the last-exit timestamp to the durable repo (bar time)."""
        repo = AsyncMock()
        loop = _make_loop(cooldowns_repo=repo)
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        loop._last_state[("u1", "s1", "AAPL")] = True  # currently in position
        bar_dt = datetime(2026, 4, 1, tzinfo=UTC)
        # feature 116: mark this key as already-replayed so the replay-then-read step (which
        # would otherwise run on this key's first _eval_pair call and re-derive in_position from
        # an empty bars[:-1] window, clobbering the True just set above) is bypassed — this test
        # wants to exercise the transition logic directly, not replay reconstruction. Also seed
        # a known entry anchor — an unresolved one would correctly trigger the skip-until-known
        # guard (Step 11 tests that mechanism directly), which is not what this test is about.
        loop._replayed.add(("u1", "s1", "AAPL"))
        loop._last_entry_at[("u1", "s1", "AAPL")] = bar_dt - timedelta(days=1)
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar_at(bar_dt)]))

        await loop._eval_pair(defn, "AAPL", throttle=0)
        repo.upsert_exit.assert_awaited_once()
        args = repo.upsert_exit.await_args.args
        assert args[0] == "u1" and args[1] == "s1" and args[2] == "AAPL" and args[3] == bar_dt

    @pytest.mark.asyncio
    async def test_exit_persists_even_when_alert_throttled(self):
        """R1: the cooldown clock starts on the exit fact even when the alert is throttled."""
        repo = AsyncMock()
        loop = _make_loop(cooldowns_repo=repo)
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        loop._last_state[("u1", "s1", "AAPL")] = True
        bar_dt = datetime(2026, 4, 1, tzinfo=UTC)
        loop._replayed.add(("u1", "s1", "AAPL"))  # feature 116: bypass replay, see the sibling test
        loop._last_entry_at[("u1", "s1", "AAPL")] = bar_dt - timedelta(days=1)  # known entry anchor
        loop._last_alert_ts[("u1", "s1", "AAPL")] = time.monotonic()  # force throttle
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar_at(bar_dt)]))

        await loop._eval_pair(defn, "AAPL", throttle=10_000)
        loop._notify.EmitAlert.assert_not_called()  # alert throttled
        repo.upsert_exit.assert_awaited_once()  # but the cooldown still persisted

    @pytest.mark.asyncio
    async def test_write_cooldown_failure_never_propagates(self):
        """FR-8 best-effort: a DB write failure is swallowed and state still advances."""
        repo = AsyncMock()
        repo.upsert_exit = AsyncMock(side_effect=RuntimeError("db down"))
        loop = _make_loop(cooldowns_repo=repo)
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        loop._last_state[("u1", "s1", "AAPL")] = True
        bar_dt = datetime(2026, 4, 1, tzinfo=UTC)
        # feature 116: bypass replay (see test_exit_persists_cooldown_via_repo) — without this,
        # replay would reset in_position to False on an empty bars[:-1] window, the exit branch
        # would never fire, and this test would pass without ever exercising the write-failure
        # path it claims to test (a false-positive green). Also seed a known entry anchor — an
        # unresolved one would correctly trigger the skip-until-known guard instead.
        loop._replayed.add(("u1", "s1", "AAPL"))
        loop._last_entry_at[("u1", "s1", "AAPL")] = bar_dt - timedelta(days=1)
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar_at(bar_dt)]))
        await loop._eval_pair(defn, "AAPL", throttle=0)  # must not raise
        repo.upsert_exit.assert_awaited_once()  # the write was actually attempted (and failed)
        assert loop._last_state[("u1", "s1", "AAPL")] is False  # state still flipped

    @pytest.mark.asyncio
    async def test_restart_durability_via_hydrate(self):
        """AC-7: a fresh loop hydrated from the repo still suppresses an in-window re-entry."""
        last_exit = datetime(2026, 3, 1, tzinfo=UTC)
        repo = AsyncMock()
        repo.list_all = AsyncMock(
            return_value=[
                {"user_id": "u1", "strategy_id": "s1", "symbol": "AAPL", "last_exit_at": last_exit}
            ]
        )
        loop = _make_loop(cooldowns_repo=repo)  # simulates a restart — in-memory state empty
        await loop.hydrate_cooldowns()
        assert loop._last_exit_at[("u1", "s1", "AAPL")] == last_exit

        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1")
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(last_exit + timedelta(days=5))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()  # cooldown survived the "restart"

    @pytest.mark.asyncio
    async def test_hydrate_noop_without_repo(self):
        loop = _make_loop(cooldowns_repo=None)
        await loop.hydrate_cooldowns()  # must not raise
        assert loop._last_exit_at == {}

    def test_parity_with_backtest_gate(self):
        """FR-4 / C-10(b): both sites feed the SAME shared helper the same inputs."""
        from app.services.cooldown import is_cooldown_active

        last_exit = datetime(2026, 3, 1, tzinfo=UTC)
        inside = last_exit + timedelta(days=5)
        outside = last_exit + timedelta(days=31)
        # Identical (last_exit, current_ts, cooldown_days) → identical verdict at both call sites.
        assert is_cooldown_active(last_exit, inside, 31) is True
        assert is_cooldown_active(last_exit, outside, 31) is False


class TestLiveEvaluationLoopExitCooldown:
    """Feature 116 — durable exit-cooldown on the live path: min-hold gate, skip-until-known,
    and structural live/replay parity (design.md's three required paired tests + parity)."""

    @pytest.mark.asyncio
    async def test_exit_suppressed_while_min_hold_active(self):
        loop = _make_loop()
        key = ("u1", "s1", "AAPL")
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        defn.exit_cooldown_days = 5
        entry_dt = datetime(2026, 5, 1, tzinfo=UTC)
        loop._last_state[key] = True
        loop._last_entry_at[key] = entry_dt
        loop._replayed.add(key)  # bypass replay — testing the transition gate directly
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])

        # 1 day after entry — inside the 5-day minimum hold.
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(entry_dt + timedelta(days=1))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()
        assert loop._last_state[key] is True  # no transition recorded

    @pytest.mark.asyncio
    async def test_exit_allowed_once_min_hold_elapses(self):
        loop = _make_loop()
        key = ("u1", "s1", "AAPL")
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        defn.exit_cooldown_days = 5
        entry_dt = datetime(2026, 5, 1, tzinfo=UTC)
        loop._last_state[key] = True
        loop._last_entry_at[key] = entry_dt
        loop._replayed.add(key)
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])

        # 35 days after entry — well past the 5-day minimum hold.
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(entry_dt + timedelta(days=35))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1
        assert loop._last_state[key] is False

    @pytest.mark.asyncio
    async def test_exit_suppressed_when_entry_time_unresolved(self):
        """Required (a) — design.md's skip-until-known guard: a known-open pair whose entry
        anchor is still unresolved must not permit an ungated exit."""
        loop = _make_loop()
        key = ("u1", "s1", "AAPL")
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        defn.exit_cooldown_days = 5
        loop._last_state[key] = True
        loop._replayed.add(key)  # in_position known; entry anchor deliberately NOT seeded
        assert key not in loop._last_entry_at
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(datetime(2026, 5, 1, tzinfo=UTC))])
        )

        await loop._eval_pair(defn, "AAPL", throttle=0)

        loop._notify.EmitAlert.assert_not_called()
        loop._ledger.AppendEvent.assert_not_called()
        assert loop._last_state[key] is True  # the skip, not a false exit

    @pytest.mark.asyncio
    async def test_exit_fires_once_entry_time_resolves(self):
        """Required (b) — once the entry anchor becomes known (e.g. the boot-time backfill
        lands), the exit-cooldown gate evaluates normally on the next cycle."""
        loop = _make_loop()
        key = ("u1", "s1", "AAPL")
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        defn.exit_cooldown_days = 5
        loop._last_state[key] = True
        loop._replayed.add(key)
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        bar_dt = datetime(2026, 5, 1, tzinfo=UTC)
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[_bar_at(bar_dt)]))

        # First cycle: unresolved, skipped (mirrors the prior test).
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()

        # The backfill resolves the entry anchor, well past the 5-day minimum hold.
        loop._last_entry_at[key] = bar_dt - timedelta(days=35)
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1
        assert loop._last_state[key] is False

    @pytest.mark.asyncio
    async def test_unresolved_entry_time_does_not_suppress_reentry_gate(self):
        """Required (c) — isolation: the skip-until-known guard lives entirely inside the exit
        branch (anchored on _last_entry_at) and has zero effect on the sibling entry/re-entry
        branch (anchored on the different dict, _last_exit_at) — mirrors
        test_entry_suppressed_inside_cooldown_window exactly, just with an unresolved entry
        anchor present (and absent from _last_state) to prove it doesn't leak across branches."""
        loop = _make_loop()
        key = ("u1", "s1", "AAPL")
        defn = analysis_pb2.StrategyDefinition(
            strategy_id="s1", user_id="u1", display_name="S1"
        )  # unset → 31
        last_exit = datetime(2026, 3, 1, tzinfo=UTC)
        loop._last_exit_at[key] = last_exit
        assert key not in loop._last_state
        assert key not in loop._last_entry_at
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])

        # 5 days after the exit — inside the 31-day re-entry window → suppressed, exactly as
        # the feature-069 gate already proves, unaffected by the exit-cooldown guard.
        loop._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(bars=[_bar_at(last_exit + timedelta(days=5))])
        )
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()
        assert loop._last_state.get(key) is False

    def test_replay_state_matches_sequential_apply_transition(self):
        """FR-4 parity: one bulk _replay_state call must equal N sequential _apply_transition
        calls over the same (bar, decision) sequence — the fold-equivalence a shared-core
        design gives structurally, not by hand-synchronized duplicate logic."""
        from app.engine.live_loop import _apply_transition, _replay_state

        bars = [_bar_at(datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=i)) for i in range(11)]
        # entry@1, an exit attempt@2 (gated — exit_cooldown_days=5, only 1 day held), exit@10
        # (9 days held — allowed).
        decisions = [_decision(False, False) for _ in range(11)]
        decisions[1] = _decision(True, False)
        decisions[2] = _decision(False, True)
        decisions[10] = _decision(False, True)
        cooldown_days, exit_cooldown_days = 31, 5

        replayed = _replay_state(bars, decisions, cooldown_days, exit_cooldown_days)

        state = (False, None, None)
        for bar, decision in zip(bars, decisions, strict=True):
            bar_dt = bar.time.ToDatetime(tzinfo=UTC)
            in_position, entry_time, last_exit_at, _trigger = _apply_transition(
                *state, decision, bar_dt, cooldown_days, exit_cooldown_days
            )
            state = (in_position, entry_time, last_exit_at)

        assert replayed == state
        # Pin the actual expected values too, not just self-agreement.
        assert replayed == (False, None, bars[10].time.ToDatetime(tzinfo=UTC))

    @pytest.mark.asyncio
    async def test_replay_seeded_steady_state_emits_no_alert(self):
        """Replay reconstructing 'already in position' for a key's first-seen-since-restart
        cycle must not itself fire a spurious transition alert — only the seeding, no trigger."""
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        base = datetime(2026, 6, 1, tzinfo=UTC)
        # bar0: entry (establishes in_position=True during replay). bar1: steady (still held).
        # bar2 (the "current"/latest bar): steady — no transition on this cycle.
        bars = [_bar_at(base + timedelta(days=i)) for i in range(3)]
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=bars))
        loop._evaluator.evaluate = AsyncMock(
            return_value=[_decision(True, False), _decision(False, False), _decision(False, False)]
        )

        await loop._eval_pair(defn, "AAPL", throttle=0)

        loop._notify.EmitAlert.assert_not_called()
        loop._ledger.AppendEvent.assert_not_called()
        assert loop._last_state[("u1", "s1", "AAPL")] is True  # replay correctly resolved it open
        assert ("u1", "s1", "AAPL") in loop._replayed

    @pytest.mark.asyncio
    async def test_replay_only_runs_once_per_key(self):
        """A key's bar-replay runs at most once — never re-run on a later cycle."""
        from unittest.mock import patch

        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, False)])
        key = ("u1", "s1", "AAPL")

        with patch(
            "app.engine.live_loop._replay_state", wraps=live_loop_module._replay_state
        ) as spy:
            await loop._eval_pair(defn, "AAPL", throttle=0)
            assert key in loop._replayed
            assert spy.call_count == 1

            await loop._eval_pair(defn, "AAPL", throttle=0)
            assert spy.call_count == 1  # not re-run on the second cycle
