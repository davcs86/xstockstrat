# Product Spec: edgar-fundamentals-enrichment

**Created**: 2026-09-25

---

## Problem Statement

Strategy backtests and live/snapshot evaluation compute fundamentals from **different sources with
different conventions**, so the same symbol scores wildly differently on each surface. For BABA the
PIT backtest `fscore.composite` lands ~0.35 while live scores ~0.70; for AXP the PIT D/E permanently
zeros a quality sub-score. This is a source/methodology mismatch, not a real fundamentals difference,
and it makes fundamentals-gated strategies (e.g. `fundamentals_macd_blend`) untrustworthy: a backtest
that shows zero entries contradicts a live "Enter" signal on the identical rule.

Three concrete defects in the EDGAR historical path (`services/xstockstrat-marketdata/internal/edgar/edgar_client.go`):
- `debt_to_equity` = total `Liabilities` / `StockholdersEquity` (≈4.64 for BABA) — the snapshot path
  and the seeded formula bands (`de_bad=2.0`) assume **financial-debt** D/E (≈0.25).
- Currency is hardcoded `"USD"` and the XBRL unit key is discarded — CNY-denominated ADR magnitudes
  are silently mislabeled, corrupting any USD-price-derived ratio (e.g. P/B).
- `pb_ratio` and `dividend_yield` are never populated on the EDGAR path, so the value sub-score is
  computed on 1 of 3 inputs in a backtest vs 3 of 3 live.

## User Story

As a strategy author, I want backtest fundamentals and live fundamentals to come from one PIT-faithful
source computed the same way, so that a fundamentals-gated strategy's backtest result and its live
Decide-surface signal agree, and I can debug the underlying metrics in one place.

## Functional Requirements

FR-1. **Reporting currency (prerequisite).** The EDGAR ingester captures the XBRL unit key
(`USD`/`CNY`/…) per datum instead of hardcoding `"USD"`, and stores the true reporting currency on
each `fundamentals_history` period. When a filing's monetary facts are in a non-USD currency, that
currency is recorded and any USD-price-derived ratio computed for that period accounts for it (no
USD-price ÷ foreign-currency-book mixing).

FR-2. **Financial-debt D/E.** The EDGAR companyfacts tag allow-list is expanded to capture debt line
items (US-GAAP `LongTermDebtNoncurrent`, `LongTermDebtCurrent`/`DebtCurrent`, `ShortTermBorrowings`,
and total-debt fallbacks such as `DebtLongtermAndShorttermCombinedAmount`; plus IFRS/20-F equivalents
for ADR filers). `debt_to_equity` is computed as `total_debt / stockholders_equity` (financial-debt
convention), matching the convention the seeded formula bands assume. Computed from the filing itself
— no look-ahead.

FR-3. **P/B enrichment (PIT).** `pb_ratio` is computed at the filing boundary as
`market_cap / stockholders_equity`, reusing the existing `priceJoin` (`market_cap` = price-at-filing ×
shares outstanding). Uses only the price as-of `filed_date` — no look-ahead — and is currency-consistent
per FR-1.

FR-4. **Dividend yield (PIT).** A historical dividend-payment feed (Alpaca corporate-actions — Alpaca is
already the OHLCV provider, so no new *fundamentals* vendor) is ingested, and `dividend_yield` is computed
per period as trailing-12-month cash dividends (payments with ex/pay date ≤ `filed_date`) ÷ price-at-filing.
No dividend paid after `filed_date` may contribute.

FR-5. **EDGAR-canonical snapshot.** `GetFundamentalsMulti` (snapshot) serves the **latest EDGAR filing**
enriched with a **live** price-join, so live/readiness/opportunity evaluation reads the same source and
conventions as a backtest. The FMP and Finnhub fundamentals providers are disabled **by config** (their
`enabled` keys / the provider-selection key), not by deleting code. A vendor fallback remains available
**only** for symbols EDGAR cannot cover (non-SEC-filers) — the one acknowledged residual-divergence case.

