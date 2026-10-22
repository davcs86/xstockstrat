# Feature: fix-python-loop-supervision

**Type**: bug
**Development Branch**: `feature/fix-python-loop-supervision`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-python-loop-supervision-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-python-loop-supervision-defect.md` (debt-radar D-07, D-08, D-56) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; 4 resolved in spec) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — background loops (D-07), config watcher (D-08), P&L-pattern consumer (D-56) |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement, no side-effects | TBD (/sdd-spec) — config watcher copy (D-08) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion | TBD (/sdd-spec) — config watcher copy (D-08) |
| `xstockstrat-config` owner | WatchConfig stream stability | Read-only: client-side reconnect only; no server change expected |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-python-loop-supervision`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Analysis background loops die for good on one exception in their schedule bookkeeping, and their tasks are
unretained. All three Python `ConfigWatcher._watch` loops end on any non-gRPC exception. The analysis P&L-pattern
consumer skips a failed event and its monotonic cursor moves past it.

## Next Action

`/sdd-spec fix-python-loop-supervision` — generate implementation spec from the approved design
