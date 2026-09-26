# Context: edgar-fundamentals-enrichment

**Feature**: `docs/roadmap/features/207-edgar-fundamentals-enrichment/feature.md`
**Product Spec**: `docs/roadmap/features/207-edgar-fundamentals-enrichment/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/207-edgar-fundamentals-enrichment/implementation-spec.md`

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
