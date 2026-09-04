# Product Spec: fix-portfolio-max-drawdown-unenforced

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 2)
**Severity**: SEV-3
**Created**: 2026-09-04

---

## Problem Statement

**Observed**: `services/xstockstrat-portfolio/internal/service/portfolio_service.go` reads the
`portfolio.risk.max_drawdown_pct` config key (`:722`, `GetFloat("portfolio.risk.max_drawdown_pct",
0.10)`) then explicitly discards it (`:750`, `_ = maxDrawdownPct // drawdown requires historical P&L
tracking — handled by snapshots over time`). No drawdown-halt or drawdown-alert logic consumes the
value. Only `concentration_limit_pct` is actually enforced in the risk path.

**Expected**: either the configured maximum drawdown is enforced (a halt/alert fires when breached),
or the key is honestly documented as not-yet-implemented so an operator is not misled into believing
a protection exists. The current state — read, silently discarded — is the worst of both: it looks
wired but does nothing.

**Already logged**: this re-confirms `services/xstockstrat-portfolio/docs/context-constitution-findings.md`
(Dead/orphaned code) and the `**Read but not yet enforced**` note already present in the portfolio
`CLAUDE.md` Config Keys table. The comment-audit re-surfaced it for routing so it is not lost.

## Reproduction Steps

1. Set `portfolio.risk.max_drawdown_pct` to a tight value (e.g. `0.02`) via config-ui / SetConfig.
2. Drive the portfolio into a drawdown exceeding 2%.
3. Observe no halt, no alert, and no error — the limit has no effect.

## Root Cause Hypothesis

Drawdown tracking was never built. The config key and its read were added ahead of the enforcement
logic (which needs historical P&L / snapshot series), and the placeholder `_ = maxDrawdownPct`
suppressor was left in place. Same class as `trading.risk.daily_loss_limit`
(documented-not-implemented).

## Affected Services

- `xstockstrat-portfolio` (`internal/service/portfolio_service.go`) — single service.
- If the "implement" path is chosen, `xstockstrat-notify` may be a secondary dependency (alert
  emission) and historical P&L snapshot storage is in scope.

## Fix Scope

- [x] No proto changes anticipated (either fix path)
- [ ] Database migrations — **depends on decision**: the "implement" path likely needs durable
      historical P&L / drawdown-peak state; the "document-only" path needs none.
- [x] No config key changes anticipated (the key already exists; no new key)
- [ ] **Open decision (design gate)**: (A) implement the drawdown halt/alert — larger, needs
      historical P&L tracking and possibly a migration + notify wiring; or (B) mark
      `portfolio.risk.max_drawdown_pct` **Documented, not yet implemented** in the portfolio
      `CLAUDE.md` and remove/annotate the misleading read, mirroring `daily_loss_limit`. Choice
      dictates whether this stays a doc-only fix or grows into a real risk-control feature.

## Acceptance Criteria

See `acceptance.feature`. The regression scenario differs by decision:
- Path A: a drawdown breach produces the enforced outcome (halt/alert); test fails on today's no-op.
- Path B: the key's status is unambiguously "not enforced" in docs and the discard is annotated so no
  operator is misled; test asserts the documented contract.

Plus: existing portfolio tests pass; risk path smoke-tested on dev.

## Out of Scope

- Reworking `concentration_limit_pct` enforcement (already functional).
- `trading.risk.daily_loss_limit` (a sibling documented-not-implemented key; separate item).
