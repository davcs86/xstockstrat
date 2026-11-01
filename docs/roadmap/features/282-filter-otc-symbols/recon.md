# Recon: filter-otc-symbols

**Created**: 2026-11-01
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-portfolio, xstockstrat-agent, xstockstrat-ui

---

## Objective

Keep symbols the platform cannot serve out of watchlists and the bar-ingestion warm set. Marketdata owns one "unservable" predicate: a symbol is unservable when it is absent from the active+tradable Alpaca asset set (delisted, inactive, non-tradable) or present with `Asset.exchange == "OTC"`. Portfolio refuses such symbols per-symbol on add paths, accepts the rest, and reports each refusal; agent and UI surface the refusals. Marketdata stops warming and live-fetching them. Existing entries are left alone; the staging cleanup was a one-time operator action.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Asset source: `alpaca.Client.ListAssets` — `internal/alpaca/client.go:520-558` (`status=active` at `:521`, `!Tradable` skip at `:548`, decode struct `:512-517`); no `exchange` query param
  - `source.DataSourceClient.ListAssets` — `internal/source/source.go:18`; `MarketDataService.ListAssets` — `internal/service/marketdata_service.go:1353-1363`; handler `internal/handler/marketdata_handler.go:216`, adapter `:384`
  - Warm set: `warmSymbols`/`warmMu` — `marketdata_service.go:47-50`; `markWarm` `:1088-1095`; `warmSnapshot` `:1099`
  - `markWarm` call sites: `GetBars :262`, `GetLatestQuote :545`, `GetLatestQuotes :575`, `GetLatestPrice :688`, `BatchGetBars :749`, `BatchGetLatestPrice :868`
  - Warm readers: `ingestRecentBars :1262` (via `StartBarIngestPoller :1187`), `classificationUniverse` (`classification_service.go:82`); `StartWarmQuotePoller :1111` copies `s.warmSymbols` inline at `:1132-1137` (bypasses `warmSnapshot`)
  - `GetBars` live-fetch triggers: DB miss / stale refetch `:312-332` via `fetchAndCacheBars :355`
  - Cache/refresher templates: `etfFlagState` — `internal/service/etf_flags.go:33-148`; `StartClassificationRefreshPoller` — `classification_service.go:224-247`; `singleflight.Group` fields `marketdata_service.go:60,64,67`
  - Config reads: `intGetter`/`resolvePositiveInt` `:115,986-993`; `config.Watcher.Get*` `internal/config/config.go:142-195`
  - Proto: `ListAssetsRequest{asset_class=1,tradable_only=2}` (`marketdata.proto:188`; `tradable_only` is never read), `common.v1.Asset{symbol=1,exchange=2,asset_class=3}` (`common.proto:35-39`), last RPC `GetEtfFlags :72` with `EtfFlag{symbol=1, optional bool is_etf=2}` `:396-407`
  - Last migration: `009_symbol_classification` (next 010; no 007 exists)
- **`xstockstrat-portfolio`** (Go)
  - Normalizers: `normalizeSymbols :1788`, `normalizeBindings :1807`, `requestBindings :1830` (called from `CreateWatchlist :1914`, legacy replace-all `UpdateWatchlist :2064`, `AddWatchlistSymbols :2177`); `applyDefaultStrategy :1847` skips SIGNAL bindings
  - Only INSERT into `portfolio.watchlist_symbols`: `insertBindingsTx` — `internal/repository/watchlist_repo.go:494`; replace-all deletes and reinserts `:210-213`
  - Cap check on `AddWatchlistSymbols` runs on the pre-filter union `:2179-2183`
  - `UpdateWatchlistBinding :2080` / `UpdateWatchlistBindings :2112` are rebind-only (never insert); `EnsureSignalWatchlist :1939` takes no symbols
  - Marketdata client: field `portfolio_service.go:46`, dial `:134-140` (mTLS); fail-open-with-WARN pattern `latestQuotesFor :404-413`; timeout `quoteTimeout :423-432` (`portfolio.marketdata.quote_timeout_ms`, default 4000); header interceptor `internal/middleware/propagation.go:39`
  - Proto: `CreateWatchlistResponse :283`, `UpdateWatchlistResponse :319`, `AddWatchlistSymbolsResponse :334` each carry only `Watchlist watchlist = 1`; `WatchlistBinding :243`, `Watchlist :252` (fields 1-10)
  - Tests: `stubMarketData` `portfolio_service_test.go:18-61` (panics on unstubbed methods); `newSvc` `watchlist_service_test.go:275` leaves `marketdata` nil
