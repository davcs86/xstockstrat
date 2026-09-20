# Product Spec: historical-fundamentals-backtest

**Created**: 2026-09-20

---

## Problem Statement

The platform ingests fundamentals only as a **latest-snapshot cache** (`marketdata.fundamentals`,
one row per symbol, overwritten on refresh — feature 059), and the backtest engine
(`xstockstrat-analysis` `RunBacktest`) is **technical-only**: it reads OHLCV bars + indicators
(+ optional signals) and has no fundamental operand. There is therefore **no way to backtest a
strategy whose entry/exit logic depends on fundamentals** (P/E, EPS, revenue growth, ROE,
debt/equity), and no historical, point-in-time fundamentals store to backtest against. This feature
adds a filing-date-aware historical fundamentals time series and lets backtests reference it as it
was known at each point in time — the missing capability for fundamental strategy research.

## User Story

As an operator/quant, I want to backfill a filing-date-aware historical time series of company
fundamentals (income statement, balance sheet, cash flow, and derived ratios — quarterly and annual)
and reference those metrics in a strategy backtest as they were known at each point in time, so that
I can research and validate fundamental strategies **without look-ahead bias**.

## Functional Requirements

FR-1. **Historical point-in-time fundamentals store.** A new time-series store in
`xstockstrat-marketdata` persists, per `(symbol, fiscal period, period type)`, the as-reported
statement line items + derived ratios **plus both `period_end` and the `filed_date`/`accepted_date`**
(when the figure became public). Multiple periods per symbol are retained (a real time series), not
overwritten like the snapshot cache.

FR-2. **Primary source = SEC EDGAR.** As-reported statement values and their SEC `filed` date are
sourced from EDGAR (XBRL `companyfacts`/`frames`), which requires no API key — only a fair-use
descriptive `User-Agent`. This is the point-in-time base of record for look-ahead-safe backtesting.

FR-3. **Derived-ratio enrichment = FMP Free (best-effort, cap-aware).** Derived ratios EDGAR does
not directly expose (e.g. P/E, P/B, dividend yield) are opportunistically enriched from FMP using the
already-wired FMP credential (feature 147), **respecting FMP Free's ~250 requests/day cap** — ratio
enrichment degrades gracefully (is skipped, not failed) when the cap is exhausted or a symbol is
uncovered. No paid FMP plan is required for v1.

FR-4. **Fundamentals backfill path.** The backfill machinery (`xstockstrat-ingest.TriggerBackfill`
→ a marketdata worker RPC) is extended to backfill **fundamentals** over a symbol universe and a date
range, for **both quarterly and annual** periods, resumably and idempotently — as a new backfill
**data kind** distinct from the existing OHLCV-`1d`-only path (feature 143), not a new timeframe
value. Job progress is observable via the existing `GetBackfillStatus`/`ListBackfillJobs` surface.

FR-5. **Point-in-time read for the backtest.** `xstockstrat-marketdata` exposes an as-of / ranged
read that, given a symbol and an as-of date, returns only fundamentals whose `filed_date` ≤ the as-of
date (never a value from a filing not yet public at that simulated date).

FR-6. **Fundamental operand in the backtest evaluator.** `xstockstrat-analysis`'s backtest evaluator
gains a fundamental operand kind so a `StrategyComponent` can reference a point-in-time fundamental
series (e.g. `pe_ratio`, `eps`, `revenue`, `roe`, `debt_to_equity`); at each simulated bar the
evaluator resolves the operand via the FR-5 as-of read, guaranteeing no look-ahead bias. Backtest
results remain reproducible and deterministic.

FR-7. **Consumer surfaces.** The capability is reachable end-to-end: the `/insights` backfills UI can
trigger a fundamentals backfill, and the agent's `trigger_backfill` / `run_backtest` MCP tools accept
the fundamentals data kind / fundamental operands respectively.

## Out of Scope

- Paid FMP/Finnhub tiers, and Finnhub as a source at all in v1 (EDGAR + FMP Free only). A paid source
  swap is a later, config-selectable follow-up.
