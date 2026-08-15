"""
LiveEvaluationLoop — continuous strategy-to-alert runtime (feature 048).

Runs as an asyncio background task alongside the gRPC server. On a configurable
cadence it evaluates every live-enabled strategy (``analysis.strategies.live_enabled
= TRUE``) against recent bars using the **shared 047 evaluator**, and emits an alert
via xstockstrat-notify on entry/exit *transitions* (edge-triggered, FR-4).

Safety (FR-6): this module never imports or calls any trading/portfolio RPC — it
only reads market data / signals and writes alerts + ledger events.

Symbols: ``StrategyDefinition`` has no dedicated symbols field, so the loop reads the
per-strategy symbol universe from ``signal_params.symbols`` (a list set by the operator
at registration time). Strategies with no symbols are skipped.
"""

import asyncio
import logging
import time
from datetime import UTC, datetime, timedelta

from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2
from gen.notify.v1 import notify_pb2
from google.protobuf import json_format
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.handlers.servicer import _row_to_strategy_definition
from app.repositories.strategies import LIVE_ENABLED_PREDICATE_SQL
from app.services.cooldown import effective_cooldown_days, is_cooldown_active

log = logging.getLogger(__name__)

_LOOKBACK_DAYS = 365  # window of bars fetched per (strategy, symbol) for warm-up + evaluation


def strategy_symbols(definition) -> list[str]:
    """The per-strategy symbol universe from ``signal_params.symbols`` (empty if unset).

    Single source of the live-loop firing contract (feature 089): the loop selects rows and the
    SetStrategyLive precondition both call this, so an "enabled but never-fires" (no-symbols) config
    is rejected by exactly the predicate the consumer applies — no drift (C-10).
    """
    if not definition.HasField("signal_params"):
        return []
    params = json_format.MessageToDict(definition.signal_params)
    return [str(s) for s in (params.get("symbols") or [])]


def _apply_transition(
    in_position: bool,
    entry_time: datetime | None,
    last_exit_at: datetime | None,
    decision,
    bar_dt: datetime,
    cooldown_days: int,
    exit_cooldown_days: int,
) -> tuple[bool, datetime | None, datetime | None, str | None]:
    """Pure edge-triggered transition step — the ONE shared core for both the live bar
    (_eval_pair) and historical replay (_replay_state), so live/replay parity is structural
    (feature 116 design.md § Live loop — shared transition core). Returns (new_in_position,
    new_entry_time, new_last_exit_at, trigger_or_None). `trigger` is "entry"/"exit" only on an
    actual transition; None on steady state OR a gated (cooldown-suppressed) transition attempt
    — including the "known open, entry time unknown" skip (design.md round-4 correctness fix):
    a None entry_time while in_position is treated as an active gate, never as "never entered".
    """
    if not in_position and decision.entry:
        if is_cooldown_active(last_exit_at, bar_dt, cooldown_days):
            return in_position, entry_time, last_exit_at, None
        return True, bar_dt, last_exit_at, "entry"
    if in_position and decision.exit:
        if entry_time is None or is_cooldown_active(entry_time, bar_dt, exit_cooldown_days):
            return in_position, entry_time, last_exit_at, None
        return False, None, bar_dt, "exit"
    return in_position, entry_time, last_exit_at, None


def _replay_state(
    bars,
    decisions,
    cooldown_days: int,
    exit_cooldown_days: int,
    initial_entry_time: datetime | None = None,
    initial_last_exit_at: datetime | None = None,
):
    """Fold _apply_transition over historical (bar, decision) pairs to seed state for a key
    reached for the first time since restart (feature 116). Pure — plain data in, plain data
    out; cannot emit an alert or ledger write by construction.

    Starts from ``initial_entry_time``/``initial_last_exit_at`` (the caller's already-hydrated
    or already-known anchors for this key) rather than unconditionally blank — a short or empty
    replay window (e.g. a restart moments after boot, or the real transition predating the
    lookback window) must never regress an already-known anchor back to ``None``. `in_position`
    always starts `False` regardless: only the replayed decisions can establish "currently
    open", never durable state (hydration has no concept of it). Found necessary during Step 10
    implementation — design.md's original text folds from an unconditional `(False, None,
    None)`, which would silently discard hydrated `last_exit_at`/`last_entry_at` whenever the
    replay window itself shows no crossing (see implementation-spec.md Deviation Log, Step 10).
    """
    in_position, entry_time, last_exit_at = False, initial_entry_time, initial_last_exit_at
    for bar, decision in zip(bars, decisions, strict=True):
        bar_dt = bar.time.ToDatetime(tzinfo=UTC)
        in_position, entry_time, last_exit_at, _trigger = _apply_transition(
            in_position,
            entry_time,
            last_exit_at,
            decision,
            bar_dt,
            cooldown_days,
            exit_cooldown_days,
        )
    return in_position, entry_time, last_exit_at


