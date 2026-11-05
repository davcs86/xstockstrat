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

## Session 2026-11-01 — sdd-review impl-spec (advisory)

- Result: 1 failure, 12 warnings, 0 Floor breaches (advisory — did not block). All AC-1..AC-26 covered; all required design elements present (post-filter cap, `markWarmIfServable` at exactly 3 sites, first-load-only prune, full-request flight key, masked rename, filtered `partialColdFetch`, enum NAME fixtures, teardown). Code anchors resolve.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 12: no `--cov-fail-under=N` on the agent pytest run (C-08, the only ✗) — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 7 (F-08 risk): `asset_servability.go` hosts the `servable` helper and a comment but is not in Step 7's **Files** — [x] resolved 2026-11-01 (spec edited, see Session below) (record a Deviation Log entry or pin the helper in Step 5 before executing; do not stage outside Files)
  - Steps 5/6 (F-09 risk): backoff delay function and refresher test seam are "if needed" in Step 6 but undefined in Step 5 — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Steps 6, 8, 10: Go coverage threshold is prose only; assert `go tool cover` total >= 40% — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 14: no coverage threshold stated for vitest (low impact, scope `src/lib/**`) — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 8: AC-4/AC-9/AC-23 for `GetBars` proven by source-scan only, and the `partialColdFetch` WARN content is untested — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 9: `portfolio.watchlist.max_symbols_per_list` has no SetConfig bound; an operator raising it above 1000 makes the RPC reject and portfolio fail open, bypassing the filter on large adds (design decision b rests on the default 500) — [x] resolved 2026-11-01 (spec edited, see Session below); needs operator confirmation (P-03)
  - Step 9: no IBKR/broker symmetry note (asset set is Alpaca-only; design R1/R6) — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 2: tree is red between Steps 2 and 5 (F-05 tension); fold Step 2 into Step 5's commit or add an adapter stub — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 1: confirm the `buf breaking` input path/`subdir` (runs from `packages/proto`) — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Steps 7/9/13: name/anchor drift (`servableOf` vs `servable`; design `servabilityFor` vs spec `refuseUnservable`; `setDefaultStrategy` anchor `:139-146` is now ~`:146`) — [x] resolved 2026-11-01 (spec edited, see Session below)
  - Step 15: touches 7 files (>5 guideline) and Verification does not evidence the teardown — [x] resolved 2026-11-01 (spec edited, see Session below)
- Overlap findings (WARN only, no migration/proto-field/config-key collision): same-file overlap with 215 and 255 on `marketdata.proto` (end-of-file append), `marketdata_service.go`, `cmd/server/main.go`; with 215 and 275 on agent `tools.py` (docstring regions); 240 vs 282 on `portfolio_service.go` not checked. merge-order row for 282 (after 215) exists but wrongly calls 275 "analysis-only" — 275's spec edits agent `tools.py`; proposed amendment (needs operator OK as merge-order.md is shared): name 275 as a soft `tools.py` rebase.

## Session 2026-11-01 — impl-spec review fixes applied (operator: address all warnings, bound max_symbols_per_list, amend merge-order)

- Resolved all 13 review items by editing `implementation-spec.md` before execution (F-09 not yet in force): Step 12 coverage gate (`--cov-fail-under=40` on the full suite); Step 7 F-08 (the `servable` helper, `liveFetchAllowed` and the gate comment moved into Step 5 `asset_servability.go`; Step 7 only calls them); Steps 5/6 F-09 (defined `nextAssetRetryDelay` and `noteAssetRefreshFailure` seams in Step 5); Go coverage thresholds asserted with `awk` in Steps 6/8/10; Step 14 uses `test:coverage` (vitest thresholds lines 40); Step 8 gains a behavioural `liveFetchAllowed` test (Step 6), a `partialColdFetch` WARN assertion; Step 9 IBKR/broker scope note and `refuseUnservable` naming; Step 2 verification corrected (the marketdata tree stays green: adapter embeds `UnimplementedMarketDataServiceServer`); Step 1 `buf breaking` uses the CI invocation; Step 13 anchor `:146`; old Step 15 split into Step 15 (agent runbook, agent CLAUDE.md, config-governance) and Step 16 (marketdata/portfolio CLAUDE.md + constitutions + teardown with evidence in Verification).
- `max_symbols_per_list` (operator yes): SetConfig bound `[1,1000]` added in Step 3 (+ test rows in Step 4); staging value verified 500. product-spec gains `xstockstrat-config` as an affected service; design.md Portfolio paragraph updated.
- merge-order.md row for 282 amended (operator yes): 275 also edits agent `tools.py` (soft docstring-region rebase); 240/231 are launched so no overlap risk. Coverage table now maps AC-4 -> 6,8; AC-7 -> 6,8,10; AC-22 -> 4,6,10. Total Steps: 16.
- Unchanged dissent/risks carried: design R1-R11; teardown owed in Step 16.

## Session 2026-11-01 — merge with main-dev; feature 281 ordering

- Merged `origin/main-dev` into the branch (add/add conflicts in the five 282 files resolved to our side; main-dev held only the original story, byte-identical to `4a185fd`).
- Feature 281 (`signal-watchlist-expiry-pruning`, implementation-ready) overlaps 282 on `AddWatchlistSymbols`, the agent signal-add path and shared docs/tests (no proto field, config key or migration collision). Operator decision: 282 merges AFTER 281. Added a soft `merge-order.md` row; Step Dependencies note updated. Carry into execution: re-anchor Steps 9/11 after 281 lands; keep the servability filter ahead of 281's expiry write so a refused symbol gets no expiry row.

## Session 2026-11-02 — sdd-design amendment (quick), round 1 — operator decisions and synthesis

- **Trigger:** the up-front gate found both new keys unseeded under the 227 waiver: `marketdata.assets.refresh_interval_hours` (int 6, `[1,24]`, `<=0` pauses, reader in Step 5) and `portfolio.marketdata.servability_timeout_ms` (int 2000, `[500,4000]`, reader in Step 9). 278's shrink-only `config-wiring` ratchet (`631028eb`) fails CI on both.
- **Operator decisions (2026-11-02):**
  - Seed both via config migrations, following 281's approved pattern (no baseline entry; downs delete global rows only).
  - Re-spec items: PORTFOLIO-18 / MARKETDATA-15 (15/16 taken, 281 claims 17); reuse `testdata.Msft`/`Aapl` and re-decide C-13 for the OTC tickers; Step 14 rewrites (not extends) the fails-080 rename e2e test and comment; re-anchor drift everywhere else.
- **Round-1 synthesis** (adversary: NEEDS WORK, no Floor breach):
  - `036_marketdata_asset_refresh_interval` lands in Step 5 with the marketdata reader. `037_portfolio_servability_timeout` lands in Step 9 with the portfolio reader (literal at the call site; no key-parameter wrapper).
  - A new config test step holds the shared `globalIntSeedCases.ts` helper, the 036/037 parse tests and an **unconditional** conversion of 281's inline seed test. jscpd ignores test files, so a conditional conversion would never fire. The step requires 281 merged; it imports `migrationSql.ts` from main-dev, never copies it from 281's moving branch.
  - Explicit ordering: 282 Step 5 requires 281 Step 11 committed. The pre-merge check asserts 281's 035 is on main-dev and numbered below 036. Renumbering goes through the Deviation Log, finding files by suffix. The step-time `--declared-migration` guard also runs for 036/037.
  - The 036 description says pausing is reader-only (`SetConfig` rejects 0). Step 6's evidence notes that AC-24's "unset" case is a scope with no row.
  - `@AC-27 @FR-5` is appended. `LIT` is exported from the helper.
  - Open placement question: the new step at the end (Step 16, docs to 17) or right after Step 10. **Operator: another round.**

## Session 2026-11-02 — sdd-design amendment, round 2 — synthesis (operator: another round)

