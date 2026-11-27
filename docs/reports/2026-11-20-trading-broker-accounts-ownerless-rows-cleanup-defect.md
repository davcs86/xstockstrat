# Defect: trading.broker_accounts rows with user_id = '' need cleanup

**Recorded**: 2026-11-20
**Severity**: SEV-3
**Impact type**: orphaned-data
**Environment**: dev (main-dev) and production, data-level; evidence from `feature/fix-read-path-owner-trust` @ 12fd7270
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

Before feature 312, a headerless `RegisterBrokerAccount` could persist an active
`trading.broker_accounts` row with `user_id = ''`. Feature 312 gates every broker-account write on a
non-empty caller and makes `LoadBrokerPool` skip such rows at startup with a WARN. Rows that already
exist stay in the table, and on every boot they:

- are not in the broker pool, so the `resolveAccount` sole-account rule no longer counts them;
- get no credential-health, reconciliation or halt hydration;
- leave their in-flight NEW/PARTIALLY_FILLED orders unreconciled: `pollFills` finds no pool entry
  for the account and logs `fill poll: no broker for account`, or, when exactly one non-offline
  broker remains in the pool, polls the order through that other account's client.

Trigger: the WARN `LoadBrokerPool: account has no owner, skipping account` (attribute `account_id`)
appearing in dev or prod trading logs.

## Expected

No active owner-less row remains: each is deactivated (`is_active = false`) or re-owned to its real
user, after which the startup WARN no longer fires.

## Reproduction

1. Run, read-only, through `docs/runbooks/operator-db-access.md`:
   `SELECT id FROM trading.broker_accounts WHERE user_id = '' AND is_active;`
2. Restart xstockstrat-trading.
3. Each returned id logs the `LoadBrokerPool` WARN and is absent from the broker pool.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:303-305` (`LoadBrokerPool`, `:293`)
> slog.WarnContext(ctx, "LoadBrokerPool: account has no owner, skipping account", "account_id", rec.ID)

`services/xstockstrat-trading/internal/service/trading.go:360` (`resolveAccount`, sole-account count `:372-390`)
> func (s *TradingService) resolveAccount(accountID string) (resolvedID string, entry brokerPoolEntry, err error) {

`services/xstockstrat-trading/internal/service/trading.go:1846` (`pollFills`, fallback `:1880-1893`)
> slog.WarnContext(ctx, "fill poll: no broker for account", "order_id", order.OrderId, "account_id", order.AccountId)

Last trading migration: `services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.up.sql`.

Size: the per-environment count of these rows (O-11) is recorded under Step 20 in
`docs/roadmap/features/312-fix-read-path-owner-trust/context.md` (line prefix `- O-11 row count:`).

## Root cause hypothesis

`RegisterBrokerAccount` had no empty-caller guard before feature 312, so headerless registrations
were stored with an empty owner. Feature 312 stops new ones but does not touch existing rows. Candidate
fix: a trading `012` migration deactivating active `user_id = ''` rows, with DBA approval.

## Confidence

high
