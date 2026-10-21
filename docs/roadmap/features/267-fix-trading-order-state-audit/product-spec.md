# Product Spec: fix-trading-order-state-audit

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-trading-order-state-audit-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-04.** `services/xstockstrat-trading/internal/service/trading.go:688` (broker timeout, uncertain
  outcome), `:703` (broker reject), `:1367` (`CancelOrder` final write) and `:1550` (`ReplaceOrder`
  final write) call `_ = s.repo.UpsertOrder(...)`. A failed write is silent; `trading.orders` keeps the
  prior state while the in-memory order and ledger event move on. Reconciliation reads
  `trading.orders`, so the loss can produce false mismatches and halts.
- **D-62.** `trading.go:603` (`PlaceOrder`), `:1301` (`CancelOrder`) and `:1498` (`ReplaceOrder`) call
  `_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(...)` on a stale PENDING intent. A reclaim error is
  never logged and a successful reclaim emits no `order_intent.reclaimed_unknown` event, whereas the
  sweeper (`order_intent.go:144-157`) logs the error and emits the event.

**Expected.** Every failed `UpsertOrder` on these four paths is logged at error level with order id,
user and target status. A reactive reclaim logs a failure and, on success, emits
`order_intent.reclaimed_unknown` with a trigger value that names the reactive path, matching the sweeper.

## Functional Requirements

- **FR-1.** When `UpsertOrder` fails on the `PlaceOrder` broker-timeout (uncertain-outcome) path
  (`trading.go:688`), trading logs it at error level with order id, user id and the status written
  (`ORDER_STATUS_NEW`, the pre-call status). → `@AC-1`
- **FR-2.** When `UpsertOrder` fails on the `PlaceOrder` definite-reject path (`trading.go:703`),
  trading logs it at error level with order id, user id and status `ORDER_STATUS_REJECTED`. → `@AC-2`
- **FR-3.** When the `CancelOrder` final `UpsertOrder` (`trading.go:1367`) fails, trading logs it at
  error level with order id, user id and status `ORDER_STATUS_CANCELED`. → `@AC-3`
- **FR-4.** When the `ReplaceOrder` final `UpsertOrder` (`trading.go:1550`) fails, trading logs it at
  error level with order id, user id and the status written. → `@AC-6`
- **FR-5.** A successful reactive reclaim of a stale PENDING intent (`trading.go:603`, `:1301`,
  `:1498`) emits `order_intent.reclaimed_unknown` with the sweeper's payload fields (`order_id`,
  `intent_id`, `was_pending_since`) and `trigger` set to `reactive_place`, `reactive_cancel` or
  `reactive_replace` respectively (the sweeper keeps `sweep`). The RPC still returns
  `FailedPrecondition` "still pending". → `@AC-4`
- **FR-6.** A failed reactive `ReclaimOrphanIntent` at those three sites is logged with the intent id
  and error. → `@AC-5`, `@AC-7`

## Reproduction Steps

1. D-04: `TradingService` with a repo fake whose `UpsertOrder` errors and a broker fake that returns
   `context.DeadlineExceeded` (or a reject). Call `PlaceOrder`; no error is logged. Repeat with
   `CancelOrder` / `ReplaceOrder`.
2. D-62: seed a PENDING intent older than the stale threshold; call `PlaceOrder` with its
   `client_order_id`. The intent is reclaimed but the ledger fake records no
   `order_intent.reclaimed_unknown`. The sweeper over the same row does emit it.

## Root Cause Hypothesis

Error and terminal-path writes were treated as best-effort and their results discarded. The intent-lookup
`switch` is copied four times (`trading.go:586`, `:789`, `:1285`, `:1482`), which spread the discarded
reclaim to three sites.

## Affected Services

- xstockstrat-trading (fix site)
- xstockstrat-ledger (receives a reused event type from a new emit site; no change expected)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

**Trading-domain scope.**

- **Brokers (C-2).** The fix sits in the provider-agnostic `TradingService` layer, so ALPACA and IBKR
  are both covered; no broker client changes.
- **Paper vs live (C-3).** Behavior is identical in paper (staging) and live (production): only logging
  and one audit event are added on failure paths. Testing on dev is paper-safe.
- **Order types (C-4).** No order-type-specific logic changes; MARKET, LIMIT, STOP, STOP_LIMIT and
  TRAILING_STOP follow the same write and reclaim paths and are unaffected beyond the added logging.
- **Fills (C-5).** PARTIALLY_FILLED and FILLED handling (fill sync, `ConfirmOrder`) is unchanged. A
  cancel or replace of a partially filled order reaches the same final `UpsertOrder` and gains the
  same FR-3/FR-4 logging, nothing else.

## Consumer Surface(s)

None — internal/platform-only. No UI, agent tool, proto or config surface changes. Operators and the
reconciliation path gain visibility: new error-level logs, and `order_intent.reclaimed_unknown`
events in the ledger with the new `reactive_*` trigger values beside the existing `sweep`.

## Open Questions

- [ ] Log-only versus surfacing the `UpsertOrder` failure to the caller (the broker side effect has
  already happened on these paths). Carried to `/sdd-design` (C-11); the FRs above are the log-only
  floor.
- [ ] Extract the four-way intent-lookup switch in the same change (DRY guard rail) or keep the fix to
  the three reclaim call sites. Carried to `/sdd-design` (C-11).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- `ConfirmOrder` offline recompute/emit failure (debt-radar D-63) and `CancelOrder` fail-open semantics (debt-radar NC-C)
