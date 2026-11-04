# Product Spec: filter-otc-symbols

**Created**: 2026-10-31

---

## Problem Statement

On staging the analysis live loop logs `had no 1d bars` every rotation (~14 min) for the same few symbols (CRTD, DNB, FORL, BOSSY). Marketdata retries a live Alpaca fetch for each of them on every `GetBars` miss (no negative cache), and `GetBars` marks them warm, so the always-on bar ingester re-fetches them every 5 minutes as well. Verified 2026-11-01 against FMP and Webull: CRTD, BOSSY and FORL are OTC / pink / expert-market symbols, which the Alpaca `iex` feed (`marketdata.alpaca.feed`, default `iex`) does not serve; DNB is a reused, delisted ticker. Operators and traders who add such symbols get permanent no-data entries and recurring wasted work and log noise instead of a clear refusal.

## User Story

As a trader or operator, I want OTC, delisted and non-tradable symbols kept out of watchlists and the bar-ingestion warm set, so that symbols the platform cannot serve stop generating failing `GetBars` calls, repeated Alpaca fetches and no-bars warnings.

## Functional Requirements

FR-1. Marketdata classifies a symbol as **unservable** when it is absent from its in-memory active+tradable Alpaca `us_equity` asset set (delisted, inactive, non-tradable, mistyped, crypto) or present with `Asset.exchange` `OTC`, and exposes that to other services through one additive RPC, since marketdata is the only service allowed to call Alpaca. "Unservable" is the single marketdata-owned predicate; the set is refreshed in the background and a failed refresh keeps the last good set.
FR-2. Watchlist writes refuse unservable symbols on every path that inserts symbols (`AddWatchlistSymbols`, and the symbols or bindings of `CreateWatchlist` and replace-all `UpdateWatchlist`) and report each refused symbol with an enum reason; other symbols in the same request are stored. "Refused" means "not newly added because unservable". The per-list cap is applied to the accepted symbols only. Masked updates, binding rebinds and `EnsureSignalWatchlist` never classify.
FR-3. `GetBars`, `BatchGetBars` and `BatchGetLatestPrice` do not add an unservable symbol to the warm set and make no live Alpaca fetch for it; stored bars and stored previous close are still returned. The first successful asset-set load removes symbols that were warmed while the set was unloaded. Quote and price paths (`GetLatestQuote`, `GetLatestQuotes`, `GetLatestPrice`) and every warm-set reader are not filtered, so held positions stay priced.
FR-4. Signal-driven additions arrive as `AddWatchlistSymbols` with a SIGNAL binding (agent `ingest_signal`); unservable symbols are refused the same way, the ingest still succeeds, and the refusal is returned to the caller as `watchlist_refused`.
FR-5. When classification is unavailable, nothing is blocked: portfolio lets a write through (WARN) when the marketdata call fails, times out or reports the set unloaded, and marketdata treats every symbol as servable until its first successful load. After the first load a failed, empty or shrunken (<50% of the last good set) refresh keeps the last good set instead of failing open. An empty or failed load never classifies every symbol as unservable.

## Out of Scope

- Any migration, cleanup job, mark or new field for existing unservable entries; staging was handled by a one-time operator cleanup (FMP + Webull MCP audit, then `manage_watchlist_symbols`). This is a scope exclusion only: it does not constrain the design of the filter, which treats every submitted symbol uniformly.
- Adding OTC market data (the Alpaca `otc` feed) or trading OTC symbols.
- A per-symbol time-based negative cache; absence from the cached asset set is the only signal for delisted or unknown tickers (a mistyped ticker is refused too).
- Filtering read paths or stored entries, and warming broker/IBKR holdings through the opportunity paths.
- An on/off kill-switch key: the filter always applies.

## Affected Services

- `xstockstrat-marketdata` — owns Alpaca asset metadata: new in-memory asset set, refresher and `GetSymbolServability` RPC; gates the warm-add and live-fetch sites in `GetBars`, `BatchGetBars` and `BatchGetLatestPrice`.
- `xstockstrat-portfolio` — filters `AddWatchlistSymbols`, `CreateWatchlist` and replace-all `UpdateWatchlist` by asking marketdata; returns `refused_symbols`.
- `xstockstrat-agent` — `manage_watchlist_symbols`, `manage_watchlist` and `ingest_signal` surface the refusals.
- `xstockstrat-ui` — watchlist add forms and the screener save-as / Add-top-N show the refusals; rename uses the masked update.
- `xstockstrat-config` — write-edge bounds for the two new keys and a `[1,1000]` ceiling on the existing `portfolio.watchlist.max_symbols_per_list` (registry only; no migration, no new seed).

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` (watchlist detail add, screener save-as and Add top N, watchlist rename): per-symbol refusal notice; no `/trader` add control exists; no new page or route (C-10 not triggered).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_watchlist_symbols`, `manage_watchlist` (return `refused`) and `ingest_signal` (`watchlist_refused`); update `docs/runbooks/mcp-tools.md`.
- [ ] **None**

