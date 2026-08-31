"""
Tests for the feature-042 P&L pattern consumer (app/engine/pnl_pattern_consumer.py).

The consumer's DB is faked in-memory (injected repos + a fake pool/cursor) so ordering, idempotency,
snapshot capture, seal, degraded-timeout, and audit-emission logic are exercised without a live
database or gRPC. LedgerEvents are real protos so payload/HasField/sequence behave like production.

asyncio_mode = auto (pyproject) — bare `async def test_*` runs.
"""

import asyncio

from gen.ledger.v1 import ledger_pb2
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.engine.pnl_pattern_consumer import PnLPatternConsumer

# ── LedgerEvent builder ─────────────────────────────────────────────────────


def make_event(seq, event_type, payload, *, event_id=None, source_service="trading"):
    p = Struct()
    p.update(payload)
    ts = Timestamp()
    ts.FromSeconds(1_700_000_000 + seq)
    return ledger_pb2.LedgerEvent(
        event_id=event_id or f"evt-{seq}",
        event_type=event_type,
        source_service=source_service,
        recorded_at=ts,
        payload=p,
        sequence=seq,
    )


# ── In-memory fakes ─────────────────────────────────────────────────────────


class FakeTxn:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeAcquire:
    def __init__(self, pool):
        self._pool = pool

    async def __aenter__(self):
        return self._pool  # the pool doubles as the connection (shared cursor state)

    async def __aexit__(self, *a):
        return False


class FakePool:
    def __init__(self):
        self.cursor = 0

    async def fetchval(self, sql, *args):
        if "ledger_stream_cursor" in sql:
            return self.cursor
        return None

    def acquire(self):
        return FakeAcquire(self)

    def transaction(self):
        return FakeTxn()

    async def execute(self, sql, *args):
        if "ledger_stream_cursor" in sql:
            self.cursor = max(self.cursor, int(args[1]))


class FakeSnapshots:
    def __init__(self):
        self.rows = []

    async def insert(
        self, db, *, event_id, position_id, symbol, event_type, indicators, signals, **kw
    ):
        if any(r["event_id"] == event_id for r in self.rows):
            return  # ON CONFLICT DO NOTHING
        self.rows.append(
            {
                "event_id": event_id,
                "position_id": position_id,
                "symbol": symbol,
                "event_type": event_type,
                "indicators": indicators or {},
                "signals": signals or [],
            }
        )

    async def count_for_position(self, position_id):
        return sum(1 for r in self.rows if r["position_id"] == position_id)

    async def list_for_position(self, position_id):
        return [r for r in self.rows if r["position_id"] == position_id]


class FakePositions:
    def __init__(self):
        self.open_rows = {}  # identity -> row
        self.seal_kwargs = None  # feature 029 — capture the kwargs the last seal() received

    @staticmethod
    def _key(user_id, account_id, symbol, trading_mode):
        return (user_id, account_id, symbol, trading_mode)

    async def open(
        self, db, *, position_id, user_id, account_id, symbol, trading_mode, strategy_id, **kw
    ):
        k = self._key(user_id, account_id, symbol, trading_mode)
        self.open_rows.setdefault(
            k, {"position_id": position_id, "strategy_id": strategy_id, "symbol": symbol}
        )

    async def seal(self, db, *, user_id, account_id, symbol, trading_mode, close_event_id, **kw):
        self.seal_kwargs = kw  # captures realized_pnl, fees_total (feature 029), closed_at
        k = self._key(user_id, account_id, symbol, trading_mode)
        row = self.open_rows.pop(k, None)
        return row


class FakeSamples:
    def __init__(self):
        self.rows = []

    async def insert_many(self, db, rows):
        self.rows.extend(rows)


class FakeLedger:
    def __init__(self):
        self.appended = []

    async def AppendEvent(self, req, metadata=()):
        self.appended.append(req.event_type)
        return None


class FakeCfg:
    def __init__(self, **over):
        self._over = over

    def get_int(self, key, default):
        return self._over.get(key, default)


class FakeComposer:
    """Canned composer. Set indicators/signals; or make a group hang past the timeout."""

    def __init__(self, *, indicators=None, signals=None, hang_indicators=False):
        self._indicators = indicators if indicators is not None else {"RSI": 55.0}
        self._signals = (
            signals if signals is not None else [{"name": "uw", "value": 0.8, "source": "uw"}]
        )
        self._hang_indicators = hang_indicators

    async def ohlcv_and_closes(self, symbol, meta=()):
        return {"close": 100.0}, [99.0, 100.0]

    async def indicators(self, symbol, closes, strategy_id, meta=()):
        if self._hang_indicators:
            await asyncio.sleep(10)  # exceeds the test timeout → wait_for cancels it
        return dict(self._indicators)

    async def signals(self, symbol, meta=()):
        return list(self._signals)


def make_consumer(*, composer=None, cfg=None):
    pool = FakePool()
    snaps, positions, samples, ledger = (
        FakeSnapshots(),
        FakePositions(),
        FakeSamples(),
        FakeLedger(),
    )
    consumer = PnLPatternConsumer(
        db_pool=pool,
        ledger_stub=ledger,
        config_watcher=cfg or FakeCfg(),
        composer=composer or FakeComposer(),
        snapshots=snaps,
        positions=positions,
        samples=samples,
    )
    return consumer, pool, snaps, positions, samples, ledger