- Non-US issuers (EDGAR is US-only); ADRs/foreign private issuers filing 20-F are best-effort.
- Restatement lineage / as-first-reported vs. amended reconciliation beyond storing the `filed_date`
  of each version (we store what was filed and when; we do not model amendment supersedence rules).
- Live/streaming fundamentals updates — this feature is historical backfill + point-in-time read.
- Changes to the existing latest-snapshot cache, the screener (`SCREEN_KIND_FUNDAMENTAL`), or the
  fundamentals-signal producer — they keep using the snapshot; this feature is additive.
- Any collision with in-flight **032** (regime-segmented backtest), **065** (second OHLCV vendor),
  **189** (screener presets) — see Open Questions for the seams to hold.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` (Go) — new historical fundamentals time-series store, EDGAR + FMP-ratio
  historical vendor client, backfill worker RPC, as-of/ranged point-in-time read RPC.
- `xstockstrat-ingest` (Python) — extend `TriggerBackfill` orchestration with a fundamentals data
  kind (chunking/resume over the symbol universe × period range).
- `xstockstrat-analysis` (Python) — fundamental operand in the backtest evaluator; point-in-time
  resolution against the marketdata as-of read (the no-look-ahead guarantee lives here).
- `xstockstrat-agent` (Python) — `trigger_backfill` + `run_backtest` MCP tool surface; the
  `strat-lab` `backtest` skill (`plugins/strat-lab/`) updated in the **same PR** (root CLAUDE.md).
- `xstockstrat-ui` (Next.js) — `/insights` backfills page (fundamentals kind) + backtest strategy
  builder (fundamental operand).
- `packages/proto` — additive messages/fields/RPCs across marketdata, ingest, analysis.
- `xstockstrat-config` (Node) — new config keys (below) via `WatchConfig`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights`: the backfills page gains a fundamentals data
  kind (trigger + status), and the backtest strategy builder gains a fundamental operand selector.
- [x] **Agent** — `xstockstrat-agent` MCP tools: `trigger_backfill` (accepts the fundamentals data
  kind), `run_backtest` (strategies referencing fundamental operands). Both are descriptor-parity /
  strat-lab-skill guarded — those surfaces update in the same PR.
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- Additive only (no field removal / type change → non-breaking; `buf breaking` must stay green):
  - `marketdata/v1/marketdata.proto` — new `GetHistoricalFundamentals` (as-of + ranged, repeated
    periods) and a fundamentals backfill worker RPC; new messages for a point-in-time fundamentals
    period (`period_end`, `filed_date`, `accepted_date`, `fiscal_period`, `period_type`, statement
    fields + `extra_metrics` map, `source`). Reuses the existing `Fundamentals` field names where
    they map, but is a distinct repeated/time-series message — the snapshot `Fundamentals` message is
    unchanged.
  - `ingest/v1/ingest.proto` — a `BackfillDataKind` enum (`BARS` default = 0 back-compat,
    `FUNDAMENTALS`) added to `TriggerBackfillRequest`; default preserves every existing OHLCV caller.
  - `analysis/v1/analysis.proto` — additive fundamental operand kind on `StrategyComponent`.
    `BacktestResult` wire bytes are persisted verbatim in `analysis.backtest_details`, so any change
    there is **additive-only**.
  - Agent descriptor-parity projection tests (`test_backtest_view.py` family) must be updated in the
    same PR for any projected message that gains a field (ledger 2026-08-14 `feature 134`).

## Config Key Changes

- [ ] No new config keys
- Candidates (final set decided at `/sdd-design`; naming `<service>.<category>.<key>`):
  - `marketdata.fundamentals.history.enabled` (bool)
  - `marketdata.edgar.base_url`, `marketdata.edgar.user_agent` (SEC fair-use UA — **non-secret**,
    ordinary config, no `GetSecret`), `marketdata.edgar.rate_limit_rps`
  - `marketdata.fundamentals.history.backfill.batch_size`, `.max_lookback_years`,
    `.period_types` (quarterly|annual|both)
  - `marketdata.fmp.ratios.daily_request_cap` (guards FMP-Free enrichment against the 250/day cap —
    reuses the existing `marketdata.fmp.*` family + the feature-147 `marketdata.fmp.api_key` secret;
    **no new credential row**)
  - `analysis.backtest.fundamentals.enabled` (bool)

