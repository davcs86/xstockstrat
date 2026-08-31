# Design: opportunity-live-market-enrichment

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved with two operator-confirm items carried as Open Risks)
**Approved by**: (design authored in an isolated `/sdd-design` subagent — Phase-1 gate items flagged for the operator; see Open Risks)
**Grounded in**: recon.md

---

## Chosen Approach

**Enrich at READ time, never at rank time.** All live values attach in `ListOpportunities` **after**
the DB read, decorating the paginated `window` (≤ `_DEFAULT_OPP_PAGE_SIZE = 50` rows,
`servicer.py:2992-2995`) — never inside `_compute_opportunities` (`servicer.py:3037`), which persists
rows and is served stale-while-revalidate + daily-refresh. This makes FR-8/AC-14 true **by
construction**: conviction, `signal_axis`, and the ORDER BY are computed, persisted, and read before
enrichment runs, so a fixed ranking input yields an identical score/order whether or not the
enrichment is attached (the live quote never reaches the ranking hot path). Enrichment is a
post-`_row_to_opportunity` decoration; the OR-F descriptor-parity guard (`servicer.py:3855`) is
satisfied by populating the new fields on the returned message.

**(a) Marketdata data shape — a small dedicated latest-trade RPC, not fields on `Quote`.** Add
`rpc GetLatestPrice(GetLatestPriceRequest) returns (LatestPrice)` to `MarketDataService`, additive
(new RPC, non-breaking):
```
message GetLatestPriceRequest { string symbol = 1; }
message LatestPrice {
  string symbol = 1;
  optional double last_price = 2;   // latest trade (Alpaca snapshot latestTrade.p)
  google.protobuf.Timestamp last_trade_time = 3;
  optional double prev_close = 4;   // prior session close
  string source = 5;                // "alpaca"
}
```
Go impl: latest trade from Alpaca's snapshot/latest-trade endpoint (cache-backed like
`GetLatestQuote`, `marketdata_service.go:451`); `prev_close` from the prior stored **daily** bar in
`marketdata.ohlcv` (a DB read — no extra Alpaca call). `change_pct` is derived downstream
(`(last-prev)/prev`), never stored on the wire. **Rejected: additive fields on `Quote`** — `Quote`
is served from the `marketdata.quotes` cache which has no last-trade/prev-close columns, so a cache
hit would return a fabricated `0` (indistinguishable from "no data"), and the 30s multi-symbol warm
poller would bloat with per-symbol trade+prev-bar fetches. A separate RPC keeps the hot quote path
untouched and models absence with explicit presence (`optional`) → AC-11 omit-not-fabricate. Both
options need new browser/BFF/mock wiring anyway (getLatestQuote is on no BFF today), so "additive
fields need no wiring" is not a real advantage.

**Analysis `Opportunity` block 13-18 — all explicit-presence, field numbers exactly as pre-assigned**
(so 110 lands at 19+, merge-order intact):
- `optional double live_price = 13;` `optional double change_pct = 14;`
- `optional double target_price = 15;` `optional double stop_price = 16;`
- `repeated SparklinePoint sparkline = 17;` with `message SparklinePoint { optional double close = 1; }`
- `repeated ConditionEval conditions = 18;` — **reuses the existing `ConditionEval`** (`analysis.proto:558`).

`live_price`/`change_pct`/`sparkline` are set from the read-time marketdata batch (`GetLatestPrice` +
existing `GetBars` newest-page for `analysis.opportunity.sparkline_bars` closes). A quote miss →
fields left **unset** (AC-11). Sparkline gaps → a `SparklinePoint` with **unset `close`** (never
`NaN`/`0`; the `IndicatorValue` idiom at `servicer.py:2919-2924`) → AC-4.

