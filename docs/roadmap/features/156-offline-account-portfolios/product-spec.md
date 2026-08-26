# Product Spec: offline-account-portfolios

**Created**: 2026-08-26

---

## Problem Statement

Every account today is broker-connected: it requires encrypted Alpaca/IBKR credentials, drives a live
`broker.Broker` client, and has its positions/balances/fills synced from the broker by background
pollers. A trader who holds positions in a brokerage the platform does not integrate with (or who
wants to paper-track a strategy by hand) has no way to see that book inside xstockstrat. This feature
adds a manually-tracked **offline account** that reuses the same per-`account_id` portfolio
integrations, where the human (or the MCP agent) supplies the fill information a broker would
otherwise report.

## User Story

As a trader with holdings outside the platform's integrated brokers, I want an offline account whose
orders I confirm by hand, so that its positions and P&L appear alongside my broker accounts using the
same portfolio views.

## Functional Requirements

FR-1. A user can create an **offline account** — an account with no broker credentials and no broker
client — distinguishable from broker accounts (Alpaca/IBKR) by its account source/type.

FR-2. Offline accounts appear alongside broker accounts in every place account portfolios are
surfaced today: the `ListBrokerAccounts` result, the `/trader` account selector, the portfolio
card (`ListPortfolios`), and the positions/orders views — keyed by the same `account_id`.

FR-3. A user can record an order against an offline account without any broker submission; the order
is persisted in `trading.orders` with `account_id` set to the offline account and is **never** routed
to a broker.

FR-4. An offline order's **confirmation** — the fill fields a broker would report (`filled_qty`,
`filled_avg_price`, resulting `status`, and a fill timestamp) — is editable from the `/trader` UI.

FR-5. The same offline order confirmation is editable via an MCP agent tool (create/record the order
and set/edit its fill).

FR-6. Confirming or editing an offline order's fill updates the offline account's positions and P&L
through the **same absolute position-sync path** used for broker position snapshots (the
`account.positions.synced` ledger event consumed by portfolio's `ConsumePositionSyncs`), recomputed
from all the account's confirmed orders so editing is idempotent. **Realized and unrealized P&L and
short (net-negative) positions are in scope** (design decision, 2026-08-26): unrealized/mark-to-market
is derived from marketdata mid-quotes consistently across both the `ListPositions` and `ListPortfolios`
read paths; realized P&L is tracked at account grain and shown on the offline account's portfolio card.
`ConfirmOrder` MUST NOT emit `order.filled` (that would double-count via the incremental fold).

FR-7. Broker-only integrations — the fill poller, position/balance sync poller, credential-health
poller, reconciliation poller, and bracket-protection watchdog — **skip** offline accounts; no live
broker call is ever constructed or issued for an offline account.

FR-8. Order-confirmation edits are rejected for **broker** accounts (a real broker's fills cannot be
hand-edited); the confirmation edit path is offline-only.

## Out of Scope

- Automated/strategy-driven order execution on offline accounts (offline orders are human/agent-entered only).
- Importing or reconciling against a real brokerage statement/CSV (no external ingestion).
- Tax-lot accounting, wash-sale tracking, or multi-currency positions.
- Editing fills of broker (Alpaca/IBKR) accounts (explicitly rejected — FR-8).
- Cash/deposit/withdrawal ledgering for offline accounts beyond what position tracking implies (see Open Questions on equity derivation).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — owns accounts (`trading.broker_accounts`) and orders (`trading.orders`); adds the offline account variant, the "no broker" routing guard, and the order-confirmation write path; must exclude offline accounts from broker pollers.
- `xstockstrat-portfolio` — tracks positions/P&L per `account_id`; must value offline positions consistently across `ListPositions` and `ListPortfolios`.
- `xstockstrat-ui` — `/trader` segment: create-offline-account control, account selector inclusion, order-confirmation edit UI.
- `xstockstrat-agent` — new MCP tool(s) for offline account + order-confirmation editing; currently has **no** trading gRPC client, so one must be wired in.
- `packages/proto` — new account-source representation, order-confirmation RPC (or `ReplaceOrder` extension), and any request/field additions.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: a control to create an offline account, offline
  accounts included in the account selector and portfolio/positions/orders views, and an
  order-confirmation edit control (set fill qty/avg-price/status/time) on offline orders. Reachable
  per **C-10** (the `/trader` subnav is already registered in `PLATFORM_SUBNAV`; no new top-level nav entry expected).
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): a new tool to create/manage an offline account and
  record/edit an offline order's confirmation. Requires adding a trading gRPC client to the agent
  (none exists today).
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- Expected (all **additive / non-breaking** — final shape decided in `/sdd-design`):
  - A way to mark an account as offline: **either** a new `BrokerType` value (e.g. `BROKER_TYPE_OFFLINE = 3`) **or** a dedicated account-source field on `BrokerAccount`/`RegisterBrokerAccountRequest` (design fork — see Open Questions).
  - An order-confirmation write RPC (e.g. `ConfirmOrder`/`SetOrderFill`) on `TradingService`, **or** an extension of `ReplaceOrder` to carry fill fields for offline orders (design fork).
  - `RegisterBrokerAccountRequest.credentials_json` becomes optional for offline accounts.

## Config Key Changes

- [x] No new config keys anticipated. (Broker-poller interval keys already exist; offline accounts are simply excluded from those pollers, needing no new key. Re-confirm at `/sdd-design`.)

## Database Changes

- [ ] No schema changes
- Expected:
  - `xstockstrat-trading`: relax `trading.broker_accounts.credentials_enc` from `NOT NULL` to nullable (offline accounts have no credentials), and/or persist the account source, via migration `008_*`.
  - `xstockstrat-portfolio`: likely **none** — offline positions reuse the existing `portfolio.positions`/`portfolio.account_balances` per-`account_id` schema. Confirm at `/sdd-design` whether offline equity/cash needs a seed row in `portfolio.account_balances` (which is normally upserted from `account.balance.synced`, an event offline accounts never emit — see Open Questions).

## Feature Workflow Notes

Branch to create: `feature/offline-account-portfolios` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — additive proto
- [ ] 2 service owners + platform lead (breaking proto change) — not expected; keep additive
- [x] DBA review + service owner (schema migration) — trading credentials-nullable migration

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

_All resolved in `/sdd-design` (4-round debate, see `design.md` + `context.md` 2026-08-26)._

- [x] **Account-source modeling** → new `BROKER_TYPE_OFFLINE = 3` enum value (single `s.brokers` pool
  with a type-skip flag, not a parallel map).
- [x] **Confirmation mutation shape** → dedicated offline-only `ConfirmOrder` RPC (not a `ReplaceOrder`
  extension).
- [x] **Offline position valuation & equity** → equity derived from position market values
  (marketdata mid-quotes via the shared `enrichPositions`); offline accounts have **no**
  `account_balances` row. **Realized P&L and shorts are in v1** (account-grain realized table;
  signed average-cost fold).
- [x] **MCP scope** → create offline account + record order + confirm order, plus read of the offline
  account's orders/positions (supports the user's monthly statement-reconciliation task, which corrects
  drift via order edits — no separate set-positions capability).
- [x] **Known trap (portfolio dual read path)** → offline valuation lands on both `ListPositions` and
  `buildAccountPortfolio`/`GetPortfolio` via the shared `enrichPositions`; realized parity across
  `ListPortfolios` and `GetPortfolio` with a parity test.
- [x] **Known trap (add-ikbr user_id / deferrals)** → `account.positions.synced` payload carries
  `user_id`; the two deferrals (broker-card realized, `GetPnL` account-blindness) point at **named**
  follow-ups, never a vague "later".
