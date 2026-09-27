# Context: edgar-fundamentals-enrichment

**Feature**: `docs/roadmap/features/211-edgar-fundamentals-enrichment/feature.md`
**Product Spec**: `docs/roadmap/features/211-edgar-fundamentals-enrichment/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/211-edgar-fundamentals-enrichment/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.
- Origin: investigation of a BABA/AXP backtest-vs-live divergence on `fundamentals_macd_blend`. Root cause
  established from code + live data: EDGAR PIT fundamentals use total-liabilities D/E (~4.64 BABA), hardcode
  currency to USD (discarding the XBRL unit key — CNY ADR magnitudes corrupted), and never populate P/B or
  dividend yield; the live snapshot (Finnhub/FMP) uses financial-debt D/E (~0.25) + market P/B + TTM ROE.
  The seeded `fundamentals_value_quality` bands (`de_bad=2.0`, `pb_bad=5.0`) assume the financial-debt
  convention, so PIT composite ≈ 0.35 vs live ≈ 0.70 for the same symbol — a source/methodology mismatch,
  not a real fundamentals change.

- **Recon already performed (three read-only discovery passes) — key grounding for /sdd-design:**
  - EDGAR path is `internal/edgar/edgar_client.go` (`Client.FetchHistorical`), consuming the SEC XBRL
    **companyfacts** API. Tag allow-list at `edgar_client.go:156-170` captures NetIncomeLoss, Revenues,
    EPS diluted/basic, StockholdersEquity, Liabilities, Assets, shares. **Debt line items are NOT in the
    allow-list and are discarded** (`edgar_client.go:219` drops untracked tags despite a doc comment
    claiming they spill to extra_metrics). `debt_to_equity = liabilities/equity` (`:341-346`);
    `roe = net_income/ending equity` (`:335-339`). Currency hardcoded `"USD"` (`:317`); XBRL unit key
    iterated but dropped (`:222`).
  - `priceJoin` (`marketdata_service.go:1630-1668`) already sets Price, MarketCap = close×shares,
    PERatio = close/ttmEPS — so price-at-filing is already available; P/B = market_cap/equity is derivable
    now (once currency is consistent). A `ratioEnricher` interface seam exists (`marketdata_service.go:115-117`),
    nil in v1, cap-guarded, with tests — its own comment warns TTM ratio sources are a look-ahead risk for
    PIT, which is exactly why D/E must come from the filing (expand tags) and P/B from price-at-filing.
  - Storage: two tables. Snapshot `marketdata.fundamentals` (migration 002, PK = symbol). Historical
    `marketdata.fundamentals_history` (migration 005, PK = (symbol, fiscal_period, period_type),
    ON CONFLICT DO NOTHING). **Both already have `source` and `currency` columns and pb_ratio/
    dividend_yield/debt_to_equity metric columns.** No convention/units column beyond `currency`.
  - Providers: `source.FundamentalsSource` (snapshot; FMP + Finnhub impls) selected by
    `marketdata.fundamentals.provider` (read once at boot, `main.go:124/195`). `HistoricalFundamentalsSource`
    (EDGAR only, never through the selector). Backfill: ingest servicer → `BackfillFundamentals`
    (`marketdata_service.go:1557`) → `backfillOneSymbol` → EDGAR fetch → priceJoin → optional ratioEnricher
    → `InsertHistoricalFundamentals`. Serving: `GetHistoricalFundamentals` + `filterAsOf` (`filed_date <
    as_of`, T+1); `GetFundamentalsMulti` (snapshot, cache/quota). No RPC literally named QueryFundamentals.
  - **No historical dividend-payment feed exists** — the only "dividend" reference in marketdata core is
    Alpaca's OHLCV *adjustment mode*. Snapshot `dividend_yield` is a current-only vendor field. PIT dividend
    yield needs a new feed (chosen: Alpaca corporate-actions).
  - Data Explorer already exists at `/insights/data-explorer` (feature 204), shows OHLCV + snapshot +
    historical fundamentals via `GetBars`/`GetFundamentals`/`GetHistoricalFundamentals`. A single
    `FUNDAMENTAL_METRICS` array (`useDataExplorer.ts:39`) drives tables + chart selector + CSV — new metrics
    surface almost for free. `missing_metrics` is authoritative (a listed name renders "—").

- **Operator decisions (AskUserQuestion, 2026-09-25):**
  1. **Data model** = EDGAR-canonical + price-join for BOTH snapshot and PIT. **Disable FMP/Finnhub by
     config** (their `enabled` keys), NOT code deletion — code cleanup is an explicit **follow-up feature**.
     Snapshot path must be rebuilt to serve latest EDGAR filing + live price-join.
  2. **Dividend yield** = add a PIT dividend feed now (Alpaca corporate-actions — no new *fundamentals*
     vendor, since Alpaca is already the OHLCV provider).
  3. **Currency bug** = folded into this feature as a prerequisite (FR-1).
  - This overrides the earlier "consider a premium provider" framing: EDGAR + existing price-join covers
    D/E and P/B with no new fundamentals vendor; only the dividend feed is added (via Alpaca).
  - C-14 override recorded: FMP/Finnhub client *code deletion* is deferred to a named follow-up feature;
    this feature disables them by config only.

- **Ledger traps folded into product-spec Open Questions:**
  - fails.md 2026-08-13 (feature 129, ×2): provider-disable must audit every `marketdata.fmp.*`/
    `marketdata.finnhub.*` literal read + provider-named string so EDGAR-canonical is the ACTIVE path, not a
    fallthrough-to-false (FR-8); and do NOT spec a fragile full-stack `grpcurl` verification — use the
    narrowest direct external-API check + fake-backed unit tests.
  - fails.md 2026-08-06 (backtest-debug-info): use real `marketdata_pb2.Bar` (`bar.time`) fixtures, never
    MagicMock, in any price-join/analysis test.

- Next: `/sdd-review edgar-fundamentals-enrichment product-spec`, then `/sdd-design edgar-fundamentals-enrichment`.

## Session 2026-09-25 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass FAILed on criterion #9 (Open Questions had 6 unchecked `- [ ]` items) + advisory
  WARNING on #7 (migration convention unpinned). Fix: recategorized the section — the 3 known-traps
  became "binding constraints" and the design mechanics became "Design forks routed to /sdd-design"
  (no checkbox items); pinned the dividend migration as `006_*.up.sql/.down.sql` via `scripts/db-migrate.sh`
  (C-07). Re-review: PASS (0 failures, 0 warnings). No product-level ambiguity was ever present — the
  forks are HOW-questions for design.
- Warnings: none (after fix).
- Overlap findings: CLEAN. Key trunk fact — feature 198 (launched) owns `marketdata.fundamentals.provider`,
  so 207 EXTENDS that selector (add `edgar`) rather than declaring a new key; next marketdata migration is `006`.

## Session 2026-09-26 — sdd-design

- Phase 0 Recon: wrote recon.md (services: marketdata/ui/config/indicators/analysis + proto/agent surface).
  Key reuse patterns: existing `priceJoin` for P/B, the `ratioEnricher` seam, the write-through
  `marketdata.fundamentals` cache chokepoint, `GetHistoricalFundamentals`+`filterAsOf` as the snapshot read,
  the `GetSecret` credential path, the single `FUNDAMENTAL_METRICS` UI registry. Confirmed analysis +
  indicators need NO code change (pure passthrough; tunable formula params).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: EDGAR-canonical for both snapshot + PIT via a
  live-read `marketdata.fundamentals.snapshot_source` axis dispatched on BOTH fundamentals RPCs, EDGAR
  snapshot = latest filing + live price-join write-through the existing cache with source-aware
  invalidation; unit-aware aggregator + currency capture; financial-debt D/E; option-b P/B & P/E
  (USD-unit fact preferred, else missing); Alpaca corporate-actions PIT dividend feed; a real
  `marketdata.edgar.enabled` kill switch; migrate→backfill→verify-coverage→live-flip→disable-vendors-last
  rollout. Rejected: overloading `provider` with edgar; PIT-only (Y) split (fails @AC-9 on ROE convention);
  P/B option (a) sole / option (c) FX feed; keyless gate; uncached snapshot; boot-bound cutover.
- **Operator decisions (AskUserQuestion, 2026-09-25/26):** (1) dedicated `snapshot_source` axis (NOT overload
  `provider`); (2) P/B/P/E option-b (prefer USD-unit fact, else missing). Both recorded in design.md.
- **CHANGE sign-offs (C-16):** (a) repointing the snapshot lane at EDGAR alters the feature-198 "provider
  never takes edgar / EDGAR is a separate PIT lane" doc contract — signed off @ 2026-09-26; new marketdata
  acceptance coverage authored to close the blind spot. (b) "stop hardcoding USD" currency-semantics change
  — signed off @ 2026-09-26; absolute fields must never be cross-currency aggregated by consumers.
- **Scope crux (round 4):** full EDGAR-canonical is REQUIRED, not optional — a PIT-only fix leaves the ROE
  convention split (EDGAR ending-equity ~52% vs vendor TTM ~7% for BABA), which alone re-opens the @AC-9
  composite divergence. This is why the vendor snapshot must be repointed, not just the PIT ingester fixed.
- Constitution rules touched: C-04,C-05,C-07,C-08,C-10(b),C-13,C-14,C-15,C-17,C-18; F-01,F-04,F-06,F-07.
  Floor breaches: none across 4 rounds.
- Status: spec-ready → design-approved.

### Open Threads (carried from design.md Open Risks → target /sdd-spec)
- [ ] XBRL tag/USD-fact coverage — direct SEC companyfacts fetch (BABA/AXP/plain US) FIRST; corrects
  @AC-2/3/4/9 wording with sign-off if facts absent.
- [ ] Alpaca corporate-actions entitlement — direct-API check; gates FR-4/@AC-5 only; descope with sign-off
  if unentitled (never a silent @AC-5 pass).
- [ ] `source` column reliability for cache self-heal — verify schema + UpsertFundamentals; fallback = one-time purge.
- [ ] Active-universe enumeration for the coverage gate — name the concrete query (narrow direct check).
- [ ] Snapshot `as_of` semantics (@AC-12) — confirm "Last refreshed" contract.
- [ ] Cross-currency consumer audit — fundsignal scorer, screener (feature-060), market-cap/revenue filters.

- Next: `/sdd-spec edgar-fundamentals-enrichment`.

## Session 2026-09-26 — sdd-spec

- Generated implementation-spec.md with **16 steps**. Status → `implementation-ready`.
- Consumed recon.md + design.md as authoritative inputs; recon's path:line citations re-verified
  against the current tree (all accurate — e.g. `fundamentalsEnabled():1381`, `priceJoin:1630`,
  `resolveFundamentals:1347`, repo `src==""→"fmp":494-497`; note marketdata CLAUDE.md's stale
  `:1143` for fundamentalsEnabled was NOT used — live code is `:1381`).
- **Design Open Risk 1 RESOLVED at spec time via a direct SEC companyfacts fetch** (BABA CIK
  0001577552, AXP 0000004962, AAPL 0000320193; `data.sec.gov/api/xbrl/companyfacts`, 2026-09-26) —
  the narrow direct check the design mandated (never a `grpcurl` smoke, fails.md 2026-08-13). Findings:
  - **All three filers — including the BABA ADR — report under `us-gaap`, NOT IFRS.** The design's
    `ifrs-full:*` allow-list is **unnecessary for the acceptance filers**; the spec omits it (C-18/YAGNI).
    **Design-correction requiring awareness** (recorded here per P-03): design point 2's IFRS branch is
    dropped; a future non-us-gaap filer is a separate feature.
  - **Grounded us-gaap debt tag set** (corrects the design's guess): `LongTermDebtNoncurrent`,
    `LongTermDebtCurrent`, `LongTermDebt` (combined fallback), `DebtCurrent`, `ShortTermBorrowings`,
    `CommercialPaper`, `ConvertibleDebtNoncurrent`. Summation = `(Noncurrent+Current) else LongTermDebt`
    `+ ShortTermBorrowings + DebtCurrent + CommercialPaper + ConvertibleDebtNoncurrent` (no double-count).
    Verified: AAPL D/E≈1.34, AXP≈1.73 (<de_bad=2.0, @AC-3 ✓), BABA FY2026≈0.05.
  - **BABA's only recent financial-debt tag is `ConvertibleDebtNoncurrent`** (USD 8,098M; DebtCurrent/
    ShortTermBorrowings stopped after FY2018/FY2019) — the design's list would have MISSED it. Now included.
  - **BABA dual-reports StockholdersEquity in CNY (1,060,886M) AND USD (153,796M)** → option-b P/B works
    (@AC-4 ✓); the unit-keyed aggregator stashes `stockholders_equity_usd` for the price-join.
- **@AC-2 wording needs operator sign-off correction (C-15/P-03):** its illustrative figures are stale
  (real BABA FY2026 financial debt ≈8,098M USD / D/E≈0.05, Liabilities USD 113,555M not 714,121M); the
  load-bearing "financial-debt D/E ≪ de_bad=2.0, not ~4.6" holds. Recorded in the spec's
  § Acceptance-wording corrections; to be applied at /sdd-execute Step 5 as a wording edit (no renumber).
- **Design Open Risk 2 (Alpaca corporate-actions entitlement) NOT verifiable here** (no Alpaca creds in
  session) — narrowed to the FIRST action of Step 8 (a direct `GET data.alpaca.markets/v1/corporate-actions`
  in isolation); if unentitled, FR-4/@AC-5 descoped with sign-off (never a silent @AC-5 pass). Symmetric-
  missing dividend preserves @AC-9.
- **FR-6 real finding:** `FUNDAMENTAL_METRICS` (`useDataExplorer.ts:39`) **already** contains pb_ratio/
  dividend_yield/debt_to_equity (feature 204) — so FR-6's UI work is currency+source provenance rendering
  + CSV columns + a USD-basis hint, NOT re-adding the metrics. Spec'd accordingly (Step 13).
- **C-14 surfaces:** UI reached by Steps 13/14; Agent `query_fundamentals` is passthrough (no proto field
  added → agent descriptor-parity projection test can't break, fails.md 134) — no step, restated as a
  decision in Execution Summary. No `strat-lab` plugin update owed (its skill's tools unchanged).
- **Migrations confirmed next-free:** marketdata `006` (tip `005_fundamentals_history`); config `030`
  (tip `029_heal_config_keys_full_dotted`; the pre-existing `024` gap is NOT backfilled).
- **Proto: no change** — Fundamentals (pb_ratio=4, dividend_yield=5, debt_to_equity=9, currency=15,
  source=16) + HistoricalFundamentalsPeriod (…currency=19, source=20, missing_metrics=21) all exist.
- **No new env var/port** — Alpaca creds via GetSecret; EDGAR keyless — so no docker-compose/.do edits.
- Config seed shape grounded on migration `028` (post-147: columns + `ON CONFLICT (namespace,key,
  environment,COALESCE(user_id,'')) DO NOTHING`, full-dotted keys, staging+production rows).

### Open Threads (carried to /sdd-review impl-spec → /sdd-execute)
- [ ] @AC-2 wording correction — apply at execute Step 5 with operator sign-off (figures stale, direction holds).
- [ ] Alpaca corporate-actions entitlement — verify first thing in Step 8; descope FR-4/@AC-5 with sign-off if unentitled.
- [ ] `dividends.enabled` seeded `false` (conservative) — design fork resolved; flip on at rollout after entitlement confirmed.
- [ ] `source` column reliability for source-aware cache self-heal — verify at Step 10; one-time purge is the recorded fallback.
- [ ] Active-universe enumeration for the rollout coverage gate — name the concrete query at rollout (narrow direct check).
- [ ] Snapshot `as_of`/"Last refreshed" semantics (@AC-12 @feature-204) — confirm at execute for the EDGAR snapshot (filing date + live-price timestamp mix).

- Next: `/sdd-review edgar-fundamentals-enrichment impl-spec`.

## Session 2026-09-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 5 warnings (advisory — did not block). No Floor breaches; all cited path:line verified; every service step paired red-before-green (C-08/P-06); all 9 @AC-* covered (C-15); migrations next-free (marketdata 006, config 030).
- Unresolved ⚠ / notes carried into execution:
  - Step 5: `@AC-2` illustrative figures are stale — record operator sign-off for the wording edit (BABA FY2026 financial debt ≈ 8,098M USD / D/E ≈ 0.05; Liabilities USD 113,555M), no renumber, before the step lands (C-15/P-03) — [ ] unaddressed
  - Step 8: Alpaca corporate-actions entitlement unverified this session — the entitlement check is the FIRST action of Step 8; if unentitled, descope FR-4/@AC-5 with operator sign-off (never a silent @AC-5 pass) (P-03) — [ ] unaddressed
  - Step 8: add a one-line "IBKR N/A: market-data corporate actions are Alpaca-only" broker-symmetry note (B2b) — [ ] unaddressed
  - Steps 7 / 11 / 15: no coverage-threshold assertion — justified (internal/service + cmd are CI-excluded coverage packages; Step 15 is Gherkin durable-suite authoring; backing asserts live in Steps 3/5/9). C-08 discipline note only — [ ] unaddressed
  - Step 10: reads five config keys seeded later by Step 12 — mitigated by explicit in-code defaults (edgar.enabled=true, snapshot_source=vendor) + zero-value-watcher tests; B3 deploy-ordering note (migrate → rolling restart → live-flip → disable vendors last) — [ ] unaddressed
- Overlap findings: CLEAN (marketdata 006 / config 030 next-free; the five new keys unique; finnhub/fmp .enabled flips are UPDATEs to existing rows; no in-flight feature co-edits any touched file).
- Note (C-14): agent `query_fundamentals` is a documented no-op passthrough (currency/source/metrics already returned; no proto field added) — verified, not a stale-surface gap.

## Session 2026-09-26 — Alpaca corporate-actions docs research (Step 8 open-thread update)

Resolved most of the Step-8 open thread from Alpaca's official API docs (docs.alpaca.markets),
without a live call:
- **Endpoint confirmed**: `GET /v1/corporate-actions` on `https://data.alpaca.markets` — the SAME
  market-data host `internal/alpaca/client.go` already authenticates to for bars/quotes, so the
  existing `GetSecret` `marketdata.alpaca.api_key`/`api_secret` credentials apply (feature-147 path
  intact).
