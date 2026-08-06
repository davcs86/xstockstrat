# Feature: live-trading-game-day

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: `feature/live-trading-game-day`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — a quarterly game day assumes an on-call rotation this solo-maintained project doesn't have; the valuable core becomes a manual pre-flight checklist instead |
| 2026-08-06 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Creates and exercises emergency-operations runbooks (unknown order outcome, unprotected position, broker outage, stale/corrupt market data, duplicate order, DB/config/notify outage, compromised credentials, unexpected live strategy activation) run quarterly — or before any material live-capital expansion — as a game day using the feature-103 fault-injection harness, requiring the operator to halt, determine broker truth, cancel/flatten/protect, restore state, produce an incident timeline, and verify safe resumption.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Operational runbook completeness, incident-response process |
| `xstockstrat-trading` owner | Broker-truth reconciliation steps, halt/flatten procedure accuracy |

## Next Action

`/sdd-review live-trading-game-day product-spec` — AI review of product spec before running /sdd-spec
