"""
Tests for the feature-042 P&L pattern consumer (app/engine/pnl_pattern_consumer.py).

The consumer's DB is faked in-memory (injected repos + a fake pool/cursor) so ordering, idempotency,
snapshot capture, seal, degraded-timeout, and audit-emission logic are exercised without a live
database or gRPC. LedgerEvents are real protos so payload/HasField/sequence behave like production.

asyncio_mode = auto (pyproject) — bare `async def test_*` runs.
"""

import asyncio
import logging
from unittest.mock import AsyncMock

import asyncpg
import asyncpg.exceptions as apg
import pytest
from gen.ledger.v1 import ledger_pb2
from google.protobuf.json_format import ParseError
from google.protobuf.message import DecodeError
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.engine import pnl_pattern_consumer as consumer_mod
from app.engine.pnl_pattern_consumer import CLOSE_EVENT, PnLPatternConsumer, _is_poison
from app.repositories.order_snapshots import OrderSnapshotsRepository
from app.repositories.pnl_pattern_samples import PnLPatternSamplesRepository
from app.repositories.pnl_positions import PnLPositionsRepository

# ── LedgerEvent builder ─────────────────────────────────────────────────────


def make_event(
    seq, event_type, payload, *, event_id=None, source_service="trading", correlation_id=""
):
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
        correlation_id=correlation_id,
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
        self.acquire_timeouts = []

    async def fetchval(self, sql, *args, timeout=None):
        if "ledger_stream_cursor" in sql:
            return self.cursor
        return None

    def acquire(self, timeout=None):
        self.acquire_timeouts.append(timeout)
        return FakeAcquire(self)

    def transaction(self):
        return FakeTxn()

    async def execute(self, sql, *args, timeout=None):
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

    async def count_for_position(self, position_id, *, timeout=None):
        return sum(1 for r in self.rows if r["position_id"] == position_id)

    async def list_for_position(self, position_id, *, timeout=None):
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

    async def insert_many(self, db, rows, *, timeout=None):
        self.rows.extend(rows)


class _StopConsumer(BaseException):
    """Ends run_forever: a BaseException escapes its `except Exception` reconnect handler."""


class FakeLedger:
    def __init__(self):
        self.appended = []
        self.calls = []
        self.events = []  # scripted StreamEvents backlog
        self.max_streams = 1
        self.stream_from = []

    async def AppendEvent(self, req, metadata=(), timeout=None):
        self.appended.append(req.event_type)
        self.calls.append((req, tuple(metadata), timeout))
        return None

    def StreamEvents(self, req):
        if len(self.stream_from) >= self.max_streams:
            raise _StopConsumer
        self.stream_from.append(req.from_sequence)
        return self._replay(req.from_sequence)

    async def _replay(self, from_sequence):
        # Inclusive, like the ledger: the cursor's own row is re-delivered on every reconnect.
        for event in self.events:
            if event.sequence >= from_sequence:
                yield event


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


async def test_ac7_emit_request_carries_trace_idempotency_and_timeout():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer._emit(
        "analysis.test.event",
        "AAPL",
        {"k": "v"},
        correlation_id="t-1",
        idempotency_key="k-1",
        timeout=5,
    )
    assert len(ledger.calls) == 1
    req, metadata, timeout = ledger.calls[0]
    assert req.event_type == "analysis.test.event"
    assert req.correlation_id == "t-1"
    assert req.idempotency_key == "k-1"
    assert metadata == (("x-trace-id", "t-1"),)
    assert timeout == 5


async def test_emit_without_correlation_sends_no_metadata():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer._emit("analysis.test.event", "AAPL", {"k": "v"})
    assert len(ledger.calls) == 1
    req, metadata, timeout = ledger.calls[0]
    assert req.correlation_id == ""
    assert req.idempotency_key == ""
    assert metadata == ()
    assert timeout is None


async def test_existing_emits_propagate_event_trace():
    consumer, pool, snaps, positions, samples, ledger = make_consumer()
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD, correlation_id="t-9"))
    await consumer.process_event(
        make_event(
            2,
            "portfolio.position.closed",
            CLOSE_PAYLOAD,
            source_service="xstockstrat-portfolio",
            correlation_id="t-9",
        )
    )
    by_type = {req.event_type: (req, md, to) for req, md, to in ledger.calls}
    assert {"analysis.snapshot.captured", "analysis.pattern.sealed"} <= by_type.keys()
    for event_type in ("analysis.snapshot.captured", "analysis.pattern.sealed"):
        req, metadata, timeout = by_type[event_type]
        assert req.correlation_id == "t-9"
        assert ("x-trace-id", "t-9") in metadata
        assert timeout is None


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


# ── feature 224: the snapshot composer reads as the order's owner ──────────