FR-6. **Data-explorer exposure.** The enriched/normalized metrics (financial-debt `debt_to_equity`,
`pb_ratio`, `dividend_yield`), the reporting `currency`, and the `source`/provenance are surfaced in the
existing `/insights/data-explorer` (feature 204) for both snapshot and historical tabs, driven through the
`FUNDAMENTAL_METRICS` registry so tables, chart selector, and CSV export pick them up.

FR-7. **No look-ahead (cross-cutting invariant).** Every enriched metric attached to a filing period uses
only data observable as-of that period's `filed_date`: price-at-filing for the price-join, dividends dated
≤ `filed_date` for the yield, filing-reported balances for D/E. The existing `filterAsOf` (`filed_date <
as_of`) T+1 boundary is preserved.

FR-8. **Provider-disable safety.** Disabling FMP/Finnhub must not silently disable fundamentals. Every
literal `marketdata.fmp.*` / `marketdata.finnhub.*` read and provider-named string in the touched code is
audited so the EDGAR-canonical path is the **active** source, never a fallthrough-to-`false` default
(directly per ledger `fails.md` 2026-08-13, feature 129).

## Out of Scope

- **Deleting** the FMP/Finnhub fundamentals client code, tests, and provider-named strings — deferred to a
  **named follow-up feature** (this feature disables them by config only). Operator-approved 2026-09-25.
- **Changing** the seeded `fundamentals_value_quality` formula band constants — this feature *validates*
  that PIT now matches the snapshot convention so the bands behave; a band retune is a separate change only
  if validation proves one is needed.
- Full fundamentals parity for **non-SEC-filing** symbols (pure foreign listings with no EDGAR filing) —
  they retain the vendor-fallback gap by design.
- Intraday/real-time fundamentals freshness beyond a daily price-join (accounting metrics update on filing
  cadence, which is correct).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — EDGAR ingester (currency capture, debt tags, D/E), `priceJoin` (P/B), new
  Alpaca dividend feed, snapshot-serving path, migration(s).
- `xstockstrat-ui` — `/insights/data-explorer` `FUNDAMENTAL_METRICS` registry additions.
- `xstockstrat-config` — vendor-disable / provider-selection keys (and any dividend-feed toggle).
- `xstockstrat-indicators` — no code change intended; the seeded formula is the validation target (bands
  should behave once PIT matches the snapshot convention).
- `xstockstrat-analysis` — no code change intended; the primary consumer whose backtest/live parity this
  restores (review focus: no look-ahead).
- `packages/proto` — likely **no** change (`currency`/`source`/`pb_ratio`/`dividend_yield` fields already
  exist on `Fundamentals` and `HistoricalFundamentalsPeriod`); confirmed at design.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (Data Explorer, `/insights/data-explorer`): enriched
  metrics + reporting currency + source shown in the snapshot and historical fundamentals tabs (FR-6),
  reachable via the existing nav entry (already registered per C-10).
- [x] **Agent** — `xstockstrat-agent` MCP tool `query_fundamentals`: already returns per-period
  `currency`, `source`, and the metric set, so enriched values (financial-debt D/E, P/B, dividend yield,
  correct currency) flow through with no tool contract change — verified as a surface, not a new tool.
- [ ] **None**

The backtest/live evaluation surfaces (Decide UI, backtest results) already exist and consume fundamentals
through `xstockstrat-analysis`; this feature corrects the data they read rather than adding a new view.

## Proto Contract Changes

- [x] No proto changes required (expected) — `Fundamentals` (currency=15, source=16, pb_ratio=4,
  dividend_yield=5, debt_to_equity=9) and `HistoricalFundamentalsPeriod` (currency=19, source=20, metrics
  7–17) already carry every field. Design confirms; if a new provider-enum value or a debt/total field is
  wanted, it is an **additive, non-breaking** field/enum-value only.

## Config Key Changes

Exact keys finalized at design; expected shape:
- `marketdata.finnhub.enabled` → `false` (disable vendor snapshot; existing key).
- `marketdata.fmp.enabled` → `false` (existing key).
- Snapshot-source selection for EDGAR-canonical — either a new value for the existing
  `marketdata.fundamentals.provider` (e.g. `edgar`) or a new `marketdata.fundamentals.snapshot_source`
  key. **Design fork — see Open Questions.**
