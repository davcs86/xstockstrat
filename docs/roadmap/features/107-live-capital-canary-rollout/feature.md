# Feature: live-capital-canary-rollout

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: `feature/live-capital-canary-rollout`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — explicitly premature: stages the rollout of an automated strategy-to-order execution path that does not exist in this codebase and is not roadmapped |
| 2026-08-06 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(1); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduces staged live-capital rollout limits (shadow decisions → paper → single-symbol live → single-strategy live → minimal fixed notional → limited daily order count/window → gradual expansion) enforced in `xstockstrat-trading`, each stage gated by explicit promotion/rollback criteria evaluated against the P0 safety controls (idempotency, reconciliation, protection SLO, halt exercise, restart-during-open-position), so the platform never transitions directly from paper trading to unrestricted live operation.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, position limit enforcement, paper-only dev invariant |
| `xstockstrat-config` owner | Config key naming, environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, config mutation safety |
| Platform Lead | Cross-service architecture, rollout governance |

## Next Action

`/sdd-review live-capital-canary-rollout product-spec` — AI review of product spec before running /sdd-spec
