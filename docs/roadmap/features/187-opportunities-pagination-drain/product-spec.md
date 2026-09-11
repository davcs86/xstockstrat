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

FR-1. The server-side default page size for ListOpportunities is reduced from 50 to 25
(`_DEFAULT_OPP_PAGE_SIZE`).

FR-2. The UI `useOpportunities` hook auto-drains all pages by looping on `next_page_token` until
exhausted, aggregating every page's opportunities into a single result array.

FR-3. The agent `list_opportunities` tool auto-drains all pages via the same loop pattern, so MCP
consumers also see the full queue.

FR-4. Ranking order is preserved across pages — the aggregated result maintains the server's
`conviction × signal_axis` sort.

FR-5. The 15-second poll interval in the UI refetches the full drained set, not just page 1.

## Out of Scope

- Changing the SQL query or materialization pipeline (the DB read already returns all rows).
- Adding infinite-scroll or virtual-list UI rendering — this feature is transport-layer only.
- Changing proto pagination contracts (`PageRequest`/`PageResponse` in `common.proto`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — reduce `_DEFAULT_OPP_PAGE_SIZE` from 50 to 25
- `xstockstrat-ui` — implement auto-drain pagination in `useOpportunities` hook
- `xstockstrat-agent` — implement auto-drain pagination in `client.py:list_opportunities`

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
