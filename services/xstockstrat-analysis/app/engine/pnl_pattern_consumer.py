"""
pnl_pattern_consumer.py — ledger StreamEvents consumer for order-snapshot capture + P&L pattern
attribution (feature 042).

Design (design.md § 2): ONE broad `StreamEvents` subscription with both filters null preserves the
ledger's GLOBAL sequence order across stream keys. Per event, strictly in order:
  1. short-circuit any event whose sequence <= the committed cursor (kills replay phantom-opens);
  2. never self-consume analysis.* emissions;
  3. on order.* events, compose the snapshot BEFORE the DB txn (best-effort, timeout-bounded → a
     partial snapshot on timeout, never an abort — FR-6);
  4. in ONE txn, insert the snapshot, open/seal the pnl_positions window, and advance the cursor
     (atomic — a crash never advances the cursor past unwritten data);
  5. after commit, emit best-effort audit events (captured / degraded / sealed — FR-7).

The snapshot composition (marketdata bar + indicators + signals) is behind an injectable
``SnapshotComposer`` so the consumer's ordering/idempotency/seal logic is unit-testable without live
gRPC. Runs as a boot task; never blocks server start.
"""

import asyncio
import logging

import grpc
from gen.indicators.v1 import indicators_pb2
from gen.ingest.v1 import ingest_pb2
from gen.ledger.v1 import ledger_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.json_format import MessageToDict

from app.repositories.order_snapshots import OrderSnapshotsRepository
from app.repositories.pnl_pattern_samples import PnLPatternSamplesRepository
from app.repositories.pnl_positions import PnLPositionsRepository

log = logging.getLogger(__name__)

CONSUMER_NAME = "pnl_pattern"

# trading emits the American one-`l` "order.canceled" (trading.go:828,1248) — matching the British
# spelling would silently never capture cancels.
ORDER_EVENTS = {
    "order.created": "created",
    "order.filled": "filled",
    "order.partially_filled": "partially_filled",
    "order.canceled": "canceled",
}
CLOSE_EVENT = "portfolio.position.closed"

# The default indicator set captured per snapshot (v1). Strategy-component-driven resolution is the
# named v2 refinement (Step 14 docs) — recorded, not silently dropped.
DEFAULT_INDICATORS = ("RSI", "ATR")


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


class SnapshotComposer:
    """Best-effort context composer: latest OHLCV bar, indicator values, active signals."""

    def __init__(self, marketdata_stub, indicators_stub, ingest_stub):
        self._marketdata = marketdata_stub
        self._indicators = indicators_stub
        self._ingest = ingest_stub

    async def ohlcv_and_closes(self, symbol, meta=()):
        """(latest bar dict | None, closes list). Best-effort — empty on any failure."""
        try:
            resp = await self._marketdata.GetBars(
                marketdata_pb2.GetBarsRequest(symbol=symbol, timeframe="1d"), metadata=meta
            )
        except grpc.RpcError as e:
            log.warning("snapshot GetBars failed for %s: %s", symbol, e)
            return None, []
        bars = list(resp.bars)
        if not bars:
            return None, []
        last = bars[-1]
        bar = {
            "open": last.open,
            "high": last.high,
            "low": last.low,
            "close": last.close,
            "volume": last.volume,
        }
        return bar, [b.close for b in bars]

    async def indicators(self, symbol, closes, strategy_id, meta=()):
        """Latest value of each default indicator over closes. Raises on transport error so the
        consumer's timeout/degraded path engages; returns {} when there is nothing to compute."""
        out: dict[str, float] = {}
        if len(closes) < 2:
            return out
        for name in DEFAULT_INDICATORS:
            resp = await self._indicators.ComputeIndicator(
                indicators_pb2.ComputeIndicatorRequest(
                    indicator=name, values=list(closes), params={}, timeframe="1d"
                ),
                metadata=meta,
            )
            vals = [p.value for p in resp.result if p.value != 0]
            if vals:
                out[name] = vals[-1]
        return out

    async def signals(self, symbol, meta=()):
        """Active signals for the symbol as [{name, value, source}] (value = ingest conviction)."""
        resp = await self._ingest.QuerySignals(
            ingest_pb2.QuerySignalsRequest(symbol=symbol), metadata=meta
        )
        return [
            {"name": s.source, "value": _num(getattr(s, "conviction", 0.0)), "source": s.source}
            for s in resp.signals
        ]


