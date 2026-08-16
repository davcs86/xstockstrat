# Product Spec: fix-listorders-ambiguous-updated-at

**Type**: bug
**GitHub Issue**: n/a — see `docs/reports/2026-08-16-trading-listorders-ambiguous-updated-at-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-16

---

## Problem Statement

Every `TradingRepo.ListOrders` call against Postgres fails with `ERROR: column reference
"updated_at" is ambiguous (SQLSTATE 42702)` and silently falls back to an in-memory order store,
observed repeatedly (many times/minute) in `xstockstrat-trading`'s staging RUN logs. Order-history
reads are not reliably served from the DB — the in-memory fallback only reflects orders seen since
the process booted and would diverge across a multi-replica deploy.

Expected: `ListOrders` (and its siblings `GetOrder`/`ListSubmittedOrders`, which share the same
LATERAL join) read successfully from Postgres; the in-memory fallback never engages under normal
operation.

## Reproduction Steps

1. Call `TradingService.ListOrders` (or load any UI page/poller that lists orders) against staging.
2. Observe the WARN in `xstockstrat-trading`'s RUN logs on (almost) every call.

## Root Cause Hypothesis

`services/xstockstrat-trading/internal/repository/trading_repo.go:85-90` defines
`intentLateralJoinSQL`, a `LEFT JOIN LATERAL (SELECT state, updated_at FROM
trading.order_intents ...) li ON true`. `GetOrder` (`:97`), `ListOrders` (`:125`), and
`ListSubmittedOrders` (`:211`) all `SELECT ..., updated_at, ...` from the joined result without
qualifying which table's `updated_at` they mean — ambiguous between `trading.orders.updated_at`
and the lateral subquery's `updated_at`. Introduced by feature 101
(`exactly-once-order-intent`, PR #880, 2026-08-06); confidence: high.

Fix: qualify the column as `trading.orders.updated_at` in all three SELECT lists.

## Affected Services

- `xstockstrat-trading` (Go) — `internal/repository/trading_repo.go`

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

- [ ] `ListOrders`/`GetOrder`/`ListSubmittedOrders` no longer log "db list orders failed, falling
      back to in-memory" / equivalent ambiguous-column errors
- [ ] A regression test exercises the LATERAL join with a populated `order_intents` row (so an
      unqualified reference would fail the test if reintroduced)
- [ ] Existing `xstockstrat-trading` Go tests pass
- [ ] Smoke-tested against a live DB (not just fakes) if a live-DB harness is available; otherwise
      confirmed via `go vet`/query-shape review, per this service's existing test conventions

## Out of Scope

- The `broker credentials marked invalid` warning also seen in the same logs (separate, expected
  operator-action item, not a code defect)
- Any change to `order_intents`' own schema or the cross-intent precedence design itself
