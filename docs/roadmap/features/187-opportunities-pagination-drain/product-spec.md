# Product Spec: opportunities-pagination-drain

**Created**: 2026-09-11

---

## Problem Statement

Users with 150+ watchlist symbols and held positions see at most ~50 opportunities in the queue,
even though the compute pipeline materializes all of them. The ListOpportunities RPC defaults to
`page_size=50` and neither the UI hook nor the agent tool consumes `next_page_token`, silently
truncating the queue at transport time. Curated symbols that rank below position 50 are invisible.

## User Story

As a trader with a large watchlist, I want the Opportunities queue to surface ALL materialized rows
regardless of count, so that every curated symbol appears in my queue and I don't miss trading
opportunities.

## Functional Requirements

FR-1. The server-side default page size for ListOpportunities stays at 50
(`_DEFAULT_OPP_PAGE_SIZE = 50`) — no reduction. _(User steer: "Increase page size to 50 symbols.")_

FR-2. The UI `useOpportunities` hook uses `useInfiniteQuery` (React Query v5) to expose
`fetchNextPage`/`hasNextPage`/`isFetchingNextPage`. The opportunities page renders a "Load More"
button that the user triggers manually — no auto-drain loop. Other call sites
(`SignalReadiness.tsx`, `WatchlistDetail.tsx`, `positions/[symbol]/page.tsx`) consume page 1 only
(lookup use case). _(User steer: "do not auto-drain, leave the user to trigger manually.")_

FR-3. The agent `list_opportunities` tool exposes optional `page_size` and `page_token` parameters
so the MCP caller can page through manually. The response includes `next_page_token`. No auto-drain.
_(User steer: same.)_

FR-4. Ranking order is preserved across pages — each page maintains the server's
`conviction × signal_axis` sort with deterministic tiebreak (`opportunity_key`).

FR-5. The 15-second poll interval in the UI refetches all loaded pages (React Query v5
`useInfiniteQuery` default behavior), not just page 1.

FR-6. The server SQL ORDER BY pre-groups rows by symbol so each symbol's opportunities are
contiguous, with the symbol-group positioned by its highest-ranked member. This mimics the
client-side `symbolGroups` Map pattern at `page.tsx:197-205`. Page boundaries respect symbol
clusters. _(User steer: "Server-side grouping and sorting, symbol alphabetical for ties.")_

FR-7. `CopilotRail.tsx` replaces its direct `analysisClient.listOpportunities({})` call with
`useOpportunities(0)`, sharing the React Query cache — no separate RPC.

FR-8. Remove the headline stat grid (`StatTile` row: "Actionable now" / "Expiring < 90m" /
"Exit / Trim flags" / "Fresh entries" / "Deployable") from the opportunities page. With paginated
loading, the counts in tiles 1–4 reflect only loaded pages and mislead the user into thinking
they see the full queue. The "Deployable" tile (buying power from `listPortfolios`) is
pagination-independent but doesn't justify the card on its own. _(User steer: "would this change
make the headline obsolete … include removal in scope.")_

## Out of Scope

- Changing the materialization pipeline (the DB read already returns all rows; only the ORDER BY changes).
- Adding infinite-scroll or virtual-list UI rendering — this feature adds a manual "Load More" button only.
- Changing proto pagination contracts (`PageRequest`/`PageResponse` in `common.proto`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — add server-side SQL symbol grouping (ORDER BY window function)
- `xstockstrat-ui` — convert `useOpportunities` to `useInfiniteQuery` + "Load More" button; convert `CopilotRail` to use hook
- `xstockstrat-agent` — add `page_size`/`page_token` pass-through params to `list_opportunities` tool and client

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` (Opportunities page at `src/app/insights/opportunities/page.tsx`, plus `SignalReadiness`, `WatchlistDetail`, `CopilotRail` components that call `useOpportunities`)
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `list_opportunities` (changed response now returns all pages instead of first page only)
- [ ] **None** — internal/platform-only, no end-user surface.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/opportunities-pagination-drain` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Known trap (fails.md:662, 805): truncation-before-diagnostic — not applicable here because
  the DB read returns all rows and pagination is purely transport-layer slicing; ranking and
  conviction/signal_axis ordering are computed before pagination. No subset-relative diagnostics
  are affected.
