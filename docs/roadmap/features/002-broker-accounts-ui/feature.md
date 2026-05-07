# Feature: broker-accounts-ui

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/broker-accounts-ui`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06T00:00:00Z

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-06 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 advisory warnings) |
| 2026-05-06 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 9 steps; generated 2026-05-06
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Surfaces registered broker accounts and per-account portfolio data in the `xstockstrat-trader` UI, completing the UI half of the `add-ikbr-account-support` feature which added backend RPCs but explicitly deferred all frontend changes.

## Reviewers

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the reviewer registry changes.)_

| Step(s) | Role | Review Focus |
|---|---|---|
| 1, 2, 3, 4, 5, 6, 8 | `xstockstrat-trader` service owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| 7, 9 | `xstockstrat-insights` service owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review broker-accounts-ui impl-spec` — validate implementation spec, then `/sdd-execute broker-accounts-ui`
