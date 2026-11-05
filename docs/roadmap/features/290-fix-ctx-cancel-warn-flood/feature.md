# Feature: fix-ctx-cancel-warn-flood

**Type**: bug
**Development Branch**: `feature/fix-ctx-cancel-warn-flood`
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written; marketdata variant: detach, post-departure bound + 1 writer (/sdd-review skipped on operator instruction) |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-11-05 | `implementation-ready` (re-spec, no status change) | /sdd-execute (sdd-batch-execute) | Steps 1-5 re-specced to the current codebase: portfolio anchors +6, fakeLedger :267, false pgxmock precedent removed, marketdata test append point = true EOF, PORTFOLIO-15 at :48 |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; operator approved the up-front plan (sequential mode-entry confirmation) |

---

## Artifacts

- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps, evidence-cited
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Focus | Steps |
|---|---|---|
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 2 |
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4 |

---

## Summary

On a canceled context portfolio's `ConsumePositionSyncs` and marketdata's `GetBars` cache-insert path keep iterating and log one WARN per item (3.3k + 557 lines in 7 days).

## Next Action

`/sdd-execute fix-ctx-cancel-warn-flood sequential` — Step 1 (portfolio `processPositionSync` cancel stop), red run of Step 2 first
