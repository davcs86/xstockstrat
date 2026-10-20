# Design: offline-account-full-pnl

**Created**: 2026-10-20
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-10-20 (final gate, round 5)
**Grounded in**: recon.md

---

## Chosen Approach

Trading stays the source of truth for offline P&L inputs. It extends its absolute
`account.positions.synced` recompute with additive offline-only fields: fees since snapshot, the frozen
lifetime carry from a new snapshot-header table, and a calendar-free 10-day list of recent fills.
Portfolio stores those fields by full replace. At read time it computes marks, Day P&L, Total P&L and
return % in one shared valuation step, used by `GetPortfolio`, `GetPosition`, `ListPositions` and
`ListPortfolios`, and it alone owns the market calendar. Marketdata's `BatchGetBars` gains an opt-in
`allow_partial` mode. Portfolio sets it; analysis and every other caller keep today's behaviour.
`GetPnL` and the persisted snapshot series are untouched, apart from the shared short-% fix.

**Consumer surfaces (C-14):**
- **UI `/trader`:** PortfolioPanel (single and combined), the Book offline card, the positions list and
  detail pages, and the ConfirmFillDialog label (§6).
- **Agent:** `manage_offline_account` and `get_positions`/`get_positions_by_account_id` (§5).

### 1. Proto (additive)

**trading.** CI excludes `trading/v1/trading.proto` from `buf breaking` (`ci.yml:135`), so run `buf breaking` on it by hand.
- `ConfirmOrderRequest.fees = 6` (`optional double`).
- `Order.fees = 23` (`optional double`). Broker orders leave it unset.

**portfolio**
- `Portfolio` gets fields 13–16, all `optional double`: `total_pnl_pct`, `realized_pnl_lifetime`, `fees_since_snapshot`, `fees_lifetime`.
- `Position` gets field 24 `MarkSource mark_source` and field 25 `google.protobuf.Timestamp mark_as_of`.
- New enum `MarkSource {MARK_SOURCE_UNSPECIFIED=0, QUOTE, LAST_CLOSE, BROKER, NONE}`.

**marketdata**
- `BatchGetBarsRequest.allow_partial = 6` (`bool`). Fields 1–5 are already taken (`marketdata.proto:324-330`).
- `BatchGetBarsResponse` is unchanged.

### 2. Trading

#### 2.1 Migration `011_offline_fees_snapshot_headers`

The spec calls this migration `011_offline_order_fees`; that name is out of date.

```sql
ALTER TABLE trading.orders ADD COLUMN IF NOT EXISTS fees NUMERIC(18,8);
UPDATE trading.orders SET fees = 0
 WHERE broker_type = 3 AND status IN ('partially_filled','filled') AND fees IS NULL;
CREATE TABLE IF NOT EXISTS trading.offline_snapshot_headers (
  account_id TEXT NOT NULL, client_snapshot_id TEXT NOT NULL, as_of TIMESTAMPTZ NOT NULL,
  realized_carried NUMERIC(18,8) NOT NULL DEFAULT 0, fees_carried NUMERIC(18,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (account_id, client_snapshot_id));
CREATE INDEX IF NOT EXISTS idx_offline_snapshot_headers_account_asof
  ON trading.offline_snapshot_headers (account_id, as_of DESC, created_at DESC);
INSERT INTO trading.offline_snapshot_headers (account_id, client_snapshot_id, as_of, created_at)
SELECT account_id, client_snapshot_id, max(as_of), max(created_at)
  FROM trading.offline_position_baselines GROUP BY 1,2 ON CONFLICT DO NOTHING;
```

- The down migration drops the headers table, then the `fees` column.
- The backfill gives every existing snapshot a carry of 0 and every existing confirmed order fees of 0, as FR-7 requires.

#### 2.2 ConfirmOrder (`trading.go:890-943`)

1. **Check fees first.** If `req.Fees` is set and is `< 0`, NaN or ±Inf, return `INVALID_ARGUMENT "fees must be >= 0"`. The check sits next to `:894`, before the order is loaded at `:898`, so a bad request leaves the order untouched (AC-9).
2. **Set fees** after the status is derived (`:922`):
   - if `req.Fees` is set, use it;
   - otherwise, if the stored `Fees` is nil, use `0`;
   - otherwise keep the stored value.
   - So an un-confirm (`filled_qty 0` → NEW, `:865-866`) keeps the stored fees. NEW orders never reach the fold (`trading_repo.go:339`).
3. ** Set `filled_at`** (replaces `:923-927`):
   - if `req.FilledAt` is set **and the derived status is not NEW**, use it. A `filled_at` supplied on a confirm that derives NEW is ignored, so a never-filled NEW order never has one;
   - otherwise, if a stored `filled_at` exists, keep it;
   - otherwise use `now`, but **only when the derived status is not NEW**. When it is NEW, leave `filled_at` nil.
   - `scanOrder` returns nil `filled_at` for a NULL column (`trading_repo.go:408-410`). The first confirm that leaves the order non-NEW therefore defaults to now.
   - A `filled_qty 0` confirm on an order that was never filled no longer records a time nobody is shown and a later re-confirm would inherit.
   - An un-confirm keeps `filled_at`, and so does a re-confirm that omits it. This stops an un-confirm/re-confirm pair from moving a frozen-window order into the current window.
   - ** New unit test:** a qty-0 confirm on a never-filled offline order persists `filled_at` as NULL. A later confirm with `filled_qty > 0` and no `filled_at` then gets `now`.