- **Cash-dividend record fields** map cleanly to the migration-006 `dividend_actions` columns:
  `symbol`, `rate` (per-share → `cash_amount`), `ex_date`, `record_date`, `payable_date` (→ `pay_date`),
  `currency` (ISO 4217), plus `special`/`foreign` flags and `sub_type` (interest/return_of_capital).
- **Pagination/range**: `start`, `end` (YYYY-MM-DD), `limit` ≤ 1000, `page_token` — covers the T12M
  window and the `backfill_lookback_years` range.
- **Currency**: explicit `currency` field + `foreign` boolean ("empty ⇒ USD") — directly implements the
  option-b guard: US-ADR dividend is USD (or empty=USD) so `dividend_yield = USD div / USD price` is
  consistent; a record whose `currency` ≠ trading currency → `dividend_yield` missing (never FX-fabricated).
- **Entitlement**: the plans page gates the free/Basic tier only on real-time SIP quotes/bars
  (IEX-only, 15-min-delayed historical **pricing**); it does NOT tier corporate-actions/reference data.
  Corporate actions is reference data, not SIP pricing → very likely available on the current plan.

**Updated Step-8 posture:** FR-4/@AC-5 is planned as **IN SCOPE** (build, not descope). The endpoint,
fields, pagination, and currency semantics are docs-confirmed; the only residual is a single live
direct-API call at the start of Step 8 to confirm a 200 (not 403) for the exact configured key/plan
(narrow check, not a full-stack grpcurl smoke — fails.md 2026-08-13). The descope-with-sign-off path
is retained ONLY as the fallback if that one call returns 403. Real-world note: BABA paid no dividend
until its first-ever USD distribution in 2024, so older PIT periods legitimately compute
`dividend_yield = 0` (feed responded, no payments) and recent ones carry a real USD figure — the
0-vs-missing distinction Step 8 must honor.

