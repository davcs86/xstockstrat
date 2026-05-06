# Context: add-ikbr-account-support

**Feature**: `docs/roadmap/features/add-ikbr-account-support/feature.md`
**Product Spec**: `docs/roadmap/features/add-ikbr-account-support/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/add-ikbr-account-support/implementation-spec.md`

---

## Session 2026-05-02T00:00:00Z — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, and `context.md` from user story.

**Key decisions:**
- Scope: order execution only; `xstockstrat-marketdata` unchanged; Alpaca remains sole market data provider.
- Routing model: platform-wide switch via `trading.broker.active` config key; dev = IBKR paper account, prod = IBKR live account (mirrors `ALPACA_PAPER` pattern).
- Proto changes are additive (new `BrokerType` enum + `broker_type` field on `Order` at field 19). Non-breaking; 1 service owner approval required.
- `trading.broker.active` is read at startup only — no hot-swap.
- IBKR credentials follow `ALPACA_*` env var pattern (env vars, not config service).
- No DB migration needed; `broker_type` column deferred to follow-up.

**Codebase state observed:**
- `services/xstockstrat-trading/internal/broker/alpaca.go`: concrete `Client` struct, no interface.
- `services/xstockstrat-trading/internal/service/trading.go`: `TradingService.broker` typed as `*broker.Client`.
- `packages/proto/trading/v1/trading.proto`: `Order` fields 1–18; field 19 is next available.
- `packages/proto/common/v1/common.proto`: `TradingMode` and `Environment` enums present; no `BrokerType` yet.
- No schema migration needed: `trading.orders` hypertable has `broker_order_id TEXT` (broker-agnostic).

---

## Session 2026-05-02T00:01:00Z — open question resolution

Resolved OQ-1, OQ-2, OQ-3. Status advanced `draft` → `spec-ready`.

**OQ-1 — IBKR API surface: IBKR Web API selected.**
Rationale: Client Portal Gateway requires a running local Java/Docker proxy and browser-based session login that expires — incompatible with automated server deployments. IBKR Web API uses OAuth 1.0a-style HMAC-SHA256 signed requests (Consumer Key + Access Token), server-to-server, no browser required. Matches the existing `ALPACA_API_KEY`/`ALPACA_API_SECRET` credential pattern. Base URL: `https://api.ibkr.com/v1/api/`.
New env vars: `IBKR_BASE_URL`, `IBKR_CONSUMER_KEY`, `IBKR_ACCESS_TOKEN`, `IBKR_ACCESS_TOKEN_SECRET`, `IBKR_ACCOUNT_ID`, `IBKR_PAPER`.

**OQ-2 — Paper account: confirmed available.**

**OQ-3 — Order type mapping: all five map cleanly.**
`MARKET`→`MKT`, `LIMIT`→`LMT`, `STOP`→`STP`, `STOP_LIMIT`→`STP LMT`, `TRAILING_STOP`→`TRAIL` (fixed trail amount via `auxPrice`←`stop_price`; trailing percentage out of scope). No new `OrderType` enum values needed. Documented as FR-16.

---

## Session 2026-05-02T00:02:00Z — scope revision

User clarified the user story: not a platform-wide broker switch, but a **multi-account portfolio model** where a user tracks multiple Alpaca and/or IBKR accounts simultaneously. Status reverted `spec-ready` → `draft`; product-spec.md fully revised.

**Key architectural changes from this revision:**