class LiveEvaluationLoop:
    def __init__(
        self,
        config_watcher,
        db_pool,
        marketdata_stub,
        ingest_stub,
        notify_stub,
        ledger_stub,
        evaluator,
        cooldowns_repo=None,
    ):
        self._cfg = config_watcher
        self._db = db_pool
        self._marketdata = marketdata_stub
        self._ingest = ingest_stub
        self._notify = notify_stub
        self._ledger = ledger_stub
        self._evaluator = evaluator  # 047 shared StrategyEvaluator instance
        # feature 133: all live-loop state is keyed by the 3-tuple (user_id, strategy_id, symbol)
        # so two owners that register the same strategy_id never share transition/cooldown state.
        self._last_state: dict[tuple[str, str, str], bool] = {}  # (user, strat, sym) → in_position
        self._last_alert_ts: dict[tuple[str, str, str], float] = {}  # throttle tracking
        # feature 069: durable re-entry cooldown. _last_exit_at parallels _last_state; the repo
        # (None in tests / no-DB) persists it so the cooldown survives a restart (FR-8). Default
        # None keeps the existing 7-arg constructor callers working.
        self._cooldowns_repo = cooldowns_repo
        self._last_exit_at: dict[tuple[str, str, str], datetime] = {}
        # feature 116: exit-cooldown state. _last_entry_at parallels _last_exit_at (durable,
        # hydrated at boot). _replayed tracks which keys have already run their one-time-since-
        # restart bar-replay (never re-run once resolved). _logged_unresolved is the required
        # throttled-diagnostic's log-once-per-key tracker (design.md § Required diagnostic).
        self._last_entry_at: dict[tuple[str, str, str], datetime] = {}
        self._replayed: set[tuple[str, str, str]] = set()
        self._logged_unresolved: set[tuple[str, str, str]] = set()
        self._lock = asyncio.Lock()

    async def hydrate_cooldowns(self):
        """Load persisted last-exit/last-entry timestamps at boot (like hydrate_scores).

        Does NOT touch `_last_state`/`_replayed` — hydration only recovers durable anchors, never
        `in_position` (a restart-durability concept the re-entry gate never needed and this
        feature adds via bar-replay, not hydration). Marking a hydrated key as "already replayed"
        here would skip replay and leave `in_position` at its `False` default forever for that
        key — exactly the restart gap this feature exists to close.
        """
        if self._cooldowns_repo is None:
            return
        for r in await self._cooldowns_repo.list_all():
            key = (r["user_id"], r["strategy_id"], r["symbol"])
            self._last_exit_at[key] = r["last_exit_at"]
            # .get (not r["last_entry_at"]) — tolerates a row shape that predates migration 012
            # (or a test double built against the pre-116 repo contract); NULL/absent alike mean
            # "no known entry anchor yet".
            last_entry_at = r.get("last_entry_at")
            if last_entry_at is not None:
                self._last_entry_at[key] = last_entry_at

    async def run_forever(self):
        """Entry point — runs indefinitely. Call as asyncio.create_task(loop.run_forever())."""
        while True:
            interval = self._cfg.get_int("analysis.engine.eval_interval_seconds", default=60)
            await asyncio.sleep(interval)
            if self._lock.locked():
                log.info("live_loop: previous cycle still running — skipping")
                continue
            async with self._lock:
                try:
                    await self._run_cycle()
                except Exception as e:  # never let one bad cycle kill the loop
                    log.error("live_loop: cycle error: %s", e)

    async def _run_cycle(self):
        max_pairs = self._cfg.get_int("analysis.engine.max_strategies_per_cycle", default=50)
        throttle = self._cfg.get_int("analysis.engine.alert_throttle_seconds", default=300)
        rows = await self._db.fetch(
            f"SELECT * FROM analysis.strategies WHERE {LIVE_ENABLED_PREDICATE_SQL}"
        )
        processed = 0
        for row in rows:
            definition = _row_to_strategy_definition(dict(row))
            for symbol in self._symbols_for(definition):
                if processed >= max_pairs:
                    return
                processed += 1
                try:  # FR-8 per-strategy isolation
                    await self._eval_pair(definition, symbol, throttle)
                except Exception as e:
                    log.warning(
                        "live_loop: (%s,%s) error: %s — continuing",
                        definition.strategy_id,
                        symbol,
                        e,
                    )

    def _symbols_for(self, definition) -> list[str]:
        """Per-strategy symbol universe from signal_params.symbols (empty if unset)."""
        return strategy_symbols(definition)

    def _recent_range(self) -> common_pb2.TimeRange:
        end = Timestamp()
        end.GetCurrentTime()
        start = Timestamp()
        start.FromDatetime(datetime.now(UTC) - timedelta(days=_LOOKBACK_DAYS))
        return common_pb2.TimeRange(start=start, end=end)

    async def _eval_pair(self, definition, symbol, throttle):
        bars_resp = await self._marketdata.GetBars(
            marketdata_pb2.GetBarsRequest(
                symbol=symbol,
                timeframe="1d",
                timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                range=self._recent_range(),
            )
        )
        bars = list(bars_resp.bars)
        if not bars:
            return

        decisions = await self._evaluator.evaluate(definition, bars, None)
        if not decisions:
            return

        latest = decisions[-1]
        key = (definition.user_id, definition.strategy_id, symbol)

        # feature 069/116: cooldown inputs. Uses bar time (bars[-1]) — the SAME time-source the
        # backtest gate feeds the shared helper — both call sites stay in parity (FR-4/C-10(b)).
        current_bar_dt = bars[-1].time.ToDatetime(tzinfo=UTC)
        cooldown_days = effective_cooldown_days(
            definition.cooldown_days if definition.HasField("cooldown_days") else None,
            self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
        )
        # feature 116: exit-cooldown default. get_int_present (not get_int) — a configured 0 is
        # a legitimate, meaningful default and must not be zero-trapped.
        exit_cooldown_days = effective_cooldown_days(
            definition.exit_cooldown_days if definition.HasField("exit_cooldown_days") else None,
            self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
        )

        # feature 116: replay-then-read, never read-then-replay — a key reached for the first
        # time since restart has its state (in_position/entry_time/last_exit_at) fully resolved
        # from historical bars BEFORE the line below reads `_last_state`, so the "unreachable
        # exit branch after a wrong restart default" gap (design.md) never opens. Runs at most
        # once per key (see test_replay_only_runs_once_per_key, Step 11).
        if key not in self._replayed:
            replayed_in_pos, replayed_entry, replayed_exit = _replay_state(
                bars[:-1],
                decisions[:-1],
                cooldown_days,
                exit_cooldown_days,
                initial_entry_time=self._last_entry_at.get(key),
                initial_last_exit_at=self._last_exit_at.get(key),
            )
            self._last_state[key] = replayed_in_pos
            self._last_entry_at[key] = replayed_entry
            self._last_exit_at[key] = replayed_exit
            self._replayed.add(key)

        in_position = self._last_state.get(key, False)
        new_in_position, new_entry_time, new_last_exit_at, trigger = _apply_transition(
            in_position,
            self._last_entry_at.get(key),
            self._last_exit_at.get(key),
            latest,
            current_bar_dt,
            cooldown_days,
            exit_cooldown_days,
        )

        if trigger is None:
            # feature 116 skip-until-known (design.md's required correctness fix): a pair known
            # to be open whose entry anchor is still unresolved (boot-time backfill hasn't
            # landed yet) is silently included in this "no transition" case by _apply_transition
            # itself — surface it once per key so a permanently-stuck pair is diagnosable
            # (fails.md 2026-07-29: "a graceful-skip guard must never be silent"), never every
            # eval_interval_seconds cycle forever. This guard is pinned by three required tests
            # in test_live_loop.py::TestLiveEvaluationLoopExitCooldown — do not weaken it without
            # re-reading them: test_exit_suppressed_when_entry_time_unresolved (suppression),
            # test_exit_fires_once_entry_time_resolves (resolution), and
            # test_unresolved_entry_time_does_not_suppress_reentry_gate (isolation from the
            # sibling re-entry-cooldown branch).
            if (
                in_position
                and self._last_entry_at.get(key) is None
                and key not in self._logged_unresolved
            ):
                self._logged_unresolved.add(key)
                log.warning(
                    "live_loop: (%s,%s) in position with unresolved entry time — exit-cooldown "
                    "gate is skipping this pair until app.engine.entry_backfill resolves it "
                    "(feature 116)",
                    key[0],
                    key[1],
                )
            return  # steady state or a gated transition attempt — no alert, no state write

        new_state = new_in_position
        if trigger == "exit":
            # feature 069: start the cooldown clock on the exit fact, BEFORE the alert-throttle
            # check below — the throttle governs alert cadence, not the exit fact (design R1).
            self._last_exit_at[key] = new_last_exit_at
            await self._write_cooldown(key, new_last_exit_at)
        else:  # "entry"
            self._last_entry_at[key] = new_entry_time
            await self._write_entry_cooldown(key, new_entry_time)

        # Alert throttle (FR-3): suppress repeats within alert_throttle_seconds.
        now = time.monotonic()
        if now - self._last_alert_ts.get(key, 0.0) < throttle:
            self._last_state[key] = new_state  # still record the transition
            return

        await self._emit_alert(definition, symbol, trigger, latest)
        await self._emit_ledger(definition, symbol, trigger)
        self._last_alert_ts[key] = now
        self._last_state[key] = new_state

    async def _emit_alert(self, definition, symbol, trigger, decision):
        ctx = Struct()
        ctx.update(
            {
                "strategy_id": definition.strategy_id,
                "symbol": symbol,
                "trigger_type": trigger,
                "conviction": float(decision.conviction),
            }
        )
        await self._notify.EmitAlert(
            notify_pb2.EmitAlertRequest(
                severity=notify_pb2.ALERT_SEVERITY_WARNING,
                category="strategy",
                title=f"Strategy {definition.strategy_id} {trigger} on {symbol}",
                body=f"{definition.display_name or definition.strategy_id} "
                f"triggered {trigger} for {symbol}",
                source_service="xstockstrat-analysis",
                tags=[f"strategy_id:{definition.strategy_id}"],
                context=ctx,
            )
        )

    async def _emit_ledger(self, definition, symbol, trigger):
        from gen.ledger.v1 import ledger_pb2

        payload = Struct()
        payload.update(
            {"strategy_id": definition.strategy_id, "symbol": symbol, "trigger_type": trigger}
        )
        try:
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="analysis.strategy.triggered",
                    source_service="xstockstrat-analysis",
                    stream_key=f"strategy:{definition.strategy_id}",
                    payload=payload,
                )
            )
        except Exception as e:
            log.warning("live_loop: ledger emit failed: %s", e)

    async def _write_cooldown(self, key, ts):
        """Best-effort durable upsert of a pair's last-exit timestamp (feature 069, FR-8).

        Mirrors _emit_ledger's isolation: a DB failure is swallowed here so it can never propagate
        out of _eval_pair and never prevents the in-memory state transition from completing (which
        would otherwise wedge the pair "in position" until the DB recovered).
        """
        if self._cooldowns_repo is None:
            return
        try:
            await self._cooldowns_repo.upsert_exit(key[0], key[1], key[2], ts)
        except Exception as e:
            log.warning("live_loop: cooldown write failed: %s", e)

    async def _write_entry_cooldown(self, key, ts):
        """Best-effort durable upsert of a pair's last-entry timestamp (feature 116, FR-8).

        Mirrors _write_cooldown's isolation exactly, targeting upsert_entry instead.
        """
        if self._cooldowns_repo is None:
            return
        try:
            await self._cooldowns_repo.upsert_entry(key[0], key[1], key[2], ts)
        except Exception as e:
            log.warning("live_loop: entry cooldown write failed: %s", e)
