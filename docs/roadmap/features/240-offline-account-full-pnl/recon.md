# Recon: offline-account-full-pnl

**Created**: 2026-10-19
**From**: product-spec.md (spec-ready, 9 FRs, AC-1..AC-40)
**Affected services**: packages/proto, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata (consumed only), xstockstrat-ui, xstockstrat-agent

---

## Objective

Bring offline (`BROKER_TYPE_OFFLINE`) accounts up to full P&L parity:
- broker-style Day P&L for the reference session;
- Total P&L built on lifetime realized, with a return % over Σ|cost basis|;
- per-order fees shown as a separate line, with realized P&L gross and net;
- lifetime realized carried across snapshots alongside the since-snapshot figure;
- a last-daily-close mark fallback with provenance (`MarkSource`).

All of it must be the same on every portfolio read path and reach the `/trader` surfaces and the MCP tools. Broker accounts change in only two deliberate places: the short-% fix and Day/Total P&L in `GetPortfolio`.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - ConfirmOrder: `internal/service/trading.go:890`.
    - Validation `:891-894`: `FilledQty<0` → InvalidArgument; price is not validated.
    - Offline gate `:906`, owner guard `:910`.
    - Replace semantics `:920-928`, `deriveOfflineStatus` `:863`, `repo.UpsertOrder` `:930`, recompute `:938`. A recompute error is only logged.
  - Per-account lock: `confirmLock(accountID)` `trading.go:850` (`confirmLocks map[string]*sync.Mutex` `:160-161`, init `:238`). Held by ConfirmOrder `:915-917` and SnapshotOfflinePositions `:1121-1123`.
  - `recomputeAndEmitOfflinePositions` `trading.go:947` (the caller holds the lock):
    - Inputs: `EffectiveBaselineByAccount` `:949` (`offline_baseline_repo.go:51`, greatest `as_of`, tie on `max(created_at)`) and `ListConfirmedOfflineOrdersByAccount` (`trading_repo.go:330`, `ORDER BY filled_at ASC NULLS LAST, created_at ASC` `:341`).
    - Folding: with a baseline, only `filled_at > as_of` fills go through `pnl.FoldFrom` `:968-977`; otherwise `pnl.Fold` `:980`. `offlineFillsFromOrders` `:876` produces `pnl.Fill{Symbol, signed Qty, Price}` with no time and no fee.
    - Emit: `account.positions.synced` as a `map[string]interface{}` `:999-1039`. Each position carries `symbol, qty, avg_cost, current_price=0, market_value=0, unrealized_pl=0, unrealized_plpc=0, day_pnl=0, day_pnl_pct=0, source, as_of`. The top level carries `account_id, user_id, trading_mode, positions, realized_pnl` `:1038`.
    - Emits only `account.positions.synced`, never `order.filled` `:1031-1033` (the disjointness invariant).
  - SnapshotOfflinePositions `trading.go:1046`:
    - Validate `:1047-1106`, owner check `:1068`, offline gate `:1071`, unconfirmed-order warning `:1112`.
    - Under the lock: `UpsertBaselineSnapshot` `:1125`, then emit `account.positions.baseline_set` `:1138`, then recompute `:1146`.
    - `UpsertBaselineSnapshot` (`offline_baseline_repo.go:20`) is a transaction that DELETEs the same `client_snapshot_id` and INSERTs the rows. Older snapshots are kept. The realized reset is implicit: the fold restarts after `as_of`.
  - Repo: `UpsertOrder` `trading_repo.go:53`; the ON CONFLICT SET list is at `:77-85` (next placeholder `$23`). `scanOrder` `:364` builds the Order proto inline from 22 columns (`:389-423`).
    - SELECT lists to extend: `GetOrder` `:110-113`, `ListOrders` `:216-219`, in-flight `:301-304`, `ListConfirmedOfflineOrders` `:332-335`.
    - `nullableFloat` `:476` maps 0 to NULL, so it cannot write an explicit 0 fee.
    - Mock columns: `internal/testdata/order_rows.go:15`.
  - GetOrder `trading.go:1489` (cache clone or repo) and ListOrders `:1506`. Neither has its own mapper; both use `scanOrder` / the cached proto.
  - Ledger emit: `emitLedgerEvent` `trading.go:3571`, via `structpb.NewStruct`. A marshal error is discarded. Timeout 10s.
  - Broker fees: `applyBrokerOrderStatus` `trading.go:1690` emits `"fees"` on `order.filled`/`partially_filled` (`:1723-1747`). They are not persisted.
  - Last migration: `010_normalize_tif`. Next: **011**. Schema: `trading.orders` (001; `account_id`/`broker_type` 003; `filled_at` 008). `offline_position_baselines` 009: `(account_id, client_snapshot_id, as_of, symbol, qty, avg_cost_per_share, created_at)`, PK `(account_id, client_snapshot_id, symbol)`.