- **`trading.broker.active` config key removed.** Replaced by `broker_accounts` table in the `trading` DB schema.
- **Account registry (FR-1 through FR-5)**: `broker_accounts` table (`id`, `display_name`, `broker_type`, `is_paper`). At startup, `xstockstrat-trading` reads all rows and instantiates one broker client per account (broker client pool, `map[string]broker.Broker`).
- **Backwards-compatibility fallback (FR-5)**: If `broker_accounts` is empty, the service falls back to the single `ALPACA_API_KEY`/`ALPACA_API_SECRET` env vars and creates an implicit `alpaca-default` account. Existing deployments require no changes.
- **Staging invariant (FR-3)**: On `ENVIRONMENT=dev`, the service refuses to start if any `broker_accounts` row has `is_paper=false`. Enforces paper-only across all registered accounts.
- **Proto additions (FR-9 through FR-14)**: `BrokerType` enum in `common/v1`; `account_id` (field 19) + `broker_type` (field 20) on `Order`; `account_id` on `PlaceOrderRequest`; `account_id` on `Portfolio`; new `ListPortfolios` RPC on `PortfolioService`. All additive — 1 service owner approval.
- **DB migrations added**: `broker_accounts` table + `orders.account_id` column. DBA review now required.
- **`xstockstrat-portfolio` now in scope**: Tracks one `Portfolio` per registered account; fill events carry `account_id` to route updates. `ListPortfolios` returns all per-account portfolios.
- **Credentials per account (FR-4, now superseded)**: per-account env vars approach — superseded by encrypted DB storage in session 2026-05-02T00:03:00Z below.
- **Multi-account order routing**: `PlaceOrder` with absent `account_id` returns error when multiple accounts registered; succeeds with default when only one exists.

---

## Session 2026-05-02T00:03:00Z — follow-up revisions

Two user follow-ups incorporated into product-spec.md. Status remains `draft`.

**Change 1: Encrypted credential storage (replaces per-account env vars)**
- Problem: per-account env vars still require env var changes + restart to add accounts.
- Decision: credentials stored AES-256-GCM encrypted in `broker_accounts.credentials_enc`. Single `BROKER_ACCOUNTS_ENCRYPTION_KEY` env var is the only new env var. New accounts registered via `RegisterBrokerAccount` RPC — no restart, no env var touch.
- `credentials_enc` stores a broker-type-specific JSON blob (`{"api_key":"...","api_secret":"..."}` or `{"consumer_key":"...","access_token":"...","access_token_secret":"..."}`).
- `ListBrokerAccounts` never returns credentials. `DeregisterBrokerAccount` sets `is_active=false` + removes from in-memory pool immediately. Credential rotation requires deregister+register (UpdateCredentials deferred).
- Three new RPCs on `TradingService`: `RegisterBrokerAccount`, `ListBrokerAccounts`, `DeregisterBrokerAccount`.

**Change 2: IBKR position sync added to scope (FR-28 through FR-31)**
- Problem: portfolio is purely fill-event-driven with no reconciliation; IBKR positions could drift.
- Decision: `StartPositionSyncPoller` in `xstockstrat-trading` polls IBKR accounts every 5 min (configurable: `trading.position_sync.ibkr_interval_ms`). Emits `account.positions.synced` ledger event with full position snapshot.
- `ConsumePositionSyncs` in `xstockstrat-portfolio` atomically replaces positions for the account on each event (broker truth wins for IBKR accounts).
- Alpaca continues fill-event-based tracking. `GetPositions` is on the `Broker` interface (Alpaca implements it) but the poller does not invoke it — trivial follow-up.
- `portfolio.positions` table gains `account_id TEXT NOT NULL DEFAULT 'alpaca-default'`; unique constraint updated to `(user_id, symbol, trading_mode, account_id)`.
- New config key: `trading.position_sync.interval_ms` (int, default 300000, live-reloaded).

---

## Session 2026-05-02T00:04:00Z — broker feature parity

User confirmed goal is feature parity between brokers. Position sync poller (FR-28–31) now runs for **all** registered accounts, not IBKR-only. `GetPositions` was already on the `Broker` interface and Alpaca already implements it — only the poller scope changed. Config key renamed `trading.position_sync.ibkr_interval_ms` → `trading.position_sync.interval_ms`. "Alpaca position sync" removed from Out of Scope.

---

## Session 2026-05-02T00:05:00Z — spec-ready audit; five blocking gaps resolved

Spec audited against proto contracts and codebase. Five design-decision gaps identified and resolved. Status advanced `draft` → `spec-ready`.

**Gap 1 — Read-side portfolio RPCs (FR-27a added)**
Optional `account_id` added to request messages of `GetPortfolio`, `GetPosition`, `ListPositions`, `GetPnL`, `GetSnapshot`, `StreamPortfolioUpdates`. When absent: aggregate/all-accounts (backwards-compatible). When present: filter to account, return `codes.NotFound` if not found. Also added `account_id` to `PortfolioSnapshot`.

