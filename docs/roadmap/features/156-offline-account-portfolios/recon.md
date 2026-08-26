# Recon: offline-account-portfolios

**Created**: 2026-08-26
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-ui, xstockstrat-agent, packages/proto

---

## Objective

Add an **offline account** — a manually-tracked account variant with no broker credentials and no
`broker.Broker` client — that reuses the existing per-`account_id` portfolio integrations (positions,
P&L, portfolio cards, orders/positions pages). Because no broker reports fills, an offline order's
**confirmation** (fill qty/avg-price/status/fill-time) is written by a new offline-only `ConfirmOrder`
RPC, exposed through both the `/trader` UI and a new MCP agent tool. Locked decisions (context.md,
2026-08-26): offline = new `BROKER_TYPE_OFFLINE` enum value; new `ConfirmOrder` RPC; offline equity
derived from position market values (no cash entry).

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Account proto: `BrokerAccount` `packages/proto/trading/v1/trading.proto:197`; `RegisterBrokerAccountRequest` `:219` (`credentials_json` `:229`); RPCs `:10-30`.
  - Order proto: `Order` `trading.proto:32` (`status=6`, `filled_qty=8`, `filled_avg_price=11`; **no fill-time field**); `OrderStatus` `:72`; `PlaceOrder`/`ReplaceOrder` `:11,:20`.
  - Broker enum: `BrokerType` `packages/proto/common/v1/common.proto:68` (`UNSPECIFIED=0/ALPACA=1/IBKR=2` — **no OFFLINE**).
  - Broker pool + routing: `s.brokers` map `internal/service/trading.go:83`; `resolveAccount` `:269`; `instantiateBrokerLocked` `:2413`; pollers `syncPositions` `:1731`, `pollFills` (fill reconciliation), credential-health/reconciliation/bracket-watchdog (trading CLAUDE.md).
  - Broker integration contract: `Broker` interface `internal/broker/broker.go:66`; `BrokerOrder` `:15`, `BrokerPosition` `:38`, `BrokerBalance` `:58`.
  - Account repo: `BrokerAccountRecord` `internal/repository/account_repo.go:18`; `AccountRepository` `:44`; `NewAccountRepo` `:66`.
  - Handler: `ListBrokerAccounts` `internal/handler/trading.go:235`.
  - Migrations: last `007_broker_accounts_halt_source` → **next `008`**. `broker_accounts` table `migrations/002_broker_accounts.up.sql` (`credentials_enc BYTEA NOT NULL`); orders `001_orders_hypertable.up.sql`; `orders.account_id` `003_orders_account_id`.
  - Config reads: `WatchConfig` (trading CLAUDE.md § Config Keys) — no new key needed.

- **`xstockstrat-portfolio`** (Go)
  - Proto: RPCs `packages/proto/portfolio/v1/portfolio.proto:10`; `Portfolio` `:38`; `Position` `:52`.
  - Dual valuation read paths (C-10(b) parity target): `ListPositions` `internal/service/portfolio_service.go:491`; `buildAccountPortfolio` `:1036`; `ListPortfolios` `:1078`. **Both call `enrichPositions`** (mid-quote fallback for positions the broker did not value) — `:491` region + `:1046`.
  - Repo: `ListPositions` `internal/repository/portfolio_repo.go:117`; `ListPositionsByAccount` `:439`.
  - Ledger-sourced state: `ConsumeOrderFills` (from `order.filled`), `ConsumePositionSyncs`, `ConsumeBalanceSyncs` (portfolio CLAUDE.md).
  - Migrations: `positions` `001`; `positions.account_id` `003` (default `'alpaca-default'`); `account_balances` `004`; broker-valuation `005`; day-pnl `006`; last `011_watchlist_system_managed_source` → **next `012`** (likely unused — see Recommended Scope).

