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