class _MetaRecordingComposer(FakeComposer):
    def __init__(self):
        super().__init__()
        self.metas = {}

    async def ohlcv_and_closes(self, symbol, meta=()):
        self.metas["ohlcv"] = list(meta)
        return await super().ohlcv_and_closes(symbol, meta)

    async def indicators(self, symbol, closes, strategy_id, meta=()):
        self.metas["indicators"] = list(meta)
        return await super().indicators(symbol, closes, strategy_id, meta)

    async def signals(self, symbol, meta=()):
        self.metas["signals"] = list(meta)
        return await super().signals(symbol, meta)


async def test_compose_threads_order_owner_header():
    composer = _MetaRecordingComposer()
    consumer, *_ = make_consumer(composer=composer)
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    assert composer.metas == {
        "ohlcv": [("x-user-id", "u-1")],
        "indicators": [("x-user-id", "u-1")],
        "signals": [("x-user-id", "u-1")],
    }


# ── feature 259: per-event retry, park, replay, probe and escalation ────────

PARKED = "analysis.pnl.event_parked"
CONSUMER_LOGGER = "app.engine.pnl_pattern_consumer"


def close_event(seq):
    return make_event(seq, CLOSE_EVENT, CLOSE_PAYLOAD, source_service="xstockstrat-portfolio")


@pytest.fixture
def sleeps(monkeypatch):
    rec = AsyncMock()
    monkeypatch.setattr("app.engine.pnl_pattern_consumer.asyncio.sleep", rec)
    return rec


def streaming_consumer(*, max_streams):
    """Cursor at 9; the ledger backlog is close events 9 (already processed), 10 and 11."""
    consumer, pool, _snaps, _positions, _samples, ledger = make_consumer()
    pool.cursor = 9
    ledger.events = [close_event(9), close_event(10), close_event(11)]
    ledger.max_streams = max_streams
    return consumer, pool, ledger


def fail_seq_10(consumer, error_for_attempt):
    """Wrap the close handler: error_for_attempt(n) is raised on attempt n of sequence 10."""
    original = consumer._handle_close_event
    handled = []

    async def wrapper(event, payload):
        handled.append(event.sequence)
        if event.sequence == 10:
            err = error_for_attempt(handled.count(10))
            if err is not None:
                raise err
        await original(event, payload)

    consumer._handle_close_event = wrapper
    return handled


def parked_calls(ledger):
    return [(req, timeout) for req, _md, timeout in ledger.calls if req.event_type == PARKED]


def records(caplog, fragment):
    return [r for r in caplog.records if fragment in r.getMessage()]


async def run_until_stopped(consumer):
    with pytest.raises(_StopConsumer):
        await consumer.run_forever()


async def test_ac6_failed_event_is_retried_in_place_before_the_next(sleeps):
    consumer, pool, ledger = streaming_consumer(max_streams=1)
    handled = fail_seq_10(
        consumer, lambda n: asyncpg.PostgresConnectionError("reset") if n == 1 else None
    )
    await run_until_stopped(consumer)
    assert handled == [10, 10, 11], "10 must succeed on retry before 11 is processed"
    assert pool.cursor == 11
    assert ledger.stream_from == [9], "retried in place — no reconnect"
    assert parked_calls(ledger) == []


@pytest.mark.parametrize(
    "error, reason, attempts, streams",
    [
        (ValueError("bad payload"), "non-transient", 3, 1),
        (asyncpg.DataError("bad value"), "non-transient", 3, 1),
        (asyncpg.IntegrityConstraintViolationError("dup"), "non-transient", 3, 1),
        (apg.OutOfMemoryError("oom"), "transient-persistent", 15, 5),
    ],
)
async def test_ac7_exhausted_event_is_parked_and_the_stream_moves_on(
    sleeps, caplog, error, reason, attempts, streams
):
    caplog.set_level(logging.WARNING, logger=CONSUMER_LOGGER)
    consumer, pool, ledger = streaming_consumer(max_streams=streams)
    handled = fail_seq_10(consumer, lambda n: error)
    order = []
    original_append = ledger.AppendEvent
    original_advance = consumer._advance_cursor

    async def append(req, metadata=(), timeout=None):
        if req.event_type == PARKED:
            order.append(("emit", len(records(caplog, "parking event seq=10"))))
        return await original_append(req, metadata=metadata, timeout=timeout)

    async def advance(sequence):
        if sequence == 10:
            order.append(("advance", len(parked_calls(ledger))))
        await original_advance(sequence)

    ledger.AppendEvent = append
    consumer._advance_cursor = advance

    await run_until_stopped(consumer)

    assert handled.count(10) == attempts
    assert len(ledger.stream_from) == streams
    park_logs = records(caplog, "parking event seq=10")
    assert len(park_logs) == 1
    assert park_logs[0].levelno == logging.ERROR
    assert f"reason={reason}" in park_logs[0].getMessage()
    parked = parked_calls(ledger)
    assert len(parked) == 1
    req, timeout = parked[0]
    assert req.idempotency_key == "pnl_park:10"
    assert timeout == 5
    assert req.payload.fields["reason"].string_value == reason
    assert order == [("emit", 1), ("advance", 1)], "park order: log → emit → advance"
    assert handled[-1] == 11, "the event after the parked one is processed"
    assert pool.cursor == 11
    assert (consumer._replay_seq, consumer._replay_count) == (None, 0)


