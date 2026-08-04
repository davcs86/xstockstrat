# Feature: exactly-once-order-intent

**Lifecycle Status**: `draft`
**Development Branch**: `feature/exactly-once-order-intent`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec exactly-once-order-intent`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduces a durable order-intent record in `xstockstrat-trading` (platform-generated intent ID, deterministic broker client-order ID, request hash, lifecycle state, retry/uncertainty tracking) so a logical order intent — place, replace, cancel, close, or emergency flatten — executes at most once despite network retries, timeouts, or service restarts.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| DBA | Migration NNN numbering, up+down pair present, hypertable partitioning strategy, index correctness |
| Platform Lead | Cross-service architecture, inter-service dependency graph correctness |

## Next Action

`/sdd-review exactly-once-order-intent product-spec` — AI review of product spec before running /sdd-spec
