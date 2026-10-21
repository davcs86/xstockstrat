# Feature: fix-screener-symbol-isolation

**Type**: bug
**Development Branch**: `feature/fix-screener-symbol-isolation`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, 4 notes; overlap PASS) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it and assigns steps.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (`/sdd-spec`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 grounded codebase dossier
- [Design](design.md) — approved design (4 rounds, full): chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-screener-symbol-isolation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ScreenerEngine.screen()` fans out `_eval_symbol` via `asyncio.gather` with no per-symbol isolation, so one
symbol raising a non-`grpc.RpcError` exception fails the whole `ScreenSymbols` RPC as gRPC UNKNOWN.

## Next Action

`/sdd-spec fix-screener-symbol-isolation` — generate implementation spec from the approved design
