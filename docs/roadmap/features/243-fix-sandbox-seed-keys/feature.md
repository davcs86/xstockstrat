# Feature: fix-sandbox-seed-keys

**Type**: bug
**Development Branch**: `feature/fix-sandbox-seed-keys`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-10-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

---

## Reviewers

Provisional snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus |
|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: twin-wins heal migration 031, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-sandbox-seed-keys`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Config migrations 001/002 seed the indicators sandbox keys bare (`sandbox.*`) while the watcher reads
`indicators.sandbox.*` (CONFIG-9), so the seeded limits never apply and every environment runs on code defaults.
Operator decision: fix in code plus a config migration.

## Next Action

`/sdd-spec fix-sandbox-seed-keys` — generate implementation spec from the approved design
