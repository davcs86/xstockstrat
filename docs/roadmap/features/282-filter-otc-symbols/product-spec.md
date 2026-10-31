# Product Spec: filter-otc-symbols

**Created**: 2026-10-31

---

## Problem Statement

On staging the analysis live loop logs `had no 1d bars` every rotation (~14 min) for the same few symbols (CRTD, DNB, FORL, BOSSY). Marketdata retries a live Alpaca fetch for each of them on every `GetBars` miss (no negative cache), and `GetBars` marks them warm, so the always-on bar ingester re-fetches them every 5 minutes as well. The requester's diagnosis is that these are over-the-counter (OTC) stocks, which the Alpaca `iex` feed (`marketdata.alpaca.feed`, default `iex`) does not serve. **That diagnosis is not yet verified** against Alpaca asset metadata (see Open Questions). Operators and traders who add such symbols get permanent no-data entries and recurring wasted work and log noise instead of a clear refusal.

## User Story

As a trader or operator, I want OTC symbols kept out of watchlists and the bar-ingestion warm set, so that symbols the platform cannot serve stop generating failing `GetBars` calls, repeated Alpaca fetches and no-bars warnings.

## Functional Requirements

FR-1. Marketdata can tell whether a symbol is OTC from Alpaca asset metadata (`Asset.exchange`, already returned by `ListAssets`), and exposes that to other services, since marketdata is the only service allowed to call Alpaca.
FR-2. Watchlist addition refuses OTC symbols on every add path (`AddWatchlistSymbols`, the symbol lists of `CreateWatchlist` / `UpdateWatchlist`, and bindings) and reports each refused symbol with a reason; other symbols in the same request are unaffected.
FR-3. An OTC symbol does not enter the bar-ingestion warm set, and `GetBars` for it makes no live Alpaca fetch, so the bar ingester stops re-fetching it.
FR-4. Signal-driven watchlist additions (`EnsureSignalWatchlist`) skip OTC symbols the same way.
FR-5. When asset metadata is unavailable (the lookup fails), behaviour is unchanged for that call (nothing is blocked) and a WARN is logged, so a marketdata or Alpaca outage cannot block legitimate additions.

## Out of Scope

- Deleting or migrating OTC symbols already on watchlists or in the warm set (see Open Questions).
- Adding OTC market data (the Alpaca `otc` feed) or trading OTC symbols.
- A general "unservable symbol" negative cache for delisted or unknown tickers (candidate follow-up if some of the four symbols turn out not to be OTC).

## Affected Services

- `xstockstrat-marketdata` — owns Alpaca asset metadata; the warm set (`markWarm`), `GetBars` live-fetch fallback and bar ingester.
- `xstockstrat-portfolio` — watchlist add paths (`AddWatchlistSymbols`, `CreateWatchlist`, `UpdateWatchlist`, `UpdateWatchlistBinding`, `EnsureSignalWatchlist`).
- `xstockstrat-ingest` — signal ingestion that drives `EnsureSignalWatchlist` (confirm in design recon).
- `xstockstrat-agent` — `manage_watchlist_symbols` / `manage_watchlist` must surface the refusal.
- `xstockstrat-ui` — watchlist add forms must surface the refusal.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights` (watchlists) and any `/trader` watchlist-add control: show per-symbol refusal reasons; no new page or route (C-10 not triggered).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_watchlist_symbols` and `manage_watchlist`: return the refused symbols and reasons (response mapping change); update `docs/runbooks/mcp-tools.md`.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- Likely, decided at design: a way to ask marketdata whether symbols are OTC (new RPC, or a filter or flag on `ListAssets`), and refusal reasons on the portfolio watchlist responses. `Asset.exchange` already exists.

## Config Key Changes

- [ ] No new config keys
- Candidate, decided at design: a kill-switch (e.g. `marketdata.assets.exclude_otc`) so the filter can be turned off, for instance when `marketdata.alpaca.feed` is `otc`.

## Database Changes

- [ ] No schema changes
- Undecided: classification may need a cache (in memory or table) so watchlist adds do not call Alpaca each time.

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

- [ ] **Verify the premise.** Confirm the `exchange` Alpaca returns for CRTD, DNB, FORL and BOSSY (`ListAssets`) and whether each is actually OTC. DNB (acquired) or others may instead be delisted or unknown, which this feature would not cover (see Out of Scope).
- [ ] **Rejection behaviour.** Refuse the whole request, refuse only the OTC symbols (proposed in FR-2), or accept with a warning?
- [ ] **Existing data.** What happens to OTC symbols already on watchlists, bindings, live-strategy universes and the warm set: leave them, exclude them from universe resolution, or clean up?
- [ ] **Feed awareness.** Apply the filter only when `marketdata.alpaca.feed` cannot serve OTC (`iex`, `sip`), or always?
- [ ] **Where to enforce bar ingestion.** At `markWarm` / `GetBars` in marketdata, in the analysis live-loop universe, or both?
- [ ] **Known trap (ledger, `docs/roadmap/ledger/fails.md:656`).** A firing predicate was replicated into a new call site instead of extracted. Keep one OTC predicate, owned by marketdata, and have portfolio and ingest ask it rather than re-deriving it from `exchange`.
