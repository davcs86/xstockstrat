# Feature: exactly-once-order-intent

**Lifecycle Status**: `draft`
**Priority**: `P1` — rescoped 2026-08-04 to the trader UI's real order flow, not hypothetical
scheduler/agent callers (see context.md); not `P0` because the risk today is bounded by a human
watching the UI, unlike an unattended caller
**Development Branch**: `feature/exactly-once-order-intent`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` (rescoped) | feasibility re-check | Scope cut to the trader UI's real place/replace/cancel flow; `close`/`emergency-flatten` and automated `UNKNOWN` reconciliation deferred; see context.md |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec exactly-once-order-intent`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduces a durable order-intent record in `xstockstrat-trading` (platform-generated intent ID, deterministic broker client-order ID, request hash, lifecycle state, retry/uncertainty tracking) so the trader UI's place/replace/cancel calls — the only order flow that exists today — execute at most once despite network retries, timeouts, or a service restart on this single-instance, no-HA deployment.

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
