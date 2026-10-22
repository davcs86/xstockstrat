# Feature: fix-indicators-formula-correctness

**Type**: bug
**Development Branch**: `feature/fix-indicators-formula-correctness`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-indicators-formula-correctness-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-indicators-formula-correctness-defect.md` (debt-radar D-10, D-18, D-54) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. OQ-1 = Option A; @option-B AC-8/AC-9 deleted |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22). Docs steps 9-10 have no reviewer.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution | 1, 2, 3, 4, 5, 6 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety | 7, 8 |

`xstockstrat-analysis` and `packages/proto` are consumers whose code does not change under Option A, so no step assigns them a reviewer.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (D-54 → D-10 → D-18 Option A → docs), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The formula sandbox reports `success=True, output={}` when a formula exits via `SystemExit` or emits an
unparseable output line (D-10); `ATR`/`VWAP` compute close-only approximations under the real indicators'
names (D-18); and `UpdateFormula`/`DeleteFormula` act on pending-hidden saga copies (D-54).

## Next Action

`/sdd-review fix-indicators-formula-correctness impl-spec` — validate implementation spec, then `/sdd-execute fix-indicators-formula-correctness`
