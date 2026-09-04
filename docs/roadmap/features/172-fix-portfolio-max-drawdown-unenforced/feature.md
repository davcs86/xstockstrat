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
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS); overlap CLEAN; FRs + Consumer Surface added |
| 2026-09-04 | `spec-ready` → `design-approved` | /sdd-design | 3 rounds; Path A (enforce, per-account, migration 016) approved; recon.md + design.md written; no Floor breach |
| 2026-09-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-09-04 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run (stacked PR #3 on 174); Steps 1-3 (migration 016 + HWM upsert + GetAccountDrawdowns + pgxmock tests) done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (Path-A-cheap premise disproven)
- [Design](design.md) — debated, approved architecture (3 rounds; per-account, migration 016)
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence (6 steps)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`portfolio.risk.max_drawdown_pct` is fetched (`portfolio_service.go:722` `GetFloat`) then discarded
(`:750` `_ = maxDrawdownPct`). No drawdown-halt logic exists; only `concentration_limit_pct` is
enforced. An operator setting `max_drawdown_pct` gets no protection and no error. Fix is a scope
decision: implement the drawdown halt, or formally mark the key **Documented, not yet implemented**
(as `trading.risk.daily_loss_limit` already is).

## Reviewers

| Role | Focus |
|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness |
| xstockstrat-portfolio (service owner) | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-review fix-portfolio-max-drawdown-unenforced impl-spec` — validate the implementation spec, then `/sdd-execute fix-portfolio-max-drawdown-unenforced`
