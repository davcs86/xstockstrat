# Implementation Spec: fix-offline-account-ui-gaps

**Status**: `pending`
**Created**: 2026-08-26
**Feature**: `docs/roadmap/features/159-fix-offline-account-ui-gaps/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-offline-account-ui-gaps`

---

## Execution Summary

Closes the two offline-account UI gaps at the layer that authoritatively owns each. Order-ticket
correctness (FR-1/FR-2) is closed at **both** the trading layer (authoritative routing guard + a
CancelOrder offline guard — the only place FR-2 can be *guaranteed*, since the Playwright mock hardcodes
`placeOrder → FILLED` and cannot exercise the NEW-not-CANCELED path) and the `/trader` UI (a dedicated
Record-order control replacing the broker ticket for offline accounts). Portfolio-display correctness
(FR-3/FR-4) is closed at the portfolio layer (the combined `ListPortfolios` all-accounts branch now
enumerates offline accounts too, closing the `ListPositions`↔`ListPortfolios` C-10(b) parity gap) and
the UI (`PortfolioPanel` gates broker-only fields on `!isOffline`). **No proto, migration, or config
change** — the fix reuses feature 157's existing offline contracts.

Backend correctness steps come first (trading Steps 1–2, portfolio Steps 3–4) so the guarantees exist
independent of the UI; the UI steps (5–6) then present them and are covered by the extended e2e suite
(Step 7). A docs step (8) keeps the two service `CLAUDE.md` files accurate for the two new backend
behaviors.

### Scenario Coverage (Constitution C-15)

Each `@AC-*` in `acceptance.feature` maps to the step(s) that cover it:

- **@AC-1** (@FR-1/@FR-2 — offline account cannot place a broker-routed order; recorded NEW, never
  CANCELED) → **Step 2** (trading Go tests: PlaceOrder routes an OFFLINE-persisted account to
  `recordOfflineOrder` → NEW + empty `broker_order_id`; CancelOrder on an offline order is guarded,
  not flipped to CANCELED) **and Step 7** (e2e: on `/trader` the broker ticket is replaced by the
  Record-order control for an offline account; the record control is absent on the insights
  `SignalOrderTicket` mount — C-10(a) both-instances).
- **@AC-2** (@FR-3 — offline card hides Cash / Buying Power / broker Day P&L) → **Step 7** (e2e).
- **@AC-3** (@FR-4 — combined Cash / Buying Power aggregates exclude the offline account) → **Step 4**
  (portfolio Go test: the all-accounts aggregate's summed cash/BP excludes the offline account, whose
  `bal == nil` contributes 0) **and Step 7** (e2e).
- **@AC-4** (@FR-4 — offline account is visible in the combined view with only meaningful fields) →
  **Step 4** (portfolio Go parity test: an offline account surfaces in `ListPortfolios` all-accounts,
  matching `ListPositions` — the fails-056 C-10(b) parity rule) **and Step 7** (e2e: the offline card
  in the combined view shows only positions market value / unrealized / realized and hides broker
  fields).

### Consumer Surface Coverage (Constitution C-14)

Product spec `## Consumer Surface(s)`: `/trader` web UI (reached — Steps 5, 6, 7), the MCP agent
`manage_offline_account` `record_order` (unchanged — the new UI Record-order control reaches the same
`PlaceOrder` offline path; no agent-tool signature change, restated per C-14), and backend read-path
parity `xstockstrat-portfolio` `ListPositions`↔`ListPortfolios` (reached — Steps 3, 4). The insights
`SignalOrderTicket` mount is a **deliberately excluded** surface (broker-execution context) — the
backend routing guard (Step 1) still guarantees FR-2 there, and Step 7 asserts the record control does
**not** appear on it.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (trading) — red-before-green, same service.
- Step 4 [test] covers Step 3 [service] (portfolio) — red-before-green, same service.
- Step 7 [test] covers Steps 5 and 6 [service] (`xstockstrat-ui`, no per-service coverage threshold —
  e2e is the pairing per `reference/spec-template.md`).
- Step 6 (UI combined-card gating) presents data the backend Step 3 produces, but does **not** require
  Step 3 at build/test time — the e2e mock supplies both a broker and an offline portfolio via
  `listPortfolios`, so Steps 3/6 can be developed independently. Real end-to-end offline-in-combined
  rendering requires both.
- No proto/migration/config steps — the fix reuses feature 157's offline contracts (recon.md
  § Dependencies: trading last migration = 008, portfolio last = 012, unchanged).

---

### Step 1 — service: trading — authoritative offline routing (PlaceOrder) + offline cancel guard (CancelOrder)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading — Order execution correctness, broker API safety, paper-only dev invariant