- **`xstockstrat-ui`** (Next.js, `/trader`)
  - Account selector: `AccountSelector.tsx:18` (filters `isActive` `:20`); state `AccountContext.tsx:27` (`fetchAccounts` `:32`).
  - Broker label: `src/lib/brokers.ts:4` (`brokerLabel` — hardcoded Alpaca/IBKR).
  - Register form: `AddAccountForm` `src/components/trader/accountShared.tsx:353`; broker `<Select>` `:459-460` (`value="1"` Alpaca / `value="2"` IBKR); `registerBrokerAccount` call `:415`; `buildCredentialsJson` `:45`; `credentialSchema` `:61`. Accounts page `AccountsModule.tsx:20` (broker filter hardcoded `:33-34,:119-121`).
  - Portfolio card: `PortfolioPanel.tsx:11` (matches `portfolio.accountId` `:102`); `useAccountPortfolios.ts:8`.
  - Positions: `src/app/trader/positions/page.tsx:50`; "Reported by broker" read-only mirror `:634`.
  - Orders + edit: `orders/page.tsx:16`; `orders/[id]/page.tsx:41` (`isWorking` gate `:34`, filled fields shown `:162-169`, `EditOrderDialog` `:206`); `EditOrderDialog.tsx:21`.
  - Mutation template: `useReplaceOrder.ts:9` → `useInvalidatingMutation.ts:17` (BFF-RPC-then-invalidate factory).
  - BFF: `src/lib/traderBff.ts:28` `router.service(TradingService, …)`; `replaceOrder` handler with session-user injection `:45`; dispatch `:173`. Browser client `src/lib/browserClients/tradingClient.ts:5-6`.
  - Nav: `PLATFORM_SUBNAV.trader` `src/components/shared/PlatformHeader.tsx:73-77` — `/trader` already registered.
  - Fixtures: `e2e/fixtures/accounts.ts:15`; mock-backend trading handlers `e2e/mock-backend.ts:232-246`; `INVENTORY.md:15`.

- **`xstockstrat-agent`** (Python MCP) — **has no trading client today**
  - Registration: `register_tools` `app/tools.py:208`; middleware `:212`; `@server.tool()` `:214…`; ownership-scoped model `manage_watchlist` `:1287`; header helpers `_caller_access_scope` `:102`, `_caller_user_id` `:114`.
  - Client: endpoint consts `app/client.py:19-25` (add `TRADING_ENDPOINT`); per-call channel + lazy stub pattern `:293-299`; `_metadata` `:58`; watchlist wrappers `:386,:409,:453`.
  - Tool-count surfaces (six; **28 → 29**): docstring `app/tools.py:4`; runtime registry `@server.tool()` decorators; CLAUDE.md `:36` + table `:39-68`; `docs/runbooks/mcp-tools.md:3,:37` + per-tool block format `:78-132`; name-set test `tests/test_tools_endpoint.py:23-52`; `GET /api/tools` `app/main.py:251` (auto).
  - Env surfaces missing `TRADING_ENDPOINT`: agent CLAUDE.md `:159-174`; `docker-compose.yml:520-537`; `.do/app.yaml:252`; `.do/app.dev.yaml:254`.

## Patterns to REUSE

- Offline valuation (equity from positions) → **reuse existing** `enrichPositions` mid-quote fallback + `buildAccountPortfolio` position-sum equity (`portfolio_service.go:1036`); offline accounts simply have no `account_balances` row → `bal == nil` → equity = Σ market_value. No new valuation path.
- Position/P&L update on manual fill → **reuse** `order.filled` ledger event → `ConsumeOrderFills`. `ConfirmOrder` emits the same event a broker fill would; no new consumer.
- Order-confirmation UI mutation → **reuse** `useInvalidatingMutation` (`useInvalidatingMutation.ts:17`); a `useConfirmOrder` copies `useReplaceOrder.ts:9`. BFF handler copies `traderBff.ts:45` `replaceOrder` (session-user injection), not a bare `forward`.
- Confirmation control placement → **reuse** the existing `orders/[id]` order-detail page (`orders/[id]/page.tsx:41`); add a confirm action beside "Edit order" — no new route, so C-10 nav-registration is not triggered.
- Offline account registration UI → **extend** `AddAccountForm` (`accountShared.tsx:353`) with an OFFLINE option that hides the credential fields; `brokerLabel` (`brokers.ts:4`) learns the new value.
- New MCP tool → **copy** `manage_watchlist` (`tools.py:1287`, ownership-scoped, forwards `x-user-id` via `_metadata`), and the trading gRPC wrapper copies the portfolio per-call channel pattern (`client.py:293-299`).
- Test fixtures → **extend** `e2e/fixtures/accounts.ts` + Go `internal/testdata/` / Python `tests/conftest.py` (C-13); Node/Go proto-shaped objects.

## Existing Business Rules (preserve / extend)

_(from scenario-recon; C-16)_
- **PRESERVE** `@AC-7` "Position detail reached from Opportunities returns to the Opportunities queue" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — offline positions render on the same `/trader/positions/[symbol]` page; don't regress the breadcrumb if that page is edited.
- **PRESERVE** `@AC-8` "Position detail always breadcrumbs back to Opportunities, even from Exposure" (same suite) — same shared page-detail surface.
- **PRESERVE** `@AC-13` "The 'Why this fired' panel shows the same firing state cue" (same suite) — firing-cue render must not change because a position is offline-sourced.
- no existing acceptance suite for `xstockstrat-trading` yet — this feature's `acceptance.feature` becomes the first promoted guarantee (the invariants: offline needs no broker/credentials, `ConfirmOrder` rejected for broker accounts, pollers skip offline).
- no existing acceptance suite for `xstockstrat-portfolio` yet.

