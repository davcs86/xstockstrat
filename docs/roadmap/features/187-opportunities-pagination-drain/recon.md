# Recon: opportunities-pagination-drain

**Created**: 2026-09-11
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ui, xstockstrat-agent

---

## Objective

The ListOpportunities RPC defaults to `page_size=50` and no consumer (UI hook, agent tool, CopilotRail)
drains subsequent pages, silently capping the surfaced queue at ~50 rows even when 150+
materialized opportunities exist. Reduce the default page size to 25 and implement auto-drain
pagination in both the UI hook and the agent tool so all materialized rows are surfaced.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - `_DEFAULT_OPP_PAGE_SIZE = 50` — `servicer.py:279`
  - ListOpportunities handler — `servicer.py:3368`
  - Offset pagination (Python slicing) — `servicer.py:3463-3470`
  - PageResponse construction — `servicer.py:3475-3478`
  - Repo `read()` (no LIMIT clause) — `repositories/opportunities.py:120-173`
  - Universe compute (independent of page size) — `servicer.py:3822-3842`
  - Existing pagination test — `tests/test_analysis_servicer.py:5391` (`test_paging_stable_across_tied_unavailable_rows`)

- **`xstockstrat-ui`** (Next.js)
  - `useOpportunities` hook — `src/hooks/useOpportunities.ts:16-22`
  - Call sites: `opportunities/page.tsx:101`, `positions/[symbol]/page.tsx:176`, `SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`
  - Direct client call (no hook) — `CopilotRail.tsx:68-69`
  - Browser client — `src/lib/browserClients/analysisClient.ts:1-6` (connect-web transport)
  - BFF forward — `src/lib/insightsBff.ts:54-56` (30s timeout)
  - Test fixtures — `e2e/fixtures/opportunities.ts:54` (10 fixture rows)

- **`xstockstrat-agent`** (Python)
  - `list_opportunities` client — `app/client.py:802` (no page sent, no drain)
  - `_opportunity_to_dict` projection — `app/client.py:747`
  - `list_opportunities` tool — `app/tools.py:1161` (single param `min_conviction`)
  - Proto imports pattern — lazy `from gen.analysis.v1 import analysis_pb2` inside function body
  - Existing pagination pass-through (NOT drain) — `client.py:349` (`list_watchlists`), `client.py:1665` (`list_backfill_jobs`)
  - Tests — `tests/test_client.py:1084`, `tests/test_tools.py:1925`, `tests/test_opportunity_projection.py:1`

## Patterns to REUSE

- **Offset pagination (server)** → reuse existing `servicer.py:3463-3470` pattern (change only the constant at line 279)
- **PageRequest/PageResponse proto** → reuse `common.proto:10-17` (`PageRequest { page_size, page_token }` / `PageResponse { next_page_token }`)
- **UI pagination pass-through** → inline object literals `{ pageSize: N, pageToken: '' }` matching proto shape (no explicit import needed) — see `useStrategies.ts:17`, `usePositionLineage.ts:19`
- **Agent pagination pass-through** → reuse `common_pb2.PageRequest(page_size=..., page_token=...)` pattern from `client.py:349` (`list_watchlists`)
- **Test fixtures** → reuse `e2e/fixtures/opportunities.ts:54` (`OPPORTUNITIES` array, 10 rows) for pagination drain tests
- **Existing pagination test** → extend `test_analysis_servicer.py:5391` pattern for page_size=25 default verification
- **`useInvalidatingMutation`** → already used by `useSetOpportunityAction` in the same hook file; pagination drain must invalidate on the same `['opportunities']` key

## Existing Business Rules (preserve / extend)

All 22 relevant existing guarantees are **PRESERVE** — no EXTEND or CHANGE. Key risks:

- **PRESERVE** `@AC-6 @feature-185` "Cold read returns empty page + computing signal" — auto-drain must detect `computing=true` on first page and stop (not loop forever)
- **PRESERVE** `@AC-7 @feature-185` "Terminal compute-failed" — auto-drain must propagate `compute_failed` to caller
- **PRESERVE** `@AC-8 @feature-185` "Surgical self-heal on read" — paginated reads must still trigger recovery for stale unavailable rows (recovery is per-row in the handler, not per-call — confirmed)
- **PRESERVE** `@AC-9 @feature-183` "Memo TTL >= poll interval" — rapid paginated drain within one poll must honor memo; sequential calls within same cycle hit the memo
- **PRESERVE** `@AC-1 @feature-183` "BFF 30s gRPC deadline" — each paginated call carries its own deadline; total drain worst-case = N × 30s
- **PRESERVE** `@AC-14 @feature-095` "Live quote enrichment does not alter ranking" — page size change must not alter ranking logic (it doesn't — ranking is pre-pagination)
- **PRESERVE** `@AC-1 @feature-176` "Concurrent compute yields identical set + rank order" — auto-drain must surface the full identical set across pages

Full list: 12 analysis-side, 8 UI-side, 2 agent-side guarantees — all PRESERVE. No existing scenario asserts `page_size=50`, so the 50→25 change is transparent.

## Dependencies

- Proto/RPC: none — `ListOpportunitiesRequest.page` (`analysis.proto:628`) and `PageRequest`/`PageResponse` (`common.proto:10-17`) already exist and are unchanged
- Migration: none
- Config keys: none
- Inter-service edges: unchanged (UI → BFF → analysis gRPC)
- New env vars / ports: none

## Risks / Not-found

- **No pagination drain loop exists anywhere in the UI codebase.** All existing hooks use single-page fetches or manual "next page" buttons. The drain loop is a new pattern for this codebase.
- **No pagination drain loop exists in `client.py`.** All agent client pagination is pass-through (returns `next_page_token` for manual paging by the caller).
- **CopilotRail direct call** (`CopilotRail.tsx:68-69`) bypasses `useOpportunities` and calls `analysisClient.listOpportunities({})` directly — it will also need the drain logic or must switch to the hook.
- **BFF deadline stacking** — auto-drain makes N sequential calls, each with a 30s BFF deadline. Worst case for 200 rows at page_size=25 = 8 calls × 30s = 240s. Add a max-pages safety cap (e.g. 20 pages = 500 rows) to prevent unbounded client-side wait.
- **Known trap (fails.md:662, 805)** — truncation-before-diagnostic. Not applicable: the DB read returns all rows; ranking/diagnostics are computed before pagination. Pagination is purely transport-layer slicing.
- **`computing`/`compute_failed` termination** — the drain loop must check `computing` and `compute_failed` on every page response and stop draining if either is true, to avoid looping into empty/errored state.

## Recommended Scope

1. **Step 1 (service)**: Change `_DEFAULT_OPP_PAGE_SIZE` from 50 to 25 in `servicer.py:279`
2. **Step 2 (test)**: Update the existing pagination test to verify the new default of 25
3. **Step 3 (service — UI)**: Implement auto-drain pagination in `useOpportunities` hook — loop on `next_page_token`, aggregate pages, handle `computing`/`compute_failed` termination, add max-pages safety cap
4. **Step 4 (service — UI)**: Fix `CopilotRail.tsx` to use `useOpportunities` hook or add drain logic
5. **Step 5 (service — agent)**: Implement auto-drain in `client.py:list_opportunities` — loop on `page.next_page_token`, aggregate, propagate `computing`/`compute_failed`
6. **Step 6 (test)**: Add/update tests for UI drain behavior and agent drain behavior