**Codebase Evidence**:
- `PlaceOrder` at `trading.go:350`; it resolves the account at `:371` (`resolveAccount(req.AccountId)`)
  and the **existing** offline branch keys only on the in-memory pool entry:
  `if accountEntry.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)` (`trading.go:388`)
  `→ return s.recordOfflineOrder(...)` (`:389`). It never reads the persisted account type.
- Authoritative persisted type is available via `s.accountRepo.GetBrokerAccount(ctx, id)`
  (`internal/repository/account_repo.go:104`), returning `*BrokerAccountRecord` whose `BrokerType int32`
  (`account_repo.go:21`) compares against `int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)` — the same
  pattern already used at `trading.go:2233,2241` and `:2710,2731`.
- `recordOfflineOrder` (`trading.go:744`) records `Status: ORDER_STATUS_NEW`, `FilledQty: 0`, no
  `broker_order_id`, `LimitPrice: req.LimitPrice`, `BrokerType: BROKER_TYPE_OFFLINE` (`:790–803`).
- `CancelOrder` (`trading.go:971`) loads the order (in-memory `:973`, DB fallback `:978`), then — with
  **no offline / broker_type precondition** — sets `order.Status = ORDER_STATUS_CANCELED`
  **unconditionally** at `trading.go:1079`, persists (`:1087`), and emits `order.canceled` (`:1094`).
  The broker cancel above it *is* gated on `order.BrokerOrderId != ""` (`:1036`), but the local
  transition is not. The loaded `order.BrokerType` is the persisted authoritative type
  (`recordOfflineOrder` sets it to OFFLINE; broker orders carry ALPACA/IBKR).

**TDD**: `red-green required`

**Covers**: — (paired test is Step 2)

**Instructions**:
1. **Guard B — authoritative PlaceOrder routing.** After `resolveAccount` succeeds (`trading.go:371`,
   just before the existing offline branch at `:388`), read the authoritative persisted type:
   `rec, gErr := s.accountRepo.GetBrokerAccount(ctx, resolvedAccountID)`. Route to the offline branch
   when **either** source says OFFLINE (a divergence-safe union, since `broker_type` is immutable
   post-create — context.md investigation — so the two normally agree; the union guarantees an offline
   order can never fall through to a broker path in either direction):
   change the condition at `:388` to route offline when
   `accountEntry.brokerType == OFFLINE || (gErr == nil && rec != nil && rec.BrokerType == OFFLINE)`.
   On `gErr != nil`, `slog.Warn` and fall back to the pool-tag-only decision (best-effort, mirroring the
   non-blocking-read pattern at `trading.go` 4C) — this preserves broker-account behavior and still
   catches offline via the pool tag; it never fails a broker order open on a DB blip.
2. **Guard A — CancelOrder offline guard.** Immediately after the order is loaded and cached
   (`trading.go:985`, before the intent-dedup insert at `:987`), reject an offline order instead of
   flipping it to CANCELED:
   `if order.BrokerType == commonv1.BrokerType_BROKER_TYPE_OFFLINE { return nil, grpcstatus.Errorf(codes.FailedPrecondition, "offline order %s is managed via ConfirmOrder, not broker cancel", req.OrderId) }`.
   Key the guard on the **authoritative persisted `order.BrokerType == OFFLINE`** (the design's default
   "reject", resolving design.md Open Risk "CancelOrder guard semantics"), **not** on an empty
   `broker_order_id` — a broker order that has not yet received its `broker_order_id` also has an empty
   one and must still be cancelable locally (`:1036` already gates the broker call on non-empty), so an
   empty-`broker_order_id` guard would wrongly reject legitimate broker cancels.
3. Do not touch the broker-cancel branch (`:1036–1051`), the bracket-leg cancellation (`:1058–1077`), or
   `pollFills` (already excludes OFFLINE entries at `:1408`). Broker order types, fill lifecycle
   (`PARTIALLY_FILLED`/`FILLED`), and Alpaca/IBKR routing are unaffected (recon § trading — no change to
   those paths).

**Verification**:
- `cd services/xstockstrat-trading && GOWORK=off go build ./...` — compiles.
- `grep -n "GetBrokerAccount(ctx, resolvedAccountID)" internal/service/trading.go` — confirms guard B is
  present in `PlaceOrder`.
- `grep -n "managed via ConfirmOrder" internal/service/trading.go` — confirms guard A is present in
  `CancelOrder` (above `:1079`).
- Header propagation: no **new outbound gRPC call** is added — `GetBrokerAccount` is a DB repo read, not
  a gRPC call to another backend service — so the C-03 propagation constraint is not triggered by this
  step (confirmed: `account_repo.go` is `pgAccountRepo`, a DB repository).
- Lint/coverage run in the paired Step 2.

---

### Step 2 — test: trading — PlaceOrder authoritative-offline routing + CancelOrder offline guard

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify

**Reviewers**: xstockstrat-trading — Order execution correctness, broker API safety, paper-only dev invariant

