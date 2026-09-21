# Feature: symbol-opportunity-ranking

**Development Branch**: `feature/symbol-opportunity-ranking`
**Created**: 2026-09-20
**Last Updated**: 2026-09-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning: 4-segment override key shape → design; 0 blockers). Merge-order row added: 200 depends on 199 |
| 2026-09-20 | `spec-ready` (unchanged) | /sdd-design | Recon + 3-round debate run (SOUND, no Floor breach); **paused by operator before approval** pending feature 199 landing. recon.md written; converged design + Open Threads in context.md; design.md NOT yet written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-opportunity-ranking`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A single comparable **symbol-level** score that rolls up all of a symbol's opportunities into one
number (diminishing-returns sum of each opportunity's feature-199 `composite_score` weighted by its
strategy's derived grade × operator override), so a trader can rank *which symbol to trade* across the
whole queue — not just compare individual opportunities. **Layers on feature 199.**

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Strategy scoring determinism, backtest reproducibility, no look-ahead bias |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, server-authoritative ordering (no client re-sort) |
| `xstockstrat-agent` (service owner) | MCP tool contract stability (`list_opportunities` return shape / symbol-compare surface), docs parity |
| Proto Reviewer | Additive-only symbol_score surface, field-number uniqueness, `buf breaking` passes |
| DBA | (If persisted) `analysis` migration NNN numbering, up+down pair, column additivity |
| `xstockstrat-config` (service owner) | Config key naming (`analysis.scoring.*` / `analysis.opportunity.*`), env/global-per-user scoping |

## Next Action

**Paused** — resume `/sdd-design symbol-opportunity-ranking` (round 4 + write design.md) **after feature 199 lands**, then `/sdd-spec`. Design debated 3 rounds (SOUND, unapproved); converged state + Open Threads recorded in `context.md`. Blocked on 199's merged shape (composite_score column, proto field, migration NNN).
