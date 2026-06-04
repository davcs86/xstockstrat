# Feature: config-ui-weight-validation

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/config-ui-weight-validation`
**Created**: 2026-05-23
**Last Updated**: 2026-06-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-23 | `idea` | backlog | Captured during 007-signal-source-weighting review |
| 2026-06-01 | `idea` → `draft` | /sdd-story | Product spec generated from preliminary notes |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved. 3 OQs resolved: Option B (proto-declared ValidationRule), key detection N/A, must follow 045 (targets xstockstrat-ui). |
| 2026-06-01 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-06-04 | `implementation-ready` (Steps 5–6 re-spec) | /sdd-execute | Merged current main-dev; re-spec'd Steps 5–6 from the deleted `xstockstrat-config-ui` to the consolidated `xstockstrat-ui` (namespace page now uses 044 hooks; e2e under `e2e/config-ui/` + shared `e2e/mock-backend.ts`). Steps 1–4 (proto + xstockstrat-config) unchanged. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — numbered steps with exact file/symbol references
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add client-side validation to the config-ui weight editor so that JSON weight map keys (e.g. `analysis.signals.source_weights`) reject values outside `[0.0, 1.0]` before calling `SetConfig`, giving operators immediate feedback instead of silently-clamped server-side results.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes, `buf lint` + `buf breaking` passes |
| `xstockstrat-config` owner | Config key naming, WatchConfig stream stability, validation field population correctness |
| `xstockstrat-config-ui` owner (`test`) | Config mutation safety, validation UX correctness, no secret values rendered in UI |

## Next Action

`/sdd-review config-ui-weight-validation impl-spec` — validate implementation spec, then `/sdd-execute config-ui-weight-validation`
