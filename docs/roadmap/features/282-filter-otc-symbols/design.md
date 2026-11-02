# Design: filter-otc-symbols

**Created**: 2026-11-01
**Rounds**: 5 (quick mode extended by the operator to the cap; termination: approved)
**Approved by**: user @ 2026-11-01 (design gate, round 5)
**Grounded in**: recon.md

---

## Chosen Approach

**One predicate, owned by marketdata, enforced only where symbols enter.** A symbol is *unservable* when it is absent from marketdata's in-memory active+tradable Alpaca `us_equity` asset set, or present with `exchange` equal to `OTC` (case-insensitive). Portfolio, agent and UI never re-derive it from `Asset.exchange` (ledger `fails.md:656`).

**Marketdata asset set.** New `internal/service/asset_servability.go`: an `atomic.Pointer` to an immutable map of normalized symbol to is-OTC, filled by one refresher goroutine modelled on the classification poller (`classification_service.go:224-247`) and the `etfFlagState` cache shape (`etf_flags.go:33-148`). It loads through the existing source path, `registry.Get("")` then `src.ListAssets(ctx, "us_equity")` (`marketdata_service.go:1353-1363`; the client already sends `status=active` and skips `!Tradable`, `alpaca/client.go:521,548`), so `DataSourceClient` gains no method and the six test fakes (`recon.md:52`) are untouched. `us_equity` only: marketdata serves only `/v2/stocks` data, so crypto is unservable. `classify` uppercases and trims. A nil snapshot means "servable" (fail open). Only the refresher writes, so no single-flight is needed.

**Refresher semantics (all operator-approved fixed invariants unless noted):** immediate first load at boot; refresh every `marketdata.assets.refresh_interval_hours` (config key, default 6, SetConfig bounds [1,24], re-read every tick, clamped to 24 on read, `<= 0` pauses and keeps the set per MARKETDATA-5); a refresh that errors, is empty, or is under 50% of the last good set is rejected and the last good set kept; retry with capped backoff, 1m doubling to a 30m cap; one WARN on entering the never-loaded state and one INFO on first load, no per-call WARN from marketdata. The first load has no prior set to compare against, so the shrink guard does not protect it (R3).

**Proto (all additive, one owner each).** `common.v1.UnservableReason` (`UNSERVABLE_REASON_UNSPECIFIED = 0`, `_OTC = 1`, `_NOT_TRADABLE = 2`; C-04). `marketdata.v1.GetSymbolServability` placed after `GetEtfFlags` (`marketdata.proto:72`), mirroring its batch-in/per-symbol-out shape (`:396-407`): per-symbol `{symbol, servable, reason}` plus `asset_set_loaded`; more than 1000 symbols is `InvalidArgument`; an unloaded set answers with `asset_set_loaded=false` and every symbol servable. `portfolio.v1`: `RefusedSymbol {symbol = 1, UnservableReason reason = 2}` and `repeated RefusedSymbol refused_symbols = 2` on `CreateWatchlistResponse` (`portfolio.proto:283`), `UpdateWatchlistResponse` (`:319`) and `AddWatchlistSymbolsResponse` (`:334`); field 2 is free on each. `common.v1.Asset` (`common.proto:35-39`) is unchanged. `buf lint`, `buf breaking`, `./scripts/buf-gen.sh` (C-09).

**Marketdata gate — warm-add sites only.** A new helper `markWarmIfServable(syms...) *assetSet` replaces `markWarm` at exactly three sites and returns the same snapshot so the caller's live-fetch decision uses it (one snapshot per request, one predicate):
- `GetBars` (`marketdata_service.go:262`): no warm add and no live fetch (`:312-332`) for an unservable symbol; stored bars still returned; a miss returns an empty valid response as today.
- `BatchGetBars` (`:748-750`): unservable symbols are removed from `cold` before `sortedCold` and the singleflight key (`:763-772`); if nothing cold remains no flight runs and both strict and partial calls succeed without them; `partialColdFetch` receives the filtered cold list (`:809`) so its WARN does not mis-report them.
- `BatchGetLatestPrice` (`:867-869`): the singleflight key stays on the full sorted request (`:871-874`); inside the closure only the trade fetch (`:908-945`) is limited to servable symbols and the previous-close read (`:893`) still covers `req.Symbols`. An unservable symbol with a stored previous close returns `prev_close` only with `last_price` and `last_trade_time` unset (the existing omit rule, `:964-979`); without one it is omitted. Analysis checks `HasField("last_price")` and never memoizes a missing price (`servicer.py:4788,4803`), so no consumer treats presence of an entry as a live price; the accepted cost is a cheap DB-only re-request each pass.
- Not gated: `GetLatestQuote` (`:545`), `GetLatestQuotes` (`:575`), `GetLatestPrice` (`:688`), and every warm-set reader (`warmSnapshot :1099`, the `StartWarmQuotePoller` inline copy `:1132-1137`, `classificationUniverse`). Invariant, recorded in the marketdata and portfolio constitutions: **the gate applies at warm-add sites only; warm-set readers are never filtered.**