- Possible `marketdata.dividends.*` feed toggle / cache TTL for the Alpaca corporate-actions ingest.

## Database Changes

- [ ] No schema changes to the metric columns — `fundamentals_history` already has `pb_ratio`,
  `dividend_yield`, `debt_to_equity` (double precision) and a `currency` column; enrichment writes into
  existing columns / `extra_metrics` JSONB (e.g. `total_debt`).
- **Likely one new migration**: a dividend-payment / corporate-actions store to support the PIT
  trailing-12-month yield computation (FR-4). It follows the `NNN_description.up.sql` + `.down.sql`
  convention with `NNN = 006` (next free after `005_fundamentals_history`), run via
  `scripts/db-migrate.sh` (C-07). Table shape (hypertable vs plain; `(symbol, ex_date)` key) is
  finalized at design.

## Feature Workflow Notes

Branch to create: `feature/edgar-fundamentals-enrichment` (branch from `main-dev`).
_Harness note: this session is assigned `claude/fundamentals-strategy-fscore-j3oshc`; artifacts and
implementation are developed there and PR'd into `main-dev` per the session's branch directive._

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (marketdata) — plus config owner for the disable/selection keys
- [ ] 2 service owners + platform lead (breaking proto change) — not expected (no breaking proto)
- [x] DBA review + service owner — for the new dividend/corporate-actions migration

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

**No unresolved product-level questions.** Persona, scope, consumer surfaces, and the vendor-disable
policy (EDGAR-canonical; disable FMP/Finnhub by config; vendor fallback only for non-SEC-filers; code
deletion deferred to a named follow-up) are all decided — see the operator decisions recorded in
`context.md` (Session 2026-09-25). The items below are **not** product questions: they are binding
implementation constraints and HOW-forks explicitly routed to `/sdd-design` per the SDD pipeline
(C-11), captured here so recon/design and the design-adversary address them.

### Known traps — binding constraints the design MUST honor (not questions)

- **Provider-disable literal audit (fails.md 2026-08-13, feature 129).** Disabling FMP/Finnhub by
  config must not fall through to the Go-coded `false` default and silently disable fundamentals. The
  design must enumerate every `marketdata.fmp.*` / `marketdata.finnhub.*` literal read and
  provider-named string in `marketdata_service.go`/`main.go` and ensure EDGAR-canonical is the active
  path. (FR-8)
- **No fragile full-stack verification (fails.md 2026-08-13, feature 129).** Verify the EDGAR debt-tag
  extraction and Alpaca dividend feed with the **narrowest** direct check (a real call to the SEC
  companyfacts / Alpaca corporate-actions API in isolation + fake-backed unit tests), never a
  fully-deployed-instance `grpcurl` smoke test in a spec step.
- **Real Bar proto fixtures (fails.md 2026-08-06, backtest-debug-info).** Any analysis-side or
  price-join test must build real `marketdata_pb2.Bar` (`bar.time`), never `MagicMock`.

### Design forks routed to /sdd-design (HOW, not WHAT)

- **Snapshot-source selection mechanism** — extend the existing `marketdata.fundamentals.provider`
  (feature-198-owned) with a `provider="edgar"` value vs a dedicated
  `marketdata.fundamentals.snapshot_source` key. Overlap scan confirms 198 owns the selector, so
  extending it is the leading option.
- **IFRS / 20-F debt tags** — ADR filers (BABA) use different XBRL concepts than US-GAAP filers; the
  exact tag set covering both taxonomies and the fallback order when a filer reports only a combined
  total-debt tag.
- **Non-SEC-filer fallback mechanism** — the switching mechanism that keeps the vendor path only for
  symbols with no EDGAR CIK (policy already decided; only the mechanism is open).
- **Dividend history storage** — dedicated dividend/corporate-actions table vs folding into an existing
  store; hypertable vs plain; `(symbol, ex_date)` key (migration `006`).
- **ROE methodology validation** — EDGAR ROE is `net_income / ending equity`; retired vendors used
  TTM/avg equity. Once vendors are disabled, EDGAR ending-equity ROE is canonical for both surfaces
  (parity is automatic), but confirm the formula's `roe_good`/`roe_bad` bands still behave.