ORDER_PAYLOAD = {
    "symbol": "AAPL",
    "user_id": "u-1",
    "account_id": "acct-1",
    "trading_mode": "TRADING_MODE_PAPER",
    "strategy_id": "strat-1",
    "order_id": "ord-1",
    "side": "buy",
    "quantity": 10,
    "price": 100,
}
CLOSE_PAYLOAD = {
    "symbol": "AAPL",
    "user_id": "u-1",
    "account_id": "acct-1",
    "trading_mode": "TRADING_MODE_PAPER",
    "realized_pnl": 250.0,
}


# ── AC-1: fill captures a snapshot with indicator + signal context ──────────


async def test_ac1_fill_captures_snapshot_with_context():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    assert len(snaps.rows) == 1
    row = snaps.rows[0]
    assert row["event_type"] == "filled"
    assert row["symbol"] == "AAPL"
    assert row["indicators"] == {"RSI": 55.0}
    assert row["signals"] and row["signals"][0]["source"] == "uw"
    assert pool.cursor == 1
    assert "analysis.snapshot.captured" in ledger.appended


# ── AC-2: close seals the window + writes pattern samples (also partial-fill) ─


async def test_ac2_close_seals_and_writes_samples():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    await consumer.process_event(
        make_event(2, "order.partially_filled", {**ORDER_PAYLOAD, "order_id": "ord-2"})
    )
    await consumer.process_event(
        make_event(
            3, "portfolio.position.closed", CLOSE_PAYLOAD, source_service="xstockstrat-portfolio"
        )
    )
    # A sample per distinct factor (RSI indicator + uw signal) with the sealed realized P&L.
    assert samples.rows, "expected pattern samples written on seal"
    assert {r["factor_type"] for r in samples.rows} == {"indicator", "signal"}
    assert all(r["realized_pnl"] == 250.0 for r in samples.rows)
    assert "analysis.pattern.sealed" in ledger.appended
    assert pool.cursor == 3


# ── AC-10/AC-11 (feature 029): the close's fees_total is persisted onto the sealed row ────────


async def test_ac10_close_seals_fees_total_alongside_gross_realized():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    await consumer.process_event(
        make_event(
            2,
            "portfolio.position.closed",
            {**CLOSE_PAYLOAD, "realized_pnl": 1.00, "fees_total": 1.20},
            source_service="xstockstrat-portfolio",
        )
    )
    # seal got fees_total for net = realized_pnl - fees_total downstream; realized stays gross.
    assert positions.seal_kwargs is not None, "seal was not called"
    assert positions.seal_kwargs["fees_total"] == 1.20
    assert positions.seal_kwargs["realized_pnl"] == 1.00


async def test_ac11_close_without_fees_seals_zero():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    await consumer.process_event(
        make_event(
            2, "portfolio.position.closed", CLOSE_PAYLOAD, source_service="xstockstrat-portfolio"
        )
    )
    # No fees_total key in the payload ⇒ seals 0.0, so downstream net == gross (no silent fee).
    assert positions.seal_kwargs is not None, "seal was not called"
    assert positions.seal_kwargs["fees_total"] == 0.0


# ── AC-6: indicator timeout → partial snapshot (empty indicators) + degraded ─


async def test_ac6_indicator_timeout_degrades():
    composer = FakeComposer(hang_indicators=True)
    cfg = FakeCfg(**{"analysis.snapshot.indicator_timeout_ms": 20})
    consumer, pool, snaps, positions, samples, ledger = make_consumer(composer=composer, cfg=cfg)
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    assert len(snaps.rows) == 1
    assert snaps.rows[0]["indicators"] == {}, "timed-out indicators → empty map (partial)"
    assert "analysis.snapshot.degraded" in ledger.appended
    assert "analysis.snapshot.captured" not in ledger.appended


async def test_ac6_teeth_control_emits_captured_not_degraded():
    # Companion: a healthy compose must emit captured, never degraded (an inert timeout can't pass).
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    assert "analysis.snapshot.captured" in ledger.appended
    assert "analysis.snapshot.degraded" not in ledger.appended


# ── AC-7: ledger receives captured + sealed audit events ────────────────────


async def test_ac7_audit_events_emitted():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    await consumer.process_event(
        make_event(
            2, "portfolio.position.closed", CLOSE_PAYLOAD, source_service="xstockstrat-portfolio"
        )
    )
    assert "analysis.snapshot.captured" in ledger.appended
    assert "analysis.pattern.sealed" in ledger.appended


# ── Idempotency + ordering ──────────────────────────────────────────────────


async def test_idempotent_redelivery_and_ordering():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    e = make_event(5, "order.filled", ORDER_PAYLOAD)
    await consumer.process_event(e)
    await consumer.process_event(e)  # redeliver same sequence
    assert len(snaps.rows) == 1, "redelivered event must not double-insert"
    assert pool.cursor == 5
    # An out-of-order lower sequence after a higher one is short-circuited before any mutation.
    await consumer.process_event(
        make_event(3, "order.filled", {**ORDER_PAYLOAD, "order_id": "old"})
    )
    assert len(snaps.rows) == 1
    assert pool.cursor == 5


async def test_self_emission_skipped():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(
        make_event(1, "analysis.snapshot.captured", {}, source_service="xstockstrat-analysis")
    )
    assert len(snaps.rows) == 0, "analysis.* events are never self-consumed"
    assert pool.cursor == 1, "cursor still advances past a skipped event"
