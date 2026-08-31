# Product Spec: opportunity-live-market-enrichment

**Created**: 2026-08-02

---

## Problem Statement

Feature 083 reframed `xstockstrat-ui` around the opportunities-first "Nocturne" design, but several
handoff elements (screenshots `01-opportunities`, `02-signal-detail`) show market context that **no
current RPC returns**: live price + change%, a price sparkline, per-condition live value chips,
target/stop overlay lines on the Signal-detail chart, and risk:reward + suggested share sizing on the
order ticket. Per 083's no-fabrication constraint those were **intentionally omitted, not faked** (see
083 `context.md` § "No-fabrication constraint honored"). A trader must currently leave the Decide
surface to see whether a signal's price has moved or how a fill would size. This feature closes those
gaps in the backend **and** wires the UI that consumes them — every new field degrading gracefully
under the inherited no-fabrication rule.

## User Story

As a trader, on the Decide surface I want each opportunity and the Signal-detail page to show the
live market context the handoff calls for — current price/change, a sparkline, per-condition values,
target/stop levels on the chart, and R:R + sizing on the ticket — so that I can judge and size a
signal without leaving the queue.

## Functional Requirements

FR-1. **Live price + change%** on each Opportunities queue card and the Signal-detail header, sourced
  from `xstockstrat-marketdata` (the broker-authoritative latest quote/trade), not recomputed
  divergently per surface.
FR-2. **Price sparkline** — a compact recent-bars series on each queue card and the Signal-detail
  header, sourced from marketdata bars.
FR-3. **Per-condition live value chips** (e.g. `close > sma_20 +1.4%`) on the readiness leaves and the
  queue cards. Reuse the traced evaluator's already-emitted `ConditionEval` values
  (`ref_name`/`lhs_value`/`threshold`/`fn`/`distance_to_threshold` — feature 083) where available;
  do not re-derive or duplicate that computation.
