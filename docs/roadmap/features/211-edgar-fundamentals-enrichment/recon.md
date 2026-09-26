# Recon: edgar-fundamentals-enrichment

**Created**: 2026-09-25
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-ui, xstockstrat-config, xstockstrat-indicators, xstockstrat-analysis (+ packages/proto, + xstockstrat-agent consumer surface)

---

## Objective

Make SEC EDGAR the single, PIT-faithful source of fundamentals for both backtest (historical) and
live/snapshot evaluation, so a symbol's backtest score and live score stop diverging. Fix the
hardcoded-currency bug, compute financial-debt D/E and market-derived P/B from the filing itself, add
a point-in-time dividend feed, serve the snapshot from the latest EDGAR filing + a live price-join, and
disable the FMP/Finnhub fundamentals providers by config. Analysis and indicators need no code change —
the fix is entirely marketdata-side data correctness plus a config seed and a UI registry addition.

## Codebase Map

- **`xstockstrat-marketdata`** (Go) — the whole feature lives here except config seed + UI registry.
  - EDGAR client / historical source: `internal/edgar/edgar_client.go` — `Client.FetchHistorical` (`:199`), consumes the SEC XBRL **companyfacts** API (`:207`), ticker→CIK from `company_tickers.json` (`:24`).
  - Tag allow-list (what is extracted): `edgar_client.go:156-170` — NetIncomeLoss→net_income, Revenues/RevenueFromContractWithCustomerExcludingAssessedTax→revenue, EarningsPerShareDiluted→eps, EarningsPerShareBasic→eps_basic, StockholdersEquity, Liabilities, Assets, CommonStockSharesOutstanding/EntityCommonStockSharesOutstanding→shares.
  - Untracked tags DROPPED: `edgar_client.go:219` (`if !isFlow && !isInstant { continue }`) — **debt line items are never captured**.
  - `debt_to_equity = liabilities/equity`: `edgar_client.go:341-346`. `roe = net_income/ending equity`: `:335-339`.
  - **Currency hardcoded** `"USD"`: `edgar_client.go:317`; XBRL **unit key discarded**: `:222` (`for _, unit := range entry.Units {` drops the `USD`/`CNY` key). No ADR/foreign-currency handling.
  - `filed_date` from XBRL `"filed"`: `edgar_client.go:241`; earliest-kept: `:251-254`.
  - Price-join (already computes market ratios at the filing boundary): `internal/service/marketdata_service.go` `priceJoin` (`:1630-1668`) — sets `Price`, `MarketCap = close×shares`, `PERatio = close/ttmEPS`. **P/B is derivable here** (`market_cap/equity`).
  - `ratioEnricher` seam (nil in v1, cap-guarded, tested): `marketdata_service.go:115-117` (interface), wired at `:1612-1615`; its comment warns TTM ratio sources are a **look-ahead risk** for PIT.
  - Backfill: handler `internal/handler/marketdata_handler.go:142` → `marketdata_service.go:1557` `BackfillFundamentals` (gated by `marketdata.fundamentals.history.enabled` `:1558`) → `backfillOneSymbol` (`:1600`) → EDGAR `FetchHistorical` → `priceJoin` → optional `ratioEnricher.Enrich` (sets `source="edgar+fmp"`) → `histRepo.InsertHistoricalFundamentals`.
  - Serving: historical `GetHistoricalFundamentals` (`marketdata_service.go:1512`) + `filterAsOf` (`filed_date < as_of`, T+1); snapshot `GetFundamentalsMulti` (`:1284`, cache/quota). `missing_metrics` from nil `*float64` (`toProtoFundamentals` `:1477-1482`).
  - Provider construction (boot-only): `cmd/server/main.go:124` `GetString("marketdata.fundamentals.provider", "finnhub")`; `newFundamentalsSource` `:194` — **"Always constructed; .enabled gates use, not this"** (`:194` comment). Finnhub/FMP snapshot impls: `internal/finnhub/finnhub_client.go:50`, `internal/fmp/fmp_client.go:60`.
  - Provider interfaces: `internal/source/source.go:65` `FundamentalsSource` (snapshot), `:103` `HistoricalFundamentalsSource` (EDGAR only), models `:75-98`.
  - Alpaca client (OHLCV; dividend only as bar-adjustment mode today): `internal/alpaca/client.go:42-44`.
