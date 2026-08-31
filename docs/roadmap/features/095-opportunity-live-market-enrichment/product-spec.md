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
FR-5. **Risk:reward + suggested share sizing** on the Signal-detail order ticket, derived from
  entry/stop/target and the broker's buying power. Presentation only — **no change to order
  execution** (FR-20 of 083 stays: same `usePlaceOrder` path, environment-fixed PAPER/LIVE).
FR-6. **No-fabrication rule (inherited from 083).** Every new field degrades gracefully — a card,
  header stat, chart overlay, or ticket row is **omitted / em-dashed** when its data is absent, never
  synthesized. A symbol not in the ranked queue keeps the current symbol+price-only header.
FR-7. **Cross-surface parity (C-10(b)).** The live price/change shown on the queue card and on the
  Signal-detail header must come from the one marketdata source via the same new field, with a parity
  test asserting the two surfaces agree (mirrors 083's AC-8 valuation parity between Portfolio and
  Exposure).

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
- `xstockstrat-marketdata` — serves the latest quote/trade + recent bars the enrichment reads (confirm
  an existing "latest quote" read path vs. a new additive RPC at design time).
- `xstockstrat-ui` — consume the new fields on `insights/opportunities` cards, the
  `insights/market/[symbol]` header + chart overlays + order ticket. Keep the no-fabrication rule.
- `xstockstrat-portfolio` — _FYI_: buying power for suggested sizing (already read client-side on the
  Opportunities page via `insightsPortfolioClient.listPortfolios`; sizing may reuse it rather than a
  new server read — design decision).
- `xstockstrat-indicators` — _FYI_: per-condition indicator values are already produced by the analysis
  traced evaluator; no new indicators sandbox path expected.
- `packages/proto` — additive `Opportunity` / `SymbolReadiness` (and possibly a small sparkline-point
  message) field additions.

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
- **Additive only** (no breaking change), pending design confirmation of exact field numbers:
  - `analysis.Opportunity` — append fields **after the current max field number**: e.g. `live_price`,
    `change_pct`, `target_price`, `stop_price`, `risk_reward`, `suggested_qty`, and a repeated
    sparkline series (a `repeated double` or a dedicated `repeated SparklinePoint`).
  - `analysis.SymbolReadiness` — append any per-symbol live-price/sparkline field needed by the
    Signal-detail header (or reuse the `Opportunity` fields if the header reads the queue row).
  - Any new enum must carry `<NAME>_UNSPECIFIED = 0` (C-04 / C-10(a)). **If a new enum is introduced,
    every exhaustive TS `Record<Enum,…>` map in `xstockstrat-ui` (e.g. `src/lib/opportunityShared.tsx`)
    must gain its entry in the same PR** (C-10(a/d)) or `tsc`/`pnpm build` fails.
  - Confirm whether marketdata needs a new "latest quote" RPC or an existing read suffices (design).
- Regenerate stubs with `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` must pass (additive).

## Config Key Changes

- [ ] No new config keys
- **Possible** (design to confirm): a sparkline bar-count / lookback default,
  `analysis.opportunity.sparkline_bars`. If added it must be **env-overridable** (F-07 — no bare
  literal), follow the `<service>.<category>.<key>` naming, and be registered in the Per-Feature
  Registered Keys log in `docs/patterns/config-governance.md`.

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

- [ ] **Target/stop source.** Where do an opportunity's target and stop prices come from — the
  strategy definition, the external signal payload, or a derived ATR/stop rule? (Drives FR-4/FR-5 and
  whether marketdata/indicators are involved.)
- [ ] **Latest-quote read.** Does marketdata already expose a latest quote/trade read, or is a new
  additive RPC needed? **Known trap (fails.md 080/082):** an "edge already exists / RPC already served"
  claim is an *absence claim* — grep-verify it end-to-end (analysis→marketdata call site + BFF route +
  browser client + e2e mock), not from the advertised proto alone, at the design gate.
- [ ] **Per-condition chips on the queue card.** `ConditionEval` leaves exist on `EvaluateReadiness`
  (strategy-scoped), but the `Opportunity` queue row carries only `passing/total`. Does the card show
  the blocking-condition chip via a per-opportunity readiness fold-in, or only on Signal detail?
- [ ] **Sizing location.** Compute R:R + suggested size client-side (entry/stop/target already on the
  row + buying power already fetched), or server-side on `Opportunity`? Prefer the smallest change.
- [ ] **Known trap — sparkline gaps as `null`, not `NaN` (fails.md 067 / P-03).** If sparkline bars
  pass through a protobuf `Struct`, `MessageToDict` **rejects** `NaN`/`Inf`; model warm-up/absent
  points as `null` (Python `None`), never `NaN`, so the payload round-trips.
- [ ] **Known trap — cross-surface price parity (fails.md 056 / C-10(b)).** Ensure the queue card and
  the Signal-detail header read the *same* new field from the *same* marketdata source; do not enrich
  one read path only, and add the parity test (FR-7 / AC-12).
- [ ] **Known trap — no look-ahead (analysis owner focus).** Folding a live quote into the Decide
  surface must not leak future data into conviction/readiness ranking; prove the hot path stays frozen
  (AC-14).
