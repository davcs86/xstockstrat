# Product Spec: readiness-caching-poll-discipline

**Created**: 2026-09-04

---

## Problem Statement

The decide-surface read paths recompute far more than necessary (see
`docs/reports/2026-09-04-performance-bottlenecks-audit.md` § Track B): `EvaluateReadiness` has no
server- or client-side cache (recomputed on every mount/refetch, no `staleTime`); empty-universe
Opportunities users re-run the full synchronous compute on **every** 15s poll because their queue
never caches; and warm Opportunities reads fire an unconditional 2-RPC-per-symbol live enrichment
even when nothing is stale. This is steady-state waste that multiplies with active users.

## User Story

As a user watching the Opportunities and Watchlist panes, I want repeated reads and background polls
to serve cached results instead of recomputing from scratch, so that lists appear promptly and the
backend isn't doing the same work on every 15-second tick for every open tab.

## Functional Requirements

FR-1. Watchlist readiness is served from a cache/materialized store analogous to the Opportunities
"lazy compute-on-read + stale-while-revalidate" model, so a repeat `EvaluateReadiness` for an
unchanged `(strategy, symbols, bar epoch)` returns without a full re-fan-out.
FR-2. The readiness client query (`WatchlistReadiness.tsx:193` `useQueries`) sets a `staleTime` so
that remounting the detail pane or a routine refetch within the freshness window does **not** re-issue
the backend fan-out.
FR-3. An empty-universe Opportunities user (a user whose computed queue legitimately yields zero rows)
caches that empty result and does **not** re-run the full synchronous compute on every 15s poll; the
recompute fires only when its inputs actually change or the stale window elapses.
FR-4. Warm Opportunities reads perform live enrichment (`_enrich_opportunities_live`) **conditionally**
— only when the enriched values are stale — rather than unconditionally on every read.
FR-5. Cached/served-stale data is never presented to the user as fresher than it is: freshness is
bounded by an explicit, configurable staleness window, and a stale-while-revalidate serve still
triggers a background refresh.

## Out of Scope

- Parallelizing the fan-out itself and event-loop offload — **feature 176
  (analysis-concurrency-offload)**. (This feature reduces *how often* the fan-out runs; 176 makes each
  run faster. They compose.)
- Quote N+1 batching — **feature 178 (quote-fanout-batching)**.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — Python; owns `EvaluateReadiness`, `ListOpportunities`,
  `_enrich_opportunities_live`, and the opportunities materialized store (migration 011).
- `xstockstrat-ui` — Next.js; owns the readiness `useQueries` client and its cache config.

## Consumer Surface(s)

_Constitution **C-14**._
- [x] **UI** — `xstockstrat-ui` `/insights`: Opportunities and Watchlist panes; the client-side
  `staleTime` change (FR-2) is a UI-owned change. No new page/route/control.
- [ ] **Agent** — no change (`list_opportunities` response shape unchanged; it becomes cheaper).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required (a served-staleness / `computed_at` field on the readiness response
  may be considered in `/sdd-design` for FR-5; if added it is a non-breaking field addition — settle
  there).

## Config Key Changes

- [ ] No new config keys
- Likely a readiness staleness-window key (e.g. `analysis.readiness.stale_after_seconds`) and/or an
  empty-universe cache TTL key. Final list is a `/sdd-design` output; routes through the config owner
  if introduced.

## Database Changes

- [ ] No schema changes
- OR: a readiness materialization may reuse or parallel the existing `analysis.opportunities` store
  (migration 011). Whether readiness needs its own table vs. an in-process/keyed cache is a
  `/sdd-design` decision; if a table is added it is a new numbered migration in `xstockstrat-analysis`
  as a matched `NNN_description.up.sql` + `.down.sql` pair — next free NNN is **022** (dir currently
  tops out at `021_pnl_positions_fees_total`; re-check at `/sdd-spec` in case another feature claims 022
  first).

## Feature Workflow Notes

Branch to create: `feature/readiness-caching-poll-discipline` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — analysis owner + ui owner (`service` category)
- [ ] 2 service owners + platform lead (breaking proto) — N/A
- [ ] DBA review + service owner — only if a readiness materialization table is added (design output)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (fails.md:751-754, feature 110):** verify the remount/refetch cost against the
  app's actual query `staleTime`/cache config before assuming a cost — the systemic fix is the outer
  cache key + `staleTime`, not per-symptom subcomponents.
- [ ] **Known trap (feature 118 screener-data-readiness-polling):** align poll cadence and staleness
  semantics with the existing readiness-polling pattern rather than inventing a divergent one.
- [ ] Cache invalidation key for readiness: what is the correct "bar epoch" that must bust the cache
  when a new daily/intraday bar lands (so a served-stale verdict can't outlive a new bar)?
- [ ] Where should the empty-universe cache live — the existing opportunities store as a sentinel row,
  or an in-process TTL — given analysis is `instance_count:1` today but may scale later?
