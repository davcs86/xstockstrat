# Context: filter-otc-symbols

**Feature**: `docs/roadmap/features/282-filter-otc-symbols/feature.md`
**Product Spec**: `docs/roadmap/features/282-filter-otc-symbols/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/282-filter-otc-symbols/implementation-spec.md`

---

## Session 2026-10-31T06:56:55Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: staging Loki logs (`live_loop: N/50 evaluated (strategy,symbol) pairs had no 1d bars`, sample CRTD/DNB/FORL/BOSSY) found while reviewing PR #1384; the requester attributes the gaps to OTC listings. Premise unverified; first Open Question in product-spec.md.
- Grounding: `common.v1.Asset.exchange` exists and marketdata `ListAssets` fills it from Alpaca; `marketdata.alpaca.feed` defaults to `iex`; `GetBars` calls `markWarm` and live-fetches on a DB miss (`marketdata_service.go`).

## Session 2026-10-31T06:59:10Z — renumber

- Renumbered 280 → 282: 280 was claimed concurrently by `280-third-party-sso-oidc` and `280-smoke-check-runtime`, and 281 by `281-signal-watchlist-expiry-pruning` (docs/runbooks/feature-workflow.md § Feature Numbering). Branch name uses the slug and is unchanged.

## Session 2026-11-01 — sdd-story refinement

- Premise check (FMP search + Webull instruments): CRTD, BOSSY, FORL are OTC/pink/expert-market; DNB is a delisted/reused NYSE ticker, not OTC (out of scope; candidate negative-cache follow-up). Alpaca `ListAssets` exchange not yet verified.
- Operator decisions: refuse only OTC symbols with warnings, accept the rest; leave existing OTC data, optional UI mark/new field; always filter (feed-agnostic); enforce in analysis live loop. Open for design: reconcile live-loop enforcement with FR-3; mark vs. new proto field.

## Session 2026-11-01 — design decisions (2)

- Enforcement stays in marketdata (FR-3); no live-loop change. No UI mark / new field; one-time staging cleanup via FMP + Webull MCP audit instead (operator action, results logged here). Block widened to delisted/non-tradable (AC-7 added). Open: Alpaca fields defining delisted/non-tradable.

## Session 2026-11-01 — staging watchlist cleanup (operator action)

- Audited 307 unique staging watchlist symbols (FMP + Webull MCPs, read-only). Removed 13 from the system-managed "Signals" watchlist via `manage_watchlist_symbols remove`, on the operator's explicit approval: OTC/delisted CRTD, BOSSY, FORL, CERO, DNB; Webull non-tradable/liquidate-only but FMP-listed GCTK, ELAB, YYAI, LPSN, NATH, SLP, WEAV, RIV. FORL and CERO bindings (`dip_buyer_vol_stop`) went with them.
- Kept: 14 reused tickers with a live major-exchange row (ATCH, BETR, BNY, BTLN, COGT, FIGR, IBTA, SHPH, SNOW, STI, TRIN, VG, WLTH, WOOF); AXIA, EVTV, LRHC, PSKY (no Webull row, FMP major exchange).
- Caveat: the 8 non-tradable-only removals are unverified against Alpaca `status`/`tradable`; the signal pipeline may re-add any of the 13 until this feature ships.

## Session 2026-11-01 — sdd-review product-spec

- spec-reviewer: PASS WITH WARNINGS, no blockers, no Floor breach; feature-overlap: WARN only (marketdata.proto and xstockstrat-marketdata shared with 215/255; 275 error semantics).
- Spec fixes applied: stale "out-of-scope" wording, ingest removed from Affected Services (agent calls EnsureSignalWatchlist), kill-switch candidate dropped (conflicts with "always filter"), FR-5 clarified, Trading Domain note, AC-8 (all write paths) and AC-9 (GetBars fail-open) added.
- Open for operator: criterion 9 (Alpaca `status`/`tradable` fields) is unchecked and was deferred to /sdd-design recon only by instruction in the review prompt; status NOT advanced pending operator OK.
- Carry into design: enumerate /trader add controls; AC-7 is compound; non-tradable-only vs inactive-only; refusal reason as enum (C-04); add merge-order row if impl-spec edits marketdata_service.go after 215/255.

## Session 2026-11-01 — open question resolved

- Delisted/non-tradable signal: derived from existing code, not new proto fields — `ListAssets` already filters `status=active` and `tradable=true`; unservable = absent from that set or `exchange=="OTC"`. Side effect: unknown/mistyped tickers are also refused; empty/failed set load must fail open. Live-credential value check for the 5 known symbols deferred to /sdd-design recon.

## Session 2026-11-01 — design steer (operator)

- Operator clarified: "leave existing data" only removes the need for a migration/cleanup in code; it must not shape the feature. Round-1 proposal's "classify only newly-added symbols / protect stored unservable entries" (loadOwned capture, `stored` param) is therefore NOT a requirement. Open for the gate: a uniform filter on every submitted symbol means a name-only agent update (read-modify-write, replace-all) would refuse and drop any already-stored unservable symbol, reporting it — a narrowing of `@AC-5 @feature-148` that needs explicit sign-off if the design takes it.