4. **Persist fees in `UpsertOrder`.**
   - Add a `fees` column as `$23`, bound directly from `o.Fees` (`*float64`; nil → NULL). Do not use `nullableFloat`: it turns 0 into NULL (`:476`).
   - Add `fees = EXCLUDED.fees` to the `DO UPDATE SET` list (`:77-85`), which names every updated column explicitly.
   - All 9 `UpsertOrder` callers were checked in round 3. Broker orders keep NULL.
5. **Read fees back.** `scanOrder` (`:364-424`) scans a nullable `fees`, and every SELECT feeding it adds the column (`:110`, `:219`, `:304`, `:332`).
6. **Return a masked clone.** The tail at `:942` becomes `resp := proto.Clone(order).(*tradingv1.Order); hideUnconfirmedFill(resp); return resp, nil`. The unmasked `order` is the one stored in `s.orders` at `:934`.

#### 2.3 Where the NEW-order masking happens

Masking happens in the **service layer**, at the RPC response sites, on objects the response owns.
- **Not in the handler.** `handler/trading.go:71-110` passes the service's pointer straight through. For ConfirmOrder and the GetOrder cache path, that pointer is the shared `s.orders` entry.
- **Not in the repo or the cache.** ConfirmOrder's internal reads must see the stored values.

**New helper** next to `normalizeFilledQty` (`trading.go:3531`):

```go
// hideUnconfirmedFill clears fees/filled_at on a NEW offline order; call only on a response-owned copy.
func hideUnconfirmedFill(o *tradingv1.Order) {
	if o != nil && o.BrokerType == commonv1.BrokerType_BROKER_TYPE_OFFLINE &&
		o.Status == tradingv1.OrderStatus_ORDER_STATUS_NEW {
		o.Fees, o.FilledAt = nil, nil
	}
}
```

The helper only touches OFFLINE orders, so broker responses are byte-identical to today. Every repo reader selects `broker_type` (`trading_repo.go:69,113,219,304,335`), so the check always has what it needs.

** The 5 live call sites:**

| Site | Object | Safe to change because |
|---|---|---|
| GetOrder cache path `:1494-1495` | `proto.Clone` | it is already a clone |
| GetOrder DB path `:1502` | freshly scanned by `repo.GetOrder` | nothing else holds it |
| ListOrders in-memory fallback `:1543-1548` | `proto.Clone` | it is already a clone |
| ListOrders DB path `:1552-1554` | freshly scanned | nothing else holds it |
| ConfirmOrder `:942` | new `proto.Clone` | it is a new clone |

- ** Streams need no masking.**
  - `TradingService.StreamOrderUpdates` (`trading.go:1585-1604`) is dead code: both stream handlers (`handler/trading.go:117-134` and `:204-221`) call `SubscribeOrderUpdates` (`trading.go:351-357`), which sends live broadcasts only, and gRPC registers only the handler adapter (`cmd/server/main.go:143`).
  - **Do not edit the dead method.** Log it in `services/xstockstrat-trading/docs/context-constitution-findings.md` as a defect: a dead service-level stream whose snapshot loop would send shared `s.orders` pointers, unmasked.
  - The three live `broadcastOrder` sites need no change: CancelOrder `:1295` rejects offline orders; ReplaceOrder `:1484` rejects an offline order because it has no `broker_order_id`; and broker polling is at `:1719`. ConfirmOrder never broadcasts.
- ** How the cache is written.**
  - `LoadInflightOrders` (`trading.go:288`, reading through `ListSubmittedOrders`, `trading_repo.go:299`) loads NEW orders into `s.orders` with their stored values.
  - `updateOrder` (`trading.go:373-383`) clones before changing anything.
  - ConfirmOrder stores a freshly scanned object (`:934`).
  - So nothing writes through a pointer a response site holds. Every RPC that sends cache entries to clients clones first (the table rows at `:1494` and `:1543`), or uses a fresh scan.

**Internal reads stay unmasked:**
- ConfirmOrder reads through `s.repo.GetOrder` (`:898`), not the `GetOrder` RPC.
- The recompute reads through `ListConfirmedOfflineOrdersByAccount`.
- `s.orders` keeps the stored values.
- No service code calls `s.GetOrder(` or `s.ListOrders(` (grep finds no match).

**FR-3 note for /sdd-spec to add:** "a NEW order after an un-confirm keeps its last fees and filled_at internally; neither is shown while it is NEW; a never-filled NEW order has no filled_at".

#### 2.4 Duplicate-row fix

`ListConfirmedOfflineOrdersByAccount` (`:330-357`) becomes:

```sql
FROM (SELECT DISTINCT ON (order_id) * FROM trading.orders WHERE account_id=$1
      ORDER BY order_id, created_at DESC) o <lateral on o.order_id>
WHERE o.status IN ('partially_filled','filled') AND o.filled_qty > 0
ORDER BY o.filled_at ASC NULLS LAST, o.created_at ASC
```

- `intentLateralJoinSQL` (`:100-105`) becomes a function, `intentLateralJoinOn(alias)`. The existing constant becomes `intentLateralJoinOn("trading.orders")`.
- The feature-206 `NetFilledQtyBySymbol` query is not touched.
- Update the sqlmock SELECT patterns in `trading_repo_test.go` for the new `fees` column and the DISTINCT ON regex.

#### 2.5 Recompute (`recomputeAndEmitOfflinePositions`, `:947-1041`)

- **Effective baseline.** `EffectiveBaselineByAccount` (`offline_baseline_repo.go:51-96`) reads the latest header first (`ORDER BY as_of DESC, created_at DESC LIMIT 1`), then that snapshot's rows with `qty ≠ 0`. A header with no rows means a full flatten.
- **New payload keys** (additive):
  - `fees_since_snapshot`: the sum of fees over the window orders (`filled_at > as_of`, `:972`), with nil counted as 0;
  - `realized_carried` and `fees_carried`: copied from the header;
  - `recent_fills`: `[{symbol, signed qty, price, filled_at RFC3339Nano}]` for window orders with `filled_at ≥ now−10d`, in fold order.

#### 2.6 SnapshotOfflinePositions (`:1046-1157`)

Everything runs in one repo transaction under `confirmLock` (`:1121`). The repo takes a carry callback, so the `pnl` fold stays in the service.

1. **Every row rejected, list non-empty:** write nothing, emit nothing, recompute nothing. Return `committed_count 0` with the rejections.
2. **Lock** the account's headers with `SELECT … FOR UPDATE`.
3. **Same id, same `as_of`:** keep the stored carry and replace the rows.
4. **Same id, different `as_of`:** allowed only when this id is the latest header and the new `as_of` is ≥ every other header's `as_of`. Otherwise return `FAILED_PRECONDITION` and change nothing. When allowed, recompute the carry as in step 5, excluding this id from the `pred` lookup.
5. **New id, or an allowed `as_of` change:**
   - `pred` = the header with the greatest (`as_of`, `created_at`) where `as_of < S.as_of` and the id differs.
   - `realized_carried = pred.realized_carried + FoldFrom(lots(pred), fills in (pred.as_of, S.as_of]).Realized`.
   - `fees_carried = pred.fees_carried + Σ fees` over the same orders.
   - With no `pred`, fold over orders whose `filled_at` is nil or `≤ S.as_of`.
6. **Write and emit:** upsert the header and rows, commit, emit `baseline_set` (`:1138`), then recompute (`:1146`).

Other trading rules:
- **Confirms with a fill inside the frozen window** are accepted and ignored (`@AC-3 @feature-163`).
- **Deregistration:** `DeleteBaselinesByAccount` (`offline_baseline_repo.go:99-104`) deletes the rows and headers in one transaction.

### 3. Marketdata `BatchGetBars` (`marketdata_service.go:654-763`)

**Singleflight key.** Add the flag to the key: `fmt.Sprintf("batch:%s:%s:%d:%d:%t", …, req.AllowPartial)` (`:711`).

**Strict path (flag unset):** byte-identical to today, including the fetch on the caller's ctx at `:721` and `return nil, fetchErr` at `:740-741`. Clients receive gRPC `INTERNAL`: `forwardConnectErr` (`marketdata_handler.go:267`, `:285-291`) wraps the error as `CodeInternal`, and `toGRPCError` (`:514`) maps that to `codes.Internal`.

**Partial path.** Refactor the closure body to take an `fctx`, used for both `GetBarsMulti` (`:721`) and `InsertBars` (`:729`). After the warm read (`:695`):
- **No deadline:** `fctx = ctx`, the caller's ctx, not detached.
  - This is the same lifetime the strict path has today.
  - **There is no time limit.** `GetBarsMulti` keeps following `next_page_token` until the pages run out (`alpaca/client.go:411-454`). The 30s HTTP client timeout therefore bounds each request, not the whole call.
  - On `fetchErr`, including a cancelled leader, partial callers still fall back to the warm subset.
- **Deadline set:** `budget = time.Until(dl) − barsPartialMargin` (250ms).
  - If `budget ≤ 0`, skip the cold fetch and WARN `BatchGetBars: no deadline budget for cold fetch; returning stored bars` (`cold`).
  - Otherwise run on `context.WithTimeout(context.WithoutCancel(ctx), budget)`, mirroring `:579`.
- **On `fetchErr` in either case:** WARN `BatchGetBars: cold fetch failed; returning stored bars` (`cold`, `budget_ms`, `error`) and return the warm subset (mirrors `:607`).
- **Unchanged:** a warm DB error still fails the RPC (`:695-698`), and a symbol with no bars is still omitted.