## Dependencies

- **Proto/RPC** (all additive / non-breaking, C-04/C-09):
  - `common.proto:68` `BrokerType` += `BROKER_TYPE_OFFLINE = 3`.
  - `trading.proto` `Order` += a fill-time field (e.g. `google.protobuf.Timestamp filled_at`, next free field number) since none exists.
  - `TradingService` += `rpc ConfirmOrder(ConfirmOrderRequest) returns (Order)` + `ConfirmOrderRequest` (order_id, filled_qty, filled_avg_price, optional filled_at, user_id).
  - `RegisterBrokerAccountRequest.credentials_json` becomes optional for offline (no new field).
  - Run `./scripts/buf-gen.sh`; TS/Python/Go stubs regenerate (agent stub already exists at `gen/python/trading/v1/`).
- **Migration**:
  - trading `008_*`: relax `broker_accounts.credentials_enc` to `NULL`-able; add `orders.filled_at` (nullable) if the fill-time field is persisted on the orders table.
  - portfolio: **none anticipated** (offline reuses `portfolio.positions`/`account_balances` per-account schema).
- **Config keys**: none.
- **Inter-service edges**: new **agent → trading** gRPC edge (`ConfirmOrder`, offline account create). Existing UI → trading edge reused for the new RPC.
- **New env vars**: `TRADING_ENDPOINT` for the **agent** — absent from `docker-compose.yml:520-537`, `.do/app.yaml:252`, `.do/app.dev.yaml:254`, and agent CLAUDE.md `:159-174` (already present for other services' blocks). UI already has `TRADING_ENDPOINT` (`ui CLAUDE.md:257`).

## Risks / Not-found

- **`BROKER_TYPE_OFFLINE`** — not found (`common.proto:68-72`); net-new enum value. UI `brokerLabel`/broker `<Select>` and `AccountsModule` broker filter are hardcoded to Alpaca/IBKR and must all learn it (C-10 duplicated-surface sweep).
- **`ConfirmOrder` RPC / confirm mutation / hook** — not found in `trading.proto`, `traderBff.ts`, `src/hooks/`; net-new.
- **Fill-time field on `Order`** — not found; a new additive `filled_at` field is required to satisfy the "set fill time" requirement.
- **Trading has no non-broker account path** — `credentials_enc` is `NOT NULL`; `RegisterBrokerAccount` requires `credentials_json`; `resolveAccount`/pollers assume a live `broker.Broker` per account. Offline needs: nullable credentials, a register path that skips credential validation, and every poller/`resolveAccount` site to **skip** `broker_type == OFFLINE` (miss one and it will try to build a nil broker client → panic/halt).
- **Agent has no trading client** — genuinely new dependency (client + env in 3 deploy files + 6 tool-count surfaces).
- **Trap (fails.md 2026-08-06, feature 056):** offline valuation must land on **both** `ListPositions` and `buildAccountPortfolio` — mitigated because both already call `enrichPositions`; the design must not add an offline-only branch to only one.
- **Trap (fails.md 2026-08-05, add-ikbr):** no documented "follow-up" gap left unfixed; any deferral points at a named follow-up feature (C-14).
- **Trap (fails.md 2026-08-06, orders-management-ui):** verify a filter/field is actually read server-side, not merely accepted by the proto.
- **Trap (fails.md, mock-backend `accountId` vs `id`):** offline fixtures use proto field `id`, diffed against the proto, not a sibling mock.

## Recommended Scope

Advisory step boundaries (input to `/sdd-spec`):
1. **Proto** — `BROKER_TYPE_OFFLINE`, `Order.filled_at`, `ConfirmOrder` RPC + request; `buf-gen`.
2. **trading migration `008`** — nullable `credentials_enc` (+ `orders.filled_at` if persisted).
3. **trading service** — offline register path (skip credential validation), `resolveAccount`/all pollers skip `OFFLINE`, `ConfirmOrder` handler (offline-only guard → write fill → emit `order.filled`) + Go tests.
4. **portfolio** — confirm offline positions value correctly through both read paths (`enrichPositions`) + a parity test; likely no code change beyond a test.
5. **UI** — OFFLINE in `brokerLabel`/register form/account filter; `useConfirmOrder` + confirm control on `orders/[id]`; BFF `ConfirmOrder` handler; Playwright + fixtures.
6. **agent** — `TRADING_ENDPOINT` (client.py + 3 deploy files + CLAUDE.md), trading wrappers, new MCP tool (offline account create + `confirm_order`), all six tool-count surfaces, mcp-tools.md block, name-set test.
