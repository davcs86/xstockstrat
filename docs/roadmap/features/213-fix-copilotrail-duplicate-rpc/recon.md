# Recon: fix-copilotrail-duplicate-rpc

**Created**: 2026-09-26
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

On `/insights/opportunities`, two `ListOpportunities` RPCs fire on load because `CopilotRail` and the
Opportunities page compute different React-Query keys that differ only in the trailing `sort` element.
Make the page-1 default queue resolve to a single shared cache entry (exactly one RPC) without
regressing the ranked-queue ordering or the other queue consumers.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / React 18 / TypeScript)
  - Shared hook: `useOpportunities(minConviction=0, sources=[], actionFilter=UNSPECIFIED, sort=UNSPECIFIED)` — `src/hooks/useOpportunities.ts:23-28`
  - Query key shape (feature 190, 5-tuple): `['opportunities', minConviction, [...sources].sort(), actionFilter, sort]` — `src/hooks/useOpportunities.ts:30`
  - Buggy consumer: `CopilotRail` calls `useOpportunities(0)` (sort defaults to `UNSPECIFIED`) — `src/components/copilot/CopilotRail.tsx:37`; stale comment "Share the ['opportunities', 0] cache" at `:36`; the hook runs **above** the `if (!showCopilot) return null` guard, so it fires on every route (global rail mounted in `PlatformHeader`)
  - Page consumer: `useOpportunities(minConviction, effectiveSources, actionFilterEnum, sortEnum)` where `sortEnum` falls back to `OpportunitySort.CONVICTION` — `src/app/insights/opportunities/page.tsx:100-105,116`
  - `OpportunitySort` enum (proto-es): `@xstockstrat/proto/analysis/v1/analysis_pb` — imported `src/hooks/useOpportunities.ts:5`, `page.tsx:28`
  - E2E suite: `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` (35 scenarios today; feature-187 @AC-7 strict single-RPC guard deferred pending this fix — context.md:29-30)

## Patterns to REUSE

- Default-sort truth → today it is an inline literal duplicated in two places (`useOpportunities.ts:27` param default `UNSPECIFIED`; `page.tsx:105` fallback `CONVICTION`). The fix should single-source it so call sites cannot drift again (this is the DRY root cause of the regression).
- RPC-count assertion in e2e → reuse the existing network-intercept pattern already used across `e2e/insights/opportunities.spec.ts` (feature 187/190 request-count assertions); no new fixture needed (C-12).

## Existing Business Rules (preserve / extend)

- **EXTEND** feature-187 `@AC-7` "single page-1 ListOpportunities RPC" — this fix is the enabling change that lets the deferred @AC-7 strict-single-RPC guard become writable (context.md:29-30). 213's own `@AC-1` (`acceptance.feature`) is the regression scenario.
- **PRESERVE** the ranked-queue ordering guarantees on `/insights/opportunities` (conviction-first default) — the fix must not alter the *set* or *order* of returned opportunities, only the client cache key.
- No dedicated durable `services/xstockstrat-ui/acceptance/*.feature` suite for this surface yet; the live guarantees are the `e2e/insights/opportunities.spec.ts` scenarios.

## Dependencies

- Proto/RPC: reads `AnalysisService/ListOpportunities` (unchanged); consumes `OpportunitySort` enum (existing, no new value). No proto change.
- Migration: none.
- Config keys: none.
- Inter-service edges: `xstockstrat-ui` (insights BFF) → `xstockstrat-analysis` gRPC `ListOpportunities` — the duplicate read fan-out this fix removes.
- New env vars / ports: none.

## Risks / Not-found

- **Server semantics of `sort=UNSPECIFIED` vs `CONVICTION`** — not verified in this session (analysis-side). If the server already treats `UNSPECIFIED` as conviction-default ordering, unifying the client default to `CONVICTION` is behavior-preserving; if not, the four ambient consumers' returned *order* changes (but none of them depend on order — they flatten and look up by symbol). Carry as an open risk to confirm the returned set is unchanged.
- **Four ambient consumers default `sort=UNSPECIFIED`** (`CopilotRail:37`, `SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`, `trader/positions/[symbol]/page.tsx:176`) — a fix that pins ONLY CopilotRail to `CONVICTION` relocates the duplicate-RPC to `/insights/watchlists` and `/trader/positions/[symbol]` rather than eliminating it. This is the decisive constraint on the design.
- fails.md:1648 trap (query key must fold all controls so refetch + filter-change both re-fetch) — the fix must not collapse the 5-tuple key shape.

## Recommended Scope

1. Single-source the default `sort` (one const) so all defaulting consumers and the page fallback agree → the whole default page-1 queue is one cache entry / one RPC.
2. Update CopilotRail's stale `:36` cache comment.
3. Extend `e2e/insights/opportunities.spec.ts` with the @AC-1 single-RPC regression scenario; unblock the deferred feature-187 @AC-7 guard.