class PnLPatternConsumer:
    def __init__(
        self,
        *,
        db_pool,
        ledger_stub,
        config_watcher,
        composer,
        snapshots=None,
        positions=None,
        samples=None,
    ):
        self._pool = db_pool
        self._ledger = ledger_stub
        self._cfg = config_watcher
        self._composer = composer
        # Repos default to the real asyncpg-backed implementations; tests inject fakes (the pool is
        # a concrete asyncpg pool in prod, so this seam keeps the seal logic unit-testable).
        self._snapshots = snapshots or OrderSnapshotsRepository(db_pool)
        self._positions = positions or PnLPositionsRepository(db_pool)
        self._samples = samples or PnLPatternSamplesRepository(db_pool)

    async def _cursor(self) -> int:
        row = await self._pool.fetchval(
            "SELECT last_sequence FROM analysis.ledger_stream_cursor WHERE consumer=$1",
            CONSUMER_NAME,
        )
        return int(row) if row is not None else 0

    async def run_forever(self):
        """Boot task entry — reconnects on stream error, never exits."""
        while True:
            try:
                cursor = await self._cursor()
                stream = self._ledger.StreamEvents(
                    ledger_pb2.StreamEventsRequest(from_sequence=cursor)
                )
                async for event in stream:
                    try:
                        await self.process_event(event)
                    except Exception as e:  # noqa: BLE001 — one bad event never kills the loop
                        log.warning("pnl consumer: event %s error: %s", event.event_id, e)
            except Exception as e:  # noqa: BLE001 — reconnect on stream drop
                log.warning("pnl consumer: stream error, retrying: %s", e)
                await asyncio.sleep(2)

    async def process_event(self, event) -> None:
        cursor = await self._cursor()
        # (1) replay short-circuit — before any mutation.
        if event.sequence <= cursor:
            return
        # (2) never self-consume analysis's own emissions.
        if event.source_service == "xstockstrat-analysis" or event.event_type.startswith(
            "analysis."
        ):
            await self._advance_cursor(event.sequence)
            return

        payload = MessageToDict(event.payload) if event.HasField("payload") else {}

        if event.event_type in ORDER_EVENTS:
            await self._handle_order_event(event, payload)
        elif event.event_type == CLOSE_EVENT:
            await self._handle_close_event(event, payload)
        else:
            await self._advance_cursor(event.sequence)

    # ── order.* → compose snapshot, open window, advance cursor (one txn) ──────────

    async def _handle_order_event(self, event, payload) -> None:
        symbol = payload.get("symbol", "")
        user_id = payload.get("user_id", "")
        account_id = payload.get("account_id", "") or "alpaca-default"
        trading_mode = payload.get("trading_mode") or payload.get("mode") or ""
        strategy_id = payload.get("strategy_id") or None
        order_id = payload.get("order_id", "")
        side = payload.get("side")
        quantity = _num(payload.get("quantity", payload.get("qty")))
        price = _num(payload.get("price", payload.get("fill_price")))
        position_id = self._synth_position_id(user_id, account_id, symbol, trading_mode)
        event_type = ORDER_EVENTS[event.event_type]

        # Compose BEFORE the txn — best-effort, timeout-bounded (FR-6).
        bar, closes, indicators, signals, degraded = await self._compose(symbol, strategy_id)

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._snapshots.insert(
                    conn,
                    event_id=event.event_id,
                    order_id=order_id,
                    position_id=position_id,
                    symbol=symbol,
                    event_type=event_type,
                    event_ts=event.recorded_at.ToDatetime()
                    if event.HasField("recorded_at")
                    else None,
                    strategy_id=strategy_id,
                    side=side,
                    quantity=quantity,
                    price=price,
                    ohlcv_bar=bar,
                    indicators=indicators,
                    signals=signals,
                )
                # Open the position window on the first order event of a cycle
                # (no-op if already open).
                if event_type in ("created", "filled", "partially_filled") and user_id:
                    await self._positions.open(
                        conn,
                        position_id=position_id,
                        user_id=user_id,
                        account_id=account_id,
                        symbol=symbol,
                        trading_mode=trading_mode,
                        strategy_id=strategy_id,
                        opened_at=event.recorded_at.ToDatetime()
                        if event.HasField("recorded_at")
                        else None,
                        open_event_id=event.event_id,
                    )
                await self._advance_cursor_conn(conn, event.sequence)

        # (5) best-effort audit after commit.
        await self._emit(
            "analysis.snapshot.degraded" if degraded else "analysis.snapshot.captured",
            f"snapshot:{position_id}",
            {
                "order_id": order_id,
                "symbol": symbol,
                "event_type": event_type,
                "degraded": degraded,
            },
        )

    # ── portfolio.position.closed → seal window, write samples, advance cursor ─────

    async def _handle_close_event(self, event, payload) -> None:
        user_id = payload.get("user_id", "")
        symbol = payload.get("symbol", "")
        account_id = payload.get("account_id", "") or "alpaca-default"
        trading_mode = payload.get("trading_mode") or payload.get("mode") or ""
        realized_pnl = _num(payload.get("realized_pnl"))
        closed_at = event.recorded_at.ToDatetime() if event.HasField("recorded_at") else None

        sealed = None
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                sealed = await self._positions.seal(
                    conn,
                    user_id=user_id,
                    account_id=account_id,
                    symbol=symbol,
                    trading_mode=trading_mode,
                    closed_at=closed_at,
                    realized_pnl=realized_pnl,
                    close_event_id=event.event_id,
                )
                if sealed is not None:
                    rows = await self._build_samples(
                        sealed, realized_pnl, closed_at, event.event_id
                    )
                    if rows:
                        await self._samples.insert_many(conn, rows)
                await self._advance_cursor_conn(conn, event.sequence)

        # An empty-window close (pre-deploy open, no snapshots) no-ops — nothing sealed.
        if sealed is not None:
            # Seal-time completeness diagnostic (v1 named limitation — Step 14 docs).
            count = await self._snapshots.count_for_position(sealed["position_id"])
            if count < 2:
                log.warning(
                    "pnl consumer: sealed position %s has only %d snapshot(s) — "
                    "window may be incomplete",
                    sealed["position_id"],
                    count,
                )
            await self._emit(
                "analysis.pattern.sealed",
                f"pattern:{sealed['position_id']}",
                {
                    "symbol": symbol,
                    "realized_pnl": realized_pnl,
                    "position_id": sealed["position_id"],
                },
            )

    async def _build_samples(self, sealed, realized_pnl, closed_at, close_event_id) -> list[dict]:
        """One sample per distinct factor across the sealed position's snapshots (v1: dedup by
        factor_name, entry value wins). Indicators → indicator_value; signals → signal_present."""
        snaps = await self._snapshots.list_for_position(sealed["position_id"])
        seen: dict[tuple, dict] = {}
        for snap in snaps:
            inds = snap.get("indicators") or {}
            if isinstance(inds, str):
                import json

                inds = json.loads(inds)
            for name, value in inds.items():
                key = ("indicator", name)
                if key not in seen:
                    seen[key] = {
                        "symbol": sealed["symbol"],
                        "strategy_id": sealed.get("strategy_id"),
                        "factor_name": name,
                        "factor_type": "indicator",
                        "indicator_value": _num(value),
                        "signal_present": None,
                        "realized_pnl": realized_pnl,
                        "closed_at": closed_at,
                        "close_event_id": close_event_id,
                        "position_id": sealed["position_id"],
                    }
            sigs = snap.get("signals") or []
            if isinstance(sigs, str):
                import json

                sigs = json.loads(sigs)
            for sig in sigs:
                name = sig.get("name") or sig.get("source") or "signal"
                key = ("signal", name)
                if key not in seen:
                    seen[key] = {
                        "symbol": sealed["symbol"],
                        "strategy_id": sealed.get("strategy_id"),
                        "factor_name": name,
                        "factor_type": "signal",
                        "indicator_value": None,
                        "signal_present": True,
                        "realized_pnl": realized_pnl,
                        "closed_at": closed_at,
                        "close_event_id": close_event_id,
                        "position_id": sealed["position_id"],
                    }
        return list(seen.values())

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _compose(self, symbol, strategy_id):
        """Returns (bar, closes, indicators, signals, degraded). Each gRPC group is bounded by its
        config timeout; a timeout/error degrades to an empty map/list (partial snapshot), never
        raising out of here (FR-6)."""
        ind_timeout = self._cfg.get_int("analysis.snapshot.indicator_timeout_ms", 500) / 1000.0
        sig_timeout = self._cfg.get_int("analysis.snapshot.signal_timeout_ms", 500) / 1000.0
        degraded = False
        bar, closes = None, []
        try:
            bar, closes = await self._composer.ohlcv_and_closes(symbol)
        except Exception as e:  # noqa: BLE001
            log.warning("snapshot ohlcv compose failed for %s: %s", symbol, e)
            degraded = True
        try:
            indicators = await asyncio.wait_for(
                self._composer.indicators(symbol, closes, strategy_id), timeout=ind_timeout
            )
        except Exception as e:  # noqa: BLE001 — timeout or transport → partial (FR-6)
            log.warning("snapshot indicators degraded for %s: %s", symbol, e)
            indicators, degraded = {}, True
        try:
            signals = await asyncio.wait_for(self._composer.signals(symbol), timeout=sig_timeout)
        except Exception as e:  # noqa: BLE001 — timeout or transport → partial (FR-6)
            log.warning("snapshot signals degraded for %s: %s", symbol, e)
            signals, degraded = [], True
        return bar, closes, indicators, signals, degraded

    @staticmethod
    def _synth_position_id(user_id, account_id, symbol, trading_mode) -> str:
        # Order carries no position_id — synthesize from the identity key (recon Risk). v1: one
        # logical window per identity; the pnl_positions partial unique index enforces one open row.
        return f"{user_id}:{account_id}:{symbol}:{trading_mode}"

    async def _advance_cursor(self, sequence) -> None:
        async with self._pool.acquire() as conn:
            await self._advance_cursor_conn(conn, sequence)

    async def _advance_cursor_conn(self, conn, sequence) -> None:
        await conn.execute(
            """
            INSERT INTO analysis.ledger_stream_cursor (consumer, last_sequence)
            VALUES ($1, $2)
            ON CONFLICT (consumer) DO UPDATE SET last_sequence = GREATEST(
                analysis.ledger_stream_cursor.last_sequence, EXCLUDED.last_sequence)
            """,
            CONSUMER_NAME,
            int(sequence),
        )

    async def _emit(self, event_type, stream_key, payload) -> None:
        try:
            from google.protobuf.struct_pb2 import Struct

            p = Struct()
            p.update(
                {
                    k: (v if isinstance(v, (int, float, bool)) else str(v))
                    for k, v in payload.items()
                }
            )
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type=event_type,
                    source_service="xstockstrat-analysis",
                    stream_key=stream_key,
                    payload=p,
                )
            )
        except Exception as e:  # noqa: BLE001 — audit is best-effort
            log.warning("pnl consumer: ledger emit %s failed: %s", event_type, e)
