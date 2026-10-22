# Feature: otel-metrics-logs-export

**Development Branch**: `feature/otel-metrics-logs-export`
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `idea` → `draft` | /sdd-story | Product spec generated. NNN 274 is operator-specified, not max+1 (254); see `context.md` |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings open; 1 FAIL + 9 warnings across two passes fixed) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier + pinned-SDK probe
- [Design](design.md) — approved architecture (P-0 → PR-A → G1 → PR-B), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec otel-metrics-logs-export`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Every xstockstrat runtime exports OTel metrics (including a gRPC server-duration histogram) and logs over
OTLP/HTTP next to its existing traces. The Grafana alerts and dashboards that feature 250 narrows to traces can
then be restored against series that are actually produced.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture: one telemetry contract (resource attrs, exporters, gating) across 12 runtimes |
| `xstockstrat-trading` / `-portfolio` / `-marketdata` owners | Go `internal/telemetry` + gRPC server metrics; no hot-path latency regression on order/fill paths |
| `xstockstrat-indicators` / `-ingest` / `-analysis` owners | Python `app/telemetry.py` metrics + logging bridge; sandbox timeout (`indicators.sandbox.timeout_ms`) unaffected |
| `xstockstrat-ledger` / `-identity` / `-notify` / `-config` owners | Node `src/telemetry.ts` metrics + winston bridge; WatchConfig stream stability (config); no secret values in log records (identity, config) |
| `xstockstrat-ui` owner | Next.js `src/telemetry.ts` (`metricReaders`/`logRecordProcessors` are empty today); no secret values in log records |
| `xstockstrat-agent` owner | Python telemetry; no secret values in tool-output logs; stateless OAuth unaffected |

## Next Action

`/sdd-spec otel-metrics-logs-export` — generate implementation spec from the approved design. Prerequisite P-0
(amend feature 250 before it executes) is part of the plan; spec step 0 re-reads 250's landed guard.
Hard ordering: 250 (`fix-otel-metrics-logs-gap`) merges first (`merge-order.md`).
