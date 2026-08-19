# Defect: ListOrders fails on every call, silently falls back to in-memory (ambiguous updated_at)

**Recorded**: 2026-08-16
**Severity**: SEV-2
**Impact type**: silent-db-fallback-masks-persistence-failure
**Environment**: staging (xstockstrat-staging)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

Every `TradingRepo.ListOrders` call against Postgres fails and falls back to an in-memory
store, logged repeatedly (many times/minute, bursts of 10+/sec) as:
`db list orders failed, falling back to in-memory — ERROR: column reference "updated_at" is
ambiguous (SQLSTATE 42702)`.

## Expected

`ListOrders` reads order history from the DB successfully; the in-memory fallback should never
engage under normal operation.

## Reproduction

1. Call `TradingService.ListOrders` (or hit any UI page/poller that lists orders) against staging.
2. Observe the WARN in xstockstrat-trading's RUN logs on (almost) every call.

## Evidence

`services/xstockstrat-trading/internal/repository/trading_repo.go:85-90` — `intentLateralJoinSQL`
LEFT JOINs `trading.order_intents` (aliased `li`, itself exposing an unqualified `updated_at`
column via `SELECT state, updated_at FROM trading.order_intents`) against `trading.orders`, and
`ListOrders`'s outer `SELECT` (`trading_repo.go:125`) references `updated_at` without a table
qualifier — ambiguous between `trading.orders.updated_at` and the lateral subquery's `updated_at`.

## Root cause hypothesis

`intentLateralJoinSQL` was introduced by feature 101 (`exactly-once-order-intent`, PR #880,
2026-08-06) for cross-intent precedence. Every query built on top of it that does `SELECT
..., updated_at, ...` without qualifying the column became ambiguous the moment the lateral join
was added. Fix: qualify as `trading.orders.updated_at` in `GetOrder`/`ListOrders`/
`ListSubmittedOrders`'s SELECT lists.

## Confidence

high