- The corresponding "Step 8: Alpaca corporate-actions entitlement unverified" item above is now
  **docs-confirmed; live 403-check only** (not yet [x] — the one live call lands at execute).

## Session 2026-09-26 — numbering-collision renumber (207 → 211)

- **Collision**: PR #1186 (this feature, `feat(207): EDGAR fundamentals enrichment`, main-dev commit
  5472f45) and PR #1185 (Phase D security backlog features 207–210, main-dev commit 6176909) BOTH
  merged to main-dev on `207` — main-dev ended up with two `207-` dirs.
- **Resolution** (feature-workflow § Feature Numbering; operator-approved 2026-09-26): this feature
  renumbers to the next free number **211**; the security block keeps its contiguous 207–210. Chosen
  because moving a single dir is lower-disruption than renumbering the 4-feature security batch.
- **Mechanics**: branch restarted from origin/main-dev (PR #1186 already merged → fresh change per the
  branch rules), `git mv 207-edgar-fundamentals-enrichment → 211-edgar-fundamentals-enrichment`,
  self-referential paths updated in context.md + implementation-spec.md, and the ledger insights.md
  entry's path updated 207→211. No CHANGELOG/merge-order citations existed. Branch name unchanged
  (`claude/fundamentals-strategy-fscore-j3oshc`); a NEW PR replaces the merged #1186.
