# Recon: fix-fundamentals-roe-unit

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/fix-fundamentals-roe-unit@aef618a0a (discovery digests arrived `Checkout: UNSTAMPED`; every `path:line` below was re-grepped on this commit)
**Affected services**: xstockstrat-marketdata

---

## Objective

Marketdata served `roe ≈ 3.6634` for LYFT on staging, which the symbol page shows as `+366.34%` and
which also feeds the agent fundamentals tools and analysis screening. The fix must make `roe` a
fraction that agrees with the symbol's own net income and shareholders' equity on every path, and
must stop serving the wrong value already stored. The operator required recon to trace the producing
path first; that trace is below and it **contradicts the percent-vs-fraction hypothesis**.

## Root-Cause Trace (operator decision, 2026-11-15)

Read-only staging reads on 2026-11-15 (homelab staging agent: `query_fundamentals` snapshot and
historical for LYFT, `get_config` namespace `marketdata`).

**Traced path: EDGAR quarterly TTM derivation, served through the EDGAR snapshot. No vendor and no
merge path is involved.**

1. Staging config: `fundamentals.snapshot_source = edgar`, `edgar.enabled = true`
   (`fundamentals.provider = finnhub` is set but not the serving axis). `GetFundamentals` dispatches
   to `getEdgarSnapshot` when the axis is `edgar` (`internal/service/marketdata_service.go:1735`).
2. The LYFT snapshot carries `source: "edgar"`, `roe: 3.6633733846490815`, `as_of 2026-11-06`.
3. The newest stored period, `Q3-2026` (quarterly, filed 2026-11-06, `source: edgar`), carries the
   identical `roe: 3.6633733846490815`. The snapshot projects the period's ROE verbatim
   (`edgarSnapshotFromPeriod`, `marketdata_service.go:2057`, `ROE: p.ROE` at `:2070`).
4. So the value comes from `annualizeQuarterlyROE` (`internal/edgar/edgar_client.go:475`):
   `roe := sum * 4 / float64(n) / eq` (`:491`), `sum, n` from `trailingNetIncome` (`:411`), `eq`
   from `valIn(a, "stockholders_equity", p.Currency)` (`:479`).

**It is not a unit error.** Finnhub's `scale100` and FMP's pass-through never ran for this value.
The ratio is already a fraction; its inputs are wrong.

Stored inputs on the `Q3-2026` row (`extra_metrics`):

| Field | Value |
|---|---|
| `stockholders_equity` | 767,016,000 |
| `net_income` | 2,567,000 |
| `assets` | 9,030,053,000 |
| `liabilities` | 5,756,530,000 |

- `roe × equity` = 3.66337 × 767,016,000 ≈ **2.81B** annualized net income (`sum × 4/n`).
- `assets − liabilities` = **3,273,523,000**, more than four times the stored equity of 767M. The
  denominator contradicts the row's own balance sheet.
- With that numerator over 3.27B, ROE would be about **0.86**, not 3.66.
- `Q1-2026`, `Q2-2026` and `Q3-2026` all store the same `stockholders_equity`, `assets`,
  `liabilities` and `net_income`; their ROEs are 3.7231, 3.7361, 3.6634. Three different
  quarter-ends cannot share one balance sheet. `Q1-2024` to `Q3-2024` repeat the pattern
  (equity 388,668,000 on all three), and `FY2025` carries that same 388,668,000.
- `pb_ratio 8.77` (= market cap / 767M) and `debt_to_equity 1.3729` use the same equity value.

**Mechanism in code (grounded, not yet confirmed against the raw filing):** `FetchHistorical` buckets
every fact by the filing's `fy`/`fp` (`periodKey`, `edgar_client.go:286`) and keeps the **first-seen**
value per (metric, unit) (`:359-363`). A 10-Q carries the current balance sheet, the prior
year-end comparative column and the equity roll-forward under the same `fy`/`fp`, so an instant
tag such as `StockholdersEquity` (`:196`) can resolve to an older date than the period end.
Feature 222 fixed this trap for the net-income flow only, by keying on the fact's own period
(`niFact`, `:387`); instant facts still use the filing key. `periodEnd` itself is the latest `end`
of any fact in the bucket (`:350-352`), which is why the stored `period_end` values are dates like
`2026-10-30` (a cover-page share-count date), not the quarter end.

