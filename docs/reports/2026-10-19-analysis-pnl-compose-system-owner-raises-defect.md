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
the `pnl_positions` window is never opened, and the cursor is not advanced for that event. No current
producer of a `system`-owned `order.*` event was found in xstockstrat-trading.

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
The feature 225 fail-closed identity helper was inserted ahead of the FR-6 degrade blocks.

## Confidence
low
