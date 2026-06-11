# Feature: orders-management-ui

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/orders-management-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved; 5 open questions resolved (replace=Alpaca+IBKR, all 5 order types, StreamOrderUpdates, server-side filters, account_id filter); C-2/C-4/C-5 trading-domain gaps closed |
| 2026-06-11 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-06-11 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode (055→056→057, one-feature-at-a-time); Step 1 (proto ReplaceOrder + ListOrders filters) complete |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 11 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A dedicated trader-segment UI page for full order lifecycle management — create, edit
(replace), and cancel orders, plus a paginated, filterable historical order view — backed
by the existing `xstockstrat-trading` gRPC service (with an additive `ReplaceOrder` RPC and
extra `ListOrders` filter fields).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if
the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only changes (new `ReplaceOrder` RPC + `ListOrders` filter fields), `buf lint`/`buf breaking` pass |
| `xstockstrat-trading` (service owner) | Order execution correctness, broker API safety (replace/cancel), fill detection, paper-only dev invariant, position-limit enforcement |
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, environment/trading-mode scope correctness, no secret values rendered |

## Next Action

`/sdd-review orders-management-ui impl-spec` — validate implementation spec, then `/sdd-execute orders-management-ui`
