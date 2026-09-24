# Product Spec: order-time-in-force-enum

**Created**: 2026-09-24

---

## Problem Statement

`Order.time_in_force` (trading proto field 12) is an open free-form `string` populated by the
`/trader` Place Order form and forwarded to the Alpaca/IBKR broker adapters with no
platform-side validation. An unrecognized or mis-cased value ("Gtc", "good_till_cancel",
typos) is only caught — if at all — at the broker boundary, producing an opaque broker
rejection rather than a clear `InvalidArgument` at the edge. The value set is closed and
deployment-time-defined, which the proto-governance rule says should be an enum, not a string.

## User Story

As a trader placing or replacing an order, I want the platform to accept only valid,
broker-supported time-in-force values, so that an unsupported or malformed TIF is rejected
immediately with a clear error instead of failing opaquely at the broker.

## Functional Requirements

FR-1. Define a `TimeInForce` proto enum in the trading contract with a zero-value
`TIME_IN_FORCE_UNSPECIFIED = 0` sentinel and a variant per supported value (at minimum: `DAY`,
`GTC`, `IOC`, `FOK`, `OPG`, `CLS` — final set confirmed at design time against the Alpaca and
IBKR adapters).

FR-2. `PlaceOrder` and `ReplaceOrder` accept the TIF as the `TimeInForce` enum; the trading
service maps the enum to each broker's wire value in the Alpaca/IBKR adapters (replacing the
current string pass-through).

FR-3. The trading service rejects a `PlaceOrder`/`ReplaceOrder` whose TIF is
`TIME_IN_FORCE_UNSPECIFIED` or is a variant the routed broker does not support, returning gRPC
`InvalidArgument` with a message naming the field and the offending value — the order is never
forwarded to the broker.

FR-4. Persisted orders and all read paths (`GetOrder`, `ListOrders`, `StreamOrderUpdates`)
return the TIF as the enum; historical rows whose stored string does not map to a known variant
surface as `TIME_IN_FORCE_UNSPECIFIED` (never a hard error on read).

FR-5. The `/trader` Place Order (and Replace Order) form emits the TIF as the enum's NAME-string
over Connect-JSON, and every exhaustive TS `Record<TimeInForce, …>` / `switch` consuming it is
updated in the same change so the UI build stays green.

## Out of Scope

- Scheduled / deferred / "not-before" order submission (a future timing surface — not this feature).
- Order-lifecycle timing telemetry (intent→submit→fill latency) — separate concern.
- Auto-cancel / expiration guardrails beyond native broker TIF semantics.
- Any new broker or new order type.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — owns `Order`, `PlaceOrder`/`ReplaceOrder`, and the Alpaca/IBKR TIF mapping + validation.
- `xstockstrat-ui` — `/trader` Place Order / Replace Order form emits the TIF; consumes it in order lists/detail.
- `packages/proto` — the `TimeInForce` enum and the `PlaceOrderRequest`/`ReplaceOrderRequest`/`Order` field wiring.

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/trader` — the Place Order and Replace Order forms
  select the TIF; order list/detail render it. Reachable per **C-10** (already-registered `/trader` nav).
- [ ] **Agent** — no `xstockstrat-agent` MCP order-placement tool consumes TIF today (agent tools do not
  place orders); if that changes at design time, add the tool surface here.
- [ ] **None**.

## Proto Contract Changes

- New `TimeInForce` enum (with `TIME_IN_FORCE_UNSPECIFIED = 0`).
- `PlaceOrderRequest`, `ReplaceOrderRequest`, and `Order` carry the TIF as `TimeInForce`.
- **Field-strategy fork (design decision — see Open Questions):** changing the existing `Order`
  string field 12 to an enum in place is **wire-breaking** and would need the breaking-proto gate
  (2 owners + platform lead). The additive alternative — add a new enum field, deprecate the string
  field, dual-write during rollout — is non-breaking (1 owner). Decide at `/sdd-design`.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- No new tables. The stored `time_in_force` column stays a string on disk; only its proto
  surface becomes an enum, with an enum↔string mapping at the repository edge (unmapped legacy
  strings read back as `TIME_IN_FORCE_UNSPECIFIED` per FR-4). Confirm at `/sdd-design` whether a
  backfill/normalization migration is warranted or whether read-time mapping suffices.

## Feature Workflow Notes

Branch to create: `feature/order-time-in-force-enum` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — applies if the **additive** field strategy is chosen.
- [ ] 2 service owners + platform lead (breaking proto change) — applies if field 12 is **converted in place**.
- [ ] DBA review + service owner (schema migration) — only if a backfill migration is added.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Field strategy (proto):** convert `Order`/request field 12 string→enum in place (wire-breaking,
  2 owners + lead) vs add a new enum field and deprecate the string (additive, 1 owner)? Decide at design.
- [ ] **Exact variant set:** confirm the enum variants against what the Alpaca and IBKR adapters actually
  accept (e.g. does IBKR support `OPG`/`CLS`? are there broker-only variants?).
- [ ] **Per-broker support matrix:** which variants are valid per broker — the FR-3 rejection needs a
  broker→{allowed TIFs} map. Where does it live (adapter constant vs config)?
- [ ] **Known trap (ledger fails.md:81–83, F-C-10):** a proto enum is never backend-only — every
  exhaustive TS `Record<TimeInForce,…>` / `switch` (and any Go/Python consumer) must be updated in the
  same PR, verified by a frontend build. And per fails.md:677–679, the UI must send the enum as a
  NAME-string over Connect-JSON, not a numeric value.