**Tests:**
- a partial call with a cold error returns the warm subset;
- a strict call with a cold error still errors with `INTERNAL` ;
- the two modes run in separate flights;
- a deadline-bound partial waiter survives the leader's cancel;
- with a 1000ms deadline and a source that hangs, warm bars come back in under 1000ms;
- with a deadline below the margin, the source is never called;
- a no-deadline partial call fetches on the caller's ctx (the source sees the same ctx), and when that ctx is cancelled it returns warm bars without an error;
- `TestBatchGetBars_OmitMissingSymbols` (`:1181`) is unchanged.

### 4. Portfolio

#### 4.1 Migration `017_offline_realized_lifetime_fees`

```sql
ALTER TABLE portfolio.offline_account_realized
  ADD COLUMN IF NOT EXISTS realized_carried DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees_since_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees_carried DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recent_fills JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE portfolio.positions SET source = 1
 WHERE source = 0 AND account_id IN (SELECT account_id FROM portfolio.offline_account_realized);
```

- The down migration drops the 4 columns. It does not undo the source backfill, because `1 = POSITION_SOURCE_ORDERS` (`portfolio.proto:126`) is correct for these positions.
- A broker position can never have `source ≠ 0`. Only the offline recompute sets `"source"` (`trading.go:1018-1027`); a broker sync decodes it as 0 (`portfolio_service.go:999`) and writes 0 (`portfolio_repo.go:330`).
- The spec says 3 new columns; there are 4.

#### 4.2 Sync consumer

- `positionSyncPayload` (`:989-1015`) gains `RealizedCarried`, `FeesSinceSnapshot` and `FeesCarried` (`*float64`, absent → 0), and `RecentFills` (absent → `[]`).
- `UpsertOfflineRealized` (`repo:456-464`) writes all of them in one statement.
- Offline payloads are still recognised by the presence of `realized_pnl` (`:1121`, `:1131`), so the feature-206 guard is unchanged.

#### 4.3 User-scoped reads and GetPortfolio

- `GetOfflineStates(ctx, userID, ids)` (`WHERE user_id=$1 AND account_id = ANY($2)`) replaces the unscoped `GetOfflineRealized` (`repo:468-474`) at `:594` and `:1256`.
- Lifetime realized = carried + since-snapshot. Lifetime fees = carried + since-snapshot.
- **GetPortfolio reads:** the user-scoped positions query (`:573`), `ListAccountBalancesByUser` (`repo:498`) and `ListOfflineAccountIdsByUser` (`repo:523`).
- **Scope:** without `account_id`, the user's owned accounts plus the account ids on their positions; with `account_id`, that account only.
- **Unowned or brand-new account:** it shows as empty, with the account-level fields omitted. There is no PermissionDenied.
- **Per-account figures:** a new `applyAccountPnL`, extracted from `buildAccountPortfolio` (`:1230-1260`). Broker figures use the rule at `:1249-1252`.
- **Aggregate:**
  - `day_pnl` = sum of the accounts' day P&L;
  - `day_pnl_pct` = sum of day P&L / sum of prior value (broker `last_equity`, offline `base`);
  - `total_pnl` = sum of the accounts' total P&L;
  - `total_pnl_pct` is set only when every account in scope is offline;
  - the realized and fee fields stay unset;
  - equity = sum of market values;
  - `trading_mode` filters positions only.
- The `ListPortfolios` PermissionDenied gate (`:1275-1280`) is unchanged.

#### 4.4 Valuation step (new `internal/service/offline_valuation.go`)

This is the only place the fallback runs.
- **Position reads** (`enrichPositions`, `:440`):
  - offline candidates are positions with `Source ≠ 0`;
  - with none, the path and cost are exactly as today;
  - otherwise make one `GetOfflineStates` call.
- **Two concurrent fetches,** each under `context.WithTimeout(ctx, quoteTimeout())` (`:411-420`):
  - `GetLatestQuotes`;
  - `BatchGetBars` with:
    - symbols = the offline positions' symbols plus recent-fill symbols with `filled_at ≥ D0`;
    - `"1d"`, `start = DayStart(NYdate(now) − L)`, `end = now.Truncate(time.Minute)`;
    - `max_bars_per_symbol = L+1`, `allow_partial = true`.
  - Portfolio always sends a deadline, so it never uses the no-deadline branch in §3.
- **Non-offline positions:** `applyQuotes` (`:448`) still values them. Their mark is labelled BROKER, QUOTE or NONE; only the label is new.
- **Paths that never reach the step:** `GetPnL` (`:648-652`), `broadcastSnapshot` (`:837`) and `checkRiskLimits` (`:905`).
- **Fallbacks:**
  - quotes fail → use bars;
  - bars fail → WARN, and the overnight terms are 0;
  - both fail → mark NONE, and the read still succeeds.

#### 4.5 Day P&L (hand-checked in round 2)

- `(ref, live) = marketsession.Reference(now)`; `D0 = DayStart(ref)`, `D1 = DayStart(ref + 1 calendar day)`, `P = PrevTradingDay(ref)`.
  - `D1` is the start of the next *calendar* day, not the next trading day. AC-50 depends on this: a Saturday fill after a Friday `ref` falls in `after`.
