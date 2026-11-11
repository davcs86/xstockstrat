# Feature: block-fundamentals-strategy-on-etf

**Development Branch**: `feature/block-fundamentals-strategy-on-etf`
**Created**: 2026-09-27
**Last Updated**: 2026-11-04
**Committed to main**: bf93985d9f4b2159e20343c81a0e8ecfdb6add2b
**Launched date**: 2026-11-04
**Archived**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 2 warnings; render-map path corrected, Open Questions deferred to design). Overlap: clean |
| 2026-10-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds — quick mode extended by the operator at each gate) and approved; recon.md + design.md written. Hybrid guard (enforce on unavailable fundamentals, FMP `isEtf` label), deny-entry live, opportunity skip row, derivation-time evidence exclusion, PIT pagination, marketdata absence encoding. No migration; additive proto. |
| 2026-10-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 26 steps |
| 2026-10-11 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (proto contract) done — sequential autonomous run, Steps 1–6 |
| 2026-11-04 | `in-progress` → `code-completed` | /sdd-execute | Step 26 done: staging proof (a)-(e) recorded after the FMP key update; all 26 steps complete. `launched` is flipped by CI on promotion to `main` |

| 2026-11-04 | `code-completed` → `launched` | CI workflow | Promoted via PR #1438; committed bf93985d9f4b2159e20343c81a0e8ecfdb6add2b |
| 2026-11-10 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(3)/fails(3); pruned 4 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a guardrail so a strategy that requires fundamentals (a `fundamental` operand — the seeded
`fscore` custom formula or any component declaring `fundamental_inputs`) is refused or skipped with an
explicit, auditable reason when run against an ETF, instead of silently producing empty/misleading
results. Confirmed live (SCHD): ETFs have no EDGAR fundamentals (feature 211), so the fscore gate
never evaluates true and the run looks like a legitimate no-trade.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk, BSR publication readiness |
| `packages/proto` owner | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency (feature focus: fundamentals-absence encoding + ETF label source) |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |

## Next Action

Promote `main-dev` to `main` (`/promote`); CI flips this feature to `launched`. The 215 ↔ 283 launch gate (`merge-order.md`) is met.
