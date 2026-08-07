# Recon: stop-loss-bracket-orders

**Created**: 2026-08-05
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-notify, xstockstrat-portfolio, xstockstrat-ui, xstockstrat-config

---

## Objective

Automatically submit a stop-loss (and optional take-profit) bracket order at the broker when a
position opens, using the stop price computed by feature 023's `ComputePositionSize`, so open
positions are protected without platform uptime or human intervention — and cancel both bracket legs
if the position closes via signal before either triggers.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:129`
  - Fill detection: `pollFills`, `services/xstockstrat-trading/internal/service/trading.go:652`; the
    `ORDER_STATUS_FILLED` branch at `trading.go:731-740` is where a bracket-submission hook would be
    added (currently emits a ledger `order.filled` event + `emitFillAlert`, nothing else)
  - `PlaceOrder` can also produce an immediate fill on submit (market orders), `trading.go:363-370` —
    a second fill-confirmed path FR-1 needs to account for, not just `pollFills`
  - Broker submission: `buildBrokerRequest`, `trading.go:1342`; `broker.OrderRequest` struct (no
    bracket/stop_loss/take_profit/OCA fields), `internal/broker/broker.go:79-97`
  - `CancelOrder`: `trading.go:387`; `ReplaceOrder`: `trading.go:433` (only for
    `ORDER_STATUS_NEW`/`PARTIALLY_FILLED`, `trading.go:452-458`) — no bracket-leg-aware cancel exists
  - Alpaca client: `internal/broker/alpaca.go:95` (`SubmitOrder`) — no `order_class`/`stop_loss`/
    `take_profit` sub-fields; native bracket support **not implemented**
  - IBKR client: `internal/broker/ibkr.go:116` (`SubmitOrder`) — no `parentId`/`ocaGroup`/`ocaType`
    keys anywhere in the file; OCA-group submission **not implemented** (confirms product-spec's OQ-1)
  - Notify client (reuse target): already wired, `trading.go:24,67,107-109,122`
  - `emitApprovalAlert` (WARNING) / `emitFillAlert` (INFO) — reusable `EmitAlert` call pattern,
    `trading.go:1441,1455`; no `ALERT_SEVERITY_CRITICAL` emission exists yet in this service — FR-6
    would be the first
  - Config-read idiom: `s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05)`, `trading.go:1292`
  - Last migration: `004_broker_accounts_credential_status` (next would be `005`)

- **`xstockstrat-portfolio`** (Go)
  - `Position` message, full field list confirmed: `packages/proto/portfolio/v1/portfolio.proto:43-76`
    — highest existing field is `19` (`exit_rule`); `stop_order_id`/`take_profit_order_id` genuinely
    new, next free field is **20**
  - Existing `stop_price` (field 14, feature 083) — **in-memory only**, never persisted: populated
    from `order.filled` ledger events carrying a stop/stop-limit order's `StopPrice`
    (`internal/service/portfolio_service.go:226-229,252-253`), held in an in-memory `stopStore`
    (`portfolio_service.go:52-77`), rebuilt on boot via `HydrateStops` ledger replay
    (`portfolio_service.go:377-413`), applied at read-time via `applyStopRisk`
    (`portfolio_service.go:364-375`)
  - No existing DB column or repo method stores a broker order ID on `portfolio.positions`
    (`UpsertPosition`, `internal/repository/portfolio_repo.go:43`, has no such param)
  - Last migration: `008_watchlist_symbol_strategy` (next would be `009`)

- **`xstockstrat-notify`** (Node)
  - `EmitAlert` RPC + `ALERT_SEVERITY_CRITICAL = 4`: `packages/proto/notify/v1/notify.proto:13-14,42-48`
  - Server handler requires non-empty `title`/`body` (F-10 validation):
    `src/grpc/notifyServiceImpl.ts:30-103`
  - Not role-gated (private-network trust): `services/xstockstrat-notify/CLAUDE.md:38-50`

- **`xstockstrat-config`** (Node)
  - Latest migration: `010_config_audit_insert_trigger` — **`011` is contested**: feature 023
    (position-sizing-engine) also plans a migration `011_trading_risk_sizing` but is
    `design-approved`, not yet implemented — no `011_*` file exists on trunk today. Whichever of
    023/030 merges first claims `011`; the other becomes `012`.
  - Seed-migration template: `008_analysis_fundsignal_keys.up.sql` (per-env rows, `ON CONFLICT DO
    NOTHING`); its own header comment documents this exact numbering-coordination convention
  - Neither `trading.risk.bracket_orders_enabled` nor `trading.risk.take_profit_rr_multiple` exist
    anywhere in the repo today

- **`xstockstrat-ui`** (Next.js)
  - `AlertStream.tsx` renders alerts generically by numeric `severity` (1-4), no per-category/reason
    branching (`services/xstockstrat-ui/src/components/trader/AlertStream.tsx:11-18,85-93`) — **no
    component change needed** for FR-6's CRITICAL alert, just a new category/body from
    `xstockstrat-notify`
  - Position detail page (feature 096) **already exists** despite `feature.md` still saying
    `implementation-ready` (context.md records it was implemented directly):
    `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:45` (`PositionDetailPage`) —
    natural insertion point for `stop_order_id`/`take_profit_order_id` is the existing "Risk & exit"
    sidebar block (`page.tsx:409-447`) that already reads `stopPrice`/`stopDistancePct`/`riskAtStop`
  - `Position.stop_price` already renders in 3 places today: Exposure list
    (`app/trader/positions/page.tsx:343`), Exposure row-click Sheet (`:451-453`), and the 096 detail
    page (multiple sites)
  - e2e fixtures: `POSITION_AAPL`/`POSITION_MSFT` (`e2e/fixtures/positions.ts:15-48`) — extend these
    with `stopOrderId`/`takeProfitOrderId` per C-13 (second-consumer rule), don't create new files.
    Alerts fixtures are not yet centralized (`INVENTORY.md:52`) — inline mock data is compliant.

## Patterns to REUSE

- Bracket CRITICAL alert → reuse `emitApprovalAlert`/`emitFillAlert`'s `EmitAlert` call shape
  (`trading.go:1441,1455`) — same client, same request fields, new `Severity: ALERT_SEVERITY_CRITICAL`.
- Config-key seed migration → follow `008_analysis_fundsignal_keys.up.sql`'s pattern, **and add the
  same numbering-coordination header comment** it uses, given the live 023/030 migration-011 race.
- Position-detail UI insertion → extend feature 096's existing "Risk & exit" sidebar
  (`page.tsx:409-447`), not a new component.
- e2e tests → extend `POSITION_AAPL`/`POSITION_MSFT` fixtures, not new files (C-13).
- Config-read idiom → `s.cfgW.Get<Type>("<ns>.<key>", <default>)`, `trading.go:1292`.

## Dependencies

- Proto/RPC: `Position` message gains `stop_order_id`/`take_profit_order_id` (fields 20-21,
  additive) — `packages/proto/portfolio/v1/portfolio.proto`. `trading.proto` likely needs new
  bracket/OCA-related fields on `PlaceOrderRequest`/`Order` (exact shape unresolved — product-spec's
  own Proto Contract Changes section never named `trading.proto`, only `portfolio.proto`; flag for
  `/sdd-design`).
- Migration: `xstockstrat-portfolio` next is `009` (bracket order-ID columns); `xstockstrat-config`
  next is `011`, **contested with feature 023** — coordinate merge order or pick a number that
  survives either ordering (e.g. reserve `012` explicitly, or require 023 to merge first).
- Config keys: `trading.risk.bracket_orders_enabled`, `trading.risk.take_profit_rr_multiple` (both
  new).
- Inter-service edges: none new — `xstockstrat-trading→xstockstrat-notify` (existing, reused),
  `xstockstrat-trading→broker` (Alpaca/IBKR, existing clients, new bracket/OCA payload fields).
- New env vars: none.

## Risks / Not-found

- **Hard sequencing blocker (new, from recon): 030 cannot be scoped against real `trading.go` line
  numbers today.** Feature 023 is `design-approved` only — `ComputePositionSize` and its planned
  `PlaceOrder` statement-order rewrite (`023/design.md:32-71`) do not exist in code yet. 030's design
  must be grounded in 023's `design.md` (the planned order), not the current `trading.go:242-385`
  order, and `/sdd-spec` for 030 should not be run until 023 reaches at least `implementation-ready`
  with real line numbers — otherwise 030's implementation spec would cite phantom evidence.
- **Neither broker client supports bracket/OCA orders today.** Alpaca's native `order_class:
  "bracket"` JSON shape and IBKR's `ocaGroup`/`parentId` fields are both entirely absent from
  `alpaca.go`/`ibkr.go` — this is new client-layer code on both sides, not a config toggle.
- **No existing fill-confirmed hook point beyond the `pollFills` FILLED branch and `PlaceOrder`'s
  own immediate-fill path** (market orders can fill synchronously at submission,
  `trading.go:363-370`) — FR-1 needs to trigger from *both* paths, not just the poller.
- **No cancel-and-replace state machine pattern exists anywhere in this service** — product-spec's
  OQ-2 (blocking vs. best-effort bracket cancellation, and the close-vs-stop race) has no existing
  precedent to build on; this is greenfield design work for `/sdd-design`.
- **`trading.risk.max_position_pct` vs `max_concentration_pct` reconciliation, and the
  `Position.stop_price` vs new `stop_order_id`/`take_profit_order_id` reconciliation** — both already
  named in product-spec.md as `/sdd-design` questions; recon confirms both existing mechanisms are
  real, current code (not stale claims).
- **Migration-011 coordination risk** — see Dependencies above; a real merge-order collision if both
  023 and 030 land without explicit sequencing.
- fails.md **C-10(b)** (2026-07-01, 056-open-positions-ui) — the `Position.stop_price` (ledger-derived
  estimate) vs. new `stop_order_id`/`take_profit_order_id` (persisted, broker-confirmed) is exactly
  this pattern; `/sdd-design` must state how they reconcile, not leave two silently-diverging notions
  of "the position's stop."
- fails.md **2026-08-05** (023-position-sizing-engine) — the "convenient-but-semantically-wrong field"
  trap: when wiring `stopPrice` from 023's `ComputePositionSize` into a bracket order, confirm it's
  genuinely a broker-submittable trigger price (023's design explicitly marks it "informational only"
  for MARKET/LIMIT orders) and not conflated with `req.StopPrice`'s existing real-broker-trigger
  meaning for STOP-family orders.

## Recommended Scope

Advisory only — not binding.

1. `xstockstrat-config`: migration seeding `trading.risk.bracket_orders_enabled`/
   `take_profit_rr_multiple` — number coordinated against 023's `011`.
2. `xstockstrat-portfolio`: migration `009` adding `stop_order_id`/`take_profit_order_id` columns +
   proto fields 20-21; reconcile with existing `stop_price` (design decision).
3. `xstockstrat-trading`: extend `broker.OrderRequest`/`Broker` interface with bracket/OCA fields;
   implement Alpaca native bracket submission and IBKR OCA-group submission.
4. `xstockstrat-trading`: hook bracket submission into both fill-confirmed paths (`pollFills` FILLED
   branch and `PlaceOrder`'s immediate-fill path) — grounded against 023's *planned* statement order,
   not current line numbers, until 023 lands.
5. `xstockstrat-trading`: CRITICAL alert on bracket-submission failure, reusing the `EmitAlert`
   pattern.
6. `xstockstrat-trading`: bracket-leg cancellation on signal-driven close (cancel-and-replace state
   machine — greenfield, per OQ-2).
7. `xstockstrat-ui`: extend feature 096's position-detail "Risk & exit" sidebar with the new fields.
8. Tests per C-08/C-13 pairing at each service step.
