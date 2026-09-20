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

FR-1. **Historical point-in-time fundamentals store.** A new store in `xstockstrat-marketdata`
(`marketdata.fundamentals_history` — a **plain table**, not a hypertable; design decision) persists,
per `(symbol, fiscal period, period type)` (the PK), the as-reported statement line items + derived
metrics **plus both `period_end` and the `filed_date`/`accepted_date`** (when the figure became
public). Many periods per symbol are retained (a real time series), unlike the one-row snapshot cache.
v1 stores the **original as-reported** filing per period (earliest `filed_date`; restatement/amendment
history is out of scope — see Out of Scope).

FR-2. **Primary source = SEC EDGAR + point-in-time price-join.** As-reported statement values and
their SEC `filed` date come from EDGAR (XBRL `companyfacts`), which needs no API key — only a fair-use
`User-Agent`. Price-derived metrics EDGAR cannot supply (`pe_ratio`, `market_cap`) are computed
**point-in-time** from the adjusted close **at `filed_date`** already stored in `marketdata.ohlcv`
(`pe_ratio = close(filed_date)/eps_ttm`, `market_cap = close(filed_date)×shares_outstanding`) — the
price is historical and the EPS/shares are from the filing, so the value is look-ahead-free. This is
the point-in-time base of record.

FR-3. **Optional FMP-Free ratio enrichment (best-effort, cap-aware).** For a ratio neither EDGAR nor
the price-join yields, an optional FMP pass may fill it, using the already-wired FMP credential
(feature 147) and guarded by a **dedicated** `marketdata.fmp.daily_request_cap` check with its own
request counter (NOT the snapshot `fundamentalsQuota()`, which is provider-dispatched). Enrichment
degrades gracefully (skipped, not failed) when the cap is exhausted or a symbol is uncovered; the
EDGAR row still persists with null ratio fields. FMP's current-snapshot `ratios-ttm` is **never** used
to fill a historical row (that would be look-ahead). No paid FMP plan is required for v1.

FR-4. **Fundamentals backfill path.** The backfill machinery (`xstockstrat-ingest.TriggerBackfill`
→ a marketdata worker RPC) is extended to backfill **fundamentals** over a symbol universe and a date
range, for **both quarterly and annual** periods, resumably and idempotently — as a new backfill
**data kind** distinct from the existing OHLCV-`1d`-only path (feature 143), not a new timeframe
value. Job progress is observable via the existing `GetBackfillStatus`/`ListBackfillJobs` surface.

FR-5. **Point-in-time read (T+1 availability).** `xstockstrat-marketdata` exposes an as-of / ranged
read that, given a symbol and an as-of date, returns only fundamentals whose **`filed_date` < the
as-of date** (T+1 — a filing is usable only the trading day *after* it was filed, since SEC filings
often accept post-close; design decision), never a value from a filing not yet public at that
simulated date.