- **`xstockstrat-agent`** (Python)
  - `manage_watchlist_symbols` `app/tools.py:2124,2155-2158`; `manage_watchlist :2040`; `client.add_watchlist_symbols app/client.py:525-545` returns only `{"watchlist": ...}`; create `:400`, update `:431`
  - Signal add: `ingest_signal` `tools.py:688-696` -> `client.add_watchlist_symbol client.py:315-330` (response discarded; bare `except Exception` WARN)
  - Docs: `docs/runbooks/mcp-tools.md:1263-1301,1306-1335,224-255`; `services/xstockstrat-agent/CLAUDE.md:82-83,134`; doc-parity test `tests/test_watchlist_tools.py:312`
- **`xstockstrat-ui`** (Next.js)
  - Add controls (no `/trader` add control): `src/components/insights/WatchlistDetail.tsx:101-115` (no error UI), `src/app/insights/screener/page.tsx:149-158` (save-as + Add top N), `src/app/insights/watchlists/page.tsx:57-71` (create dialog, name only)
  - Hooks `src/hooks/useWatchlists.ts:37,65,97`; BFF passthrough `src/lib/insightsBff.ts:134-144`
  - Primitives `src/components/shared/{QueryStateMessages,CardNotice,FormDialog,EmptyState}.tsx`; no toast library
  - Mock `e2e/helpers/watchlistMock.ts:41,91,130-139`; catalog `e2e/fixtures/INVENTORY.md:43`

## Patterns to REUSE

- Asset-set cache with TTL, bounded size and background refresh -> reuse `etfFlagState` shape (`etf_flags.go:33-148`) and the poller template `classification_service.go:224-247`; coalesce refreshes with the existing `singleflight.Group` idiom (`marketdata_service.go:603-606`)
- Classification RPC shape -> mirror `GetEtfFlags` (`marketdata.proto:72,396-407`): batch symbols in, per-symbol result out, additive
- Portfolio fail-open call -> reuse `latestQuotesFor` timeout + WARN + `ok=false` (`portfolio_service.go:404-423`) and the `portfolio.marketdata.*` timeout key convention
- One predicate, owned by marketdata, asked by portfolio (ledger `fails.md:656`) — never re-derive from `Asset.exchange` in portfolio/agent/ui
- Agent response mapping -> extend `client.add_watchlist_symbols` return dict (`client.py:545`)
- UI -> add-time refusal feedback via `CardNotice` (muted/error variants) or a new variant, not hand-rolled markup (C-17); test data via `watchlistMock.ts` + INVENTORY row (C-12)
- Test fakes: marketdata `fakeBackfillSource` et al. (`marketdata_service_test.go:714,1182,1457,1532,1560`) — adding a method to `DataSourceClient` breaks all six

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-7` "Adding a bare symbol binds it to the watchlist default at add time" (`services/xstockstrat-portfolio/acceptance/watchlist-bulk-default-strategy.feature`) — default applies to accepted symbols only
- **EXTEND** `@AC-10` "CreateWatchlist applies the default to initial bare symbols" (same file) — applied to surviving symbols; refused ones reported
- **PRESERVE** `@AC-8`, `@AC-9`, `@AC-2`, `@AC-4` (same file) — explicit binding wins; default-only update never re-filters stored symbols; bulk rebind of stored symbols is never refused; all-or-nothing NOT_FOUND stays
- **PRESERVE** `@AC-1`, `@AC-3` (`.../watchlist-single-strategy-update.feature`) — single-row rebind; `UpdateWatchlistBinding` never inserts
- **PRESERVE** `@AC-6 @feature-127` (`.../consolidate-watchlist-signal.feature`) — `EnsureSignalWatchlist` idempotent
- **PRESERVE** `@AC-1 @feature-154` (`.../fundsignal-watchlist-universe.feature`) — `ListAllWatchlistSymbols` read path is not filtered
- **PRESERVE** `@AC-2`, `@AC-7 @feature-196` (`.../proto-deprecated-field-removal-program.feature`) — `Watchlist.symbols` mirrors stored bindings; per-list cap stays InvalidArgument (decide whether refused symbols count)
- **PRESERVE** `@AC-2 @feature-178` (portfolio) and `@AC-3 @feature-178` (marketdata, `quote-fanout-batching.feature`) — no per-symbol classification on reads; cold-symbol single-flight (fixture ZZZZ) must not be gated
- **PRESERVE** `@AC-53`, `@AC-54 @feature-240` (`.../offline-account-full-pnl.feature`), `@AC-3 @feature-191` (`.../opportunities-latency-fix.feature`) — `BatchGetBars` strict/partial semantics, omit-not-fabricate
- **PRESERVE** `@AC-1 @feature-153` (`.../fix-ohlcv-chunk-lock-oom.feature`) — classification must be an in-memory lookup, no extra DB/chunk load
- **EXTEND** `@AC-4`, `@AC-7 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — create/add return the written watchlist plus refused symbols and reasons
- **PRESERVE** `@AC-5 @feature-148` — name-only update must not wipe stored symbols (classify only newly added symbols)
- **PRESERVE** `@AC-8 @feature-148` — remove must still drop stored unservable entries
- **PRESERVE** `@AC-4 @feature-127` (`.../consolidate-watchlist-signal.feature`) — a refusal never fails the committed ingest; **EXTEND** `@AC-5` — docstring and `mcp-tools.md` must state unservable symbols are skipped
- **PRESERVE** UI `@AC-1`, `@AC-6 @feature-170`, `@AC-6 @feature-167`, `@AC-2 @feature-181` — bulk remove, default-strategy set, single-row patch, readiness degrade must keep working on stored unservable rows
- **PRESERVE (narrowing)** `@AC-1 @feature-127` (`docs/sdd/business-rules/platform.feature`) — "a watchlist-direction signal adds the symbol" holds for servable symbols; 282 `@AC-5` narrows it (needs recorded acknowledgement)
- **PRESERVE** `@AC-5 @feature-210`, `@AC-5 @feature-181` (`platform.feature`) — new portfolio->marketdata call propagates the header trio over mTLS; no new dependency cycle
- No existing acceptance guarantee for a UI watchlist add form or add-time refusal — wholly new.

