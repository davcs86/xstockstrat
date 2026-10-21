# Feature: fix-indicators-formula-correctness

**Type**: bug
**Development Branch**: `feature/fix-indicators-formula-correctness`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-indicators-formula-correctness-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-indicators-formula-correctness-defect.md` (debt-radar D-10, D-18, D-54) |

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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-indicators-formula-correctness`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The formula sandbox reports `success=True, output={}` when a formula exits via `SystemExit` or emits an
unparseable output line (D-10); `ATR`/`VWAP` compute close-only approximations under the real indicators'
names (D-18); and `UpdateFormula`/`DeleteFormula` act on pending-hidden saga copies (D-54).

## Next Action

`/sdd-design fix-indicators-formula-correctness` — recommended design depth: full (≥2 services — analysis consumes ATR/VWAP — and a possible proto change for D-18); see context.md