- **Per symbol:**
  - `after` = the total qty of fills at or after `D1`;
  - `in` = the fills in `[D0, D1)`;
  - `q_refclose = q_now − after`;
  - `q_open = q_refclose − Σ in.qty`.
- **Prices:**
  - `pc` = the close of the bar dated exactly `P`;
  - `refClose` = the bar dated `ref` (off-session only);
  - `lastClose` = the newest bar before `ref` during a live session, or at/before `ref` off-session;
  - a quote counts as fresh only if its time is ≥ `Open(ref)`.
- **Mark selection:**
  - live session: fresh quote → `lastClose` → NONE;
  - off-session: `refClose` → fresh quote → `lastClose` → NONE;
  - a mid-quote ≤ 0 counts as missing.
- Walk the `in` fills, starting from the shares held overnight. Export `pnl.QtyEpsilon = 1e-9` and use it in place of the literals at `pnl.go:77,84,89`.
- `day_pnl_pct = day/base` (0 when `base` is 0).
- `total_pnl` = lifetime realized + the sum of unrealized P&L over priced positions. `total_pnl_pct` = total / the sum of `|cost_basis|` over priced positions.
- **Short-position percent fix:** one shared `markAt` with `pct = unrealized/|CostBasis|`, replacing `:552-553`.

#### 4.6 Calendar, bar mapping and config key

- **Calendar** (`internal/marketsession`):
  - API: `Reference`, `PrevTradingDay`, `IsTradingDay`, `DayStart`, `Open`, `SessionDate`;
  - imports `time/tzdata`;
  - covers the NYSE rule-based holidays (with observed days) and Good Friday;
  - tests cover 2026–2028, DST boundaries and weekends.
- **Bar mapping:** `SessionDate(t)` = the America/New_York date of `t + 6h`. A golden test against real `ohlcv` 1d rows is a blocking step at `/sdd-spec`. `mark_as_of = DayStart(date)`.
- **Config key** `portfolio.marketdata.last_close_lookback_days`:
  - int, default 21, bounds `[5,60]`;
  - read live through `s.quoteCfg.GetInt`; a value `≤ 0` or no watcher → 21; not seeded;
  - register it in `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:136`) with both name-form test rows, and document it in `config-governance.md` and the portfolio `CLAUDE.md`.
- **Boundary tests:**
  - `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` make 0 `BatchGetBars` calls;
  - broker-only `ListPositions`/`GetPosition` make 0 `GetOfflineStates` calls and 0 `BatchGetBars` calls;
  - FR-9 parity across read paths;
  - `stubMarketData` implements `BatchGetBars`.

### 5. Agent

- `client.list_positions` adds `always_print_fields_with_no_presence=True` (precedent: `client.py:635-640`). This changes all three tools that use it; accepted.
- `manage_offline_account` (`tools.py:2035`) gains `fees: float | None = None`.
- `client.confirm_offline_order` (`client.py:2245`) gains `fees: float | None = None` and sets `req.fees` only when it is not None.
- ** Docstrings.** `tools.py:2067` and `client.py:2254` currently say "defaults to now". Both become:
  - "defaults to now on first confirm; otherwise keeps the previously recorded time (not shown while NEW)";
  - "fees: cumulative total, kept when omitted";
  - "pass filled_at when partial fills land on different sessions".
- `mcp-tools.md` gets the same wording.
- **New test:** a confirm with fees omitted builds a request where `HasField("fees")` is False; a confirm with `fees=0.0` gives `HasField` True and the value 0.0.
- `test_position_parity.py`: both guards move to 25 fields.

### 6. UI

- Carried over unchanged: `fmtNyDate`; `MarkBadge` ("Last close YYYY-MM-DD" / "No price"); the extracted `sumPortfolioTotals`; the `fmtSignedUsd` sign fix (R11); fixtures through `INVENTORY.md`; and the flipped expectations in `offline-accounts.spec.ts`.
- ** `ConfirmFillDialog.tsx`:** the label at `:92` and the comment at `:24` become "defaults to now on first confirm; otherwise keeps the previously recorded time (not shown while NEW)".
- **PR note:** the dialog has no fees input, so fees come only from the agent (FR-6 as written).


### 7. Decisions and evidence


- ** Masking happens in the service, at the 5 live response sites, on clones or fresh scans only.**
  - The handler forwards the shared cache pointer, and ConfirmOrder's internal reads go through the repo.
  - The service-level `StreamOrderUpdates` is dead code and is logged rather than edited.
  - Cited: `handler/trading.go:71-110`, `:117-134`, `:204-221`; `trading.go:351-357`, `:373-383`, `:898`, `:934`, `:942`, `:1494`, `:1502`, `:1543`, `:1552`; `cmd/server/main.go:143`.