- **`xstockstrat-portfolio`** (Go)
  - Sync consumer: `consumeEventStream(..., "account.positions.synced", ...)` `portfolio_service.go:1019-1021`.
    - Payload struct `positionSyncPayload` `:989-1015`. `RealizedPnl *float64` `:1014`: nil means broker, set means offline.
    - `processPositionSync` `:1078-1136`, under `positionsMu` `:1095`:
      - `UpsertPositionFromSync` per row `:1116` (`portfolio_repo.go:318-335`; `cost_basis = qty*avg` total-signed; never touches `realized_accum`/`fees_accum`).
      - Delete guard `shouldReconcileSyncDeletions` `:1074-1076`, then `DeletePositionsNotInSync` `:1122` (`repo:350-367`).
      - `UpsertOfflineRealized` `:1131-1134` (`repo:456-464`, full replace).
  - Offline marker: an `offline_account_realized` row (`ListOfflineAccountIdsByUser` `repo:523`). A broker account has an `account_balances` row (`AccountBalance{Cash,BuyingPower,Equity,LastEquity}` `repo:381-386`). Portfolio has no `broker_type`.
  - Enrichment:
    - `latestQuotesFor` `:392-408` returns `(map, ok)` and logs WARN "batch latest quotes unavailable" `:401`.
    - `quoteTimeout` `:411-420` reads `portfolio.marketdata.quote_timeout_ms`, default 4000.
    - `unvaluedSymbols` `:424-438` skips `CurrentPrice>0`, i.e. broker-valued positions.
    - `enrichPositions` `:440-444`; `applyQuotes` `:448-464` (WARN "no usable price" `:459`).
    - `enrichPosition` `:547-555` holds the short-% bug: `if p.CostBasis > 0` `:552-553`.
  - Read paths:
    - `GetPortfolio` `:570-598`: Equity = ΣMV and `RealizedPnl` only. It sets no Day/Total P&L and does no balance lookup.
    - `GetPosition` `:601`; `ListPositions` `:612`.
    - `GetPnL` `:641-772`: UNAVAILABLE on `!ok` `:649` or on any `CurrentPrice<=0` `:655`. `ErrQuotesUnavailable` `:637`.
    - `buildAccountPortfolio` `:1230-1260`: TotalPnl = Σunrealized; broker `DayPnl = Equity−LastEquity`, with pct guarded by `LastEquity>0`.
    - `ListPortfolios` `:1264-1346`: a single-account path, and an all-accounts path with an offline branch `:1320-1331` and one union quote batch `:1338`.
    - `broadcastSnapshot` `:827-871`.
  - Marketdata client: built at `:123-130`. Its only RPC is `GetLatestQuotes` `:399`. The test `stubMarketData` (`portfolio_service_test.go:18-44`) embeds a nil interface, so any other RPC panics.
  - Fees path: `orderFillPayload.Fees` `:254` → `UpsertPosition(..., fill.Fees)` `:355` → `fees_accum += $9` (`repo:60-68`).
  - Ledger consumers (`cmd/server/main.go:64-69`): `order.filled`, `account.positions.synced`, `account.balance.synced`, `order.bracket_updated`, `account.deregistered` `:1032`. The stream replays from sequence 0 on every boot (`lastSeq` starts at 0).
  - Last migration: `016_account_balance_peak_equity`. Next: **017**. Migration 012 is `offline_account_realized(account_id PK, user_id, trading_mode, realized_pnl DOUBLE PRECISION, updated_at)`.
  - Tests:
    - `portfolio_quote_deadline_test.go` (pgxmock harness `newQuoteSvc` `:87`, `posRow` `:78`, AC-1/AC-5 tests).
    - `portfolio_offline_test.go:183`: a structural parity test only. There is **no value-level read-path parity test**.
    - There is no `internal/testdata/` fixture home.
