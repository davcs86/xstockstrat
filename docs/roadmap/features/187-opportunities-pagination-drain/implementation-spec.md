# Implementation Spec: opportunities-pagination-drain

**Status**: `in-progress`
**Created**: 2026-09-11
**Feature**: `docs/roadmap/features/187-opportunities-pagination-drain/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/opportunities-pagination-drain`

---

## Execution Summary

The implementation proceeds server → UI → agent, with tests paired after each service step.
Step 1 adds the server-side SQL symbol-grouping ORDER BY (design part B) to `xstockstrat-analysis`;
Step 2 tests it. Step 3 converts the UI `useOpportunities` hook to `useInfiniteQuery` with a "Load
More" button, converts CopilotRail to use the hook, and removes the headline stat grid (design
parts C, D, F); Step 4 is the E2E test. Step 5 adds agent pagination pass-through params (design
part E); Step 6 tests it. Steps 7-8 are the e2e fixture extension and the integration-level
opportunities e2e. Step 9 is a docs step updating `mcp-tools.md` for the new agent params. Step 10
is a final cross-service lint/verify step.

Design part A (page_size stays at 50) requires **no code change** — `_DEFAULT_OPP_PAGE_SIZE = 50` at
`servicer.py:279` is already at the design's target value.

Consumer surfaces (C-14): **UI** (`/insights` — opportunities page, plus lookup call sites
`SignalReadiness`, `WatchlistDetail`, `positions/[symbol]/page.tsx`, `CopilotRail`) is covered by
Steps 3–4. **Agent** (`list_opportunities` tool) is covered by Steps 5–6.

## Scenario Coverage

- `@AC-1` (server default page size 50) → Step 2
- `@AC-2` (UI Load More manual progressive retrieval) → Step 4
- `@AC-3` (UI poll refetches all loaded pages) → Step 4
- `@AC-4` (agent tool pagination params) → Step 6
- `@AC-5` (small queue single page, no Load More) → Step 4
- `@AC-6` (server-side symbol grouping contiguous) → Step 2
- `@AC-7` (CopilotRail shared hook) → Step 4
- `@AC-8` (headline stat grid removed) → Step 4

## Step Dependencies

- Step 2 requires Step 1: tests assert the new ORDER BY behavior
- Step 3 requires Step 1: UI receives server-side grouped pages (symbol clusters not split)
- Step 4 requires Step 3: E2E tests the new hook + Load More + stat grid removal
- Step 5 has no dependency on Steps 1–4: agent pagination is independent of server sort order
- Step 6 requires Step 5: tests assert the new tool params
- Step 7 requires Steps 3 and 5: fixture extension supports both UI and agent pagination tests
- Step 8 requires Steps 3 and 7: integration E2E uses the extended fixtures
- Step 9 requires Step 5: docs update for the agent tool params
- Step 10 requires all prior steps: cross-service verification

---

### Step 1 — service: Server-side SQL symbol grouping ORDER BY

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "ORDER BY" services/xstockstrat-analysis/app/repositories/opportunities.py` → lines 164-165
- Existing ORDER BY: `ORDER BY ((1 - $3) * o.conviction + $3 * o.signal_axis) DESC, o.conviction DESC, o.opportunity_key ASC`
- The query at `repositories/opportunities.py:120-173` has no LIMIT — pagination is purely transport-layer slicing at `servicer.py:3463-3470`
- The window function runs on the already-materialized in-memory result set (recon.md line 46)
- The `o.opportunity_key ASC` tiebreak (feature 185 FR-5) must be preserved for paging stability

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Replace the ORDER BY clause at `repositories/opportunities.py:164-165` with the window-function-based symbol grouping from design.md part B:

```sql
ORDER BY
  MAX(((1 - $3) * o.conviction + $3 * o.signal_axis))
    OVER (PARTITION BY o.symbol) DESC,
  o.symbol ASC,
  ((1 - $3) * o.conviction + $3 * o.signal_axis) DESC,
  o.conviction DESC,
  o.opportunity_key ASC
