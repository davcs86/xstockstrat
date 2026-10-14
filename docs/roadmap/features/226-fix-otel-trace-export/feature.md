# Feature: fix-otel-trace-export

**Type**: bug
**Development Branch**: `ccr-3c062b89-cl8ixo` (session-pinned branch; operator-approved deviation from `feature/fix-otel-trace-export` — see context.md)
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-14
**Last Updated**: 2026-10-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-14 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md` |
| 2026-10-14 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, quick + 2 operator-requested) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-otel-trace-export`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

No service exports traces to Grafana Cloud: Go/Python/Node exporters use gRPC with explicit endpoint
options against an OTLP/HTTP-only gateway URL, and the UI's instrumentation hook is never registered.

## Next Action

`/sdd-spec fix-otel-trace-export` — generate implementation spec from the approved design
