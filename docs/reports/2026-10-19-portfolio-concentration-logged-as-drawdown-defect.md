# Defect: concentration breaches are recorded as portfolio.risk.drawdown_breach ledger events

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: audit-mislabel
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: found while verifying `services/xstockstrat-portfolio/docs/context-constitution-findings.md` § Latent bugs, row 1 (`checkRiskLimits`) against `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted

## Observed
`checkRiskLimits` sends both concentration-limit breaches and per-account drawdown breaches through
`emitRiskAlert`. That helper always appends a ledger event of type `portfolio.risk.drawdown_breach`
on the global stream key `portfolio:risk`, with only a free-text `message` (no `user_id`,
`account_id` or `symbol`). CLAUDE.md documents `portfolio.risk.drawdown_breach` as "Max drawdown
exceeded". Every concentration alert is therefore mislabelled as a drawdown in the audit log, and no
breach can be attributed to a user without parsing the message.

## Expected
Concentration and drawdown breaches use distinct event types, keyed or carrying `user_id` (and
`account_id` / `symbol` where relevant).

## Reproduction
1. Hold a position above `portfolio.risk.concentration_limit_pct` (default 0.20) of portfolio value.
2. Wait for a `checkRiskLimits` run.
3. Read the ledger stream `portfolio:risk`. The event type is `portfolio.risk.drawdown_breach` and
   the message is "concentration limit breach: …".

## Evidence
`services/xstockstrat-portfolio/internal/service/portfolio_service.go:920`
> s.emitRiskAlert(ctx, fmt.Sprintf("concentration limit breach: %s at %.1f%%", sym, pct*100))

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:928`
> s.emitRiskAlert(ctx, msg)

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:934`
> s.emitEvent(ctx, "portfolio.risk.drawdown_breach", "portfolio:risk", map[string]interface{}{

## Root cause hypothesis
A single alert helper that predates the per-kind split is reused for both breach kinds. Feature 172
added drawdown enforcement on top of it without separating the event types.

## Confidence
high