```

This adds two new sort keys before the existing intra-group sort:
1. `MAX(...) OVER (PARTITION BY o.symbol) DESC` — inter-group: positions each symbol group by its highest-ranked member
2. `o.symbol ASC` — tiebreak: alphabetical when two symbols share the same best-ranked score

The existing intra-group keys (`composite DESC`, `conviction DESC`, `opportunity_key ASC`) remain unchanged. No index change needed — the sort runs on an already-materialized in-memory result set.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "OVER (PARTITION BY o.symbol)" app/repositories/opportunities.py
# Confirm the window function is present at the expected location
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 2 — test: Server-side symbol grouping ORDER BY + default page size

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Existing pagination test at `tests/test_analysis_servicer.py:5391` (`test_paging_stable_across_tied_unavailable_rows`) — extends the `TestListOpportunitiesMaterialized` class at line 4382
- `_DEFAULT_OPP_PAGE_SIZE = 50` at `servicer.py:279` (unchanged, confirms AC-1)
- The test helper `_materialized_svc` and `_unavailable_served_row` fixtures are reused from the existing test
- Single consumer of these test fixtures within this test file — inline is compliant (C-13)

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6`

**Instructions**:
Add two tests to the `TestListOpportunitiesMaterialized` class in `test_analysis_servicer.py`:

1. **`test_symbol_grouping_contiguous_across_pages`** — AC-6: create 6 opportunities across 3 symbols (e.g. AAPL×2 at conviction 0.9/0.8, MSFT×2 at conviction 0.7/0.6, TSLA×2 at conviction 0.5/0.4). Fetch page 1 with `page_size=4`. Assert: (a) each symbol's rows are contiguous within the page, (b) symbol groups are ordered by their highest-ranked member descending, (c) no symbol is split across the page boundary (all 4 rows in page 1 come from the 2 highest-ranked symbols), (d) tied groups are ordered alphabetically.

2. **`test_default_page_size_is_50`** — AC-1: create >50 opportunities (e.g. 55 distinct symbols), call `ListOpportunities` with no `page_size`. Assert the response contains exactly 50 opportunities and `next_page_token` is non-empty.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -k "test_symbol_grouping_contiguous_across_pages or test_default_page_size_is_50" -v
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 3 — service: UI useInfiniteQuery + Load More + CopilotRail hook + stat grid removal

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `useOpportunities` hook at `src/hooks/useOpportunities.ts:16-22` uses `useQuery` with `queryKey: ['opportunities', minConviction]` and `refetchInterval: 15_000`
- `useInfiniteQuery` is available from `@tanstack/react-query@^5.62.0` (`package.json:38`) — first use in this codebase (design.md open risk)
- Opportunities page at `src/app/insights/opportunities/page.tsx:101` destructures `{ data, isLoading, error }` from `useOpportunities(0)`
- StatTile grid at `page.tsx:243-273` — the 5-tile row to remove (FR-8)
- `expiringSoon` derivation at `page.tsx:176-179`, `exitFlags` at `page.tsx:180`, `freshEntries` at `page.tsx:181`, `tickers` at `page.tsx:182-186` — supporting useMemo derivations consumed only by the stat grid
- `deployable` buying-power query at `page.tsx:132-140` — consumed only by the "Deployable" tile
- CopilotRail direct call at `CopilotRail.tsx:68-69`: `analysisClient.listOpportunities({})` — replace with `useOpportunities(0)`
- Other call sites using `useOpportunities(0)` for lookup: `SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`, `positions/[symbol]/page.tsx:176` — page 1 of 50 is sufficient, no Load More needed; they share the same React Query cache entry
- `StatTile` import at `page.tsx:40` — remove if only consumer
- `insightsPortfolioClient` import at `page.tsx:35` — remove if `deployable` query was the only consumer on this page
- `symbolGroups` useMemo at `page.tsx:197-205` continues to work with the flattened `data.pages.flatMap(p => p.opportunities)` array since server delivers rows pre-grouped

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

**A. Convert `useOpportunities` hook (`useOpportunities.ts`)**:

1. Import `useInfiniteQuery` from `@tanstack/react-query` (alongside the existing `useQuery` which other hooks in this file still use).
2. Replace the `useQuery` in `useOpportunities` with `useInfiniteQuery`:
   - `queryKey: ['opportunities', minConviction]` — unchanged (cache key stays the same for shared consumers)
   - `queryFn: ({ pageParam }) => analysisClient.listOpportunities({ minConviction, page: { pageSize: 50, pageToken: pageParam ?? '' } })`
   - `initialPageParam: ''`
   - `getNextPageParam: (lastPage) =>` return `lastPage.page?.nextPageToken || undefined` — stop if empty token, or if `lastPage.computing` or `lastPage.computeFailed` is true (preserves AC-6/AC-7 of feature 185)
   - `refetchInterval: 15_000` — React Query v5 `useInfiniteQuery` refetches all loaded pages by default (FR-5)