- ** Un-confirm keeps fees and `filled_at`, and both are hidden while the order is NEW. A NEW-deriving confirm never sets `filled_at` to now.** NEW orders never enter the fold. Cited: `trading.go:865-866`, `:923-927`; `trading_repo.go:339`.
- **Partial mode with no deadline runs on the caller's ctx and has no time limit.** `GetBarsMulti` keeps paging, so the HTTP timeout bounds single requests only. Cited: `alpaca/client.go:411-454`, `marketdata_service.go:721`.
- ** The strict path's cold error reaches clients as gRPC `INTERNAL`.** Cited: `marketdata_service.go:740-741`, `marketdata_handler.go:267`, `:285-291`, `:514`.
- **The flag is part of the singleflight key,** so a strict closure on a cancellable ctx cannot take down partial waiters. Cited: `marketdata_service.go:711-721`.
- **`fees = EXCLUDED.fees` is added to the conflict update.** Cited: `trading_repo.go:77-85`.
- **The fees check runs before the order is loaded.** Cited: `trading.go:894-898`.
- **A snapshot is never its own predecessor** in the carry lookup. Cited: `offline_baseline_repo.go:27-44`.
- **The 017 source backfill makes `Source ≠ 0` a reliable pre-filter.** Cited: `trading.go:1018-1027`, `portfolio_service.go:999`, `portfolio_repo.go:330`.
- **GetPortfolio reads are user-scoped.** Cited: `portfolio_repo.go:468-474`, `:498`, `:523`.
- **Valuation is confined to `enrichPositions` and the account reads.** Cited: `portfolio_service.go:648`, `:837`, `:905`.


### 8. Reuses (anti-duplication)


- The feature-229 pattern of a detached fetch that falls back to warm data: `marketdata_service.go:577-607`.
- The response-edge normalizer site and pattern (`normalizeFilledQty`): `trading.go:3531`.
- `pnl.Fold`/`FoldFrom` and `offlineFillsFromOrders`: `pnl.go:45-57`, `trading.go:876`.
- The `DISTINCT ON` query shape: `trading_repo.go:176-180`.
- `quoteTimeout`: `portfolio_service.go:411-420`.
- The broker rule in `buildAccountPortfolio`: `:1249-1252`.
- `SCALAR_BOUNDS_REGISTRY`: `configServiceImpl.ts:136`.
- The agent print-options precedent: `client.py:635-640`.


### 9. Touchpoints


- **Proto/RPC:**
  - trading: `ConfirmOrderRequest.fees` 6, `Order.fees` 23;
  - portfolio: `Portfolio` 13–16, `Position` 24–25, `MarkSource`;
  - marketdata: `BatchGetBarsRequest.allow_partial` 6.
- **Migrations:**
  - trading 011: `orders.fees`, `offline_snapshot_headers`, backfills;
  - portfolio 017: 4 columns plus the source backfill;
  - re-check both numbers against all remote branches (`fails.md:213`).
- **Config:** `portfolio.marketdata.last_close_lookback_days` only.
- **Services:** the trading → ledger payload grows additively; portfolio → marketdata is an existing edge, now also calling `BatchGetBars`; no new edges; analysis is untouched.
- **UI:** `ConfirmFillDialog.tsx`, plus the §6 files.
- ** Docs:** a findings entry in `services/xstockstrat-trading/docs/context-constitution-findings.md` for the dead service-level `StreamOrderUpdates`.


### 10. Fixed invariants (F-07, approved at the round-5 gate)


Each stays a code constant, following the feature-229 precedent of fixed quote-retention invariants. Each is recorded in the `CLAUDE.md` named in the last column.

| Invariant | Value | Why it is not a config key | CLAUDE.md home |
|---|---|---|---|
| `barsPartialMargin` | 250ms | It is reply headroom inside the caller's own deadline, not a policy. The operator rejected a configurable margin and `marketdata.bars.batch_timeout_ms` (round 2). | `services/xstockstrat-marketdata/CLAUDE.md` |
| `recent_fills` window | 10 days | It must cover the longest NYSE session gap plus slack, and it only limits payload size. Portfolio's calendar decides what counts; a value that is too small just drops the oldest fills. | `services/xstockstrat-trading/CLAUDE.md` |
| `pnl.QtyEpsilon` | 1e-9 | A floating-point equality tolerance that already exists in code as literals (`pnl.go:77,84,89`). It is exported, not tuned. | `packages/proto/CLAUDE.md` (`pnl/` carve-out) |
| Session calendar | NYSE rule holidays, Good Friday, 09:30–16:00 ET | A fact of the exchange, not an operator choice. Its gaps are limitation 3. | `services/xstockstrat-portfolio/CLAUDE.md` |
| Bars coalescing interval | 1 minute (`end = now.Truncate(time.Minute)`) | Gives a stable singleflight key so concurrent reads share one cold fetch. It is a cache-key granularity, not a policy; the bar it can miss is at most one ingest interval old (limitation 6). | `services/xstockstrat-portfolio/CLAUDE.md` |
| `SessionDate` offset | +6h (America/New_York date of `t + 6h`) | It encodes how bar timestamps map to session dates. It is checked by the blocking golden test, not tuned at runtime. | `services/xstockstrat-portfolio/CLAUDE.md` |


