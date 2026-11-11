# Product Spec: fix-alert-event-targeting

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md, docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Trading per-account CRITICAL alerts are untargeted, so the account owner gets no Web Push (SEV-2)

- **Observed:** the reconciliation-mismatch alert (`emitReconciliationFinding`, category `reconciliation`) and the
  automatic halt alert (`haltAccount`, category `halt`) call `EmitAlert` with no `TargetUserId`. Since feature 242
  untargeted pushes go to admin-role users only, so the owner of the halted account receives no push. In-app
  `StreamAlerts`/`ListAlerts` delivery is unchanged.
- **Expected:** both alerts carry `TargetUserId` = the owner of `accountID` (`trading.broker_accounts.user_id`,
  `BrokerAccountRecord.UserID`), as order alerts already do (`TargetUserId: order.UserId`).
- Report: [docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md](../../../reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md)

### Concentration breaches are recorded as portfolio.risk.drawdown_breach ledger events (SEV-3)

- **Observed:** `checkRiskLimits` sends both concentration and per-account drawdown breaches through
  `emitRiskAlert`, which always appends `portfolio.risk.drawdown_breach` on the global stream `portfolio:risk`
  with only a free-text `message`. Every concentration breach is mislabelled as a drawdown, and no breach is
  attributable to a user without parsing the message.
- **Expected:** concentration and drawdown breaches use distinct event types, keyed by or carrying `user_id`
  (and `account_id` / `symbol` where relevant).
- Report: [docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md](../../../reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md)

## Reproduction Steps

1. Trading: with feature 242 deployed, register a push subscription for a non-admin user who owns a trading
   account; cause an automatic halt (e.g. a reconciliation mismatch past the grace window). The `halt` and
   `reconciliation` CRITICAL alerts reach admin devices only. Unit level: the `EmitAlertRequest` captured from
   `haltAccount` / `emitReconciliationFinding` has an empty `TargetUserId`.
2. Portfolio: hold a position above `portfolio.risk.concentration_limit_pct` (default 0.20); wait for a
   `checkRiskLimits` run; the `portfolio:risk` ledger event type is `portfolio.risk.drawdown_breach` with message
   "concentration limit breach: …".

## Root Cause Hypothesis

- Trading: before feature 242 untargeted alerts reached every subscription, so owners got them as a side effect;
  nothing resolves the account owner at emit time. Current sites (main-dev 0fecb24d):
  `services/xstockstrat-trading/internal/service/trading.go:2014` (`emitReconciliationFinding`, alert at `:2026-2033`),
  `:2872` (`haltAccount`, alert at `:2892-2898`); owner column `internal/repository/account_repo.go` `UserID`.
- Portfolio: one alert helper predating the per-kind split, reused for both kinds. Current site:
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1307` (concentration call), `:1316`
  (drawdown call), `:1320-1323` (`emitRiskAlert` → `portfolio.risk.drawdown_breach`, payload `message` only).
  Since the report, `emitRiskAlert` takes `userID` and targets the notify alert, but the ledger event is still
  mislabelled and unattributed.

## Affected Services

- xstockstrat-trading (per-account alert targeting)
- xstockstrat-portfolio (risk-breach ledger event types / payload)

## Fix Scope

- Proto changes anticipated: **no** — `EmitAlertRequest.TargetUserId` already exists; ledger event types are strings.
- DB migrations anticipated: **no** — the owner is already stored (`trading.broker_accounts.user_id`).
- Config key changes anticipated: **no** — neither report names a config change.

## Open Questions

1. After targeting, should admins still receive the per-account halt / reconciliation push (owner-only vs. owner +
   admins)? Feature 242 makes untargeted = admin-only, so targeting the owner may remove the admin push.
2. New ledger event type name for concentration breaches and whether the stream key moves from global
   `portfolio:risk` to a per-user key (affects any ledger consumer of `portfolio:risk` and
   `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- The systemic escalation alert in `trading.go` (Title "Systemic broker-reconciliation failure — trading reduced to
  REDUCE_ONLY", same `reconciliation` category, now near `:2284`): system-wide, no single owner; admin-only delivery
  is intended and it must stay untargeted.
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