- **`xstockstrat-analysis`** (Python) — **NO code change** (pure passthrough).
  - PIT loader → `GetHistoricalFundamentals`: `app/handlers/servicer.py:1487,1516`; snapshot loader → `GetFundamentalsMulti`: `:1575,1595` (lowered to one `FundamentalPeriod(filed_date=date.min)`). Live-loop mirrors: `app/engine/live_loop.py:587,610`.
  - Gate `analysis.backtest.fundamentals.enabled` (4 sites): `servicer.py:1512,1591`, `live_loop.py:599,620`.
  - No-look-ahead: `app/services/evaluator.py:75` `_fundamental_as_of_series` — strict `filed_date < d` T+1 carry-forward, source-agnostic.
  - **Pure passthrough — computes no ratios**: `servicer.py:5481` (`values = {m: getattr(p,m)…}`), `:5609-5611`, `live_loop.py:633`. Fixing marketdata values is sufficient.
- **`xstockstrat-indicators`** (Python) — **NO code change** (validation only).
  - Seed: `app/services/seed_formulas.py:28-45` (idempotent upsert, deterministic id `d1ff5e6b-…`).
  - Bands/weights are tunable params read via `_p()`: `app/formulas/fundamentals_value_quality.py:128-130,142,147,151-152,170,175` — retune is a param change, not code.
  - Output-contract enforcement: `app/handlers/servicer.py:191-205`. Indicators only *receives* fundamentals as `data`; never computes them.
- **`xstockstrat-config`** (Node) — needs a new seed migration only.
  - Seed pattern (dual env rows, ON CONFLICT DO NOTHING): `migrations/015_marketdata_finnhub.up.sql:22`; `marketdata.fundamentals.provider` seeded free `string` default `finnhub` `:60`; conflict key `(namespace,key,environment,trading_mode)` `:66`. FMP enable/cap seed: `migrations/007_marketdata_fmp.up.sql:23`.
  - Write validation: `src/grpc/configServiceImpl.ts` — numeric `SCALAR_BOUNDS_REGISTRY` `:100`, enforced `:412-421`; **no generic enum/allowed-values check for string keys** (only hardcoded `platform.trading_state` allow-list `:398-407`); unregistered-key write needs `create_key=true` `:424-439`.
- **`xstockstrat-ui`** (Next.js) — data-explorer registry addition only.
  - Data Explorer page (feature 204): `src/app/insights/data-explorer/page.tsx:94`; nav `src/components/shared/navGroups.tsx:63` (already registered).
  - Metric registry driving tables + chart select + CSV: `src/hooks/useDataExplorer.ts:39` `FUNDAMENTAL_METRICS`.
  - BFF forwards: `src/lib/insightsBff.ts:87-99` (`getFundamentals`, `getHistoricalFundamentals`, `getFundamentalsMulti`); browser client `src/lib/browserClients/insightsMarketDataClient.ts:7`.
  - Fundamentals also on trader position detail: `src/app/trader/positions/[symbol]/page.tsx:1024`.

## Patterns to REUSE

