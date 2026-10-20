# Feature: fix-otel-metrics-logs-gap

**Type**: bug
**Development Branch**: `feature/fix-otel-metrics-logs-gap`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md` |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| Platform Lead | Cross-service architecture, service registry consistency | TBD (/sdd-spec) — cross-cutting observability contract (12 runtimes + `packages/otel`) |
| Service owners of all 12 runtimes (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config, ui, agent) | Per-service focus per registry | Only under fix (b), which changes each telemetry module |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-otel-metrics-logs-gap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

No service exports OTel metrics or logs (traces only, per feature 226), yet the provisioned Grafana alerts and
dashboards query `rpc_server_duration_milliseconds`, which nothing produces, and `docs/setup/grafana-cloud.md`
claims traces, metrics and logs. The error-rate and p99 alerts can never fire.

## Next Action

`/sdd-design fix-otel-metrics-logs-gap` — recommended design depth: full (12 runtimes + `packages/otel`; fix (a) vs (b) is a C-11 scope fork); see context.md