**What the trace does not settle** (see Risks): whether the numerator (TTM sum ≈ 2.81B, including
any derived Q4) is itself correct, and which instant date the stored 767,016,000 belongs to. Both
need LYFT's raw `companyfacts` JSON, which recon did not fetch.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point: `cmd/*/main.go:37`
  - Handler/servicer: `GetFundamentals` — `internal/service/marketdata_service.go:1735`; axis resolver `snapshotSource` — `:1944`
  - Last migration: `009_symbol_classification.up.sql` (`services/xstockstrat-marketdata/migrations/`)
  - Config-read pattern: `s.fundCfg.GetString("fundamentals.snapshot_source", snapshotSourceVendor)` — `marketdata_service.go:1944`
  - Other key symbols:
    - `FetchHistorical` (bucketing, first-seen) — `internal/edgar/edgar_client.go:290`, `:359-363`
    - `instantTags` (`StockholdersEquity`, `Assets`, `Liabilities`) — `edgar_client.go:195-198`
    - `trailingNetIncome` — `edgar_client.go:411`; `annualizeQuarterlyROE` — `:475`, `:491`
    - `buildPeriod` — `edgar_client.go:526`; annual `roe := ni / eq` — `:558-560`; D/E on the same equity — `:590`
    - `DerivationVersion = 1` — `edgar_client.go:524` (bump rule at `:521`)
    - `edgarSnapshotFromPeriod` — `marketdata_service.go:2057`, `:2070`
    - Re-derive call site — `marketdata_service.go:2398-2399`; `DeleteEdgarSnapshot` call — `:2358`
    - `RederiveHistoricalFundamentals` — `internal/repository/marketdata_repo.go:786`, guard `derivation_version < $8` at `:797`
    - `DeleteEdgarSnapshot` — `marketdata_repo.go:805`
    - Wire projection: snapshot `Roe: derefOrZero(f.ROE)` — `marketdata_service.go:2202` (`missing_metrics` feed `:2182`); historical `Roe: add("roe", p.ROE)` — `:2609`
    - Snapshot upsert — `marketdata_repo.go:627` (`fundamentalsColumns` at `:541`)
    - Vendor paths (not the traced cause): Finnhub `f.ROE = scale100(m.ROETTM)` — `internal/finnhub/finnhub_client.go:260` (`scale100` at `:236`); FMP `f.ROE = r.ReturnOnEquityTTM` — `internal/fmp/fmp_client.go:481` (field at `:474`)
    - Source structs `ROE *float64` — `internal/source/source.go:53`, `:98`
    - Proto: `double roe = 8;` — `packages/proto/marketdata/v1/marketdata.proto:233`; `double roe = 13;` — `:283`; neither has a unit comment
    - Columns: `roe numeric` — `migrations/002_fundamentals.up.sql:16`; `roe double precision` — `migrations/005_fundamentals_history.up.sql:22`

## Patterns to REUSE