FR-4. **Target + stop overlay lines** on the Signal-detail candlestick chart, at the opportunity's
  target and stop price levels, with a legend (matching the handoff's "target / stop / signal bar").
  **Source (resolved):** `target_price`/`stop_price` are sourced from the opportunity's originating
  signal / strategy definition where present; when absent they are **omitted** (no overlay line
  drawn), never derived or fabricated (consistent with the inherited no-fabrication rule). No
  ATR/stop-rule derivation — this keeps `xstockstrat-indicators` **out of scope**.
FR-5. **Risk:reward + suggested share sizing** on the Signal-detail order ticket, derived from
  entry/stop/target and the broker's buying power. **Location (resolved):** both are computed
  **client-side in the UI** from values already on hand (live price, target, stop, buying power) —
  there are **no server `risk_reward`/`suggested_qty` proto fields**. Presentation only — **no change
  to order execution** (FR-20 of 083 stays: same `usePlaceOrder` path, environment-fixed PAPER/LIVE).
FR-6. **No-fabrication rule (inherited from 083).** Every new field degrades gracefully — a card,
  header stat, chart overlay, or ticket row is **omitted / em-dashed** when its data is absent, never
  synthesized. A symbol not in the ranked queue keeps the current symbol+price-only header.
FR-7. **Cross-surface parity (C-10(b)).** The live price/change shown on the queue card and on the
  Signal-detail header must come from the one marketdata source via the same new field, with a parity
  test asserting the two surfaces agree (mirrors 083's AC-8 valuation parity between Portfolio and
  Exposure).
FR-8. **No look-ahead into ranking (analysis-owned invariant).** Folding a live quote/trade into the
  Decide surface must never leak future data into the conviction/readiness ranking hot path — a fixed
  ranking input must produce an identical conviction score and readiness ordering whether or not the
  live-quote enrichment is attached (the hot backtest/ranking path stays frozen).

## Out of Scope

- Streaming/real-time push of price ticks — this feature is poll-refreshed like the rest of the Decide
  surface (the existing `useOpportunities` 15s poll cadence), not a websocket. A live-streaming
  Decide surface is a separate future feature.
- Any change to conviction/readiness ranking math, order execution semantics, or the Copilot rail.
- Broker-side bracket/OCO order placement for the target/stop — the overlay lines are advisory
  visualization only; wiring them into an actual bracket order is a separate future feature.
- Backfilling historical sparkline data — the sparkline uses whatever recent bars marketdata already
  serves.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — extend `ListOpportunities` / `EvaluateReadiness` aggregation to attach the
  new market-context fields; reads marketdata quotes/bars. **Owner of the no-look-ahead invariant** —
  folding a live quote into the Decide surface must not leak future data into conviction/readiness
  ranking (the hot backtest path stays frozen).
- `xstockstrat-marketdata` — serves the live price (**latest trade**) + **prior close** + recent bars
  the enrichment reads. The existing `GetLatestQuote`/`Quote` returns **bid/ask only** (no last-trade
  price, no prior close), so this feature adds an **additive, non-breaking** exposure of latest-trade
  price + prior-close (additive `Quote` fields or a small latest-trade read RPC — shape resolved at
  `/sdd-design`); change% is computed from the prior close.
- `xstockstrat-ui` — consume the new fields on `insights/opportunities` cards, the
  `insights/market/[symbol]` header + chart overlays + order ticket, and compute R:R + suggested
  sizing client-side (FR-5). Keep the no-fabrication rule.
- `xstockstrat-portfolio` — _FYI_: buying power for the client-side suggested sizing (already read on
  the Opportunities page via `insightsPortfolioClient.listPortfolios`; sizing reuses it rather than a
  new server read).
- `xstockstrat-indicators` — **out of scope**: per-condition indicator values are already produced by
  the analysis traced evaluator (no new sandbox path), and target/stop come from the signal/strategy
  (never ATR-derived), so no indicators change is involved.
- `packages/proto` — additive `Opportunity` / `SymbolReadiness` field additions (pre-assigned block,
  no `risk_reward`/`suggested_qty`) **and** the additive `marketdata` latest-trade/prior-close change.
  See `## Proto Contract Changes`.

## Consumer Surface(s)

**C-14 — this feature changes UI surfaces.**

- [x] **UI** — `xstockstrat-ui`, all three consumer surfaces on the Decide flow:
  - **Decide surface** — the Opportunities queue cards (`insights/opportunities`): live price + change%,
    sparkline, per-condition value chips.
  - **Signal-detail surface** — `insights/market/[symbol]`: header (live price + change% + sparkline),
    candlestick chart (target/stop overlay lines + legend), per-condition chips.
  - **Order-ticket surface** — the Signal-detail order ticket: risk:reward + suggested share sizing
    (presentation only, execution path unchanged).
- [ ] Agent (MCP tools) — no change.
- [ ] Config-UI — no change.

All three surfaces must be registered/reachable via the existing Decide navigation (no new route) and
must honor the no-fabrication rule (FR-6). C-10(b) parity is required between the Decide queue card and
the Signal-detail header (FR-7).

## Proto Contract Changes

- [ ] No proto changes required
- **Additive only** (non-breaking on every message). Field numbers below are **pre-assigned** so this
  feature and the parallel feature 110 do not collide; `buf lint` + `buf breaking` must stay green.

  **`analysis.Opportunity`** (current max field = **12**) — append a **contiguous enrichment block
  starting at field 13**:
  - `double live_price = 13;`
  - `double change_pct = 14;` — computed from the prior close (see marketdata below)
  - `double target_price = 15;` — from the originating signal / strategy; unset/omitted when absent
  - `double stop_price = 16;` — same source rule as target
  - sparkline series = **17** — a `repeated double` or a dedicated `repeated SparklinePoint` (shape at
    design)
  - per-condition live-value carrier = **18** — optional, only if the queue card folds in readiness
    chips (see Design-Phase Decisions)
  - **No `risk_reward` / `suggested_qty` fields** — R:R and suggested sizing are computed client-side
    in the UI (FR-5), so nothing server-side carries them.
  - **Coordination note:** feature 110 appends its confidence field **AFTER** this block (the next
    free field, i.e. 19+); see `docs/roadmap/features/merge-order.md` (110 blocked by 095).

  **`analysis.SymbolReadiness`** (current max field = **5**) — append any per-symbol
  live-price/change%/sparkline field the Signal-detail header needs **after field 5** (or reuse the
  `Opportunity` fields if the header reads the queue row — see Design-Phase Decisions).

  **`marketdata` (`packages/proto/marketdata/v1/marketdata.proto`)** — the existing
  `GetLatestQuote`/`Quote` returns **bid/ask only** (no last-trade price, no prior close), yet the
  scenarios need a latest **trade** price and a **prior close** to compute change%. Add an
  **additive, non-breaking** exposure of latest-trade price + prior-close — either additive fields on
  the quote read (`Quote` current max field = **7**, so append at **8+**) or a small latest-trade read
  RPC. Exact field/RPC shape resolved at `/sdd-design`.

  - Any new enum must carry `<NAME>_UNSPECIFIED = 0` (C-04 / C-10(a)). **If a new enum is introduced,
    every exhaustive TS `Record<Enum,…>` map in `xstockstrat-ui` (e.g. `src/lib/opportunityShared.tsx`)
    must gain its entry in the same PR** (C-10(a/d)) or `tsc`/`pnpm build` fails. This feature adds
    fields, not enum values, so it should not fire.
- Regenerate stubs with `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` must pass (additive).

## Config Key Changes

- [ ] No new config keys
- The sparkline bar-count / lookback default is a config key, `analysis.opportunity.sparkline_bars`
  (the sparkline is now confirmed in scope — `Opportunity` field 17). It must be **env-overridable**
  (F-07 — no bare literal), follow the `<service>.<category>.<key>` naming, and be registered in the
  Per-Feature Registered Keys log in `docs/patterns/config-governance.md`. (Exact default value
  resolved at `/sdd-design`.)

## Database Changes

- [ ] No schema changes — the enrichment reads existing marketdata OHLCV/quotes; no new tables/columns.

## Feature Workflow Notes

Branch to create: `feature/opportunity-live-market-enrichment` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] **Non-breaking proto gate**: Proto Reviewer + affected service owners (analysis, marketdata, ui)
  — the additive field pass; `buf breaking` must stay green.
