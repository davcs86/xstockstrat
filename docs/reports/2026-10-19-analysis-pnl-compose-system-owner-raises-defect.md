# Defect: P&L snapshot compose can raise ValueError for a system-owned order event

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: silent-attribution-loss
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution-findings.md — Latent bugs row "Possible `ValueError` escape from `PnLPatternConsumer._compose`" + Open question "Can a ledger `order.*` event carry `user_id == "system"`"

## Observed
`_compose` is documented as never raising (FR-6), but it calls `owner_metadata(owner)` outside any
try. `owner_metadata` raises ValueError for the `system` owner. On such an event the exception
reaches the stream loop's per-event catch, which logs and skips the event. No snapshot is written,
the `pnl_positions` window is never opened, and the cursor is not advanced by that event. The next
event's `GREATEST` cursor advance then moves past it, so the event is permanently dropped (it is
retried only if it was the last event before a stream reconnect).

Unreachable today: xstockstrat-trading is the only producer of `order.*` events, and their payload
`user_id` is the broker-account owner (`trading.go:627`, `:820`), set from the caller's `x-user-id`
at `RegisterBrokerAccount`. Identity user ids are `UUID DEFAULT gen_random_uuid()`
(`identity/migrations/001_identity_tables.up.sql:7`), and no path sends `x-user-id: system` to
trading. Trading has no explicit `system` guard, so the defect becomes live if such a path is added.

## Expected
A `system` owner degrades to a partial snapshot, the same way the empty-owner branch skips
indicators and signals.

## Reproduction
1. Feed `process_event` an `order.filled` event whose payload has `user_id: "system"`.
2. Observe the log line `pnl consumer: event … error: owner-scoped call needs a real owner`.
3. No `order_snapshots` / `pnl_positions` row exists for that order.

## Evidence
`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:367`
> meta = owner_metadata(owner) if owner else ()

`services/xstockstrat-analysis/app/identity.py:8-9`
> if not owner or owner == SYSTEM_IDENTITY:
>     raise ValueError(f"owner-scoped call needs a real owner, got {owner!r}")

`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:158`
> except Exception as e:  # noqa: BLE001 — one bad event never kills the loop

## Root cause hypothesis
The feature 225 fail-closed identity helper was inserted ahead of the FR-6 degrade blocks
(commit 7276674 introduced `meta = owner_metadata(owner) if owner else ()`).

## Confidence
high (mechanism reproduced; currently unreachable). A scratch pytest against the real consumer
passed 3/3: `_compose(..., "system")` raises the ValueError; `process_event` writes no snapshot,
no window and no cursor; and in `run_forever`, a `system` event at seq 5 followed by a normal
event at seq 6 ends with cursor 6 and only `evt-6` captured.
