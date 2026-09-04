# Feature: fix-portfolio-max-drawdown-unenforced

**Type**: bug
**Development Branch**: `feature/fix-portfolio-max-drawdown-unenforced`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 2) — GitHub Issues disabled on this repo
**Severity**: SEV-3
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from comment-audit report item 2 (re-confirms portfolio module findings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-portfolio-max-drawdown-unenforced`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`portfolio.risk.max_drawdown_pct` is fetched (`portfolio_service.go:722` `GetFloat`) then discarded
(`:750` `_ = maxDrawdownPct`). No drawdown-halt logic exists; only `concentration_limit_pct` is
enforced. An operator setting `max_drawdown_pct` gets no protection and no error. Fix is a scope
decision: implement the drawdown halt, or formally mark the key **Documented, not yet implemented**
(as `trading.risk.daily_loss_limit` already is).

## Next Action

`/sdd-design fix-portfolio-max-drawdown-unenforced quick` — recommended design depth (quick); see context.md
