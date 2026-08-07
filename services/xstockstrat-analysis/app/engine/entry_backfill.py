"""Boot-time-only Order-based entry-time backfill (feature 116).

Closes the >365-day-position gap bar-replay cannot reach (live_loop.py's own replay only
sees the fetched 365-day bar window). Runs ONCE at boot, concurrently with (not blocking)
the other boot-time tasks. Reads xstockstrat-trading's ListOrders — the ONLY RPC this
module calls — never portfolio (Position carries no strategy_id) and never anything else.
This module is imported ONLY by main.py, never by live_loop.py (preserving the literal
truth of live_loop.py's own FR-6 docstring: "this module never imports or calls any
trading/portfolio RPC").
"""

import asyncio
import logging
from datetime import UTC

from gen.trading.v1 import trading_pb2

from app.engine.live_loop import strategy_symbols
from app.handlers.servicer import _row_to_strategy_definition

log = logging.getLogger(__name__)


def _infer_open_entry_time(orders):
    """Pure: walk a running signed balance (BUY +filled_qty, SELL -filled_qty, skipping
    filled_qty == 0) over `orders` sorted by updated_at. Records a candidate entry time on
    every 0 → nonzero crossing, clears it on every nonzero → 0 crossing. Returns the last
    recorded crossing time iff the pair is currently non-flat, else None. Single-boolean-
    per-pair semantics — matches live_loop._last_state's own model, not a FIFO/multi-lot
    ledger."""
    ordered = sorted(orders, key=lambda o: o.updated_at.ToDatetime(tzinfo=UTC))
    balance = 0.0
    candidate = None
    for o in ordered:
        if o.filled_qty == 0:
            continue
        signed = o.filled_qty if o.side == trading_pb2.ORDER_SIDE_BUY else -o.filled_qty
        was_flat = balance == 0.0
        balance += signed
        if was_flat and balance != 0.0:
            candidate = o.updated_at.ToDatetime(tzinfo=UTC)
        elif not was_flat and balance == 0.0:
            candidate = None
    return candidate if balance != 0.0 else None


async def run_once(live_loop, db_pool, trading_stub, cfg_watcher):
    """One-shot boot pass: for every live (strategy, symbol) pair still missing a durable
    last_entry_at, infer it from real Order history and seed live_loop's in-memory state
    (+ best-effort durable write). Never raises — a per-pair failure is logged and skipped,
    matching the FR-8 per-pair isolation the live loop itself already guarantees."""
    if trading_stub is None:
        return
    sem = asyncio.Semaphore(
        max(1, cfg_watcher.get_int("analysis.strategy.max_concurrent_entry_backfill", 4))
    )
    rows = await db_pool.fetch(
        "SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"
    )

    async def _backfill_pair(strategy_id, symbol):
        key = (strategy_id, symbol)
        if live_loop._last_entry_at.get(key) is not None:
            return
        async with sem:
            try:
                resp = await trading_stub.ListOrders(
                    trading_pb2.ListOrdersRequest(strategy_id=strategy_id, symbol=symbol)
                )
            except Exception as e:
                log.warning("entry_backfill: (%s,%s) ListOrders failed: %s", *key, e)
                return
        entry_time = _infer_open_entry_time(list(resp.orders))
        if entry_time is None:
            return
        live_loop._last_state[key] = True
        live_loop._last_entry_at[key] = entry_time
        await live_loop._write_entry_cooldown(key, entry_time)

    tasks = []
    for row in rows:
        definition = _row_to_strategy_definition(dict(row))
        for symbol in strategy_symbols(definition):
            tasks.append(_backfill_pair(definition.strategy_id, symbol))
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info("entry_backfill: boot pass complete (%d pairs considered)", len(tasks))