**(b) Per-condition chips on the queue card — via field 18, from the already-computed trace.** FR-3
puts chips on "the readiness leaves **and the queue cards**." The Signal-detail leaves reuse
`EvaluateReadiness`'s `ConditionEval` (no new proto). The queue card needs its own carrier because an
`Opportunity` row holds only `passing/total`; field 18 carries the attributed row's
already-traced `ConditionEval`s (populated in `_compute_opportunities`, which already runs the trace
— **no recompute**, server or client; AC-5). Unattributed rows carry none (AC-6). This is why field 18
is used rather than reserved.

**(c) Target/stop sourced from the strategy, omitted when absent; R:R + sizing client-side.**
`target_price`/`stop_price` (15/16) are read from optional numeric `target`/`stop` keys on the
attributed `StrategyDefinition.signal_params` (`Struct`, `analysis.proto` field 6) — the one
agent-writable place a strategy can carry them (via `manage_strategy`), recorded as a governance
convention, **no new authoring surface, no ATR derivation** (indicators stays out of scope). Absent →
fields unset → **no overlay line** (AC-8), which is today's reality for ~every row (see Open Risks).
R:R and suggested share count are computed **client-side** on the order ticket from values already on
hand (live price, target, stop, buying power via `insightsPortfolioClient.listPortfolios`,
`opportunities/page.tsx:128-136`) — **no `risk_reward`/`suggested_qty` proto field**, execution path
unchanged (`OrderForm`/`usePlaceOrder`, AC-10).

**(d) SymbolReadiness unchanged — the Signal-detail header reuses `Opportunity`.** The real
Signal-detail surface (`trader/positions/[symbol]/page.tsx`, feature 125 — the `insights/market`
route is a redirect stub) **already reads `useOpportunities` → `symbolOpportunities`** (`:185-189`),
so its header reads `live_price`/`change_pct`/`sparkline`/`target_price`/`stop_price` from the matching
`Opportunity` when the symbol is in-queue. **Cross-surface parity (FR-7/AC-12) holds structurally:**
both surfaces read the same `Opportunity.live_price` from the same shared React-Query
`useOpportunities` cache. For an **off-queue** symbol (AC-13) the header falls back to a direct
`marketDataClient.getLatestPrice` call → symbol + live price only, no chips/overlays/R:R. No fields are
added to `SymbolReadiness` (no field after 5).