- **`xstockstrat-marketdata`** (Go, consumed unchanged)
  - Proto (`marketdata.proto`):
    - `BatchGetBars` `:51`. Request `:324-330`: `symbols, timeframe (string), start, end, max_bars_per_symbol`. Response is `SymbolBars{symbol, bars}`.
    - `BatchGetLatestPrice` `:54`. `LatestPrice` `:106-112`: `last_price` (a trade, not a quote), `optional prev_close`. It has no session date and no timestamp.
    - `GetLatestQuotes` `:48` (partial results).
  - `prev_close` is the second-newest stored `1d` row with no time bound (`marketdata_repo.go:452-464`, `rn = 2`). It is **not session-aware**: it shifts depending on whether today's daily bar has been stored yet.
  - `BatchGetBars`:
    - `marketdata_service.go:654-763` accepts only `1d`. The repo query (`marketdata_repo.go:430-432`) returns the **oldest** bars first, so a "latest close" read needs a tight `start`.
    - On a miss it does a live fetch under the caller's context with **no detached budget**. A failed fetch fails the whole RPC (`:740-741`).
    - Result order is unspecified.
  - Daily bars live in `marketdata.ohlcv(symbol, timeframe '1d', time, close NUMERIC)`. `time` is Alpaca's `t`, stored unchanged; whether that is UTC midnight or New York midnight is **not verified**.
  - Coverage: backfilled symbols, the warm set (`GetLatestQuotes` marks a symbol warm), and the 5-minute `1d` ingester `:1155-1176`.
- **`xstockstrat-ui`** (Next.js)
  - `PortfolioPanel.tsx` (ListPortfolios via `usePortfolios` `hooks/usePortfolio.ts:21-27`):
    - `isOffline` `:27`/`:124`.
    - Single view: `showRealized` gate `:30`; `!isOffline` hides Cash/BP/Day/Total `:51-68`; inline Day formatting `:63`; Total `:66`; "Realized P&L" `:71`.
    - Combined view `:117-161`: per-account cards and no summed totals.
  - Book `app/trader/portfolio/page.tsx` (ListPortfolios(null)):
    - Combined totals already sum `dayPnl`/`totalPnl` across all accounts `:37-46`.
    - The offline card shows only Equity `:200` and Positions `:220-225`; `!isOffline` hides the rest `:201-219`.
  - Positions list `app/trader/positions/page.tsx` (ListPositions): "Today's P/L ($)" `:191-197`, "Today's P/L (%)" `:200-206`, "Total P/L (%)" `:220-228`, sheet `:627-634`.
  - Detail `positions/[symbol]/page.tsx`:
    - `usePosition` (GetPosition) `:111`; `usePortfolio` (GetPortfolio, equity only) `:363`.
    - "Day P&L" `:796-798`, `:843-848`, `:893-898`; unrealized % `:819-821`.
    - The only stale badge is Fundamentals `:1067-1069`.
  - Formatting:
    - `lib/money.ts` `fmtUsd` `:4`, `fmtSignedUsd` `:13` (renders `$-50.00`, which contradicts its docstring), `fmtPct` `:19`, `pnlClass` `:26`.
    - `Stat` (`components/shared/Stat.tsx:2-10`, takes a string value); `StatTile` (`StatTile.tsx:5-15`).
    - Badge variants including `warning`/`info` (`ui/badge.tsx:11-26`). Badge+Tooltip pattern: `HaltBadge.tsx:6,17-25`.
    - Dates: `lib/protoTime.ts` `timestampToDate` `:16`; `fmtShortDate` is UTC-only `:24`. There is **no America/New_York helper**.
  - BFF: `lib/traderBff.ts:65-70` forwards getPortfolio, listPortfolios, listPositions, getPosition. The browser receives protobuf-es messages; an unset `optional` field is `undefined`.
  - Tests:
    - `e2e/trader/offline-accounts.spec.ts`: asserts `'Realized P&L'` `:73,:98`, and asserts "Day P&L" count 0 at `:214-230` and `:233-254` (these must flip).
    - `portfolio.spec.ts`, `positions.spec.ts`, `position-detail.spec.ts`, `valuation-parity.spec.ts`.
    - `mock-backend.ts`: getPortfolio inline `:345-358`, listPortfolios `:359`, listPositions `:363`, getPosition `:368`.
  - Fixtures:
    - `e2e/fixtures/portfolios.ts`: `PORTFOLIO_OFFLINE` (realizedPnl 97.5) `:41-49` is **not** in `PORTFOLIOS` `:54`.
    - `positions.ts`: Alpaca-only, no `dayPnl` set.
    - `INVENTORY.md` rows `:15,:16,:39`.
