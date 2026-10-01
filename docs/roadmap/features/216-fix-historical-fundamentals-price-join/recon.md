# Recon: fix-historical-fundamentals-price-join

**Created**: 2026-09-27
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata (root cause), xstockstrat-ingest (backfill orchestration — see Risks), xstockstrat-agent (consumer surface, no change expected)

---

## Objective

Historical point-in-time fundamentals persist their price-derived metrics (`price`, `market_cap`,
`pe_ratio`, `pb_ratio`, `dividend_yield`) as a one-shot inline compute at insert time, and the
`fundamentals_history` write is insert-only (`ON CONFLICT ... DO NOTHING`). So a symbol backfilled
before its daily bars exist gets those metrics left nil forever — a re-backfill (even
`overwrite=true`) cannot re-derive them. Make the re-derivation recoverable: after bars are available,
a fundamentals (re-)backfill must re-derive and persist the price-join metrics for the affected
periods, **without** clobbering as-reported fields or the earliest `filed_date`, and while remaining
fail-closed when bars are genuinely absent.

## Codebase Map

- **`xstockstrat-marketdata`** (Go) — root cause locus
  - Insert-only write: `InsertHistoricalFundamentals` — `internal/repository/marketdata_repo.go:596`;
    full INSERT column list `:606-609`; `ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING`
    — `:610`; doc comment stating DO NOTHING is deliberate (feature-198 @AC-1 idempotency, keep
    earliest as-reported `filed_date`) — `:593-595`.
  - Shared column const `histFundamentalsColumns` — `marketdata_repo.go:591`; reads
    `QueryHistoricalFundamentals` — `:625`, `LatestHistoricalFundamental` — `:704`.
  - One-shot price-join (bug locus): `backfillOneSymbol` — `internal/service/marketdata_service.go:1762`;
    calls `priceJoin` `:1794` then `InsertHistoricalFundamentals` `:1813` once per period.
  - `priceJoin` — `marketdata_service.go:1824`; close AT `filed_date` via `s.histRepo.CloseAt` `:1844`;
    **fail-closed** when no bar (returns, leaves metrics nil, never re-attempted) `:1849-1851`; sets
    price `:1853`, market_cap `:1856`, pe_ratio `:1863`, pb_ratio `:1870-1875`.
  - T12M dividend-yield: `dividendsFetched` gate `:1772-1789`; `UpsertDividends` `:1781`;
    `SumDividendsInWindow` `:1799`; yield only when `dividendsFetched && p.Price != nil` `:1798`.
  - **Second price-join lane (no bug):** `getEdgarSnapshot` `:1469` → `edgarSnapshotFromPeriod` `:1525`
    overlays a **live** price every call `:1527-1529` (`livePrice` via `GetLatestQuotes` `:1508`).
    Historical lane freezes price at insert; snapshot lane recomputes on every RPC → why snapshot is
    unaffected.
  - Bars lookup: `CloseAt` — `internal/repository/marketdata_repo.go:755`:
    `SELECT close FROM marketdata.ohlcv WHERE symbol=$1 AND timeframe='1d' AND time <= $2 ORDER BY time DESC LIMIT 1`;
    returns nil on no rows (fail-closed) `:761-763`. **Bars table is `marketdata.ohlcv`** (there is no
    `marketdata.bars`).
  - RPC: `BackfillFundamentals` service method — `marketdata_service.go:1719`; handler
    `internal/handler/marketdata_handler.go:142`, gRPC adapter `:308`. **Never reads `overwrite`**
    (`:1726-1750`).
  - Last migration: `006_dividend_actions.up.sql` → **next NNN = 007** (C-07); table +
    all price columns in `005_fundamentals_history.up.sql:7-29` (PK `:28`) → **no migration needed**.
  - Config-read: `fundamentalsConfig` interface `:97-99`, `fundCfg` field `:74` wired from
    `cfgWatcher` `:159`; history gate `marketdata.fundamentals.history.enabled` `:1720`; dividends keys
    `:1773-1774`.
  - Tests: `internal/service/marketdata_service_test.go` — `fakeHistRepo` (`inserted`, `closeAt`,
    `dividends`) `:1508`; `fakeHistRepo211` (`CloseAt` keyed by date, `queriedFor`) `:1722-1735`;
    priceJoin tests `:1751-1789`; `TestBackfillFundamentals_CapDegrade_AC5` `:1656`. Repo tests
    `internal/repository/marketdata_repo_test.go`.

