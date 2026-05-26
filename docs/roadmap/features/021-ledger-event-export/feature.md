# Feature: ledger-event-export

**Lifecycle Status**: `draft`
**Development Branch**: `feature/ledger-event-export`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ledger-event-export`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a streaming export endpoint to the ledger service that produces a structured CSV or JSON file of all events (fills, signals, P&L, config changes) for a given date range and event type filter, enabling tax reporting, manual strategy review, and audit compliance.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety |

## Next Action

`/sdd-review ledger-event-export product-spec` — AI review of product spec before running /sdd-spec