## Session 2026-11-01 — sdd-design round 1 gate (operator answers)

- C-16 sign-off (explicit, operator): CHANGE `@AC-5 @feature-148` (name-only agent/replace-all update now refuses and drops already-stored unservable symbols, refusal reported) and CHANGE `@AC-1 @feature-127` platform rule (a watchlist-direction signal for an unservable symbol is not added). Both promoted at launch with a servable-symbol qualifier.
- Gate scope (operator): warm/live-fetch gate sits at the `GetBars` warm site only; quote, price and `BatchGetBars` paths keep warming so held positions stay priced.
- Round 1 adversary: no Floor breach; adopted: us_equity-only asset load, uppercase/trim in classify, classify inside `warmMu`, last-good-set retained on failed refresh (only never-loaded fails open), capped backoff, config governance (seed/waiver, config-team approval), `watchlist_refused` on ingest_signal, bindings not deprecated `Symbols`, pre-RPC size bound.
- Operator chose another round (round 2) before approval.

## Session 2026-11-01 — sdd-design round 2 gate (operator answers)

- Gate scope REVISED (operator): warm/live-fetch gate now covers `GetBars`, `BatchGetBars` AND `BatchGetLatestPrice` (opportunity-universe paths, so refused-but-stored signal symbols like FORL stop being warmed/re-fetched). `GetLatestQuote(s)`/`GetLatestPrice` stay ungated. This supersedes the round-1 "GetBars only" answer. Known cost to reconcile in round 3: `BatchGetBars` also feeds held-position offline valuation (feature 240 `@AC-53/@AC-54`, feature 231 marks).
- UI rename (operator): `commitRename` switches to the masked path (`updateMask: ['name']`) so a rename never drops symbols.
- Adopted from round-2 adversary: refresh default 6h bounds [1,24]; shrink guard (reject a refresh <50% of last good set; fixed invariant); ACs agnostic about OTC vs NOT_TRADABLE reason (verify with live data); exhaustive `Record<UnservableReason,...>` UI map; "refused" = not newly added; RPC size bound; boot-window / NULL-credential fail-open recorded as residuals; fix stale FR-4/FR-5 text.
- Operator chose another round (round 3) before approval.

## Session 2026-11-01 — sdd-design round 3 gate (operator answers)

- Round-3 design: warm-add gate (`markWarmIfServable`) at `GetBars`/`BatchGetBars`/`BatchGetLatestPrice` only; readers never filtered; `GetLatestQuote(s)`/`GetLatestPrice` ungated. Held-position carve-out verified by adversary for offline holdings: trading publishes offline positions with `current_price: 0` (`trading.go:1074`) so portfolio always quotes them via `GetLatestQuotes`, which re-warms them.
- `@AC-53 f240` strict row (operator): classify as EXTEND with a NEW scenario (strict `BatchGetBars` whose only cold symbols are unservable succeeds, makes no live fetch, omits them) — NOT a CHANGE. Adversary view recorded: it understates a narrowing of "strict fails INTERNAL on live-fetch error"; carry as an Open Risk in design.md.
- Warm set pruning (operator): prune unservable symbols from the warm set on EVERY successful asset-set refresh (held offline symbols re-warm on the next read via the ungated quote path).
- Adopted without question: drop the `@AC-3 f178` qualifier (ungated path); FR-3/AC-4/AC-7 reworded to "not added by the gated sites"; invariant "gate at warm-add sites only, readers never filtered" in marketdata AND portfolio constitutions; held-position AC split into a marketdata and a portfolio scenario; single-snapshot `servable()` helper; update `TestGetBarsMarksSymbolWarm` source scan. Residuals: Monday 48h-window miss for never-stored symbols; broker/IBKR holdings not warmed by opportunity paths; today-closed fills lack prev close; new listings refused up to refresh interval (6h).
- Operator chose another round (round 4); round 5 is the cap.

## Session 2026-11-01 — sdd-design round 4 gate (operator answers)

- Warm prune REVISED (operator): prune unservable symbols from the warm set on the FIRST successful asset-set load only (heals the boot-window warms); NO prune on later refreshes. Supersedes the round-3 "prune on every successful refresh". Rationale: avoids the permanent bar-hole / `MARK_SOURCE_NONE` exposure for held unservable symbols the round-4 adversary found. Accepted residual: a symbol that becomes unservable after it was warmed stays warm until restart.
- Fixed invariants approved by the operator (F-07 precedent): shrink guard (reject a refresh <50% of the last good set); backoff 1m initial / 30m cap; `GetSymbolServability` size bound 1000 symbols; immediate first load; `us_equity` class only; exchange literal `OTC`; refresh interval default 6h, clamped to [1,24] on read (24h ceiling stays < the 48h `minIngestLookback`); `portfolio.marketdata.servability_timeout_ms` default 2000 bounds [500,4000]; gate at warm-add sites only with readers never filtered.
- Merge order (operator): add a soft row so 282 merges after 215.
- Round-4 adversary additions to carry into design.md: `BatchGetLatestPrice` flight keyed on the FULL request set (filter only the trade fetch) and AC-13 states what an unservable symbol with a stored previous close returns; prune-race closure statement + two accepted residuals (one in-flight live fetch on an old snapshot; one poller/ingester cycle on a pre-prune copy); `@AC-53`/`@AC-54` f240 tests pin the asset set (ZZZZ servable in a loaded set) so `@AC-54` is not vacuous; refresh interval clamped on read, `<=0` per MARKETDATA-5, re-read each tick; never-loaded WARN once per state transition; first-load truncation not protected by the shrink guard (R3).
- Operator chose round 5 (the cap) before approval.