- **`xstockstrat-ingest`** (Python) — backfill orchestration
  - `TriggerBackfill` RPC — `app/handlers/servicer.py:228`; `data_kind` branch `:242`; **one request =
    one `data_kind`** (bars XOR fundamentals); `_run_backfill` XOR dispatch `:343-348`.
  - `_execute_fundamentals_backfill` — single `BackfillFundamentals` call `:365`/`:371`; `overwrite`
    **already forwarded** `overwrite=request.overwrite` `:375`. `_execute_backfill` (bars) `:435`.
  - Header propagation trio via `_propagation_meta` `:220-226`/`:377` (C-03).
  - Job state `app/repositories/backfill_jobs.py`: `job_id` UUID PK (server `uuid4` `servicer.py:237`);
    no dedup/idempotency guard at this layer (`backfill_jobs.py`); `_UPDATABLE_COLUMNS` allow-list
    `:13-26`.
  - Last migration: `012_backfill_data_kind.up.sql` → **next NNN = 013** (C-07); `data_kind` already
    persisted `:4-5`.
  - Config-read: `ConfigWatcher` typed getters `app/config/watcher.py:100-140`; backfill props
    `:176-204`. Tests: `tests/test_ingest_servicer.py` (fundamentals dispatch `:1719-1792`);
    fixtures `tests/conftest.py` + `tests/_helpers.py` (C-13).

- **`xstockstrat-agent`** (Python) — consumer surface (C-14), **no change expected**
  - `query_fundamentals` tool `app/tools.py:420-490` — pure relay; historical branch calls
    `get_historical_fundamentals` `:461`; `missing_metrics` is backend-authoritative (`:457`,
    union-only `:486-488`).
  - `trigger_backfill` tool `app/tools.py:1309-1351` → `client.py:1808-1815` builds one
    `TriggerBackfillRequest`; one `data_kind` per call (`_DATA_KIND_MAP` `client.py:1753`); no
    sequencing.
  - No agent-side price-join derivation/caching (confirmed). Propagation via `_metadata()`
    `client.py:57-85` (C-03).

## Patterns to REUSE

- **Idempotent column-scoped upsert** → reuse the existing `InsertBars` pattern:
  `ON CONFLICT (symbol,timeframe,time) DO UPDATE` (`marketdata_repo.go:63`, called from
  `BackfillBars` `marketdata_service.go:1082`). The fix's fundamentals write should mirror this
  DO-UPDATE shape but **scoped to price-join columns only** (never whole-row).
- **Dividend upsert already idempotent** → `UpsertDividends` (`marketdata_service.go:1781`) re-runs
  cleanly on re-backfill, so a re-derivation gets fresh dividends for the T12M window with no change.
- **Price-at-filing lookup** → reuse `CloseAt` (`marketdata_repo.go:755`) exactly as `priceJoin`
  already does; do not add a new bar-range query (no pagination-direction gotcha for a single-row DESC).
- **Fake-repo test harness** → extend `fakeHistRepo211` (`marketdata_service_test.go:1722-1735`) whose
  `CloseAt` is date-keyed — set no-bar first (nil) then bar-present to prove re-derivation (RED→GREEN).
- **Config gate reads** → reuse `s.fundCfg.GetBool/GetInt` (already used at `:1720,1773-1774`); no new
  config key.
