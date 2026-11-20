# Feature: fix-trading-config-plumbing

**Type**: bug
**Development Branch**: `feature/fix-trading-config-plumbing`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md, docs/reports/2026-10-19-trading-config-accessor-type-mismatch-defect.md, docs/reports/2026-10-19-trading-requires-approval-always-false-defect.md, docs/reports/2026-11-06-trading-broker-paper-env-derived-default-unseedable-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 4 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings) |
| 2026-11-13 | `spec-ready` (unchanged) | /sdd-review A1b | Reactivated as duplicate of demoted feature `fix-ingest-seeded-config-keys` (277) — operator decision 2026-11-13 |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, open risks, rules touched
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-trading-config-plumbing`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four xstockstrat-trading config/persistence plumbing gaps: IBKR ignores `trading.broker.timeout_ms`,
int-documented keys are read with `GetFloat` (silently zeroed), `requires_approval` is always persisted
`false`, and `trading.broker.paper` has an environment-derived default no catalog seed can express.

## Next Action

`/sdd-spec fix-trading-config-plumbing` — generate implementation spec from the approved design
