# Feature: fix-offline-account-ui-gaps

**Type**: bug
**Development Branch**: `feature/fix-offline-account-ui-gaps`
**Defect Report**: `docs/reports/2026-08-26-offline-account-ui-gaps-defect.md` (GitHub Issues disabled — report is the source)
**Severity**: SEV-3
**Created**: 2026-08-26
**Last Updated**: 2026-08-26
**Committed to main**: 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234
**Launched date**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (offline-account UI gaps found on staging) |
| 2026-08-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 advisory warnings addressed: FR-N/@FR tags/Consumer Surface(s) added, portfolio added to Affected Services) |
| 2026-08-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 quick round + root-cause investigation + 2 user gates) and approved; recon.md + design.md written. Scope: UI record control + trading dual guards + portfolio combined-view offline card |
| 2026-08-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps (trading guards + test, portfolio enumeration + test, UI record control, UI field gating, UI e2e, docs) |
| 2026-08-26 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1: trading guards) |
| 2026-08-26 | `in-progress` → `code-completed` | /sdd-execute | All 8 steps done (trading dual guards + test, portfolio enumeration + test, UI record control + PortfolioPanel/Book-page gating, e2e @AC-1..4, docs); ready for integration PR |

| 2026-08-26 | `code-completed` → `launched` | CI workflow | Promoted via PR #1027; committed 65aeaa4c5bb7c000dfb4e30d5b788d6c39352234 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, risks (/sdd-design Phase 0)
- [Design](design.md) — chosen approach, rejected alternatives, Constitution rules touched (/sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with grep-cited evidence (/sdd-spec)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` time (deduped across all steps).

| Step category · service | Reviewers |
|---|---|
| `service`/`test` · xstockstrat-trading (Steps 1–2) | xstockstrat-trading — Order execution correctness, broker API safety, fill detection, paper-only dev invariant |
| `service`/`test` · xstockstrat-portfolio (Steps 3–4) | xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `service`/`test` · xstockstrat-ui (Steps 5–7) | xstockstrat-ui — Trading UI correctness, analytics display accuracy, Connect-RPC call safety |
| `docs` (Step 8) | none |

---

## Summary

Two UI-correctness gaps in the shipped-to-staging feature 157 (offline-account-portfolios): the
`/trader` broker order ticket accepts orders on an offline account (one landed CANCELED instead of a
recorded NEW offline order), and the portfolio surface shows broker-only equity/cash/buying-power/
day-P&L fields that don't apply to an offline account (misleading). A sibling gap ("Edit keys" on
offline accounts) was already fixed inline on the 157 branch (commit `dcd2fe5`).

## Next Action

`/sdd-review fix-offline-account-ui-gaps impl-spec` — validate the implementation spec, then `/sdd-execute fix-offline-account-ui-gaps`.
