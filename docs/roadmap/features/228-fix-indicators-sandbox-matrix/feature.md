# Feature: fix-indicators-sandbox-matrix

**Type**: bug
**Development Branch**: `feature/fix-indicators-sandbox-matrix`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15
**Last Updated**: 2026-10-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-indicators-sandbox-matrix`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The indicators formula sandbox runs within a few MiB of its 128 MiB `RLIMIT_DATA` cap, so an 800×800 numpy matmul
passes or fails depending on the host (4 of 6 CI runs on identical code failed). It reds CI for every PR that runs the
indicators job, and it is a latent nondeterministic failure for real user formulas in production.

## Next Action

`/sdd-design fix-indicators-sandbox-matrix quick` — recommended design depth (quick) from triage; see context.md
