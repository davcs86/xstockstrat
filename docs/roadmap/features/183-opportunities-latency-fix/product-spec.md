# Product Spec: opportunities-latency-fix

**Created**: 2026-09-08

---

## Problem Statement

`ListOpportunities` calls from the Insights BFF to `xstockstrat-analysis` take up to 2.9 minutes on the cold-compute path, exceeding the DigitalOcean App Platform proxy timeout (~120s) and causing `ECONNRESET` errors in the browser. The root cause is serialized per-symbol downstream RPC fan-out (bars fetch + live enrichment) through a process-wide `_bars_fetch_sem=2` semaphore, compounded by sequential Phase 0 drains, a memo TTL shorter than the browser poll interval, and no BFF-side gRPC deadline. The live loop's 422 (strategy,symbol) pairs further contend for the same semaphore.

## User Story

As a trader using the Insights Decide surface, I want the opportunities queue to load within seconds (even on a cold cache), so that I can act on time-sensitive entry/exit signals without encountering timeout errors.

## Functional Requirements

FR-1. The BFF `listOpportunities` call must enforce a gRPC deadline (≤30s) so the call fails fast rather than hanging until the DO proxy kills it.

FR-2. A new `BatchGetBars` RPC in `MarketDataService` must accept multiple symbols and return per-symbol bar series in a single round-trip, preserving the existing `GetBars` pagination contract per symbol (timeframe, range, page).

FR-3. A new `BatchGetLatestPrice` RPC in `MarketDataService` must accept multiple symbols and return per-symbol `LatestPrice` results in a single round-trip, preserving the existing `LatestPrice` message shape (explicit-presence `last_price`/`prev_close`, AC-11 omit-not-fabricate).

FR-4. `_compute_opportunities` Phase 0 must parallelize the 4 independent drain calls (`_drain_active_signals`, `_drain_held_symbols`, `_drain_watchlist_bindings`, `_drain_source_weights`) via `asyncio.gather`.

FR-5. `_compute_opportunities` Phase 1 must use `BatchGetBars` instead of per-symbol `GetBars` calls under the `_bars_fetch_sem`, collapsing ~100 serialized RPCs into a bounded number of batch calls.

FR-6. `_enrich_opportunities_live` must use `BatchGetLatestPrice` and `BatchGetBars` instead of per-symbol calls, collapsing 2×N serialized semaphore acquisitions into 2 batch calls.

FR-7. The default `analysis.opportunity.live_enrich_ttl_seconds` must be raised from 10 to at least 15 (matching or exceeding the browser's 15s `refetchInterval`) so a warm re-read does not re-fetch live data that hasn't changed since the last poll.

## Out of Scope

- Restructuring the live loop's scheduling or changing `max_strategies_per_cycle` — P5 contention is addressed indirectly by reducing sem hold time via batch RPCs.
- Adding batch variants for other marketdata RPCs (GetLatestQuote, GetFundamentals, etc.).
- Moving the cold-compute path to a background worker (stale-while-revalidate already handles the hot path; this feature reduces cold-path duration).
- Adding server-side streaming for bars — batch unary is sufficient for the ~100-symbol universe.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` (marketdata/v1) — new `BatchGetBars` and `BatchGetLatestPrice` RPC definitions + messages
- `xstockstrat-marketdata` — implement the two new batch RPC handlers (Go)
- `xstockstrat-analysis` — consume batch RPCs, parallelize Phase 0 drains, raise TTL default (Python)
- `xstockstrat-ui` — add gRPC deadline to the BFF analysis transport or per-call (Next.js/Node)

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` (the Decide surface opportunities queue — no new page/route, but the existing ListOpportunities poll becomes reliably fast and no longer times out)
- [ ] **Agent** — no agent tool changes
- [ ] **None**

## Proto Contract Changes

- New RPC `BatchGetBars` in `MarketDataService`
- New RPC `BatchGetLatestPrice` in `MarketDataService`
- New messages: `BatchGetBarsRequest`, `BatchGetBarsResponse`, `SymbolBars`, `BatchGetLatestPriceRequest`, `BatchGetLatestPriceResponse`

All additive (no field removal, no type change, no renumbering). Non-breaking.

## Config Key Changes

- `analysis.opportunity.live_enrich_ttl_seconds` — existing key, default raised from `10` to `15` (code-default change only, no migration needed; operator can override via `SetConfig`)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/opportunities-latency-fix` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change — additive RPCs only)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Resolved (design):** Known trap (ledger 141) — batch handler uses `WHERE symbol = ANY($1)` single-query pattern (confirmed in design.md § Step 2/3; template at `GetLatestQuotesBatch` repo:311-320). No per-symbol goroutine fan-out.