**Codebase Evidence**:
- Existing offline test home: `services/xstockstrat-trading/internal/service/trading_offline_test.go`
  (feature 157) — the canonical place for offline PlaceOrder/ConfirmOrder tests; extend it rather than
  create a new file.
- Go test-data home exists: `services/xstockstrat-trading/internal/testdata/order_rows.go` (C-13 Go
  home). Reuse existing order/account builders there; only add a new literal if a **second** consumer
  forces it (C-13) — a single-consumer inline literal in this file is compliant, state that verdict.
- `recordOfflineOrder` returns `Status == ORDER_STATUS_NEW`, `BrokerOrderId == ""` (`trading.go:790–803`).

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions** (author to FAIL against the pre-Step-1 tree — RED asserts the new behavior):
1. **PlaceOrder authoritative-offline routing (@AC-1 backend half).** Construct a `TradingService`
   whose `accountRepo.GetBrokerAccount` returns a record with `BrokerType == OFFLINE` for the test
   account. Call `PlaceOrder` with a valid `client_order_id` and `order_type = ORDER_TYPE_MARKET`
   (the offline branch is order-type-agnostic — `recordOfflineOrder` records `req.OrderType` verbatim
   and never routes to a broker). Assert the returned order has
   `Status == OrderStatus_ORDER_STATUS_NEW` and `BrokerOrderId == ""`, and that no broker submit was
   attempted (offline entries carry `client == nil` — `trading.go:2184`). If feasible in the harness,
   add the divergence case (pool entry non-OFFLINE, persisted `rec.BrokerType == OFFLINE`) asserting the
   union guard still routes offline; if the pool wiring makes that harness-expensive, cover the
   persisted-OFFLINE path and note the divergence case is exercised by the union condition itself.
2. **CancelOrder offline guard (@AC-1 backend half — the "never CANCELED" guarantee).** Seed an offline
   order (`BrokerType == OFFLINE`, empty `broker_order_id`, `Status == NEW`) into the service and call
   `CancelOrder`. Assert it returns a `FailedPrecondition` error and that the order's status is **still
   NEW** (never `ORDER_STATUS_CANCELED`) — i.e. no `order.canceled` transition occurred. This is the
   assertion the Playwright mock provably cannot make (mock `placeOrder` hardcodes FILLED,
   `e2e/mock-backend.ts:204`).
3. Keep a broker-account control case (or rely on the existing broker CancelOrder tests) so the guard is
   shown to reject **only** offline orders — a broker order still cancels to CANCELED as before.

**Verification**:
- Coverage (≥40%, service excluded-package caveat may apply — new logic is a branch inside
  `internal/service`, which CI excludes from coverage measurement; per `reference/spec-template.md` note
  the integration/behavioral test is the verification and no coverage threshold gates this package, but
  the test step is still required):
  `cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'Offline' -race -count=1` — the new offline routing + cancel-guard tests pass (and fail against the pre-Step-1 tree).