- Lifecycle status unchanged: `implementation-ready`. Resume with `/sdd-execute edgar-fundamentals-enrichment sequential`.

---

## Session 2026-09-26 — sdd-review impl-spec (advisory)

- Result: 2 failures (same `feature-207` mislabel, Steps 15 & 16) + 4 warnings/notes. No Floor breach. Overlap: one soft, disjoint-region file overlap with feature 196 on `internal/repository/marketdata_repo.go` — rebase-only, MOOT on the single branch. Migrations `marketdata/006`, `config/030` next-free; 5 config keys unclaimed; no proto field change.
- Items carried into execution:
  - Steps 13/15/16: [x] `@feature-207`/"feature 207" → **211** FIXED (lines 601, 633). Grep confirmed no other `207` occurrences (the `:173-207` at line 358 is a range, not a feature number; Step 13 correctly cites feature 204). This corruption of C-16 business-rule traceability is resolved.
  - Step 8: [x] added explicit "broker symmetry N/A — marketdata is Alpaca-only for market data; corporate-actions has no IBKR lane" note (B2b).
  - Steps 7/11: [x] no explicit Go coverage threshold — `internal/service`/`cmd` are CI-coverage-excluded; the 40% gate is asserted at Steps 5 & 9 over `internal/edgar`/`internal/alpaca`. Justified, no action.
  - Step 12: config seed (030) sequenced after its reader (Step 10) — default-safe reads (`GetBool(...,default)`), so no build/test inversion; optional reorder only. No action.
  - Open Risk 1 (@AC-2): [ ] XBRL debt-tag **wording correction** to the existing `@AC-2` block (not a renumber) requires **operator sign-off recorded here** at the start of `/sdd-execute` Step 5. PENDING.
  - Open Risk 2 (@AC-5): [ ] Alpaca corporate-actions **entitlement** is the first action of Step 8 (direct `GET /v1/corporate-actions` probe). If unentitled → STOP, escalate, descope FR-4/@AC-5 with sign-off; FR-1/2/3/5/6/8 proceed. PENDING (not verifiable pre-execution — no Alpaca creds this session).

