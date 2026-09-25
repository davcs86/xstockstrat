# Product Spec: fix-reconciliation-false-halt

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-09-25-reconciliation-false-halt-defect.md`
**Severity**: SEV-2
**Created**: 2026-09-25

---

## Problem Statement

**Observed.** A paper account placed and filled a platform order (`BUY 10 AMAT @ 427.9740`;
`order.filled` emitted, fill alert shown). Moments later the reconciliation poller raised a CRITICAL
`quantity_discrepancy (AMAT) — expected 0.0000, broker reported 10.0000` and auto-halted the account
(`HALT_SOURCE_RECONCILIATION`), blocking further `PlaceOrder`/`ReplaceOrder`. The finding's
identifier is the **symbol** `AMAT` (not an order UUID), pinning it to the position-side comparison in
`reconcileTick`.

**Expected.** A broker position that the platform's own filled orders fully explain must never trip a
reconciliation halt, even while the portfolio projection is briefly behind. The position-side check
must halt only on a broker quantity the platform's own orders cannot account for (e.g. a
dashboard-placed order). The portfolio projection must also not be transiently zeroed by a
non-authoritative (empty) broker position snapshot.

## Reproduction Steps

1. On a paper account, place and fill a platform market order (`BUY 10 AMAT`).
2. Drive the portfolio projection for that (account, symbol) to 0 while the broker holds it, via:
   - (a) `order.filled` → portfolio `ConsumeOrderFills` fold lagging past the reconcile grace window
     (`1 + trading.reconciliation.grace_ticks`, default 2 × 60 s); or
   - (b) a successful-but-empty `account.positions.synced` from `syncPositions` causing
     `processPositionSync` → `DeletePositionsNotInSync(account, user, [])` to delete the
     order-fill-derived row (stale for up to `trading.position_sync.interval_ms`, default 5 min).
3. Next reconcile tick: `GetPositions` returns AMAT=10, `ListPositions` returns 0 →
   `quantity_discrepancy` past grace → account halted.

## Root Cause Hypothesis

The position-side reconciliation trusts `ListPositions` as authoritative for "what the platform
placed", with no DB-grounding against `trading.orders` — unlike the order-side check, hardened via
`KnownBrokerOrderIDs` after an earlier production false halt (`trading/CLAUDE.md` § Broker State
Reconciliation). Compounding: `processPositionSync` deletes order-fill-derived rows on an
empty/non-authoritative broker snapshot.

## Affected Services

- `xstockstrat-trading` — `reconcileTick` position-side comparison; new `trading.orders` net-filled-qty grounding lookup.
- `xstockstrat-portfolio` — `processPositionSync` empty-snapshot delete guard.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] Two services touched (defense-in-depth, user-approved): trading + portfolio

## Acceptance Criteria

See `acceptance.feature` — regression scenarios that fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Plus: existing trading + portfolio unit tests pass; both services
build with `GOWORK=off`.

## Out of Scope

- Refactoring unrelated to the bug.
- Changing the genuine foreign-position detection (a dashboard-placed order the platform never issued
  must still halt).
- Any change to the order-side reconciliation path (already hardened).
