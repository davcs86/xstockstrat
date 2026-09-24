# Feature: alert-read-unread-persistence

**Development Branch**: `feature/alert-read-unread-persistence`
**Created**: 2026-09-24
**Last Updated**: 2026-09-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, no blockers) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
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

`/sdd-design alert-read-unread-persistence quick` — recon + design debate (close broadcast-entitlement and unread-count semantics)
