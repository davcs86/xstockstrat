# P&L pattern consumer (feature 042)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). The ledger-driven order-snapshot / realized-P&L attribution consumer (`app/engine/pnl_pattern_consumer.py`).

A third background task (`app/engine/pnl_pattern_consumer.py`, `PnLPatternConsumer.run_forever`,
registered in `app/main.py`) drives order-snapshot capture and realized-P&L attribution off the
ledger. It opens **one broad** `StreamEvents(from_sequence=cursor)` with **both filters null** so the
ledger's **global** sequence order is preserved across stream keys (matching the fixed
`LedgerEvent.sequence` contract). Per event, strictly in order: (1) short-circuit any
`sequence <= cursor` before any mutation (kills replay phantom-opens); (2) never self-consume
`analysis.*` emissions; (3) on `order.*` events (`order.created`/`filled`/`partially_filled`/
`canceled` — note trading's American one-`l` `order.canceled`) compose the snapshot **before** the DB
txn — best-effort gRPC reads to marketdata/indicators/ingest bounded by
`analysis.snapshot.indicator_timeout_ms` / `signal_timeout_ms`; a timeout degrades to a **partial**
snapshot (empty map/list), never an abort (FR-6); (4) in ONE txn, insert the snapshot, open/seal the
`pnl_positions` window, and advance `ledger_stream_cursor` (atomic — a crash never advances past
unwritten data); on `portfolio.position.closed`, seal the matching open window from the enriched
payload's `realized_pnl` (gross) and `fees_total` (absent ⇒ `0.0`, migration 021) and write one
`pnl_pattern_samples` row per factor; (5) after commit, emit
best-effort `analysis.snapshot.captured` / `.degraded` / `analysis.pattern.sealed` audit events.
`QueryPnLPatterns` reads `pnl_pattern_samples` and buckets **at query time** (indicator quantile
buckets + signal-by-presence, `min_sample_count` drop, ranked positive/negative). Reuses the shared
pool + existing gRPC stubs (**no new pool, no new edge, no new env var** — F-06).
`GetAttribution` (feature 029) aggregates the sealed `pnl_positions` per signal source, owner-scoped via
`x-user-id`: **net = `realized_pnl − fees_total`**, computed only there (the stored `realized_pnl` stays
gross), and a win is `net > 0`.

- **Migration-016 tables**: `order_snapshots` (Timescale hypertable on `event_ts`, dedup on
  `(event_id, event_ts)`), `pnl_positions` (synthesized open→close window, one open per identity key),
  `pnl_pattern_samples` (raw factor store — **no factor UNIQUE**, buckets computed at query time),
  `ledger_stream_cursor` (per-consumer committed global sequence).
- **Snapshot retention is v1-absent and MUST be position-lifecycle-keyed** when added — drop snapshots
  only **after** their position seals, never a time-based Timescale retention policy (a time policy
  would evict an entry snapshot before its position closes and silently corrupt attribution).
- **Named v1 limitations**: the snapshot indicator set is the default `RSI`/`ATR` (strategy-component
  resolution is the v2 refinement); `position_id` is synthesized from the identity key (`Order` has no
  `position_id`), so multiple open→close cycles for one identity share a `position_id` — the v2
  reconciliation (rebuild an incomplete window from the ledger via `QueryEvents`) is the tracked
  follow-up in the feature's `context.md`.
- **Per-event retry and park (feature 259).** A failed event is never skipped: `_process_with_retry`
  retries it in place (`_EVENT_MAX_ATTEMPTS` = 3, `_EVENT_RETRY_BACKOFF_SECONDS` = 1.0). On exhaustion
  an error in the positive `_is_poison` allow-list (`ValueError`, `TypeError`, `KeyError`, protobuf
  `DecodeError`/`ParseError`, asyncpg `DataError`/`IntegrityConstraintViolationError`) parks at once
  (`reason=non-transient`). It is deliberately **not** `is_transient_db_error`: anything unlisted (OOM,
  class 40, disk-full, timeouts, gRPC) is replayed, because misclassifying a transient error as poison
  loses P&L data permanently. A non-poison exhaustion re-raises to the outer handler, which reconnects
  from the unadvanced cursor (replay); `_replay_seq`/`_replay_count` count consecutive replays of one
  sequence (WARNING, ERROR from the 5th) and reset only when an event with `sequence >= _replay_seq` is
  processed (the re-delivered cursor row never resets it) or on park. At `_REPLAY_ESCALATE_AFTER` = 5
  replays a bounded DB probe (`_probe_db`, `_PROBE_TIMEOUT_SECONDS` = 5) runs: probe down → ERROR,
  no park, keep replaying; probe up → park (`reason=transient-persistent`, attempts = replays × 3).
  Consecutive stream failures escalate WARNING → ERROR at the 5th. Park order is **log → idempotent
  emit → advance**: ERROR log with the identity read straight from the payload `Struct`, then
  `analysis.pnl.event_parked` (idempotency key `pnl_park:<seq>`, `_PARK_EMIT_TIMEOUT_SECONDS` = 5),
  then the cursor advance. Every DB wait in an attempt is bounded by `_ATTEMPT_DB_TIMEOUT_SECONDS` =
  10 (`pool.acquire(timeout=…)` + asyncpg per-query `timeout=`), so a pool-exhaustion hang becomes a
  non-poison `TimeoutError` instead of a silent stall. All six are fixed invariants, not config keys.
- **Accepted limitations (feature 259)**: under DB contention the single probe confirmation can park
  a still-transient event (~25-30 s of replays); an unlisted deterministic error parks after
  ~25-30 s, not ~2 s (keep the allow-list narrow); a parked `order.created`/`filled` opens no window,
  so its later close no-ops, and a parked `position.closed` leaves its window open (reconcile from the
  park payload); the replay and stream-fail counters are in-memory (`instance_count: 1`), so a restart
  delays escalation by up to 5 replays. The existing snapshot/sealed emits carry the source event's
  `correlation_id` as the request field and `x-trace-id` (empty when the source event has none —
  never minted).
