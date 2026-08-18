# Feature: trading-safety-dashboard-slos

**Development Branch**: `feature/trading-safety-dashboard-slos`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` → `demoted/canceled` | feasibility re-check | See context.md — the platform already has a Grafana Cloud/OTel dashboard mechanism (feature 033); a few new panels there are far cheaper than a new xstockstrat-ui page |
| 2026-08-06 | `demoted/canceled` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 1 specs |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver 2026-08-06; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a dedicated Trading Safety dashboard (`xstockstrat-ui`) surfacing unprotected-position count/age, order-intent state distribution (especially `UNKNOWN`), reconciliation mismatches, broker RPC latency/failure rate, rejection rate by reason, fill-to-protection latency, halt state/trigger, market-data freshness, and exposure-vs-limit, with defined SLOs (protection window, unknown-command resolution, reconciliation cadence, alert delivery/ack time) backed by the instrumentation the P0 safety features (100–106) emit.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no secret values rendered |
| `xstockstrat-notify` owner | Stream delivery guarantees, alert deduplication |
| Platform Lead | Cross-service instrumentation dependency, OTel/Grafana alignment |

## Next Action

`/sdd-review trading-safety-dashboard-slos product-spec` — AI review of product spec before running /sdd-spec
