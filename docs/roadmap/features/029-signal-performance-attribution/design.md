# Design: signal-performance-attribution

**Created**: 2026-08-31
**Revised**: 2026-08-31 (operator gate closed — two confirmed decisions folded in; see context.md)
**Rounds**: 2 (full) + a revision pass encoding the operator's two confirmed decisions
**Approved by**: operator-confirmed decisions #1 (reuse 042, drop producer-side) and #2 (net-of-fees
wins via additive fee plumbing). The two design forks the prior round left open are now **closed**.
**Grounded in**: recon.md

---

## Chosen Approach

029 is **two additive, non-breaking pieces**:

**(A) A read-side `GetAttribution` RPC in `xstockstrat-analysis`** that aggregates feature 042's
already-persisted capture — no producer-side rebuild.

**(B) An additive, end-to-end per-fill `fees` seam** (trading fill event → portfolio realized-P&L
fold → analysis seal) so the attribution win test is **net of fees**, not gross.

### (A) Read-side aggregation over 042's capture (operator decision #1 — CONFIRMED)

The product spec's original producer-side plan (stamp a per-source weight vector on `trading.orders`
at `PlaceOrder`, then recompose via `ListOrders` + `QuerySignals`) is **dropped**. Feature 042 already
persists, in analysis-owned tables, exactly the inputs 029 needs:

- **Which positions closed, when, for whom, and their realized P&L** → `analysis.pnl_positions`
  (`user_id`, `symbol`, `closed_at`, `realized_pnl`), sealed by the 042 consumer on
  `portfolio.position.closed` (`pnl_pattern_consumer.py:256-283`, seal at `:267-276`).
- **The contributing signal sources + their conviction at order time** →
  `analysis.order_snapshots.signals` JSONB `[{name,value,source}]`, captured per `order.*` event
  (`pnl_pattern_consumer.py:108-116` composes it; `:206-223` inserts it). This is the reuse of 042's
  `SignalEntry`/`OrderSnapshot` shape the product spec's DRY directive asked for — **no new
  `trading.orders` attribution column, no `PlaceOrder` weight vector** (`PlaceOrderRequest` carries no
  signal linkage — `trading.proto:96`; recon Risks confirm no causal score→order weight vector is
  persisted anywhere).

**Handler (`AnalysisServicer.GetAttribution`)** — read-only, mirroring `QueryPnLPatterns`
(`servicer.py:2817`):
1. Resolve the caller from the **`x-user-id` header** via `_caller_user_id` (feature 133; never the
   request body — anti-IDOR, fails.md 131).
2. Query `analysis.pnl_positions` for the caller's sealed positions with `closed_at ∈ [start, end]`
   (additive index, migration `021`).
3. For each sealed position, read its `order_snapshots.signals`. **Winner-takes-all (FR-3):** attribute
   the whole trade to the source whose signal has the highest `value` (conviction) across the
   position's snapshots; an **exact tie on the top value** splits equally across the tied sources
   (two-way → 0.5/0.5). A position whose snapshots carry **no** signals is **`manual`** and excluded
   from per-source metrics (FR-2/AC-3).
4. **Win test is net of fees (FR-4):** a trade is a win iff `realized_pnl − fees_total > 0`, reading
   the additive `analysis.pnl_positions.fees_total` column (part B, migration `021`). Aggregate per
   `source_id` (the slug): `trade_count`, `win_count`, `win_rate = win_count/trade_count`,
   `avg_return`, `total_pnl` (net). Resolve `source_id → source_name` via ingest **`ListSignalSources`**
   over the existing `INGEST_ENDPOINT` stub (no new edge — F-06; AC-9 auto-appearance because the
   source is the snapshot slug, no enum).
5. Optional `source_id` request filter (FR-5).

### (B) Additive per-fill fee plumbing for net-of-fees wins (operator decision #2 — CONFIRMED)

**Honest verdict on the fee source (grep-established, not assumed):** **Alpaca does NOT expose
per-fill fees on the order/fill path.** The parsed Alpaca order object carries no fee/commission field
(`AlpacaOrder`, `alpaca.go:76-97`), and neither does the normalized `broker.BrokerOrder`
(`broker.go:15-29`). The `order.filled` event carries only `{order_id, symbol, qty, fill_price,
user_id, trading_mode, account_id}` — **no fee** (`trading.go:1712-1717`). Alpaca US equities are
**commission-free**; the only real charges are pass-through regulatory fees (SEC Section 31 on sells,
FINRA TAF), which Alpaca exposes **only** via the Account Activities API (`GET /v2/account/activities`)
as separate, typically **end-of-day-aggregated** `FEE`/`REG`/`TAF` non-trade rows — **not** attributable
to an individual fill on the order/fill path. No activities integration exists in trading today (grep:
no `/v2/account/activities` caller). So realized P&L today (`pnl.RealizedDelta`, `pnl.go:17-29`) is
**price-only, gross of fees** everywhere.

