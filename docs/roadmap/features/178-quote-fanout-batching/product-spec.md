# Product Spec: quote-fanout-batching

**Created**: 2026-09-04

---

## Problem Statement

Portfolio read paths issue one `GetLatestQuote` per position sequentially across `ListPositions`,
`GetPortfolio`, `GetPnL`, and `ListPortfolios` (see
`docs/reports/2026-09-04-performance-bottlenecks-audit.md` § Track C, finding 3.4). marketdata
batches quotes **internally** (the `MultiSymbolSource` / `GetLatestQuotesMulti` Alpaca-REST helper
used by its own warm poller) but exposes **no batch-quote gRPC RPC** — its proto surface
(`packages/proto/marketdata/v1/marketdata.proto`) offers only the singular `GetLatestQuote`. So
`xstockstrat-portfolio` cannot batch quotes cross-service today; the fix requires **adding an
additive batch-quote RPC** to marketdata. `ListWatchlists` similarly does 1 + N `listBindings`
queries (finding 2.5). And marketdata has no single-flight on cold-symbol live fallback, so
concurrent first-requests for an unbackfilled symbol each fire an independent Alpaca fetch (finding
3.7) — a thundering herd amplified by the position fan-out.

## User Story

As a user with a non-trivial position book or watchlist, I want the platform to fetch quotes and
bindings in batches instead of one at a time, so that portfolio and watchlist reads don't scale their
latency and their load on marketdata linearly with my item count or with concurrent users.

## Functional Requirements

FR-1. A **new additive batch-quote gRPC RPC** is added to marketdata (working name
`GetLatestQuotes`, taking `repeated symbol` and returning a per-symbol quote map), implemented by
wrapping the existing internal `MultiSymbolSource`/`GetLatestQuotesMulti` Alpaca-REST helper.
`enrichPositions` (and the sibling call sites in `GetPortfolio`, `GetPnL`, `ListPortfolios`) then
resolve quotes via a **single** call to that RPC rather than a per-position serial `GetLatestQuote`
loop, producing the same enriched values. The RPC returns the same per-symbol fields the singular
`GetLatestQuote` does (final field set settled in `/sdd-design` against the proto).
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

- Analysis fan-out parallelization / event-loop offload — **feature 176**.
- Caching cadence / staleness policy — **feature 177**.
- Any change to the **internal** `MultiSymbolSource`/`GetLatestQuotesMulti` Alpaca-REST helper beyond
  wrapping it in the new RPC — the batch fetch logic already exists internally; this feature exposes
  it over gRPC, it does not re-implement the fetch.
- Broadening the new RPC beyond a latest-quote batch (e.g. a batch bars RPC) — out of scope.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-portfolio` — Go; owns `enrichPositions` and the position/portfolio read handlers, and
  the watchlist repository (`ListWatchlists`/`listBindings`).
- `xstockstrat-marketdata` — Go; gains the new `GetLatestQuotes` batch RPC (wrapping the existing
  internal `MultiSymbolSource` helper) and the single-flight guard on the cold-symbol fallback.

## Consumer Surface(s)

_Constitution **C-14**._
- [x] **UI** — `xstockstrat-ui` `/trader` (positions/portfolio) and `/insights` (watchlists): the
  observable beneficiaries (faster reads). No new page/route/control; response shapes unchanged.
- [ ] **Agent** — `get_positions` / `get_positions_by_account_id` become cheaper; response shape
  unchanged.
- [ ] **None**

## Proto Contract Changes

- [x] **Proto change required — additive, non-breaking**: a new `GetLatestQuotes` RPC (+ its
  request/response messages) on `marketdata/v1/marketdata.proto`. Adding an RPC/message is additive,
  so `buf breaking` passes; still requires `buf lint`, `./scripts/buf-gen.sh` regeneration, and the
  proto approval gate (Proto Reviewer + marketdata service owner, per `docs/runbooks/approval-flow.md`).
  New message field numbers start at 1; the RPC reuses existing quote field shapes where possible.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — FR-2 rewrites an existing query shape (`ANY`-array), no new tables/columns.
  The existing `watchlist_symbols` PK `(watchlist_id, symbol)` already serves the batched predicate.

## Feature Workflow Notes

Branch to create: `feature/quote-fanout-batching` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] Proto Reviewer + affected service owner(s) — **additive** (non-breaking) new `GetLatestQuotes`
  RPC on marketdata (`proto` step category). Not a breaking change, so the 2-owner+platform-lead
  breaking-proto gate does not apply.
- [x] 1 service owner approval — portfolio owner + marketdata owner (`service` category)
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (null-not-zero, defects 2026-08-16):** a symbol with no quote must resolve to the
  same "missing"/neutral outcome the serial path produced — a batch call that returns a partial map
  must not let an absent key silently become a zero price/P&L. (Covered by FR-4/AC-4; `/sdd-design`
  confirms the partial-map contract of the new RPC.)
- [ ] Exact field set + message shape of the new `GetLatestQuotes` RPC (request `repeated symbol`;
  response map vs. `repeated` with symbol key; which of bid/ask/last/timestamp/staleness) — settle in
  `/sdd-design` against `marketdata.proto`'s existing `GetLatestQuote` response.
- [ ] Single-flight scope for FR-3: per-process (Go `singleflight.Group`) is the obvious fit, but does
  the cold-fallback also need the existing stale-refetch rate-limiter's `(symbol,timeframe)` keying to
  stay consistent?