---

## Session 2026-09-26 — sdd-execute (sequential; single-branch adaptation) — START

Executing on `claude/pending-roadmap-features-9z01mn`; integration via shared PR #1191. Toolchain: Go 1.27.0 ✓, uv 0.8.17 ✓, UI deps present. Migration NNNs validated next-free (marketdata 006, config 030).

### Operator decisions carried into this run
- **@AC-5 / Alpaca dividend feed (Step 8 blocker resolution):** the live entitlement probe cannot run here (no Alpaca creds; `GetSecret` needs a running config service + DB; no egress to `data.alpaca.markets`). **User decision:** *write* Steps 8–9 code with **graceful fallback** for when Alpaca returns no/absent dividend data, plus an **auditable log line** so operators can see when the feed was unavailable; unit tests use **fake dividend sources** (no live call). The live @AC-5 entitlement claim remains **unverified in this env** — flagged for a creds-bearing environment to confirm. `dividend_yield` degrades to nil→"—" when the feed is absent/disabled/unentitled (symmetric-missing preserves @AC-9).
- **@AC-2 (Step 5):** the corrected XBRL debt-tag figures need operator sign-off — will pause at Step 5 (blocker).

### Step 1 — migration: dividend_actions store [done]
- Created `migrations/006_dividend_actions.{up,down}.sql` — plain table `marketdata.dividend_actions` (symbol, ex_date PK; pay_date, cash_amount, currency, source, fetched_at). Verified offline: up CREATE ↔ down DROP; NNN=006 next-free. No DB started (offline migration rule).
- Files: `services/xstockstrat-marketdata/migrations/006_dividend_actions.up.sql`, `.down.sql`
- Deviations: none.

### Step 2 — service: currency capture + unit-aware EDGAR aggregator [done]
- Reshaped `periodAgg.vals` to `map[metric]map[unit]float64` (unit-keyed, first-seen-per-(metric,unit)); captured the XBRL unit key at the `entry.Units` loop; added `voteCurrency` (most monetary facts, per-share/shares excluded, lexical tiebreak → CNY), `valIn`/`valAny` helpers. `buildPeriod` now sets `Currency` from the vote, reads absolute facts in native currency, and stashes `stockholders_equity_usd` for Step 6.
- Files: `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`

### Step 3 — test: currency-capture unit tests (@AC-1) [done]
- Added 3 tests: dual-currency CNY row (@AC-1, + native/USD-equity extras), USD-only regression, re-backfill determinism. `go test ./internal/edgar/...` green (all existing edgar tests still pass — aggregator refactor caused no regression). Lint via `go vet` + `gofmt` (golangci-lint fallback — see Deviation Log).
- Files: `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go`
- Deviations: golangci-lint→go vet/gofmt CI-equivalent fallback (Deviation Log). Red-before-green: the CNY-currency assertion is definitionally red against the pre-Step-2 hardcoded `Currency: "USD"` (old path returned "USD" unconditionally).

### @AC-2 acceptance-wording sign-off (Step 5 gate)
- **User signed off** on correcting @AC-2 to the **real FY2026 figures** (option "Real FY2026 numbers"). Edited the existing @AC-2 block (not a renumber, C-15): StockholdersEquity 153,796M USD / 1,060,886M CNY; total Liabilities 113,555M USD; financial debt = ConvertibleDebtNoncurrent ~8,098M USD → financial-debt D/E ~0.05 (vs the ~0.74 total-liabilities ratio); well below de_bad=2.0. Short/long-term borrowings ceased after FY2018/FY2019. @AC-3 (AXP) and @AC-4 (BABA dual-report) unchanged (validated as written).

### Step 4 — service: financial-debt D/E tag allow-list + summation (FR-2) [done]
- Extended `instantTags` with 7 us-gaap debt concepts (LongTermDebtNoncurrent/Current/LongTermDebt/DebtCurrent/ShortTermBorrowings/CommercialPaper/ConvertibleDebtNoncurrent); IFRS omitted (all filers us-gaap — Deviation Log). `buildPeriod` computes `total_debt` no-double-count (LTD noncurrent+current when either present, else aggregate LongTermDebt; + short-term/current/CP/convertible), replaces `liabilities/equity` D/E with `total_debt/equity` (native currency), stores `total_debt` in ExtraMetrics; leaves DebtToEquity nil when no debt tag present.
- Files: `services/xstockstrat-marketdata/internal/edgar/edgar_client.go`