Given that, the design builds the fee-carrying seam **end-to-end and correct**, populated with a real
value where one exists and **defaulted to 0** on the Alpaca path with a named follow-up:

1. **Broker layer** — add `Fees float64` to `broker.BrokerOrder` (`broker.go:15-29`), cumulative fees
   for the order. The Alpaca adapter leaves it **0** (Alpaca's order object exposes none). Honest
   0-default; **no proto involved** (broker structs are internal Go).
2. **Trading fill emit** — stamp an additive **`"fees"`** key on the `order.filled` and
   `order.partially_filled` Struct payloads (`trading.go:1712-1717`, `:1728-1733`, and the submit-time
   immediate-fill emit at `:731-732`), value `brokerOrder.Fees` (0 for Alpaca today). The ledger event
   payload is a `google.protobuf.Struct` (`ledger/v1/ledger.proto:27`), so this is a **schemaless
   additive key — no proto change, `buf breaking` is N/A and stays green** (even more non-breaking than
   an additive proto field).
3. **Portfolio realized-P&L fold** — add `Fees` to the parsed `orderFillPayload`
   (`portfolio_service.go:217-231`) and accumulate it alongside `realized_accum`. Add a
   `fees_accum NUMERIC NOT NULL DEFAULT 0` column to `portfolio.positions` (**portfolio migration
   `014`**, paired down — the next NNN after `013_positions_provenance`), parallel to
   `realized_accum` (migration `010`; `UpsertPosition`/`GetRealizedAccum`,
   `portfolio_repo.go:57-88`). On full close (`portfolio_service.go:295-307`), emit an additive
   **`"fees_total"`** key on `portfolio.position.closed` (= `priorFeesAccum + closingFillFee`). **The
   existing `realized_pnl` key stays GROSS and unchanged** — this preserves 042's shipped
   pnl-patterns semantics (C-16 PRESERVE) and keeps `GetPnL` the authoritative gross figure (C-10(b)
   parity intact); net is layered on as a separate additive figure, mirroring the existing
   "`realized_accum` is attribution-stats-only, never user-facing" precedent (portfolio CLAUDE.md).
4. **Analysis 042 seal** — `_handle_close_event` (`pnl_pattern_consumer.py:256-283`) reads the additive
   `fees_total` from the payload and persists it. Add `fees_total NUMERIC NOT NULL DEFAULT 0` to
   `analysis.pnl_positions` (**analysis migration `021`**, paired down — combined with the
   `(user_id, closed_at)` query index in one migration). `pnl_positions.realized_pnl` stays gross.
5. **Win test** — `GetAttribution` computes net = `realized_pnl − fees_total` at query time. Rows with
   no fee data (pre-migration rows, and Alpaca-sourced rows until the follow-up) carry `fees_total = 0`,
   so **net == gross for them** — correct (absent fee data ⇒ net is gross), and the netting becomes
   exact the moment a real fee source populates `fees`. Unit tests inject a non-zero fee to prove the
   subtraction (AC-6, buildable today).

**Migrations added (both additive, paired up/down — F-01/F-06 honored, no new pool/service):**
- `services/xstockstrat-portfolio/migrations/014_positions_fees_accum.{up,down}.sql` —
  `ALTER TABLE portfolio.positions ADD COLUMN fees_accum NUMERIC NOT NULL DEFAULT 0;` / down drops it.
- `services/xstockstrat-analysis/migrations/021_pnl_positions_fees_total.{up,down}.sql` —
  `ALTER TABLE analysis.pnl_positions ADD COLUMN fees_total NUMERIC NOT NULL DEFAULT 0;`
  `CREATE INDEX ... ON analysis.pnl_positions (user_id, closed_at);` / down drops both. This
  **replaces** the product spec's dropped `trading.orders` migration `010`.

### Consumer surface (C-14)

A **new `/insights/attribution` page** — a sortable `DataTable` (`ui/data-table.tsx`), a date-range
control, a `source_id` filter, and a copy-to-clipboard CSV export (FR-6/FR-7). Registered in
`PLATFORM_SUBNAV` (`PlatformHeader.tsx:72`) with a **nav-reachability test** (C-10(a); the 060/058
fail). BFF via the existing `[...connect]` route + `insightsBff.ts` + a `useSignalAttribution` hook
modeled on `usePnLPatterns.ts`. Design-role tokens + canonical state primitives only (C-17). New
`SourceAttribution` e2e fixture + `INVENTORY.md` row (C-12/C-13). Because P&L is shown net of fees, the
UI names it "net of fees" so it doesn't silently disagree with 042's gross pnl-patterns page.

### Proto (additive)

Append `GetAttribution` to `AnalysisService` (after `analysis.proto:49`) +
`GetAttributionRequest{start, end, source_id?}`, `SourceAttribution{source_id, source_name,
trade_count, win_count, win_rate, avg_return, total_pnl}`, `GetAttributionResponse{repeated
SourceAttribution}` (after `:746`). **`Opportunity` (`:542`) is untouched → confirmed no field-number
collision with features 095/110.** The fee seam adds **no** proto fields (ledger payloads are Structs),
so `buf breaking` stays green with only the additive RPC/messages (C-09).

## Rejected Alternatives

- **Product-spec-literal producer-side rebuild** (trading migration `010` + `PlaceOrder` weight vector
  + analysis → trading `ListOrders` + analysis → ingest `QuerySignals` recomposition) — rejected
  (operator decision #1): duplicates 042's already-persisted `order_snapshots`/`pnl_positions` (DRY);
  trading has **no** causal weight vector to stamp (`PlaceOrderRequest` has no signal field —
  `trading.proto:96`; no score→order path exists); adds two runtime gRPC edges to re-derive what 042's
  consumer already wrote once.
- **Gross-only win test** (redefine AC-6 to "win = gross realized P&L > 0") — rejected (operator
  decision #2): the operator wants net of fees. Kept AC-6 net and made it buildable via the additive
  fee seam instead of redefining it away.
- **Subtract fees into the existing `realized_pnl` key** (make `portfolio.position.closed`'s
  `realized_pnl` net) — rejected: that silently changes a **launched** feature's semantics (042's
  pnl-patterns page surfaces this exact figure as gross) and diverges from `GetPnL`'s authoritative
  gross realized P&L — a C-10(b)/C-16 regression. Net is added as a **separate** additive figure
  (`fees_total`), leaving the authoritative gross untouched.
- **Route the fee through a typed proto field on the fill** — rejected as unnecessary: the fill event
  is a `google.protobuf.Struct` (`ledger.proto:27`), so an additive map key is strictly more
  non-breaking than adding a proto field and needs no `buf-gen`.
- **Source Alpaca fees from the Account Activities API now** — rejected for V1 scope: `FEE`/`REG`/`TAF`
  activities are end-of-day-aggregated and not per-fill, so attributing them to an individual
  fill/position needs a matching pass (a real follow-up, see Open Risks). V1 builds the seam and
  defaults Alpaca fees to 0.
- **Aggregate over `pnl_pattern_samples`** — rejected: `_build_samples` stores only
  `signal_present=true`, dropping the conviction value (`pnl_pattern_consumer.py:337-352`), so it
  cannot pick the highest-weighted source and it fans a position out to every factor (double-counting).
  Read `order_snapshots.signals` instead.
- **A new pre-computed attribution event/table at position close** — rejected: 042 already writes at
  seal; a query-time read matches 042's "bucket at query time" precedent (`servicer.py:2817`).
- **Extend `QueryPnLPatterns` instead of a new RPC** — rejected: it is symbol-scoped and returns ranked
  indicator/signal *factors* (correlation), not date-range per-source win/loss; different request shape.
- **Recompute realized P&L in analysis** — rejected: a second realized-P&L formula is the exact
  056 / C-10(b) fail. Reuse the authoritative gross figure; fees are an additive layer, not a recompute.

## Open Risks

- [ ] **Alpaca fee value is 0 until an Activities-API follow-up lands.** The seam is correct and
  net-of-fees end-to-end, but Alpaca's order/fill path exposes no per-fill fee (`alpaca.go:76-97`;
  equities commission-free; SEC/TAF only in `/v2/account/activities`, end-of-day-aggregated). So in
  production the Alpaca-sourced `fees` is 0 and net == gross until a **named follow-up feature** sources
  regulatory fees from the Activities API and matches them to fills/positions. Record as the V1 limitation
  in the UI ("net of fees; broker regulatory fees pending") and context.md. AC-6 is proven today by
  injecting a fee in tests (the fold subtracts correctly); the real Alpaca value is the follow-up. →
  acceptance note + follow-up feature.
- [ ] **`avg return %` denominator** — derive cost basis from the opening snapshot price×qty
  (approximate) or express as avg P&L $; pin at /sdd-spec. → analysis step.
- [ ] **042 synthesized-`position_id` window sharing** (multi-cycle same identity) and short/sync
  `realized_accum` inexactness — inherited v1 limitation (no worse than 042's shipped page); accept and
  name in the UI/docs. `fees_accum` inherits the same window semantics as `realized_accum`. → analysis
  step + acceptance note.
- [ ] **C-10(b) parity** — add a parity check that GetAttribution's per-source **gross** total
  reconciles with the underlying `pnl_positions.realized_pnl` sums, and that net = gross − fees_total
  (AC-1). → test step.
- [ ] **Overlap re-scan at /sdd-spec** — confirm analysis migration `021`, portfolio migration `014`,
  and the new RPC name are still free against all remote branches (fails.md 081 numbering trap). →
  /sdd-spec.

## Constitution Rules Touched

- `C-01` — honored: every claim cites a `path:line`; the fee-source absence is grep-established
  (`alpaca.go:76-97`, `broker.go:15-29`, `trading.go:1712-1717`, no activities caller), not assumed.
- `C-04` — honored: `source_id` stays a **string** (open source registry; AC-9 auto-appearance).
- `C-07` — honored: analysis `021` and portfolio `014` are each `NNN_*.up.sql` + paired `.down.sql`.
- `C-09` — honored: additive proto (new RPC + messages only) through `buf lint`/`buf breaking`/
  `buf-gen`; the fee seam adds **no** proto (Struct payload key), so nothing to break.
- `C-10(a)` — honored: new `/insights/attribution` page registered in `PLATFORM_SUBNAV` with a
  nav-reachability test.
- `C-10(b)` — honored: no second realized-P&L formula; `pnl_positions.realized_pnl` and `GetPnL` stay
  the authoritative **gross** figure. Net-of-fees is an **additive** `fees_total` layer, not a
  divergent recompute; a parity test reconciles gross and net.
- `C-12`/`C-13` — honored: UI tests use `e2e/fixtures/` + a new `SourceAttribution` fixture +
  `INVENTORY.md` row; portfolio/analysis fee-fold tests inject fixtures.
- `C-14` — honored: the `/insights` attribution panel is the named consumer surface with its own steps.
- `C-16` — honored: 042's `order-snapshots-pnl-patterns.feature` and the portfolio realized-P&L
  producer contract are **PRESERVE** — 029 adds a read RPC and an **additive** `fees_total`/`fees_accum`
  column + payload key; it does not change the existing `realized_pnl` key or the consumer's
  capture/seal path. **AC-6 is net-new (built, not changed)** — the earlier "redefine to gross" CHANGE
  is withdrawn.
- `C-17` — honored: design-role tokens, `DataTable`/canonical primitives, accessible control names.
- `P-03` — honored: both prior forks are now operator-confirmed decisions (recorded in context.md);
  the Alpaca-fee-is-0 limitation is surfaced as an Open Risk with a named follow-up, never silently
  papered over.
- `F-01` — honored: two **new** numbered migrations; no applied `.up.sql` edited.
- `F-06` — honored: adding a column to an existing table adds no new pool/edge/service; analysis reuses
  its asyncpg pool + existing `INGEST_ENDPOINT` stub; portfolio reuses its pool. No Floor breach.

## Business Rules Touched (C-16)

- PRESERVE `@AC-*` "Order snapshots and P&L pattern attribution"
  (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — 029 adds a
  read-only RPC + additive read repo methods + an additive `fees_total` column; it does not touch the
  consumer's capture/seal path or `QueryPnLPatterns`, and leaves `realized_pnl` gross.
- PRESERVE the **`portfolio.position.closed` producer contract** (portfolio CLAUDE.md § Ledger Events
  Emitted) — 029 only **adds** a `fees_total` key; the existing `{user_id, symbol, account_id,
  trading_mode, realized_pnl}` keys and their gross semantics are unchanged.
- PRESERVE "Deregistering an offline account purges its positions and realized P&L"
  (`docs/sdd/business-rules/platform.feature`) — 029 reads `pnl_positions` as-is; purged positions
  simply do not appear.
- ADD (net-new) `@AC-6` "Win is defined as realized P&L greater than 0 after fees" — now **buildable**
  via the additive fee seam; no existing rule is changed to accommodate it.