- Full threshold gate (satisfies C-08 where measurable):
  `cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.
- Lint: `cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod`.
- C-13: confirm no **second** inline copy of a domain literal was introduced —
  `grep -rn "BROKER_TYPE_OFFLINE" internal/service/trading_offline_test.go` and confirm any account/order
  builder reuse comes from `internal/testdata/order_rows.go`; a single-consumer inline literal passes —
  record that verdict.

---

### Step 3 — service: portfolio — include offline accounts in the combined ListPortfolios enumeration

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `ListPortfolios` all-accounts branch enumerates from balances only:
  `accounts, err := s.repo.ListAccountBalancesByUser(ctx, userID)` (`portfolio_service.go:1125`), loops
  `buildAccountPortfolio(ctx, acct.AccountID, &bal)` (`:1130–1138`). Offline accounts (no
  `account_balances` row) are entirely absent — the `ListPositions`↔`ListPortfolios` C-10(b) parity gap
  (fails.md 2026-07-01 / 056).
- `ListAccountBalancesByUser` = `SELECT account_id,... FROM portfolio.account_balances WHERE user_id=$1`
  (`portfolio_repo.go:451–456`).
- `buildAccountPortfolio` already handles `bal == nil` (`portfolio_service.go:1082` — Cash/BuyingPower/
  DayPnl stay 0, Equity = summed position market value `:1077`, RealizedPnl from `GetOfflineRealized`
  `:1094`), so an offline account with `bal == nil` builds correctly.
- Offline accounts are marked, in portfolio's own schema, by a `portfolio.offline_account_realized` row
  (migration `012`, PK `account_id`, `user_id NOT NULL`); `GetOfflineRealized` reads it
  (`portfolio_repo.go:420`), `UpsertOfflineRealized` writes it on offline ConfirmOrder recompute
  (`:408`). Broker accounts never get a row here — this is the offline-exclusive marker.
- `ListPositions` (service `portfolio_service.go:500`) already surfaces an offline account's positions —
  the read path the combined view must reach parity with.

**TDD**: `red-green required`

**Covers**: — (paired test is Step 4)

**Instructions**:
1. **New repo read.** Add `ListOfflineAccountIdsByUser(ctx, userID string) ([]string, error)` to
   `portfolio_repo.go` (beside `ListAccountBalancesByUser`, ~`:451`):
   `SELECT account_id FROM portfolio.offline_account_realized WHERE user_id=$1 ORDER BY account_id ASC`.
   This is the offline-exclusive account set (broker accounts never appear here), so unioning it with the
   balances set introduces **no** false broker entries. **Scope note (P-03, surfaced not guessed):** an
   offline account surfaces in the combined view once portfolio has observed activity for it (a
   `offline_account_realized` row, written on the first offline ConfirmOrder). A freshly-created offline
   account with only unconfirmed NEW orders is not yet known to portfolio — portfolio learns of accounts
   only via ledger events, not an account-creation signal — which is consistent with @AC-4 (a user who
   *holds* an offline account with positions/realized). Covering a zero-activity offline account would
   require an account-existence signal portfolio does not have today; it is out of scope for this fix.
2. **Union enumeration in `ListPortfolios`.** In the all-accounts branch (`portfolio_service.go:1120–1139`),
   after building the balances-sourced portfolios, also enumerate
   `offlineIDs, err := s.repo.ListOfflineAccountIdsByUser(ctx, userID)` and, for each offline id **not
   already present** in the balances set (dedup by account id — a set/`map[string]struct{}` of the
   balances account ids), call `buildAccountPortfolio(ctx, id, nil)` and append. Passing `bal == nil`
   makes Cash/BuyingPower/DayPnl 0 and Equity the summed position market value (`:1077,1082`), so the
   summed cash/BP aggregate naturally excludes offline accounts (their contribution is 0) while offline
   equity may contribute (FR-4 "may contribute"). Preserve the existing per-account
   `slog.Warn`+`continue` error tolerance (`:1134–1135`).
3. Do not change the single-account branch (`:1105–1117`) — it already builds an offline account
   correctly when queried by id. No proto change (`Portfolio` carries no offline marker — recon; the UI
   keys offline-ness on the account's `brokerType`).

**Verification**:
- `cd services/xstockstrat-portfolio && GOWORK=off go build ./...` — compiles.
- `grep -n "ListOfflineAccountIdsByUser" internal/repository/portfolio_repo.go internal/service/portfolio_service.go`
  — confirms the repo method exists and is called from `ListPortfolios`.
- Lint/coverage run in the paired Step 4.

---

### Step 4 — test: portfolio — offline account surfaces in combined ListPortfolios; excluded from cash/BP aggregate

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` — modify

**Reviewers**: xstockstrat-portfolio — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Existing offline test home: `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go`
  (feature 157). Portfolio has **no** `internal/testdata/` dir — C-13 does not require creating one; keep
  domain literals inline (single consumer) unless a second consumer forces a home.
- `buildAccountPortfolio` (`portfolio_service.go:1056`) and the all-accounts branch (`:1120–1139`) under
  test; `ListPositions` service path (`:500`) is the parity counterpart.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4`

**Instructions** (author to FAIL against the pre-Step-3 tree):
1. **@AC-4 parity (C-10(b), fails-056 rule).** Seed a user holding one broker account (an
   `account_balances` row) and one offline account (an `offline_account_realized` row + positions).
   Call `ListPortfolios` with no `account_id`. Assert **both** accounts appear in the response
   (pre-Step-3 the offline account is absent → RED), and that the offline account's portfolio carries
   only meaningful figures: `Equity` = summed position market value, `RealizedPnl` set (presence),
   `Cash == 0`, `BuyingPower == 0`, `DayPnl == 0`. This is the `ListPositions`↔`ListPortfolios` parity
   the rule requires — assert the offline account id present in `ListPortfolios` matches the one
   `ListPositions` surfaces for the same user.
2. **@AC-3 aggregate exclusion.** From the same combined response, assert the summed broker-only
   aggregates over all returned portfolios exclude the offline account: the offline portfolio contributes
   `0` to summed Cash and Buying Power (it has no balances row), so the combined cash/BP equal the broker
   account's alone — the offline account's absent balance does not misrepresent them.
3. Use the repository test double / fixtures already used by `portfolio_offline_test.go`; add a
   `ListOfflineAccountIdsByUser` stub return to the double so the service enumerates the offline id.

**Verification**:
- `cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'Offline' -race -count=1`
  — new combined-view offline tests pass (fail against the pre-Step-3 tree).
- Threshold gate (C-08):
  `cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.
