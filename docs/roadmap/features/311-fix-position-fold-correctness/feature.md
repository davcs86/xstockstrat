# Feature: fix-position-fold-correctness

**Type**: bug
**Development Branch**: `feature/fix-position-fold-correctness`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`, `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`, `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (11 rounds, full) and approved under the operator's standing authorisation (context.md:1522-1524); recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 27 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections, petitions
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 27 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from the implementation spec's per-step `**Reviewers**` lines (stable unless `/sdd-spec` re-runs).

| Reviewer | Focus | Steps |
|---|---|---|
| DBA | Migration NNN numbering, up+down pair, index correctness | 1, 2 |
| xstockstrat-portfolio owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 3-13 |
| xstockstrat-trading owner | Order execution correctness, broker API safety, fill detection | 2, 14-25 |
| none (docs) | — | 26, 27 |

---

## Summary

The portfolio live position fold is wrong three ways: it re-applies the whole `order.filled` history on
every restart (and double-applies across overlapping processes), it folds every sell as a buy, and it
never sees bracket-leg exit fills because trading emits no ledger event for them.

## Next Action

`/sdd-review fix-position-fold-correctness impl-spec` — validate implementation spec, then `/sdd-execute fix-position-fold-correctness`. Before `/sdd-execute`: run `/sdd-distill fix-position-fold-correctness` (context.md is over the 65536-byte limit) and have the operator confirm or overturn the adoption-only throttle (D-50, an orchestrator assumption).
