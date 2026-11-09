# Defect: portfolio consumers substitute literal "default" / "alpaca-default" for a missing user or account id

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: data-misattribution
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-trading
**Config-only fix possible**: no
**Source**: `services/xstockstrat-portfolio/docs/context-constitution-findings.md` § Open questions, row 4

## Observed
When a ledger event lacks identity, the portfolio consumers do not reject it. They write rows
under hardcoded placeholder identities:
- `processOrderFill`: an empty `account_id` becomes `"alpaca-default"`.
- `processPositionSync`, the account-deregister handler and the balance-sync consumer: an empty
  `user_id` becomes `"default"`.

Any such event produces positions or balances owned by a phantom user or account. Nobody can see
them through the `x-user-id`-scoped reads, and nothing cleans them up.

The two fallbacks differ in whether they can fire:
- **`account_id`: dead code.** No current producer sends it empty. The only `order.filled`
  producer, `services/xstockstrat-trading/internal/service/trading.go:1723`, sends
  `order.AccountId`. That value comes from `resolveAccount` (`:423`, `:629`), which never returns
  "" on success, or from a bracket record (`:2734`). Legacy orders were backfilled by trading
  migration 003 with the same literal.
- **`user_id`: reachable.** Trading's `RegisterBrokerAccount` accepts an empty caller when the
  `x-user-id` header is missing. That account's `account.positions.synced`,
  `account.balance.synced` and `account.deregistered` events then carry `user_id: ""`, and portfolio
  files them under `"default"`. The normal UI and agent flows always send the header, so this path
  needs an internal caller that omits it.

## Expected
- Trading's `RegisterBrokerAccount` rejects an empty caller.
- Portfolio rejects and logs events without `user_id` / `account_id` (acked and skipped), instead of
  substituting a placeholder.
- The dead `"alpaca-default"` fallback is deleted.

## Reproduction
1. Call trading `RegisterBrokerAccount` with no `x-user-id` metadata. The account is persisted
   with `user_id = ""`.
2. Let the sync poller run (broker account) or call `DeregisterBrokerAccount` with no `x-user-id`
   (the empty caller matches the empty owner). The emitted event carries `user_id: ""`.
3. Portfolio stores or purges that account's rows under `user_id = 'default'`.

Scratch test for steps 1-2:
`/tmp/claude-0/-home-user-xstockstrat/0e33c54d-7bf5-528d-8d50-aaa4bc92a407/scratchpad/confirm/portfolio-default-identity-fallback/zz_emptyuser_test.go`.
Copy it into `services/xstockstrat-trading/internal/service/` and run
`GOWORK=off go test ./internal/service/ -run TestZZ_ -v`. Output:
> RegisterBrokerAccount accepted empty user: persisted user_id=""
> account.deregistered emitted: UserId="" payload.user_id="" payload.account_id="620cc568-452d-4619-b48b-a90733b3ff82"

## Evidence
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:321`
> acctID = "alpaca-default"

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1099`
> // Fall back to "default" for legacy events emitted before user_id was carried.

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1102`
> userID = "default"

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1053` and `:1221` hold the same `userID = "default"` fallback.

The `account_id` fallback copies the trading migration default:

`services/xstockstrat-trading/migrations/003_orders_account_id.up.sql:2`
> ADD COLUMN IF NOT EXISTS account_id   TEXT     NOT NULL DEFAULT 'alpaca-default',

The empty caller is accepted without a check:

`services/xstockstrat-trading/internal/handler/trading.go:258-267`: `extractUserID` returns "" when
`x-user-id` is absent.

`services/xstockstrat-trading/internal/handler/trading.go:274`
> userID := extractUserID(ctx)

`services/xstockstrat-trading/internal/service/trading.go:2390` (`RegisterBrokerAccount`) persists
`UserID: userID` without checking for "". `broker_accounts.user_id TEXT NOT NULL`
(`migrations/002_broker_accounts.up.sql:7`) accepts "".

`services/xstockstrat-trading/internal/service/trading.go:2910` (`DeregisterBrokerAccountSvc`)
> if rec.UserID != callerUserID {

The other producers already require identity: `SnapshotOfflinePositions` rejects an empty
`user_id` (`trading.go:1050`), and `PlaceOrder` / `ConfirmOrder` reject an empty caller
(`trading.go:432`, `:911`).

## Root cause hypothesis
The `"default"` fallbacks hide a missing empty-caller guard in trading's `RegisterBrokerAccount`.
An account created without `x-user-id` gets owner "", and every event it later produces carries no
identity.

The `"alpaca-default"` fallback matches the backfill value from migration 003 and is unreachable
from current producers. The fix is to reject an empty caller in `RegisterBrokerAccount` and to
remove the portfolio fallbacks as dead code.

## Confidence
high: the producer trace and migration 003 show the `account_id` fallback is unreachable. A local
test showed the `user_id` path is reachable through `RegisterBrokerAccount`.