**Prune — first successful load only.** The refresher does `Store(new)`, takes `warmMu`, on the first successful load only deletes every warm symbol the new snapshot marks unservable (path-agnostic), then releases. `markWarmIfServable` loads the snapshot while holding `warmMu`, so an add either lands before the prune and is removed, or sees the new snapshot. No later refresh prunes. Accepted residuals: one in-flight live fetch bound to an old snapshot; one poller or ingester cycle on a copy taken before the prune; a symbol that becomes unservable after it was warmed stays warm until restart (R2). Held symbols re-warm only through the ungated reads.

**Portfolio.** `servabilityFor(ctx, symbols) (refused, ok)` reuses the bounded-deadline plus WARN pattern of `latestQuotesFor` (`portfolio_service.go:404-432`) with `portfolio.marketdata.servability_timeout_ms` (default 2000, [500,4000]), without copying its body (a `dry-reviewer` check, or extract the wrapper if more than the timeout lookup is shared). It is called at the three call sites after `requestBindings` (`:1830`, a free function that cannot call it) — `CreateWatchlist :1914`, replace-all `UpdateWatchlist :2064`, `AddWatchlistSymbols :2177` — and before the cap check and `insertBindingsTx` (`watchlist_repo.go:494`). The filter is uniform on every submitted symbol (operator steer: no stored-versus-new special-casing). The per-list cap is computed on the **post-filter** union (`existing.GetBindings()` symbols ∪ accepted; `:2179-2183`, and `:2065` for replace-all) so a request that fits after refusals succeeds (FR-2); the f196 `@AC-7` test pins a servable added symbol. A size check before the RPC is not needed: `portfolio.watchlist.max_symbols_per_list` (default 500) gets a SetConfig bound `[1,1000]` (impl-spec review, operator 2026-11-01), so a within-cap request never exceeds the 1000-symbol RPC bound; an oversized `AddWatchlistSymbols` that did reach the RPC fails open with a WARN and is then rejected by the cap. Any RPC error fails open with a WARN. `AddSymbols` short-circuits when every symbol was refused. Masked `UpdateWatchlist` (`:2019-2052`), `UpdateWatchlistBinding(s)` (rebind-only) and `EnsureSignalWatchlist` (takes no symbols, `:1939`) never classify. `applyDefaultStrategy` runs before the filter, so defaults land on accepted symbols only. Header trio propagation uses the existing interceptor (`internal/middleware/propagation.go:39`) over the existing mTLS edge.

**Consumer surfaces (C-14).**
- *Agent:* `client.add_watchlist_symbols` (`client.py:525-545`), create (`:400`) and update (`:431`) return `refused: [{symbol, reason}]` with the full enum NAME string (e.g. `UNSERVABLE_REASON_OTC`); `manage_watchlist`/`manage_watchlist_symbols` pass it through; `add_watchlist_symbol` (`client.py:315-330`) stops discarding the response and `ingest_signal` (`tools.py:688-696`) returns a non-fatal `watchlist_refused` (the ingest still succeeds, f127 `@AC-4`); docs in `docs/runbooks/mcp-tools.md` (`:224-255`, `:1263-1335`) and agent `CLAUDE.md` (`:82-83`, `:134`), kept consistent with the doc-parity test (`tests/test_watchlist_tools.py:312`).
- *UI:* `WatchlistDetail.tsx:101-115` and `screener/page.tsx:149-158` render a `CardNotice` (C-17) listing each refused symbol with its reason; an exhaustive `Record<UnservableReason, string>` in `src/lib/opportunityShared.tsx` (numeric protobuf-es enums in components, so a new value fails `tsc`); `commitRename` (`WatchlistDetail.tsx:126-134`) sends `updateMask: ['name']` so a rename never drops symbols; `watchlistMock.ts` gets a refusal fixture using protojson enum NAME strings (`fails.md:676`) plus an `INVENTORY.md` row (C-12).

**Config governance.** Both keys follow `<service>.<category>.<key>` (C-05), unseeded under the feature-227 waiver, SetConfig-bounded and clamped on read; documented in each service's `CLAUDE.md` and in the Per-Feature Registered Keys log of `docs/patterns/config-governance.md`; owner + config-team approval. Every other literal is an operator-approved fixed invariant (F-07 precedent: `etfFlagTTL`, `barsPartialMargin`, quote-retention cadence).

## Rejected Alternatives

