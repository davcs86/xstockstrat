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

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution | TBD (/sdd-spec) |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | D-18 consumer (evaluator, screener, warm-up, P&L-pattern consumer); historical backtests change |
| `packages/proto` owner + Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint` / `buf breaking` | Only if design adds OHLCV input to `ComputeIndicatorRequest` for D-18 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (D-54 → D-10 → D-18 Option A → docs), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-indicators-formula-correctness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The formula sandbox reports `success=True, output={}` when a formula exits via `SystemExit` or emits an
unparseable output line (D-10); `ATR`/`VWAP` compute close-only approximations under the real indicators'
names (D-18); and `UpdateFormula`/`DeleteFormula` act on pending-hidden saga copies (D-54).

## Next Action

`/sdd-spec fix-indicators-formula-correctness` — generate implementation spec from the approved design