### 11. Acceptance scenarios added

Appended to `acceptance.feature` as AC-41..AC-54. The AC-10 Given is also clarified in place.

**AC-10 clarification (in place):** add `And all of its fills have filled_at on or before "2026-10-31T23:59:59Z"`.

AC-53 and AC-54 sit in this feature's own `acceptance.feature` with `@FR-5` tags. At launch they are promoted into a **new** marketdata suite file, `services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`, tagged `@feature-240`. They do not go into `opportunities-latency-fix.feature`: its file-level `@feature-191` tag would misattribute them, and its `@FR-*` numbering is 191's. AC-43..AC-47 share their fixture through a Gherkin `Rule:` + `Background:` in `acceptance.feature`. AC-46 cites `@AC-3 @feature-163` in prose, not as a tag.

**Arithmetic for the shared AC-43..47 precondition:**
- S1's carry = 600: `ord-b1` and `ord-s1` both have `filled_at` ≤ S1's `as_of`.
- The window holds `ord-s2`, which realizes +100.
- In AC-44, S2's carry = 600 + 100 = 700, and S2 has an empty window.

### 12. Known limitations (accepted)


1. **Adjusted bars.** With `adjustment=all`, an ex-dividend or split day can carry a re-adjusted `pc`. Offline quantities are not split-adjusted.
2. **No re-emit at boot.** `recent_fills` is `[]` until the next confirm or snapshot.
3. **Calendar gaps.** Early closes and one-off closures are not modelled.
4. **One `filled_at` per order.** Partial confirms on different sessions use the stored date unless the caller passes `filled_at`. Orders un-confirmed before deploy carry the un-confirm time.
5. **Snapshot inside the session.** A snapshot whose `as_of` is inside or after the reference session counts that session's fills as shares held overnight.
6. **Bar lag.** After the close, the reference bar can lag by one ingest interval; the quote mark is used until it arrives.
7. **Torn read.** Positions and offline state are written separately under `positionsMu` (`:1095`), and reads don't take that mutex.
8. **Bars failure.** A failed bars batch makes the overnight terms 0 (AC-51).
9. **Cold symbols.** Symbols with no stored bars are fetched cold on every read, within the budget, coalesced per minute.
10. **Leader's budget.** A coalesced waiter with a shorter deadline can time out at portfolio; that is treated as a bars failure. A no-deadline partial leader can likewise hold up a deadline-bound partial waiter. Portfolio always sends a deadline, so no caller in this repo hits this.
11. **Equity vs Day P&L in GetPortfolio.** Equity is the sum of market values, while broker Day P&L is based on broker equity.
12. **Frozen carries on resubmission.** Re-submitting a non-latest snapshot with the same `as_of` replaces its rows, but later snapshots' carries are not recomputed.
13. **Stale risk price.** Risk fields for LAST_CLOSE marks are computed from the stale close.
14. **Aggregate realized and fees unset.** The GetPortfolio aggregate leaves them unset; the UI sums `ListPortfolios` instead.
15. **Partial mode without a deadline has no time limit.** It runs on the caller's ctx and pages until done (`alpaca/client.go:411-454`).
16. **A symbol with some stored bars is never backfilled.**
    - A symbol counts as cold only when it has zero bars (`marketdata_service.go:702-707`).
    - The ingester looks back only 48h (`minIngestLookback`).
    - So a missing `P` bar stays missing: the overnight terms are 0, and the read degrades without inventing a price.


### 13. Assumptions


- **The UpsertOrder caller audit is done** (9 callers, round 3). `scanOrder` fills in `Fees`, so no in-memory writer loses it.
- **Both migrations only `UPDATE` plain tables or uncompressed chunks.**
- **gRPC carries portfolio's deadline to marketdata** (`grpc-timeout`). Checked in round 3: the handler passes ctx through.
- **No client reads `fees` or `filled_at` off a NEW offline order today.** Today such a client would see the un-confirm time; after this change it sees nothing. AC-48 makes this a contract.
- ** Ledger near-miss candidate for `docs/roadmap/ledger/fails.md`:** the round-4 design listed a masking site (the service-level `StreamOrderUpdates` snapshot) on a method that no live RPC path reaches. Lesson: before listing a service method as a response site, trace it from gRPC registration (`cmd/server/main.go`) through the handler.


## Rejected Alternatives


Rounds 1–3:
- a portfolio → trading RPC for fills (creates a boot-order cycle);
- trading computing Day P&L when it emits;
- putting the calendar in trading or `packages/proto`;
- FAILED_PRECONDITION on confirms inside the frozen window;
- `BatchGetLatestPrice.prev_close`;
- a constant lookback;
- deriving `P` from the batch's own bars;
- deriving the carry from rows without a header;
- a close-price memo in portfolio;
- recomputing later carries when an `as_of` is edited;
- the "+12h UTC" and "NY date of t" bar mappings;
- degrading every caller by default, `unavailable_symbols`, an analysis change, and `marketdata.bars.batch_timeout_ms`;
- a PermissionDenied gate on GetPortfolio;
- re-emitting syncs at boot;
- documenting `filled_at` behaviour instead of preserving the value;
- one singleflight key for both modes;
- per-waiter `DoChan` deadlines;
- a configurable margin;
- clearing `filled_at` on un-confirm;
- sharing the DISTINCT ON fragment with the 206 query.