FR-6. **Fundamental operand in the evaluator, backtest AND live.** `xstockstrat-analysis`'s **shared**
evaluator gains a fundamental operand kind (`COMPONENT_KIND_FUNDAMENTAL`) so a `StrategyComponent` can
reference a point-in-time fundamental series (`pe_ratio`, `eps`, `revenue`, `roe`, `debt_to_equity`,
…). At each simulated bar the operand resolves via the FR-5 read as a **carry-forward as-of** join
(latest filing with `filed_date < bar_date`, carried forward until the next filing; `None`/hold before
the first filing; never a future filing). The operand resolves identically in the **live** loop,
readiness, and opportunities paths — not backtest-only — preserving backtest/live parity. Backtest
results stay reproducible and deterministic; an unset operand leaves existing runs byte-for-byte
unchanged.

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
    there is **additive-only**. **Field-numbering (from the overlap scan):** launched features
    150/151 already occupy `BacktestResult` fields 17–20 and `RunBacktestRequest` 8–9, so 198's
    additive fields must be assigned after those — `/sdd-spec` re-derives next-free numbers from the
    merged tree.
  - **Cross-feature proto coordination (WARN, not a blocker):** feature 032 (regime-segmented
    backtest, draft) also edits `analysis/v1/analysis.proto`, but adds *distinct* messages
    (`RunSegmentedBacktest` + `SegmentedBacktest*`) — no field-number clash foreseeable. If 032 and
    198 reach impl-spec concurrently, pre-assign their `analysis.proto` field numbers and add a
    `merge-order.md` coordination row (mirroring the 150/151 split). No `merge-order.md` entry is
    required now (no FAIL-level collision).
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
  - `marketdata.fundamentals.history.ratio_enrichment.enabled` (bool) — toggles the FMP-Free ratio
    pass. **Reuses the existing `marketdata.fmp.daily_request_cap` (=250, `config-governance.md:618`)
    as the single FMP daily budget** — no second competing cap; ratio enrichment draws from the same
    budget already shared with `analysis.fundsignal.daily_call_budget` (documented `≤` that cap,
    `config-governance.md:599`), and reuses the feature-147 `marketdata.fmp.api_key` secret (**no new
    credential row**). (Resolves the review's config-key-overlap warning.)
  - `analysis.backtest.fundamentals.enabled` (bool)

## Database Changes

- [ ] No schema changes
- New `xstockstrat-marketdata` migration, as a paired `NNN_description.up.sql` + `.down.sql`
  (NNN = `ls services/xstockstrat-marketdata/migrations/` at spec time — **do not assume**;
  verified snapshot: dir holds `000`–`004`, so next free is `005`): `marketdata.fundamentals_history`
  as a **plain PostgreSQL table** (D-1 resolved — *not* a hypertable: ~200k slow-growing rows, the read
  filters `period_end` not the time axis, and a hypertable would re-import the feature-153 chunk-lock
  risk for no planner gain), PK `(symbol, fiscal_period, period_type)` + `filed_date`/`accepted_date`/
  `period_end` columns + statement/metric columns + `extra_metrics jsonb` + `source`, btree index
  `(symbol, period_end, filed_date)`. Idempotency via `ON CONFLICT (PK) DO NOTHING` (keep earliest
  `filed_date`). The `.down.sql` drops the table.
- Possible `xstockstrat-ingest` migration (paired up/down; **verified next free is `012`** — trunk
  tip is `011_signal_source_type_mcp_client`, corrected from the earlier stale `006` guess) to carry
  a `data_kind` column on `ingest.backfill_jobs`/`backfill_chunks` if the fundamentals kind is not
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

All items below are **resolved** (a scope decision closed at this review) or **design-deferred**
(a genuine architectural fork whose resolution belongs to `/sdd-design`, explicitly acknowledged
here so it is not lost). No unresolved product-scope question remains — the gate is clear.

### Resolved (this review)

- [x] **RESOLVED — v1 symbol universe.** v1 backfills an **operator-supplied explicit symbol list**,
  reusing the existing `TriggerBackfill.symbols` input the OHLCV path already takes (lowest-rework,
  consistent ergonomics). When no list is supplied, the UI/agent default is the **feature-168
  fundamentals universe**. FMP-Free's 250/day cap bounds only the optional *ratio-enrichment* pass,
  never the EDGAR statement base — so universe size does not gate the primary backfill. This closes
  the FR-4 deliverable ambiguity the review flagged.
- [x] **RESOLVED — FMP daily-cap reconciliation.** Ratio enrichment reuses the existing
  `marketdata.fmp.daily_request_cap` (=250) as the single FMP budget; **no second competing cap** is
  introduced (see Config Key Changes). Closes the review's config-key-overlap warning.
- [x] **RESOLVED — migration NNN.** marketdata next-free = `005` (verified); ingest next-free = `012`
  (verified; the earlier `006` guess was stale). Both migrations are paired up/down.

### Design-deferred (resolve at `/sdd-design` — acknowledged, not blocking)

- [x] **D-1 — hypertable partition key (`filed_date` vs `period_end`).** The as-of read (FR-5)
  filters on `filed_date`, but the natural fiscal axis is `period_end`. Decide at design with the
  no-look-ahead read pattern driving the choice.
- [x] **D-2 — EDGAR XBRL → platform metric mapping.** How EDGAR XBRL tags map onto feature-063's
  `pe_ratio`/`eps`/… vocabulary and the screener's `extra_metrics` union (ledger `117`), and how much
  statement normalization v1 covers.
- [x] **D-3 — 032 evaluator/proto seam.** Whether the fundamental operand must compose with
  `RunSegmentedBacktest`; hold the `xstockstrat-analysis` evaluator seam so both land, and pre-assign
  `analysis.proto` field numbers if 032 and 198 reach impl-spec concurrently (see Proto section).

### Known traps folded into the design contract (acknowledged; design/spec must honor)

- [x] **T-1 — look-ahead bias (the central risk).** `xstockstrat-analysis`'s reviewer focus is
  literally "no look-ahead bias." The FR-5 as-of read (`filed_date` ≤ simulated date) is the guard;
  design must prove the evaluator never resolves a not-yet-filed period, and a RED test must assert a
  Q-result filed after the simulated bar is invisible (`@AC-3`/`@AC-4`).
- [x] **T-2 — backfill data kind vs. timeframe** (ledger `080`, feature 143). Fundamentals ride a new
  `BackfillDataKind` axis (default `BARS=0`), never a timeframe value.
- [x] **T-3 — vendor literal-string audit** (ledger `129`). EDGAR is keyless + FMP reuse avoids the
  credential-deploy scope-creep by design; still grep every provider-name literal when touching
  `marketdata_service.go`'s selector so EDGAR is added without breaking the `finnhub`/`fmp` snapshot
  path.
- [x] **T-4 — agent projection + strat-lab skill** (ledger `134`, root CLAUDE.md). Projected-message
  field additions break `test_*_projection.py`; `run_backtest` changes require the `strat-lab`
  `backtest` skill update in the **same PR**. Enumerate at spec time.
- [x] **T-5 — no fragile full-stack smoke test** (ledger `129`). Verify EDGAR/FMP with a narrow
  direct-API check + fake-backed unit tests, not a deployed-instance `grpcurl` step.
