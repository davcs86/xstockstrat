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
through the **same** portfolio path used for broker-synced fills (the `order.filled` ledger event
consumed by portfolio's `ConsumeOrderFills`), so no separate offline-only valuation path is
introduced. The mark-to-market a broker would supply (`current_price`/`unrealized_pnl`) is derived
consistently across both the `ListPositions` and `ListPortfolios` read paths (see Known Trap).

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

- [ ] **Account-source modeling (design fork):** add `BROKER_TYPE_OFFLINE` to the existing
  `BrokerType` enum (least-effort mirror — routing/pollers already switch on `broker_type`), or add a
  separate account-source/`is_offline` field so "offline" is orthogonal to the broker/provider axis?
  Platform Lead + Proto Reviewer to weigh in at `/sdd-design`.
- [ ] **Confirmation mutation shape (design fork):** a dedicated `ConfirmOrder`/`SetOrderFill` RPC vs.
  extending `ReplaceOrder`. Note `ReplaceOrder` today is broker-routed and only edits *working* orders
  (NEW/PARTIALLY_FILLED) qty/limit/stop/TIF — a fill confirmation writes `filled_qty`/`filled_avg_price`/
  `status`, which is a different operation and must not touch a broker.
- [ ] **Offline position valuation & equity:** offline positions have no broker mark-to-market. Is
  `current_price`/`unrealized_pnl` pulled from `xstockstrat-marketdata` mid-quotes (as `ListPositions`
  already does), and is offline account **equity/cash** derived from positions, or does the user enter
  a starting cash balance? `portfolio.account_balances` is normally fed by `account.balance.synced`,
  which offline accounts never emit — decide how the balance row is seeded.
- [ ] **MCP scope:** should the agent tool cover full offline-account CRUD (create/deactivate) or only
  order recording + confirmation editing? Scope to the minimum the story needs.
- [ ] **Known trap (fails.md 2026-08-06, portfolio dual read path):** valuation added only to
  `ListPortfolios`/`buildAccountPortfolio` once silently disagreed with `ListPositions`. Offline
  valuation must be applied to **both** paths in this feature — call it out in the impl spec.
- [ ] **Known trap (fails.md 2026-08-05, add-ikbr-account-support):** a documented "follow-up" gap
  (missing `user_id` in a synced payload) shipped and became a production bug. Any offline-only
  deferral here must point at a named follow-up feature, never a vague "later" (C-14).