- A `ListAssets` filter (`tradable_only`/exchange) instead of a new RPC — rejected: `ListAssets` is a live Alpaca passthrough, `tradable_only` is never read, and it pushes the predicate into callers (`fails.md:656`).
- A DB table for the asset set (migration 010) — rejected: a cheap reload into memory suffices; a table adds DB load against f153 and DBA review.
- Classifying only newly added symbols relative to the stored list — rejected by the operator: the "leave existing data" decision must not shape the design.
- Gating only `GetBars`, or gating all six `markWarm` sites — rejected: `GetBars`-only leaves refused signal symbols warmed through the opportunity paths; all six starves held positions' quotes and breaks f178 `@AC-3`.
- Filtering at the warm-set readers (poller, ingester, `warmSnapshot`) — rejected: violates "readers never filtered", would starve held symbols, and needs several synchronized edits.
- Pruning on every refresh — rejected after round 4: it creates permanent bar-history holes and `MARK_SOURCE_NONE` for held unservable symbols.
- Never pruning — rejected: boot-window warms would persist until restart.
- Keying the `BatchGetLatestPrice` flight on the filtered set — rejected: callers differing only in unservable members would share a leader's previous-close map.
- Tagging warm entries by origin and pruning only gated-site entries — rejected: extra state, and superseded by first-load-only pruning.
- Exempting `allow_partial` callers from the gate — rejected: ties a degradation flag to servability policy.
- A per-symbol negative cache or an on/off kill-switch key — out of scope (spec).
- Classifying the cap before filtering (kept pre-filter) — rejected: contradicts FR-2 "accept the rest".
- Chunking the RPC at 1000 in portfolio — rejected: duplicates a marketdata constant; the default list cap (500) already bounds it.

## Open Risks

- [ ] **R1 Held unservable symbols (transient).** A held unservable symbol with data that was never stored, or was just pruned at first load, is omitted by `BatchGetBars` until the ungated `GetLatestQuotes` re-warms it and one ingester cycle runs (≤ 5 min; up to the Monday 48h `minIngestLookback` window), so a bars-only mark can read `MARK_SOURCE_NONE` meanwhile. Broker/IBKR holdings that portfolio does not quote are not warmed by the opportunity paths. For genuine OTC symbols on the `iex` feed nothing is lost (no data). — address at the marketdata gate step and AC-17/AC-26 tests.
- [ ] **R2 Warm symbol that becomes unservable later stays warm until restart** (no later prune). — accepted; note in marketdata CLAUDE.md.
- [ ] **R3 First load unprotected.** A truncated but non-error first response over-refuses until the next good refresh. — accepted.
- [ ] **R4 Strict `BatchGetBars` narrowing (adversary dissent, round 3).** The operator classified `@AC-53 f240` as EXTEND; in practice a strict call whose only cold symbols are unservable now succeeds instead of reaching the live-fetch error. The durable `@AC-53`/`@AC-54` scenarios must pin the asset set (ZZZZ servable in a loaded set) so they stay meaningful and `@AC-54` is not vacuous. — address in the marketdata test step and at promotion.
- [ ] **R5 Prune-race residuals** (one in-flight fetch on an old snapshot; one poller/ingester cycle on a pre-prune copy). — accepted.
- [ ] **R6 Fail-open windows.** Boot before the first load, NULL/failing Alpaca credentials (permanently unloaded), portfolio timeout or error. A held OTC symbol may also stay unpriced on `iex`, and re-warmed held unservable symbols keep producing ingester no-bars noise. — accepted; the unloaded WARN is once per state change.
- [ ] **R7 New listings and mistyped tickers** are refused for up to the refresh interval (default 6h, max 24h); UI and agent copy must say so.
- [ ] **R8 Fills closed today** of an unservable symbol lack a previous close; AC-13 omits it.
- [ ] **R9 Alpaca live values unverified** for CRTD, BOSSY, FORL, CERO, DNB (exchange literal, presence); ACs are reason-agnostic. Verify with live credentials at implementation.
- [ ] **R10 Rebase churn** with 215 and 255 on `marketdata_service.go` and `marketdata.proto`. — merge-order row below.
- [ ] **R11 Implicit coupling.** Correct valuation of held unservable symbols relies on portfolio always calling the ungated `GetLatestQuotes` for offline positions (true because `trading.go:1074` publishes `current_price: 0`). Guard with the AC-16/AC-17 contract tests and the written invariant.

## Constitution Rules Touched