**Gap 2 — IBKR account ID in credentials (FR-3 updated)**
`ibkr_account_id` (the IBKR-assigned account ID, e.g. `U1234567`) added to the IBKR credentials JSON blob. Required for `GetPositions` (`GET /v1/api/portfolio/{ibkr_account_id}/positions`) and order submission.

**Gap 3 — `alpaca-default` fallback (FR-6 updated)**
Fallback is a real `broker_accounts` row (not a synthetic in-memory construct), inserted by Migration A using `ALPACA_API_KEY`/`ALPACA_API_SECRET` env vars at migration time. Credentials encrypted before storage. If env vars absent, no row inserted — operator registers manually. `user_id = 'default'` for the seed row.

**Gap 4 — Position sync replacement semantics (FR-30 updated; then revised again)**
Initially spec'd as full replace (delete + insert). Revised to upsert semantics after user raised concern about losing historical data. Final approach: update existing rows (preserve `opened_at`), insert new rows (opened outside platform), delete rows absent from snapshot (closed on broker). Realized P&L and snapshots are in append-only tables and unaffected by sync.

**Gap 5 — Auth for account management RPCs (FR-10a added; FR-1 updated)**
`broker_accounts` gains `user_id TEXT NOT NULL` column. `RegisterBrokerAccount` derives `user_id` from caller's auth claims. `ListBrokerAccounts` filters to caller's accounts. `DeregisterBrokerAccount` validates ownership; returns `codes.PermissionDenied` on mismatch. No new auth scope required.

---

## Session 2026-05-02T00:06:00Z — sdd-spec

Generated `implementation-spec.md` (18 steps). Key codebase findings:

**Proto layer (Steps 1–3)**
- `packages/proto/common/v1/common.proto`: last line L62 (`}`). Appended `BrokerType` enum after L62.
- `packages/proto/trading/v1/trading.proto`: `Order` fields 1–18 (field 18 = `broker_order_id`). `TradingService` has 5 RPCs. `PlaceOrderRequest` field 12 = `stop_price`. All additions are at field 19+/13+ — non-breaking.
- `packages/proto/portfolio/v1/portfolio.proto`: `Portfolio` fields 1–10, `Position` fields 1–10, `PortfolioSnapshot` fields 1–7. `PortfolioService` has 6 RPCs. All additions are at field 11+/8+ — non-breaking.

**Generated stubs (Step 4)**
- `packages/proto/gen/go/trading/v1/tradingv1connect/trading.connect.go`: `UnimplementedTradingServiceHandler` at L204 (5 stubs). After regen, gains 3 new stubs; compile-time assertion at L17 will fail until handler methods added (Step 14).
- `packages/proto/gen/go/portfolio/v1/portfoliov1connect/portfolio.connect.go`: `UnimplementedPortfolioServiceHandler` at L230 (6 stubs). After regen, gains `ListPortfolios` stub; assertion at L17 fails until Step 18.

**DB migrations**
- Last trading migration: `001_orders_hypertable`. New: `002_broker_accounts`, `003_orders_account_id`.
- Last portfolio migration: `002_add_trading_mode`. Unique constraint: `positions_user_id_symbol_trading_mode_key (user_id, symbol, trading_mode)`. New: `003_positions_account_id` — drops old constraint, adds `(user_id, symbol, trading_mode, account_id)`.