- Lint: `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`.
- C-13: single-consumer inline domain literals are compliant (portfolio has no `internal/testdata/`) —
  record that verdict; do not create a fixture home speculatively.

---

### Step 5 — service: xstockstrat-ui — offline Record-order control in OrderForm (/trader only)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `OrderForm` reads only `const { selectedAccountId } = useAccountContext()` (`OrderForm.tsx:49`) — it
  must also pull `accounts` to derive the selected account's broker type. Submit path is
  `usePlaceOrder()` → `placeOrder({..., accountId: selectedAccountId ?? ''})` (`OrderForm.tsx:80,85–96`),
  hook `usePlaceOrder.ts:7–12` → `tradingClient.placeOrder` → trader BFF `traderBff.ts:29–35`.
- Canonical offline detection: `const isOffline = account.brokerType === BrokerType.OFFLINE`
  (`accountShared.tsx:282`); identical to `PortfolioPanel`'s `showRealized` gate
  (`PortfolioPanel.tsx:27–28`). `BrokerType` import: `@xstockstrat/proto/common/v1/common_pb`.
- `OrderForm` has **four** mount points: `/trader` dashboard (`app/trader/page.tsx:32`, no
  `initialSymbol`), `/trader/orders` (`app/trader/orders/page.tsx:51`), `/trader/positions/[symbol]`
  (`app/trader/positions/[symbol]/page.tsx:335`, passes `initialSymbol`), and insights
  `SignalOrderTicket` (`components/insights/SignalOrderTicket.tsx:19`, passes `initialSymbol`). Two
  `/trader` mounts pass `initialSymbol`, so `initialSymbol` **cannot** distinguish the insights mount —
  an explicit prop is required.
- `recordOfflineOrder` (trading `trading.go:744`) records NEW with `LimitPrice: req.LimitPrice`,
  `OrderType: req.OrderType` verbatim, no broker submit — so the record control may send
  `orderType = MARKET` and map its optional fill price to `limitPrice`.
- The insights mount is deliberately excluded (design.md § A; C-10(a) both-instances) — the trading
  routing guard (Step 1) still guarantees FR-2 there regardless.

**TDD**: `red-green required` (e2e pairing in Step 7)

**Covers**: — (e2e coverage in Step 7)

**Instructions**:
1. Add an explicit prop to `OrderForm`: `allowOfflineRecord?: boolean` defaulting to `true`
   (extend `OrderFormProps`, `OrderForm.tsx:41–46`). The three `/trader` mounts inherit the default
   `true`; `SignalOrderTicket` passes `allowOfflineRecord={false}` (`SignalOrderTicket.tsx:19` — add the
   prop to the `<OrderForm ... />`).
2. In `OrderForm`, derive the selected account and offline flag from context: destructure `accounts`
   alongside `selectedAccountId` (`OrderForm.tsx:49`), then
   `const account = accounts.find((a) => a.id === selectedAccountId)` and
   `const isOffline = account?.brokerType === BrokerType.OFFLINE` (reuse the canonical pattern; do not
   re-derive broker labels — use `brokerLabel` from `@/lib/brokers` if a label is shown).
3. When `isOffline && allowOfflineRecord`, **replace** the broker BUY/SELL ticket JSX with a dedicated
   minimal **Record order** control: symbol + BUY/SELL side + quantity (required) + an optional fill
   price. **No** order-type Select, TIF, limit/stop/trailing inputs (design.md § A — the broker
   trailing-stop validation at `trading.go:359–367` runs *before* the offline branch at `:388`, so a
   reused broker form with Order Type = Trailing Stop would `InvalidArgument` and never persist NEW).
   Submit via the same `usePlaceOrder()` mutation with:
   `{ symbol: symbol.toUpperCase(), side: BUY|SELL, orderType: PbOrderType.MARKET, qty: parseFloat(qty), limitPrice: fillPrice ? parseFloat(fillPrice) : 0, stopPrice: 0, tradingMode: mode==='live'?LIVE:PAPER, accountId: selectedAccountId ?? '', clientOrderId }`
   — the explicit offline `accountId` makes the backend take the offline branch (recorded NEW). Keep the
   existing `clientOrderId` nonce lifecycle (`OrderForm.tsx:79,113`) and the disabled-when-no-account
   guard (`:212`). Label the control clearly (e.g. "Record order" / a distinct submit label) so the e2e
   can assert its presence and the broker ticket's absence.
4. When `!isOffline` (or `allowOfflineRecord === false`), render the existing broker ticket unchanged —
   broker accounts and the insights `SignalOrderTicket` behave exactly as today.

**Verification**:
- `cd services/xstockstrat-ui && pnpm build` — TypeScript/Next build passes (an exhaustive
  `Record<OrderType,…>` or enum map miss fails here).