- `C-01`/`F-04` — honored by: every path and symbol above comes from recon or was re-read during the debate.
- `C-03` — honored by: the new portfolio→marketdata call uses the existing header-propagation interceptor (`propagation.go:39`).
- `C-04` — honored by: `UnservableReason` enum with `UNSPECIFIED = 0`.
- `C-05` / `F-07` — honored by: two `<service>.<category>.<key>` keys; all other literals recorded as operator-approved fixed invariants (shrink guard 50%, backoff 1m/30m, RPC bound 1000, immediate first load, `us_equity`, `OTC` literal, 24h ceiling < 48h).
- `C-08` / `C-15` — honored by: each service step has a paired test step and every `@AC-*` (AC-1..AC-26, append-only) maps to a step.
- `C-09` — honored by: the proto step runs `buf lint`, `buf breaking`, `buf-gen`.
- `C-10` — honored by: all three insert paths share one `servabilityFor` call; all three gated sites share one `markWarmIfServable`; both UI add controls and all three responses carry the same notice/field.
- `C-12` / `C-13` — honored by: UI mocks from `e2e/fixtures` plus an INVENTORY row; Go fixtures centralize only once a second consumer appears.
- `C-14` — honored by: separate agent and UI steps.
- `C-16` — see below.
- `C-17` — honored by: `CardNotice`, design tokens, accessible names.
- `C-18` — honored by: one predicate, one helper, one snapshot per request; no singleflight, origin tags or table (YAGNI). Recorded trade-offs: duplicated trade-list filtering inside the `BatchGetLatestPrice` closure (correctness over a simpler key); no prune after first load (simplicity over completeness, R2).
- `F-04` — honored by: unfound items stay in R9; nothing invented.
- `F-06` — honored by: no DB use.
- `P-03` — honored by: every ambiguity above is an operator decision or a listed risk.
- `P-04`/`P-05` — honored by: each round's gate answers were recorded in `context.md` as they happened.

## Business Rules Touched (C-16)

- CHANGE `@AC-5 @feature-148` "manage_watchlist update of only the name does not wipe existing symbols" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — a name-only replace-all update now drops and reports stored unservable symbols; signed off by user @ 2026-11-01 (context.md, round 1 gate). Promoted with a servable-symbol qualifier.
- CHANGE `@AC-1 @feature-127` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — holds for servable symbols only; signed off by user @ 2026-11-01 (context.md, round 1 gate).
- EXTEND `@AC-53 @feature-240` and `@AC-54 @feature-240` (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`) — new scenarios AC-12/AC-14; operator chose EXTEND (context.md, round 3 gate; adversary dissent recorded as R4); the durable scenarios pin ZZZZ as servable in a loaded set.
- EXTEND `@AC-4`, `@AC-7 @feature-148` (agent `mcp-watchlist-tools.feature`) — create/add also return `refused`.
- EXTEND `@AC-7`, `@AC-10 @feature-170` (portfolio `watchlist-bulk-default-strategy.feature`) — the default applies to accepted symbols only.
- EXTEND `@AC-5 @feature-127` (agent `consolidate-watchlist-signal.feature`) — docstring and `mcp-tools.md` state unservable symbols are skipped.
- PRESERVE `@AC-8`, `@AC-9`, `@AC-2`, `@AC-4 @feature-170` (portfolio) — explicit binding wins; default-only update never re-filters stored symbols; bulk rebind is never refused; all-or-nothing NOT_FOUND — not regressed by: masked/rebind RPCs never classify.
- PRESERVE `@AC-1`, `@AC-3 @feature-167` — rebind-only RPCs never insert or classify.
- PRESERVE `@AC-6 @feature-127`, `@AC-1 @feature-154` — `EnsureSignalWatchlist` idempotent; `ListAllWatchlistSymbols` unfiltered.
- PRESERVE `@AC-2`, `@AC-7 @feature-196` — `Watchlist.symbols` mirror; cap is `InvalidArgument` at the limit (test pins a servable added symbol).
- PRESERVE `@AC-2`, `@AC-3 @feature-178`, `@AC-3 @feature-191`, `@AC-1 @feature-153` — no per-symbol classification on reads; `GetLatestQuotes` ungated; omit-not-fabricate; in-memory lookup only.
- PRESERVE `@AC-4 @feature-127`, `@AC-8 @feature-148`, `@AC-9 @feature-148`, `@AC-11`/`@AC-12 @feature-170` (agent) — ingest never fails on a refusal; remove still drops unservable entries; unknown verb rejected before any RPC; masked default-strategy and assign paths never classify.
- PRESERVE UI `@AC-1`, `@AC-6 @feature-170`, `@AC-6 @feature-167`, `@AC-2 @feature-181`, `@AC-8 @feature-127` — remove, default-strategy, single-row patch and readiness degrade keep working on stored unservable rows.
- PRESERVE platform `@AC-5 @feature-210` and `@AC-5 @feature-181` — header trio over mTLS; no dependency cycle.
