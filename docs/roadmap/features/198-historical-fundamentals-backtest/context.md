# Context: historical-fundamentals-backtest

**Feature**: `docs/roadmap/features/198-historical-fundamentals-backtest/feature.md`
**Product Spec**: `docs/roadmap/features/198-historical-fundamentals-backtest/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/198-historical-fundamentals-backtest/implementation-spec.md`

---

## Session 2026-09-20 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.

### Grounding done before writing (recon summary — carried into design)
- **Current state:** fundamentals exist ONLY as a latest-snapshot cache (`marketdata.fundamentals`,
  PK `symbol`, one row per symbol, feature 059). Backtest (`xstockstrat-analysis.RunBacktest`) is
  technical-only — reads OHLCV bars + indicators (+ optional signals); no fundamental operand, no
  fundamentals read. Backfill (`ingest.TriggerBackfill` → `marketdata.BackfillBars`) is OHLCV-only
  and hard-restricted to `1d` (feature 143). This feature is greenfield on storage/backfill/
  backtest-read; additive on proto.
- **Wired vendors:** FMP + Finnhub credentials already exist as feature-147 encrypted config rows
  with a `marketdata` `GetSecret` grant; a `marketdata.fundamentals.provider` selector (`finnhub`|
  `fmp`) already picks the snapshot provider. Alpaca = bars only.

### Decisions (from user, this session — 4 AskUserQuestion rounds)
1. **Scope:** full end-to-end in one feature (storage + backfill + backtest fundamental operand).
2. **Point-in-time:** filing-date-aware — store `period_end` + `filed_date`/`accepted_date`; the
   backtest sees a value only from its `filed_date` forward. This is the look-ahead-bias guard.
3. **Periodicity:** quarterly + annual.
4. **Data source — REVISED after a user question.** Initial proposal was "FMP primary + Finnhub
   fallback" (both already wired → lowest rework). User then disclosed they hold **only FMP Free**.
   Verified FMP Free limits (web, 2026): **250 req/day**, **~5yr annual / ~5–8 quarters** history,
   US-only, as-reported/`acceptedDate` depth + bulk endpoints paid-gated. Free FMP is therefore
   **insufficient** for a universe-scale, deep-history, filing-date-aware backfill. User chose:
   **SEC EDGAR primary + FMP Free ratios** — EDGAR (XBRL `companyfacts`/`frames`, no API key, SEC
   `filed` date = gold-standard point-in-time, US-only) is the as-reported base of record; FMP Free
   enriches derived ratios opportunistically within its 250/day cap (graceful degradation).
   EDGAR needs only a fair-use `User-Agent` (non-secret config, no `GetSecret`); FMP reuses the
   feature-147 credential → **no new secret/credential row** (avoids the feature-129 deploy-wiring
   scope-creep by design).

### Known traps folded in from the Ledger (see product-spec Open Questions)
- Look-ahead bias is `xstockstrat-analysis`'s named reviewer focus → FR-5 as-of read + a RED test.
- Backfill data-kind vs timeframe (ledger `080`, feature 143) → new `BackfillDataKind` axis, default
  `BARS`, never a timeframe value.
- Vendor literal-string / credential wiring (ledger `129`) → EDGAR keyless + FMP reuse sidesteps it;
  still grep the provider-selection literals in `marketdata_service.go`.
- Agent descriptor-parity projections + strat-lab `backtest` skill (ledger `134`, root CLAUDE.md) →
  update in the same PR for any `run_backtest`/projected-message change.
- No fragile full-stack `grpcurl` smoke test (ledger `129`) → narrow direct-API check + fakes.
- `ls migrations/` before writing any migration NNN (ledger `durable-observable-backfills`).

### Cross-feature seams to hold (no collision)
- 032 regime-segmented backtest (draft) — keep the evaluator operand seam composable.
- 065 second OHLCV vendor (idea) — unrelated (OHLCV, not fundamentals).
- 189 screener presets (design-approved) — reads the snapshot, not this history store; additive.

### Next
- `/sdd-review historical-fundamentals-backtest product-spec`, then `/sdd-design ... quick`
  (mandatory SDD grounding before any code — root CLAUDE.md entry point / Constitution C-11).