- **`xstockstrat-agent`** (Python)
  - `manage_offline_account` `app/tools.py:2034-2132`:
    - Flat parameters, with no `fees`. Docstring `:2053-2084`.
    - `confirm_order` → `client.confirm_offline_order` (`client.py:2245-2272`). The list in the unknown-operation error is at `:2125-2128`.
  - `get_positions` `tools.py:2238-2257` and `get_positions_by_account_id` `:2259-2285` both go through `client.list_positions` (`client.py:2351-2373`).
  - Serialization: `MessageToDict(preserving_proto_field_name=True)` (`client.py:2166-2168`, `:2368`). Zero or unset non-optional fields are dropped; enums become NAME strings.
  - Tool-count surfaces (45): `tools.py:4`; `CLAUDE.md:44` (rows `:83`, `:87`); `mcp-tools.md:3,:45` (sections `:1317`, `:1421`, `:1440`); `test_tools_endpoint.py:14`; `ui/src/lib/copilot.ts:21`; `acceptance/remove-agent-postgres-mcp.feature:14`. This feature adds **no tool**, so the count is unchanged.
  - `tests/test_position_parity.py:13-39` freezes the 23 Position fields; new Position fields **must** be added there.
- **`packages/proto`**
  - `pnl/pnl.go`: `RealizedDelta` `:10`, `Fill{Symbol,Qty,Price}` `:24`, `Lot{Qty,CostBasis}` `:31`, `FoldResult{Positions, Realized}` `:37`, `Fold` `:45`, `FoldFrom` `:51`. There is no per-symbol or per-fill realized and no time.
  - Next free fields: `Portfolio` 13, `Position` 24, `Order` 23, `ConfirmOrderRequest` 6. `PositionSource` `portfolio.proto:124-129`. `TIMEFRAME_1DAY = 4` (`common.proto:89`).
  - `buf.yaml` lint is STANDARD, so enum-value prefixes are enforced. CI's `buf breaking` **excludes `trading/v1/trading.proto`** (`ci.yml:135`, a temporary skip).

## Patterns to REUSE

- **Offline state is recomputed as an absolute snapshot, never an incremental fold** (insights `157` and `fails.md:2121`): trading recomputes from its source of truth under `confirmLock` and emits `account.positions.synced`. Any new per-session data should travel the **same** absolute path (additive payload fields), not a new incremental event.
- **No portfolio→trading read edge.** trading→portfolio already exists, so the reverse edge would create a boot cycle (insights 083 `:426-435`). Portfolio must get session-fill data from the ledger payload, not by calling trading.
- **Per-account lock + lock-free body** (`recomputeAndEmitOfflinePositions` called under `confirmLock`, insights `2500`). The snapshot carry runs inside the same lock and the baseline transaction.
- **Presence-typed account-grain values** (`optional double realized_pnl` plus a `*float64` payload pointer; `GetOfflineRealized` → `proto.Float64`). Reuse this for lifetime realized, fees and `total_pnl_pct`.
- **Bounded, batched quote read** (`latestQuotesFor` + `quoteTimeout`). The close/prev-close read should be a sibling batched call under the same deadline, issued concurrently, with its partial-failure aggregate stated.
- **Signed-average-cost math** (`pnl.Fold`/`FoldFrom`/`RealizedDelta`). Day P&L and the carry reuse it rather than re-deriving cost.
- **`buildAccountPortfolio`** is the single per-account summary builder. Make `GetPortfolio` reuse it rather than duplicating the Day/Total rules.
- **UI:**
  - `fmtSignedUsd`/`fmtPct`/`pnlClass` (`lib/money.ts`), `Stat`/`StatTile`.
  - Badge `warning` + Tooltip as in `HaltBadge.tsx` for the "Last close" / "No price" indicator.
  - `timestampToDate` (`lib/protoTime.ts`) plus a new America/New_York date formatter beside it.
  - Fixtures: `PORTFOLIO_OFFLINE`, `BROKER_ACCOUNT_OFFLINE`, `POSITION_*` (C-12). Add an offline Position fixture and catalog row.
- **Agent:** `MessageToDict` pass-through. New `optional` proto fields appear automatically. Extend `test_position_parity.py` and `test_offline_client.py`.
- **Tests:** the portfolio pgxmock harness (`newQuoteSvc`, `posRow`) for the value-level parity test (FR-9); the trading `trading_offline_test.go` `extractPositionsSynced` `:590` for payload assertions.

## Existing Business Rules (preserve / extend)

