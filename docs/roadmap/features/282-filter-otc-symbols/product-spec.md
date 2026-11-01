# Product Spec: filter-otc-symbols

**Created**: 2026-10-31

---

## Problem Statement

On staging the analysis live loop logs `had no 1d bars` every rotation (~14 min) for the same few symbols (CRTD, DNB, FORL, BOSSY). Marketdata retries a live Alpaca fetch for each of them on every `GetBars` miss (no negative cache), and `GetBars` marks them warm, so the always-on bar ingester re-fetches them every 5 minutes as well. The requester's diagnosis is that these are over-the-counter (OTC) stocks, which the Alpaca `iex` feed (`marketdata.alpaca.feed`, default `iex`) does not serve. **That diagnosis is not yet verified** against Alpaca asset metadata (see Open Questions). Operators and traders who add such symbols get permanent no-data entries and recurring wasted work and log noise instead of a clear refusal.

## User Story

As a trader or operator, I want OTC, delisted and non-tradable symbols kept out of watchlists and the bar-ingestion warm set, so that symbols the platform cannot serve stop generating failing `GetBars` calls, repeated Alpaca fetches and no-bars warnings.

## Functional Requirements

FR-1. Marketdata classifies a symbol as unservable when it is absent from its active+tradable Alpaca asset set (delisted, inactive, non-tradable) or present with `Asset.exchange` `OTC`, and exposes that to other services, since marketdata is the only service allowed to call Alpaca. "Unservable" is the single marketdata-owned predicate.
FR-2. Watchlist addition refuses unservable (OTC, delisted, non-tradable) symbols on every add path (`AddWatchlistSymbols`, the symbol lists of `CreateWatchlist` / `UpdateWatchlist`, and bindings) and reports each refused symbol with a reason; other symbols in the same request are unaffected.
FR-3. An unservable symbol does not enter the bar-ingestion warm set, and `GetBars` for it makes no live Alpaca fetch, so the bar ingester stops re-fetching it.
FR-4. Signal-driven watchlist additions (`EnsureSignalWatchlist`) skip unservable symbols the same way.
FR-5. When asset metadata is unavailable (the lookup fails), behaviour is unchanged for that call on every path (watchlist adds, `GetBars`, `markWarm`) and a WARN is logged, so a marketdata or Alpaca outage cannot block legitimate additions. An empty or failed asset-set load must never classify every symbol as unservable.

## Out of Scope

- Any in-product mark, new field or automated migration for existing unservable entries. Existing staging entries are handled by a one-time operator cleanup (FMP + Webull MCP audit, then `manage_watchlist_symbols`), not by shipped code.
- Adding OTC market data (the Alpaca `otc` feed) or trading OTC symbols.
- A per-symbol time-based negative cache. Absence from the cached active+tradable asset set is the only unservable signal for delisted/unknown tickers (a mistyped ticker is refused too).

## Affected Services

- `xstockstrat-marketdata` — owns Alpaca asset metadata; the warm set (`markWarm`), `GetBars` live-fetch fallback and bar ingester.
- `xstockstrat-portfolio` — enforces the check inside `EnsureSignalWatchlist` (the agent's call builds an empty request, so portfolio derives the symbols; ingest is not a caller) and the other watchlist add paths (`AddWatchlistSymbols`, `CreateWatchlist`, `UpdateWatchlist`, `UpdateWatchlistBinding`, `EnsureSignalWatchlist`).
- `xstockstrat-agent` — `manage_watchlist_symbols` / `manage_watchlist` must surface the refusal.
- `xstockstrat-ui` — watchlist add forms must surface the refusal.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` (watchlists) and any `/trader` watchlist-add control: show per-symbol refusal reasons; no new page or route (C-10 not triggered).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_watchlist_symbols` and `manage_watchlist`: return the refused symbols and reasons (response mapping change); update `docs/runbooks/mcp-tools.md`.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- Likely, decided at design: a way to ask marketdata whether symbols are unservable (new RPC, or a filter on `ListAssets`); `Asset` itself needs no new fields (new RPC, or a filter or flag on `ListAssets`), and refusal reasons on the portfolio watchlist responses. `Asset.exchange` already exists.

## Config Key Changes

- [ ] No new config keys
- No kill-switch key: the filter always applies (decided 2026-11-01). Design must not reintroduce one; any key it does add follows `docs/patterns/config-governance.md`.

## Database Changes

- [ ] No schema changes
- Undecided: the asset set needs a refreshed in-memory (or table) cache; the full set is large and must not be fetched per watchlist add. Classification may need a cache (in memory or table) so watchlist adds do not call Alpaca each time.

## Trading Domain

Read-only use of Alpaca asset metadata; no order routing, account, credential or `BrokerType` change, so IBKR and the trading mode are unaffected.

## Feature Workflow Notes

Branch to create: `feature/filter-otc-symbols` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration) — only if the design adds a table

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Verify the premise.** Resolved 2026-11-01 against FMP + Webull (third-party; Alpaca `ListAssets` itself not yet queried — confirm in design recon). CRTD: FMP "Other OTC", Webull OTCB. BOSSY: FMP "Other OTC", Webull PINL. FORL: FMP "Other OTC", Webull EXPM (expert market, liquidate-only). DNB is **not** OTC: the ticker now resolves to Dun & Bradstreet (NYSE, Webull non-tradable) — a delisted/reused ticker, i.e. the delisted/non-tradable case, in scope since 2026-11-01. Staging `query_bars` for CRTD returns no bars.
- [x] **Rejection behaviour.** Decided: accept the rest of the request; refuse only OTC symbols and report each with a warning/reason (FR-2 as written).
- [x] **Existing data.** Decided 2026-11-01: no mark and no new field. Existing unservable entries are removed by a one-time operator cleanup using the FMP and Webull MCPs (see Out of Scope); the audit result is recorded in `context.md`.
- [x] **Feed awareness.** Decided: always filter, regardless of `marketdata.alpaca.feed`.
- [x] **Where to enforce bar ingestion.** Decided 2026-11-01: in marketdata (`markWarm` / `GetBars`, FR-3); no analysis live-loop change.
- [x] **Scope widened.** Decided 2026-11-01: the block covers delisted and non-tradable symbols as well as OTC (DNB case).
- [x] **Delisted/non-tradable signal.** Resolved 2026-11-01 from code: `alpaca.Client.ListAssets` already requests `status=active` (`internal/alpaca/client.go:521`) and skips `!Tradable` (`:548`), so the marketdata asset set is active+tradable only. Predicate: a symbol is unservable when it is absent from that set (delisted, inactive or non-tradable) **or** present with `Asset.exchange == "OTC"`. No new `Asset` fields are needed. Residual, for design recon with live credentials: confirm Alpaca's actual `exchange`/`tradable` values for CRTD, BOSSY, FORL, CERO and DNB, and that OTC rows (if returned) carry `exchange="OTC"`.
- [x] **Known trap (ledger, `docs/roadmap/ledger/fails.md:656`).** A firing predicate was replicated into a new call site instead of extracted. Keep one OTC predicate, owned by marketdata, and have portfolio and ingest ask it rather than re-deriving it from `exchange`.
