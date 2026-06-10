# Feature: open-positions-ui

**Lifecycle Status**: `idea`
**Development Branch**: `feature/open-positions-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog; no spec yet |

---

## Artifacts

_None yet — run `/sdd-story open-positions-ui` to generate the product spec._

---

## Summary

A dedicated `xstockstrat-ui` (trader segment) page for viewing open positions:

- **Open positions list** with pagination and filters (by ticker/symbol, side
  long/short, account/broker, and P&L sign).
- Per-position detail: quantity, avg entry price, current price, market value,
  unrealized P&L (%/$), cost basis.
- **Position slots ↔ orders exploration**: investigate the ability to associate position
  "slots" with the orders that opened/added to them — i.e. trace a position back to its
  constituent fills/orders. Determine whether this lineage already exists in
  `xstockstrat-portfolio` / `xstockstrat-ledger` or requires new modeling.

Backend: consumes `xstockstrat-portfolio` (gRPC 50052) for position tracking and P&L, and
potentially `xstockstrat-trading` / `xstockstrat-ledger` for order lineage. Reuses the UI
BFF/connect-web call chain and header propagation.

## Open Questions (for /sdd-story)

- Does `xstockstrat-portfolio` expose a paginated/filterable list-positions RPC today, or
  is a proto change needed?
- "Position slots" — is this an existing concept anywhere in the platform, or a new
  abstraction to design? Define what a slot is and its order linkage before specing.
- Order-lineage join: portfolio positions vs. ledger fill events — confirm the source of
  truth for mapping fills to a position.

## Next Action

Run `/sdd-story open-positions-ui` to generate a product spec, then
`/sdd-review open-positions-ui product-spec`.