3. The return type changes from `UseQueryResult` to `UseInfiniteQueryResult`. The hook now exposes `data.pages`, `fetchNextPage`, `hasNextPage`, `isFetchingNextPage` in addition to `isLoading`, `error`.
4. Export a convenience accessor for the flattened array and the response-level signals:
   ```typescript
   // In the component consuming useOpportunities, flatten via:
   // data?.pages.flatMap(p => p.opportunities) ?? []
   // computing: data?.pages[0]?.computing ?? false
   // computeFailed: data?.pages[0]?.computeFailed ?? false
   ```
   Keep the existing `ListOpportunitiesResult` type alias for backward compatibility; update it if the return shape changed.

**B. Update opportunities page (`page.tsx`)**:

1. Destructure `{ data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage }` from `useOpportunities(0)`.
2. Replace `data?.opportunities ?? []` with `data?.pages.flatMap(p => p.opportunities) ?? []` for the `opportunities` useMemo.
3. For the `computing` and `computeFailed` signals used elsewhere on the page, read from `data?.pages[0]?.computing` and `data?.pages[0]?.computeFailed`.
4. **Remove the stat grid** (`page.tsx:243-273`): delete the entire `<div className="grid grid-cols-2 ...">` block containing the 5 StatTile instances.
5. **Remove supporting derivations** consumed only by the stat grid: `expiringSoon` (`page.tsx:176-179`), `exitFlags` (`page.tsx:180`), `freshEntries` (`page.tsx:181`), `tickers` helper (`page.tsx:182-186`), `deployable` buying-power query (`page.tsx:132-140`).
6. Remove the `StatTile` import (`page.tsx:40`) if no other consumer remains on this page. Remove the `insightsPortfolioClient` import (`page.tsx:35`) if the `deployable` query was its only use on this page.
7. **Add "Load More" button** below the `symbolGroups` list (after the `<div className="space-y-3">` block that renders the symbol group cards): a `<Button>` that calls `fetchNextPage()`, disabled when `!hasNextPage || isFetchingNextPage`, with appropriate loading text.

**C. Convert CopilotRail (`CopilotRail.tsx`)**:

1. Replace the direct `analysisClient.listOpportunities({})` call at line 68-69 with the `useOpportunities(0)` hook.
2. Adapt the data consumption: the hook returns `data?.pages.flatMap(p => p.opportunities) ?? []` for page 1 data (CopilotRail only needs page 1 — no Load More). The CopilotRail shares the React Query cache with the opportunities page via the same `['opportunities', 0]` query key.
3. Remove the `analysisClient` import from CopilotRail if it was the only consumer.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && grep -n "useInfiniteQuery" src/hooks/useOpportunities.ts
# Confirm useInfiniteQuery is present
cd services/xstockstrat-ui && grep -n "StatTile" src/app/insights/opportunities/page.tsx
# Confirm StatTile references are gone
cd services/xstockstrat-ui && grep -n "analysisClient" src/components/copilot/CopilotRail.tsx
# Confirm direct analysisClient call is gone
cd services/xstockstrat-ui && grep -n "useOpportunities" src/components/copilot/CopilotRail.tsx
# Confirm hook is used instead
```

---

### Step 4 — test: UI Load More + stat grid removal + CopilotRail E2E

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing opportunities e2e spec at `e2e/insights/opportunities.spec.ts`
- Mock backend at `e2e/mock-backend.ts` — the `ListOpportunities` handler returns the fixture array
- Fixture at `e2e/fixtures/opportunities.ts:54` — 10 rows (7 unique symbols: AAPL, MSFT, TSLA, NVDA, AMD, GME, PLTR, AMZN×2, CAPR×2)
- Test data reuses existing `OPPORTUNITIES` fixture (C-12); pagination extension via mock response splitting, not new fixture rows

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-5, AC-7, AC-8`

**Instructions**:

1. **Mock backend pagination**: modify the `ListOpportunities` mock handler in `mock-backend.ts` to respect the `page.pageSize` and `page.pageToken` fields from the request. Slice the `OPPORTUNITIES` array by the requested offset/size and return `page.nextPageToken` when more rows remain. Default page_size to 50 (matching server).

2. **AC-2 test** — "Load More progressive retrieval": set the mock page_size to a small value (e.g. 5) via a test-specific mock override, so the 10-row fixture requires 2 pages. Assert: (a) initially only 5 opportunity cards render, (b) a "Load More" button is visible, (c) clicking it loads the remaining rows, (d) all 10 rows are present after Load More.

3. **AC-5 test** — "Small queue, no Load More": with the default page_size of 50 and 10 fixture rows, assert: (a) all 10 rows render, (b) no "Load More" button is visible.

4. **AC-8 test** — "Headline stat grid removed": assert the page does NOT contain elements with text "Actionable now", "Expiring < 90m", "Exit / trim flags", "Fresh entries", or "Deployable".

5. **AC-7 test** — "CopilotRail shared hook": enable the copilot rail (via the ChromeContext toggle) and assert that the CopilotRail renders opportunity data matching the hook's page-1 output, with no separate `ListOpportunities` RPC call (verify via mock call count or network request count).

6. **AC-3 coverage** — "Poll refetches all loaded pages": after Load More, wait for the 15s refetch interval (or use `page.clock` to advance time) and assert the data refreshes without losing the second page.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "opportunities"
```

---

### Step 5 — service: Agent pagination pass-through params

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `list_opportunities` client at `client.py:802` — currently passes no `page` param
- `list_opportunities` tool at `tools.py:1161` — currently has only `min_conviction` param
- Existing pagination pass-through pattern at `client.py:349` (`list_watchlists`): uses `common_pb2.PageRequest(page_size=limit, page_token=page_token)` and returns `"next_page_token": resp.page.next_page_token`
- Proto imports are lazy (`from gen.analysis.v1 import ...` inside function body) — maintain this pattern
- `common_pb2` import pattern: `from gen.common.v1 import common_pb2` (same as `client.py:351`)
- No new outbound gRPC call — reuses the existing `ANALYSIS_ENDPOINT` channel (header propagation via `_metadata` is unchanged, AGENT-4)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

**A. `client.py` — add `page_size` and `page_token` params to `list_opportunities`**:

1. Add `page_size: int = 50` and `page_token: str = ''` params to the `list_opportunities` function signature at `client.py:802`.
2. Import `common_pb2` inside the function body (lazy import pattern): `from gen.common.v1 import common_pb2`.
3. Add a `PageRequest` to the `ListOpportunitiesRequest`:
   ```python
   resp = await stub.ListOpportunities(
       analysis_pb2.ListOpportunitiesRequest(
           min_conviction=min_conviction,
           page=common_pb2.PageRequest(page_size=page_size, page_token=page_token),
       ),
       metadata=_metadata(("x-user-id", user_id)),
   )
   ```
4. Add `"next_page_token": resp.page.next_page_token` to the returned dict (alongside the existing `opportunities`, `computing`, `compute_failed` keys).

**B. `tools.py` — add `page_size` and `page_token` params to the `list_opportunities` tool**:

1. Add `page_size: int = 50` and `page_token: str = ''` params to the tool function at `tools.py:1161`.
2. Update the docstring to document the new params and the `next_page_token` field in the response.
3. Pass the new params through to `client.list_opportunities`:
   ```python
   return await client.list_opportunities(user_id, min_conviction, page_size, page_token)
   ```

**Verification**:
```bash
cd services/xstockstrat-agent && grep -n "page_size\|page_token\|next_page_token" app/client.py app/tools.py
# Confirm params and return field are present
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 6 — test: Agent pagination pass-through

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: Service owner (`xstockstrat-agent`) — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Existing `list_opportunities` client test at `tests/test_client.py:1084`
- Existing `list_opportunities` tool test at `tests/test_tools.py:1925`
- Existing pagination test pattern in `test_client.py` for `list_watchlists` (the same `PageRequest` pass-through)
- Single consumer of these test-specific fixtures — inline is compliant (C-13)

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:

1. **Client test** (`test_client.py`): add a test `test_list_opportunities_pagination` that mocks the analysis stub to return a response with `page.next_page_token = "50"`. Call `list_opportunities(user_id, page_size=50, page_token="")`. Assert: (a) the `PageRequest` was constructed with `page_size=50` and `page_token=""`, (b) the returned dict contains `"next_page_token": "50"`. Then call again with `page_token="50"` and an empty `next_page_token` response; assert the token is empty in the result.