**xstockstrat-trading service**
- `config.go`: `Config` struct L16–33; `AppEnv` and `BrokerAccountsEncryptionKey` not yet present (Step 8).
- `broker/alpaca.go`: `Client` struct at L25; `SubmitOrder` returns `*AlpacaOrder` (L90); `GetOrder` returns `*AlpacaOrder` (L154); no `GetPositions`; no `Broker` interface; imports do NOT include `strconv` (must add in Step 9).
- `broker/alpaca_test.go`: L55 `order.ID` and L79 `order.ID` — these break when `SubmitOrder`/`GetOrder` return `*BrokerOrder`; must update to `order.BrokerOrderID`.
- `service/trading.go`: `TradingService.broker` typed as `*broker.Client` at L33; `NewTradingService` at L55; `StartFillPoller` at L333–356 (live-reload pattern to mirror for `StartPositionSyncPoller`); `emitLedgerEvent` at L549.
- `handler/trading.go`: compile-time assertion at L17; embeds `UnimplementedTradingServiceHandler` at L21; `toGRPCError` at L155 (add `CodePermissionDenied` case).
- `repository/trading_repo.go`: `UpsertOrder` at L41–68 (19 columns); `scanOrder` at L175 (18 columns); add `account_id`, `broker_type` (Steps 12).
- `cmd/server/main.go`: broker init at L77–83; `NewTradingService` at L87; `go svc.StartFillPoller(ctx)` at L94.

**xstockstrat-portfolio service**
- `repository/portfolio_repo.go`: `UpsertPosition` ON CONFLICT at L32–40; `scanPositionRow` at L172 (6 columns); must add `account_id` throughout (Step 16).
- `service/portfolio_service.go`: `ConsumeOrderFills` at L72; `streamFills` at L84; `processOrderFill` at L113; `GetPortfolio` at L175. `ConsumePositionSyncs` mirrors this pattern (Step 17).
- `handler/portfolio_handler.go`: compile-time assertion at L17; `grpcPortfolioAdapter` at L122.
- `cmd/server/main.go`: `go svc.ConsumeOrderFills(ctx)` at L70; add `go svc.ConsumePositionSyncs(ctx)` (Step 18).