## Proto Contract Changes

- [x] Proto changes required (all additive; `buf lint` + `buf breaking`):
  - `common.v1`: `enum UnservableReason { UNSERVABLE_REASON_UNSPECIFIED = 0; UNSERVABLE_REASON_OTC = 1; UNSERVABLE_REASON_NOT_TRADABLE = 2; }`.
  - `marketdata.v1`: `rpc GetSymbolServability` (after `GetEtfFlags`) returning per-symbol servability with reason plus `asset_set_loaded`; request bounded to 1000 symbols.
  - `portfolio.v1`: `repeated RefusedSymbol refused_symbols = 2` on `CreateWatchlistResponse`, `UpdateWatchlistResponse` and `AddWatchlistSymbolsResponse`.
  - `common.v1.Asset` is unchanged.

## Config Key Changes

- [x] New config keys (unseeded under the feature-227 waiver; SetConfig-bounded; clamped on read):
  - `marketdata.assets.refresh_interval_hours` — int, default 6, bounds [1,24]; `<= 0` pauses refreshes and keeps the current set.
  - `portfolio.marketdata.servability_timeout_ms` — int, default 2000, bounds [500,4000].
- Existing key `portfolio.watchlist.max_symbols_per_list` gains a SetConfig bound `[1,1000]` (default 500 unchanged; staging holds 500) so a within-cap watchlist request can never exceed marketdata's 1000-symbol `GetSymbolServability` bound and silently fail open.
- No kill-switch key: the filter always applies (decided 2026-11-01).
- Operator-approved fixed invariants (F-07 precedent, recorded in `design.md`): shrink guard (reject a refresh under 50% of the last good set); backoff 1m initial, 30m cap; RPC size bound 1000; immediate first load; `us_equity` class only; exchange literal `OTC`; interval ceiling 24h stays below the 48h `minIngestLookback`.

## Database Changes

- [x] No schema changes — the asset set is held in memory and reloaded at boot.

## Trading Domain

Read-only use of Alpaca asset metadata; no order routing, account, credential or `BrokerType` change, so IBKR and the trading mode are unaffected.

## Feature Workflow Notes

Branch to create: `feature/filter-otc-symbols` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval per service (marketdata, portfolio, agent, ui) — non-breaking proto change
- [x] Owner + config team approval for the two new config keys and the `max_symbols_per_list` bound
- [ ] 2 service owners + platform lead (breaking proto change) — not needed, all proto changes are additive
- [ ] DBA review + service owner (schema migration) — not needed, no table

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Verify the premise.** Resolved 2026-11-01 against FMP + Webull (third-party). CRTD: FMP "Other OTC", Webull OTCB. BOSSY: FMP "Other OTC", Webull PINL. FORL: FMP "Other OTC", Webull EXPM (expert market, liquidate-only). DNB is not OTC: the ticker now resolves to Dun & Bradstreet (NYSE, Webull non-tradable), a delisted/reused ticker.
- [x] **Rejection behaviour.** Decided: accept the rest of the request; refuse only unservable symbols and report each with a reason.
- [x] **Existing data.** Decided and clarified by the operator: no migration or cleanup code for existing unservable entries (staging cleaned once by hand); this must not shape the design (no special-casing of stored entries).
- [x] **Feed awareness.** Decided: always filter, regardless of `marketdata.alpaca.feed`.
- [x] **Where to enforce.** Decided: in marketdata at the warm-add sites of `GetBars`, `BatchGetBars` and `BatchGetLatestPrice` (operator, rounds 1–2); no analysis live-loop change.
- [x] **Scope widened.** Decided: the block covers delisted and non-tradable symbols as well as OTC.
- [x] **Delisted/non-tradable signal.** Resolved from code: `alpaca.Client.ListAssets` already requests `status=active` (`internal/alpaca/client.go:521`) and skips `!Tradable` (`:548`). Unservable = absent from that set or `exchange == "OTC"`. Residual: Alpaca's live `exchange`/`tradable` values for CRTD, BOSSY, FORL, CERO and DNB are unverified, so acceptance scenarios do not depend on which reason fires.
- [x] **Known trap (ledger, `docs/roadmap/ledger/fails.md:656`).** One predicate, owned by marketdata; portfolio, agent and UI never re-derive it from `exchange`.