**Consumer surfaces (C-14).** Queue cards `insights/opportunities/page.tsx` (price/change/sparkline +
condition chip); Signal-detail `trader/positions/[symbol]/page.tsx` (header price/change/sparkline,
target/stop overlay lines + legend reusing `SymbolPriceChart`'s `priceLinesRef`, condition chips);
order ticket (client-side R:R + sizing). BFF: add `getLatestPrice` to `MarketDataService` on
`traderBff`/`insightsBff` + `marketDataClient` method + `mock-backend` handler + `opportunities.ts`
fixture fields.

## Rejected Alternatives

- **Enrich in `_compute_opportunities` (persist live price with the row)** — rejected: the queue is
  stale-while-revalidate + daily refresh, so a persisted price would be hours old, defeating "live"
  (FR-1) and risking look-ahead entanglement with ranking (FR-8).
- **Additive `last_price`/`prev_close` fields on `Quote`** — rejected: the quotes cache can't persist
  them → cache-hit fabricated `0`; bloats the warm poller. (Chosen: dedicated `GetLatestPrice` RPC.)
- **`repeated double sparkline`** — rejected: cannot represent a gap without `NaN`/`0` (P-03,
  `MessageToDict` rejects non-finite). (Chosen: `repeated SparklinePoint{optional double close}`.)
- **Add live-price/sparkline fields to `SymbolReadiness`** — rejected: the header already reads the
  `Opportunity`; duplicate fields would create a second source and break same-field parity (C-10(b)).
- **Server `risk_reward`/`suggested_qty` fields** — rejected by FR-5: presentation-only, client-side.
- **Field 18 reserved/unused** — rejected: FR-3 requires the chip on the queue card too, and the
  trace is already computed, so carrying it costs nothing and keeps 110 at field 19+.
- **Derive target/stop from an ATR/stop rule** — rejected by FR-4 (no-fabrication; keeps indicators
  out of scope).

## Open Risks

- [ ] **No target/stop producer exists (OPERATOR CONFIRM).** `ExternalSignal` and `StrategyDefinition`
  carry no numeric target/stop today, so fields 15/16 render nothing until a source is populated.
  Decision to confirm: (A) ship 15/16 as explicit-presence plumbing fed from
  `StrategyDefinition.signal_params.{target,stop}` (agent-writable now; a strategy-builder "set
  target/stop" UI is a **named follow-up feature**) — recommended; or (B) defer fields 15/16 and the
  chart-overlay UI entirely to that follow-up. Either way AC-7 is testable only via an injected
  fixture value and AC-8 (no line when absent) is the real production path today. — resolve before
  `/sdd-spec`.
- [ ] **Marketdata read-pressure under the 15s poll (OPERATOR/DESIGN CONFIRM).** Read-time enrichment
  fans out ≤50 quote reads + sparkline bars per `ListOpportunities`; must batch (multi-fetch, like
  `GetLatestQuotesMulti`) and serve `prev_close`/bars from cache/DB to stay within the
  `fix-ohlcv-chunk-lock-oom` budget. — validate in the marketdata step's paired test.
- [ ] **`analysis.opportunity.sparkline_bars` default** — pick at `/sdd-spec` (e.g. 20 per AC-3),
  register in `docs/patterns/config-governance.md` (F-07).
- [ ] **`signal_params.{target,stop}` as a convention** needs a governance note (avoid the ad-hoc
  sentinel trap, fails 063 / C-10(c)).

## Constitution Rules Touched

- `C-04` — no new enum (fields only); existing `<NAME>_UNSPECIFIED` enums untouched. Honored.
- `C-10(b)` — same-field cross-surface parity: queue card and Signal-detail header both read
  `Opportunity.live_price` from the one marketdata-backed source; paired parity test (AC-12). Honored.
- `C-10(a/d)` — does NOT fire: adds fields, not enum values; `opportunityShared.tsx` exhaustive maps
  are over enums (`:29-52`). Confirmed.
- `C-14` — all three consumer surfaces named and each earns implementation steps (queue / Signal-detail
  / order ticket); the target/stop authoring UI is deferred to a **named** follow-up. Honored.
- `C-15`/`C-16` — every FR-1..FR-8 covered by ≥1 `@AC-*`; no existing `@AC-*` guarantee changed
  (net-new additive). Honored.
- `C-17` — new UI (chips, overlay legend, R:R row) uses design-role tokens + canonical primitives;
  reuses `SymbolPriceChart`/`priceLinesRef` and `StatTile`/`Badge`. Honored.
- `C-03` — analysis threads the propagation tuple on the new `GetLatestPrice`/`GetBars` calls
  (`servicer.py:2762-2766` pattern). Honored.
- `C-09`/`P-06` — additive proto: `buf lint` + `buf breaking` green (new fields/RPC only); red-before-green
  on every code step. Honored.
- `F-04` — no invented paths: the Signal-detail surface is the real `trader/positions/[symbol]` page,
  not the redirect stub; no target/stop producer is invented (surfaced as an Open Risk). Honored.
- `F-07` — `sparkline_bars` is a registered config key, no literal. Honored.
- `P-03` — sparkline/live/target/stop absence modeled as explicit-presence unset, never `NaN`/`0`;
  the target/stop absence-claim is escalated, not guessed. Honored.

## Business Rules Touched (C-16)

- PRESERVE opportunity-queue ranking/muted guarantees (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, `consolidate-watchlist-signal.feature`; analysis feature-097/131/132/134 ranking) — not regressed: enrichment is post-ranking (FR-8/AC-14 parity test).
- PRESERVE `services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature` — not regressed: batched, cache/DB-backed reads.
- PRESERVE the 083 no-fabrication + order-execution guarantees (AC-10, `OrderForm`/`usePlaceOrder`, environment-fixed PAPER/LIVE) — presentation-only R:R/sizing, no execution change.
- No existing `@AC-*` CHANGED — feature is net-new additive behavior.
