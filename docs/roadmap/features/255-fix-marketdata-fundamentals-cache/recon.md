# Recon: fix-marketdata-fundamentals-cache

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata

---

## Objective

Fix five SEV-3 defects (Track C) in the marketdata fundamentals cache and the Alpaca stream manager.

- **D-50:** correct the comments and docs that call `marketdata.fmp.daily_request_cap <= 0` "uncapped". It is a zero budget (OQ-1, operator 2026-10-22), and no behaviour changes.
- **D-51:** make the quota counts source-aware.
- **D-52:** make the vendor cache check source-aware.
- **D-53:** stop silently dropping `extra` decode errors and FMP enrichment errors, and stop caching a partial enrichment as fresh.
- **D-19:** give the Alpaca reconnect budget a consecutive-failure counter, a cancellable backoff and a subscriber-visible give-up.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `func main` — `services/xstockstrat-marketdata/cmd/server/main.go:34`.
    - `fundProvider` is read at boot at `:125`, with a default of `"finnhub"`.
    - The FMP budget boot seed is `repo.CountFundamentalsFetchedToday(ctx)` → `fmpClient.SeedBudget(n)` at `:129-130`. On error it warns and starts from 0 (`:132`).
  - Handlers:
    - `MarketDataHandler.GetFundamentals` — `internal/handler/marketdata_handler.go:226`.
    - gRPC adapter — `:448`.
    - Stream handlers — `:32` (`StreamBars`) and `:58` (`StreamQuotes`).
  - Service, `internal/service/marketdata_service.go`:
    - `GetFundamentals` — `:1586`. It dispatches to `getEdgarSnapshot` when `snapshotSource()==edgar` (`:1590`); otherwise it runs `fundamentalsEnabled` then `resolveFundamentals`.
    - `GetFundamentalsMulti` — `:1605`. The edgar branch is `:1608`. The vendor branch:
      - cache loop at `:1668-1681`;
      - fresh-row accept, **source-blind**, at `:1676`;
      - quota gate `count >= cap` at `:1688`;
      - stale serve at `:1690-1694`;
      - `ErrFMPDailyCapExceeded` stale serve at `:1697-1702`;
      - upsert at `:1707`.
    - `resolveFundamentals` (single) — `:1728`:
      - fresh-row accept, **source-blind**, at `:1734`;
      - quota gate at `:1742`;
      - stale or `ResourceExhausted` at `:1743-1746`;
      - cap-exceeded handling at `:1750-1755`;
      - upsert at `:1762`.
    - `snapshotSource()` — `:1786`, with key `marketdata.fundamentals.snapshot_source` at `:1790`.
    - `cacheAxis(src)` — `:1805`. `edgar` and `edgar+fmp` map to `"edgar"`; every other value maps to `"vendor"`.
    - `edgarResolve`:
      - source-aware cache check at `:1849-1850`;
      - non-SEC-filer fallback to `resolveFundamentals` at `:1868`.
    - `edgarFinish` caches only a live-priced snapshot (`:1876-1885`). It cites the "memoize only successes" rule.
    - `edgarSnapshotFromPeriod` sets `Source="edgar"` explicitly (comment at `:1901`).
    - `fundamentalsQuota`:
      - Finnhub window: `CountFundamentalsFetchedSince` at `:1935`.
      - FMP: `fmpBudget.BudgetSnapshot()` at `:1939`. There is no repo call when the budget is wired.
      - Repo fallback `CountFundamentalsFetchedToday` at `:1943`, only when `fmpBudget == nil`.
    - `quotaCountAfterFetch` — `:1950`.
    - `atQuotaAlertThreshold` — `:1958-1959`. The comment says "cap <= 0 is never 'at threshold'"; the code is `cap > 0 && count >= (cap*8)/10`.
    - `maybeAlertQuota` — `:1963`.
    - `toProtoFundamentals`:
      - `:2012`;
      - `missing` is built from nil metric pointers at `:2033-2038`;
      - `MissingMetrics: missing` at `:2056`.
    - `enrichmentUnderCap` — `:2421-2427`. It returns false when `fmpBudget == nil`, otherwise `used < dailyCap`.
    - The second `pb.MissingMetrics = missing` is `toProtoHistoricalPeriod` at `:2466`, on the historical path.
    - The `fundamentalsRepo` interface count methods, which take no source param, are at `:157-158`.
  - FMP client, `internal/fmp/fmp_client.go`:
    - `SeedBudget` — `:88`.
    - `BudgetSnapshot` — `:98`. Its comment at `:97` says "(cap <= 0 = uncapped)", which is wrong.
    - `reserve` — `:122`. It refuses at `:127` (`c.used >= dailyCap`).
    - `refund` — `:135`.
    - `GetFundamentals` (single) — `:160`. It delegates to `GetFundamentalsMulti`.
    - `GetFundamentalsMulti` — `:173`. Enrichment errors are dropped at `:195` (`fetchRatios`, `rErr == nil && r != nil`) and `:198` (`fetchProfile`).
    - `fetchRatios` — `:273`.
    - `fetchProfile` — `:286`.
    - `fmpRatios.apply` (`:347-352`) sets PB, DividendYield, ROE and DebtToEquity.
    - `fmpProfile.apply` sets Beta, Sector and Currency (`:381-386`).
  - Repo, `internal/repository/marketdata_repo.go`:
    - `GetFundamentals` — `:530`. Its silent decode is at `:548`.
    - `UpsertFundamentals` — `:574`.
    - `CountFundamentalsFetchedToday` — `:656`. Its SQL is at `:658-659`, with no `source` predicate.
    - `CountFundamentalsFetchedSince` — `:669`. Its SQL is at `:670`, with no `source` predicate.
    - `QueryHistoricalFundamentals` — `:785`. Its silent decode is at `:836`.
    - `LatestHistoricalFundamental` — `:864`. Its silent decode is at `:889`.
  - Stream manager, `internal/alpaca/stream.go`:
    - Defaults `defaultReconnectDelayMs = 2000` and `defaultMaxReconnects = 10` are at `:18-19`.
    - The `streamManager` struct is at `:60-67`. It has no manager ctx and no stop channel.
    - `add()` is at `:107`. Its per-subscriber `ctx.Done()` goroutine deletes from `subs` and closes `barCh`/`quoteCh` (`:121-132`).
    - `run()` is at `:137`:
      - `attempts := 0` at `:147`, never reset;
      - `attempts++` at `:163`;
      - the give-up at `:165-170` logs and sets `running=false` only;
      - `time.Sleep` at `:172`.
    - `connectAndRead()` is at `:178`:
      - the URL is hardcoded `wss://stream.data.alpaca.markets/v2/%s` at `:183`;
      - it uses `context.WithCancel(context.Background())` at `:185`;
      - the session is established once `"alpaca stream connected"` is logged at `:214`.
    - `subscriberCount()` — `:299`.
    - Consumers: `StartBarStream`/`StartQuoteStream` range over the feed channel and emit `marketdata.feed.disconnected` when it closes (`marketdata_service.go:1493-1517`, `:1528`). Closing subscriber channels on give-up is therefore observable there. Per the product spec, no in-repo caller starts a stream today.
  - Last migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`).
    - The `source` column is `text NOT NULL DEFAULT 'fmp'` (`migrations/002_fundamentals.up.sql:23`).
    - `idx_fundamentals_fetched_at ON (fetched_at)` is at `:27-28`.
  - Config-read pattern: `s.fundCfg.GetInt("marketdata."+s.fundProvider+".cache_ttl_hours", 24)` (`marketdata_service.go:1662`, `:1729`); `cfgWatcher.GetString(...)` at boot (`main.go:125`).
  - Proto: `repeated string missing_metrics = 18;` (`packages/proto/marketdata/v1/marketdata.proto:241`). It is documented at `:213-218`; consumers must check it before treating `0.0` as data.

## Patterns to REUSE

- **Source-aware vendor cache check (D-52):** mirror the edgar-axis predicate `cacheAxis(cached.Source) == snapshotSourceEdgar` (`marketdata_service.go:1849-1850`). On the vendor path, use `cacheAxis(f.Source) == snapshotSourceVendor` and reuse `cacheAxis` at `:1805`. Do not compare raw strings, because feature 211 design point 5 requires the axis check.
- **Single 80% threshold home (D-50 and the `@AC-14 @feature-215` filler):** reuse `atQuotaAlertThreshold` (`:1959`). Only its comment changes, and it must not be duplicated (C-18, DRY guard rail).
- **Zero-budget gates (D-50):** keep `reserve()` (`fmp_client.go:127`), the `count >= cap` gates (`:1688`, `:1742`) and `enrichmentUnderCap` (`:2421`) unchanged.
- **Missing-metric derivation (D-53):** `toProtoFundamentals` already lists nil metric pointers in `MissingMetrics` (`:2033-2038`). A failed ratios or profile call leaves those pointers nil, so `missing_metrics` largely self-populates, and no new proto field is needed.
- **Success-only caching (D-53):** follow `edgarFinish` (`:1876-1885`), which skips the upsert for a non-live-priced snapshot, and the ledger rule `fails.md:2290` ("memoize only successful reads"). This is the in-repo precedent for "do not pin a partial row for the TTL".
- **Logging:** use `slog.WarnContext(ctx, ...)`, as in `edgarResolve` (`:1843`, `:1864`), so trace ids ride the log line (operator standing decision on x-trace-id). Two older vendor-path upsert WARNs use context-free `slog.Warn` (`:1708`, `:1763`); new log lines must not copy them.
- **Service test fakes** (`internal/service/marketdata_service_test.go`):
  - `fakeFundRepo` (`:180`), whose count methods (`:208`, `:216`) ignore source;
  - `fakeFundSource` (`:220`);
  - `fakeCfg` (`:250`);
  - `fakeNotify.warnings` (`:275-285`);
  - `enabledCfg(provider)` (`:290`);
  - `newFundSvc(...)` (`:309`);
  - `fakeBudget` (`:2035-2037`).
  - Analogues to copy: `TestGetFundamentals_AtCapNoCacheResourceExhausted` (`:400`), `TestGetFundamentals_QuotaWarningEmittedOnce` (`:483`), `TestGetFundamentals_Finnhub_AtCapStale` (`:541`), `TestBackfillFundamentals_CapDegrade_AC5` (`:2041`) and `TestGetFundamentals_EdgarCacheSelfHeal_feature211` (`:2433`).
- **Repo SQL tests:** use `pgxmock/v4` in `internal/repository/marketdata_repo_test.go`, e.g. `TestUpsertFundamentals_CastsExtraMetricsToJSONB` (`:118`).
- **FMP client tests:** `internal/fmp/fmp_gateway_test.go` covers the cap and `ErrFMPDailyCapExceeded` (`:78-133`).
- **Stream tests:** `internal/alpaca/stream_test.go` has only `TestDispatchBarCarries1MinEnum` (`:20`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-7 @FR-7 @feature-215` "Marketdata reports fundamentals absence distinctly from outage and disable" (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`):
  - absence → NotFound;
  - global disable → FailedPrecondition;
  - quota → ResourceExhausted.
  - The FR-1, FR-3 and FR-4 paths must not remap these.
- **PRESERVE** `@AC-14 @FR-11 @feature-215` "The ETF label never spends the guard's FMP headroom" (same file): the filler gates `cap > 0` and `!atQuotaAlertThreshold`. Cap <= 0 as zero budget is consistent with FR-1, and the 80% helper stays single-sourced when its comment is corrected.
- **PRESERVE** `@AC-5 @FR-3 @feature-198` "FMP-Free ratio enrichment degrades gracefully at the daily cap" (`services/xstockstrat-marketdata/acceptance/historical-fundamentals-backtest.feature`):
  - at the cap, EDGAR rows persist and the FMP ratio fields stay null without failing;
  - cap 0 is a zero budget (`TestBackfillFundamentals_CapDegrade_AC5`);
  - the D-53 partial-cache rule applies to the snapshot path, not to `BackfillFundamentals`.
- **PRESERVE** `@AC-6 @FR-5 @FR-8 @feature-211` "The snapshot path serves the latest EDGAR filing after the vendors are disabled" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`): the edgar-axis source-aware cache check that FR-3 mirrors must stay intact.
- **PRESERVE** `@AC-7 @FR-5 @feature-211` "A non-SEC-filing symbol falls back to the vendor path" (same file): after FR-3, the edgar-mode vendor fallback (`edgarResolve` → `resolveFundamentals`, `:1868`) must still serve vendor data marked vendor-sourced.
- **PRESERVE** `@AC-4 @FR-6 @regression @feature-231` "The EDGAR fundamentals snapshot is priced from the quote mark" (`services/xstockstrat-marketdata/acceptance/fix-after-hours-positions-priced.feature`): edgar cache rows are still written with `source=edgar` under the same write/skip rule, since D-51 and D-52 key on that column.
- **PRESERVE** `@AC-10 @FR-6 @feature-231` "EDGAR multi-symbol fundamentals price pending symbols with one quote call" (same file): keep the single `GetLatestQuotes` call when editing the Multi quota gates.
- **PRESERVE** `@feature-217 @AC-4` "Failed FMP calls refund the shared daily budget" (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`): the single shared FMP day budget refunds on a failed call. The D-51 boot seed and the D-53 `ErrFMPDailyCapExceeded` handling must not break `reserve()` or `refund()`.
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-196` "deprecating a response field never changes the proto schema" (`docs/sdd/business-rules/platform.feature`): D-53 reuses `missing_metrics` (field 18) and adds no proto field.
- **PRESERVE** `@AC-3 @FR-6 @regression @feature-196` "deprecated enum values stay defined" (`docs/sdd/business-rules/platform.feature`): the FR-5 stream-manager work must still emit `TIMEFRAME_1MIN` on streamed bars, which `TestDispatchBarCarries1MinEnum` pins.
- No CHANGE verdicts. FR-1/OQ-1 (zero budget) agrees with `@AC-5 @feature-198`, `@AC-14 @feature-215` and `TestBackfillFundamentals_CapDegrade_AC5`.
- FR-5 has no existing `@AC-*` guarantee for reconnect behaviour.
- Coverage: all 15 suites under `services/xstockstrat-marketdata/acceptance/` plus `platform.feature` were read (about 100 scenarios, 10 relevant). Not impacted:
  - feature 178 quote singleflight;
  - feature 147 credential boot;
  - the feature 211/216 enrichment math;
  - feature 253 companyfacts;
  - the feature 217 classification store;
  - the quotes, bars and OHLCV suites;
  - the platform 224/210/226 rules.

## Dependencies

- **Proto/RPC:** none changed. Reads `Fundamentals.missing_metrics = 18` (`packages/proto/marketdata/v1/marketdata.proto:241`). `GetFundamentals`/`GetFundamentalsMulti` keep the same shape and status codes.
- **Migration:** none required.
  - The `source` column and `idx_fundamentals_fetched_at` already exist (`002_fundamentals.up.sql:23`, `:27-28`).
  - An optional `(source, fetched_at)` index would be `010_<description>.up.sql` + `.down.sql`, after `009_symbol_classification`. Design must decide whether to adopt it. Reserve the number at design time (`fails.md` 2026-08-06 fundamentals-signal-producer, migration).
- **Config keys:** all existing, none new.
  - `marketdata.fmp.daily_request_cap`: semantics unchanged, docs corrected.
    - `services/xstockstrat-marketdata/CLAUDE.md:82` does not mention `<= 0`.
    - `docs/patterns/config-governance.md:183` and `:773` describe the key without `<= 0` semantics.
  - `marketdata.fundamentals.provider`.
  - `marketdata.fundamentals.snapshot_source`.
  - `marketdata.<provider>.cache_ttl_hours`.
  - `marketdata.finnhub.symbols_per_minute` and `marketdata.finnhub.rate_window_seconds`.
  - `marketdata.stream.max_reconnects`, via `ClientConfig.MaxReconnects`.
- **Inter-service edges:** none new.
  - Consumer surfaces read the served result: agent `query_fundamentals` and `screen_symbols` (`services/xstockstrat-agent/app/tools.py:402`, `:812`), `traderBff.ts` and `insightsBff.ts`.
  - Analysis fundsignal (feature 246) benefits from `missing_metrics`.
- **New env vars / ports:** none.

## Risks / Not-found

- **Design fork, FR-2 boot seed (C-11).** The FMP budget is shared by the snapshot, ratio-enrichment and classification paths (`CLAUDE.md:82`, feature 217). The `*fmp.Client` is seeded even when `fundProvider` is `"finnhub"`, the boot default (`main.go:125`).
  - FR-2 says "active provider", but AC-3 is titled "counts only FMP rows". Seeding with `source=<active provider>` under Finnhub would seed the FMP budget with Finnhub rows, which is wrong.
  - Design must state that the seed filters on the FMP-consuming sources, whatever the active provider is. The Finnhub window filters on `source='finnhub'`.
- **Design fork, `edgar+fmp` rows.** These rows are on the edgar axis but may have spent FMP ratio calls. Neither a `source='fmp'` nor a `source='finnhub'` filter counts them. Design must decide whether they count toward the FMP seed. The seed is documented as a conservative floor, because classification calls write no fundamentals row.
- **Design fork, D-52 stale serve.** At quota (`:1690-1694`, `:1697-1702`, `:1743-1745`, `:1752`), the vendor path serves any found row with `stale=true`, including an edgar-axis row. Design must say whether an edgar row may be served stale on the vendor path, which would be labelled edgar via `Source`, or is skipped. Skipping it changes a stale-serve into ResourceExhausted, which `@AC-7 @feature-215` permits for quota but which is a visible change.
- **Design fork, D-53 "not fresh" mechanism (C-11).** TTL derives only from `fetched_at`. The options are:
  - skip the upsert, following the `edgarFinish` precedent;
  - upsert with a backdated `fetched_at`;
  - an `extra_metrics` marker.
- **No partial signal out of the FMP client.** `fmp.Client.GetFundamentalsMulti` (`fmp_client.go:195-200`) swallows the enrichment errors, and `source.Fundamentals` has no partial marker, so the service cannot tell a partial row from a complete one today. Design must define the carrier, for example a field on `source.Fundamentals` or a returned per-symbol error set. `ErrFMPDailyCapExceeded` from an enrichment call must not become a whole-call error, which would change the stale-serve path at `:1697`.
- **Spec gap, AC-5 "sector".** `acceptance.feature:57` expects `missing_metrics` to list `"beta"` and `"sector"`. The `toProtoFundamentals` metric list is `market_cap` … `year_low` (`:2021-2031`): it includes `beta` but not `sector`, which is a string. Design must either rewrite AC-5 to `beta` (plus the four ratio metrics for a ratios failure) or justify adding `sector` to the missing-metric vocabulary. The latter is not a proto change, but it changes the list's documented canonical names (`marketdata.proto:213-218`).
- **D-19 test seam.** There is no dial or URL seam (`stream.go:183`), the delay is only configurable through `ClientConfig.ReconnectDelayMs`, and there is no manager context. AC-7 and AC-8 need an injectable dialer/URL, for example an `httptest` websocket server. There is no in-repo websocket test server today.
- **D-19 double-close hazard.** `add()`'s goroutine (`stream.go:121-132`) closes subscriber channels on `ctx.Done()` after deleting from `subs`. A give-up that closes every subscriber's channels must remove each sub under `m.mu` first, and the per-sub goroutine must close only subs it still owns. Otherwise it double-closes and panics.
- **D-19 context and trace.** `run()` is a background loop with no originating request. Per the operator standing decision it may mint its own context, carrying a trace id where one is available. `connectAndRead`'s `context.Background()` (`:185`) is acceptable there, but the cancellable backoff needs a manager-owned ctx.
- **AC-3 boot-seed seam (review warning 2).** `main.go:129` is not unit-testable. Design must name a seam: extract the seed into a small function that takes the repo count interface, or assert on the repo count call's source argument through the `fundamentalsRepo` fake plus a `pgxmock` SQL test.
- **Interface change ripple.** Adding a source parameter to the count methods (`marketdata_service.go:157-158`) changes `fakeFundRepo` (`:208`, `:216`). Its `UpsertFundamentals` increments `todayCount` without regard to source (`:204`).
- **Cross-feature rebase.**
  - 215-block-fundamentals-strategy-on-etf (`in-progress`) edits the quota gates, `atQuotaAlertThreshold`, `reserve()`, the boot-seed wiring and `marketdata_service_test.go`. Recommended order: 255 after 215.
  - 254-fix-marketdata-secret-exposure (branch `feature/fix-marketdata-secret-exposure` only; no directory on this branch) edits `fmp_client.go:222`, `:243`, `:254` and `marketdata_service.go:1704`, `:1760`.
  - Neither has a merge-order row yet (`docs/roadmap/features/merge-order.md`). Design should propose the rows on a user yes (review warning 5).
  - Feature 246 (`implementation-ready`): its residual risk on cache rows with missing metrics is helped by the D-53 fix.
- **Ledger traps.**
  - `fails.md` 2026-08-13 (129, provider swap): grep every literal provider-named string when making the counts provider-aware.
  - `fails.md` 2026-08-06 (fundamentals-data-source): read a helper's full body before reusing it.
  - `fails.md:2290`: memoize only successes.
  - `insights.md` 2026-08-06: the small local interface seam for config and repo fakes.
- **Not opened or verified:** `.claude/skills/sdd-design/reference/recon-checklist.md`, and the full bodies of the `fmp_client.go` `:222`/`:243`/`:254` region (the 254 overlap).

## Recommended Scope

Advisory, ordered to limit rebase risk against 215 and 254:

1. **D-50 docs/comments only:**
   - `fmp_client.go:97`;
   - `marketdata_service.go:1958`;
   - marketdata `CLAUDE.md:82`;
   - `docs/patterns/config-governance.md:183`/`:773`.
   - Verified by an `/sdd-spec` checklist step. Add a behavioural pin for AC-1/AC-9: a cap 0 multi-path test alongside the existing single-path `AtCap` test.
2. **D-51:**
   - add a source filter to the two count queries, with `pgxmock` tests;
   - update the interface and fake;
   - the boot seed counts the FMP sources;
   - the Finnhub window counts `finnhub`.
   - The index decision is recorded, and the default is no `010` migration unless design shows a need.
3. **D-52:** apply a vendor-axis `cacheAxis` check at `:1676` and `:1734`, with tests mirroring `EdgarCacheSelfHeal`. Include the stale-serve decision, and check that the edgar fallback is not a loop.
4. **D-53a:** add a shared `extra` decode helper that logs a WARN, used by `:548`, `:836` and `:889`.
5. **D-53b:**
   - carry a partial-enrichment marker out of the FMP client with a WARN;
   - do not cache the partial row as fresh, using the chosen mechanism;
   - fill `missing_metrics`, after the AC-5 vocabulary is resolved.
6. **D-19 (isolated last step):**
   - manager ctx and dial seam;
   - consecutive-failure counter reset after `:214`;
   - ctx-cancellable backoff;
   - give-up closes the subscriber channels under `m.mu`, with no double-close, and logs ERROR;
   - `TIMEFRAME_1MIN` stays pinned.
7. **C-14 consumer verification** (agent, trader and insights BFF): read-only checks that the served shape and codes are unchanged.