2. **Tool test** (`test_tools.py`): add a test `test_list_opportunities_pagination_params` that invokes the tool with `page_size=25` and `page_token="50"`. Assert the client received the correct params and the tool result includes `next_page_token`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_client.py -k "test_list_opportunities_pagination" -v
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -k "test_list_opportunities_pagination" -v
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 7 — test: E2E fixture extension for pagination

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: Service owner (`xstockstrat-ui`) — Analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `OPPORTUNITIES` fixture at `e2e/fixtures/opportunities.ts:54` — currently 10 rows, 7 unique symbols
- `INVENTORY.md` fixture catalog — must be updated when fixtures change (C-12)
- The mock backend at `e2e/mock-backend.ts` already uses `OPPORTUNITIES` as the fixture array

**TDD**: `N/A (test data extension — no behavioral assertion)`

**Covers**: —

**Instructions**:

If the pagination E2E tests in Step 4 require more than 10 fixture rows to exercise page boundaries at realistic page sizes, extend the `OPPORTUNITIES` array with additional fixture entries. The mock backend's pagination handler (Step 4) slices this array, so adding rows here directly enables multi-page testing.

Add a comment above any new fixture entries referencing this feature (e.g. `// feature 187 — pagination fixture extension`). Update `INVENTORY.md` with the new entry count and the pagination fixture purpose.

If 10 rows are sufficient (testing with `page_size=5` in Step 4 produces 2 pages), this step is a no-op — record it as such and move on.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -c "opportunityKey" e2e/fixtures/opportunities.ts
# Confirm the fixture count is at least 10 (or more if extended)
```

---

### Step 8 — test: Cross-service opportunities E2E validation

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify (if not fully covered by Step 4)

**Reviewers**: Service owner (`xstockstrat-ui`) — Analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- The opportunities e2e at `e2e/insights/opportunities.spec.ts` exercises the full page lifecycle
- The mock backend handler (modified in Step 4) now supports pagination

**TDD**: `N/A (integration verification of Steps 3-4-7)`

**Covers**: `AC-2, AC-5, AC-8`

**Instructions**:

Verify that the existing opportunities e2e spec still passes end-to-end with the `useInfiniteQuery` conversion. The default mock page_size of 50 means the 10-row fixture fits in a single page, so existing tests should pass unchanged. If any existing test relied on the old `useQuery` return shape or the StatTile grid elements, update them to match the new structure.

This step is a consolidation/verification pass — most of the E2E work is in Step 4.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "opportunities"
```

---

### Step 9 — docs: Update mcp-tools.md for agent pagination params

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md` documents the `list_opportunities` tool's parameters and return shape
- The tool now accepts `page_size` (int, default 50) and `page_token` (str, default '') and returns `next_page_token`

**TDD**: `N/A (docs — no code)`

**Covers**: —

**Instructions**:

Update the `list_opportunities` entry in `docs/runbooks/mcp-tools.md`:
1. Add `page_size` (int, default 50, optional) and `page_token` (str, default '', optional) to the parameter table.
2. Add `next_page_token` (str) to the return shape documentation.
3. Add a usage note: "Use `next_page_token` to page through manually. When `next_page_token` is empty, all rows have been returned."

**Verification**:
```bash
grep -n "page_size\|page_token\|next_page_token" docs/runbooks/mcp-tools.md
# Confirm the new params and return field are documented
```

---

### Step 10 — test: Cross-service lint and full test suite

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-ui`, `xstockstrat-agent`
**Files**: (no new files — verification only)

**Reviewers**: Service owner (`xstockstrat-analysis`) — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; Service owner (`xstockstrat-ui`) — Analytics display accuracy, Connect-RPC call safety; Service owner (`xstockstrat-agent`) — MCP tool contract stability

**Codebase Evidence**:
- CI lint commands per `step-constraints.md` §B lint table

**TDD**: `N/A (verification pass — no new code)`

**Covers**: —

**Instructions**:

Run the full test suites and lint for all three affected services to confirm no regressions.

**Verification**:
```bash
# Analysis
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40

# UI
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e

# Agent
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
