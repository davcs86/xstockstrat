# Recon: opportunity-live-market-enrichment

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (Python), xstockstrat-marketdata (Go), xstockstrat-ui (Next.js), packages/proto

---

## Objective

Fill the Nocturne handoff's market-context extras that feature 083 intentionally left un-faked:
live price + change%, a price sparkline, per-condition value chips, target/stop chart overlays, and
R:R + suggested sizing — backend (additive proto + an additive marketdata latest-trade/prior-close
exposure) plus the UI that consumes them, every field degrading gracefully under the inherited
no-fabrication rule (FR-6). No ranking-math change (FR-8), no order-execution change (FR-5).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`
  - marketdata stub already wired: `self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)` — `servicer.py:344` (edge exists; `MARKETDATA_ENDPOINT` `app/main.py:28`)
  - `ListOpportunities` — **pure DB read** of the materialized queue: `servicer.py:2945`; paginated `window = rows[offset:offset+page_size]` `:2992`; returns `[_row_to_opportunity(r) for r in window]` `:2995`. `_DEFAULT_OPP_PAGE_SIZE = 50` `servicer.py:256`.
  - `_compute_opportunities` (persists rows to `analysis.opportunities`, stale-while-revalidate + daily refresh): `servicer.py:3037`; already fetches bars per symbol for the readiness trace and threads C-03 `propagation_meta`.
  - `_row_to_opportunity` — the producer↔reader↔UI contract point **pinned by an OR-F descriptor-parity test** (every `Opportunity` field must be populated here or the test fails): `servicer.py:3855-3880`.
  - `EvaluateReadiness` — per-symbol `SymbolReadiness` + `ConditionEval` PASS/SOFT/FAIL leaves + deterministic conviction ordinal: `servicer.py:2752`; C-03 meta filter `:2762-2766`.
  - Existing null-safe explicit-presence idiom for series: `IndicatorValue(value=v) if v is not None else IndicatorValue()` — `servicer.py:2919-2924` (GetIndicatorSeries; the P-03 null-not-fabricated-0 pattern).
  - `GetLatestQuote` is **never called by analysis today** (grep of `app/` is empty) — the stub exists, this RPC path does not.
- **`xstockstrat-marketdata`** (Go)
  - `GetLatestQuote` handler `internal/handler/marketdata_handler.go:98`; service `internal/service/marketdata_service.go:451` (serves from `marketdata.quotes` DB cache → live Alpaca fallback → cache); repo `internal/repository/marketdata_repo.go:269`.
  - Alpaca latest quote `internal/alpaca/client.go:234` → `/v2/stocks/{sym}/quotes/latest` — returns **bid/ask only** (`alpacaLatestQuoteResponse` `:223`); multi variant `GetLatestQuotesMulti` `:339`. **No latest-trade, no snapshot, no prevDailyBar fetch anywhere** (grep of `internal/` empty for `Snapshot`/`LatestTrade`/`prevDaily`).
  - `GetBars` (daily-only since 143) serves newest page with no range start (`QueryRecentBars`) `marketdata_service.go:128`; prior daily close is derivable from stored `marketdata.ohlcv`.
- **`xstockstrat-ui`** (Next.js)
  - **Signal-detail surface moved (feature 125):** `src/app/insights/market/[symbol]/page.tsx` is now a **redirect-only stub** → `/trader/positions/[symbol]` (`page.tsx:6-22`). The real surface is `src/app/trader/positions/[symbol]/page.tsx` (1324 lines).
  - That page: `last = Number(position?.currentPrice ?? 0)` `:136` (held-only; **0 for a non-held/off-queue symbol** — the FR-1 gap); `avg`/`stop`/`hasStop` are **position** fields (avg cost + bracket stop) `:134-137`; `SymbolPriceChart` draws avg/stop as chart price lines via `priceLinesRef` `:129`, `:501-554`; already reads `useOpportunities(0)` → `symbolOpportunities` for this symbol `:185-189`; `SignalReadiness` (EvaluateReadiness leaves) `:30`; `OrderForm` order ticket `:58`; `marketDataClient.getBars` `:199`.
  - Opportunities queue: `src/app/insights/opportunities/page.tsx` — **no price today** (doc comment: "live price/change, sparkline, per-condition values, R:R ... intentionally omitted rather than faked" `:90-92`); reads `useOpportunities(0)`; buying power via `insightsPortfolioClient.listPortfolios` `:128-136` (already on hand for FR-5 sizing).
  - Enum render maps: `src/lib/opportunityShared.tsx` — exhaustive `Record<Enum,…>` over **enums** (`OPPORTUNITY_ACTION`/`CONDITION_STATE`/`POSITION_RISK_FLAG`/`SOURCE_HEALTH`) `:29-52`.
  - marketdata browser client `src/lib/browserClients/marketDataClient.ts` (`/trader/api`); BFF registers `MarketDataService` with **only `getBars`** — `insightsBff.ts:79-80`, `traderBff.ts:73-74`. e2e mock has **only `getBars`** `e2e/mock-backend.ts:458`.

## Patterns to REUSE

- **Read-time enrichment attach point** → `ListOpportunities` after the DB read, decorating the ≤50-row `window` (`servicer.py:2992-2995`) — NOT `_compute_opportunities` (persisted/stale). Keeps live values live and keeps the ranking untouched.
- **Explicit-presence null-safe scalar** for sparkline/live fields → the `IndicatorValue(value=v)`/`IndicatorValue()` idiom at `servicer.py:2919-2924` and the `optional double value` message (`analysis.proto:682-684`). Models a gap/absent point as **unset**, never NaN/0 (P-03).
- **`ConditionEval`** (`analysis.proto:558-566`) is already emitted by the traced evaluator — reuse verbatim for FR-3 chips (Signal-detail via `EvaluateReadiness`; queue card via a new per-Opportunity carrier populated from the same trace, no recompute).
- **Descriptor-parity guard** `_row_to_opportunity` (`servicer.py:3855`) — every new persisted `Opportunity` field must be carried here; read-time-only fields are set on the returned message after it.
- **marketdata cache + multi-fetch** (`GetLatestQuote` cache→live `marketdata_service.go:451`; `GetLatestQuotesMulti` `client.go:339`) — the new latest-trade/prior-close read should follow the same cache-backed, batchable shape to bound Alpaca calls.
- **`SymbolPriceChart` price-line mechanism** (`priceLinesRef`, `trader/positions/[symbol]/page.tsx:129,537-550`) — reuse for the target/stop overlay lines + legend (FR-4), alongside the existing avg/stop position lines.
- **Buying power already fetched** on the queue page (`insightsPortfolioClient.listPortfolios`, `opportunities/page.tsx:128-136`) and available on the symbol page — reuse for client-side R:R + sizing (FR-5), no server field.
- **e2e fixtures** `e2e/fixtures/opportunities.ts` (`OPPORTUNITIES` incl. the `CAPR` rows the ACs name; `symbolReadiness`) + `INVENTORY.md` rows 25-26 — extend for the enrichment fields (C-12/C-13); add a `getLatestPrice`/latest-trade mock handler beside `getBars` in `mock-backend.ts`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-*` opportunity-queue ranking/muted guarantees — `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, `consolidate-watchlist-signal.feature`; analysis `_compute_opportunities` ranking (feature 097/131/132/134). Enrichment must not change conviction/signal_axis/ordering (FR-8/AC-14).
- **PRESERVE** marketdata OHLCV read-pressure guarantee — `services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature` (30-day chunking, feature 153). New per-read bars/quote fan-out over the window must stay within that budget (batch + cache-backed).
- **PRESERVE** the no-fabrication guarantees inherited from 083 (price omitted not synthesized; `null` not `NaN`; absent target/stop → no line) and the order-execution path (`usePlaceOrder`, environment-fixed PAPER/LIVE) — `OrderForm`/AC-10.
- **PRESERVE** `docs/sdd/business-rules/platform.feature` cross-cutting header-propagation / no-look-ahead rules.
- No CHANGE to any existing rule intended — this feature is net-new additive behavior.

## Dependencies

- **Proto** (`packages/proto/analysis/v1/analysis.proto`): `Opportunity` current max field **12** (`muted=12`, `:542-556`); `ConditionEval` `:558-566`; `SymbolReadiness` max **5** `:568-575`; `IndicatorValue{optional double value}` `:682-684`. `packages/proto/marketdata/v1/marketdata.proto`: `Quote` max **7** `:60-68`; `Bar.close=6` `:44-58`; `GetLatestQuote` `:23`, `GetBars` `:20`.
- **Proto (marketdata latest-trade/prior-close)**: `GetLatestQuote`/`Quote` return bid/ask only — no last-trade, no prior close (confirmed `client.go:223-267`). Additive exposure needed (shape → design).
- **No migration** — enrichment reads existing OHLCV/quotes; persisted `Opportunity` extras (if any) ride the existing `analysis.opportunities` row JSONB like `muted` rides the `"denied"` provenance marker (no column; `servicer.py:3873-3875`).
- **Config key** (new): `analysis.opportunity.sparkline_bars` (F-07, env-overridable; register in `docs/patterns/config-governance.md`; default → design).
- **Inter-service edges**: analysis → marketdata (new `GetLatestQuote`/latest-trade **call site**; the channel exists, the call does not). UI browser → BFF → marketdata (new BFF route for the latest-trade read + browser method + e2e mock — **none exist today**).
- **New env vars / ports**: none.

## Risks / Not-found

- **TARGET/STOP HAS NO PRODUCER (absence claim, fails 023/080/082).** FR-4 sources `target_price`/`stop_price` from "the originating signal / strategy definition where present." **Neither exists today:** `ExternalSignal` (ingest.proto) carries no target/stop (`source/symbol/direction/conviction/valid_from/until/headline/raw_url/tags/ingested_at` only); `StrategyDefinition` (analysis.proto:…) carries no numeric target/stop — only `exit_rule` (JSON condition tree) + `signal_params` (`Struct`); the only `entry_price` is on `TradeRecord` (`analysis.proto:162`, a backtest trade). So fields 15/16 would be **universally omitted** — plumbing with no data path. Operator decision required (design § Open Risks).
- **Signal-detail surface relocation (fails 080/082).** The product spec names `insights/market/[symbol]` for the header/chart/ticket, but that route is a redirect stub (feature 125); the real surface is `trader/positions/[symbol]`. Any spec step citing the old page must target the new one.
- **Read-pressure.** Read-time enrichment over ≤50 symbols on a 15s poll per active user adds quote+bars fan-out to marketdata — must batch + serve from cache to honor `fix-ohlcv-chunk-lock-oom` (marketdata).
- **`null`-not-`NaN` (fails 067 / P-03).** Sparkline warm-up/absent points and unset live/target/stop must be modeled as explicit-presence unset, never `NaN`/`0` — `MessageToDict` rejects non-finite.
- **Cross-surface parity (fails 056 / C-10(b)).** Queue card and Signal-detail header must read the SAME field from the SAME source.
- **C-10(a/d) does NOT fire** — the exhaustive TS `Record<Enum,…>` maps are over enums; this feature adds fields, not enum values (confirmed `opportunityShared.tsx:29-52`).

## Recommended Scope

1. proto (analysis): add `Opportunity` fields 13-18 (explicit-presence) + reuse `ConditionEval`; marketdata additive latest-trade/prior-close read.
2. marketdata (Go): implement the latest-trade + prior-close read (Alpaca snapshot/prevDailyBar + stored OHLCV), cache-backed + batchable.
3. analysis (Python): read-time enrichment in `ListOpportunities` (live_price/change_pct/sparkline/conditions; target/stop per the operator decision); FR-8 guard = enrichment is post-ranking; paired parity + no-look-ahead tests.
4. config: register `analysis.opportunity.sparkline_bars`.
5. UI: queue-card price/change/sparkline/condition-chip; `trader/positions/[symbol]` header + target/stop overlay + condition chips; client-side R:R + sizing on the ticket; BFF latest-trade route + browser method + e2e mock + fixtures. Parity test (queue ↔ Signal-detail).
