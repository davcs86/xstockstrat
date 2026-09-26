# Implementation Spec: edgar-fundamentals-enrichment

**Status**: `pending`
**Created**: 2026-09-26
**Feature**: `docs/roadmap/features/207-edgar-fundamentals-enrichment/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/edgar-fundamentals-enrichment`

---

## Execution Summary

Make SEC EDGAR the single PIT-faithful fundamentals source for both backtest and live/snapshot
evaluation. All code lives in **`xstockstrat-marketdata`** (Go) plus one marketdata migration, one
`xstockstrat-config` seed migration, and one `xstockstrat-ui` data-explorer edit. Per the approved
design, **`xstockstrat-analysis` and `xstockstrat-indicators` need NO code change** — analysis passes
marketdata's field values through verbatim (`servicer.py:5481`, recon:38) and the formula bands are
tunable params (recon:41). The build order follows the data-flow: fix the ingester (currency → D/E →
P/B → dividend), then repoint the snapshot, then seed config, then surface in the UI, then author the
new marketdata acceptance coverage that closes the C-16 blind spot.

**Consumer surfaces (C-14).** Product spec names two:
- **UI `/insights/data-explorer`** — reached by **Step 13/14** (currency + source provenance + CSV;
  the three metrics `pb_ratio`/`dividend_yield`/`debt_to_equity` are **already** in `FUNDAMENTAL_METRICS`
  from feature 204, so this step adds provenance/CSV, not the metrics themselves — see Step 13 evidence).
- **Agent `query_fundamentals`** — **no step required, and this is a decision, not an omission**: the tool
  already returns per-period `currency`, `source`, and the full metric set; no proto field is added
  (§ Proto Contract Changes = none), so the agent descriptor-parity projection test (fails.md 2026-08-13,
  feature 134) cannot break, and enriched values flow through unchanged. Verified as a surface in
  `design.md` § Chosen Approach. The `strat-lab` plugin (`plugins/strat-lab/`) `backtest` skill covers
  `run_backtest`/`manage_strategy`/`trigger_backfill`/`set_strategy_live` — **none** of whose contracts
  this feature changes — so no same-PR plugin update is owed.

**Two open risks carried from `design.md`, resolved/narrowed here (P-03, no fragile full-stack test):**
1. **XBRL debt-tag + USD-fact coverage — RESOLVED at spec time by a direct SEC companyfacts fetch**
   (BABA CIK 0001577552 20-F, AXP 0000004962 financial-sector, AAPL 0000320193 plain US-GAAP;
   `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`, 2026-09-26). Findings **correct the
   design's guessed tag list** and require operator sign-off on `@AC-2` wording — see Step 4 Codebase
   Evidence and the § Acceptance-wording corrections block below.
2. **Alpaca corporate-actions entitlement (gates FR-4/@AC-5 only) — NOT verifiable in this session**
   (no Alpaca credentials here). Narrowed to a direct-API check that is the **first action of Step 8**
   (a real `GET data.alpaca.markets/v1/corporate-actions?types=cash_dividend` in isolation), never a
   deployed-instance `grpcurl` smoke (fails.md 2026-08-13, feature 129). If the plan's data feed is
   unentitled, FR-4/`@AC-5` is explicitly descoped with operator sign-off (never a silent `@AC-5` pass
   while `dividend_yield` renders "—"); FR-1/2/3/5/6/8 proceed regardless and symmetric-missing dividend
   preserves `@AC-9`.

**Deployment files unaffected**: no new env var or port is introduced (Alpaca creds resolve via the
existing `GetSecret` path; EDGAR is keyless; the dividend feed reuses `data.alpaca.markets`). Confirmed
absent-of-need — no `docker-compose.yml` / `.do/app*.yaml` edits in any step.

## Scenario Coverage (Constitution C-15)

| Scenario | FRs | Covered by step(s) |
|---|---|---|
| @AC-1 (CNY reporting currency captured) | FR-1 | Step 3 (test) |
| @AC-2 (financial-debt D/E, not total-liabilities) | FR-2 | Step 5 (test) — **@AC-2 figures need wording correction, see below** |
| @AC-3 (financial-sector filer non-zero D/E sub-score) | FR-2 | Step 5 (test) |
| @AC-4 (PIT P/B at filing boundary, no look-ahead) | FR-3, FR-7 | Step 7 (test) |
| @AC-5 (T12M dividend yield excludes post-filing) | FR-4, FR-7 | Step 9 (test) — **contingent on Step 8 Alpaca entitlement** |
| @AC-6 (EDGAR-canonical snapshot after vendors disabled) | FR-5, FR-8 | Step 11 (test) |
| @AC-7 (non-SEC-filer falls back to vendor) | FR-5 | Step 11 (test) |
| @AC-8 (data explorer shows enriched metrics + currency + source) | FR-6 | Step 14 (Playwright) |
| @AC-9 (backtest PIT composite = live snapshot band) | FR-1/2/3/4 | Step 15 (acceptance) |

## Acceptance-wording corrections (C-15 / P-03 — require operator sign-off at /sdd-execute)

The direct SEC fetch (2026-09-26) shows the load-bearing assertions of `@AC-2` hold (financial-debt D/E
is far below `de_bad=2.0`, not the total-liabilities ratio) but its **illustrative figures are stale**:
- `@AC-2` states BABA "total Liabilities of 714,121M, StockholdersEquity of 153,796M, and financial debt
  … of roughly 45,000M" and D/E "on the order of 0.3". The **actual FY2026** filing (end 2026-03-31)
  reports StockholdersEquity **USD 153,796M** (matches) / CNY 1,060,886M; Liabilities **USD 113,555M** /
  CNY 783,300M (not 714,121M); and BABA's only recent financial-debt tag is `ConvertibleDebtNoncurrent`
  **USD 8,098M** (DebtCurrent/ShortTermBorrowings stopped after FY2018/FY2019), giving financial-debt D/E
  ≈ **0.05**, not 0.3.
- **Recommended correction (operator sign-off, recorded in `context.md`):** update `@AC-2` to the real
  FY2026 numbers (financial debt ≈ 8,098M USD, D/E ≈ 0.05) OR relax it to the direction-only assertion
  ("financial-debt D/E ≪ de_bad=2.0, not the ~4.6/total-liabilities figure"). `@AC-3` (AXP) and `@AC-4`
  (BABA dual-reports a USD-unit equity) are **validated as written** and need no correction.
- Because `acceptance.feature` `@AC-*` IDs are append-only and test steps cite them, do this as a wording
  edit to the existing `@AC-2` block (not a renumber), at the start of `/sdd-execute` Step 5.

---

## Step Dependencies

- **Step 1** (marketdata migration `006`) is independent; land first so Step 8/9 can write/read the store.
- **Step 2→4→6** are sequential edits to the same ingester files (`edgar_client.go` then `priceJoin`):
  currency capture (Step 2) is the prerequisite for currency-consistent D/E (Step 4) and P/B (Step 6).
- **Step 8** (dividend feed) requires **Step 1** (the `dividend_actions` table) and begins with the
  Alpaca-entitlement direct check (Open Risk 2). Its yield compute reuses the currency work from Step 2.