@pytest.mark.parametrize(
    "error, probe_error",
    [
        (apg.OutOfMemoryError("oom"), asyncpg.PostgresConnectionError("db down")),
        (apg.DeadlockDetectedError("deadlock"), TimeoutError()),
    ],
)
async def test_ac9_db_down_at_the_fifth_replay_never_parks(sleeps, caplog, error, probe_error):
    caplog.set_level(logging.WARNING, logger=CONSUMER_LOGGER)
    consumer, pool, ledger = streaming_consumer(max_streams=5)
    fail_seq_10(consumer, lambda n: error)
    consumer._probe_db = AsyncMock(side_effect=probe_error)

    await run_until_stopped(consumer)

    assert parked_calls(ledger) == []
    assert pool.cursor == 9
    assert consumer._probe_db.await_count == 1
    replays = records(caplog, "seq=10 type=portfolio.position.closed correlation_id=")
    assert [r.levelno for r in replays] == [logging.WARNING] * 4 + [logging.ERROR]
    assert records(caplog, "DB health probe failed at seq=10")
    # Event 9 is re-delivered on every reconnect and must not reset the replay pair.
    assert (consumer._replay_seq, consumer._replay_count) == (10, 5)


async def test_probe_db_is_bounded(monkeypatch):
    consumer, *_ = make_consumer()
    monkeypatch.setattr(consumer_mod, "_PROBE_TIMEOUT_SECONDS", 0.01)

    async def hang():
        await asyncio.Event().wait()

    consumer._cursor = hang
    with pytest.raises(TimeoutError):
        await consumer._probe_db()


async def test_ac10_consecutive_stream_failures_escalate_to_error(sleeps, caplog):
    caplog.set_level(logging.WARNING, logger=CONSUMER_LOGGER)
    consumer, *_ = make_consumer()
    consumer._cursor = AsyncMock(side_effect=asyncpg.PostgresConnectionError("db down"))
    sleeps.side_effect = [None, None, None, None, _StopConsumer()]

    await run_until_stopped(consumer)

    outer = records(caplog, "stream error (consecutive=")
    assert [r.levelno for r in outer] == [logging.WARNING] * 4 + [logging.ERROR]


async def test_success_at_or_past_the_replayed_sequence_resets_the_pair(sleeps):
    consumer, pool, ledger = streaming_consumer(max_streams=1)
    ledger.events = ledger.events[:2]  # 9 (re-delivered) and 10
    consumer._replay_seq, consumer._replay_count = 10, 3
    await run_until_stopped(consumer)
    assert pool.cursor == 10
    assert (consumer._replay_seq, consumer._replay_count) == (None, 0)


@pytest.mark.parametrize(
    "error, streams, seeded_pair, pair_after_failed_park",
    [
        (ValueError("bad payload"), 1, (10, 2), (10, 2)),
        (apg.OutOfMemoryError("oom"), 5, (None, 0), (10, 5)),
    ],
)
async def test_park_cursor_failure_keeps_the_pair_and_repark_reuses_the_key(
    sleeps, error, streams, seeded_pair, pair_after_failed_park
):
    consumer, pool, ledger = streaming_consumer(max_streams=streams)
    fail_seq_10(consumer, lambda n: error)
    consumer._replay_seq, consumer._replay_count = seeded_pair
    original_advance = consumer._advance_cursor
    advance_calls = []

    async def advance(sequence):
        advance_calls.append(sequence)
        if len(advance_calls) == 1:
            raise RuntimeError("cursor write failed")
        await original_advance(sequence)

    consumer._advance_cursor = advance

    await run_until_stopped(consumer)
    assert (consumer._replay_seq, consumer._replay_count) == pair_after_failed_park
    assert pool.cursor == 9

    ledger.max_streams += 1
    await run_until_stopped(consumer)
    keys = [req.idempotency_key for req, _timeout in parked_calls(ledger)]
    assert keys == ["pnl_park:10", "pnl_park:10"]
    assert pool.cursor == 11
    assert (consumer._replay_seq, consumer._replay_count) == (None, 0)