The digest comes from the `scenario-recon` pass: 57 relevant rules (44 PRESERVE, 6 EXTEND, 3 CHANGE, all signed off), plus 1 flag.

- **CHANGE** `@AC-1 @feature-229` "Portfolio reads return unenriched positions when the quote fetch exceeds its deadline" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`): offline positions now fall back to the last close. The deadline is kept. Signed off (context.md round 1). Keep the WARN log line.
- **CHANGE** `@AC-2`, `@AC-4 @feature-159` (`services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature`): offline cards now add Day/Total P&L. Cash, Buying Power and broker Day P&L stay hidden. Signed off (round 2).
- **EXTEND**:
  - `@AC-14 @feature-163` (portfolio snapshot suite): the reset is kept and lifetime realized is added.
  - `@AC-12 @feature-157` (portfolio): adds the signed short %.
  - `@AC-5 @feature-157` (trading): ConfirmOrder takes `fees`.
  - `@AC-13 @feature-157` (UI): the row is relabelled "Realized (since snapshot)".
  - `@AC-6 @feature-157` (agent): `confirm_order` takes `fees`.
- **PRESERVE (key ones the design must actively protect)**:
  - Portfolio:
    - `@AC-5`/`@AC-6 @feature-229`: GetPnL is unchanged.
    - `@AC-1 @feature-178`: one batched GetLatestQuotes; the close fetch must add no quote calls.
    - `@AC-7 @feature-157`: offline goes only through `account.positions.synced`, and the payload stays additive.
    - `@AC-10 @feature-157`: a re-confirm never double-counts, including fees.
    - `@AC-11 @feature-157` and `@AC-4 @feature-163`: realized stays gross.
    - `@AC-14 @feature-157`: broker figures are unaffected by offline accounts.
    - `@AC-12 @feature-163`: provenance matches across reads; `mark_*` stays separate from `source`/`as_of`.
    - `@AC-4 @feature-206`: the broker/offline sync discriminator stays the presence of `realized_pnl`.
  - Trading:
    - `@AC-6 @feature-163`: a same `client_snapshot_id` re-submit replaces the snapshot and **must not double-carry**.
    - `@AC-7 @feature-163`: a partial row reject still commits, atomically with the carry.
    - `@AC-9 @feature-157`/`@feature-163`: broker accounts are rejected.
    - `@AC-16 @feature-163`: NEW orders are excluded.
  - Marketdata: `@AC-2`/`@AC-3`/`@AC-4`/`@AC-5 @feature-191` (batch omissions mean absent, never 0); `@AC-8 @feature-196` (read `timeframe_enum`).
  - UI: `@AC-3 @feature-159` (combined Cash/BP exclude offline); `@AC-2 @feature-188` (detail header shows the prior-day OHLC; must not contradict `previous_close`); `@AC-2`/`@AC-11 @feature-095` (a `LAST_CLOSE` mark must never feed the live-price header); `@AC-11 @feature-031` (the `cost_basis` on the close event stays signed).
  - Agent: `@AC-1`/`@AC-6`/`@AC-8 @feature-197` (correlation join text and the runbook parity test).
  - Platform: `@AC-15 @feature-157` and `@AC-18 @feature-163` (deregistering purges, including any new carry/fee storage); `@AC-10 @feature-029` (broker fees flow through `fees_accum`; offline fees never do).
- **FLAG (possible unsigned CHANGE)** `@AC-4 @feature-178` "A symbol with no quote maps to the same missing outcome under batching" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature:26-31`). FR-5 gives an offline position with no quote but with a bar a last-close mark. Design must either argue the rule is about batch-vs-serial parity plus never-zero (still held, and broker positions are unaffected) or obtain sign-off.

## Dependencies

- **Proto/RPC** (additive):
  - `ConfirmOrderRequest.fees` (6) and `Order.fees` (23), both `optional double`.
  - `Portfolio` 13–16: `total_pnl_pct`, `realized_pnl_lifetime`, `fees_since_snapshot`, `fees_lifetime`, all `optional`.
  - `Position` 24–25: `mark_source`, `mark_as_of`.
  - New enum `MarkSource`.
  - Marketdata RPCs consumed: `BatchGetBars` and/or `BatchGetLatestPrice`, both new to portfolio.
