# Feature: fix-retired-surface-proto-cleanup

**Type**: bug
**Development Branch**: `feature/fix-retired-surface-proto-cleanup`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-mode-axis-retained-defect.md, docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md, docs/reports/2026-10-19-proto-contract-hygiene-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-13 | `spec-ready` (unchanged) | /sdd-design | Design debated (3 rounds, full) and approved by the operator; recon.md + debate.md + design.md written. The flip to `design-approved` is held under settled D-11 because no O-1 answer ((A) keep ComputeIndicatorRequest field 7 / (B) deprecation-only) was recorded |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written. The operator answered O-1 with option (A), keep `ComputeIndicatorRequest.timeframe_enum = 7`, which satisfies D-11; D-14 adds `xstockstrat-ui` to scope and reviewers |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 34 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-1..D-14, R-1..R-9, O-1..O-3 all closed (Phase 1)
- [Design](design.md) — approved design, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 34 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Residue of retired surfaces (the `trading_mode` axis, the server-side opportunity sparkline) and proto
contract hygiene drift (stalled timeframe migration, orphaned common types, closed-set strings, a
mislabelled `user_id`) still mislead agents copying patterns from code, docs and contracts.

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md`, written by `/sdd-spec` on 2026-11-20 (stable unless `/sdd-spec` re-runs).

| Reviewer | Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking change without a deprecation comment, `buf lint` / `buf breaking` pass | 1, 2 |
| `xstockstrat-analysis` owner | Strategy scoring determinism, no look-ahead bias; config subscription scope | 1, 2, 8, 9, 17, 18 |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, Alpaca feed idempotency | 1, 2, 4, 5, 27, 28 |
| `xstockstrat-indicators` owner | Formula sandboxing and numeric precision unaffected; contract test and config subscription scope | 1, 2, 3, 19, 20 |
| `xstockstrat-trading` owner | Order execution correctness, paper-only dev invariant, ownership gate on offline snapshots | 1, 2, 12, 13, 23, 24 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency | 1, 2, 6, 7, 25, 26 |
| `xstockstrat-agent` owner | MCP tool contract stability (return shape) and `docs/runbooks/mcp-tools.md` parity | 1, 2, 14, 15 |
| `xstockstrat-ui` owner | Connect-RPC call safety, analytics display accuracy — added by operator decision 2026-11-20 (design D-14): `src/hooks/useOhlcBars.ts` is a `BatchGetBars` producer | 1, 2, 10, 11 |
| `xstockstrat-ingest` owner | Config subscription scope only; signal normalization unaffected | 21, 22 |
| `xstockstrat-config` owner | WatchConfig stream stability, environment scoping | 29, 30 |
| `xstockstrat-identity` owner | Config subscription only; no auth path change | 31, 32 |
| `xstockstrat-ledger` owner | Config subscription only; append-only invariant unaffected | 31, 32 |
| `xstockstrat-notify` owner | Config subscription only; stream delivery unaffected | 31, 32 |

`docs` steps (16, 33, 34) have no reviewer. There is no `migration` or `config` step, so no DBA review.

## Next Action

`/sdd-review fix-retired-surface-proto-cleanup impl-spec` — validate implementation spec, then `/sdd-execute fix-retired-surface-proto-cleanup`