### Step 5 — test: financial-debt D/E unit tests (@AC-2, @AC-3) [done]
- @AC-2 wording corrected to real FY2026 figures (signed off, above). Added tests: BABA financial-debt D/E ~0.053 (@AC-2), AXP ~1.73 < de_bad 2.0 non-zero (@AC-3), AAPL no-double-count total_debt=98,657M (~1.34), no-debt-tag→nil. `go test ./internal/edgar/...` green; vet + gofmt clean.
- Files: `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go`, `docs/roadmap/features/211-edgar-fundamentals-enrichment/acceptance.feature`
- Deviations: golangci-lint→go vet/gofmt fallback (Deviation Log).

## Session 2026-09-26 — sdd-execute (211 progress checkpoint after Step 5)
**Steps this session**: 1, 2, 3, 4, 5 (all done, committed + pushed, edgar suite green)
**Progress**: 5 done / 16 total
**Committed**: 5c7b151 (step1 migration) · 005cfc1 (steps2-3 currency) · 764c828 (steps4-5 D/E)
**Gates cleared**: @AC-2 wording sign-off (real FY2026 figures) recorded above.
**Remaining (6–16)**: Step 6/7 currency-consistent P/B + P/E fix in `priceJoin` (marketdata_service.go:1630) + tests; Step 8/9 Alpaca dividend feed (client.go) + repo UpsertDividends/SumDividendsInWindow (marketdata_repo.go) + T12M yield, **with @AC-5 fallback+audit-log per operator decision** (no live entitlement here; fake-source tests); Step 10/11 EDGAR-canonical snapshot dispatch + FR-8 disable-safety (marketdata_service.go GetFundamentals ~1268) + tests; Step 12 config seed migration `030_marketdata_edgar_snapshot_keys` (5 keys); Step 13/14 UI data-explorer currency/source/CSV + Playwright; Step 15 marketdata acceptance suite (@feature-211, C-16); Step 16 docs (CLAUDE.md config keys + design-correction) + teardown.
**Resume**: `/sdd-execute 211-edgar-fundamentals-enrichment sequential` (or `next`) — re-reads this context. Shared branch `claude/pending-roadmap-features-9z01mn`, integration PR #1191.
**Next**: Step 6 (priceJoin P/B — uses `stockholders_equity_usd` stashed in Step 2 for currency-consistent market_cap/equity).

### Step 6 — service: currency-consistent P/B + P/E fix (FR-3, FR-7) [done]
- In `priceJoin` (marketdata_service.go): P/B = USD market_cap / USD equity — prefer `ExtraMetrics["stockholders_equity_usd"]` (dual-report filer), else native equity when Currency==USD, else nil (no FX). P/E now guarded to Currency==USD (USD close / USD native EPS), else nil.
- Files: `services/xstockstrat-marketdata/internal/service/marketdata_service.go`
- Deviation: the spec's "use USD-unit EPS when present for a non-USD filer" P/E branch is narrowed to nil-when-non-USD, because Step 2 stashed only stockholders_equity_usd (not eps_usd); this stays within Step 6's marketdata_service.go file scope and is honest (no FX). A future eps_usd stash could enable non-USD P/E. Recorded in Deviation Log.

### Step 7 — test: PIT P/B unit tests, no look-ahead (@AC-4) [done]
- Added priceJoin tests (fake histRepo): P/B from USD equity + no-look-ahead (only filed_date queried) (@AC-4), P/B nil when non-USD filer lacks USD equity, P/E USD-only currency rule. `go test ./internal/service/...` green; vet + gofmt clean.
- Files: `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go`

### Step 8 — service: Alpaca corporate-actions dividend feed + PIT T12M yield (FR-4, FR-7) [done]
- **@AC-5 live-entitlement disposition (operator decision, P-03):** the spec's "FIRST — Alpaca entitlement direct check" cannot run in this offline env (no resolved Alpaca creds, no outbound Alpaca reach). Rather than descope FR-4/@AC-5, the **operator signed off** on: write the Step 8-9 code with a **graceful fallback** (dividend feed absent/errored/disabled → `DividendYield` left **nil** → surfaces as `missing`, never a fabricated 0) **and an auditable WARN log** so a post-deploy audit can confirm the live entitlement. FR-1/2/3/5/6/8 are unaffected. The live @AC-5 pass therefore remains **unverified in this env by design** — the deployed WARN/Info logs are the audit trail; @AC-5 is exercised here only against fake sources (Step 9).
- Added `source.CashDividend` + `source.DividendSource` interface (`internal/source/source.go`). `alpaca.GetCashDividends` hits `{DataURL}/v1/corporate-actions?types=cash_dividend`, paginating like `GetBars`; non-200 → error (feeds the fallback). Repo: `UpsertDividends` (`ON CONFLICT (symbol, ex_date) DO UPDATE`) + `SumDividendsInWindow(symbol, asOf, windowStart) (sum, hasAnyRow, err)`. Service: new `dividendSrc DividendSource` field (nil-safe); `backfillOneSymbol` fetches dividends once (gated `marketdata.dividends.enabled`, lookback `marketdata.dividends.backfill_lookback_years` default 3), then per period `dividend_yield = SumDividendsInWindow(symbol, filed, filed-365d) / price` **only when** feed present + price>0; no ex_date>filed contributes (FR-7). `main.go` passes `alpacaClient` as the dividend source (no new env var/secret).
- Fallback/audit logs: WARN `"dividend feed unavailable — dividend_yield left missing (audit)"` on feed error; Info `"dividend feed returned no payments"` when empty. Feed absent/disabled/errored ⇒ nil (missing); feed present + 0-in-window ⇒ 0 (0-vs-missing distinction, design point 4).
- Files: `internal/source/source.go`, `internal/alpaca/client.go`, `internal/repository/marketdata_repo.go`, `internal/service/marketdata_service.go`, `cmd/server/main.go`
- Deviations: @AC-5 live entitlement unverified in this env (operator-approved fallback+audit-log path, above); golangci-lint→go vet/gofmt fallback (Deviation Log).

