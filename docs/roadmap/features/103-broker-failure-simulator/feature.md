# Feature: broker-failure-simulator

**Lifecycle Status**: `draft`
**Development Branch**: `feature/broker-failure-simulator`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec broker-failure-simulator`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Builds a programmable, scriptable broker adapter for `xstockstrat-trading` integration tests that deterministically reproduces broker failure modes (dropped responses, duplicate/out-of-order fills, partial fills, cancel/replace races, market-closed, insufficient buying power, rate limiting, auth expiry, malformed fields) so downstream safety features (idempotency, reconciliation, crash-consistency, state-machine invariants) have credible, repeatable verification.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection |
| Platform Lead | Test-infrastructure architecture, no change to production broker-adapter contract |

## Next Action

`/sdd-review broker-failure-simulator product-spec` — AI review of product spec before running /sdd-spec