- **P/B computation** → reuse the existing `priceJoin` (`marketdata_service.go:1630-1668`) that already computes `MarketCap`/`PERatio` at the filing boundary; add `PBRatio = market_cap/equity` there (currency-consistent — see Risks). No new price-fetch path.
- **Ratio enrichment hook** → the existing `ratioEnricher` interface + cap-guard (`marketdata_service.go:115-117,1612-1615`) is the shaped seam for filling a ratio EDGAR + price-join cannot supply. Note its own look-ahead caveat — dividend yield/D-E must be PIT-derived, not a TTM-snapshot fill.
- **New PIT metric columns** → `fundamentals_history` already has `pb_ratio`/`dividend_yield`/`debt_to_equity` (double precision) + `currency` + `source` (migration `005`); write into existing columns / `extra_metrics` JSONB (e.g. `total_debt`). No new metric column.
- **Alpaca corporate-actions feed** → the Alpaca client already exists (`internal/alpaca/client.go`); extend it for the corporate-actions (dividends) endpoint. **Credentials via `GetSecret`** (feature-147 path), never an env var — PRESERVE `@AC-6/@AC-7 @feature-147`.
- **Config seed** → follow `migrations/015_marketdata_finnhub.up.sql` (dual-env string/bool seed) for the new keys; `007_marketdata_fmp.up.sql` for the enable/cap shape.
- **UI exposure** → add the new metrics to the single `FUNDAMENTAL_METRICS` array (`useDataExplorer.ts:39`); tables, chart selector, and CSV pick them up automatically. `missing_metrics` stays authoritative (renders "—").
- **Snapshot-from-latest-filing** → the existing `GetHistoricalFundamentals` + `filterAsOf` read gives "latest filing as-of now"; the EDGAR-canonical snapshot reuses that read + a live `priceJoin`, rather than a new store.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @FR-2 @feature-204` "Query current fundamentals snapshot by symbol" (`services/xstockstrat-ui/acceptance/backfilled-data-queryable.feature`) — Data Explorer snapshot tab must still render (pe_ratio, market_cap); this feature adds columns beside it.
- **PRESERVE** `@AC-22 @FR-2 @feature-204` "missing metrics render gaps/dashes, never fabricated/NaN" — new metrics (D/E, P/B, div-yield) absent from a filing must land in `missing_metrics` and render "—", never a fabricated 0.
- **EXTEND** `@AC-17 @FR-8 @feature-204` "Export fundamentals CSV" — extend the column set with currency/source/D-E/P-B/div-yield.
- **PRESERVE** `@AC-4/@AC-15/@AC-20 @feature-204` historical query, time-series chart, pagination — must keep working when the snapshot/serving source changes.
- **PRESERVE** `@AC-6 @FR-5 @feature-205` GetFundamentalsMulti prefill "missing → null, never NaN" (`services/xstockstrat-ui/acceptance/formula-fundamental-inputs-authoring.feature`; agent + indicators mirrors).
- **PRESERVE** `@AC-14 @FR-8 @feature-095` "folding live quote does not leak look-ahead" and `@AC-11 @feature-095` "unavailable live quote omits price, never fabricates" (`services/xstockstrat-analysis|ui/acceptance/opportunity-live-market-enrichment.feature`) — the P/B live price-join must not leak look-ahead and must omit-not-fabricate when price is absent.
- **PRESERVE** `@AC-1..@AC-3 @feature-151` backtest fill timing / final-bar no-look-ahead (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`) — the PIT price-join at the filing boundary + T12M dividend yield must not reintroduce look-ahead. **This is the platform's only promoted no-look-ahead guard.**
- **PRESERVE** `@AC-1 @feature-168` "blend runs on the fundamentals-universe intersection" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`) — EDGAR-sourced coverage changes the set, not the rule.
- **PRESERVE** `@AC-6/@AC-9 @feature-154` "max_symbols cap applies only when provider==fmp" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`) — disabling FMP ⇒ cap no longer applies (consistent).
- **PRESERVE** `@AC-6/@AC-7 @feature-147` "Alpaca credential via GetSecret, not env var; missing credential warns but service starts" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`) — the new dividend feed MUST use this path.
- **PRESERVE** `@AC-6/@AC-7 @feature-204` `query_fundamentals` snapshot/historical + authoritative `missing_metrics` (`services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature`) — the C-14 Agent surface; enriched values flow through, no contract change.
- **CHANGE (needs sign-off, no promoted guard)** snapshot source + provider selection — repointing the snapshot lane at EDGAR alters the feature-198 contract that kept EDGAR a *separate PIT lane* (`marketdata.fundamentals.provider` never took `edgar`). No promoted `@AC-*` guards marketdata fundamentals serving — a C-16 blind spot; call it out loudly.
- **CHANGE (needs sign-off, no promoted guard)** "stop hardcoding USD" — currency-semantics change; multi-currency values must not be silently aggregated with USD-assumed consumers.
- **marketdata fundamentals ingestion/serving + USD-currency behavior** → no promoted acceptance scenario guards these (059/129/198/200 were never promoted). Treat as a C-16 blind spot; consider authoring new marketdata acceptance coverage in this feature.

## Dependencies

- Proto/RPC: **no change expected** — `Fundamentals` (`pb_ratio=4`, `dividend_yield=5`, `debt_to_equity=9`, `currency=15`, `source=16`) and `HistoricalFundamentalsPeriod` (`pb_ratio=9`, `dividend_yield=10`, `debt_to_equity=14`, `currency=19`, `source=20`) already carry every field (`packages/proto/marketdata/v1/marketdata.proto`). Any addition is additive/non-breaking only.
- Migration: **marketdata** next number `006` (tip `005_fundamentals_history`) for a dividend/corporate-actions store. **config** next number ~`030` (a new `030_…` seed migration; verify next-free at spec time).
- Config keys: flip `marketdata.finnhub.enabled` / `marketdata.fmp.enabled` defaults; extend `marketdata.fundamentals.provider` with `edgar` (leading option — no server-side enum validation exists) OR add `marketdata.fundamentals.snapshot_source`; add `marketdata.dividends.*` (feed enable / lookback).
- Inter-service edges: none new (analysis→marketdata already exists; the dividend feed is marketdata→Alpaca, an existing external edge).
- New env vars / ports: none — Alpaca credentials are config secrets via `GetSecret` (feature 147), not env vars.

## Risks / Not-found

- **Cross-currency P/B (the hard one).** For a foreign-currency ADR (BABA files equity in CNY; the ADR trades in USD), `P/B = USD market_cap / CNY equity` is a currency mismatch. Capturing the unit key (FR-1) is necessary but not sufficient — a correct P/B needs the equity and market cap in the same currency. Options for the debate: (a) compute P/B only when filing currency == trading currency, else leave it in `missing_metrics` (honest, preserves `@AC-22`, no FX dependency) — BABA would have no PIT P/B, which is correct-not-wrong; (b) use a USD convenience-translated equity fact when the XBRL unit key marks one as USD; (c) add a historical FX feed (larger scope). Same concern applies to any absolute value used cross-currency.
- **`debt_to_equity` tag coverage across taxonomies.** US-GAAP filers vs IFRS/20-F filers (BABA) use different XBRL debt concepts; the allow-list expansion + fallback order (combined-total-debt tag when component tags absent) is unverified — **Not found**: no debt XBRL tag is referenced anywhere in the service today.
- **Snapshot `as_of` semantics** (`@AC-12 @feature-204`) — "latest EDGAR filing + live price-join" mixes a filing date with a live-price timestamp; the single `as_of`-derived "Last refreshed" may need to change/split. Confirm intended semantics at the gate.
- **Provider-disable literal audit (fails.md 2026-08-13, feature 129).** Disabling FMP/Finnhub must not fall through to the Go-coded `false` default and silently disable fundamentals. FR-8 literal inventory (Go, non-test): `main.go:124,198,202,203`; `marketdata_service.go:1393-1394,1399,1558-1559,1574,1579,1583,1674`. The snapshot `.enabled` gate read site (exercised live by `marketdata_service_test.go:430-451`) must be located and the EDGAR-canonical path made the ACTIVE source when both vendors are off.
- **No fragile full-stack verification (fails.md 2026-08-13, feature 129).** Verify EDGAR debt tags + Alpaca dividends via a narrow direct-API check + fake-backed unit tests, never a deployed-instance `grpcurl` smoke test.
- **Real `Bar` fixtures (fails.md 2026-08-06).** Any price-join/analysis test uses real `marketdata_pb2.Bar` (`bar.time`), never `MagicMock`.
- **No promoted marketdata fundamentals-serving acceptance suite** — the design-adversary cannot catch a silent serving regression from an existing scenario; this feature should author new marketdata acceptance coverage for the currency + PIT-metric behavior.

## Recommended Scope

Advisory step boundaries (input to grilling + /sdd-spec):
1. **Currency capture (FR-1, prerequisite)** — read the XBRL unit key in `edgar_client.go`, store true `currency`; keep ratios same-currency. + unit tests.
2. **Financial-debt D/E (FR-2)** — expand the tag allow-list (US-GAAP + IFRS debt concepts + total-debt fallback), compute `total_debt/equity`. + unit tests.
3. **P/B at filing boundary (FR-3)** — extend `priceJoin` with `PBRatio` (currency-consistent per the Risks fork; missing-not-fabricated when mismatch). + unit tests.
4. **PIT dividend feed (FR-4)** — extend the Alpaca client for corporate-actions (cash dividends, `GetSecret` credential), compute T12M yield ≤ filed_date; new migration `006`. + unit tests.
5. **EDGAR-canonical snapshot (FR-5/FR-8)** — an EDGAR-backed snapshot source (latest filing + live price-join) selected when the provider is `edgar`; vendor fallback for non-SEC-filers; literal audit so disable is safe. + unit tests.
6. **Config seed (FR-5)** — new config migration: flip enabled defaults, add snapshot-source + `marketdata.dividends.*` keys.
7. **Data-explorer exposure (FR-6)** — add metrics to `FUNDAMENTAL_METRICS`; show currency + source. + Playwright.
8. **New marketdata acceptance coverage** — currency + PIT-metric + no-look-ahead scenarios (closes the C-16 blind spot).
