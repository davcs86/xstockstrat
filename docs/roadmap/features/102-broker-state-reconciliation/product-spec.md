# Product Spec: broker-state-reconciliation

**Created**: 2026-08-04
**Rescoped**: 2026-08-04 — demoted, then revived after user review; scope cut from a continuous
reconciliation engine + dashboard to a lightweight periodic ticker inside `xstockstrat-trading` itself
(see context.md for the full back-and-forth)

---

## Problem Statement

`xstockstrat-trading` is the only service holding broker credentials (`internal/broker/alpaca.go`,
`internal/broker/ibkr.go`), runs as a single instance with no HA, and nothing today checks that its
own idea of open orders/positions still matches the broker's. A manual order placed directly through
the broker's own dashboard, a missed fill event, or state lost across a crash/redeploy can drift
silently — and today the only backstop is a human noticing it by eye. That backstop is real (a human
places and watches every order via the trader UI today — see `101`'s context.md), but it's thin: it
depends on the operator actually opening both UIs side by side.

## User Story

As the platform, I want a periodic, cheap check that compares `xstockstrat-trading`'s own record of
open orders and positions against the broker's live state, so that drift is caught and either
self-healed or escalated (via the rescoped `100` kill switch) without requiring an operator to
eyeball two dashboards.

## Functional Requirements

FR-1. A periodic ticker inside `xstockstrat-trading` (a Go `time.Ticker`-driven background loop in the
existing service process — no new service, no new deployment) runs on a config-driven interval and,
per broker account: lists open orders and positions from the broker (via the existing `alpaca.go`/
`ibkr.go` clients) and compares them against `xstockstrat-trading`'s/`xstockstrat-portfolio`'s own
records.

FR-2. Classify each mismatch into a small, honest set: benign propagation delay (broker hasn't caught
up yet — retry next tick), quantity discrepancy, unknown broker order (exists at broker, not in
platform), missing broker order (exists in platform, not at broker), or unprotected/impossible state.
**A broker order in `ORDER_STATUS_PARTIALLY_FILLED` is not, by itself, a mismatch** — it's a routine,
expected intermediate state (`packages/proto/trading/v1/trading.proto:73`). "Quantity discrepancy"
means the platform's expected remaining quantity disagrees with the broker's reported remaining
quantity *after* the propagation-delay window (FR-2's first bucket) has elapsed — not that the order
is merely partially filled. This distinction is what keeps FR-4's halt-on-discrepancy from firing on
every routine partial fill.

FR-3. Self-heal only propagation-delay-class mismatches automatically (they resolve themselves within
a tick or two by definition). Every other mismatch class is recorded, never silently corrected.

FR-4. For a mismatch that isn't self-healing, halt exposure-increasing trading via the rescoped `100`
kill switch (`REDUCE_ONLY`, not `HALTED`, unless the mismatch is severe — decide the exact mapping at
`/sdd-design`) and emit an alert via the existing `xstockstrat-notify` `EmitAlert`.

FR-5. Every correction and every unresolved mismatch is written as a ledger event (reusing the existing
append-only `AppendEvent` RPC, `stream_key = "reconciliation:{account}"`) — what was found, what (if
anything) was changed, and which tick found it. No new database table.

FR-6. This same tick resolves an `UNKNOWN` order intent from the rescoped `101` against the broker's
own order list — the one piece of "automated `UNKNOWN` resolution" `101`'s spec explicitly deferred to
this feature.

## Out of Scope

- A dedicated operator dashboard visualizing reconciliation history/trends — no new UI page for this
  pass; a minimal existing-surface status read (see Consumer Surface) is enough. A fuller dashboard was
  `108`, itself demoted — revisit together if ever justified.
- Reconciling account-level trading status, buying power, and average entry price beyond orders/
  positions — the review's original ask was broader; this pass covers the two entities that actually
  drift in practice on a single-instance, human-initiated-order platform. Extend at `/sdd-design` if
  a concrete gap shows up.
- A severity taxonomy as elaborate as the original review's seven-class list — three or four honest
  buckets (FR-2) are enough for a system with one order-placing caller; add more only if a real
  mismatch class shows up that doesn't fit.

## Affected Services

- `xstockstrat-trading` — owns the ticker, the broker-vs-platform comparison, and the ledger writes.
- `xstockstrat-notify` — mismatch alerting (existing `EmitAlert`, no change needed).
- `xstockstrat-portfolio` — FR-1 compares against `xstockstrat-portfolio`'s own position records, a
  read dependency (no write access assumed).
- `xstockstrat-ui` — the `/trader` account/positions view surfaces reconciliation recency and status
  (see Consumer Surface(s)).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — a minimal addition to the *existing* `xstockstrat-ui` `/trader` account/positions view:
  "last reconciled: Xs ago" plus a visible marker if the last tick found an unresolved mismatch. Not a
  new page.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [ ] Likely none — the reconciliation status can ride on an existing `GetPortfolio`/order-status RPC
  response as an added field, rather than a new RPC. Confirm at `/sdd-design`.
- **Parity note (C-10(b)):** FR-1 reconciles both orders (`trading.GetOrder`/`ListOrders`) and
  positions (`portfolio.GetPortfolio`/`ListPositions`/`ListPortfolios`) — two separate RPC families.
  `/sdd-design` must state which read path(s) carry the reconciliation-status field(s) — e.g. an
  order-side field on `Order` and a position-side field on `Position` — rather than adding it to only
  one and leaving the other inconsistent (this exact trap is recorded in
  `docs/roadmap/ledger/fails.md`, 2026-07-01).

## Config Key Changes

- `trading.reconciliation.interval_seconds` (config-driven tick interval, e.g. default 60) —
  exact key finalized at `/sdd-spec`.

## Database Changes

- [x] No schema changes — reconciliation results are ledger events (existing `AppendEvent`), not a new
  table.

## Feature Workflow Notes

Branch to create: `feature/broker-state-reconciliation` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration) — not applicable, no schema change

## Acceptance Criteria

1. Placing an order directly through the broker's own dashboard is detected within one tick interval
   and recorded as a ledger event.
2. A benign propagation-delay mismatch resolves itself within a tick or two without operator action.
3. A quantity/unknown/missing-order mismatch halts exposure-increasing trading (via rescoped `100`) and
   alerts, rather than being silently corrected.
4. An `UNKNOWN` order intent from `101` is resolved against broker truth by this same tick.
5. The `/trader` view shows reconciliation recency and current status.

## Open Questions

- [ ] Does the reconciliation ticker belong in `xstockstrat-trading` alone, or does it also need a
  cheap positions/cash check against `xstockstrat-portfolio`? Lean toward trading-only for this pass
  (it's the service with broker credentials); flag at `/sdd-design` if portfolio drift turns out to be
  a real, separate risk.
- [ ] Exact tick interval — balance "catches drift promptly" against "extra broker API calls on a
  free/low-tier Alpaca/IBKR plan." Flag for `/sdd-design`.
- [ ] `xstockstrat-trading` already runs two other broker-polling loops (`pollFills`,
  `trading.risk` config key `trading.fill_poller.interval_ms`, and `syncPositions`,
  `trading.position_sync.interval_ms` — both documented in `services/xstockstrat-trading/CLAUDE.md`).
  Is this feature's ticker a genuinely distinct concern from those two, or should it fold into one of
  them (and if distinct, where does it live in the codebase — same file or a new one)? **Decide at
  `/sdd-design`.**