- **Step 10** (snapshot dispatch + FR-8 disable-safety) requires **Steps 2/4/6** (the EDGAR snapshot
  builder reads the same enriched period the ingester writes) and is the FR-8 literal-audit chokepoint.
- **Step 12** (config seed) declares the keys Step 10 reads; land it in the same PR set so a deploy has
  the rows. **Runtime cutover is a rollout sequence, not a migration** — see Step 12 rollout note.
- **Step 13/14** (UI) depend only on the proto fields (already present) — independent of the Go build.
- **Step 15** (acceptance coverage, C-16) is authored last, over the landed behavior; `@AC-9` validation
  is a narrow same-convention assertion, never a full-stack smoke (fails.md 2026-08-13).
- Test steps 3/5/7/9/11 each pair the immediately preceding `service` step (C-08); each is written to
  fail red before its implementation step and pass after (P-06).

---

### Step 1 — migration: dividend/corporate-actions store (`marketdata.dividend_actions`)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/006_dividend_actions.up.sql` — create
- `services/xstockstrat-marketdata/migrations/006_dividend_actions.down.sql` — create

**Reviewers**: DBA — migration NNN numbering + up/down pair present, plain-table (non-hypertable) choice; `xstockstrat-marketdata` owner — fundamentals/Alpaca feed idempotency

**Codebase Evidence**:
- Confirmed next-free number via `ls services/xstockstrat-marketdata/migrations/` → last is `005_fundamentals_history.{up,down}.sql`; next = **`006`** (C-07).
- Convention (plain audit-style table, not hypertable) precedent: `services/xstockstrat-marketdata/migrations/003_canonicalize_ohlcv_timeframe.up.sql` creates `marketdata.ohlcv_remediation_003` as a **plain table** (CLAUDE.md § Database) — the model for a small keyed store that is not time-partitioned.
- Schema `marketdata`; migrations run via `scripts/db-migrate.sh` (golang-migrate), CLAUDE.md § Database.

**TDD**: `N/A (migration — offline, no-DB verification per template)`

**Covers**: —

**Instructions**:
- `006_dividend_actions.up.sql`: `CREATE TABLE IF NOT EXISTS marketdata.dividend_actions (symbol TEXT NOT NULL, ex_date DATE NOT NULL, pay_date DATE, cash_amount DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', source TEXT NOT NULL DEFAULT 'alpaca', fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (symbol, ex_date));` Plain table (design point 4 — not a hypertable; the row count per symbol is tiny). The `(symbol, ex_date)` PK gives idempotent upsert (Alpaca-feed idempotency, marketdata review focus). No index beyond the PK is needed — every read is `WHERE symbol = $1 AND ex_date <= $2` which the PK's leading column + range serves.
- `006_dividend_actions.down.sql`: `DROP TABLE IF EXISTS marketdata.dividend_actions;`
- Do NOT edit any applied migration (F-01) — this is a new numbered pair.

**Verification** (offline, no DB — per template):
```
ls services/xstockstrat-marketdata/migrations/006_dividend_actions.up.sql services/xstockstrat-marketdata/migrations/006_dividend_actions.down.sql
# read both: confirm the .up CREATE TABLE has an inverse DROP TABLE in .down, and NNN=006 is next-free
```

---

### Step 2 — service: currency capture + unit-aware EDGAR aggregator (FR-1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals ingestion integrity; `xstockstrat-analysis` owner — no look-ahead bias (currency capture must not perturb the `filed_date`/idempotency pin)

**Codebase Evidence**:
- The aggregator `periodAgg.vals map[string]float64` is declared at `internal/edgar/edgar_client.go:186`; it is filled at `:262-264` with a **first-seen** value (`if _, seen := agg.vals[name]; !seen { agg.vals[name] = d.Val }`) over a nondeterministic Go-map range.
- The XBRL **unit key is discarded** at `:222` (`for _, unit := range entry.Units { for _, d := range unit {`) — the map key (`USD`/`CNY`/`USD/shares`) is never read.
- Currency is **hardcoded** `"USD"` in `buildPeriod` at `:317` (`Currency: "USD"`).
- The earliest-filing idempotency pin is at `:251-254` (`if filed.Before(agg.filed) { agg.filed = filed }`).
- Direct SEC evidence (2026-09-26): BABA (CIK 0001577552) reports `StockholdersEquity`, `Liabilities`, `DebtCurrent`, `ShortTermBorrowings`, `ConvertibleDebtNoncurrent` under **both `CNY` and `USD`** unit keys (a USD convenience translation alongside the native CNY statements); AXP/AAPL report `USD` only. EPS tags carry the compound `USD/shares` unit.

**TDD**: `red-green required`

**Covers**: — (paired test is Step 3)

**Instructions**:
- Reshape the per-metric accumulator so it is **unit-keyed**: change `periodAgg.vals` to carry a unit dimension (design point 1: `map[metric]map[unit]float64` or an equivalent `{unit,val}` per metric), preserving the existing first-seen-per-(metric,unit) semantics so a re-backfill stays deterministic.
- In the `:222` loop, capture the map key `unit` (currently the loop var name that is iterated but whose key is dropped) and store the datum under `(name, unitKey)`.
- Compute the row `currency` (design point 1): the unit code covering the **most monetary facts** for the period, **excluding compound per-share units** (`USD/shares` from EPS) from the count, with a **lexical tiebreak** (so BABA's equal-count CNY/USD resolves to `CNY` — `"CNY" < "USD"`; this is what makes `@AC-1` hold, and BABA's full statements are CNY-dominant anyway). Replace the hardcoded `"USD"` at `:317` with this computed value; keep `"USD"` only as the fallback when a period carries no monetary fact at all.
- **Pin currency to the earliest-filing unit set** (extend the `:251-254` earliest-`filed_date` pin) so a re-backfill cannot flip a stored period's currency (design point 1; a genuine later-amendment restatement is a documented accepted residual — manual purge + re-backfill).
- Downstream consumers of `agg.vals` (`buildPeriod` ratio math at `:334-346`, the `extra_metrics` spill at `:347-352`) must read the **native-currency** value of each metric (the row-`currency` unit) so absolute facts stay single-currency; the USD-unit value is retained separately for the P/B step (Step 6) — stash the USD-unit `stockholders_equity` into `ExtraMetrics["stockholders_equity_usd"]` when the filing dual-reports one (design point 3 needs it).
- Comment cap 2 lines; state the lexical-tiebreak invariant only (it is load-bearing for `@AC-1`).
- Run the Go lint gate (see Step 3 verification).

**Verification**: covered by Step 3 (paired test) — build + unit tests + lint.

---

### Step 3 — test: currency-capture unit tests (@AC-1)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals ingestion integrity

