# Feature: fix-otel-metrics-logs-gap

**Type**: bug
**Development Branch**: `feature/fix-otel-metrics-logs-gap`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, 3 notes; overlap WARN: 084 rebase-only) |
| 2026-10-20 | `spec-ready` (re-review, no transition) | /sdd-review | Product spec re-approved (5 warnings, 2 notes; overlap PASS) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| Platform Lead | Cross-service architecture, service registry consistency | TBD (/sdd-spec) — observability contract (`packages/otel` alerts/dashboards + docs) |
| Service owners of all 12 runtimes | Per-service focus per registry | None — fix (b) is out of scope (operator decision 2026-10-20: narrow to traces) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — debated, approved design (3 rounds, full)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-otel-metrics-logs-gap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

No service exports OTel metrics or logs (traces only, per feature 226), yet the provisioned Grafana alerts and
dashboards query `rpc_server_duration_milliseconds`, which nothing produces, and `docs/setup/grafana-cloud.md`
claims traces, metrics and logs. The error-rate and p99 alerts can never fire.

## Next Action

`/sdd-spec fix-otel-metrics-logs-gap` — generate implementation spec from the approved design