## Database Changes

- [ ] No schema changes
- New `xstockstrat-marketdata` migration (NNN = `ls services/xstockstrat-marketdata/migrations/`
  at spec time — **do not assume**; snapshot shows `000`–`004`, so likely `005`): a TimescaleDB
  hypertable for the point-in-time fundamentals time series, partitioned on the time dimension
  (`filed_date` or `period_end` — decided at design, with the no-look-ahead read pattern driving the
  choice), keyed to `(symbol, fiscal_period, period_type)` uniqueness, statement columns +
  `extra_metrics jsonb` + `source`.
- Possible `xstockstrat-ingest` migration (snapshot `003`–`005`, likely `006`) to carry a
  `data_kind` column on `ingest.backfill_jobs`/`backfill_chunks` if the fundamentals kind is not
  otherwise distinguishable — confirm at design (the existing schema may already suffice).

## Feature Workflow Notes

Branch to create: `feature/historical-fundamentals-backtest` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (additive proto + config) — owners of marketdata, ingest, analysis
- [ ] 2 service owners + platform lead (breaking proto change) — **not expected**; keep additive
- [x] DBA review + service owner (schema migration — marketdata fundamentals hypertable; possibly ingest)
- [x] Proto Reviewer (additive marketdata/ingest/analysis changes; `buf breaking` green)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap — look-ahead bias (the central risk).** `xstockstrat-analysis`'s reviewer focus
  is literally "no look-ahead bias." The FR-5 as-of read (`filed_date` ≤ simulated date) is the
  guard; the design must prove the evaluator never resolves a fundamental from a not-yet-filed
  period, and a RED test must assert it (a Q-result filed after the simulated bar must be invisible).
- [ ] **Known trap — backfill data kind vs. timeframe** (ledger `080-fix-backfill-timeframe-enum`,
  feature 143). `TriggerBackfill` persists `timeframe` raw and canonicalizes late; timeframe is
  hard-restricted to `1d`. Fundamentals must ride a **new data-kind axis**, never a timeframe value —
  confirm the enum default keeps every existing OHLCV caller on `BARS`.
- [ ] **Known trap — vendor literal-string / credential wiring** (ledger `129`). We add EDGAR (no
  credential) + reuse the wired FMP key, so the feature-129 "credential not wired through all 10
  deploy files" scope-creep is **avoided by design** — but the design must still grep for every
  literal reference when touching `marketdata_service.go`'s provider selection so EDGAR is added
  without breaking the existing `finnhub`/`fmp` snapshot selector.
- [ ] **Known trap — agent projection + strat-lab skill** (ledger `134`, root CLAUDE.md). Any
  projected-message field addition breaks `test_*_projection.py`; changing `run_backtest` requires
  the `strat-lab` `backtest` skill update in the same PR. Enumerate these at spec time.
- [ ] **Known trap — no fragile full-stack smoke test** (ledger `129`). Verify EDGAR/FMP integration
  with a narrow direct-API check + fake-backed unit tests, not a deployed-instance `grpcurl` step.
- [ ] **Cross-feature seam — 032 (regime-segmented backtest).** Does the fundamental operand need to
  compose with `RunSegmentedBacktest`? Hold the evaluator seam so both can land; confirm no shared
  proto field-number/migration-NNN collision.
- [ ] **Design decision — hypertable partition key** (`filed_date` vs `period_end`): the as-of read
  filters on `filed_date`, but the natural fiscal axis is `period_end`. Decide at `/sdd-design`.
- [ ] **Design decision — how EDGAR XBRL tags map to the platform's fundamental metric names**
  (reuse feature-063's `pe_ratio`/`eps`/… vocabulary and the screener's `extra_metrics` union,
  ledger `117`), and how much statement normalization v1 covers.
- [ ] **Scope confirmation — universe.** Which symbol universe does v1 backfill target (the existing
  fundamentals universe from feature 168, or an operator-supplied list), given FMP-Free's cap only
  bounds the *ratio enrichment*, not the EDGAR base?