- **Ledger payload**: `account.positions.synced` gains additive offline fields: fees, carry/lifetime and session-fill data, shape per design. `account.positions.baseline_set` is already emitted.
- **Migrations**:
  - trading **011**: `orders.fees NUMERIC(18,8)` nullable, plus wherever the carry lives.
  - portfolio **017**: `offline_account_realized` columns.
  - Recheck against remote branches at `/sdd-spec`.
- **Config keys**: none new. Reuses `portfolio.marketdata.quote_timeout_ms`.
- **Inter-service edges**: portfolio → marketdata (new RPCs on an existing edge). There is **no** new edge, and portfolio→trading is forbidden.
- **New env vars / ports**: none.

## Risks / Not-found

- **R1 (central fork): Day P&L needs per-session fill data that portfolio does not have.** The `account.positions.synced` payload carries only net qty, avg cost and account realized. No event carries offline `filled_at`/qty/price. The session also rolls over without any event, so Day P&L cannot be a value trading computes once; it must be computed at read time from data portfolio stores.
- **R2: there is no market calendar or America/New_York helper anywhere** (Go, Python and TS). Holidays and early closes are unsupported; marketdata's own code only counts weekdays (`marketdata_service.go:1314`).
- **R3: `prev_close` is not session-aware** (the second-newest `1d` row). Alpaca's daily-bar timestamp convention is unverified. Using either for `previous_close` or the reference-session close needs an explicit session-date mapping.
- **R4: `BatchGetBars` has no detached budget, and a live-fetch failure fails the whole RPC.** It needs a caller deadline, and a failure must degrade to "no bar" per symbol, never fail the read (FR-5, AC-27).
- **R5: `ListConfirmedOfflineOrdersByAccount` lacks `DISTINCT ON (order_id)`** (compare `NetFilledQtyBySymbol` `trading_repo.go:168`). Multiple rows for one order would be double-folded, which matters more once fees are summed. This is a latent defect; record it in findings and decide whether this feature fixes it.
- **R6: carry idempotency.** Re-submitting the same `client_snapshot_id` must not carry twice (`@AC-6 @feature-163`), and the snapshot transaction is in trading while realized lives in portfolio (OQ-2).
- **R7: error precedence** when a broker-account ConfirmOrder also carries `fees < 0` (`FailedPrecondition` vs `INVALID_ARGUMENT`).
- **R8: a stale or zero-time quote** returned by marketdata (`@AC-7 @feature-229`) would become `MARK_SOURCE_QUOTE` with an old `mark_as_of`. Decide whether a quote older than the reference session counts as "no live quote".
- **R9: `nullableFloat` maps 0 to NULL**, so the fees writer needs a presence-preserving helper. FR-7 requires an explicit 0 for confirmed orders.
- **R10: CI `buf breaking` skips trading.proto.** Do not rely on CI to catch a trading.proto break; run `buf breaking` manually per C-09.
- **R11: the `fmtSignedUsd` sign-placement drift** (`$-50.00`) affects every new negative P&L render. Surface it as a finding and do not silently fix it (behaviour #3).
- **R12: the UI's `PORTFOLIO_OFFLINE` fixture is not in `PORTFOLIOS`, and there is no offline Position fixture.** Both are needed for AC-14..16, 30..32 (C-12).
- **Ledger traps**:
  - `fails.md:2029` (snapshot lock).
  - `fails.md:2041` (no synthetic fills for baselines).
  - `fails.md` 172 (`portfolio.snapshots.equity` is cashless).
  - `fails.md` quote-fanout-batching (state the partial-failure aggregate).
  - `fails.md:1921` (verify the tool count from the registered name-set).
  - `fails.md:213` (migration number collisions across branches).

## Recommended Scope

Advisory:
1. Proto additions plus `buf-gen`.
2. Trading migration 011 (fees, plus carry storage if trading owns it) and the repo/scan changes.
3. Trading ConfirmOrder fees (validation and preserve-on-omit), the recompute payload (fees, carry/lifetime, session-fill data) and the snapshot carry.
4. Portfolio migration 017 and the consumer (store the new payload fields).
5. Portfolio valuation: a close/prev-close batch beside quotes, `MarkSource`, Day P&L at read time, the short-% fix, Total P&L/%, and `GetPortfolio` via `buildAccountPortfolio`.
6. A value-level parity test across the read paths.
7. Agent `fees` argument, tests, runbook and CLAUDE.md.
8. UI: the PortfolioPanel single and combined views, the Book card, the positions list/detail and the stale indicator, with fixtures and e2e tests.
9. Docs: service CLAUDE.md files and the context-constitution findings (R5, R11).
