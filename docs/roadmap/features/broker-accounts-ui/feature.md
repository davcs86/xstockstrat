# Feature: broker-accounts-ui

**Lifecycle Status**: `draft`
**Development Branch**: `feature/broker-accounts-ui`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-06 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec broker-accounts-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trader` service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| `xstockstrat-insights` service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review broker-accounts-ui product-spec` — AI review of product spec before running /sdd-spec