@pytest.mark.parametrize(
    "error, poison",
    [
        (ValueError("x"), True),
        (TypeError("x"), True),
        (KeyError("x"), True),
        (DecodeError("x"), True),
        (ParseError("x"), True),
        (asyncpg.DataError("x"), True),
        (asyncpg.IntegrityConstraintViolationError("x"), True),
        (apg.OutOfMemoryError("x"), False),
        (apg.DeadlockDetectedError("x"), False),
        (apg.SerializationError("x"), False),
        (TimeoutError(), False),
        (RuntimeError("x"), False),
    ],
)
def test_is_poison_truth_table(error, poison):
    assert _is_poison(error) is poison


class _TimingOutAcquire:
    def __init__(self, timeout):
        self._timeout = timeout

    async def __aenter__(self):
        await asyncio.wait_for(asyncio.Event().wait(), self._timeout)

    async def __aexit__(self, *a):
        return False


class _ExhaustedPool(FakePool):
    def acquire(self, timeout=None):
        self.acquire_timeouts.append(timeout)
        return _TimingOutAcquire(timeout)


async def test_attempt_db_wait_is_bounded_and_reaches_the_replay_path(sleeps, caplog, monkeypatch):
    caplog.set_level(logging.WARNING, logger=CONSUMER_LOGGER)
    monkeypatch.setattr(consumer_mod, "_ATTEMPT_DB_TIMEOUT_SECONDS", 0.05)
    pool = _ExhaustedPool()
    pool.cursor = 9
    consumer = PnLPatternConsumer(
        db_pool=pool,
        ledger_stub=FakeLedger(),
        config_watcher=FakeCfg(),
        composer=FakeComposer(),
        snapshots=FakeSnapshots(),
        positions=FakePositions(),
        samples=FakeSamples(),
    )
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(consumer._process_with_retry(close_event(10)), 2)
    assert pool.acquire_timeouts == [consumer_mod._ATTEMPT_DB_TIMEOUT_SECONDS] * 3
    assert (consumer._replay_seq, consumer._replay_count) == (10, 1)
    exhausted = records(caplog, "exhausted retries")
    assert [r.levelno for r in exhausted] == [logging.WARNING]


class _KwargRecordingDb:
    def __init__(self):
        self.kwargs = []

    async def execute(self, sql, *args, **kw):
        self.kwargs.append(kw)

    async def fetchval(self, sql, *args, **kw):
        self.kwargs.append(kw)
        return 0

    async def fetch(self, sql, *args, **kw):
        self.kwargs.append(kw)
        return []

    async def fetchrow(self, sql, *args, **kw):
        self.kwargs.append(kw)
        return None


_IDENTITY_KW = dict(user_id="u", account_id="a", symbol="AAPL", trading_mode="m")
_SNAPSHOT_KW = dict(
    event_id="e",
    order_id="o",
    position_id="p",
    symbol="AAPL",
    event_type="filled",
    event_ts=None,
    strategy_id=None,
    side="buy",
    quantity=1.0,
    price=1.0,
    ohlcv_bar=None,
    indicators={},
    signals=[],
)
_SAMPLE_ROW = {
    "symbol": "AAPL",
    "factor_name": "RSI",
    "factor_type": "indicator",
    "realized_pnl": 1.0,
    "closed_at": None,
    "close_event_id": "c",
    "position_id": "p",
}
_REPO_CALLS = {
    "snapshots.insert": lambda db, kw: OrderSnapshotsRepository(db).insert(
        db, **_SNAPSHOT_KW, **kw
    ),
    "snapshots.count_for_position": lambda db, kw: OrderSnapshotsRepository(db).count_for_position(
        "p", **kw
    ),
    "snapshots.list_for_position": lambda db, kw: OrderSnapshotsRepository(db).list_for_position(
        "p", **kw
    ),
    "positions.open": lambda db, kw: PnLPositionsRepository(db).open(
        db,
        position_id="p",
        strategy_id=None,
        opened_at=None,
        open_event_id="e",
        **_IDENTITY_KW,
        **kw,
    ),
    "positions.seal": lambda db, kw: PnLPositionsRepository(db).seal(
        db, closed_at=None, realized_pnl=1.0, close_event_id="c", **_IDENTITY_KW, **kw
    ),
    "samples.insert_many": lambda db, kw: PnLPatternSamplesRepository(db).insert_many(
        db, [_SAMPLE_ROW], **kw
    ),
}


@pytest.mark.parametrize("name", sorted(_REPO_CALLS))
@pytest.mark.parametrize("kw, expected", [({"timeout": 0.5}, 0.5), ({}, None)])
async def test_repository_forwards_timeout_to_asyncpg(name, kw, expected):
    db = _KwargRecordingDb()
    await _REPO_CALLS[name](db, kw)
    assert db.kwargs == [{"timeout": expected}]