- Keying an XBRL fact on its own period, not the filing's `fy`/`fp` → reuse the feature-222 `niFact` approach (`edgar_client.go:387-401`, `toNIFact` at `:393`) for the instant facts the ratios divide by.
- Reaching already-stored EDGAR rows → bump `DerivationVersion` (`edgar_client.go:524`) and record the new golden hash (`internal/edgar/derivation_version_test.go`, `derivationGolden`); the existing backfill then upgrades rows through `RederiveHistoricalFundamentals` (`marketdata_repo.go:786`). MARKETDATA-13 (`services/xstockstrat-marketdata/docs/context-constitution.md:27`).
- Not serving the stale cached snapshot after re-derivation → reuse `DeleteEdgarSnapshot` (`marketdata_repo.go:805`, called at `marketdata_service.go:2358`), the feature-223 mechanism.
- Absent vs zero → `*float64` stays nil end to end, zeroed only at `derefOrZero` (`marketdata_service.go:2202`); MARKETDATA-11 (`context-constitution.md:25`). Covers FR-4.
- Comparative-column trap tests → follow `internal/edgar/ttm_roe_test.go` (`TestQuarterlyROE_TrailingTwelveMonths_AC1` at `:62`, `TestAnnualROE_Unchanged_AC3` at `:74`, single-quarter fallback at `:107`).
- Vendor unit conversion stays in the vendor client (`scale100`, `finnhub_client.go:236`); tests at `finnhub_client_test.go:87`/`:118` (137.18 → 1.3718) and `fmp_client_test.go:86` (pass-through 1.5).
- Test harness: Go unit tests beside the code, run with `GOWORK=off` from `services/xstockstrat-marketdata`; repo tests use pgxmock `ExpectExec` (`marketdata_repo_test.go:573-584`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @regression @feature-222` "A quarterly EDGAR period reports ROE on a trailing-twelve-month basis" (`services/xstockstrat-marketdata/acceptance/fix-edgar-quarterly-roe.feature`) — quarterly roe = TTM net income / equity (≈0.353). The defect is now traced to this path. Correcting *which* equity instant is the period-end equity keeps the stated rule; changing the TTM annualization itself would be a CHANGE needing operator sign-off in `context.md`.
- **PRESERVE** `@AC-2 @regression @feature-222` "The EDGAR snapshot inherits the annualized quarterly ROE" (same file) — snapshot roe equals the period's roe.
- **PRESERVE** `@AC-3 @regression @feature-222` "Annual periods are unchanged" (same file) — annual roe = annual net income / equity. An equity-selection fix also touches the annual denominator; the rule's wording survives, the fixture values must be rechecked.
- **PRESERVE** `@AC-4 @regression @feature-216` "overwrite=true refreshes an already-populated price-join to the current derived value" (`services/xstockstrat-marketdata/acceptance/fix-historical-fundamentals-price-join.feature`, line 51 "roe ... unchanged") — FR-5 must not use `overwrite=true` to correct roe, or this becomes a CHANGE.
- **PRESERVE** `@AC-3 @regression @feature-216` "a plain re-backfill fills only the missing price-join columns and never touches populated ones" (same file) — a plain re-backfill will not repair roe; FR-5 needs the version-bump re-derive.
- **PRESERVE** `@AC-1 @regression @feature-223` "Stored AXP periods carry financial-debt D/E after re-derivation" (`services/xstockstrat-marketdata/acceptance/fix-stored-edgar-periods.feature`) — D/E ≈ 1.73 divides by the same equity fact; an equity-selection change must leave this result intact.
- **PRESERVE** `@AC-2 @regression @feature-223` "The EDGAR snapshot reflects the re-derived period" (same file) — the model for FR-5.
- **PRESERVE** `@AC-4 @FR-3 @regression @feature-255` "The vendor path does not serve an edgar cache row as vendor data" (`services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature`).
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-255` "A failed FMP enrichment is not cached as a fresh complete row" (same file).
- **PRESERVE** `@AC-6 @FR-5 @FR-8 @feature-211` "The snapshot path serves the latest EDGAR filing after the vendors are disabled" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`).
- **PRESERVE** `@AC-7 @FR-5 @feature-211` "A non-SEC-filing symbol falls back to the vendor path" (same file).
- **PRESERVE** `@AC-9 @FR-1 @FR-2 @FR-3 @FR-4 @feature-211` "Backtest PIT composite lands in the same band as the live snapshot after enrichment" (same file) — P/B and D/E share the equity fact; PIT and snapshot must stay equal.
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-196` "deprecating a response field never changes the proto schema" (`docs/sdd/business-rules/platform.feature`) — the proto edit must stay comment-only.
- **EXTEND** — no durable suite pins a vendor-path roe unit today (27 marketdata suites; Finnhub `scale100` is covered only by a unit test). This feature's `@AC-2` Finnhub/FMP rows are additive.
- No CHANGE is flagged at recon. Platform `@feature-205` formula inputs: `FUNDAMENTAL_METRIC_ROE = 7` exists (`packages/proto/indicators/v1/indicators.proto:155`), so a corrected roe changes the value authored formulas and analysis scoring read. That is the intended effect, with no consumer code change.
- Scenario-recon limits: `platform.feature` was read to line 796 and grepped beyond it; `xstockstrat-ui` and `xstockstrat-agent` suites were not read (the spec names no consumer code change).

## Dependencies

- Proto/RPC: comment-only on `roe = 8` (`marketdata.proto:233`) and `roe = 13` (`:283`); no field, number or type change; `./scripts/buf-gen.sh` in the same PR (C-09).
- Migration: none anticipated; next free number is `010` for `services/xstockstrat-marketdata/migrations/`. `derivation_version` already exists (migration `008`).
- Config keys: none new. Read, existing: `marketdata.fundamentals.snapshot_source` (staging `edgar`), `marketdata.edgar.enabled`.
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **Spec premise conflict — needs an operator decision before design converges (P-03).** `@AC-1` and `@AC-5` bind `Then roe is 0.0366` from inputs `28070000 / 767000000`. No staging row holds 28,070,000; it was back-derived from the percent hypothesis (0.0366 × 767M). On the traced path the equity of 767M is the suspect input, and the plausible corrected value is about 0.86 (2.81B / 3.27B), not 0.0366. The spec says the `Then` values "may not be weakened"; recon cannot reconcile that with the trace and does not guess.
- **`@AC-2` cannot hold as written for one LYFT.** The Finnhub and FMP rows are synthetic unit checks and stay valid, but they exercise paths that did not produce the defect. Design must restate which scenarios are the regression guard.
- **Raw filing not read.** Recon did not fetch LYFT's SEC `companyfacts`. Not verified: which instant date 767,016,000 belongs to; whether the TTM sum ≈ 2.81B is genuine (for example a one-off tax item in a derived Q4) or also wrong; the `n` returned by `trailingNetIncome`. A fixture cut from the real JSON is needed before the fix or its expected value is pinned.
- **Unexplained:** `net_income` 2,567,000 is identical on `Q1-2026`, `Q2-2026` and `Q3-2026`. First-seen bucketing would explain a stale value on one row, not the same value on three. Not traced.
- **Scope pressure.** `pb_ratio` and `debt_to_equity` divide by the same equity fact (`edgar_client.go:590`), and `assets`/`liabilities` look stale the same way. The spec lists "unit audits of other fundamentals metrics" as out of scope; fixing the shared denominator changes those ratios whether or not they are named. Design must take this to the operator, not absorb or exclude it silently.
- **`period_end` is not the quarter end** (`edgar_client.go:350-352`). It feeds the TTM window in `trailingNetIncome` and the as-of reads. Whether to touch it is a design question; changing it alters a stored identity column that the re-derive path does not update.
- **Re-derive reach.** `RederiveHistoricalFundamentals` updates `eps, roe, debt_to_equity, extra_metrics` only (`marketdata_repo_test.go:573`). `pb_ratio` and `market_cap` come from the price-join and are not re-derived by a version bump.
- **Derivation version is shared.** Any other in-flight feature that bumps `DerivationVersion` must be coordinated so one re-backfill covers both (`insights.md` 2026-11-04 fix-stored-edgar-periods "ordering"). Check `merge-order.md` before reserving version 2.
- **Rebase overlap (file-level only):** `marketdata_service.go` vs 317, `fmp_client.go` and `finnhub_client.go` vs 320, `marketdata.proto` vs 322 (from the product-spec review).
- **`fails.md` traps that apply:**
  - 2026-11-04 fix-stored-edgar-periods (assumption): a changed stored derivation must say how stored rows are re-derived.
  - 2026-11-04 fix-edgar-quarterly-roe (assumption): a ratio must share its basis with siblings on the same row; and placeholder acceptance figures were never replaced with real ones — the same risk as the 28,070,000 input here.
  - 2026-11-10 block-fundamentals-strategy-on-etf (config): a ranked-hypothesis diagnosis produced two non-causal fixes; trace before fixing. The original "percent-vs-fraction" title of this feature is that pattern.
  - 2026-11-10 block-fundamentals-strategy-on-etf (assumption): every post-deploy check must be reachable with a real tool. `query_fundamentals` on staging can observe LYFT `roe`, `source` and `extra_metrics`, so FR-5 is checkable after a re-backfill.
- **`insights.md` patterns that apply:** 2026-11-04 fix-edgar-quarterly-roe (design) "key XBRL flow facts by the fact's own period, never the filing's fy/fp" — the instant-fact counterpart is this defect; 2026-11-04 fix-stored-edgar-periods (design) version-stamp and guarded upgrade.
- **Not found:** any guard that cross-checks `stockholders_equity` against `assets − liabilities`; any test where one filing carries two `StockholdersEquity` instants; any durable `@AC` on vendor roe units.

## Recommended Scope

Advisory, pending the operator decisions above.

1. **Fixture + RED test** — cut a LYFT `companyfacts` fixture from the real filing; a test that the quarterly period's equity is the period-end instant and `roe` equals TTM net income over it. This settles the expected value for `@AC-1`/`@AC-5`.
2. **Service fix** — select instant facts by the fact's own end date in `FetchHistorical` (the feature-222 pattern), bump `DerivationVersion` to 2, record the new golden hash. Lands with step 1's test.
3. **Stored-row repair (FR-5)** — confirm the existing backfill re-derive plus `DeleteEdgarSnapshot` covers LYFT; test at service and repo level; no migration.
4. **Vendor-path unit guards (FR-1, `@AC-2`)** — table tests for Finnhub and FMP fraction output and `GetFundamentals`/`GetFundamentalsMulti` parity; FR-4 nil/negative cases.
5. **Proto comment** — unit comments on `roe = 8` and `roe = 13`; `buf lint`, `buf breaking`, regenerate stubs.
6. **Docs + acceptance** — update `services/xstockstrat-marketdata/docs/fundamentals.md` (derivation versioning, `:74`) and promote scenarios with provenance `@feature-340`.
7. **Post-deploy check** — staging re-backfill for LYFT, then `query_fundamentals` to confirm `roe` and the equity input.