- `grep -n "allowOfflineRecord" src/components/trader/OrderForm.tsx src/components/insights/SignalOrderTicket.tsx`
  — confirms the prop is declared and `SignalOrderTicket` passes `false`.
- `grep -n "brokerType === BrokerType.OFFLINE\|isOffline" src/components/trader/OrderForm.tsx` — confirms
  offline detection reuses the canonical pattern.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`.
- Behavioral e2e in Step 7.

---

### Step 6 — service: xstockstrat-ui — gate broker-only fields on !isOffline in PortfolioPanel (single + combined)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Single-account branch (`PortfolioPanel.tsx:21–98`) renders Equity (`:45–48`), Cash (`:49–52`), Buying
  Power (`:53–56`), Day P&L (`:57–61`), Total P&L (`:62`) **unconditionally**; Realized P&L is already
  offline-gated via `showRealized` (`:27–28,63–69`). The account and its `brokerType` are already in
  scope: `const account = accounts.find((a) => a.id === selectedAccountId)` (`:23`), and the
  `showRealized` gate already reads `account?.brokerType === BrokerType.OFFLINE` (`:28`).
- Combined branch (`:111–148`) renders a card per portfolio; the account is matched via
  `const account = accounts.find((a) => a.id === portfolio.accountId)` (`:114`) and it renders Equity
  (`:131–134`) and Day P&L (`:135–139`) — Day P&L is broker-only for an offline account.
- `Portfolio` proto carries no offline marker (recon § portfolio) — offline-ness is keyed on the
  **account's** `brokerType`, available via `useAccountContext` in both branches.

**TDD**: `red-green required` (e2e pairing in Step 7)

**Covers**: — (e2e coverage in Step 7)

**Instructions**:
1. **Single-account branch.** Compute `const isOffline = account?.brokerType === BrokerType.OFFLINE`
   (the `showRealized` gate at `:28` already reads exactly this — reuse one derived `isOffline` for both).
   Wrap Cash (`:49–52`), Buying Power (`:53–56`), Day P&L (`:57–61`), and Total P&L (`:62`) in
   `{!isOffline && ( … )}`. Keep Equity (`:45–48` — offline equity = summed position market value,
   portfolio `portfolio_service.go:1077`), the positions list + per-position unrealized P&L (`:71–90`),
   and the already-gated Realized P&L (`:63–69`). The offline card then shows exactly the FR-3 set
   (positions market value, unrealized P&L, account-grain Realized P&L).
2. **Combined branch.** For each combined card (`:113–148`), compute
   `const isOffline = account?.brokerType === BrokerType.OFFLINE` from the already-matched `account`
   (`:114`) and wrap the Day P&L `Stat` (`:135–139`) in `{!isOffline && ( … )}`. Keep Equity and the
   position-count line. (Cash/Buying Power are not rendered in the combined card today, so no change
   there; the exclusion of offline accounts from the *aggregate* is the backend Step 3/4 concern.) The
   offline combined card then shows only meaningful fields (FR-4 / @AC-4).
3. Do not re-derive broker labels — `brokerLabel` (`@/lib/brokers`) is already used at `:37,125`.

**Verification**:
- `cd services/xstockstrat-ui && pnpm build` — build passes.
- `grep -n "!isOffline" src/components/trader/PortfolioPanel.tsx` — confirms the gate is applied in both
  branches (single + combined).
- Lint: `cd services/xstockstrat-ui && pnpm run lint`.
- Behavioral e2e in Step 7.

---

### Step 7 — test: xstockstrat-ui — extend offline-accounts e2e for the record control + field gating

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (only if a shared default handler needs the
  offline+broker combined `listPortfolios` shape; prefer per-spec `page.route()` overrides as the
  existing spec already does)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a fixture is added/changed)

**Reviewers**: xstockstrat-ui — Trading UI correctness

**Codebase Evidence**:
- Existing suite `e2e/trader/offline-accounts.spec.ts` already injects offline responses via
  `page.route()` on the BFF Connect paths and imports `BROKER_ACCOUNT_ALPACA`,
  `BROKER_ACCOUNT_OFFLINE`, `PORTFOLIO_OFFLINE` from `../fixtures` and `addAuthCookie` from
  `../helpers/auth` (C-12/C-13 compliant). Fixtures: `BROKER_ACCOUNT_OFFLINE` (`e2e/fixtures/accounts.ts:47`,
  `brokerType: 3`), `PORTFOLIO_OFFLINE` (`e2e/fixtures/portfolios.ts:41`, carries `realizedPnl`, empty
  positions). Broker fixtures: `BROKER_ACCOUNT_ALPACA`, `PORTFOLIO_ALPACA`.
- Auth helpers: `addAuthCookie` / `addAdminCookie` / `addCookieWithRoles` (`e2e/helpers/auth.ts:65,70,51`).
- Mock `placeOrder` hardcodes `status: 3` FILLED (`e2e/mock-backend.ts:204`) — so the NEW-not-CANCELED
  guarantee is a **Go** assertion (Step 2), not an e2e one; the e2e asserts the **UI affordance** only.
- **This feature's** `@AC-1..@AC-4` are distinct from feature 157's ACs already covered in this file —
  cite 159's IDs.

**TDD**: `red-green required` (assert new UI behavior; fails against the pre-Step-5/6 tree)

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions** (reuse existing fixtures + auth helpers; scenario one-off overrides via `{ ...FIXTURE, override }` are C-12-exempt — state that):
1. **@AC-1 (UI half).** With an offline account selected on `/trader`, assert the broker order ticket
   (Order Type Select / limit / trailing-stop inputs, or the broker submit label) is **not** present and
   the dedicated **Record order** control **is** present (symbol/side/qty/optional fill price). Add a
   second assertion that on the insights `SignalOrderTicket` mount
   (`/insights/market/[symbol]`) with an offline default account the Record-order control does **not**
   appear (the broker ticket remains) — C-10(a) both-instances / the deliberate insights exclusion.
2. **@AC-2 (FR-3).** With an offline account selected on `/trader` Book, assert the portfolio card does
   **not** render Cash, Buying Power, or Day P&L, and **does** render Equity (positions market value),
   per-position unrealized P&L, and Realized P&L (reuse `PORTFOLIO_OFFLINE`).
3. **@AC-3 + @AC-4 (FR-4, combined view).** Drive the combined/all-accounts view by selecting "all
   accounts" (no `selectedAccountId`) and route `ListPortfolios` to return **both** a broker portfolio
   (`PORTFOLIO_ALPACA`) and the offline portfolio (`PORTFOLIO_OFFLINE`). Assert: the offline account
   appears as its own card (@AC-4 — visible, not absent) showing only Equity/positions and hiding Cash/
   Buying Power/Day P&L; and the broker card still shows its broker figures (so the offline card's hidden
   fields are a per-account gate, not a global one — supporting @AC-3's "aggregates exclude offline").
4. Keep all domain objects sourced from `e2e/fixtures/` and auth from `e2e/helpers/auth.ts`; if the
   combined-view scenario needs a broker+offline `listPortfolios` payload not already expressible from
   fixtures, compose it from `PORTFOLIO_ALPACA` + `PORTFOLIO_OFFLINE` inline (scenario one-off, C-12
   exempt) rather than adding a new fixture. Update `INVENTORY.md` only if a reusable fixture is
   actually added or changed.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- offline-accounts` — the new @AC-1..@AC-4 assertions
  pass (and fail against the pre-Step-5/6 tree). No coverage threshold applies to `xstockstrat-ui`
  (e2e is the pairing).