Round 4:
- **clearing fees on un-confirm** (operator decision);
- **masking in the handler, or changing the cache:** the handler gets the shared `s.orders` pointer, so masking there would corrupt `s.orders`;
- **a detached no-deadline fetch bounded by the HTTP client:** its "bounded by 30s" premise was false.

**:**
- **masking or editing the service-level `StreamOrderUpdates`:** it is dead code, so the change goes to the findings log instead.


## Open Risks

- [ ] **The bar-date mapping (`SessionDate` = New York date of `t + 6h`) is unverified against real
  data.** If it is wrong, every offline `previous_close` silently lands on the wrong session.
  Mitigation: a **blocking** golden test against real staging `marketdata.ohlcv` 1d rows, covering both
  EDT and EST dates, as the first Day P&L step at `/sdd-spec`. No Day P&L code merges before it passes.
  Target: `/sdd-spec` step 1 of the portfolio valuation work.
- [ ] **Migration numbers** trading 011 / portfolio 017 must be re-checked against all remote branches
  (`fails.md:213`). Target: `/sdd-spec`.
- [ ] **CI `buf breaking` skips `trading/v1/trading.proto`** (`ci.yml:135`). Run it by hand per C-09.
  Target: the proto step.
- [ ] **Spec drift to land at `/sdd-spec`:**
  - migration names: `011_offline_fees_snapshot_headers`, `017_offline_realized_lifetime_fees`;
  - portfolio 017 adds 4 columns, not 3;
  - the FR-3 note: "a NEW order after an un-confirm keeps its last fees and filled_at internally;
    neither is shown while it is NEW; a never-filled NEW order has no filled_at".
- [ ] **Findings to log:**
  - dead `TradingService.StreamOrderUpdates` (trading findings);
  - `fmtSignedUsd` sign placement (UI; it is fixed in this feature);
  - the pre-existing unscoped `GetOfflineRealized` leak (portfolio).
  Target: the docs step.

## Constitution Rules Touched


- **C-01, F-04:** every claim is cited.
- **C-04:** the `MarkSource` enum.
- **C-05, F-07:** one new config key; five fixed invariants, tabled above for the gate.
- **C-07, F-01:** migrations 011 and 017.
- **C-09:** run `buf breaking` by hand for trading.
- **C-10(b), C-14:** FR-9 parity; UI and agent surfaces.
- **C-12, C-13:** fixtures.
- **C-15, C-16:** scenarios and business rules.
- **C-17:** the mark badges.
- **C-18:** least mechanism.
- **C-03:** no new outbound edges.
- **F-06:** no pool change.


## Business Rules Touched (C-16)


- **CHANGE:**
  - `fix-book-portfolio-page.feature @AC-1 @feature-229` (offline fallback);
  - `quote-fanout-batching.feature @AC-4` and the third clause of `@AC-1` (`@feature-178`), for offline positions only;
  - `@AC-6 @feature-163`, narrowed by the snapshot rules;
  - `fix-offline-account-ui-gaps.feature @AC-2/@AC-4 @feature-159`.
- **EXTEND:**
  - `offline-account-portfolios.feature @AC-13`;
  - marketdata gains `@AC-53`/`@AC-54` in a new suite `services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature` (`@feature-240`) at launch; `@AC-2`/`@AC-3 @feature-191` stay preserved.
- **PRESERVE:**
  - `@AC-3` and `@AC-14 @feature-163`;
  - `@AC-10 @feature-157`;
  - `@AC-5 @feature-229`;
  - marketdata `@AC-2`/`@AC-3 @feature-191` and `@AC-1 @feature-185`;
  - `@AC-13 @feature-215`;
  - the 206 empty-sync guard;
  - the H-3 `ListPortfolios` gate.


Sign-off references (context.md):
- 229 @AC-1: sdd-review round 1.
- 159 @AC-2/@AC-4: sdd-review round 2.
- 157 @AC-13 extend: sdd-review round 3.
- 178 @AC-4/@AC-1: sdd-design round 1 gate.
- 163 @AC-6 narrowing: sdd-design round 2 gate.

## Rounds

5 rounds, full mode. Termination: approved at the cap.
- R1: NEEDS WORK.
- R2: NEEDS WORK.
- R3: APPROVE WITH NITS.
- R4: APPROVE WITH NITS.
- R5: APPROVE WITH NITS, with the nits folded in at approval:
  - a supplied `filled_at` is ignored on a NEW-deriving confirm;
  - the epsilon's home is `packages/proto/CLAUDE.md`, and a coalescing-interval invariant was added;
  - AC-53/54 are promoted into a new marketdata suite file;
  - AC-46 cites 163 in prose, and AC-43..47 share a `Rule:` + `Background:`.
