# Feature: orders-management-ui

**Lifecycle Status**: `idea`
**Development Branch**: `feature/orders-management-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog; no spec yet |

---

## Artifacts

_None yet — run `/sdd-story orders-management-ui` to generate the product spec._

---

## Summary

A dedicated `xstockstrat-ui` (trader segment) page for managing orders end-to-end:

- **Create** new orders (market/limit, buy/sell, qty/notional, time-in-force) via the
  `xstockstrat-trading` gRPC API.
- **Edit** working/open orders (e.g. replace price/qty) where the broker and order state
  allow it.
- **Cancel** open orders.
- **Historical view**: paginated order history with filters (by ticker/symbol, side,
  order type, status, date range, and account/broker).

Backend: consumes `xstockstrat-trading` (gRPC 50051) for order lifecycle and history; uses
the existing UI BFF/connect-web call chain and header propagation (`x-user-id`,
`x-access-scope`, `x-trace-id`). Pagination should follow the platform's existing
list/pagination conventions (cf. ingest `QuerySignals` pagination).

## Open Questions (for /sdd-story)

- Which order mutations does the current `xstockstrat-trading` proto already expose
  (create/replace/cancel/list)? Identify gaps that need proto changes (PR to `packages/proto`
  first, governance gate).
- Does order history live in trading's DB or must it be read from `xstockstrat-ledger`?
- Account/broker filter scope — relates to `002-broker-accounts-ui` (launched).

## Next Action

Run `/sdd-story orders-management-ui` to generate a product spec, then
`/sdd-review orders-management-ui product-spec`.
