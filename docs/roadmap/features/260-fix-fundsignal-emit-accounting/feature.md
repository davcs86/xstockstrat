# Feature: fix-fundsignal-emit-accounting

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-emit-accounting`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md` (debt-radar D-43, D-57) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | TBD (/sdd-spec) — `fundsignal_loop.py` claim/emit and fetch accounting |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion | Read-only unless design makes the retry idempotent on ingest's side (D-43 double-emit trade-off) |
| DBA | Migration numbering, up+down pair, index correctness | Only if design adds a column or state to `analysis.fundsignal_emitted` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundsignal-emit-accounting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals producer claims the day's `fundsignal_emitted` row before emitting, so a failed `IngestSignal`
blocks that symbol for the rest of the day and is still counted as emitted. A failed `GetFundamentalsMulti` chunk's
symbols are neither fetched nor deferred, and the run still reports `completed`.

## Next Action

`/sdd-design fix-fundsignal-emit-accounting` — recommended design depth: full (2 affected services; ingest is read-only unless design changes retry idempotency — operator may downgrade to quick). Design must resolve OQ-1/OQ-2; see context.md