- **Proposer:**
  - The new config test step goes at the end (Step 16; docs/teardown becomes 17). That is 3 renumber edits instead of 22, and only Steps 16-17 wait on 281.
  - It keeps the shared `globalIntSeedCases.ts` helper and converts 281's seed test unconditionally.
  - It supplies exact 036/037 SQL and full Step 5/9/16 text.
  - It found a second e2e assertion (`watchlists.spec.ts:626-633`) that the masked rename breaks.
  - It fixed 281's block-2 ordering bug: the pair-presence check moves to block 3.
- **Adversary** (NEEDS WORK, no Floor breach; APPROVE-READY once these are fixed):
  1. Step 16 Verification double `cd` always fails.
  2. The §5.3 boot gate trips on Step 16's absent 281 files. Mark them "expected absent until 281 merges — do not re-spec".
  3. "Renumber via Deviation Log" breaks F-08/F-09 because the shell blocks hard-code 036/037. Renumbering goes through stop → re-spec Steps 5, 9, 16. The same latent flaw exists in 281 Step 11 Instr 9, kept as a follow-up and not touched while 281 executes.
  4. Relax Step 5's precondition to "281 spec names 035; 036/037 free on every branch". A missing 035 file is a WARN; `MODE=merge` (twice) stays binding.
  5. After merging 281, re-run the Verification of Steps 9-14 and Step 5 block 4, and assert the servability filter runs before 281's expiry write (fails.md:1198).
  6. Smaller items:
     - block 4 escalates if the base has any finding on `RD`;
     - Step 5 Instr 8 vs Instr 12 contradiction;
     - the `:606` test title;
     - `LIT` stays private;
     - align `@AC-24`/`@AC-27` FR tags;
     - merge-order row 92 becomes **Hard**;
     - cite 281's durable `@AC-19` suite path.
- **Open operator choice:** start 282's execution after 281 merges (adversary's alternative), or now in parallel. **Operator: another round.**

## Session 2026-11-02 — sdd-design amendment (COMPLETION)