**Known deviations documented in spec**
- `alpaca-default` seed deferred to application startup (`EnsureAlpacaDefault`) rather than migration (PRE_DEPLOY job doesn't have trading-service env vars).
- `user_id` absent from `account.positions.synced` ledger event payload; placeholder `"default"` used in `processPositionSync`. Follow-up to add `user_id` to event payload.
- Pre-existing inconsistency in `trading_helpers_test.go`: `TestAlpacaStatusToProto` expects `"unknown_status"` → `ORDER_STATUS_UNSPECIFIED` but `alpacaStatusToProto` returns `ORDER_STATUS_NEW` for unknown inputs. Not introduced by this feature; not changed by this spec.

---

## Session 2026-05-03T00:00:00Z — sdd-execute

**Steps this session**: [1]
**Progress**: 1 done / 18 total
**Stopped at**: Step 1 (PR created; awaiting merge before Step 2)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 1 — Add `BrokerType` enum to `common/v1` [done]
- Appended `BrokerType` enum (UNSPECIFIED=0, ALPACA=1, IBKR=2) to `packages/proto/common/v1/common.proto` after the `Environment` enum.
- Files modified: `packages/proto/common/v1/common.proto`
- Deviations: `buf` not pre-installed; installed buf 1.69.0 to `/usr/local/bin/buf` at runtime. `buf lint` and `buf breaking --against feature/add-ikbr-account-support` both passed.

---

## Session 2026-05-03T01:00:00Z — sdd-execute

**Steps this session**: [2]
**Progress**: 2 done / 18 total
**Stopped at**: Step 2 (PR created; awaiting merge before Step 3)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 2 — Add broker account messages + RPCs to `trading/v1` [done]
- Added `account_id = 19` and `broker_type = 20` to `Order`; `account_id = 13` to `PlaceOrderRequest`; `BrokerAccount` + request/response messages for `Register/List/Deregister`; 3 new RPCs to `TradingService`.
- Files modified: `packages/proto/trading/v1/trading.proto`
- Deviations: Spec said `PlaceOrderRequest` field 12 = `stop_price` but actual field 12 = `trading_mode`; field 13 added correctly regardless. Spec said last RPC = `GetOrder` but actual last = `StreamOrderUpdates`; new RPCs appended correctly. `buf breaking --against '.git#branch=feature/...,subdir=packages/proto'` syntax required (not in spec). `buf` re-installed at runtime (same as Step 1 deviation).

---

## Session 2026-05-06T00:00:00Z — sdd-execute

**Steps this session**: [3]
**Progress**: 3 done / 18 total
**Stopped at**: Step 3 (PR created; awaiting merge before Step 4)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 3 — Add `account_id` fields + `ListPortfolios` to `portfolio/v1` [done]
- Added `account_id = 11` to `Portfolio` and `Position`; `account_id = 8` to `PortfolioSnapshot`; `optional string account_id` to all 6 read request messages at next available field numbers; added `ListPortfoliosRequest`, `ListPortfoliosResponse` messages, and `ListPortfolios` RPC to `PortfolioService`.
- Files modified: `packages/proto/portfolio/v1/portfolio.proto`
- Deviations: Spec codebase evidence had stale field names for Portfolio/Position/PortfolioSnapshot (field numbers were correct). `buf` not pre-installed; installed buf 1.54.0 at runtime. `buf breaking` run from repo root with `subdir=packages/proto` syntax (same as Step 2). Branch sync performed with `-X theirs` (main-dev wins) per user instruction; merged 3 new main-dev commits (SDD process improvements, promotion commit) into feature branch without conflict.

---

## Session 2026-05-06T01:00:00Z — sdd-execute

**Steps this session**: [4]
**Progress**: 4 done / 18 total
**Stopped at**: Step 4 (PR created; awaiting merge before Step 5)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 4 — Regenerate proto stubs [done]
- Regenerated all stubs: Go stubs updated for common/v1 (BrokerType), trading/v1 (new messages + 3 RPCs), portfolio/v1 (new fields + ListPortfolios). Portfolio connect.go now has 7 stubs (was 6). Trading connect.go now has 8 stubs (was 5). Python stubs regenerated via grpc_tools.protoc. TypeScript stubs regenerated and compiled (dist/ files updated).
- Files modified: `packages/proto/gen/go/`, `packages/proto/gen/python/`, `packages/proto/gen/ts/`, `packages/proto/gen/python/setup.py`
- Deviations: `buf`, `protoc-gen-ts_proto`, `protoc`, and `protoc-gen-grpc_python` not pre-installed; installed at runtime. Python gRPC stubs generated via `python3 -m grpc_tools.protoc` directly. TypeScript tsc emits exit code 2 (pre-existing TS6.0 deprecation of `moduleResolution=node` in tsconfig) but output files are correct. All expected stub changes confirmed present.

---

## Session 2026-05-06T02:00:00Z — sdd-execute

**Steps this session**: [5]
**Progress**: 5 done / 18 total
**Stopped at**: Step 5 (PR created; awaiting merge before Step 6)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 5 — Migration: `trading` — `broker_accounts` table [done]
- Created `002_broker_accounts.up.sql` (CREATE TABLE trading.broker_accounts + 2 indexes) and `002_broker_accounts.down.sql` (DROP TABLE). `alpaca-default` seed deferred to application startup per spec note.
- Files modified: `services/xstockstrat-trading/migrations/002_broker_accounts.up.sql`, `services/xstockstrat-trading/migrations/002_broker_accounts.down.sql`
- Deviations: `./scripts/db-migrate.sh` could not be verified — no PostgreSQL running (Docker daemon unavailable in harness environment). SQL syntax reviewed manually; migration will be verified on deploy via db-migrator PRE_DEPLOY job.

---

## Session 2026-05-06T03:00:00Z — sdd-execute

**Steps this session**: [6]
**Progress**: 6 done / 18 total
**Stopped at**: Step 6 (PR created; awaiting merge before Step 7)
**Next**: /sdd-execute add-ikbr-account-support next

### Step 6 — Migration: `trading` — `orders.account_id` + `orders.broker_type` [done]
- Created `003_orders_account_id.up.sql` (ADD COLUMN account_id TEXT DEFAULT 'alpaca-default', ADD COLUMN broker_type SMALLINT DEFAULT 1, CREATE INDEX) and `003_orders_account_id.down.sql`. Defaults preserve backward compatibility for existing rows.
- Files modified: `services/xstockstrat-trading/migrations/003_orders_account_id.up.sql`, `services/xstockstrat-trading/migrations/003_orders_account_id.down.sql`
- Deviations: `./scripts/db-migrate.sh` could not be verified — no PostgreSQL running (same constraint as Step 5). SQL syntax reviewed manually; will be verified on deploy.
