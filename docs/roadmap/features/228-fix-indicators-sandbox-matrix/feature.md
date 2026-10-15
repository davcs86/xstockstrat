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
| 2026-10-15 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |
| 2026-10-15 | `design-approved` (unchanged) | /sdd-review | Product spec reviewed after design (Track C): FAIL → fixed → PASS WITH WARNINGS (1 warning addressed) |
| 2026-10-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps |
| 2026-10-15 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, measured memory facts, business rules (C-16)
- [Design](design.md) — approved design (headroom semantics, 128 MiB default)
- [Implementation Spec](implementation-spec.md) — 4 steps (sandbox service/test pair, UI copy, docs + teardown)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-10-15); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-indicators owner | Formula sandboxing, numeric precision, no side-effects from formula execution | 1, 2 |
| xstockstrat-ui owner | Analytics display accuracy | 3 |

---

## Summary

The indicators formula sandbox runs within a few MiB of its 128 MiB `RLIMIT_DATA` cap, so an 800×800 numpy matmul
passes or fails depending on the host (4 of 6 CI runs on identical code failed). It reds CI for every PR that runs the
indicators job, and it is a latent nondeterministic failure for real user formulas in production.

## Next Action

`/sdd-review fix-indicators-sandbox-matrix impl-spec` — validate implementation spec, then `/sdd-execute fix-indicators-sandbox-matrix`
