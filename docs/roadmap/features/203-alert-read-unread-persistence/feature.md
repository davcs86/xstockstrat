# Feature: alert-read-unread-persistence

**Development Branch**: `feature/alert-read-unread-persistence`
**Created**: 2026-09-24
**Last Updated**: 2026-09-24
**Committed to main**: 0be58cbe339fd3bf47b6b23464c3af53ae402b78
**Launched date**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, no blockers) |
| 2026-09-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (10 steps) |
| 2026-09-24 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1 proto + Step 2 codegen) |
| 2026-09-24 | `in-progress` → `code-completed` | /sdd-execute | All 10 steps done; notify 63/63 @90.78%, UI e2e 13/13; C-16 scenarios promoted |

| 2026-09-25 | `code-completed` → `launched` | CI workflow | Promoted via PR #1177; committed 0be58cbe339fd3bf47b6b23464c3af53ae402b78 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map
- [Design](design.md) — debated, user-approved architecture (3 rounds, quick)
- [Implementation Spec](implementation-spec.md) — 10 steps: proto, codegen, migration, notify handler, notify tests, UI shared extraction, inbox page, badge refactor, E2E fixtures, E2E specs
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Turn `xstockstrat-notify` alerts into a durable per-user notification inbox by adding a
per-user **read/unread** state (distinct from the existing `acknowledged` ack), so each user
tracks which alerts they have seen — including their own read state on broadcast alerts. The
alert's severity (level), body, and originating module (served by the existing `severity`,
`body`, and `category`/`source_service` fields) are surfaced consistently in the inbox.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | New MarkAlertRead RPC + read fields on Alert / ListAlerts filters |
| `xstockstrat-notify` owner | Stream delivery guarantees, per-user read semantics on broadcast alerts, dedup |
| DBA + `xstockstrat-notify` owner | New per-user alert-read table + migration |
| `xstockstrat-ui` owner | Notifications page + AlertStream read/unread rendering, mark-read call safety |

## Next Action

`/sdd-review alert-read-unread-persistence impl-spec` — advisory quality check + overlap scan on the implementation spec