### Step 9 — test: dividend feed + T12M yield unit tests (@AC-5) [done]
- Service tests (fake `DividendSource` + fake histRepo): @AC-5 exact scenario (dividends 2024-08-01/2025-02-01/2025-08-15, filed 2025-06-26 → window sums only the first two, 2025-08-15 excluded as post-filing FR-7; yield = sum/price ~0.01); 0-when-feed-has-rows-but-none-in-window; nil/missing when dividendSrc disabled; nil/missing when feed unavailable. Alpaca client tests: `GetCashDividends` parses corporate-actions JSON into CashDividend (ExDate/PayDate/CashAmount/Currency); 403 → error (drives fallback).
- `GOWORK=off go test ./internal/alpaca/... ./internal/service/... ./internal/repository/... ./internal/source/...` green; `go vet ./...` clean; `gofmt -l` clean.
- Files: `internal/alpaca/client_test.go`, `internal/service/marketdata_service_test.go`
- Deviations: golangci-lint→go vet/gofmt fallback (Deviation Log). Red-before-green: @AC-5 yield assertion is definitionally red against the pre-Step-8 tree (no dividend_yield compute existed).

### Step 10 — service: EDGAR-canonical snapshot dispatch + FR-8 disable-safety (FR-5, FR-8) [done]
- Added a live-read `marketdata.fundamentals.snapshot_source` axis (`snapshotSource()`, default `vendor`) at the top of BOTH `GetFundamentals` and `GetFundamentalsMulti`. Under `edgar`, both dispatch the shared `getEdgarSnapshot` builder (C-10(b) parity by construction); under `vendor` the FMP/Finnhub path is byte-for-byte unchanged.
- `getEdgarSnapshot`: kill-switch `marketdata.edgar.enabled` read with an **explicit `true`** default (feature-100 GetBool zero-value trap) → `FailedPrecondition`+WARN when false; source-aware cache hit (only serves a fresh row whose `cacheAxis(Source)=="edgar"`, so a post-cutover vendor row self-heals); newest as-of period via the new `LatestHistoricalFundamental` one-indexed read; `edgarSnapshotFromPeriod` overlays a **live** mid price (`livePrice` → `GetLatestQuotes`) on the stored period, keeping the stored D/E + P/B + currency (same conventions ⇒ @AC-6/@AC-9), sets `Source="edgar"` explicitly (guards the repo `→"fmp"` default), write-through `UpsertFundamentals` under `marketdata.edgar.cache_ttl_hours`.
- Non-SEC/backfill-gap fallback (@AC-7): zero periods OR no core metrics → WARN (reason `zero_history`/`no_core_metrics`, so a backfill gap is never masked) then route to the vendor **only while `fundamentalsEnabled()`** (vendor still gated); vendor row keeps the vendor `Source`.
- `main.go`: `newFundamentalsSource` default → **boot-fatal `os.Exit(1)`** on an unknown provider (explicit switch, F-07). FMP/Finnhub client code retained (out of scope to delete).
- Files: `internal/service/marketdata_service.go`, `internal/repository/marketdata_repo.go` (LatestHistoricalFundamental), `cmd/server/main.go`.
- Deviations (Deviation Log 2026-09-27): dedicated `LatestHistoricalFundamental` vs the spec's "via GetHistoricalFundamentals" (that method pages oldest-first → whole-history scan; the dedicated single-row read is the faithful "one indexed read/latest"); `snapshot_source` unrecognized value → fail-safe WARN+vendor, not RPC-fatal (live-read axis; boot-fatal is applied to the main.go provider switch where F-07 is safe).

- **FR-8 disable-safety audit (for the PR body — every vendor-keyed read / provider-named string in `marketdata_service.go` + `main.go`, and why none fires a fallthrough when `snapshot_source=edgar` with both vendors off):**
  - `fundamentalsEnabled()` → `marketdata.<provider>.enabled` (`false` default) — reached only on the vendor path or the @AC-7 fallback (which itself requires a vendor enabled); the edgar serving path gates on `marketdata.edgar.enabled` (**true** default) instead. No fallthrough.
  - `fundamentalsQuota()` → `marketdata.finnhub.{rate_window_seconds,symbols_per_minute}` / `marketdata.fmp.daily_request_cap` — vendor path only; **bypassed** under edgar (EDGAR has no vendor quota).
  - `resolveFundamentals`/`GetFundamentalsMulti` TTL → `marketdata.<provider>.cache_ttl_hours` — vendor path/fallback only; the edgar TTL is `marketdata.edgar.cache_ttl_hours`.
  - `enrichmentUnderCap()` → `marketdata.fmp.daily_request_cap` — backfill lane (feature 198), not snapshot serving.
  - `toProtoFundamentals` empty-Source `src = s.fundProvider`, and repo `marketdata_repo.go` empty-source `src="fmp"` — never fire for edgar rows because `edgarSnapshotFromPeriod` sets `Source="edgar"` explicitly.
  - `main.go newFundamentalsSource` → `marketdata.finnhub.base_url` / `marketdata.fmp.{base_url,metrics}` — boot-time client construction (always built, gated at use); under edgar mode the vendor client is constructed but never called.
  - **Confirmed active source when both vendors off:** `TestGetFundamentals_EdgarSnapshot_AC6_FR8_feature211` sets `finnhub.enabled=false`, `fmp.enabled=false`, omits `edgar.enabled` (proves true-default) → snapshot still served, `Source=="edgar"` — no fallthrough to the `false`/`"fmp"` defaults (the exact feature-129 failure).