**Codebase Evidence**:
- Existing Go test file: `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` (confirmed present via `ls internal/edgar/*_test.go`). No `internal/testdata/` dir exists yet — a `companyFacts` JSON fixture is a **first** consumer, so it stays inline in the test (C-13: centralize only on a second consumer).
- The fetch parses the SEC `companyfacts` shape (`companyFacts`/`unitDatum` types in `edgar_client.go`); a fixture builds that shape directly (real struct, no `MagicMock` equivalent — Go has none, but the rule's spirit: real parsed structs).

**TDD**: `red-green required` — written to fail against the pre-Step-2 tree (which hardcodes `"USD"`).

**Covers**: `AC-1`

**Instructions**:
- Add a test that feeds a `companyFacts` fixture with a period whose monetary facts (`StockholdersEquity`, `Liabilities`) appear under unit key `"CNY"` (and a USD convenience copy) and whose EPS appears under `"USD/shares"`; assert the produced `HistoricalFundamentalsPeriod.Currency == "CNY"` (per-share units excluded from the count; lexical tiebreak). This asserts `@AC-1`'s "currency CNY, no longer unconditionally USD".
- Add a US-GAAP-only fixture (USD facts) asserting `Currency == "USD"` (regression: single-currency filers unchanged).
- Add a re-ingest determinism assertion: running the aggregation twice yields the same `Currency` (the earliest-filing pin).

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/edgar/... -race -count=1
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/edgar/...
# then the service coverage gate (new logic is in internal/edgar, a measured package):
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# confirm ≥ 40%
```

---

### Step 4 — service: financial-debt D/E tag allow-list + summation (FR-2)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals ingestion integrity; `xstockstrat-analysis` owner — no look-ahead bias (D/E computed from the filing itself, no TTM/snapshot fill)

**Codebase Evidence**:
- The instant-tag allow-list is `instantTags` at `internal/edgar/edgar_client.go:164-170` (currently `StockholdersEquity`, `Liabilities`, `Assets`, `CommonStockSharesOutstanding`/`EntityCommonStockSharesOutstanding`→`shares`). Untracked tags are dropped at `:219` (`if !isFlow && !isInstant { continue }`) — **debt line items are never captured today** (recon:23).
- The D/E computation is `debt_to_equity = liabilities/equity` at `:341-346` (`if liab, ok := a.vals["liabilities"]; ok { if eq, ok2 := a.vals["stockholders_equity"]; ok2 && eq != 0 { de := liab / eq …`).
- **Direct SEC evidence (2026-09-26) — the grounded tag set (corrects design's guessed list):**
  - **BABA FY2026** (us-gaap, NOT IFRS): only `ConvertibleDebtNoncurrent` (USD 8,098M / CNY 55,861M) is present recently; `DebtCurrent`/`ShortTermBorrowings` stopped after FY2018/FY2019; no `LongTermDebt*`.
  - **AXP FY2025**: `LongTermDebt` (56,387M) + `ShortTermBorrowings` (1,371M); no `LongTermDebtNoncurrent`/`LongTermDebtCurrent`/`DebtCurrent`. `SeniorNotes` is stale (FY2015) — do NOT sum (double-counts LongTermDebt).
  - **AAPL FY2025**: `LongTermDebtNoncurrent` (78,328M) + `LongTermDebtCurrent` (12,350M) = `LongTermDebt` (90,678M); plus `CommercialPaper` (7,979M).
  - **All three report under `us-gaap`** — the design's `ifrs-full:*` allow-list is **unnecessary for the acceptance filers**; omit it (C-18/YAGNI — no named filer uses IFRS; a future non-us-gaap filer is a separate feature). Record this design-correction in `context.md`.

**TDD**: `red-green required`

**Covers**: — (paired test is Step 5)

**Instructions**:
- Extend `instantTags` (`:164-170`) with the verified us-gaap debt concepts, each mapped to its own accumulator key: `LongTermDebtNoncurrent`, `LongTermDebtCurrent`, `LongTermDebt`, `DebtCurrent`, `ShortTermBorrowings`, `CommercialPaper`, `ConvertibleDebtNoncurrent`. (These are instant/balance-sheet facts.)
- In `buildPeriod`, compute `total_debt` with a **no-double-count** summation, read in the row's native currency (Step 2):
  - `ltd = (LongTermDebtNoncurrent + LongTermDebtCurrent)` when **either** component is present (AAPL); **else** `LongTermDebt` (AXP); **else** 0.
  - `total_debt = ltd + ShortTermBorrowings + DebtCurrent + CommercialPaper + ConvertibleDebtNoncurrent` (each 0 when absent).
  - Verified: AAPL 98,657/73,733 ≈ 1.34; AXP 57,758/33,474 ≈ 1.73 (< de_bad 2.0 ⇒ non-zero sub-score, `@AC-3`); BABA FY2026 8,098/153,796 ≈ 0.05 (≪ 2.0, `@AC-2`).
- Replace the `liabilities/equity` D/E at `:341-346` with `debt_to_equity = total_debt / stockholders_equity` (financial-debt convention). When `total_debt` cannot be formed (no debt tag present), leave `DebtToEquity` **nil** (→ `missing_metrics`, never a fabricated 0 — preserves `@AC-22 @feature-204`).
- Store `total_debt` in `ExtraMetrics["total_debt"]` (design point 2; the `fundamentals_history` `extra_metrics` JSONB already exists, recon:56).
- Keep `roe = net_income/stockholders_equity` at `:335-339` unchanged (design § Open Risks ROE note — EDGAR ending-equity ROE is canonical for both surfaces once vendors are disabled).

**Verification**: covered by Step 5 (paired test).

---

### Step 5 — test: financial-debt D/E unit tests (@AC-2, @AC-3)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals ingestion integrity

**Codebase Evidence**:
- Same test file as Step 3. Fixtures are the real `companyFacts` struct (no `MagicMock`; fails.md 2026-08-06 spirit). Debt-tag fixtures remain inline (first consumer; C-13).

**TDD**: `red-green required` — fails against pre-Step-4 tree (which computes `liabilities/equity`).

**Covers**: `AC-2, AC-3`

**Instructions**:
- **@AC-2 (BABA):** fixture with FY-period `StockholdersEquity` (CNY native + USD convenience) and `ConvertibleDebtNoncurrent`; assert `DebtToEquity` uses `total_debt/equity` (financial-debt), lands ≪ `de_bad=2.0`, and `ExtraMetrics["total_debt"]` equals the summed convertible-debt figure. Use the **corrected FY2026 numbers** (financial debt ≈ 8,098M USD, D/E ≈ 0.05) once the `@AC-2` wording correction is signed off (see § Acceptance-wording corrections); assert the value is not the ~4.6/total-liabilities figure.
- **@AC-3 (AXP financial-sector):** fixture with `Liabilities` ≫ equity (total-liab D/E ≈ 7.96, would exceed `de_bad=2.0`) but `LongTermDebt` + `ShortTermBorrowings` giving financial-debt D/E ≈ 1.73; assert the computed `DebtToEquity` ≈ 1.73 (below `de_bad`, so it produces a non-zero D/E quality sub-score — `@AC-3`). Assert the no-double-count rule (a fixture carrying both `LongTermDebt` and `LongTermDebt{Noncurrent,Current}` sums components once, not twice).
- Add an AAPL-shape fixture asserting `ltd = Noncurrent+Current` + `CommercialPaper`.
- Add a no-debt-tag fixture asserting `DebtToEquity` is nil → present in `missing_metrics` (never 0).

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/edgar/... -race -count=1
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/edgar/...
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# confirm ≥ 40%
```

---

### Step 6 — service: currency-consistent P/B (and P/E fix) at the filing boundary (FR-3, FR-7)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals ingestion integrity; `xstockstrat-analysis` owner — **no look-ahead bias** (price-at-filing only)

**Codebase Evidence**:
- `priceJoin` is at `internal/service/marketdata_service.go:1630-1668`; it sets `Price` (`:1659`), `MarketCap = price × SharesOutstanding` (`:1660-1663`), `PERatio = price / ttmEPS` (`:1664-1667`). It fetches `close` via `s.histRepo.CloseAt(ctx, p.Symbol, p.FiledDate)` at `:1650` — the adjusted close **at `filed_date`** (already public), and returns early leaving metrics nil when the bar is missing (`:1655-1657`, fail-closed). This is the reuse target (recon:54).
- `market_cap`/`price` are always the **trading currency (USD)** — the ADR trades in USD; `SharesOutstanding` × USD close is a USD market cap.
- Step 2 stashes `stockholders_equity_usd` in `ExtraMetrics` when the filing dual-reports a USD equity fact (BABA does; confirmed 2026-09-26).
- `HistoricalFundamentalsPeriod.PBRatio *float64` exists (`internal/source/source.go:84`); `Currency` at `:96`.

**TDD**: `red-green required`

**Covers**: — (paired test is Step 7)

**Instructions**:
- In `priceJoin`, after `MarketCap` is set and when `p.MarketCap != nil`, compute `PBRatio` **option-b** (design point 3): use a **USD-unit** stockholders-equity value so numerator and denominator are both USD:
  - if `ExtraMetrics["stockholders_equity_usd"]` is present and > 0 → `PBRatio = *MarketCap / equity_usd`;
  - else if the row `Currency == "USD"` (US filer; native equity is already USD) → `PBRatio = *MarketCap / stockholders_equity` (native);
  - else leave `PBRatio` **nil** → `missing_metrics` (honest; no FX; preserves `@AC-22`). BABA satisfies branch 1 (`@AC-4`).
- Apply the **same currency rule to the existing `PERatio`** (`:1664-1667`): `ttmEPS` must be USD to divide a USD `close` — use the USD-unit EPS when present, else native EPS only when `Currency == "USD"`, else nil. (design point 3 — fixes the currency-blind P/E in the same edit.)
- Do **not** add any read of a price observed after `filed_date` — `CloseAt(p.Symbol, p.FiledDate)` is the only price source (FR-7; preserves `@AC-1..3 @feature-151` and `@AC-14 @feature-095`).
- No new outbound gRPC call is added (P/B reuses the existing `CloseAt` repo read) — header-propagation constraint N/A.

**Verification**: covered by Step 7 (paired test).

---

### Step 7 — test: PIT P/B unit tests, real Bar fixtures, no look-ahead (@AC-4)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner; `xstockstrat-analysis` owner — no look-ahead bias

**Codebase Evidence**:
- Existing test file `internal/service/marketdata_service_test.go` (present via `ls`); it exercises the fundamentals path (recon:92 notes `marketdata_service_test.go:430-451` drives the `.enabled` gate). The `CloseAt` dependency is a `histRepo` interface method — inject a fake `histRepo` returning a controlled close (the interface-seam test pattern, insights.md 2026-08-06 reuse). Any `Bar`/price fixture is a real value, never a mock stand-in (fails.md 2026-08-06 — real proto instances).

**TDD**: `red-green required` — fails against pre-Step-6 tree (no `PBRatio`).

**Covers**: `AC-4`

**Instructions**:
- Feed a `HistoricalFundamentalsPeriod` with `SharesOutstanding`, native CNY `stockholders_equity`, and `ExtraMetrics["stockholders_equity_usd"]`, `FiledDate = 2025-06-26`; a fake `histRepo.CloseAt` returns the price **as of 2025-06-26** only (and would return a *different* value for any later date — assert the later value is never used). Assert `PBRatio == market_cap / stockholders_equity_usd` in one consistent currency (`@AC-4`).
- Assert **no look-ahead**: a fake `CloseAt` that records the date argument confirms only `2025-06-26` was queried (never a post-filing date).
- Assert the currency-mismatch fallback: a period with only CNY equity (no USD fact) and non-USD currency → `PBRatio` nil → in `missing_metrics`.
- Assert P/E currency rule (USD close / USD EPS; nil when EPS currency unknown).

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/...
```
Note: new logic in `internal/service/` — an **excluded** package for CI coverage measurement (see template coverage table `grep -Ev '…/service…'`); the coverage-threshold command is still run at Step 5/9 for the measured `internal/edgar`/`internal/alpaca` packages, and this behavior is proven by the unit test above. A `test` step is still required (this step).

---

### Step 8 — service: Alpaca corporate-actions dividend feed + PIT T12M yield (FR-4, FR-7)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (dividend upsert + trailing-window read)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (wire dividend source, compute yield in backfill)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (pass the dividend source into the service)

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency; `xstockstrat-analysis` owner — **no look-ahead** (only dividends with ex/pay ≤ `filed_date`, within a fixed T12M window)

**Codebase Evidence**:
- Alpaca client: `internal/alpaca/client.go` — `ClientConfig` has `DataURL` (`:32`, `https://data.alpaca.markets`) and `APIKey`/`APISecret` (`:29-30`); `do()` sets `APCA-API-KEY-ID`/`APCA-API-SECRET-KEY` and waits on the rate limiter (`:83-92`). Existing REST methods (`GetBars` `:164`, `GetLatestQuotesMulti` `:407`) are the shape template for a new `GetCashDividends`.
- Credentials resolve via `GetSecret` at boot (`cmd/server/main.go:78-79` `resolveSecret("alpaca.api_key")`/`("alpaca.api_secret")`), passed into `alpaca.NewClient` (`:84-100`). The dividend fetch reuses this exact client → **PRESERVE `@AC-6/@AC-7 @feature-147`** (missing credential warns, service still starts, `main.go:104-110`).
- The Alpaca client is registered in the source registry (`main.go:120` `reg.Register("alpaca", alpacaClient)`) but **not** passed to `NewMarketDataService` (`main.go:136`). Precedent for adding a client param: feature 198 added `edgarClient` as the last `NewMarketDataService` arg (`main.go:130-136`). Mirror that — add a `dividendSrc` param (a small `DividendSource` interface, SOLID seam like the existing `ratioEnricher` interface at `marketdata_service.go:116`).
- Backfill entrypoint: `backfillOneSymbol` at `marketdata_service.go:1600` iterates chronologically sorted periods (`:1606`) and calls `priceJoin` per period (`:1611`). The yield compute hangs here (per-symbol dividend fetch once, then per-period T12M sum).
- `UpsertFundamentals` idempotent-upsert pattern (`internal/repository/marketdata_repo.go:483`, `ON CONFLICT … DO UPDATE`) is the model for `UpsertDividends`; the `extraJSONText` string-bind note (`:491-493`) is the PgBouncer `QueryExecModeExec` gotcha to respect for any jsonb — not needed here (no jsonb column).

**TDD**: `red-green required`

**Covers**: — (paired test is Step 9)

**Instructions**:
- **FIRST — Alpaca entitlement direct check (Open Risk 2, narrow — NOT a deployed smoke, fails.md 2026-08-13):** with the resolved Alpaca creds, make one direct `GET {DataURL}/v1/corporate-actions?types=cash_dividend&symbols=<a dividend payer>&start=<~13mo ago>&end=<today>` in isolation (a throwaway `main` or a `-run` integration test guarded by an env flag) and confirm the plan returns cash-dividend rows. **If unentitled** (HTTP 4xx / empty on the paper/basic plan): STOP, escalate to the operator (P-03), and descope FR-4/`@AC-5` with sign-off recorded in `context.md` — never ship a silent `@AC-5` pass. FR-1/2/3/5/6/8 proceed. If entitled, continue.
- **Alpaca client** (`client.go`): add `GetCashDividends(ctx, symbol, start, end) ([]source.CashDividend, error)` hitting `{DataURL}/v1/corporate-actions` filtered to `cash_dividend`, paginating like `GetBars` (`:173-207`), returning `{ExDate, PayDate, CashAmount, Currency}` per payment. Define `source.CashDividend` + a `DividendSource` interface in `internal/source/source.go` (next to `HistoricalFundamentalsSource` at `:100-105`).
- **Repo** (`marketdata_repo.go`): add `UpsertDividends(ctx, []CashDividend)` (idempotent `INSERT … ON CONFLICT (symbol, ex_date) DO UPDATE`) and `SumDividendsInWindow(ctx, symbol, asOf, windowStart) (float64, bool)` returning `Σ cash_amount WHERE symbol=$1 AND ex_date <= asOf AND ex_date >= windowStart`, plus a bool = "the feed had ≥1 row for this symbol at all" so a genuine no-dividend payer emits `0`, not `missing` (design point 4; `@AC` note — never conflate no-payments with unentitled-feed).
- **Service** (`marketdata_service.go`): add a `dividendSrc DividendSource` field (nil-safe like `ratioEnricher`). In `backfillOneSymbol`, gate on `marketdata.dividends.enabled` (Step 12 key); when on and `dividendSrc != nil`, fetch the symbol's dividends once over `[now - marketdata.dividends.backfill_lookback_years, now]`, `UpsertDividends`, then for each period compute `dividend_yield = SumDividendsInWindow(symbol, filed_date, filed_date-365d) / price_at_filing` (the `Price` set by `priceJoin`, USD/USD-consistent for a US ADR — Alpaca reports the ADR's actual USD distribution). Emit **0** when the window sum is 0 **and** the feed had rows; leave `DividendYield` **nil** (→ missing) when the feed is absent/disabled/unentitled. No payment with `ex_date > filed_date` may contribute (FR-7).
- **main.go**: construct the dividend source from the existing `alpacaClient` and pass it as a new `NewMarketDataService` arg (mirror the `edgarClient` addition at `:130-136`). No new env var/secret (reuses the resolved Alpaca creds).
- Lint gate at Step 9.

**Verification**: covered by Step 9 (paired test) + the Step-8 direct entitlement check above.

---

### Step 9 — test: dividend feed + T12M yield unit tests (@AC-5)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — Alpaca feed idempotency; `xstockstrat-analysis` owner — no look-ahead

**Codebase Evidence**:
- Alpaca client tests exist: `internal/alpaca/client_test.go` (present via `ls`); a fake HTTP server / response fixture is the existing test shape. The yield-compute test injects a fake `DividendSource` + fake `histRepo` into the service (interface-seam pattern, insights.md 2026-08-06).

**TDD**: `red-green required` — fails against pre-Step-8 tree (no dividend yield). If FR-4 was descoped at Step 8, this step is marked `skipped` with the operator sign-off cited (and `@AC-5` correspondingly descoped in `acceptance.feature`).

**Covers**: `AC-5`

**Instructions**:
- **@AC-5 exact scenario:** dividends paid `2024-08-01`, `2025-02-01`, `2025-08-15`; filing `filed 2025-06-26`. Assert `SumDividendsInWindow(symbol, 2025-06-26, 2024-06-26)` sums **only** `2024-08-01` + `2025-02-01` (both ≤ filed_date and ≥ filed_date−365d); the `2025-08-15` payment is **excluded** (post-filing, FR-7). Assert `dividend_yield = that sum / price_at_filing`.
- Assert the 0-vs-missing distinction: a feed returning rows but none in-window → `0`; a nil/disabled `dividendSrc` → `DividendYield` nil → `missing_metrics`.
- Assert `GetCashDividends` parses the Alpaca corporate-actions JSON (fake HTTP response) into `CashDividend` values and `UpsertDividends` is idempotent on `(symbol, ex_date)`.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/alpaca/... ./internal/service/... -race -count=1
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/alpaca/... ./internal/service/...
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# confirm ≥ 40% (internal/alpaca is a measured package)
```

---

### Step 10 — service: EDGAR-canonical snapshot dispatch + FR-8 disable-safety (FR-5, FR-8)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (source-aware cache invalidation only if needed — see instructions)

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals serving integrity; `xstockstrat-analysis` owner — no look-ahead (live price-join feeds only the live surface); `xstockstrat-config` owner — the `snapshot_source`/`edgar.enabled` dispatch reads

**Codebase Evidence**:
- Both snapshot RPCs gate on the same helpers: `GetFundamentals` (`marketdata_service.go:1268`) → `fundamentalsEnabled()` (`:1272`) → `resolveFundamentals` (`:1347`); `GetFundamentalsMulti` (`:1284`) → `fundamentalsEnabled()` (`:1285`) + `fundamentalsQuota()` (`:1310`). C-10(b) requires dispatching **both** identically with a parity test.
- **FR-8 literal-audit chokepoints (the fallthrough-to-false trap, fails.md 2026-08-13):**
  - `fundamentalsEnabled()` at `:1381-1386` reads `s.fundCfg.GetBool("marketdata."+s.fundProvider+".enabled", false)` — the `false` default is the exact trap.
  - `fundamentalsQuota()` at `:1390-1403` switches on `s.fundProvider` (`finnhub` rolling window / default FMP daily cap).
  - `toProtoFundamentals` empty-source fallback `src = s.fundProvider` at `:1460-1463`.
  - Repo write empty-source default `src = "fmp"` at `internal/repository/marketdata_repo.go:494-497` — the EDGAR builder must set `Source="edgar"` explicitly so this default never fires (tested invariant).
- The EDGAR snapshot read is the existing `GetHistoricalFundamentals` (`:1512`) + `filterAsOf` (`:1543`, T+1) — "latest filing as-of now" (recon:60). The write-through cache table is `marketdata.fundamentals` via `UpsertFundamentals` (`:483`).
- Live price for the snapshot: `GetLatestQuotes` (batch, singleflight-coalesced, feature 178) at `marketdata_service.go:475` (CLAUDE.md § Alpaca `GetLatestQuotes`).
- Boot provider switch: `newFundamentalsSource` at `main.go:195` has `default: → fmp` (`:201`) — the design wants this made an explicit switch (unknown provider → boot-fatal); the EDGAR snapshot builder constructs **no** client (it reads stored history + live quote), so a live-read `snapshot_source` is safe (no restart).
- Existing kill-switch precedent: `marketdata.fundamentals.history.enabled` gate at `BackfillFundamentals:1558` (`GetBool(..., false)`).

**TDD**: `red-green required`

**Covers**: — (paired test is Step 11)

**Instructions** (design point 5 — implement exactly):
- Add a live-read dispatch axis read from `marketdata.fundamentals.snapshot_source` (`edgar`|`vendor`) at the top of **both** `GetFundamentals` and `GetFundamentalsMulti`. Share one **EDGAR snapshot builder**: latest `fundamentals_history` period (via `GetHistoricalFundamentals` + `filterAsOf`) + a **live** price from `GetLatestQuotes`, `UpsertFundamentals`-cached (write-through) with a new `marketdata.edgar.cache_ttl_hours` TTL — steady state = one indexed read/symbol (F-06; avoids the feature-141 N-scan OOM, insights/fails 141).
- The builder sets `Source = "edgar"` explicitly (guards the repo `→"fmp"` default at `marketdata_repo.go:494`) and computes snapshot `debt_to_equity` with the **same financial-debt convention** as the historical periods (it reads the same stored period — `@AC-6`).
- **Dispatch the two vendor-keyed guards on `snapshot_source`:** when `edgar`, `fundamentalsEnabled()` gates on `marketdata.edgar.enabled` (read with an explicit **`true`** default — feature-100 `GetBool` zero-value trap, fails.md 2026-08-06/insights 1606) and `fundamentalsQuota()` is bypassed (EDGAR has no vendor quota). `marketdata.edgar.enabled=false` ⇒ `FailedPrecondition` + WARN (deliberate kill switch). When `vendor`, the existing FMP/Finnhub path is unchanged.
- **Non-SEC-filer fallback (`@AC-7`):** fire when **no EDGAR snapshot is producible** (zero `fundamentals_history` periods — covers CIK-miss AND no-backfilled-history — OR the latest period carries none of the core metrics) and route to the explicit vendor **only while that vendor is enabled**; set `Source` to the vendor name so `@AC-7`'s "source marks the row vendor-sourced, not edgar" holds. A CIK-known-but-zero-history miss WARNs even when the vendor is taken (don't mask a backfill gap as non-SEC).
- **Cache invalidation is source-aware** via a provider→axis mapping (`edgar⇒edgar`; `fmp`/`finnhub`⇒`vendor`; `edgar+fmp`⇒`edgar`), NOT string inequality — so a cutover self-heals a stale vendor cache row in one call (no purge migration; the one-time purge is the recorded fallback if the `source` column proves unreliable — design § Rejected Alternatives). Verify the `source` column is reliably populated (Step 10 reads `UpsertFundamentals`/`toProtoFundamentals`); if NULL/empty rows exist, fall back to the recorded one-time purge.
- **main.go:** make `newFundamentalsSource`'s `default:` an explicit switch — unknown `provider` → boot-fatal (`os.Exit`); an unknown `snapshot_source` fails loud (F-07). Do NOT delete the FMP/Finnhub client code (out of scope — deferred to a named follow-up, product spec § Out of Scope).
- **FR-8 audit output:** in the PR body, enumerate every `marketdata.fmp.*`/`marketdata.finnhub.*` literal read and provider-named string in `marketdata_service.go`/`main.go` (the sites cited above + recon:92) and confirm the EDGAR-canonical path is the **active** source when both vendors are off — never a fallthrough to the `false`/`"fmp"` default (FR-8; the exact feature-129 failure).
- No new outbound gRPC call (the live quote reuses `GetLatestQuotes`, an in-service method) — header propagation N/A.

**Verification**: covered by Step 11 (paired test).

---

### Step 11 — test: snapshot dispatch / disable-safety / parity unit tests (@AC-6, @AC-7)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals serving integrity

**Codebase Evidence**:
- `marketdata_service_test.go` already drives the `.enabled` gate live (recon:92, `:430-451`) — extend it. Fakes: a fake `histRepo` (stored periods), a fake fundamentals source (vendor), and a controllable `fundCfg` — the zero-value `config.Watcher` returns the `GetBool`/`GetString` default (insights.md 2026-08-06/1606: `&config.Watcher{}` suffices to prove fail-closed/default wiring). Real values, no mock stand-ins (fails.md 2026-08-06).

**TDD**: `red-green required` — fails against pre-Step-10 tree (no `snapshot_source` dispatch).

**Covers**: `AC-6, AC-7`

**Instructions**:
- **@AC-6:** with `snapshot_source=edgar`, `finnhub.enabled=false`, `fmp.enabled=false`, `edgar.enabled=true`, a stored `fundamentals_history` period for BABA and a live quote → assert the returned snapshot is derived from the latest EDGAR period + live price, `Source=="edgar"`, `debt_to_equity` uses the financial-debt convention (same value as the stored period), and fundamentals are **still served** (no fallthrough to empty/false — the FR-8 assertion).
- **Parity (C-10(b)):** assert `GetFundamentals(sym)` and `GetFundamentalsMulti([sym])` return the same snapshot for the same symbol under `snapshot_source=edgar`.
- **@AC-7:** a symbol with **zero** stored EDGAR periods, `snapshot_source=edgar`, and an enabled vendor → assert the vendor fallback supplies the snapshot and `Source` is the vendor name (not `edgar`). Assert the CIK-known-zero-history WARN path.
- **Kill switch:** `edgar.enabled=false` under `snapshot_source=edgar` → `FailedPrecondition` (deliberate all-off).
- **Source-aware cache self-heal:** a stale cached row with `source` in the vendor set is re-derived on the next `edgar` read.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -race -count=1
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/... ./cmd/...
```
Note: `internal/service/` + `cmd/` are **excluded** CI-coverage packages (template table) — no threshold applies to this logic; the behavior is proven by the unit tests above. A `test` step is still required (this step).

---

### Step 12 — config: seed migration for the EDGAR-snapshot + dividend keys (FR-5)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.up.sql` — create
- `services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.down.sql` — create

**Reviewers**: DBA — migration NNN numbering + up/down pair; `xstockstrat-config` owner — config key naming (`<service>.<category>.<key>`) + environment/global scoping

**Codebase Evidence**:
- Confirmed next-free number via `ls services/xstockstrat-config/migrations/` → last is `029_heal_config_keys_full_dotted`; next = **`030`** (there is a pre-existing `024` gap — do NOT backfill it; next is 030 per the numbering rule).
- **Current seed shape (post feature-147, authoritative)** — `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql`: columns `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`; **two rows per key** (`'staging'` + `'production'`, `user_id NULL` = global); conflict clause `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. The `trading_mode` axis is gone (feature 147). The `key` column carries the **FULL dotted** `marketdata.*` name the service reads (`configServiceImpl.ts` keys the snapshot by `row.key` with no prefix added — insights.md 2026-08-06 `WatchConfig` snapshot note; marketdata CLAUDE.md § Config Keys "read by full-dotted name").
- `value_type` must match the getter storage type or the value silently returns the default (028 header comment): `bool` for `.enabled`, `int` for `.cache_ttl_hours`/`.backfill_lookback_years`, `string` for `.snapshot_source`.
- These keys are **non-secret** (`is_secret` absent/false) — no Security reviewer, no encryption (they are plain operational toggles, unlike `marketdata.*.api_key`).

**TDD**: `N/A (config seed migration — offline, no-DB verification)`

**Covers**: — (behavior exercised by Step 11 unit tests via the zero-value watcher defaults)

**Instructions** (design point 6; seed at current code defaults so the migration is a NO-runtime-behavior change — cutover is the rollout, not this migration):
- Seed, one `staging` + one `production` row each (`user_id NULL`), `consuming_service='xstockstrat-marketdata'`:
  - `marketdata.fundamentals.snapshot_source` = `'vendor'` (string) — deploy with **no** serving change; live-flip to `edgar` is rollout step 4.
  - `marketdata.edgar.enabled` = `'true'` (bool) — the EDGAR-source kill switch, default on (matches the Step 10 explicit `true` default).
  - `marketdata.edgar.cache_ttl_hours` = `'24'` (int) — mirrors the `marketdata.fmp/finnhub.cache_ttl_hours` convention.
  - `marketdata.dividends.enabled` = `'false'` (bool) — feed off until the Alpaca entitlement is confirmed at rollout (Open Risk 2). **Design fork resolved conservatively:** seed `false` so the migration triggers no unexpected Alpaca corporate-actions cost; flip on at rollout after entitlement is verified. (The `@AC-5` unit test uses a fake dividend source, not this gate, so coverage is unaffected.)
  - `marketdata.dividends.backfill_lookback_years` = `'2'` (int) — fetch-range bound only; the T12M yield window is fixed in code (design point 6).
- `.down.sql`: `DELETE FROM config.config_values WHERE namespace='marketdata' AND key IN ('marketdata.fundamentals.snapshot_source','marketdata.edgar.enabled','marketdata.edgar.cache_ttl_hours','marketdata.dividends.enabled','marketdata.dividends.backfill_lookback_years');` (mirror the 028 down pattern).
- Do NOT flip `marketdata.finnhub.enabled`/`marketdata.fmp.enabled` in this migration — that is **rollout step 5** (a live `SetConfig`, `docs/runbooks/config-rollout.md`), not a schema edit.

**Rollout note (not a step — `docs/runbooks/config-rollout.md`, both axes boot-frozen except the live-read `snapshot_source`):** (1) deploy `snapshot_source=vendor` (no change); (2) backfill the active universe (screener/opportunity/watchlist/positions — feat 060/083/168) via `marketdata.fundamentals.history.enabled=true` + `TriggerBackfill(FUNDAMENTALS)`, and flip `marketdata.dividends.enabled=true` once Alpaca entitlement is confirmed; (3) **verify coverage** (narrow direct check — every active-universe symbol is producible; the miss-list contains only genuine non-SEC CIK-misses); (4) live-flip `snapshot_source=edgar` per env staging→prod (instantly reversible, no restart); (5) disable `finnhub`/`fmp .enabled` **last**. (Design § Open Risks — name the concrete active-universe enumeration query at rollout; do not spec a `grpcurl` full-stack smoke.)

**Verification** (offline, no DB):
```
ls services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.up.sql services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.down.sql
# read both: confirm 5 keys seeded (staging+production each), full-dotted key names, value_type per getter,
# ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING, and the .down DELETEs exactly those 5 keys
grep -c "marketdata\." services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.up.sql   # expect 10 value rows (5 keys × 2 envs)
```

---

### Step 13 — service: data-explorer currency + source provenance + CSV (FR-6)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useDataExplorer.ts` — modify
- `services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — data-explorer display accuracy, no secret values rendered

**Codebase Evidence**:
- `FUNDAMENTAL_METRICS` at `src/hooks/useDataExplorer.ts:39-51` **already contains** `pbRatio`/`pb_ratio`, `dividendYield`/`dividend_yield`, `debtToEquity`/`debt_to_equity` (added by feature 204). **So FR-6's "add the metrics to the registry" is already satisfied** — this step adds only the **currency + source provenance** rendering and the CSV columns (design point 7; recon says "add metrics" but the metrics are present — a real finding, recorded here).
- The historical table columns are built from `FUNDAMENTAL_METRICS` at `page.tsx:412-427` (`useMemo<ColumnDef<Period>[]>`, mapping each metric); the snapshot metric grid at `page.tsx:384`; the chart selector at `page.tsx:464`; CSV via `snapshotToCsv`/`historicalToCsv` (`useDataExplorer.ts:158-190`).
- `currency` and `source` are already on the proto messages (`Fundamentals.currency=15/source=16`, `HistoricalFundamentalsPeriod.currency=19/source=20` — `packages/proto/marketdata/v1/marketdata.proto`), so the browser typed client (`Period`/`Fundamentals` types at `useDataExplorer.ts:19-22`) already exposes `.currency`/`.source` — no BFF/client change.
- `metricValue` (`:125-132`) uses authoritative `missingMetrics` to render null → "—" (MARKETDATA-11) — preserve; `market_cap`/`price` stay USD (design's USD-basis hint).
- C-17: use design tokens + existing primitives (`DataTable`, tokens `text-*`), no hardcoded color, unique accessible names.

**TDD**: `red-green required` (paired e2e is Step 14; the vitest logic layer covers CSV — see below).

**Covers**: — (paired test is Step 14)

**Instructions**:
- Render `currency` as a **row-level "Reporting currency" provenance column** in the historical table and a field in the snapshot grid, plus `source` (e.g. "edgar"). Use `page.tsx`'s existing `ColumnDef`/grid patterns and design-role tokens (C-17) — no new color literal.
- Add a **per-metric USD-basis marker** so `market_cap`/`price` carry an explicit "USD" hint inside a non-USD (e.g. CNY) row (design point 7 — the ratios are dimensionless; only the absolute USD fields need the hint).
- Extend `historicalToCsv` (`:168`) and `snapshotToCsv` (`:158`) headers/cells to include `currency` and `source` columns (EXTEND `@AC-17 @feature-204` fundamentals CSV — recon:66). Keep `metricValue(...) ?? ''` blank-cell behavior for missing metrics (`@AC-22`).
- Do not render any secret value (none are on these messages) — reviewer focus.

**Verification**: covered by Step 14 (Playwright) + the CSV logic vitest below.
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm run test:coverage   # vitest logic layer (src/lib/**); if CSV helpers move under coverage scope, confirm the 40% gate on exercised files
```

---

### Step 14 — test: data-explorer Playwright — enriched metrics + currency + source (@AC-8)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/data-explorer.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/historicalFundamentals.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — data-explorer display accuracy

**Codebase Evidence**:
- Existing spec `e2e/insights/data-explorer.spec.ts` and wire fixtures `DE_SNAPSHOT_AAPL`, `DE_HIST_AAPL_PAGE1/_PAGE2` in `e2e/fixtures/historicalFundamentals.ts` (INVENTORY.md row: feature 204, Connect-JSON **wire** shape `GetHistoricalFundamentalsResponse`; `page.route` stubs drive OHLCV/fundamentals tabs, pagination, missing-metric, CSV). **C-12: reuse/extend these fixtures — no inline mock literal.** The auth helper is `e2e/helpers/auth.ts` (`addAuthCookie` etc.).
- A new BABA-shaped enriched fixture (currency `"CNY"`, source `"edgar"`, populated `debt_to_equity`/`pb_ratio`/`dividend_yield`, some period with a missing metric → "—") extends the existing fixture module + gets an INVENTORY.md catalog row in this step (C-12).

**TDD**: `red-green required` — fails against pre-Step-13 tree (no currency/source column rendered).

**Covers**: `AC-8`

**Instructions**:
- Extend `historicalFundamentals.ts` with a BABA enriched fixture (currency `"CNY"`, source `"edgar"`, `debt_to_equity`/`pb_ratio`/`dividend_yield` populated on periods that carry them, at least one period listing a metric in `missing_metrics`). Add the INVENTORY.md catalog row (C-12).
- In `data-explorer.spec.ts`, add a test opening `/insights/data-explorer` for BABA, Historical tab: assert `debt_to_equity`, `pb_ratio`, `dividend_yield` render populated (not "—") for the carrying periods, and "—" for the missing one (`@AC-22` preserved); assert each period shows its reporting currency ("CNY") and source ("edgar") (`@AC-8`). Reuse `addAuthCookie` from `e2e/helpers/auth.ts` — do not re-implement JWT signing.
- Assert the CSV export includes the `currency`/`source` columns (extend the existing CSV assertion).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- data-explorer
grep -n "helpers/auth\|from '../fixtures'\|from './fixtures'\|historicalFundamentals" services/xstockstrat-ui/e2e/insights/data-explorer.spec.ts   # confirm fixture + auth imports (C-12)
# confirm services/xstockstrat-ui/e2e/fixtures/INVENTORY.md updated with the new BABA fixture row
```

---

### Step 15 — test: new marketdata acceptance coverage — currency/PIT/no-look-ahead/parity (@AC-9; C-16)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature` — create

**Reviewers**: `xstockstrat-marketdata` owner — fundamentals serving integrity; `xstockstrat-analysis` owner — no look-ahead / backtest-live parity

**Codebase Evidence**:
- The marketdata acceptance suite dir exists: `services/xstockstrat-marketdata/acceptance/` (contains `config-secrets-and-scoping.feature`, `fix-ohlcv-chunk-lock-oom.feature`, `opportunities-latency-fix.feature`, `quote-fanout-batching.feature`). This is the C-16 durable home; marketdata fundamentals **serving + currency behavior has no promoted guard today** (recon:75-77 — a C-16 blind spot the design flagged; design point 8 authors this coverage).
- `@AC-9` is a cross-surface parity assertion (marketdata enriched PIT ↔ same-convention live snapshot ↔ indicators `fundamentals_value_quality` composite). The narrow, non-fragile validation (fails.md 2026-08-13 — never a full-stack `grpcurl` smoke) is: **the PIT period and the EDGAR snapshot for the same filing carry the same `debt_to_equity`/`pb_ratio`/currency** (Step 11 already proves the snapshot builder reads the same stored period), so the formula sees identical inputs on both surfaces — closing the ~0.35-vs-0.70 split at its root cause.

**TDD**: `red-green required` (the scenarios are promoted from `acceptance.feature`; they are backed by the Steps 3/5/7/9/11 assertions — this step records them as durable business rules per C-16, tagged with this feature).

**Covers**: `AC-9` (and durably records @AC-1..@AC-7 as the marketdata suite's first fundamentals-serving guards)

**Instructions**:
- Author `edgar-fundamentals-enrichment.feature` mirroring the `acceptance.feature` scenarios, tagged `@AC-N @feature-207`, in the marketdata suite's Gherkin style (match the existing `.feature` files' Given/When/Then shape). Include: currency capture (@AC-1), financial-debt D/E (@AC-2/@AC-3), PIT P/B no-look-ahead (@AC-4), T12M dividend (@AC-5, marked contingent if FR-4 was descoped at Step 8), EDGAR-canonical snapshot + disable-safety (@AC-6), non-SEC fallback (@AC-7), and the **@AC-9 same-convention parity** scenario (PIT and snapshot for one filing produce the same D/E/P/B/currency ⇒ the formula composite lands in the same band on both surfaces).
- This closes the C-16 blind spot (no promoted marketdata fundamentals-serving suite existed — recon:77). PRESERVE, don't touch, the four existing `.feature` files.
- No indicators/analysis code change (design § Chosen Approach) — @AC-9's formula behavior is validated by the shared inputs, not by editing the seeded formula (product spec § Out of Scope: band retune is a separate change only if validation proves one is needed).

**Verification**:
```
ls services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature
# read it: confirm every @AC-1..@AC-9 tag present, each scenario traces to a Step 3/5/7/9/11 assertion or the parity argument
grep -c "@AC-" services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature   # expect ≥ 9 (contingent @AC-5 note allowed)
```

---

### Step 16 — docs: marketdata CLAUDE.md config keys + design-correction record

**Status**: `pending`
**Service**: `docs` / `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (add the 5 new config keys to § Config Keys Consumed)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log — the 5 keys)

**Reviewers**: none (docs)

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md` § Config Keys Consumed is the per-service default-declaration home (C-05: "defaults declared in each service's CLAUDE.md"); it already lists `marketdata.edgar.base_url`/`user_agent`/`rate_limit_rps` and `marketdata.fundamentals.provider`/`.history.enabled`.
- Root `CLAUDE.md` § Config Governance points the per-feature registered-keys log at `docs/patterns/config-governance.md` (retrieved on demand).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
- Add rows for `marketdata.fundamentals.snapshot_source`, `marketdata.edgar.enabled`, `marketdata.edgar.cache_ttl_hours`, `marketdata.dividends.enabled`, `marketdata.dividends.backfill_lookback_years` to the marketdata CLAUDE.md config-keys table (type, default, description matching Step 12's seed). Update the `marketdata.fundamentals.provider` note: it now selects the **vendor** snapshot lane only when `snapshot_source=vendor` (feature 207 added the `snapshot_source` axis — the feature-198 "EDGAR is a separate PIT lane, never a `provider` value" note still holds; EDGAR reaches the snapshot via `snapshot_source`, not `provider`).
- Add the 5 keys to the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`.
- **Teardown (root CLAUDE.md § Teardown):** this step changes context files describing config behavior — run `/context-forge:context-constitution refresh` scoped to the marketdata CLAUDE.md + config-governance edits before pushing, and fix grounded drift; if the plugin is unavailable, do the manual reconciliation and record both facts in the PR body.

**Verification**:
```
grep -n "snapshot_source\|marketdata.edgar.enabled\|marketdata.dividends" services/xstockstrat-marketdata/CLAUDE.md   # confirm 5 keys documented
grep -n "snapshot_source" docs/patterns/config-governance.md   # confirm registered-keys log updated
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