- [x] Platform Lead: confirm the `analysis → marketdata` (and any sizing) inter-service edge in the
  dependency graph and all three deployment files.
- [ ] Breaking proto (2 owners + platform lead) — **not expected** (additive only); re-gate only if
  design forces a breaking change.
- [ ] DBA + service owner (schema migration) — **not expected** (no schema change).

## Acceptance Criteria

See [`acceptance.feature`](acceptance.feature) — the Gherkin `@AC-*` scenarios are the single source of
acceptance truth (Constitution **C-15**). Every `FR-N` above is covered by at least one `@FR-N`-tagged
scenario; those scenarios are traced to test steps by `/sdd-spec` and promoted into the durable
per-service business-rule suites at launch (**C-16**).

## Open Questions

None — the two scope-defining questions are **resolved inline**: the target/stop source in FR-4 (from
the originating signal / strategy, omitted when absent — no ATR derivation) and the R:R +
suggested-sizing location in FR-5 (client-side in the UI, no server fields). The no-look-ahead
invariant is now a first-class requirement (FR-8, covered by AC-14). The remaining mechanism/shape
choices moved to **Design-Phase Decisions**, and the known traps to **Design Guardrails**, both below.

## Design-Phase Decisions (owned by /sdd-design)

Scope is settled; only the "how" remains — resolve each at `/sdd-design`:

- **Marketdata latest-trade/prior-close shape.** Additive fields on the `Quote` read (append at 8+)
  vs. a small dedicated latest-trade read RPC — pick the smaller non-breaking option. (The *need* for
  the additive exposure is resolved in the Proto section; only the exact field/RPC shape is open.)
- **Per-condition chips on the queue card.** `ConditionEval` leaves exist on `EvaluateReadiness`
  (strategy-scoped); the `Opportunity` queue row carries only `passing/total`. Decide whether the card
  shows the blocking-condition chip via a per-opportunity readiness fold-in (the field-18 carrier) or
  only on Signal detail.
- **Sparkline payload shape.** `repeated double` vs. a dedicated `repeated SparklinePoint` message for
  the field-17 series (must model gaps as `null`, never `NaN` — see Design Guardrails).
- **SymbolReadiness live fields vs. reuse.** Whether the Signal-detail header reads its own additive
  `SymbolReadiness` fields (after field 5) or reuses the `Opportunity` enrichment fields.

## Design Guardrails

Known traps to design out (grounded in the Ledger; verify at the design gate):

- **analysis→marketdata edge verify (fails.md 080/082).** An "edge already exists / RPC already
  served" claim is an *absence claim* — grep-verify it end-to-end (analysis→marketdata call site +
  BFF route + browser client + e2e mock), not from the advertised proto alone.
- **Sparkline gaps as `null`, not `NaN` (fails.md 067 / P-03).** If sparkline bars pass through a
  protobuf `Struct`, `MessageToDict` **rejects** `NaN`/`Inf`; model warm-up/absent points as `null`
  (Python `None`), never `NaN`, so the payload round-trips (AC-4).
- **Cross-surface price parity (fails.md 056 / C-10(b)).** The queue card and the Signal-detail header
  must read the *same* new field from the *same* marketdata source; do not enrich one read path only,
  and add the parity test (FR-7 / AC-12).
