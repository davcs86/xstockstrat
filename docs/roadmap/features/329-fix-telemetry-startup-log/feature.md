# Feature: fix-telemetry-startup-log

**Type**: bug
**Development Branch**: `feature/fix-telemetry-startup-log`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-telemetry-startup-log`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Node and Python telemetry startup log prints the raw `OTEL_EXPORTER_OTLP_ENDPOINT` env var (`→ undefined` / `endpoint: None` when unset) while the SDK actually exports to its default; the UI env docs also omit that the var is required when `OTEL_ENABLED=true`.

## Next Action

`/sdd-design fix-telemetry-startup-log` — full design recommended (9 services)
