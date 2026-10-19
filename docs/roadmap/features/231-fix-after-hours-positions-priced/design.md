# Design: fix-after-hours-positions-priced

**Created**: 2026-10-19
**Rounds**: 3 (full; termination: approved with conditions)
**Approved by**: user @ 2026-10-19
**Grounded in**: recon.md (plus round evidence in context.md)

---

## Chosen Approach

Marketdata owns one valuation **mark**. It is the two-sided mid when both sides are positive, otherwise the newest
stored daily close inside a configurable staleness bound, otherwise unset. Portfolio and the EDGAR snapshot value
only from that mark. A one-sided quote is never averaged, and no price is ever taken from a lone surviving side.
Staging evidence (context.md, round 1): the lone side ×2 is 6–11% off, while the stored 1d close matches the
broker (LYFT 16.98 = 16.98).

**Consumer surface (C-14).** This is a read-only value correction; no UI or agent code changes. The following now
show mark-based prices after hours:

- the agent MCP tools `get_positions`, `get_positions_by_account_id` and `get_fundamentals` (EDGAR mode);
- `/trader` Book → Portfolio (ListPortfolios / GetPnL);
- `/insights` P&L reads.

The persisted equity snapshot and concentration alerts are background effects. `Quote.mark_price` is additive and
unread by the UI.

### 1. Proto (`packages/proto/marketdata/v1/marketdata.proto:91-98`)

Add `optional double mark_price = 8;` to `Quote`. The change is additive and non-breaking. Comment:

```proto
// Valuation mark, set only by GetLatestQuotes: two-sided mid if ask_price>0 && bid_price>0, else the newest
// stored 1d close within marketdata.quotes.mark_close_max_age_hours. Unset = no usable mark (or not computed).
```

Raw `ask_price` and `bid_price` keep their current meaning. Trading sizing (`trading.go:3156-3169`) and the agent are
unaffected.

### 2. Marketdata `GetLatestQuotes` (`marketdata_service.go:549-621`)

1. **Keep** the warm read (`:558-566`) and the detached cold singleflight (`:573-615`) unchanged.
2. **Compute `needClose`** after the warm read: every requested symbol without a two-sided warm quote, including
   all cold symbols. A cold symbol that later turns out two-sided costs one wasted indexed lookup; that is accepted.
3. **Run the close lookup in one goroutine, concurrently with the singleflight `Do`.** The bound becomes
   W + max(B_cold, C) instead of W + B + C.
   - Call: `dailyCloses.GetLatestDailyClosesBatch(cctx, needClose, now − maxAge)`.
   - `cctx = context.WithTimeout(ctx, resolveQuoteMarkBudget(...))`. It is per caller and **not detached**.
   - The result channel is buffered (cap 1) and always received after the spawn. The goroutine sends its own map
     and never touches `warm`.
4. **Merge at the `out` loop (`:616-619`).** Each quote is `proto.Clone`d first, because cold quotes are shared across
   singleflight waiters and the fake store returns stored pointers. Then:
   - two-sided → `MarkPrice` = mid;
   - else close present → `MarkPrice` = close;
   - else unset.
   A symbol the cold fetch omitted stays omitted; no synthetic Quote is created (229 `@AC-8`).
5. **On lookup failure or timeout:** log WARN `GetLatestQuotes: mark lookup failed`, including whether `ctx` was
   already done. Two-sided marks are still set.
6. **Seam:** a new `dailyCloseReader` interface wired only when the repo is non-nil, following the `prevCloseReader`
   pattern (`:125-128`, `:218-222`). A nil reader gives mid-only marks.
7. **Repo `GetLatestDailyClosesBatch`:**
   - copies the `latestQuotesBatchSQL` shape and Exec mode (`marketdata_repo.go:313-359`):
     `unnest($1::text[]) … CROSS JOIN LATERAL (SELECT close FROM marketdata.ohlcv WHERE symbol=s.sym AND timeframe='1d' AND time >= $2 AND close > 0 ORDER BY time DESC LIMIT 1)`;
   - is served by the PK `(symbol, timeframe, time)`;
   - with 30-day chunks, touches at most 2 chunks.
   - `GetPreviousDailyCloseBatch` (`:452-482`) is **not** reused: it is unbounded and returns the second-newest close.

