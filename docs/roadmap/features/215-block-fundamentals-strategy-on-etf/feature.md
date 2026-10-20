# Feature: block-fundamentals-strategy-on-etf

**Development Branch**: `feature/block-fundamentals-strategy-on-etf`
**Created**: 2026-09-27
**Last Updated**: 2026-10-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 2 warnings; render-map path corrected, Open Questions deferred to design). Overlap: clean |
| 2026-10-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds — quick mode extended by the operator at each gate) and approved; recon.md + design.md written. Hybrid guard (enforce on unavailable fundamentals, FMP `isEtf` label), deny-entry live, opportunity skip row, derivation-time evidence exclusion, PIT pagination, marketdata absence encoding. No migration; additive proto. |
| 2026-10-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 26 steps |
| 2026-10-11 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (proto contract) done — sequential autonomous run, Steps 1–6 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md)
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

`/sdd-review block-fundamentals-strategy-on-etf impl-spec` — validate implementation spec, then `/sdd-execute block-fundamentals-strategy-on-etf`
