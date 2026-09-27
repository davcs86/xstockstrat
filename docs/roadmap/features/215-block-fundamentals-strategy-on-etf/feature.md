# Feature: block-fundamentals-strategy-on-etf

**Development Branch**: `feature/block-fundamentals-strategy-on-etf`
**Created**: 2026-09-27
**Last Updated**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 2 warnings; render-map path corrected, Open Questions deferred to design). Overlap: clean |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec block-fundamentals-strategy-on-etf`_
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
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-marketdata` owner | Asset-class / fundamentals-availability source of truth (how "ETF" is determined) |
| `xstockstrat-ui` / `xstockstrat-agent` owner | The refusal/skip reason surfaces truthfully on the backtest + opportunity surfaces |

## Next Action

`/sdd-design block-fundamentals-strategy-on-etf` — recon + design debate (resolves the ETF-detection fork)