**Pool safety.** MaxConns is 2. The warm read releases its connection before the branch. After that, at most two
connections are in use: the close query, and the serial `InsertQuote` calls inside the singleflight. No hold-and-wait
occurs, and every acquire is context-bounded.

### 3. Config (F-07; operator decisions in context.md)

| Key | Type | Default | SetConfig bounds | Read |
|---|---|---|---|---|
| `marketdata.quotes.mark_timeout_ms` | int | 500 | [100, 2500] | live, via `resolvePositiveInt` |
| `marketdata.quotes.mark_close_max_age_hours` | int | 168 | [120, 720] | live, via `resolvePositiveInt` |

- **`mark_timeout_ms`:** unseeded (227/229 waiver pattern). The ceiling equals the `batch_timeout_ms` default, so
  under defaults C never extends the cold-path worst case.
- **`mark_close_max_age_hours`:** the floor of 120 exists because 1d bars are stamped at 00:00 ET. On Monday
  evening Friday's bar is about 92h old, or about 116h with a Monday holiday.
- **Where the rows go:** both rows go in `SCALAR_BOUNDS_REGISTRY` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts`),
  the marketdata `CLAUDE.md` key table, and the `docs/patterns/config-governance.md` per-feature log.
- **Portfolio invariant update:** the `quote_timeout_ms` invariant becomes "must exceed max(batch, mark) + warm read".

### 4. Portfolio (`portfolio_service.go`)

- **`markOf(q) (float64, bool)`:** `MarkPrice` if present and > 0, else the two-sided mid, else unpriced. The mid
  fallback makes deploy skew and rollback safe: `deploy.yml:204` cannot order component rollouts.
  - `applyQuotes` (`:448-464`) uses `markOf`.
  - `enrichPosition(p, price)` (`:547-555`) replaces both duplicated mids (`:457`, `:548`).
  - Every read path inherits it: GetPortfolio, GetPosition, ListPositions, GetPnL (`:652`), ListPortfolios (`:1341`).
- **`broadcastSnapshot` (`:827-871`) and `checkRiskLimits` (`:891-931`)** stop quoting every symbol. Both become
  `latestQuotesFor(unvaluedSymbols(positions))` → `applyQuotes` → `unpriced := unvaluedSymbols(positions)`, so the
  broker price wins (C-10(b)).
  - **Snapshot:** if `!ok` or `unpriced` is non-empty, skip with WARN `portfolio snapshot skipped: positions unpriced`
    and `unpriced=[…]` (style of `:848`). Otherwise equity = Σ `MarketValue`.
  - **Concentration:** same condition → skip with WARN `concentration check skipped: positions unpriced`. Otherwise
    `posValues[sym] += MarketValue`, fixing the cross-account overwrite at `:910`.
  - **Drawdown** (`:924-930`) is untouched.
- **GetPnL:** no mark and no two-sided mid → `ErrQuotesUnavailable` → UNAVAILABLE (229 `@AC-5`).

### 5. EDGAR fundamentals (marketdata)

- **Split** `getEdgarSnapshot` (`:1697-1731`) into:
  - `edgarResolve` (kill switch, cache hit, period read, vendor fallback);
  - `edgarFinish(period, live)` (`edgarSnapshotFromPeriod` plus the upsert).
- **Single-symbol path:** resolve → `livePrice` → finish. `livePrice` (`:1735-1745`) returns `quotes[0].MarkPrice`
  when > 0, else nil → filed-date close (`:1752-1756`).
- **`GetFundamentalsMulti` edgar path** (`:1506-1522`):
  - phase 1 runs serially (omit/abort semantics kept);
  - then **one** `GetLatestQuotes(pending)` call when at least one symbol is pending, none when all are cache hits;
  - then phase 2 in input order.
  - Pending-only is an accepted refinement of the operator's "prefetch once" binding (context.md).
- **`edgarFinish` skips `UpsertFundamentals` when `live == nil`** and serves the result uncached. A transient mark
  miss must not cache the filed-date price for 24h (`fails.md:2289`).
- **Operator purge** (rollout, not code), after the marketdata deploy, during market hours, staging then prod:
  1. `SELECT count(*)`;
  2. `DELETE FROM marketdata.fundamentals WHERE source='edgar'`;
  3. verify that `count(*) WHERE source='edgar' AND fetched_at < <deploy ts>` is 0;
  4. record the counts in context.md.
  - Never touch `fundamentals_history`.
  - Signals already emitted from halved prices are not repaired.

### 6. Findings and docs (no code)

- **Findings entries:**
  - `StartSnapshotWriter` (`portfolio_service.go:813`) has no caller; snapshots run only per fill (`:370-371`);
  - whether IEX daily bars include extended-hours prints is unverified.
- **portfolio `CLAUDE.md`:** the snapshot rule changes from "no position priced" to "any position unpriced".
- **recon.md correction:** `packages/proto/pnl/pnl.go` is an existing hand-written carve-out, scoped to realized
  P&L, so it is not used here.

## Rejected Alternatives

- **Live last trade via portfolio `BatchGetLatestPrice`.** Rejected because it puts two detached 2.5s budgets
  inside the 4s deadline, runs an unbounded prev-close scan on every call, makes serial per-symbol live calls in
  `GetFundamentalsMulti` (227 hang class), and adds an Alpaca call to every after-hours read.
- **Trading's positive-side rule.** Rejected on staging evidence: the lone side is stale by 6–11%.
- **Normalize or filter one-sided quotes at the producer or cache.** Rejected because it changes trading sizing
  and widens 229 `@AC-8` for every consumer.
- **Per-service duplication of the mark policy.** Rejected for C-18: one policy, owned by marketdata. Portfolio keeps
  only a 1-line mid fallback for deploy skew.
- **Shared Go package, or the `packages/proto/pnl` carve-out.** Rejected: `pnl` is realized-P&L scoped, it would need a
  governance edit, and no CI job runs `go test` there.
- **Marks as `map<string,double>` on `GetLatestQuotesResponse`.** Rejected: a heavier portfolio merge. The scoped
  field comment covers the semantics instead.
- **Serial close lookup after the cold fetch.** Rejected: W + B + C sits on a path that already timed out at 17:36.
- **Coalesce the close lookup under singleflight.** Rejected: it needs a detached budget again.
- **Hardcoded 168h staleness or 500ms budget.** Rejected under F-07: both are policy values (071 precedent), so
  they became config keys.
- **Concentration over the priced subset.** Rejected by the operator in favor of skip + WARN, to avoid false
  positives.
- **Store the mark in `marketdata.quotes`.** Rejected: it needs a migration, and on-read computation suffices.

## Open Risks

- [ ] **Stored-close freshness right after 16:00.** The bar poller lags by up to about 5 minutes, and a symbol
  first queried after the close may carry the previous session's close. The price is real, never halved, but it
  can lag. → Staging check after the close (rollout step).
- [ ] **Weekend first-query gap.** The warm set is in memory and `minIngestLookback` is 48h, so a never-ingested
  symbol may have no close inside the bound and stay unpriced. → AC-7 "no stored close" row; docs.
- [ ] **Permanently unpriceable holding** (delisted, illiquid, stale beyond the bound). It stops that user's snapshots
  and concentration checks; the WARN names the symbols. Operator-accepted. → Docs step.
- [ ] **`adjustment=all` on ex-dates.** A prior-day close used as the mark is back-adjusted and will not equal the
  broker's raw close. → Docs (accepted).
- [ ] **IEX daily bar extended-hours inclusion is unverified.** → Findings plus the staging check.
- [ ] **Extra pooled query after hours.** Every portfolio read and every fill issues one more short query. Under
  contention the mark lookup times out, marks fail safe to unpriced, and a WARN is logged. → Monitor after deploy.
- [ ] **Two quote fetches per fill** (`checkRiskLimits` and `broadcastSnapshot`, `:370-371`). Pre-existing;
  merging them is optional and out of scope.
- [ ] **Overlap with `230-offline-account-full-pnl`** (`ccr-cd56ff4d-s5wkbb`): it touches the same valuation
  functions. Whichever lands second reconciles.
- [ ] **EDGAR purge** must run after the marketdata deploy. → Rollout step; counts recorded in context.md.

## Constitution Rules Touched

- `C-05` — honored by: the two new keys follow `<service>.<category>.<key>`, with defaults declared in the marketdata `CLAUDE.md` and rows in the registry and the governance log.
- `C-08` / `P-06` — honored by: every code step gets a paired RED→GREEN test. The concurrency proof uses a handshake (the cold fake blocks until the close fake signals entry; sequential execution deadlocks and fails under the 5s guard). The timeout proof uses `mark_timeout_ms=100` and asserts elapsed < 1s.
- `C-09` — honored by: the proto step runs `buf lint`, `buf breaking` against `main-dev`, and `./scripts/buf-gen.sh` (proto-freshness gate).
- `C-10(b)` — honored by: all five portfolio read paths plus snapshot and risk share `markOf` and broker-first valuation. AC-13 asserts parity.
- `C-13` — honored by: the shared LYFT/ELWT quote, close and trade literals get one fixture home per service.
- `C-14` — honored by: the Consumer Surface(s) line is added to product-spec.md.
- `C-15` — honored by: acceptance.feature is rewritten with positive single values and `@FR-N` tags.
- `C-16` — honored by: the Business Rules section below (one CHANGE, signed off).
- `C-18` — honored by: one mark policy, owned by marketdata; a 1-line fallback mid in portfolio; no new shared package.
- `P-03` — honored by: unverified premises (IEX extended hours, adjustment, freshness) are recorded as Open Risks.
- `F-06` — honored by: no new pool. The extra query runs inside the existing MaxConns 2 / PgBouncer budget.
- `F-07` — honored by: the 500ms budget and the 168h staleness bound are config keys, not code constants.
- `F-01` — honored by: no migration.

## Business Rules Touched (C-16)

- **CHANGE** `@AC-1 @FR-1 @FR-4 @feature-178` "Position enrichment uses one batched quote call" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`). Batched equals serial now holds only for two-sided quotes; a one-sided quote is valued at the stored close in the batch path, and serial `GetLatestQuote` does not compute marks. Signed off by user @ 2026-10-19 (context.md). The parity test `portfolio_service_test.go:46-75` is updated deliberately.
- **EXTEND** `@AC-1 @regression @feature-229` "Portfolio reads return unenriched positions…" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`). The unpriced outcome now also covers a one-sided quote with no close inside the bound.
- **EXTEND** `@AC-4 @FR-4 @feature-178` "A symbol with no quote maps to the same missing outcome…". `current_price` 0 means not priced; no zero price is assigned.
- **EXTEND** `@AC-6 @FR-5 @FR-8 @feature-211` "The snapshot path serves the latest EDGAR filing…". After hours the live price-join is the stored daily close mark; a missing mark falls back to the filed close and is served uncached.
- **PRESERVE** `@AC-5 @feature-229` (GetPnL UNAVAILABLE when no usable price), `@AC-6 @feature-229` (broker-synced positions: no quote fetch), `@AC-7`/`@AC-12`/`@AC-14 @feature-157` (parity, shorts, broker accounts), `@AC-1 @feature-172` (drawdown on broker equity), and marketdata `@AC-2`/`@AC-3`/`@AC-7`/`@AC-8 @feature-229`, `@AC-3 @feature-178`, `@AC-9 @feature-211`, `@AC-7 @feature-215`, `@AC-4`/`@AC-5 @feature-191`, `@AC-3 @feature-227`. Not regressed: raw quote fields and omission are unchanged; the cold singleflight is unchanged; the BatchGetLatestPrice path is untouched.
- **NEW** (no prior AC): persisted equity snapshot valuation and skip rule; concentration valuation and skip rule. These are recon coverage gaps.
- **Operator-accepted behavior change** (no prior AC): the snapshot is skipped when any position is unpriced, not only when none is priced. Signed off by user @ 2026-10-19 (context.md).

## Rounds

3, full mode. Termination: approved with conditions; all conditions are folded in above.

- **Round 1:** live last trade, rejected.
- **Round 2:** marketdata mark via operator steer; objections on deploy skew, the serial budget, the EDGAR loop,
  and F-07 for the 500ms constant.
- **Round 3:** concurrent lookup and `markOf` fallback. F-07 on the 168h constant was cured by a config key; test
  and caching conditions were folded in.
