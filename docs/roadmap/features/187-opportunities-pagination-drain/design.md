# Design: opportunities-pagination-drain

**Created**: 2026-09-11
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-09-11
**Grounded in**: recon.md

---

## Chosen Approach

### A. Server — page_size stays at 50

`_DEFAULT_OPP_PAGE_SIZE` at `servicer.py:279` stays at `50` (user steer, overriding the original
FR-1 which proposed reducing to 25). No constant change. The existing offset-pagination logic at
`servicer.py:3463-3470` and `PageResponse` construction at `servicer.py:3475-3478` are unchanged.

### B. Server — SQL ORDER BY for server-side symbol grouping

Modify the `read()` query in `repositories/opportunities.py:164-165` to pre-group rows by symbol so
each symbol's opportunities are **contiguous**, with the symbol-group positioned by its
highest-ranked member. This mimics the client-side `symbolGroups` Map pattern at
`page.tsx:197-205` — which iterates in arrival order, so the first occurrence of each symbol defines
the group's position in the ranked list.

```sql
ORDER BY
  MAX(((1 - $3) * o.conviction + $3 * o.signal_axis))
    OVER (PARTITION BY o.symbol) DESC,   -- inter-group: best rank per symbol
  o.symbol ASC,                           -- tiebreak: alphabetical for tied groups
  ((1 - $3) * o.conviction + $3 * o.signal_axis) DESC,  -- intra-group rank
  o.conviction DESC,                      -- intra-group secondary
  o.opportunity_key ASC                   -- deterministic final tiebreak (feature 185 FR-5)
```

The window function `MAX(...) OVER (PARTITION BY o.symbol)` computes each symbol's best composite
score and uses it as the primary sort key. `o.symbol ASC` breaks ties alphabetically when two
symbols share the same best-ranked score. Intra-group ordering preserves the existing rank logic.
`o.opportunity_key ASC` remains the deterministic final tiebreak for offset paging stability
(feature 185 FR-5, `recon.md` line 160-165). No DB index change — the sort runs on an
already-materialized in-memory result set (`recon.md` line 46: "Repo read() — no LIMIT clause").

**Consumer surface:** The server-side grouping is consumed by the UI at
`/insights/opportunities` (opportunities page) and by the agent `list_opportunities` MCP tool.
Both receive pre-grouped pages without additional client-side reordering.

### C. UI — `useInfiniteQuery` + "Load More" button (manual trigger)

Replace `useQuery` in `useOpportunities.ts:16-22` with `useInfiniteQuery` (React Query v5,
`@tanstack/react-query@^5.62.0` per `package.json:38` — first use in this codebase). The hook:

- Fetches page 1 with `{ page: { pageSize: 50, pageToken: '' } }`
- `getNextPageParam` returns `nextPageToken` from the response's `page`, or `undefined` to stop
- Terminates pagination if `computing=true` or `compute_failed=true` (preserves `@AC-6`, `@AC-7`)
- Exposes `fetchNextPage` / `hasNextPage` / `isFetchingNextPage` to the component
- The 15s `refetchInterval` re-fetches all loaded pages (React Query v5 `useInfiniteQuery` default)
- Return shape: `data.pages` is `ListOpportunitiesResult[]`; the component flattens via
  `data.pages.flatMap(p => p.opportunities)`

`opportunities/page.tsx:101` consumes the updated hook. Adds a "Load More" button (disabled when
`!hasNextPage || isFetchingNextPage`) below the `symbolGroups` list. With server-side symbol
grouping (part B), the `symbolGroups` useMemo at `page.tsx:197-205` continues to work identically —
it groups the flattened page array by symbol, and since the server delivers rows pre-grouped, each
Load More batch appends new complete symbol groups at the bottom.

Other call sites (`SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`,
`positions/[symbol]/page.tsx:176`) consume `useOpportunities(0)` for **lookup** only (checking if
a symbol is in the queue). Page 1 of 50 rows is sufficient — no Load More needed. They share the
same React Query cache entry (`['opportunities', minConviction]`).

### D. CopilotRail conversion to hook

Replace the direct `analysisClient.listOpportunities({})` call at `CopilotRail.tsx:68-69` with
`useOpportunities(0)`. Gets page-1 data from the shared cache — no separate RPC, no Load More.
Reuses the `useInvalidatingMutation` invalidation key `['opportunities']` already in the hook
file (`recon.md` line 51).

### E. Agent — pagination pass-through

Add optional `page_size` (default 50) and `page_token` (default `''`) params to the
`list_opportunities` tool at `tools.py:1161`. The tool returns the response as-is, including
`next_page_token` so the MCP caller can page through manually:

```python
async def list_opportunities(ctx, min_conviction=0.0, page_size=50, page_token=''):
    ...
    return {"opportunities": [...], "computing": ..., "compute_failed": ..., "next_page_token": ...}
```

Reuses `common_pb2.PageRequest(page_size=..., page_token=...)` pattern from `client.py:349`
(`list_watchlists`, `recon.md` line 48). The `client.py:802` `list_opportunities` method gains
the same two params and passes them through as a `PageRequest` on the gRPC call.

### F. UI — Remove headline stat grid

Remove the `StatTile` grid at `page.tsx:243-273` ("Actionable now" / "Expiring < 90m" /
"Exit / Trim flags" / "Fresh entries" / "Deployable"). With paginated loading, tiles 1–4 compute
counts over only the loaded pages — they would display "50 of 50 evaluated" on page 1 even when
150+ rows exist behind Load More, misleading the user into thinking the visible set is the full
queue. The "Deployable" tile (buying power from a separate `listPortfolios` query) is
pagination-independent but doesn't justify the card on its own.

Also remove the supporting `useMemo` derivations that compute `expiringSoon`, `exitFlags`, and
`freshEntries` (no other consumer), and the `listPortfolios` query if the buying-power figure
is not displayed elsewhere on this page.

## Rejected Alternatives

- **Auto-drain loop in consumers** — rejected because user steer: "do not auto-drain, leave the
  user to trigger manually". Auto-drain also risks BFF deadline stacking (`@AC-1`: each paginated
  call carries its own 30s deadline; worst-case N×30s = 240s for 200 rows at page_size=25).
- **Reduce page_size to 25** — rejected by user steer: "Increase page size to 50 symbols".
  page_size=50 keeps the default transport chunk identical to today's behavior for existing
  single-page consumers.
- **Client-side-only symbol grouping** — rejected because server-side grouping ensures page
  boundaries respect symbol clusters. A page-1 fetch that splits a symbol's rows across page 1 and
  page 2 would render a partial `SymbolGroupCard` until Load More is triggered.

## Open Risks

- [ ] `useInfiniteQuery` is the first use of this React Query primitive in the codebase — no
  existing pattern to reuse. Risk is low (it's a first-party React Query API, well-documented),
  but the implementation step should verify the `refetchInterval` behavior with `useInfiniteQuery`
  (it refetches all loaded pages, not just the first).

## Constitution Rules Touched

- `C-08` (reuse existing patterns) — honored by: SQL ORDER BY extends the existing sort at
  `opportunities.py:164-165` (window function addition, not replacement); agent pagination
  reuses `common_pb2.PageRequest` from `client.py:349`.
- `C-12` (test-data inventory) — honored by: e2e fixture at `e2e/fixtures/opportunities.ts:54`
  extended for pagination testing.
- `C-14` (consumer surface) — honored by: changes reach both the UI
  (`/insights/opportunities`) and the agent (`list_opportunities` tool).
- `C-16` (business-rule regression) — honored by: all 22 existing `@AC-*` guarantees PRESERVE.
- `F-04` (path:line evidence) — honored by: all citations grounded in recon.md.
- `F-06` (no new pool/edge) — honored by: reuses existing gRPC connections, no new DB pool.

## Business Rules Touched (C-16)

All 22 existing `@AC-*` guarantees are **PRESERVE** — no EXTEND or CHANGE. The ORDER BY change adds
sort keys but does not alter which rows are returned or their conviction/signal_axis values.

- PRESERVE `@AC-6 @feature-185` "Cold read returns empty page + computing signal" — not regressed:
  `useInfiniteQuery` `getNextPageParam` checks `computing` and returns `undefined` to stop paging.
- PRESERVE `@AC-7 @feature-185` "Terminal compute-failed" — not regressed: same `getNextPageParam`
  check propagates `compute_failed` to the caller.
- PRESERVE `@AC-8 @feature-185` "Surgical self-heal on read" — not regressed: per-row recovery is
  per-read in the handler, independent of which page the row lands on.
- PRESERVE `@AC-9 @feature-183` "Memo TTL >= poll interval" — not regressed: the 15s poll is
  still a single cycle; each page fetch within one Load More is a separate RPC within the same
  memo window.
- PRESERVE `@AC-1 @feature-183` "BFF 30s gRPC deadline" — not regressed: each paginated call
  carries its own deadline; manual trigger means no unbounded client-side wait.
- PRESERVE `@AC-14 @feature-095` "Live quote enrichment does not alter ranking" — not regressed:
  the window function operates on the same pre-pagination score; enrichment is post-read.
- PRESERVE `@AC-1 @feature-176` "Concurrent compute yields identical set + rank order" — not
  regressed: the window function is deterministic over the same input rows.