- Lint: `cd services/xstockstrat-ui && pnpm run lint`.
- C-12: `grep -n "from '../fixtures'\|helpers/auth" e2e/trader/offline-accounts.spec.ts` — confirm
  fixture + auth imports; confirm `INVENTORY.md` touched only if a fixture changed.

---

### Step 8 — docs: keep trading + portfolio CLAUDE.md accurate for the two new backend behaviors

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-trading/CLAUDE.md`, `services/xstockstrat-portfolio/CLAUDE.md`)
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Trading `CLAUDE.md` states the persisted halt "blocks `PlaceOrder`/`ReplaceOrder` — never
  `CancelOrder`, the operator's sole remaining manual de-risk tool" (§ Role, bracket paragraph) and
  documents `PlaceOrder`'s offline branch (feature 157). Step 1 adds an **offline-specific** CancelOrder
  reject (distinct from the halt gate) and an authoritative persisted-type routing read in PlaceOrder —
  a behavior the doc should name so the "never CancelOrder" statement is not read as "CancelOrder never
  rejects anything".
- Portfolio `CLAUDE.md` § Role / § Database describes offline accounts having no `account_balances` row;
  Step 3 makes `ListPortfolios`' all-accounts view enumerate offline accounts too (C-10(b) parity).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In `services/xstockstrat-trading/CLAUDE.md`, add a concise note (near the offline/feature-157 and
   CancelOrder mentions) that: `PlaceOrder` routes on the **authoritative persisted** `broker_type`
   (union with the pool tag) so an offline account can never be broker-routed; and `CancelOrder` rejects
   an **offline** order with `FailedPrecondition` (offline orders are managed via `ConfirmOrder`, not
   broker-cancel) — clarify this is an offline-type guard, orthogonal to the halt gating, which remains
   "CancelOrder is never halt-gated".
2. In `services/xstockstrat-portfolio/CLAUDE.md`, note that the `ListPortfolios` all-accounts view
   enumerates `account_balances` ∪ offline accounts (`offline_account_realized`), so an offline account
   is **shown** in the combined view (meaningful-only fields; excluded from cash/BP aggregates), closing
   the `ListPositions`↔`ListPortfolios` C-10(b) parity gap.
3. Keep edits surgical — do not restructure the files; only correct/extend the affected statements.
   Per the root CLAUDE.md teardown norm, run `/context-scrubber scan` scoped to these two files (and any
   other context file whose described behavior changed) before the integration PR; if the context-forge
   plugin is unavailable, say so in the PR body.

**Verification**:
- `grep -n "CancelOrder" services/xstockstrat-trading/CLAUDE.md` — confirms the offline-cancel-guard note
  is present and distinct from the halt-gating statement.
- `grep -n "offline_account_realized\|combined\|all-accounts" services/xstockstrat-portfolio/CLAUDE.md`
  — confirms the offline-in-combined note is present.

---

## Deviation Log

### Step 1 — nil `accountRepo` defensive fallback in guard B
- **What**: Guard B reads `s.accountRepo.GetBrokerAccount`. Several existing service tests (e.g.
  `trading_bracket_test.go:510` `TestIsAccountHalted_GateBlocksPlaceOrderAndReplaceOrder`) construct a
  `TradingService` literal with **no** `accountRepo` and call `PlaceOrder`; since guard B runs before the
  halt gate, a nil `accountRepo` panicked. Wrapped the authoritative read in `if s.accountRepo != nil`,
  falling back to the pool-tag-only decision — the same best-effort behavior the guard already applies on
  a DB read error.
- **Why in scope**: change stays in the step's only file (`trading.go`); it makes the step's own new code
  robust to a partially-constructed service. In production `NewTradingService` always wires `accountRepo`,
  so the nil branch is test-only and behavior-preserving.
- **Disposition**: in-step fix (Phase 3 clear-fix path); no scope expansion, no other file touched.

### Step 4 — pure-helper test instead of a repository-double ListPortfolios test
- **What**: The spec instructed testing `ListPortfolios` via a repository double. Portfolio's `s.repo` is
  a concrete `*repository.PortfolioRepo` (no interface, no fake), and the TDD gate forbids starting a DB,
  so a service-level `ListPortfolios` call is untestable here — the same un-fakeable-repo constraint the
  existing `TestPositionSyncPayload_RealizedPnlDisjointness` documents. Step 3's union+dedup was therefore
  factored into a pure helper `offlineIDsToAppend(balanceAccountIDs, offlineIDs)`, and Step 4 unit-tests
  that helper red→green (balances {brk-1} + offline {off-1, brk-1} → {off-1}; empty offline → none; repeats
  collapse). The SQL `ListOfflineAccountIdsByUser` (in the coverage-excluded `repository` package) and the
  `bal == nil` → Cash/BP/DayPnl=0 behavior are verified by build + grep + inspection.
- **Why**: operator-approved at the checkpoint (context.md); matches the service's established
  pure-helper testability pattern (feature 157's own offline tests assert on parsed inputs, not the
  DB-backed service). @AC-3 (offline excluded from summed cash/BP) and @AC-4 (offline visible in
  combined) are additionally covered end-to-end by the Step 7 e2e.
- **Disposition**: sanctioned deviation (user-approved); no DB started; stays within Steps 3/4 files.

### Step 6 — scope expanded to /trader/portfolio/page.tsx (the real Book combined surface)
- **What**: Recon/design scoped the FR-3/FR-4 UI gating to `PortfolioPanel.tsx`, but discovery at Step 7
  found `PortfolioPanel`'s combined branch is not normally reached (AccountContext auto-selects the first
  active account), and the actual Book combined surface is `src/app/trader/portfolio/page.tsx`
  (`usePortfolios(null)`, a combined StatTile aggregate + one `<Field>` card per account) — the likely
  locus of defect 2's misleading "$594k Buying Power". Its per-account offline card showed Cash / Buying
  power / Day P&L / Total P&L unconditionally. Added that file to Step 6 and gated those four `<Field>`s on
  `!isOffline` (kept Equity + Positions), matching the PortfolioPanel change. The combined StatTile row is
  already correct — an offline account contributes 0 cash/BP/dayPnl to the reduce, so the aggregates
  exclude it (FR-4/@AC-3) with no code change there.
- **Why (P-03, surfaced not buried)**: gating only PortfolioPanel would have shipped FR-3 incomplete on
  the surface users actually see. Operator approved expanding Step 6 at the Step-7 checkpoint.
- **Disposition**: sanctioned deviation (user-approved); Step 6 Files expanded by
  `src/app/trader/portfolio/page.tsx`; tsc + lint clean; e2e assertion added in Step 7.
- **Reachability note (P-03)**: `PortfolioPanel`'s own combined branch remains gated but is effectively
  a no-account-selected fallback (auto-select makes it rare); the Book page is the real combined surface.
