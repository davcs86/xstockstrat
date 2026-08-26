# Context: offline-account-portfolios

**Feature**: `docs/roadmap/features/156-offline-account-portfolios/feature.md`
**Product Spec**: `docs/roadmap/features/156-offline-account-portfolios/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/156-offline-account-portfolios/implementation-spec.md`

---

## Session 2026-08-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story: "Offline account portfolio tracking, same integrations as current account portfolios. Order
  confirmations are editable by UI or MCP."

### Grounding (codebase-discovery, 2 subagents)

- **Accounts** live in `xstockstrat-trading` as `BrokerAccount` (`packages/proto/trading/v1/trading.proto:197`,
  table `trading.broker_accounts` via `migrations/002_broker_accounts.up.sql`). The only account
  discriminator today is the `BrokerType` provider enum (`packages/proto/common/v1/common.proto:68`:
  `ALPACA=1`, `IBKR=2`). `credentials_enc` is `NOT NULL`; `RegisterBrokerAccount` requires
  `credentials_json`; `resolveAccount`/pollers assume a live `broker.Broker` client per account
  (`internal/service/trading.go` broker pool `s.brokers`, `instantiateBrokerLocked:2413`,
  `syncPositions:1731`). **No offline/manual account type exists.**
- **Integrations** = the per-account `broker.Broker` client (`internal/broker/broker.go:66`) driven by
  background pollers (fill/position/balance/credential-health/reconciliation), which emit ledger
  events `order.filled`, `account.positions.synced`, `account.balance.synced`.
- **Portfolio** (`xstockstrat-portfolio`) is ledger-sourced: positions/P&L per `account_id` from
  `ConsumeOrderFills`/`ConsumePositionSyncs`/`ConsumeBalanceSyncs`. Tables `portfolio.positions`
  (account_id since `003_positions_account_id`, default `'alpaca-default'`), `portfolio.account_balances`
  (`004_account_balances`). RPCs `ListPositions`, `ListPortfolios`, `GetPnL`, etc.
- **Orders** (`trading.orders`, `migrations/001_orders_hypertable`): a fill is represented on the Order
  via `filled_qty`/`filled_avg_price` + `status`; fills arrive **async from the broker** (`pollFills`).
  **There is no "order confirmation" concept** — no `ConfirmOrder` RPC, no `CONFIRMED` status, no
  confirmations table. `ReplaceOrder` edits a *working* order's qty/limit/stop/TIF (broker-routed) and
  is not a fill-write. UI order surface already exists: `/trader/orders` (`OrderForm`, `OrdersTable`,
  `EditOrderDialog` → `useReplaceOrder`), BFF `src/lib/traderBff.ts`.
- **MCP agent** (`xstockstrat-agent/app/tools.py`, 28 tools) has **no order-management tool** and **no
  trading gRPC client / `TRADING_ENDPOINT`** — "editable by MCP" requires wiring a trading client +
  new tool into the agent (and the tool-count sync across the six inventory surfaces per the agent
  reviewer focus).

### Design forks deferred to /sdd-design (recorded as Open Questions)

1. Offline as a new `BrokerType` value vs. a separate account-source field.
2. Order-confirmation write as a new `ConfirmOrder`/`SetOrderFill` RPC vs. extending `ReplaceOrder`.
3. Offline position valuation source (marketdata mid-quotes) and how offline equity/cash is seeded
   (`portfolio.account_balances` is normally fed by `account.balance.synced`, never emitted offline).
4. MCP scope: full offline-account CRUD vs. order-confirmation editing only.

### Known traps folded into the spec (from docs/roadmap/ledger/fails.md)

- Dual valuation read paths (`ListPositions` vs `ListPortfolios`/`buildAccountPortfolio`) must both
  handle offline valuation — a prior feature added valuation to only one and they silently disagreed
  (fails.md 2026-08-06, feature 056).
- No unfixed "follow-up" gaps — `add-ikbr-account-support` left a documented gap (missing `user_id` in
  a synced payload) that became a production bug (fails.md 2026-08-05).
- Verify proto fields exist server-side before forwarding them (fails.md 2026-08-05, broker-accounts-ui).

### SDD entry-point compliance

Per root CLAUDE.md "Mandatory Entry Point": running `/sdd-story` → next `/sdd-design quick` before any
code. This task arrived as a plain "implement X, commit and push"; treated as a request for the
capability, not a waiver of the pipeline.