- **Approved after 3 rounds** (round-3 adversary: no Floor breach; L APPROVE-READY once its fixes were folded; operator approved all round-3 fixes).
- **Operator: Variant L.** 282's sequential run starts only after 281's integration PR is on `main-dev`. Step 9 implements the `EREA` order in `AddWatchlistSymbols` (281's `expiryIntentFor` on the unfiltered request → `refuseUnservable` → early return when all refused → `expiryIntentFor` on accepted bindings → cap on the post-filter union → `AddSymbols(…, intent)`) with an `awk` SEQ check; Step 10 adds `TestAddWatchlistSymbols_RefusedSymbolGetsNoExpiry`. Step 16 is config-only (helper, 038/039 parse tests, 281 037 test conversion); P-only text (step/merge modes, 0b/0c, boot-gate "no re-spec") dropped.
- **Operator: renumber 036→038, 037→039.** Feature 280 (PR #1359) holds config `035_smoke_rpc_user_id` / `036_smoke_writes_enabled`; feature 281's seed is now `037_portfolio_signal_prune_interval`. Step 5 block 2 asserts all three are on `origin/main-dev` and on this branch (STOP otherwise) and that 038/039 are free on every branch.
- **Round-3 fixes folded:**
  - Step 5/9 block 4: a finding on the reader file `RD` is a hit only if new versus the merge-base (multiset on `kind, namespace, key, file`); STOP only for a base `dynamic-read` on `RD`. 281's "any finding on `RD`" rule would always fire in Step 9 (three baselined `read-unseeded` keys attribute to `portfolio_service.go`).
  - Step 9 Verification: service-dir commands wrapped in a `( … )` subshell; blocks 2-4 run from the repo root.
  - design.md Business Rules / Amendment name Step 9 (order + SEQ check) and Step 10 (guard test).
  - Renumber path uses the documented directive `(re-spec Steps 5-16 first)` (`sequential-mode.md:18` parses one range or one step).
  - Steps 9/10/16 Codebase Evidence: drift in 281's landed symbols is called out in the §5.4 summary; a re-spec never changes the `EREA` order.
  - SEQ `awk` strips `//` comments before matching.
  - `merge-order.md` row 92 (282 → 281): Hard, "Merge order only — 281 need not be `launched`", plus the Variant L sentence. This is a design-phase edit staged with this amendment's design commit (P-01), not by an execute step (F-08).
- **Ledger:** one `fails.md` entry — config-wiring baseline entries are file-less, so a reader-file hit identity must be checked against raw `--final --json` base findings, not `scripts/config-wiring.json`.
- **Next:** advisory `/sdd-review filter-otc-symbols impl-spec`, then launch `/sdd-execute filter-otc-symbols(re-spec if needed) sequential` after 280's and 281's integration PRs merge.

## Session 2026-11-02 — sdd-review impl-spec (advisory, post-amendment)

- Verdict: PASS WITH WARNINGS (no blockers). All eight warnings addressed by surgical `implementation-spec.md` edits; no step added or renumbered.
  - W1 (Step 9 Instr. 3 step 3, Step 10 Instr. 5): the all-refused early return fires only on `len(refused) > 0 && len(add) == 0`; an originally empty add keeps 281's behaviour (`AddSymbols` once + `portfolio.watchlist.updated`). New Step 10 case (d) asserts `store.addSymbolsCnt == 1`, `servabilityCalls == 0` (green pre-Step 9 by design, like (c)).
  - W2 (config-key wiring (b)): non-default seeded-key reader cases added. Step 6 `TestResolveAssetRefreshInterval_ReadsSeededKey` (`fakeIntGetter{"marketdata.assets.refresh_interval_hours": 12}` → 12h) and Step 10 `TestServabilityTimeout_ReadsSeededKey` (`fakeConfig` `"portfolio.marketdata.servability_timeout_ms": 3000` → 3000ms), each with a `grep -c … -eq 1` guard. AC-24's unset case kept, and Step 6's "no seeded-value case" note replaced.
  - W3 (Step 2): marketdata `go build` wrapped in a subshell; executable freshness line `git add -A packages/proto/gen && ./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen` + no untracked files; Files notes the wildcard entries are generated directories (exempt).
  - W4 (Step 14): single `cd services/xstockstrat-ui`; the repeated cd that broke the Playwright line is removed.
  - W5 (Step 5): "run from the repo root" stated before blocks 2-4 (heading and in-block comment).
  - W6 (Step 16 recorded RED): `pnpm run build && { … }`; the restore `mv` is guarded by `[ -n "$R" ]` and always runs; build failure reported separately.
  - W7 (Step 10): fake fields named `store.lastIntent` / `store.addSymbolsCnt` (281 `watchlist_service_test.go:37-38`, set `:171-173`); provenance helper `seedWatchlist(store, id, userID, systemManaged, binds)` (`:710`, used `:944-1063`); `expiryIntentFor` (`portfolio_service.go:1856-1885`, checks `:1867-1879`) requires a system-managed list, one SIGNAL binding, `signal_id > 0` and `valid_until` set; case (a) now sets them.
  - W8 (re-anchors): Step 5 Instr. 10 `main.go:170` → `:166`; Step 5 `fakeBackfillSource :703` → `:900`. Steps 6/8 `marketdata_service_test.go` re-anchored to the current tree: `TestGetBarsMarksSymbolWarm :1111-1121`, `…WarnsWhenMiss… :1126-1135`, `funcBody :1231`, `fakeIntGetter :1921`, `budgetCfgMs :1944`, `fakeBackfillSource.ListAssets :911`, `newQuoteSvc :3357-3365`, `fakeQuoteStore :3330`, `fakeBatchPriceSource :1643`, `fakeLatestTradeOnlySource :1713`, `TestBatchGetLatestPrice_MultipleSymbols :1741`, `fakeBarsStore :4060-4074`, `scriptedBarsSource :4077`, `partialSvc :4090-4095`, `batchReq :4097`, `hangUntilDone :4105`, `assertOnlyWarmAAPL :4110`, AC53/54 tests `:4120-4146`. Step 7's informational grep became count assertions: `markWarmIfServable(` = 3, `markWarm(` = 4 (3 kept call sites + definition).
- Step 16 config-side corrections from verifying 281's landed files (`origin/feature/signal-watchlist-expiry-pruning` `0657f082`, PR #1401):
  - `migrationSql.ts` signatures confirmed exactly (`MIGRATIONS_DIR`, `findOne(suffix: string, ext: 'up' | 'down'): string`, `splitStatements(sql: string): string[]`); now written out in Codebase Evidence. 281's seed test imports only `findOne, splitStatements`; zeroTrap imports all three (4 cases).
  - 281's seed test also has module-private `SUFFIX`, `interface SeedRow` and `parseUp()` (row offsets `[1, 9]`), which the spec omitted. They move into the helper (`parseUp` takes `suffix`) and are deleted from 281's file, and `SUFFIX` stays inline and is passed as `suffix: SUFFIX`.
  - Converted 281 file imports shrink to `describe` + `globalIntSeedCases` (drop `it`, `assert`, `findOne`, `splitStatements`, else eslint unused-import). The `describe` title `signal prune interval seed migration (@AC-19)` is kept.
  - Helper imports narrowed to `it`, `assert` (`node:assert/strict`), `findOne, splitStatements`.
  - 281's case titles are not key-prefixed, so prefixing renames them. Assertions are unchanged: case 1 also asserts two rows, and case 4 asserts an integer in range.
  - 037 pair names and content confirmed (one INSERT, fixed column order, staging-then-production rows of 8 literals + NULL, `ON CONFLICT … DO NOTHING`; down = one global-row DELETE). Recorded that 038/039 must keep that shape because `INSERT_RE` is exact.
  - Confirmed unchanged: five `it()` cases, `KEY` inline, `LIT`/`ROW`/`INSERT_RE` names, test glob `package.json:12-13`, `.jscpd.json:29`.
- Noted, not edited (outside W1-W8 scope): Step 7 Codebase Evidence `markWarm` call-site lines are off by one against the current tree (`:263, :546, :576, :689, :750, :869`); Step 9/10 cite `newSvc` at `watchlist_service_test.go:275` (main-dev), `:293` on 281's branch.

## Session 2026-11-04T22:07Z — sdd-review impl-spec (advisory)

- Result: 1 failure, 4 warnings (advisory — did not block). 17 steps, all pending.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 2: Files lists wildcard generated dirs (marketdatav1connect/*, portfolio/v1/*, gen/ts/dist/); spec self-exempts as generated output — waive or enumerate. — [x] enumerated 2026-11-04 (12 exact dist paths; unchanged portfolio grpc/connect stubs dropped)
  - Step 5: 6 files / 15 instructions; consider splitting migration 038 + wiring proof from the Go code. — [x] kept as one step with a recorded rationale (seed and reader must land together for the config-wiring check)
  - Steps 9, 10, 16: depend on feature 281 symbols (expiryIntentFor, ExpiryIntent, fakeWatchlistStore.lastIntent, migrationSql.ts) not in this tree. 281 must land on main-dev first; re-verify anchors, raise a blocker rather than adapt. — [ ] unaddressed
  - Step 7: line citations ~1 line stale; re-anchor at execution. — [x] markWarm call-site anchors re-stamped 2026-11-04; other :NNN anchors are find-by-symbol and drift again when 215 lands
- Overlap findings: WARN, no FAIL. No migration/proto/config-key collision (038/039 free; 037 is 281). Hard ordering 281 -> 282 per merge-order row 92 (optionally extend it to name the migrationSql.ts / signalPruneIntervalSeedMigration.test.ts test dependency).

## Session 2026-11-04 — merge-order ruling: 280 depends on 281 (operator)

- 282's block 2 no longer requires feature 280's 035/036 on main-dev; it requires 281's 037 only. Feature 280 now renumbers above the highest config migration at its merge time (merge-order.md row in the 281 branch/PR #1401). If 280 merges before 282 with numbers >= 038, block 2 STOPs and 282 re-specs its numbers.

## Session 2026-11-04 — impl-spec review loop (3 iterations, advisory)

- Iteration 3 result: PASS, 0 failures, 0 fixable warnings. Remaining: one external gate. Steps 9, 10 and 16 (and Step 5 block 2's `037` check) need 281's symbols and migration on main-dev (PR #1401) — [ ] unaddressed (external).
- Optional wording tidy, not a warning: `design.md:113,177,178` still describe the old 035/036 check; the spec's block 2 is authoritative.

---

## Session 2026-11-04 — cross-feature sign-off from feature 291 (fix-marketdata-dead-symbol-ingest)

- Operator decision (2026-11-04, recorded here and in 291's context.md): this feature's invariant "the gate applies at warm-add sites only; warm-set readers are never filtered" (`design.md:24`, `:42`) is narrowed to: *"No reader filters the warm set by servability. The bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 no-bars hold state, and never removes it from the warm set. Quote/price readers are never filtered."* When 282's constitution text lands it must use this wording.
- Feature 291 is the per-symbol negative cache that `design.md:48` put out of scope; it does not change 282's scope. 282 R6 (`design.md:59`, ingester no-bars noise from re-warmed held unservable symbols) is **addressed by 291**.
- Shared region: `markWarm` (`marketdata_service.go:1089-1096`) and the GetBars/batch warm-add sites. 291 does not edit them; whichever lands second keeps any new-add hold-state delete inside `markWarmIfServable`. `merge-order.md` row added (independent, rebase-only).

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the up-front plan for this feature (sequential mode entry confirmed via `/sdd-batch-execute`); no per-step Phase-2 prompt follows. Status `implementation-ready` → `in-progress`.
- §5.3 branch setup: normal merge of `origin/main-dev` into the feature branch (`9e7d1fbe`, no conflicts); `scripts/ledger-guard.py --own-slug filter-otc-symbols --base origin/main-dev --fix` → clean, no repair.
- §5.3 re-spec (conditional directive; commit `027f8306`). Changed step bodies only:
  - Step 11 (semantic): feature 281 changed `client.add_watchlist_symbol` to `(user_id, watchlist_id, symbol, signal_id=None, valid_until=None) -> None` (`client.py:319-357`, sends `signal_provenance` for dated signals). Instruction 3 now keeps that signature and changes only the return to `list[dict[str, str]]`; Instruction 4 keeps the 281 call `add_watchlist_symbol(user_id, wl_id, symbol, result.get("signal_id"), valid_until)` (`tools.py:711-713`). Anchors re-stamped (post-commit block `:707-718`, `manage_watchlist :2114`, `manage_watchlist_symbols :2198`).
  - Step 12: tests use the five-argument call shape (`test_ingest_signal_watchlist.py:56`); the dedup extension stays compatible with 281's `_send_signal_add` driver (`test_watchlist_client.py:261-283`); WARN assertion `test_tool_deadlines.py:260`.
  - Step 17: constitution numbers moved to `MARKETDATA-16` (15 is the 2026-11-04 singleflight candidate, `:53`) and `PORTFOLIO-19` (17 = offline discriminator, 18 = 281's expiry prune); the Verification greps were vacuous on the old numbers. Instruction 2 now cites the feature-291 wording signed off 2026-11-04 (previous session) instead of the superseded "warm-set readers … never filtered" text.
  - Steps 1, 3, 5, 7, 9, 10, 14, 15: line re-anchors only (post-281 drift); no instruction semantics changed. Step 9's EREA order is unchanged. Step 5 block 2 re-run → `038/039 free; 037 present`; `--final --json` findings on `portfolio_service.go` are the three baselined `read-unseeded` keys, no `dynamic-read` (no STOP-RD).
  - Steps 2, 4, 6, 8, 13, 16: evidence matched; not edited.
- Open, not edited (outside the re-spec scope): Step 5 Instruction 4's code comment "gate applies at warm-add sites only; warm-set readers are never filtered" predates the 291 wording; reconcile at Step 5 or raise it at the first checkpoint.
- Session note: `pnpm install` in this worktree set `core.hooksPath=.husky/_` in the shared repo config (husky `prepare`); the main worktree has no `node_modules`, so other worktrees' commits run the hook only if their `node_modules` exist.

## Session 2026-11-05 — sdd-execute sequential, Step 1

- Tooling setup (step 1): buf ⬇ 1.72.0 (GitHub release binary, pinned per root `CLAUDE.md`, into `/root/go/bin`) · go1.27.0 ✓. No codegen plugins needed (Step 1 runs lint/breaking only).

### Step 1 — proto: UnservableReason enum, GetSymbolServability RPC, RefusedSymbol [done]
- Appended `common.v1.UnservableReason` (UNSPECIFIED/OTC/NOT_TRADABLE) after `TemplateOrigin`; added `rpc GetSymbolServability` after `GetEtfFlags` plus `GetSymbolServabilityRequest` / `SymbolServability` / `GetSymbolServabilityResponse` at the end of `marketdata.proto`; added `portfolio.v1.RefusedSymbol` after `WatchlistBinding` and `repeated RefusedSymbol refused_symbols = 2` on the Create/Update/AddWatchlistSymbols responses. All additive; `Asset` untouched.
- TDD: N/A (proto). Verification: `buf lint` clean; `buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto"` exit 0, no findings (the against input was confirmed to resolve with a separate `buf build`).
- Files modified: `packages/proto/common/v1/common.proto`, `packages/proto/marketdata/v1/marketdata.proto`, `packages/proto/portfolio/v1/portfolio.proto`
- Deviations: none

## Session 2026-11-05 — sdd-execute sequential, Step 2

- Tooling setup (step 2): docker ⬇ (daemon started) · `xstockstrat-codegen` image ⬇ (built from `Dockerfile.codegen`: buf 1.72.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0, ts-proto 2.11.8, protoc-gen-es 2.12.0, protoc-gen-connect-es 1.7.0) · workspace `node_modules` ⬇ (`pnpm install --frozen-lockfile --ignore-scripts`, needed by the script's `tsc` step) · go1.27.0 ✓.
- Hook note: the shared `core.hooksPath` is `/home/user/xstockstrat/.husky/_`, which does not exist, so no pre-commit hook runs in this environment. This commit has no `services/xstockstrat-ui/` files, so the hook's lint-staged and UI checks would be no-ops anyway.

### Step 2 — proto-gen: regenerate Go, Python and TypeScript stubs [done]
- Ran `./scripts/buf-gen.sh` inside the pinned codegen image. The regenerated set is exactly the step's 28 **Files** (Go 5, Python 4, TS sources 7, TS dist 12). Portfolio `_grpc`/`connect` stubs are unchanged, as the spec expected. The `MarketDataServiceClient`/`Server` interfaces gained `GetSymbolServability`.
- TDD: N/A (generated code). Verification:
  - `UNSERVABLE_REASON_OTC` is present in the Go, Python and TS common stubs.
  - The marketdata `GOWORK=off go build ./...` exits 0.
  - Portfolio and trading `GOWORK=off go vet ./internal/service/` exit 0, so the `stubMarketData` and trading test stubs compile.
  - Freshness: stage, then a second run; `git diff --exit-code packages/proto/gen` exits 0 and no untracked files remain.
- Files modified: the 28 generated files under `packages/proto/gen/{go,python,ts}` listed in the step.
- Deviations: codegen ran in the `Dockerfile.codegen` container instead of on the host (CI-equivalent fallback; see the Deviation Log).

## Session 2026-11-05 — sdd-execute sequential, Step 3

- Tooling setup (step 3): node ✓ v24.22.1 (`/opt/node24/bin`; the default `node` on PATH is v22) · pnpm ✓ 9.15.9 · config deps ⬇ (`pnpm install --frozen-lockfile --ignore-scripts --filter xstockstrat-config...` in this worktree; the main worktree has no `node_modules` to symlink).
- Hook note: the shared `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) still does not exist, so no pre-commit hook runs here. The commit was not made with `--no-verify`.

### Step 3 — service: config write-edge bounds for the two new keys and the symbols-per-list ceiling [done]
- Added three entries at the end of `SCALAR_BOUNDS_REGISTRY`: `marketdata.assets.refresh_interval_hours` [1,24], `portfolio.marketdata.servability_timeout_ms` [500,4000] and `portfolio.watchlist.max_symbols_per_list` [1,1000]. Each has a feature-282 comment of at most 2 lines. Nothing else in the file changed.
- TDD (AC-22, AC-24 via Step 4's rows): RED was run with Step 4's six `TIMEOUT_KEY_FORMS` rows applied temporarily and left uncommitted (Step 4 owns that file). `node --test dist/__tests__/setConfigScalarBounds.test.js` gave 76 tests, 6 failed: the 6 `rejects … just outside` cases (`0 must be rejected` / `499 must be rejected`), which shows the keys were unbounded. GREEN after the edit: 76/76 pass, and the 12 new accept/reject cases ran. The temporary rows were then reverted.
- Verification, on the tree as committed: `pnpm run lint` gives 0 errors (234 warnings, all pre-existing, none on the changed lines). `pnpm run test:coverage` gives 272/272 pass, All files 90.66% lines and `configServiceImpl.js` 97.53%. `pnpm exec c8 check-coverage --lines 40` exits 0. The config-key wiring gate (`node scripts/check-config-wiring.mjs --declared-from …/product-spec.md`) exits 0 with no findings.
- The file's `prettier --check` drift is pre-existing (HEAD fails it too), and none of it is on the added lines. It was not reformatted, because that is out of scope.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: none

## Session 2026-11-05 — sdd-execute sequential, Step 4

- Tooling setup (step 4): node ✓ v24.22.1 (`/opt/node24/bin`) · pnpm ✓ 9.15.9 · config deps ⬇ (`pnpm install --frozen-lockfile --ignore-scripts --filter xstockstrat-config...`; the main worktree still has no `node_modules` to symlink).
- Hook note: the shared `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) still does not exist, so no pre-commit hook runs here. The commit was not made with `--no-verify`.

### Step 4 — test: SetConfig bounds for the two new keys [done]
- Appended the six specced rows to `TIMEOUT_KEY_FORMS`: the bare and full-dotted forms of `assets.refresh_interval_hours` [1,24], `marketdata.servability_timeout_ms` [500,4000] and `watchlist.max_symbols_per_list` [1,1000]. Added feature 282 to the comment above the table. C-13: no new fixture, because the rows extend the existing single-consumer table.
- TDD (AC-22, AC-24): RED ran against the pre-Step-3 registry. `configServiceImpl.ts` was restored from `HEAD~1` temporarily, then put back to `HEAD`. `node --test dist/__tests__/setConfigScalarBounds.test.js` gave 76 tests, 6 failed. The failures were exactly the 6 new `rejects … just outside` cases (`0 must be rejected` / `499 must be rejected`). GREEN on the committed tree: 76/76 pass, and all 12 new accept/reject cases ran (TAP `ok 63`–`ok 74`).
- Verification:
  - `pnpm run lint` gives 0 errors and 234 warnings, the same count as Step 3, so none are new.
  - `pnpm run test:coverage` gives 284/284 pass, with All files at 90.66% lines.
  - `pnpm exec c8 check-coverage --lines 40` exits 0.
  - The config-key wiring gate (`--declared-from …/product-spec.md`) exits 0 with no findings.
- The new rows follow the table's one-row-per-line convention. 18 of the 24 existing rows already exceed prettier's width, and CI does not run prettier, so the new rows were not reformatted.
- Files modified: `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts`
- Deviations: none

## Session 2026-11-05 — sdd-execute sequential, Steps 5 + 6 (merged)

- Operator decision (binding, 2026-11-05, Option A on the Step 5 blocker): fold Step 6's two test files into the Step 5 commit, so `liveFetchAllowed` and `markWarmIfServable` have callers and lint is clean. Run Step 6's Verification too, mark Steps 5 and 6 `done` in one commit, and skip Step 6 in the loop. Recorded in the Deviation Log.
- Tooling setup (steps 5-6): go1.27.0 ✓ · golangci-lint 2.14.0 ✓ · node ✓ v24.22.1 (`/opt/node24/bin`, used for `check-config-wiring.mjs`). Nothing installed.
- Hook note: no `node_modules` exists at this worktree root or in the main worktree, so there was nothing to symlink. The shared `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook runs. The commit was not made with `--no-verify`.

### Step 5 — service: marketdata asset set, GetSymbolServability RPC, refresher [done]
- New `internal/service/asset_servability.go` contains:
  - the fixed-invariant `const (` block, including `assetRefreshHoursKey`
  - immutable `assetSet` with nil-safe `classify`/`servable`, plus `liveFetchAllowed`
  - `assetServabilityState` (an `atomic.Pointer` snapshot)
  - `markWarmIfServable`, which loads the snapshot under `warmMu`
  - `GetSymbolServability`: a request over 1000 symbols returns `InvalidArgument`; symbols are normalized; a nil snapshot gives `AssetSetLoaded=false` with every symbol servable
  - `refreshAssets`: `us_equity` via the registry's default source; it rejects an empty list or one below 50% of the previous set; only the first load prunes the warm set, with one INFO `asset set loaded`
  - `noteAssetRefreshFailure` (one unloaded WARN), `nextAssetRetryDelay` (1m doubling to a 30m cap), `resolveAssetRefreshInterval` (`<= 0` → paused, above 24 → 24h, nil/unset → 6h) and `StartAssetSetRefresher` (loads at boot, 1-minute ticker, re-reads the interval each tick, backs off on failure)
- Other code changes:
  - Field `assets assetServabilityState` added next to `etf` in `MarketDataService`.
  - Connect handler and gRPC adapter `GetSymbolServability` added after `GetEtfFlags`.
  - `go svc.StartAssetSetRefresher(ctx)` added after `StartEtfFlagFiller` in `main.go`.
  - Config seed `038_marketdata_asset_refresh_interval.{up,down}.sql` copied verbatim from `design.md` § Amendment 2026-11-02.
- Logging: once a set is loaded, a `ListAssets` error logs WARN `asset set refresh failed; keeping last good set`, and a rejected list logs WARN `asset set refresh rejected; keeping last good set` with `old_count`/`new_count`. While no set is loaded, `noteAssetRefreshFailure`'s single WARN covers every failure.
- Instruction 4's comment was kept verbatim ("gate applies at warm-add sites only; warm-set readers are never filtered"), as the step body specifies. Open item (carried): reconcile it with the feature-291 wording when Step 17's constitution text lands. Raise it at the checkpoint.
- Offline migration check: the 038 up inserts two global rows (staging and production, `user_id` NULL) with `ON CONFLICT … DO NOTHING`. The down deletes only that key's global rows (`user_id IS NULL`), so it reverses the up. No database was started.
- Verification:
  - Block 1: `go build` ok, `golangci-lint` 0 issues, and all three wiring greps match (`main.go:168`, `asset_servability.go:27`, `:173`).
  - Block 2 (split commands, see the Deviation Log): 038/039 free on every `origin/*` ref, and 037 present.
  - Block 3: step-time guard exit 0 with no findings.
  - Block 4 (split, merge-base `94908ce6`): `key hits 0, introduced 0, pre-existing 0`, exit 0, and no ESCALATE lines.
  - Sanity check: with the 038 up file moved aside, `--final` reports `asset_servability.go:marketdata.assets.refresh_interval_hours:read-unseeded`. The checker therefore sees the reader, and the seed wires it.

### Step 6 — test: marketdata asset set, servability RPC, refresher semantics [done]
- `internal/testdata/assets.go` holds `Aapl`, `Zzzz`, `Bossy`, `Crtd`, `Forl`, `Dnb`, `ExchangeNasdaq`/`ExchangeOTC`, `ServableAssets()` (DNB absent, `Msft` reused from `marks.go`) and `SyntheticAssets(n)` for the AC-11 10-asset set. That last builder was added in scope (Deviation Log).
- `internal/service/asset_servability_test.go` adds one test per scenario: AC-1, AC-23, AC-4/AC-7 (`liveFetchAllowed`), AC-22, AC-9, AC-10, AC-11, AC-15, AC-24, and `TestResolveAssetRefreshInterval_ReadsSeededKey` (literal key, 12 → 12h). `fakeAssetSource` scripts `ListAssets` and asserts the class `us_equity`.
- TDD: RED before implementation was a compile failure in `go test ./internal/service/ -run 'Servability|AssetSet|LiveFetch|ResolveAssetRefresh'`: `svc.refreshAssets undefined`, `svc.GetSymbolServability undefined`, `svc.assets undefined`, `undefined: liveFetchAllowed`. The behaviour was missing, not mistyped. GREEN with `-race`: all 10 new tests PASS. Scenarios: AC-1 red: GetSymbolServability undefined → green; AC-9/10/11/15/22/23/24 likewise.
- Verification:
  - `golangci-lint` 0 issues.
  - `go test ./... -race -count=1` with the CI coverpkg set: all packages ok, total 81.9% (40% threshold).
  - The C-13 grep shows `BOSSY` only inside assertion message strings. Every symbol value comes from `testdata`.
  - The `ReadsSeededKey` count is 1.
- Files modified (Steps 5 + 6): `services/xstockstrat-marketdata/internal/service/asset_servability.go`, `…/internal/service/marketdata_service.go`, `…/internal/handler/marketdata_handler.go`, `…/cmd/server/main.go`, `services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.{up,down}.sql`, `…/internal/service/asset_servability_test.go`, `…/internal/testdata/assets.go`
- Deviations: Steps 5 + 6 merged into one commit (operator), Step 5 blocks 2 and 4 run as split commands (CI-equivalent fallback), extra fixture builder (C-13). Details are in the Deviation Log.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute), §5.3 re-spec before Step 7

- Up-front confirmation: the operator approved the plan; status was already `in-progress`, so no status change.
- Branch setup: `git merge --no-edit origin/main-dev` was a no-op (`94908ce6` already an ancestor). `scripts/ledger-guard.py --own-slug filter-otc-symbols --base origin/main-dev --fix` reported clean, so nothing to repair.
- Re-spec (implementation-spec.md only, each anchor re-grepped):
  - Step 7: every `:NNN` moved +2 after Step 5 (`markWarm(` at GetBars `:265`, BatchGetBars `:752`, BatchGetLatestPrice `:871`, definition `:1091`). Recorded that the Step 5 dependencies (`markWarmIfServable`, `liveFetchAllowed`, nil-safe `servable`) exist. The Verification counts (3 / 4) still hold.
  - Step 9: Instruction anchors `quoteTimeout()` `:423-432` and `maxSymbolsPerList` read `:1915`.
  - Step 11: `add_watchlist_symbols` `:551-571`. Step 12: the `AddWatchlistSymbols = AsyncMock(` mocks open at `:199`/`:236`/`:267`.
  - Step 13: `setDefaultStrategy` `:146` / `mutate` `:147` / `updateMask` `:149`, and `useAddWatchlistSymbols` `:97-108`.
  - Step 17: marketdata `CLAUDE.md` has no asset-set section. `:164-180` is the existing `GetEtfFlags` block, so the new section goes after `## Alpaca Integration` (`:216-226`), before `## Quote retention` (`:228`). This is a placement choice; raise it at the Step 17 checkpoint if it should sit elsewhere.
  - Steps 8, 10, 14, 15, 16: no mismatch, left unchanged.
- Not re-checked: the Step 9 cross-branch 038/039 collision loop (`for-each-ref`). The worktree sandbox refused it, so only `origin/main-dev` was checked (037 present, 039 absent).
- Hook note: the main worktree has no `node_modules` and the shared `core.hooksPath` does not exist, so no pre-commit hook ran. The commits were not made with `--no-verify`.
- Deviations: none

### Step 7 — service: marketdata warm-add gate at GetBars, BatchGetBars, BatchGetLatestPrice [done]
- `GetBars` warms via `snap := s.markWarmIfServable(req.Symbol)` and gates the live fetch as `if refetch && liveFetchAllowed(snap, req.Symbol)`; the WARN text is unchanged. `BatchGetBars` warms via `markWarmIfServable(req.Symbols...)` and drops `!snap.servable(sym)` from `cold` before `sortedCold`/the key. `BatchGetLatestPrice` warms the same way, keeps the flight key and the previous-close read on the full request, and runs the trade section only over `tradeSyms` (skipped entirely when empty). `GetLatestQuote(s)`/`GetLatestPrice` stay on `markWarm`.
- TDD (scratch test, deleted before commit; Deviation Log): RED: 4 failing, `GetBars must warm via markWarmIfServable`, `BatchGetBars: alpaca: 503 upstream, want the warm subset`, `trade request contained unservable BOSSY: [AAPL BOSSY DNB]`, `BOSSY was warmed`, `trade fetch ran for an all-unservable request: [[BOSSY]]` → GREEN: all 4 PASS. Scenarios exercised ahead of Step 8: AC-4/AC-7 (GetBars wiring), AC-12 (strict, unservable cold), AC-13 (prev_close only, omit rule).
- Verification: `go build` ok, `golangci-lint` 0 issues, `markWarmIfServable(` = 3, `markWarm(` = 4.
- Open item (expected, closes in Step 8): `go test ./...` fails only `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:1118`, still asserts `s.markWarm(req.Symbol)`). Step 8 Instruction 1 updates it, so the branch is red on that test between the Step 7 and Step 8 commits.
- Hook note: the main worktree has no `node_modules`, so the husky pre-commit hook has nothing to run; no `--no-verify` was used.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`
- Deviations: TDD via an uncommitted scratch test; `skipped` counts `tradeSyms` (both in the Deviation Log)


### Step 8 — test: marketdata gate (GetBars, BatchGetBars, BatchGetLatestPrice, ungated paths) [done]
- `TestGetBarsMarksSymbolWarm` now checks three things in `GetBars`' body: it has `s.markWarmIfServable(req.Symbol)`, it has no bare `s.markWarm(`, and it has `refetch && liveFetchAllowed(snap, req.Symbol)`. `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` is unchanged and passes, which closes the Step 7 open item.
- New tests, appended to `marketdata_service_test.go` under the feature-282 banner:
  - `TestMarkWarmIfServable_{LoadedSetWarmsOnlyServable,UnloadedWarmsAll}` covers AC-4, AC-7 (DNB) and AC-23 (`" bossy "`) for the warm half, plus fail-open.
  - `TestBatchGetBars_AC12_{StrictSkipsUnservableCold,StrictServableColdStillErrors}` covers AC-12 and the R4 pin that keeps `@AC-53 @feature-240` meaningful.
  - `TestBatchGetBars_AC14_PartialFetchesOnlyServableCold` uses the new `symbolRecordingBarsSource` wrapper (`scriptedBarsSource` is unchanged). It asserts the live fetch requested `[[ZZZZ]]`, and that the `partialColdFetch` WARN `cold` contains ZZZZ but not BOSSY.
  - `TestBatchGetLatestPrice_AC13_{UnservableGetsPrevCloseOnly,FlightKeyCoversUnservable}`:
    - AAPL gets a live price. BOSSY gets `prev_close` 9.9 only. CRTD has neither, so it is omitted.
    - BOSSY and CRTD are not warm, and the trade fetch saw `[[AAPL]]` only.
    - Two concurrent calls that differ only in an unservable member produce 2 previous-close reads, so no map is shared.
  - `TestGetLatestQuotes_AC16_UnservableStaysUngated` (behaviour) and `TestQuoteAndPricePaths_AC16_StayOnUngatedMarkWarm` (structural, see the Deviation Log) cover AC-16.
  - `TestGetLatestQuotes_AC17_OTCStaysWarmAcrossRefresh` and `TestGetLatestQuotes_AC26_PrunedSymbolRewarmed` cover AC-17 and AC-26 (FORL, `assetQuoteSource` = quotes + scripted asset list).
  - Every symbol comes from `internal/testdata` (C-13). In the AC-12/13/14 sets BOSSY is listed as OTC rather than absent, and both readings are unservable.
- TDD:
  - RED (`go test ./internal/service/ -run …` against the pre-Step-7 `marketdata_service.go`) had 4 failures:
    - `GetBars must call s.markWarmIfServable(req.Symbol)` plus the guard assertions.
    - AC-12: `BatchGetBars: alpaca: 503 upstream, want the warm subset with no error`.
    - AC-14: `live fetch requests = [[BOSSY ZZZZ]], want [[ZZZZ]]`.
    - AC-13: `warm set = [AAPL BOSSY CRTD], want AAPL only` and `trade requests = [[AAPL BOSSY CRTD]], want [[AAPL]]`.
  - The preservation cases (AC-16/17/26, the AC-12 pin, the flight key, `markWarmIfServable`) passed in RED as expected. They guard behaviour that Step 7 keeps, or that Step 5 already provides.
  - GREEN (`-race`, Step 7 tree): all 16 selected tests PASS.
- Verification:
  - `golangci-lint` reported 0 issues.
  - `go test ./... -race -count=1` with the CI coverpkg set passed for every package, total 81.9% (≥ 40%).
  - The C-13 grep matches `FORL` only in assertion message strings and `"BOSSY"` nowhere, so no literal is declared in a test file.
- Files modified: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`
- Deviations: RED came from the pre-Step-7 service file; AC-16 for `GetLatestQuote`/`GetLatestPrice` is structural; Verification ran as split commands (CI-equivalent). All three are in the Deviation Log.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute), Step 9

- Tooling setup (step 9): go1.27.0 ✓ · golangci-lint 2.14.0 ✓ (built with go1.27.0) · node ✓ v24.22.1 (`/opt/node24/bin`, for `check-config-wiring.mjs`). Nothing installed.
- Hook note: `node_modules` at this worktree root is a symlink to the main worktree's, so the husky pre-commit hook can run. No `--no-verify` was used.
- Discovery (Phase 1, on `origin/feature/filter-otc-symbols` `03efd8de`): every Step 9 anchor matches the re-spec. Steps 1, 2 and 5 are present on this branch: `GetSymbolServability`, `RefusedSymbol`, `refused_symbols`, and migration 038. The digest's "not found" items came from the main worktree, which is not on this branch. 281's landed `expiryIntentFor` (`:1856`), `repository.ExpiryIntent` and `AddSymbols(…, intent)` match 281's spec. There is no drift, so the EREA order is unchanged.

### Step 9 — service: portfolio servability filter on the three watchlist insert paths [done]
- Added to `portfolio_service.go`:
  - the reader-clamp consts `defaultServabilityTimeoutMs` (2000), `minServabilityTimeoutMs` (500) and `maxServabilityTimeoutMs` (4000);
  - `servabilityTimeout()`: nil cfg → 2000ms, `<= 0` → 2000, then clamped to [500,4000], with a literal-key `GetInt` at one call site;
  - `refuseUnservable(ctx, bindings)`. It fails open on an empty input, a nil client, an RPC error or timeout, or `AssetSetLoaded == false`, with one WARN `symbol servability unavailable; allowing write`. Otherwise it partitions in order and keeps each accepted binding as-is (`Source` and `StrategyId` preserved).
- Wiring:
  - `CreateWatchlist` and the replace-all `UpdateWatchlist` branch filter after `requestBindings` and before the cap check, and return `RefusedSymbols`.
  - `AddWatchlistSymbols` runs EREA: `expiryIntentFor` on the unfiltered add; then `refuseUnservable`; then an early return of `existing` + refusals when everything was refused (no `AddSymbols`, no ledger event); then `expiryIntentFor` on the accepted add; then the cap; then `AddSymbols`.
  - The masked update, rebind RPCs, `EnsureSignalWatchlist`, `RemoveWatchlistSymbols` and reads are untouched.
- Config seed `039_portfolio_servability_timeout.{up,down}.sql` was written verbatim from `design.md` § Amendment 2026-11-02, and diffed byte-for-byte against the design blocks. Offline migration check: the up inserts two global rows (staging, production, `user_id` NULL) with `ON CONFLICT … DO NOTHING`, and the down deletes only that key's global rows. No database was started.
- TDD (scratch test, deleted before commit; Deviation Log):
  - RED had 9 assertion failures. The failing assertions:
    - `create stored [CRTD MSFT], want [MSFT]`
    - `create refused [], want [CRTD]`
    - `add refused [], want [BOSSY OTC]`
    - `all-refused add: addSymbolsCnt 1->2`
    - `update stored [CRTD MSFT], want [MSFT]`
    - `GetSymbolServability never called`
  - GREEN: PASS, with the error case logging one WARN.
  - Scenarios exercised ahead of Step 10: AC-3, AC-2, AC-19, AC-6, and the all-refused add. For each, "red: refusal absent → green: refused and reported".
- Verification:
  - Block 1: `go build` ok and `golangci-lint` 0 issues.
  - The `refuseUnservable` grep shows 3 call sites (`:2015`, `:2166`, `:2285`), the definition (`:460`) and the three `UnaryClientInterceptor` dials (`:130/:138/:146`). The marketdata dial is `:138`.
  - The literal-key `GetInt` grep matches `:446`, and the EREA check gives `SEQ=EREA`.
  - Block 2: `038/039 free; 037 present` across every `origin/*` ref.
  - Block 3: step-time guard with `--declared-migration …039….up.sql` exits 0 with no findings, and the `.down.sql` is present.
  - Block 4 (merge-base `94908ce6`): `key hits 0, introduced 0, pre-existing 0`, exit 0, with no STOP-RD and no ESCALATE lines.
  - Sanity: with the 039 up file moved aside, `--final` reports `portfolio_service.go:portfolio.marketdata.servability_timeout_ms:read-unseeded`, so the checker sees the reader.
  - `go test ./... -race -count=1` passes for every package, which shows the existing nil-`marketdata` watchlist tests still pass.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `services/xstockstrat-config/migrations/039_portfolio_servability_timeout.{up,down}.sql`
- Deviations: TDD via an uncommitted scratch test; Verification blocks run as split commands and scratch scripts (CI-equivalent). Both are in the Deviation Log.
- Merge-time re-check (Step 9 § Merge-time re-check) is still owed: run block 2 (a) before the integration PR opens and (b) before it merges.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute), Step 10

- Tooling setup (step 10): go1.27.0 ✓ · golangci-lint 2.14.0 ✓ (built with go1.27.0). Nothing installed.
- Hook note: neither this worktree nor the main worktree has `node_modules`, and the shared `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so no pre-commit hook ran. No `--no-verify` was used.
- Discovery (Phase 1, on `origin/feature/filter-otc-symbols` `bb7cd64b`): Step 9's `refuseUnservable`, `servabilityTimeout` and the 039 seed are present (the digest's "not found" came from the main worktree, which is not on this branch). The test-side anchors match the spec. Production line numbers moved with Step 9 (`expiryIntentFor` now `:1914`), but its signature and checks match 281's spec. There is no drift, so the EREA order is unchanged.

### Step 10 — test: portfolio refusals, fail-open, cap, replace-all, contract [done]
- `stubMarketData` gained `unservable`, `servabilityLoaded`, `servabilityErr`, `servabilityBlock`, `servabilityCalls`, the `newServabilityStub` constructor (loaded = true) and `GetSymbolServability`. The stub reports unservable symbols even when the set is unloaded, so a caller that ignored `asset_set_loaded` would fail AC-6.
- New tests in `watchlist_service_test.go` (feature-282 banner; `CRTD`/`BOSSY`/`DNB` inline only here, `testdata.Msft`/`testdata.Aapl` otherwise):
  - AC-2 add, AC-3 create, AC-8 table (create symbols/bindings, replace-all update, add; MANUAL and SIGNAL, `Source` kept), AC-19 replace-all.
  - AC-6 fail-open (error, block past a 500ms `servability_timeout_ms`, unloaded set: one WARN each, the timeout case returns in ~0.5s), AC-22 (`connect` InvalidArgument fails open with a WARN).
  - AC-25 (cap 3, 2 stored + `[C, BOSSY]` passes; `[C, D, BOSSY]` is InvalidArgument), AC-7 (DNB `NOT_TRADABLE`).
  - Never-classify guard (masked update, `UpdateWatchlistBinding(s)`, `EnsureSignalWatchlist`, `RemoveWatchlistSymbols`: 0 calls), the all-refused add (no `AddSymbols`, no ledger event, `existing` + refusals), `TestServabilityTimeout_ReadsSeededKey` (3000 → 3s), the default-strategy EXTEND, and `TestAddWatchlistSymbols_RefusedSymbolGetsNoExpiry` (a)–(d).
- `offline_valuation_test.go`: `TestListPositions_AC17_HeldUnservableStillValued`. FORL is requested via `GetLatestQuotes`, marked `LAST_CLOSE` from its stored 10-16 close, and `servabilityCalls == 0`.
- TDD (pre-Step-9 service file + temporary shim, both reverted before staging; Deviation Log):
  - RED: a compile failure first (`svc.servabilityTimeout undefined`). With the shim, assertion failures, including `refused = [], want [BOSSY:UNSERVABLE_REASON_OTC]`, `stored = [CRTD MSFT], want [MSFT]` (AC-3/AC-8/AC-19), `WARNs = 0, want 1` (AC-6/AC-22), `too many symbols: 4 exceeds max 3` (AC-25), `refused = [], want [DNB:…NOT_TRADABLE]` (AC-7), `AddSymbols called 1 times, want 0` (all-refused, EREA (a)), `UntrackSymbols = [BOSSY AAPL], want [AAPL]` (EREA (b)), `servabilityTimeout() = 2s, want 3s`.
  - Green in RED by design: EREA (c)/(d), AC-25 over-cap, never-classify, AC-17, and `…Feature196`.
  - GREEN (`-race`, Step 9 tree): all selected tests PASS.
- Verification:
  - `golangci-lint` 0 issues.
  - `go test ./... -race -count=1` with the CI coverpkg set passes for every package, total 68.6% (≥ 40%). The existing nil-`marketdata` watchlist tests pass unmodified.
  - The `"CRTD"` grep matches one file (`watchlist_service_test.go`).
  - The `RefusedSymbolGetsNoExpiry` and `ReadsSeededKey` counts are 1 each.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go`, `…/watchlist_service_test.go`, `…/offline_valuation_test.go`
- Deviations: RED from the pre-Step-9 file plus a shim; `DNB` literal for AC-7; Verification run as split commands (CI-equivalent). All three are in the Deviation Log.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute), Step 11

- Tooling setup (step 11): ruff 0.16.9 ✓ · uv ✓ · Python 3.13.18 ✓. `uv sync --frozen --extra dev` built the locked agent env. Nothing else was installed.
- Hook note: `node_modules` was symlinked from the main worktree into this worktree root so the husky pre-commit hook can run. No `--no-verify` was used.
- Discovery (Phase 1, on `origin/feature/filter-otc-symbols` `dc106448`): the digest's "proto has no `refused_symbols` / `RefusedSymbol` / `UnservableReason`" finding came from an unstamped tree and was discarded. On this checkout, `RefusedSymbol` is at `portfolio.proto:252` and `refused_symbols = 2` is on the Create, Update and Add responses (`:292/:330/:356`); `UnservableReason` is at `common.proto:147`. The agent anchors match the spec: `add_watchlist_symbol` `client.py:319-356` (returns `None`), `_watchlist_to_dict` `:364-366`, create return `:454`, replace-all update return `:531`, add return `:571`, and the `ingest_signal` add call at `tools.py:711-713`.

### Step 11 — service: agent surfaces refusals (Agent consumer surface) [done]
- `client.py`:
  - New `_refused_to_list(resp)` with a lazy `common_pb2` import. It returns `[{"symbol", "reason": UnservableReason.Name(...)}]`.
  - `create_watchlist`, the replace-all `update_watchlist` and `add_watchlist_symbols` always return a `refused` key. The masked update keeps `{"watchlist"}` only.
  - `add_watchlist_symbol` keeps 281's five parameters and its provenance logic. It now returns `list[dict[str, str]]`, the refused list.
- `tools.py`:
  - `ingest_signal` binds `refused`. When it is non-empty, it sets `result = {**result, "watchlist_refused": refused}`, a copy, so the client's dict is not mutated. A refusal never raises.
  - The docstrings for `ingest_signal`, `manage_watchlist` and `manage_watchlist_symbols` now cover the refusal shape, the reason NAMEs, "refused = not newly added", the replace-all drop of a now-unservable stored symbol, the masked path returning no `refused`, and the R7 refresh copy (default 6h, max 24h).
- TDD (uncommitted scratch test, deleted before staging; see the Deviation Log):
  - RED: 5 failed: `KeyError: 'refused'` ×3 (add, create, replace-all update), `assert None == [{… 'CRTD'}]` (`add_watchlist_symbol`), and the `ingest_signal` result missing `watchlist_refused`.
  - GREEN: 5 passed.
  - Scenarios exercised ahead of Step 12: AC-5, AC-18 and AC-19, each "red: no refusal surfaced → green: refusal surfaced".
- Verification:
  - `ruff check .`: all checks passed. `ruff format --check .`: 65 files already formatted.
  - `pytest` on the four spec'd files: 67 passed.
  - The `x-user-id` grep shows the return paths reuse the propagating call sites (`:313/:355/:416/:432/:464`). No new outbound call was added.
  - Full suite: 650 passed, coverage 84.49% (≥ 40%).
- Files modified: `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/app/tools.py`
- Deviations: TDD via an uncommitted scratch test, and `pytest` run through `uv run --no-sync` (CI-equivalent). Both are in the Deviation Log.
- Open item: `docs/runbooks/mcp-tools.md` must mirror the new docstring text. That is Step 15's **Files**, not this step's. The doc-parity test only checks headings, so it stays green until then.
- `feature.md` is unchanged: this is neither the first nor the last completed step.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute), Step 12

- Tooling setup (step 12): ruff 0.16.9 ✓ · uv 0.11.32 ✓ · Python 3.13 ✓. `uv sync --frozen --extra dev` built the locked agent env. Nothing else was installed.
- Hook note: the main worktree has no `node_modules`, so there was nothing to symlink, and the shared `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist. No pre-commit hook ran, and no `--no-verify` was used.
- Discovery (Phase 1, on `origin/feature/filter-otc-symbols` `583b0730`): the digest said Step 11 and the proto had not landed, but it came from an unstamped tree, so it was discarded. On this checkout, Step 11's `_refused_to_list` and `watchlist_refused` are present. The test anchors match the spec: `_channel_cm :16`, `_patch_stub :23`, the dedup test `:223-248`, `_send_signal_add :261-283`, `mock_add` at `:38` with the five-argument assert at `:56`, the WARN at `test_tool_deadlines.py:260`, and doc parity at `test_watchlist_tools.py:312-320`.

### Step 12 — test: agent refusals, ingest_signal, doc parity [done]
- `test_watchlist_client.py`:
  - New `_CRTD_REFUSED` / `_crtd_refused_pb()` (the one refusal these tests' responses report).
  - `add_watchlist_symbols` and `create_watchlist` return the watchlist plus `refused` (AC-18 client half). Create with nothing refused returns `refused == []`.
  - AC-19 is covered: a name-only `update_watchlist` resubmits CRTD + MSFT, the response keeps MSFT, and `refused` carries CRTD.
  - The masked `update_watchlist` returns only `{"watchlist"}`.
  - The dedup test now adds CRTD and asserts the returned refusal list and the SIGNAL source, with `x-user-id` still sent once.
  - A descriptor-parity test asserts `RefusedSymbol` has exactly `{symbol, reason}` with `reason` typed `UnservableReason`, and that the Add, Create and Update responses expose `refused_symbols`.
  - 281's provenance tests are untouched.
- `test_watchlist_tools.py`: `manage_watchlist_symbols add` and `manage_watchlist create` pass `refused` through unchanged (AC-18), with both reason NAMEs. Both docstrings name `"refused"` and both reasons.
- `test_ingest_signal_watchlist.py`: `_ingest_watchlist` gained a `symbol` parameter.
  - AC-5: a FORL refusal yields `{signal_id, deduplicated, watchlist_refused}`, and `mock_add` is awaited `("u-2", "wl-sys", "FORL", 105, None)`.
  - An empty refusal list keeps the stable `{signal_id, deduplicated}` shape.
  - The existing tests and the WARN tests are unchanged.
- TDD (pre-Step-11 `client.py`/`tools.py` swapped in, then restored before GREEN and before staging; see the Deviation Log):
  - RED: 8 failed, 70 passed. The failures were `assert None == [{… 'CRTD'}]` (dedup test), `KeyError: 'refused'` ×4 (add, create, create-empty, replace-all update), the docstring assertions for `manage_watchlist` and `manage_watchlist_symbols`, and the missing `watchlist_refused` for FORL.
  - Green in RED by design: the tool pass-through tests (the tool layer already passes the client dict through), the masked-update key check, the empty-refusal ingest shape, and the descriptor parity (the proto landed in Step 1).
  - Scenarios: AC-5, AC-18 and AC-19, each "red: no refusal surfaced → green: refusal surfaced".
  - GREEN: 78 passed on the four files. That is 67 before, plus the 11 new cases, which confirms they ran.
- Verification:
  - `ruff check .`: all checks passed. `ruff format --check .`: 65 files already formatted.
  - `pytest` on the four spec'd files: 78 passed.
  - Full suite `--cov=app --cov-fail-under=40`: 661 passed, total coverage 84.54%.
  - The C-13 `conftest|fixture` grep has no hits in `test_watchlist_client.py`.
- Files modified: `services/xstockstrat-agent/tests/test_watchlist_client.py`, `services/xstockstrat-agent/tests/test_watchlist_tools.py`, `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py`
- Deviations: RED from the pre-Step-11 files, `pytest` run through `uv run --no-sync` (CI-equivalent), and the test inputs (the dedup test adds CRTD, a `DNB` literal for NOT_TRADABLE, a `symbol` parameter on `_ingest_watchlist`). All three are in the Deviation Log.
- Open item (carried from Step 11): `docs/runbooks/mcp-tools.md` must mirror the refusal text (Step 15). Doc parity only checks headings and the `ingest_signal` auto-add wording, so it stays green until then. No test pins `watchlist_refused` in the `ingest_signal` docstring.
- `feature.md` is unchanged: this is neither the first nor the last completed step. Step 12 closes the Agent consumer surface (C-14 checkpoint boundary).
