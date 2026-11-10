# Context: filter-otc-symbols  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The feature shipped one predicate, owned by marketdata. A symbol is "unservable" if it is absent from the in-memory Alpaca active+tradable `us_equity` set, or listed on exchange `OTC`.
- **Marketdata gating.** The predicate gates warming and live fetches only at the three opportunity-path warm-add sites: `GetBars`, `BatchGetBars` and `BatchGetLatestPrice`.
- **Portfolio refusal.** Portfolio refuses unservable symbols per symbol on its three insert paths, and fails open. The agent and the UI report the refusals.
- **Design focus.** Most of the ~5-round design debate was about keeping held positions priced. Quote and price paths stay ungated, and only the FIRST asset-set load prunes the warm set.
- **Ordering coupling.** A late seed-key amendment tied the ordering to features 280/281: config migrations 038/039, the EREA order.

Launched 2026-11-06 (PR #1459, `d6775319`).

**Why (irrecoverable rationale)**:
- **Origin.**
  - Staging Loki logged `live_loop: N/50 … had no 1d bars` every ~14 min for CRTD, DNB, FORL and BOSSY. This was noticed while reviewing PR #1384.
  - Marketdata live-fetched on every `GetBars` miss and warmed the symbol, so the bar ingester re-fetched it every 5 min.
  - Checked against FMP and Webull: CRTD, BOSSY and FORL are OTC/pink/expert-market. DNB is not OTC; it is a reused, delisted ticker. That is why scope widened from OTC to delisted/non-tradable.
- **No new Alpaca fields were needed.** `alpaca.Client.ListAssets` already sends `status=active` and skips `!Tradable`, so "absent from the set" already means delisted or non-tradable. Operator-accepted side effect: mistyped tickers and new listings are refused until the next refresh (up to 6 h, max 24 h).
- **Enforcement lives in marketdata, not in the analysis live loop.** The operator first asked for live-loop enforcement. It was reconciled into FR-3 (a marketdata-side gate), so analysis was left unchanged.
- **The filter is uniform: no special case for stored vs new symbols.**
  - The operator said "leave existing data" only removes cleanup code and must not shape the design.
  - That knowingly broke `@AC-5 @feature-148`. A name-only, read-modify-write agent update now drops and reports stored unservable symbols. The operator signed this C-16 CHANGE off in round 1.
  - The UI rename switched to `updateMask:['name']` so the UI does not suffer the same loss.
  - The operator also signed off (round 1) a CHANGE to `@AC-1 @feature-127`. A watchlist-direction signal for an unservable symbol is not added. The ingest still succeeds, and the refusal comes back as `watchlist_refused`.
- **The filter is deliberately feed-agnostic.** OTC symbols stay refused even if `marketdata.alpaca.feed` is switched to `otc` or `sip`, because serving OTC data was out of scope. This was an operator decision on 2026-11-01; no further rationale was recorded.
- **`us_equity` only.** Marketdata serves only `/v2/stocks`, so crypto is unservable.
- **Gate scope moved twice.**
  - Round 1: `GetBars` only.
  - Round 2: widened to `BatchGetBars` and `BatchGetLatestPrice`, because refused-but-stored signal symbols (FORL) kept being warmed via the opportunity paths.
  - Gating all six `markWarm` sites was ruled out: it starves held positions' quotes.
  - Held-symbol safety relies on trading publishing offline positions with `current_price: 0`, so portfolio always quotes them through the ungated `GetLatestQuotes`, which re-warms them.
- **Prune only on the first load.** Round 3 chose pruning on every refresh; round 4 reversed it. Per-refresh pruning makes permanent bar-history holes and `MARK_SOURCE_NONE` marks for held unservable symbols. Accepted residual: a symbol that becomes unservable after warming stays warm until restart.
- **A prev_close-only `BatchGetLatestPrice` entry is safe.**
  - An unservable symbol with a stored previous close returns `prev_close` only, with `last_price` unset.
  - Analysis checks `HasField("last_price")` and never memoizes a missing price, so no consumer reads the entry's presence as a live price. The accepted cost is a cheap DB-only re-request on each pass.
  - The singleflight key stays on the FULL request. Keyed on the filtered set, callers that differ only in unservable members would share the leader's previous-close map. This was recorded only in design.md.
- **R4 dissent.** The operator classified the strict-`BatchGetBars` change to `@AC-53 @feature-240` as EXTEND. The adversary held it is a narrowing: a strict call whose only cold symbols are unservable now succeeds instead of failing INTERNAL. Mitigation is in Go unit tests only (`TestBatchGetBars_AC12_StrictServableColdStillErrors` pins ZZZZ as servable in a loaded set). The durable Gherkin pin is still owed (see Deferred follow-ons).
- **No client-side 1000 constant in portfolio.** The bound is kept by the SetConfig bound `[1,1000]` on `max_symbols_per_list`. An oversized request that still reaches the RPC gets `InvalidArgument`, and portfolio fails open.

**Rejected alternatives**:
- **A filter on `ListAssets` (`tradable_only` / exchange).** `ListAssets` is a live Alpaca passthrough, `tradable_only` is never read, and the predicate would leak into callers.
- **A DB table for the asset set (marketdata migration 010).** An in-memory reload is enough. A table adds DB load against feature 153, plus DBA review.
- **Classifying only newly added symbols** (recon recommended `loadOwned` capture and a `stored` param). It lost to the operator steer above.
- **Where to gate.**
  - `GetBars` only: opportunity paths keep warming refused symbols.
  - All six `markWarm` sites (recon's recommendation): starves held quotes and breaks `@AC-3 @feature-178`.
  - Filtering warm-set readers (poller, ingester, `warmSnapshot`): starves held symbols and needs several synchronized edits.
- **When to prune.**
  - Every refresh: bar holes and `MARK_SOURCE_NONE`.
  - Never: symbols warmed in the boot window persist.
- **Tagging warm entries by origin**, so only gated-site entries are pruned. Extra state, and superseded by first-load-only pruning.
- **Exempting `allow_partial` callers from the gate.** It ties a degradation flag to servability policy.
- **A per-list cap computed before filtering.** It contradicts FR-2's "accept the rest" (round-5 final change).
- **Chunking the RPC at 1000 in portfolio.** It duplicates a marketdata constant.
- **A kill-switch key.** It conflicts with "always filter".
- **Seed-amendment variants:**
  - Variant P (start 282 now, resolve 281 in a merge commit): the EREA order would first be written by hand in a merge resolution, and its guard test would have no reliable RED.
  - Filtering before 281's provenance validation: `[BOSSY, AAPL]` with provenance would be cut to `[AAPL]` and pass validation, breaking 281 `@AC-18`. The gist survives in PORTFOLIO-19.
  - Placing the seed test step after Step 10: 22 renumber edits instead of 3.
  - Renumbering through the Deviation Log: the shell blocks hard-code 038/039 (F-08/F-09).

**Scars & gotchas**:
- **Steps 5 and 6 had to merge (operator Option A).** `markWarmIfServable` and `liveFetchAllowed` have no non-test caller until Step 7, so a Step-5-only commit fails the `golangci-lint` `unused` check. Step 6's tests shipped in the same commit as their only callers.
- **`GetLatestQuote` / `GetLatestPrice` read the concrete `*repository.MarketDataRepo`, and a nil pool panics.** They cannot be behaviour-tested with fakes, so AC-16 for them is a source scan, as for `GetBars`, which needs a live pool.
- **The `<= 0` pause is a reader-only defence.** `resolvePositiveInt` maps `<= 0` to the default, so the refresh-interval reader calls `budgetCfg.GetInt` directly to keep MARKETDATA-5 pause semantics. The SetConfig registry minimum of 1 rejects 0 at write time anyway.
- **Per-symbol fallback arithmetic in `BatchGetLatestPrice`.** After trades were restricted to `tradeSyms`, `skipped = n - i` would have counted unservable symbols as skipped. It became `len(tradeSyms) - i`, while the log fields keep `n = len(req.Symbols)`. This was recorded only in the impl-spec Deviation Log.
- **The `servability` stub reports unservable symbols even when the set is unloaded, on purpose.** A caller that ignored `asset_set_loaded` would then fail AC-6.
- **RED for service steps 7, 9, 11 and 13 came from scratch tests.** Paired test steps own the test files, so each service step got its RED from an uncommitted scratch test or from swapping in the prior step's file. Step 10 also needed a temporary shim to turn a compile-RED into an assertion-RED.
- **Playwright `setup` warm-up times out at 10 s under `pnpm dev`.** Playwright mints per-run mTLS certs and owns its dev server, so a curl pre-warm is impossible. Use `--retries=1`, which matches CI.
- **The worktree-isolation guard refuses compound `git`, inline `$(...)` and multi-statement subshells.** Every Verification block was split into discrete commands.
- **The context-constitution refresh skill was not invocable.** 7 files were reconciled by hand: the `GetBars` warm clause and portfolio's Dependencies row drifted.

**Permanent deviations**:
- **Warm-set invariant wording.**
  - Design: "gate at warm-add sites only; warm-set readers are never filtered".
  - Shipped: MARKETDATA-16 uses feature 291's narrowed wording ("No reader filters the warm set by servability; the bar ingester may leave a symbol out of a cycle's vendor request because of 291 hold state…").
  - Because: operator cross-feature sign-off with 291 (2026-11-04).
  - Residual: the code comment in `services/xstockstrat-marketdata/internal/service/asset_servability.go` (`markWarmIfServable` doc) still has the superseded wording.
- **Portfolio refusal helper.**
  - Design: `servabilityFor(ctx, symbols) (refused, ok)`.
  - Shipped: `refuseUnservable(ctx, bindings)`, which partitions bindings and keeps each binding's `Source` and `StrategyId`.
  - Because: it fixes a name drift, and filtering bindings rather than symbols keeps SIGNAL provenance.
- **Step 5 migration check.**
  - Design: Step 5 asserts migrations 035/036/037 are present.
  - Shipped: requires only 281's 037.
  - Because: the 2026-11-04 ruling that feature 280 renumbers at its own merge.
- **Marketdata step split.** Design had the service and its tests as separate steps; they shipped as one commit (see Scars).
- **AC-16 testing.** Design tested it by behaviour on all three ungated paths. It shipped behavioural for `GetLatestQuotes` and structural for the other two (see Scars).

**Cross-feature signal**:
- **Feature 291 is the per-symbol negative cache that 282 scoped out.** It addresses re-warmed held unservable symbols producing ingester no-bars noise. 291 has landed. `markWarm` / `markWarmIfServable` must never consult 291 hold state, or the quote path starves (282 AC-16/17/26).
- **Feature 296 made keys namespace-relative.** The 038/039 migration header comments, which say the stored key "must equal the full-dotted string GetInt reads", are stale. Readers now use relative keys, and 041/044 healed the rows.
- **Feature 281 is hard-coupled.** 282's `AddWatchlistSymbols` runs in EREA order around 281's `expiryIntentFor`, so 282's run was gated on 281's integration PR (Variant L). 282 also converted 281's 037 seed test to the shared `globalIntSeedCases.ts`.
- **Features 280/281/282 raced for config migration numbers 035–039.** 282 renumbered once (036/037 → 038/039).
- **Constitution IDs also collided.** The design reserved PORTFOLIO-18 / MARKETDATA-15, but 281 took PORTFOLIO-18, and they shipped as MARKETDATA-16 / PORTFOLIO-19. The Step 17 greps were vacuous until a re-spec.

**Deferred follow-ons**:
- **Signed-off C-16 edits never written to the durable suites. RESOLVED 2026-11-10** (operator choice: supersession comments, scenarios left unedited) in `mcp-watchlist-tools.feature` (148 @AC-5), `platform.feature` (127 @AC-1) and `offline-account-full-pnl.feature` (240 @AC-53/54). The original finding follows.
  - The CHANGEs to `@AC-5 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) and `@AC-1 @feature-127` (`docs/sdd/business-rules/platform.feature`) need the servable-symbol qualifier, or a supersession comment block in the 302 style.
  - The R4 pin on `@AC-53/@AC-54 @feature-240` (`services/xstockstrat-marketdata/acceptance/offline-account-full-pnl.feature`: ZZZZ servable in a loaded set) is also unwritten.
  - The planned EXTENDs were skipped too: f148 AC-4/7, f170 AC-7/10, f127 AC-5 and the f182/f184 seeds.
  - Until fixed, these scenarios read as contradicted by shipped code.
- **R6: Alpaca credentials missing or bad.** The asset set then stays permanently unloaded: every symbol reads servable, and the only signal is the single never-loaded WARN.
- **R8: today-closed fills.** A fill of an unservable symbol closed today has no previous close, so `BatchGetLatestPrice` omits it (AC-13).
- **Existing ledger entry citation.** The fails.md 2026-11-02 filter-otc-symbols config entry citing 282's `implementation-spec.md` Step 5 Verification block 4 resolves via `git show 2d91b567:docs/roadmap/features/282-filter-otc-symbols/implementation-spec.md`.
- **R9 never verified.** Alpaca's live `exchange`, `tradable` and presence values for CRTD/BOSSY/FORL/CERO/DNB were never checked with live credentials, so the ACs stay reason-agnostic.
- **Staging cleanup caveat.** The 8 Webull-non-tradable-only removals (GCTK, ELAB, YYAI, LPSN, NATH, SLP, WEAV, RIV) were not checked against Alpaca `status`/`tradable`.
- **Stale code comment.** Reconcile the `asset_servability.go` comment with the MARKETDATA-16 / 291 wording.
- **Stale docstring.** The `useUpdateWatchlist` docstring (`services/xstockstrat-ui/src/hooks/useWatchlists.ts`) still says name and binding edits "MUST omit `updateMask`", which the masked rename now contradicts.
- **Baseline UI failures.** UI `tsc --noEmit` fails at `e2e/insights/backfills.spec.ts:135-136`, and 7 files fail `format:check`. CI runs no UI `tsc`.
- **Latent renumber flaw in feature 281.** Step 11 Instr 9 hard-codes numbers in shell blocks; left as a follow-up.
- **R1 residual.** Broker/IBKR holdings that portfolio does not quote are not warmed by the opportunity paths. For never-stored symbols there is a Monday 48 h `minIngestLookback` window miss.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-10 entries. Duplicates of existing entries were skipped (migration-number race, stale digests, inert hook, jscpd test ignore, retroactive RED, `--final --json` hit identity).

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT, analysis↔marketdata.** `BatchGetLatestPrice` may return `prev_close` with `last_price` unset for a symbol it will not trade-fetch. Analysis must keep `HasField("last_price")` and never memoize a missing price. This contract lived only in design.md.
- **MARKETDATA, singleflight key.** The `BatchGetLatestPrice` singleflight key covers the full request, including unservable symbols; only the trade fetch is filtered. Guarded only by `TestBatchGetLatestPrice_AC13_FlightKeyCoversUnservable`.
- **MARKETDATA, `<= 0` pause keys.** A key with `<= 0`-pauses semantics is read with a direct `GetInt`, not `resolvePositiveInt`. With a SetConfig minimum ≥ 1, the pause is reachable only by a direct DB write.
- **MARKETDATA, source-scan tests.** `GetLatestQuote`, `GetLatestPrice` and `GetBars` read the concrete repo, so their gate status is pinned only by source-scan tests (`TestGetBarsMarksSymbolWarm`, `TestQuoteAndPricePaths_AC16_StayOnUngatedMarkWarm`).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-02 — sdd-design amendment (quick), round 1 — operator decisions and synthesis

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

### Session 2026-11-04 — cross-feature sign-off from feature 291 (fix-marketdata-dead-symbol-ingest)

- Operator decision (2026-11-04, recorded here and in 291's context.md): this feature's invariant "the gate applies at warm-add sites only; warm-set readers are never filtered" (`design.md:24`, `:42`) is narrowed to: *"No reader filters the warm set by servability. The bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 no-bars hold state, and never removes it from the warm set. Quote/price readers are never filtered."* When 282's constitution text lands it must use this wording.
- Feature 291 is the per-symbol negative cache that `design.md:48` put out of scope; it does not change 282's scope. 282 R6 (`design.md:59`, ingester no-bars noise from re-warmed held unservable symbols) is **addressed by 291**.
- Shared region: `markWarm` (`marketdata_service.go:1089-1096`) and the GetBars/batch warm-add sites. 291 does not edit them; whichever lands second keeps any new-add hold-state delete inside `markWarmIfServable`. `merge-order.md` row added (independent, rebase-only).

_From: Session 2026-11-01 — sdd-design round 1 gate (operator answers)_

- C-16 sign-off (explicit, operator): CHANGE `@AC-5 @feature-148` (name-only agent/replace-all update now refuses and drops already-stored unservable symbols, refusal reported) and CHANGE `@AC-1 @feature-127` platform rule (a watchlist-direction signal for an unservable symbol is not added). Both promoted at launch with a servable-symbol qualifier.

_From: Session 2026-11-01 — sdd-design (completion)_

- C-16: CHANGE `@AC-5 f148` and platform `@AC-1 f127` (signed off round 1); EXTEND `@AC-53/54 f240` (operator, R4 dissent recorded).
