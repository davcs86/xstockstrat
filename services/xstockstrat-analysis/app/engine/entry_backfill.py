"""Boot-time-only Order-based entry-time backfill (feature 116).

Closes the >365-day-position gap bar-replay cannot reach (live_loop.py's own replay only
sees the fetched 365-day bar window). Runs ONCE at boot, concurrently with (not blocking)
the other boot-time tasks. Reads xstockstrat-trading's ListOrders for the entry-time
inference, and — feature 132 — resolves each strategy's firing universe via the live loop's
own owner-scoped drains (portfolio watchlist/held + platform signals) through
``resolve_universe``, so an allowlist-free live strategy is backfilled over the same union the
live loop evaluates. It never places orders / touches the trading write surface. Imported ONLY
by main.py, never by live_loop.py (no import cycle).
"""

import asyncio
import logging
from datetime import UTC

from gen.trading.v1 import trading_pb2

from app.engine.live_loop import resolve_universe
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

    async def _backfill_pair(user_id, strategy_id, symbol):
        # feature 133: key parity with live_loop's 3-tuple (user_id, strategy_id, symbol) state so
        # the backfill seeds the SAME slot the live loop reads (a mismatched key would silently
        # never be seen by the loop). ListOrders stays owner-implicit via the order's own user_id.
        key = (user_id, strategy_id, symbol)
        if live_loop._last_entry_at.get(key) is not None:
            return
        async with sem:
            try:
                resp = await trading_stub.ListOrders(
                    trading_pb2.ListOrdersRequest(strategy_id=strategy_id, symbol=symbol)
                )
            except Exception as e:
                log.warning("entry_backfill: (%s,%s) ListOrders failed: %s", strategy_id, symbol, e)
                return
        entry_time = _infer_open_entry_time(list(resp.orders))
        if entry_time is None:
            return
        live_loop._last_state[key] = True
        live_loop._last_entry_at[key] = entry_time
        await live_loop._write_entry_cooldown(key, entry_time)

    # feature 132: the firing universe is resolve_universe(...).union (owner watchlist ∪ held ∪
    # signals-iff-eligible, or an explicit allowlist). Use `.union`, NOT `.universe` — a held-denied
    # position still needs its entry anchor (deny is entry-only, never applied on this hydration
    # path). Reuse the live loop's own owner-scoped, best-effort drains (memoized per owner; signals
    # once) so an allowlist-bearing strategy is backfilled even during a cold-boot portfolio outage
    # (its union ignores the empty drains), while an allowlist-free one degrades gracefully — its
    # union is empty, so those held pairs are missed this boot (accepted residual; self-heals next
    # boot, logged once per key by the live loop).
    signal_symbols = await live_loop._drain_signals()
    held_cache: dict[str, set] = {}
    watch_cache: dict[str, set] = {}
    tasks = []
    for row in rows:
        definition = _row_to_strategy_definition(dict(row))
        owner = definition.user_id
        if owner not in held_cache:
            held_cache[owner] = await live_loop._drain_held(owner)
            watch_cache[owner] = await live_loop._drain_watchlist(owner)
        resolved = resolve_universe(
            definition, watch_cache[owner], held_cache[owner], signal_symbols
        )
        for symbol in resolved.union:
            tasks.append(_backfill_pair(owner, definition.strategy_id, symbol))
    await asyncio.gather(*tasks, return_exceptions=True)
    log.info("entry_backfill: boot pass complete (%d pairs considered)", len(tasks))