## Dependencies

- Proto/RPC: new additive marketdata RPC (or `ListAssets` filter) for classification; additive refusal field(s) on `CreateWatchlistResponse`/`UpdateWatchlistResponse`/`AddWatchlistSymbolsResponse` (next free field number 2 each); reason should be an enum (C-04). `common.v1.Asset` needs no change.
- Migration: none expected (cache in memory); next marketdata number would be 010 if a table is chosen.
- Config keys: none registered yet. The "always filter" decision rules out an on/off key; an asset-set refresh interval/TTL and a portfolio classify timeout would be new keys (design to decide; F-07 forbids hardcoded values).
- Inter-service edges: portfolio -> marketdata (existing edge, new RPC); agent/ui -> portfolio (existing).
- New env vars / ports: none expected; `docker-compose.yml`, `.do/app*.yaml` not re-audited by discovery (cache-only design adds none).

## Risks / Not-found

- Not found: any OTC/unservable classification, asset-set cache, or "is X servable" RPC anywhere in marketdata; any refusal field in portfolio protos; any toast library or `/trader` add control; any UI acceptance for add-time refusal; any test stubbing marketdata in portfolio watchlist suites.
- Live values for CRTD/BOSSY/FORL/CERO/DNB in Alpaca `ListAssets` (exchange, presence) are unverified — needs live credentials.
- **Replace-all `UpdateWatchlist` / agent read-modify-write** (`@AC-5 @feature-148`): classifying the whole submitted list would silently drop already-stored unservable entries. Classify only symbols newly added relative to the stored list.
- Spec `acceptance.feature` `@AC-8` lists `UpdateWatchlistBinding` as a write path, but that RPC is rebind-only (`@AC-3 @feature-167`); the scenario needs correcting or it implies a CHANGE.
- Gate scope: `BatchGetBars`/`GetLatestQuote(s)` share the warm/live-fetch machinery but are not in 282's declared scope; extending the gate there would change `@AC-53`/`@AC-3 @feature-178` (fixture ZZZZ is not a listed ticker).
- `StartWarmQuotePoller` bypasses `warmSnapshot()`; a filter only on the snapshot misses it. `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:914`) source-scans for `s.markWarm(req.Symbol)`.
- Cap ordering on `AddWatchlistSymbols` (cap checked before filtering today).
- Empty/failed asset-set load must never classify everything as unservable (FR-5 fail-open); the first-boot window before the cache is populated is the same case.
- Mistyped tickers are refused too (absence = unservable) — intended, but a behavior change worth stating in UI/agent copy.
- Ledger trap `fails.md:656`: firing predicate replicated into a new call site instead of extracted — keep one marketdata-owned predicate.
- Feature overlap: 215 (in-progress) edits `marketdata.proto`; 215/255 edit `marketdata_service.go`; add a merge-order row if the impl-spec touches those files; 275 changes `GetBars` error handling in analysis.

## Recommended Scope

Advisory step boundaries:
1. proto (marketdata classification RPC + portfolio additive refusal fields), `buf lint`/`buf breaking`, regenerate stubs
2. marketdata: asset-set cache + refresher + predicate + RPC; gate `markWarm` (all 6 sites plus the inline warm copy), `GetBars` live fetch; tests
3. portfolio: filter newly added symbols on Create/Update(replace-all)/AddWatchlistSymbols with fail-open; cap after filter; tests with marketdata stub
4. agent: map refusals in `client.py`/tools, signal-path WARN, docs (`mcp-tools.md`, `CLAUDE.md`)
5. ui: refusal feedback on the three add controls, mock + fixture + INVENTORY row, e2e
6. correct `acceptance.feature` AC-8; add scenarios for the replace-all/read-modify-write case