### Step 11 — test: snapshot dispatch / disable-safety / parity unit tests (@AC-6, @AC-7) [done]
- Added `edgarSnapshotSvc` harness (fake fundRepo cache + fakeHistRepo `latest` + registry-served live quote via `fakeMultiSource` + vendor source) and 5 tests: @AC-6+FR-8 (edgar snapshot, D/E/P/B/currency = stored period, live mid price overrides stored, served with both vendors off + edgar.enabled unset proving true-default); C-10(b) single/multi parity; @AC-7 vendor fallback on zero history (Source=vendor name, vendor fetched once); kill-switch `edgar.enabled=false` → FailedPrecondition; source-aware cache self-heal (fresh vendor row re-derived to edgar in one call). Added `LatestHistoricalFundamental` to both test fakes.
- `GOWORK=off go test ./internal/service/... ./internal/repository/... -race` green; `go vet ./...` clean; `gofmt -l` clean.
- Files: `internal/service/marketdata_service_test.go`
- Deviations: golangci-lint→go vet/gofmt fallback (Deviation Log). Red-before-green: the snapshot-dispatch assertions are definitionally red against the pre-Step-10 tree (no `snapshot_source` axis existed).

### Step 12 — config: seed migration 030_marketdata_edgar_snapshot_keys (FR-5) [done]
- Created `030_marketdata_edgar_snapshot_keys.{up,down}.sql` (next free NNN after 029; the 024 gap is not backfilled). Seeds 5 non-secret `marketdata.*` keys, staging+production, global (user_id NULL), `ON CONFLICT … DO NOTHING`, mirroring 028's column shape: `fundamentals.snapshot_source='vendor'` (string), `edgar.enabled='true'` (bool), `edgar.cache_ttl_hours='24'` (int), `dividends.enabled='false'` (bool), `dividends.backfill_lookback_years='2'` (int). down.sql deletes exactly those 5 by explicit `key IN (...)`, global rows only (never a LIKE — leaves feature-198 history keys and the encrypted credential rows untouched).
- **Coherence fix:** aligned the service code default for `marketdata.dividends.backfill_lookback_years` from 3 → **2** (`marketdata_service.go`, the Step 8 site) so the seed and the code default are one source of truth and the migration is a true no-runtime-behavior change (dividends.enabled=false gates the fetch off at deploy regardless). Dividend tests still green.
- Seeded at current code defaults ⇒ NO-runtime-behavior change on apply: snapshot_source=vendor keeps the FMP/Finnhub path (live-flip to edgar is a rollout step), dividends off (no Alpaca cost until entitlement confirmed), edgar.enabled=true matches the service true-default.
- Verified offline (SQL only, no DB started); confirmed none of the 5 keys was already seeded by an earlier migration.
- Files: `services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.up.sql`, `…down.sql`, `services/xstockstrat-marketdata/internal/service/marketdata_service.go` (default alignment).

### Step 13 — service: data-explorer currency + source provenance + CSV (FR-6) [done]
- Confirmed the recon finding: `FUNDAMENTAL_METRICS` already carries pb_ratio/dividend_yield/debt_to_equity (feature 204) — FR-6's "add the metrics" was already satisfied, so this step added only provenance rendering + CSV columns + the USD-basis marker.
- `useDataExplorer.ts`: `historicalToCsv`/`snapshotToCsv` now emit `currency`,`source` columns (after filed_date / as_of), EXTENDING the feature-204 CSV; missing-metric cells stay blank (@AC-22).
- `data-explorer/page.tsx`: historical table gains `Currency`/`Source` provenance columns (`data-provenance`); snapshot grid gains a provenance line (`de-fund-currency`/`de-fund-source`); added `USD_BASIS_METRICS={market_cap,price}` + `isNonUsdRow` so those absolute fields carry a muted "USD" hint inside a non-USD (CNY) row (ratios are dimensionless — no hint). C-17: design-role tokens (`text-muted-foreground`/`text-foreground`), no color literal.
- No BFF/browser-client change — `currency`/`source` already on the proto messages/typed client (recon).
- `npx tsc --noEmit` shows no errors in the touched files (two pre-existing errors in unrelated test files — `e2e/insights/backfills.spec.ts` `never`-typing, `src/middleware.test.ts` mock typing — not caught by CI's `next build`/vitest gates and outside this feature); `pnpm build` clean; `pnpm run lint` only pre-existing exhaustive-deps warnings elsewhere.
- Files: `services/xstockstrat-ui/src/hooks/useDataExplorer.ts`, `services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx`

### Step 14 — test: data-explorer Playwright — enriched metrics + currency + source (@AC-8) [done]
- Extended `e2e/fixtures/historicalFundamentals.ts` with `DE_SNAPSHOT_BABA` + `DE_HIST_BABA_PAGE1` (CNY, source=edgar, populated d/e·pb·div-yield; Q3-2026 omits roe → "—"); added the INVENTORY.md catalog row (C-12).
- `data-explorer.spec.ts`: new describe (feature 211 @AC-8) — BABA auto-selected (ListAssets returns it first), asserts snapshot provenance (CNY/edgar) + USD hint, historical FY2026 populated metrics + currency/source columns, Q3-2026 "—" for the missing roe but populated P/B (not all-dashed, @AC-22), and CSV header carries `filed_date,currency,source` + CNY/edgar values. Reuses `addAuthCookie` (no re-implemented JWT).
- Ran host-native prebuilt (Docker unavailable — established fallback): `CI=1 E2E_PREBUILT=1 npx playwright test data-explorer --project=chromium` → **7 passed** (incl. the new @AC-8). Red-before-green: the currency/source column + provenance assertions are definitionally red against the pre-Step-13 tree (no such columns rendered).
- Files: `services/xstockstrat-ui/e2e/fixtures/historicalFundamentals.ts`, `services/xstockstrat-ui/e2e/insights/data-explorer.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
