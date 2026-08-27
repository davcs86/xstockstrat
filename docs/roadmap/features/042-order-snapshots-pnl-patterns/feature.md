# Feature: order-snapshots-pnl-patterns

**Development Branch**: `feature/order-snapshots-pnl-patterns`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26
**Committed to main**: d908f33dc3283b79b61b233d57542cd47014c4ab
**Launched date**: 2026-08-21
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved after fixing 6 review blockers (all scope-preserving): service rename `xstockstrat-insights`→`xstockstrat-ui`, migration strategy (016) + hypertable PK, nav registration, Consumer Surface section, partial-fill enum reconciliation, 2 open questions resolved from code. No scope reduced. 2 open questions remain as design-owned forks for /sdd-design. |
| 2026-08-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full — hit the cap at ACCEPT-WITH-RISKS, no Floor breach) and approved; recon.md + design.md written. Both design-owned forks resolved: analysis-centric ledger-event-driven (analysis's first StreamEvents consumer; snapshots persisted in analysis) + async close trigger via the existing `portfolio.position.closed` event. User decisions: enrich the close event (portfolio migration 010, cumulative realized P&L via a shared `applyFill` helper) + raw-sample store bucketed at query time. 7 Open Risks carried to /sdd-spec. |
| 2026-08-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps. Migration numbers re-verified across ALL remote branches (analysis 016, portfolio 010 both next-free); feature 029 collision cleared (029 is draft, no branch, migration targets trading not analysis, distinct proto names). All load-bearing citations grep-verified. |
| 2026-08-20 | `implementation-ready` → `code-completed` | /sdd-execute | All 14 steps done — proto (OrderSnapshot/PnLPatternFactor/QueryPnLPatterns) + codegen, portfolio migration 010 + realizedDelta producer, analysis migration 016 + ledger StreamEvents consumer + QueryPnLPatterns RPC, /insights P&L Patterns view + nav, docs. Verifications green: portfolio go test (cov 55.9%), analysis pytest 541 pass (cov 82%), UI build + pnl-patterns/nav-reachability e2e (5 pass). Executed on harness branch `claude/execute-020-042-127-pfa5cw`. Deviations: GetRealizedAccum (no proto field), v1 default indicator set / synthesized position_id, offline-deferred ConsumeOrderFills DB assertions. context-forge plugin unavailable → /context-scrubber not run (noted). |

| 2026-08-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #997; committed d908f33dc3283b79b61b233d57542cd47014c4ab |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); promoted 7 scenarios → analysis+ui suites; pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded 6-service codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (analysis-centric, ledger-event-driven; portfolio-cumulative P&L; raw-sample store)
- [Implementation Spec](implementation-spec.md) — 14 numbered steps with grep-verified codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

At every order event (creation, fill, cancellation), capture a snapshot of the active indicator values, signals, and market conditions for the traded symbol. Once a position closes and realized P&L is known, analyze the accumulated snapshots to surface which factors — specific indicators, signal combinations, or market conditions — correlate with positive or negative outcomes.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

Snapshot finalized at /sdd-spec (2026-08-20) from the actual step reviewers. The analysis-centric
design removed the trading / indicators / ingest owners the pre-design table listed (no order-time
edges are added to those services); the ledger owner and config team were added.

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes, buf lint + breaking passes | 1, 2 |
| DBA | Migration NNN numbering, up+down pair present, hypertable partitioning, index correctness | 3, 6 |
| `xstockstrat-analysis` owner | Backtest reproducibility, pattern scoring determinism, no look-ahead bias in factor attribution | 1, 2, 6, 7, 8, 9, 10, 11 |
| `xstockstrat-ledger` owner | Append-only invariant, event ordering (the global-sequence comment fix) | 1, 2 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 3, 4, 5 |
| config team | New config key governance (`analysis.snapshot.*` / `analysis.patterns.*`) | 7 |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, nav reachability | 12, 13 |

## Next Action

`/sdd-review order-snapshots-pnl-patterns impl-spec` — validate the implementation spec, then `/sdd-execute order-snapshots-pnl-patterns`
