# Product Spec: quote-fanout-batching

**Created**: 2026-09-04

---

## Problem Statement

Portfolio read paths issue one `GetLatestQuote` per position sequentially across `ListPositions`,
`GetPortfolio`, `GetPnL`, and `ListPortfolios` (see
`docs/reports/2026-09-04-performance-bottlenecks-audit.md` § Track C, finding 3.4), despite
marketdata already exposing a batch `GetLatestQuotesMulti`. `ListWatchlists` similarly does 1 + N
`listBindings` queries (finding 2.5). And marketdata has no single-flight on cold-symbol live
fallback, so concurrent first-requests for an unbackfilled symbol each fire an independent Alpaca
fetch (finding 3.7) — a thundering herd amplified by the position fan-out.

## User Story

As a user with a non-trivial position book or watchlist, I want the platform to fetch quotes and
bindings in batches instead of one at a time, so that portfolio and watchlist reads don't scale their
latency and their load on marketdata linearly with my item count or with concurrent users.

## Functional Requirements

FR-1. `enrichPositions` (and the sibling call sites in `GetPortfolio`, `GetPnL`, `ListPortfolios`)
resolve quotes via a **single** `GetLatestQuotesMulti` batch call rather than a per-position serial
`GetLatestQuote` loop, producing the same enriched values.
FR-2. `ListWatchlists` resolves all watchlists' symbol bindings in **one** query using a
`WHERE watchlist_id = ANY(...)` (or JOIN) rather than a per-watchlist `listBindings` loop, producing
the same grouped result.
FR-3. marketdata's cold-symbol live fallback coalesces concurrent first-requests for the same
`(symbol, timeframe)` via a single-flight guard, so N concurrent misses trigger exactly one upstream
Alpaca fetch and all N callers receive its result.
FR-4. No behavioral regression: batched results are equivalent to the per-item results for every
existing field (price, P&L inputs, binding `source`/`strategy_id`), including the handling of a symbol
with no available quote (must map to the same "missing" outcome the serial path produced, per the
null-not-zero discipline in prior defects).

## Out of Scope

- Analysis fan-out parallelization / event-loop offload — **feature 171**.
- Caching cadence / staleness policy — **feature 172**.
- Adding a new batch RPC to marketdata — `GetLatestQuotesMulti` already exists (used by marketdata's
  own warm poller); this feature adopts it, it does not define it. (If `/sdd-spec` finds the batch RPC
  is insufficient — e.g. it lacks a field the per-item path returned — that becomes a proto gate and
  the spec must flag it.)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — Go; owns `enrichPositions` and the position/portfolio read handlers, and
  the watchlist repository (`ListWatchlists`/`listBindings`).
- `xstockstrat-marketdata` — Go; owns the quote fallback path and would gain the single-flight guard.

## Consumer Surface(s)

_Constitution **C-14**._
- [x] **UI** — `xstockstrat-ui` `/trader` (positions/portfolio) and `/insights` (watchlists): the
  observable beneficiaries (faster reads). No new page/route/control; response shapes unchanged.
- [ ] **Agent** — `get_positions` / `get_positions_by_account_id` become cheaper; response shape
  unchanged.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — adopts the existing `GetLatestQuotesMulti`. (Contingency: if
  `/sdd-spec` finds the batch RPC omits a field the singular path returned, that flips this to a
  non-breaking field-addition proto gate — flag at spec time.)

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — FR-2 rewrites an existing query shape (`ANY`-array), no new tables/columns.
  The existing `watchlist_symbols` PK `(watchlist_id, symbol)` already serves the batched predicate.

## Feature Workflow Notes

Branch to create: `feature/quote-fanout-batching` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — portfolio owner + marketdata owner (`service` category)
- [ ] 2 service owners + platform lead (breaking proto) — N/A unless the batch-RPC contingency fires
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (null-not-zero, defects 2026-08-16):** a symbol with no quote must resolve to the
  same "missing"/neutral outcome the serial path produced — a batch call that returns a partial map
  must not let an absent key silently become a zero price/P&L.
- [ ] Does `GetLatestQuotesMulti` return every field the singular `GetLatestQuote` did (bid/ask/last,
  timestamp, staleness)? Verify at `/sdd-spec`; if not, decide proto field-addition vs. a supplemental
  call.
- [ ] Single-flight scope for FR-3: per-process (Go `singleflight.Group`) is the obvious fit, but does
  the cold-fallback also need the existing stale-refetch rate-limiter's `(symbol,timeframe)` keying to
  stay consistent?