- **Ingest overwrite forward** → already correct (`servicer.py:375`); reuse, do not re-plumb.

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon`. **C-16 blind spot flagged below** — feature 198's guarantees are
launched but never promoted into a durable suite, so they cannot be cited as `@AC-*` PRESERVE lines,
yet the design MUST preserve them (they are live in prod and feature 211 builds on them).

- **PRESERVE** `@AC-4 @FR-3 @FR-7 @feature-211` "P/B computed at the filing boundary, no look-ahead"
  (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — re-derivation
  must use only the price as-of `filed_date`; no post-filing price may contribute.
- **PRESERVE** `@AC-5 @FR-4 @FR-7 @feature-211` "Dividend yield is trailing-12-month, excludes
  post-filing payments" (same file) — T12M window + post-filing exclusion + **fail-closed-when-absent
  (never fabricated 0)** must not regress.
- **PRESERVE** `@AC-1 @FR-1 @feature-211` "records true reporting currency, not USD" (same file) —
  currency is an as-reported field the re-derivation write must not clobber; pb stays currency-consistent.
- **PRESERVE** `@AC-2 @FR-2 @feature-211` "debt_to_equity via financial-debt convention" (same file) —
  as-reported/derived D/E must survive a price-join re-derivation write untouched.
- **PRESERVE** `@AC-3 @FR-2 @feature-211` "financial-sector filer no longer permanently zeros D/E
  sub-score" (same file) — same D/E invariant.
- **PRESERVE** `@AC-9 @FR-1 @FR-2 @FR-3 @FR-4 @feature-211` "backtest PIT composite lands in the same
  band as the live snapshot after enrichment" (same file) — PIT period and same-filing snapshot must
  carry identical D/E, pb_ratio, currency.
- **PRESERVE** `@AC-6 @FR-5 @FR-8 @feature-211` "snapshot path serves latest EDGAR filing + live
  price-join" (same file) — snapshot lane shares `priceJoin`; historical re-derivation must not regress it.
- **EXTEND** `@AC-8 @FR-6 @feature-211` "data explorer shows enriched metrics with currency +
  provenance" (same file) — feature adds the missing-then-re-derived case: periods that showed "—" for
  lack of bars become populated after re-derivation; the "populated + currency + source" guarantee
  itself is PRESERVED. **xstockstrat-ui `/insights/data-explorer` is the consumer surface** (see Risks / C-14).
- **PRESERVE** `@AC-7 @FR-4 @feature-204` "agent query_fundamentals historical returns the period row"
  (`services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature`).
- **PRESERVE** `@AC-19 @FR-9 @FR-4 @feature-204` "query_fundamentals csv columns incl symbol,
  period_end, pe_ratio, eps, market_cap" (same file) — re-derived pe_ratio/market_cap surface here;
  column shape must not regress.
- **PRESERVE (conditional on ingest being touched)** `@AC-1 @FR-2 @feature-173` +
  `@AC-3 @FR-1 @FR-3 @feature-173` present-aware config reads (zero-meaningful backfill keys)
  (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — only if the fix
  changes ingest backfill config reads.

**Un-promoted feature-198 guarantees the design MUST preserve (C-16, source
`docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature`):**
- `@AC-1` same-range re-backfill creates **no duplicate** row for `(symbol, fiscal_period, period_type)`.
- `@AC-2` **no earlier period row overwritten by a later fetch** (earliest `filed_date` wins).
- `@AC-3` as-of read hides a filing until T+1.
- `@AC-4` backtest operand pe_ratio computed **point-in-time from the adjusted close at the filing
  date**, not a current snapshot.
- `@AC-5` FMP ratio-enrichment degrades gracefully at the daily cap.
- `@AC-6` fundamentals backfill is `data_kind FUNDAMENTALS`, not a timeframe.

## Dependencies

- Proto/RPC: `BackfillFundamentalsRequest.overwrite = 4` (`packages/proto/marketdata/v1/marketdata.proto:296`)
  already exists but is **unwired** in marketdata; `TriggerBackfillRequest.overwrite = 4`
  (`ingest.proto:77`) forwarded to marketdata already. **No new proto fields needed.**
- Migration: **none** — `fundamentals_history` price columns already exist (`005_fundamentals_history.up.sql:16-24`).
- Config keys: **none new** — reuse existing marketdata fundamentals/dividends keys.
- Inter-service edges: agent → ingest `TriggerBackfill` (unchanged); ingest → marketdata
  `BackfillFundamentals` (unchanged, overwrite already forwarded).
- New env vars / ports: none.

## Risks / Not-found

- **fails.md:757 (upsert partial-row trap).** A prior 6-round debate shipped a column-scoped
  `upsert_entry` whose INSERT arm could create a **brand-new partial row** for a key that never
  existed. Here the INSERT arm writes the FULL as-reported row (from `FetchHistorical`), so the risk is
  the inverse: the **DO UPDATE arm** must be scoped-exact to price-join columns and must never rewrite
  as-reported fields or `filed_date`. Guard the conflict target to exactly the triple PK.
- **fails.md:722 (missed the real ON CONFLICT write path).** A design updated schema + triggers but
  missed the actual `INSERT ... ON CONFLICT DO UPDATE` statement, leaving a column NULL forever. The
  fix's edit must land on the exact statement at `marketdata_repo.go:610`, not a sibling.
- **NIL-CLOBBER hazard (design-critical).** `priceJoin` leaves metrics nil when bars are absent
  (`:1849-1851`). A naive `DO UPDATE SET price = EXCLUDED.price` on a later no-bars re-backfill would
  **overwrite a previously-derived good price with nil** — regressing both recovery and fail-closed
  (`@AC-5 @feature-211`). The upsert must be nil-safe (`COALESCE(EXCLUDED.x, existing.x)` or "update
  only when EXCLUDED IS NOT NULL"). This is the central correctness question for the debate.
- **EXTEND vs CHANGE of feature-198 idempotency (C-16).** Re-deriving price columns on existing rows
  is an EXTEND **iff** as-reported fields + earliest `filed_date` stay intact; if `overwrite=true` is
  allowed to touch `filed_date` or as-reported values, that is a CHANGE to feature-198 `@AC-1`/`@AC-2`
  requiring explicit user sign-off in `context.md`. Design must land on EXTEND.
- **`overwrite` semantics fork (design-critical).** `overwrite` currently governs nothing in
  marketdata (bars are unconditionally upserted; `overwrite_existing` also unread). Options: (a) gate
  re-derivation on `overwrite=true`; (b) default "fill-if-null" of price columns on any re-backfill
  (recovers the pre-existing AAPL/MSFT/KO nil rows without an operator flag) plus `overwrite=true`
  forcing a full recompute; (c) hybrid. Resolve in the debate. Report's "overwrite governs the bars
  fetch" is imprecise (verified: overwrite governs nothing) — do not carry that framing forward.
- **debt_to_equity is OUT of scope.** The report notes pre-feature-211 rows carry the old
  liabilities-based `debt_to_equity` and no `dividend_yield`; `debt_to_equity` is an **as-reported /
  formula-derived** field, not a price-join metric — re-deriving it would rewrite an as-reported value
  (C-16 CHANGE, needs sign-off) and is a different root cause (211 formula change). The fix scope is
  the five price-join metrics only; `dividend_yield` IS in scope (price-dependent).
- **Ingest ordering can't fix recovery.** `TriggerBackfill` is one-`data_kind`-per-request; the
  caller (agent) issues bars and fundamentals as two separate calls. So "bars-before-fundamentals"
  is caller-sequencing, fixes only the forward case for new symbols, and cannot recover existing
  missing rows — the write-path re-derivation is the necessary fix. Whether to ALSO add caller/orchestration
  ordering is a secondary, optional question.
- **C-16 promotion debt (not-found).** `@feature-198` matches zero durable suites; feature 198 is
  launched. Recommend recording promotion debt and (separately) having `scenario-promoter` backfill
  198's scenarios into `services/xstockstrat-marketdata/acceptance/`. Does not block this fix.
- **C-14 surface ambiguity.** `xstockstrat-ui /insights/data-explorer` (`@AC-8 @feature-211`) renders
  these metrics but was not in the product-spec Affected Services. The fix re-derives backend data that
  flows to the existing surface unchanged (no UI code change), but the debate should confirm ui is
  "existing surface, no change" vs. needs its own step.
- **No `internal/testdata/` Go fixture home** for marketdata (C-13) — inline fakes in the test file
  are compliant for a single consumer.

## Recommended Scope

Advisory (input to grilling + `/sdd-spec`), assuming the debate lands on the write-path re-derivation:

1. **marketdata write path** — make the `fundamentals_history` write re-derivable for price-join
   columns only: a nil-safe, column-scoped `ON CONFLICT (symbol, fiscal_period, period_type) DO
   UPDATE` (or a sibling method) that never touches as-reported fields or `filed_date`; decide the
   `overwrite` vs fill-if-null trigger in the debate. (`marketdata_repo.go` + wire `overwrite` from
   `BackfillFundamentals` → `backfillOneSymbol` → the write in `marketdata_service.go`.)
2. **marketdata tests** — RED: no-bars backfill leaves metrics nil; bars-present re-backfill
   re-derives and persists; as-reported fields + earliest `filed_date` unchanged; no-bars re-run does
   not clobber an existing good price (nil-safety). Extend `fakeHistRepo211`.
3. **(optional, if debate approves) caller/orchestration ordering** — bars-before-fundamentals for
   new-symbol forward case (agent `trigger_backfill` or ingest). Likely deferred / out of scope for a
   SEV-3 (YAGNI, C-18) since it cannot recover existing rows.
4. **acceptance promotion / C-16 debt** — note only; not this fix's step.
