# Feature: fix-sandbox-result-contract

**Type**: bug
**Development Branch**: `feature/fix-sandbox-result-contract`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`, `docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`, `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-sandbox-result-contract`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The indicators sandbox's result contract is unreliable: `exit_reason` is inferred from forgeable stderr
substrings, `memory_used_bytes` is always 0, and a formula that never assigns `result` reports success
with `{}`.

## Next Action

`/sdd-design fix-sandbox-result-contract` — full design recommended (indicators + ui/agent consumers; contract change)