## Session 2026-11-01 — sdd-design (completion)

- Phase 0 Recon: wrote recon.md (services: marketdata, portfolio, agent, ui; reuse: `etfFlagState` cache shape, classification poller, `latestQuotesFor` fail-open, `GetEtfFlags` RPC shape).
- Phase 1 Grilling: 5 rounds (quick mode extended to the cap by the operator). Chosen approach: marketdata-owned in-memory asset-set predicate + `GetSymbolServability` RPC; gate at warm-add sites of `GetBars`/`BatchGetBars`/`BatchGetLatestPrice` only (readers and quote paths ungated); first-load-only prune; portfolio uniform filter after `requestBindings` with post-filter cap, fail-open; agent/UI surface `refused`. Rejected: `ListAssets` filter, DB table, new-vs-stored special-casing, prune-every-refresh, reader-side filtering, origin tagging, kill-switch.
- Round-5 final change: per-list cap on the post-filter union (the round-5 proposal kept it pre-filter, which contradicted FR-2 "accept the rest").
- Constitution rules touched: C-03/04/05/08/09/10/12/13/14/15/16/17/18, F-04/06/07, P-03/04/05. Floor breaches: none.
- C-16: CHANGE `@AC-5 f148` and platform `@AC-1 f127` (signed off round 1); EXTEND `@AC-53/54 f240` (operator, R4 dissent recorded).
- Artifacts rewritten for the final design: product-spec.md, acceptance.feature (AC-1..AC-9 reworded in place; AC-10..AC-26 appended), merge-order.md soft row after 215. design.md Open Risks R1..R11 mirror below.
- Open Threads (target step): R1 held-symbol gaps -> marketdata gate step + AC-17/AC-26 tests; R4 f240 pin -> marketdata test step + promotion; R9 verify Alpaca values with live credentials -> marketdata asset-set step; R10 rebase vs 215/255 -> before merge; R11 coupling -> contract tests AC-16/AC-17.
- Status: spec-ready -> design-approved.

## Session 2026-11-01 — sdd-spec

- Generated implementation-spec.md with 15 steps (proto, proto-gen, config x2, marketdata x4, portfolio x2, agent x2, ui x2, docs). Status → implementation-ready. Every AC-1..AC-26 is covered by a step's `**Covers**` (table in the spec).
- Key codebase findings:
  - Anchors re-verified at HEAD: `markWarm` sites `marketdata_service.go:262,545,575,688,749,868`; `GetBars` live fetch `:312-332`; `BatchGetBars` cold path `:763-772`; `BatchGetLatestPrice` flight key `:871-874`, prev-close `:893`, trades `:908-945`; portfolio call sites `CreateWatchlist :1905`, `UpdateWatchlist :2010`, `AddWatchlistSymbols :2166`, `requestBindings :1830`, marketdata dial with propagation interceptor `:138`.
  - `xstockstrat-config` is an additional affected service: both new keys need `SCALAR_BOUNDS_REGISTRY` entries (`configServiceImpl.ts:103`) plus `TIMEOUT_KEY_FORMS` rows (`setConfigScalarBounds.test.ts`); the product spec's "SetConfig-bounded" implies it. The registry min of 1 rejects 0 at write time, so "`<= 0` pauses" is a reader-only defence.
  - `newSvc` in portfolio tests leaves `marketdata` nil and `stubMarketData` panics on unstubbed methods: the servability helper treats a nil client as unavailable and the stub gains a `GetSymbolServability` override.
  - `GetBars` needs a live DB pool, so its gate is covered by the existing structural source-scan style (`TestGetBarsMarksSymbolWarm` is updated) plus unit tests of `markWarmIfServable`.
  - `resolvePositiveInt` maps `<= 0` to the default, so the new refresh-interval reader reads `budgetCfg.GetInt` directly to keep the MARKETDATA-5 pause rule.
- Open decisions for `/sdd-review impl-spec` (not guessed): (a) `refused` always present on agent create/add/replace-update, `watchlist_refused` only when non-empty on `ingest_signal`; (b) no client-side 1000 constant in portfolio (RPC InvalidArgument fails open) despite design.md's "size check before the RPC"; (c) config bound [1,24] vs "<= 0 pauses".
