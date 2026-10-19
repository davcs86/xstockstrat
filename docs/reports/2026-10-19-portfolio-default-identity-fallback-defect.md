# Defect: portfolio consumers substitute literal "default" / "alpaca-default" for a missing user or account id

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: data-misattribution
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: `services/xstockstrat-portfolio/docs/context-constitution-findings.md` § Open questions, row 4

## Observed
When a ledger event lacks identity, the portfolio consumers do not reject it. They write rows
under hardcoded placeholder identities:
- `processOrderFill`: an empty `account_id` becomes `"alpaca-default"`.
- `processPositionSync`, the account-deregister handler and the balance-sync consumer: an empty
  `user_id` becomes `"default"`.

Any such event produces positions or balances owned by a phantom user or account. Nobody can see
them through the `x-user-id`-scoped reads, and nothing cleans them up. Whether current producers can
still emit identity-less events is unconfirmed (the code comment calls them "legacy").

## Expected
Events without `user_id` / `account_id` are rejected and logged (acked and skipped), or the fallback
is proven unreachable and deleted.

## Reproduction
1. Append an `order.filled` ledger event with an empty `account_id` (and a valid `user_id`).
2. Let `ConsumeOrderFills` process it.
3. `SELECT account_id FROM portfolio.positions WHERE symbol = '<sym>'` returns `alpaca-default`.

## Evidence
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:321`
> acctID = "alpaca-default"

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1099`
> // Fall back to "default" for legacy events emitted before user_id was carried.

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1102`
> userID = "default"

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1053` and `:1221` hold the same `userID = "default"` fallback.

## Root cause hypothesis
These are compatibility shims for events from before user and account IDs were carried, and they
were never retired once all producers started populating identity.

## Confidence
low
