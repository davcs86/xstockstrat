# Defect: Trading per-account CRITICAL alerts are untargeted, so the account owner gets no Web Push for their own halt or reconciliation mismatch

**Recorded**: 2026-10-29
**Severity**: SEV-2
**Impact type**: owner-notification-missing
**Environment**: dev (main-dev) + `feature/fix-push-untargeted-broadcast` @ 7ba7c809
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: C-14 follow-up of feature 242 (`docs/roadmap/features/242-fix-push-untargeted-broadcast/design.md` § C-14, implementation-spec Step 16)

## Observed

Two per-account CRITICAL alerts in `xstockstrat-trading` call `EmitAlert` with no `TargetUserId`:

- the reconciliation mismatch alert in `emitReconciliationFinding` (category `reconciliation`), fired when a
  past-grace-window broker mismatch halts one account;
- the account halt alert in `haltAccount` (category `halt`), fired for every automatic per-account halt.

Feature 242 makes notify deliver untargeted Web Pushes to admin-role users only. After it lands, both alerts
reach admin devices only. The owner of the halted account gets no push for their own account's halt or
mismatch. In-app `StreamAlerts`/`ListAlerts` delivery is unchanged.

## Expected

Both per-account alerts carry `TargetUserId` set to the owner of `accountID`, so the owner's devices receive the
push, as order alerts already do (`TargetUserId: order.UserId`). The owner is resolvable from `accountID`: the
`trading.broker_accounts` row has a `user_id` column (`BrokerAccountRecord.UserID`).

Out of scope: the systemic escalation alert in the same file (`trading.go:2183-2189`, Title "Systemic
broker-reconciliation failure — trading reduced to REDUCE_ONLY") shares the `reconciliation` category but is
system-wide. It counts unreachable accounts across all owners and has no single owner, so admin-only delivery
is the intended audience after feature 242. It must not be targeted, and it is distinct from the per-account
reconciliation alert at `trading.go:1938-1944`.

## Reproduction

1. With feature 242 deployed, register a push subscription for a non-admin user who owns a trading account.
2. Cause an automatic halt of that account (for example, a reconciliation mismatch that persists past the grace
   window, or any other `haltAccount` path).
3. Observe: the `halt` and `reconciliation` CRITICAL alerts are pushed to admin devices only; the account owner's
   device receives nothing.
4. In a unit test, the `EmitAlertRequest` captured from `haltAccount` / `emitReconciliationFinding` has an empty
   `TargetUserId`.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1938-1944` (in `emitReconciliationFinding`, `:1926`)
> Category:      "reconciliation",

`services/xstockstrat-trading/internal/service/trading.go:2751-2757` (in `haltAccount`, `:2731`)
> Category:      "halt",

`services/xstockstrat-trading/internal/service/trading.go:3348` (targeting precedent; also `:3684`, `:3700`)
> TargetUserId:  order.UserId,

`services/xstockstrat-trading/internal/repository/account_repo.go:24`
> UserID         string

## Root cause hypothesis

Before feature 242, untargeted alerts were pushed to every subscription, so the owner received them as a side
effect. These two alerts never set `TargetUserId`, and nothing resolves the account owner at emit time.

## Confidence

high
