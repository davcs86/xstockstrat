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

log = logging.getLogger(__name__)

_LOOKBACK_DAYS = 365  # window of bars fetched per (strategy, symbol) for warm-up + evaluation


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
    ):
        self._cfg = config_watcher
        self._db = db_pool
        self._marketdata = marketdata_stub
        self._ingest = ingest_stub
        self._notify = notify_stub
        self._ledger = ledger_stub
        self._evaluator = evaluator  # 047 shared StrategyEvaluator instance
        self._last_state: dict[tuple[str, str], bool] = {}  # (strategy_id, symbol) → in_position
        self._last_alert_ts: dict[tuple[str, str], float] = {}  # throttle tracking
        self._lock = asyncio.Lock()

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
            "SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"
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
        if not definition.HasField("signal_params"):
            return []
        params = json_format.MessageToDict(definition.signal_params)
        return [str(s) for s in (params.get("symbols") or [])]

    def _recent_range(self) -> common_pb2.TimeRange:
        end = Timestamp()
        end.GetCurrentTime()
        start = Timestamp()
        start.FromDatetime(datetime.now(UTC) - timedelta(days=_LOOKBACK_DAYS))
        return common_pb2.TimeRange(start=start, end=end)

    async def _eval_pair(self, definition, symbol, throttle):
        bars_resp = await self._marketdata.GetBars(
            marketdata_pb2.GetBarsRequest(
                symbol=symbol, timeframe="1Day", range=self._recent_range()
            )
        )
        bars = list(bars_resp.bars)
        if not bars:
            return

        decisions = await self._evaluator.evaluate(definition, bars, None)
        if not decisions:
            return

        latest = decisions[-1]
        key = (definition.strategy_id, symbol)
        in_position = self._last_state.get(key, False)

        # FR-4 edge-triggered: only act on a False→True (entry) or True→False (exit) transition.
        if not in_position and latest.entry:
            trigger, new_state = "entry", True
        elif in_position and latest.exit:
            trigger, new_state = "exit", False
        else:
            return  # steady state — no alert

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
