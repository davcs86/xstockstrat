# Implementation Spec: fix-copilotrail-duplicate-rpc

**Status**: `complete`
**Created**: 2026-09-26
**Feature**: `docs/roadmap/features/213-fix-copilotrail-duplicate-rpc/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/fix-copilotrail-duplicate-rpc`

---

## Execution Summary

Root-cause fix for the duplicate `ListOpportunities` RPC on `/insights/opportunities`. Per the
approved design (`design.md` § Chosen Approach), the fix single-sources the default opportunity
sort by changing the `sort` parameter default of the shared `useOpportunities` hook from
`OpportunitySort.UNSPECIFIED` to `OpportunitySort.CONVICTION`, so every default page-1 consumer
computes the identical React-Query key `['opportunities', 0, [], UNSPECIFIED, CONVICTION]` and React
Query holds one cache entry / issues one RPC. Step 1 makes the code change (hook default + stale
CopilotRail comment); Step 2 adds the `@AC-1` regression e2e that fails on the buggy two-RPC
behavior and passes once the defaults align. No backend/proto/migration/config change — analysis
passes the sort through and returns the same opportunity set.

**Consumer surface (C-14):** `xstockstrat-ui` `/insights/opportunities` and, because `CopilotRail`
is a global rail mounted in `PlatformHeader` (`src/components/shared/PlatformHeader.tsx:180`), every
route the rail mounts on. The surface is reached and verified at Step 2 via e2e, not just at the
hook. No Agent MCP surface involved.

**Scope-widening flag (requires user sign-off — context.md:39):** the product spec scoped this as a
"single-file front-end fix … Out of Scope: refactoring `useOpportunities`" and proposed pinning only
CopilotRail's `sort` arg. The approved design widens the fix to the shared hook default because
pinning one caller merely relocates the duplicate RPC to `/insights/watchlists` and
`/trader/positions/[symbol]` (three other ambient consumers still default to `UNSPECIFIED` —
`WatchlistDetail.tsx:72`, `SignalReadiness.tsx:28`, `trader/positions/[symbol]/page.tsx:176`). This
deviation from the product-spec's stated scope must be signed off by the user at the consolidated
189/213 impl-spec review before any code is written (C-14 / P-04).

## Scenario Coverage

- `@AC-1` (single page-1 `ListOpportunities` RPC; CopilotRail renders from the shared cache) → Step 2

## Step Dependencies

- Step 2 (test) covers Step 1 (service). Author Step 2's assertion to fail against the
  pre-implementation tree (two page-1 RPCs with differing `sort`) — red-before-green (P-06).
- **Open Risk carried from `design.md` (resolve at execution):** confirm `sort=UNSPECIFIED` and
  `sort=CONVICTION` return the **same opportunity set** (order-only difference the ambient consumers
  don't depend on). In the e2e mock this already holds — `mockOpportunities` in
  `e2e/insights/opportunities.spec.ts:53` branches ordering only on `isExpirySort(req.sort)`
  (`:35`), so `UNSPECIFIED` and `CONVICTION` both take the non-expiry, symbol-grouped-by-conviction
  path (identical set + order). Before implementing, read the analysis `ListOpportunities` handler
  to confirm the server treats `UNSPECIFIED` as conviction-default ordering; if the returned *set*
  (not order) would differ, narrow the fix to a query-key alignment that keeps the request `sort`
  each consumer sends — and record that deviation in `## Deviation Log` + `context.md`.
- **fails.md:1648** — the 5-tuple query-key shape (`['opportunities', minConviction, sources,
  actionFilter, sort]`, `useOpportunities.ts:30`) must be preserved; the fix changes only a default
  value, never collapses a control out of the key.

---

### Step 1 — service: align the shared opportunity-sort default so all page-1 consumers share one cache entry

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Hook signature + buggy default confirmed via Read `services/xstockstrat-ui/src/hooks/useOpportunities.ts:23-28`:
  ```ts
  export function useOpportunities(
    minConviction = 0,
    sources: string[] = [],
    actionFilter: OpportunityActionTag = OpportunityActionTag.UNSPECIFIED,
    sort: OpportunitySort = OpportunitySort.UNSPECIFIED,   // ← line 27, change to CONVICTION
  )
  ```
- Query key (5-tuple, feature 190) — `useOpportunities.ts:30`:
  `queryKey: ['opportunities', minConviction, [...sources].sort(), actionFilter, sort]`
- `OpportunitySort` enum imported from `@xstockstrat/proto/analysis/v1/analysis_pb` — `useOpportunities.ts:5`.
  Enum values confirmed in `packages/proto/analysis/v1/analysis.proto:546-550`:
  `OPPORTUNITY_SORT_UNSPECIFIED = 0`, `OPPORTUNITY_SORT_CONVICTION = 1`, `EXPIRY = 2`, `SYMBOL_SCORE = 3`.
- Page consumer already falls back to `CONVICTION` — `src/app/insights/opportunities/page.tsx:100-105`
  (`sortEnum` defaults to `OpportunitySort.CONVICTION`) passed at `page.tsx:116`. Once the hook
  default matches, the page needs no change.
- Four ambient consumers rely on the default `sort` (confirmed via
  `grep -rn "useOpportunities(" src/`): `CopilotRail.tsx:37` (`useOpportunities(0)`),
  `WatchlistDetail.tsx:72` (`useOpportunities()`), `SignalReadiness.tsx:28` (`useOpportunities()`),
  `trader/positions/[symbol]/page.tsx:176` (`useOpportunities(0)`) — all converge onto `CONVICTION`
  automatically.
- **Order-independence of the three non-CopilotRail ambient consumers (W1, C-10/C-14 ripple).** The
  default-sort change shifts `WatchlistDetail`, `SignalReadiness`, and the trader symbol page from
  `UNSPECIFIED` (blended-rank) to `CONVICTION` ordering. Each consumes the queue by **symbol lookup,
  not ranked position**, so the change is display-safe: `WatchlistDetail.tsx:72` flattens
  `oppData.pages` and matches per-symbol; `SignalReadiness.tsx:28` reads the set for a specific
  symbol's readiness; `trader/positions/[symbol]/page.tsx:176` enriches a single symbol's header from
  the matching `Opportunity`. None renders the queue in ranked order. Verify each at Step 2 execution
  time alongside the Open-Risk set-equality check below (fold these three surfaces into that check —
  confirm the returned opportunity *set* is unchanged and no consumer indexes by position).
- Stale comment to update — `CopilotRail.tsx:36`:
  `// Share the ['opportunities', 0] cache with the Opportunities page (page-1 only, no Load More).`
- `CopilotRail`'s hook runs above its `if (!showCopilot) return null` guard (hook at `:37`, guard at
  `:100`), and the rail is mounted globally in `PlatformHeader.tsx:180` — so its RPC fires on every
  route regardless of the rail being open. This is why the fix belongs on the shared default.

**TDD**: `red-green required` — paired with Step 2. Step 2's assertion fails pre-change (two page-1
RPCs) and passes post-change (one).

**Covers**: — (non-test step)

**Instructions**:
1. In `services/xstockstrat-ui/src/hooks/useOpportunities.ts:27`, change the `sort` parameter default
   from `OpportunitySort.UNSPECIFIED` to `OpportunitySort.CONVICTION`. Do not add a new exported
   const or otherwise change the signature/arity or the query-key tuple shape at `:30` (design.md
   § Rejected Alternatives: the parameter default *is* the single source; fails.md:1648: keep the
   5-tuple intact). The page's explicit `CONVICTION` fallback (`page.tsx:105`) becomes redundant but
   is left as-is (out of scope; no behavior change).
2. In `services/xstockstrat-ui/src/components/copilot/CopilotRail.tsx:36`, update the stale cache
   comment to describe the shared **CONVICTION** page-1 key (the rail now shares the page's default
   `['opportunities', 0, [], UNSPECIFIED, CONVICTION]` entry). Keep it to ≤2 lines stating the
   constraint (root CLAUDE.md § How to Act #5). Do not change `CopilotRail`'s `useOpportunities(0)`
   call — it converges via the shared default.
3. C-17: no color/token/primitive change — this step touches only a hook default and a comment; no
   new markup or styling.

**Verification**:
- `cd services/xstockstrat-ui && pnpm run lint` — passes.
- `grep -n "sort: OpportunitySort = OpportunitySort.CONVICTION" services/xstockstrat-ui/src/hooks/useOpportunities.ts`
  — confirms the new default.
- `grep -n "OpportunitySort.UNSPECIFIED" services/xstockstrat-ui/src/hooks/useOpportunities.ts` —
  confirms the `sort` default no longer reads `UNSPECIFIED` (the `actionFilter` default stays
  `OpportunityActionTag.UNSPECIFIED`, a different enum, and is unchanged).
- Behavioral verification is Step 2's e2e (red-green).

---

### Step 2 — test: @AC-1 regression — a single page-1 ListOpportunities RPC with CopilotRail mounted

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Suite + intercept pattern confirmed via Read `e2e/insights/opportunities.spec.ts`: imports
  `OPPORTUNITIES` from `../fixtures/opportunities` (`:3`) and `addAuthCookie` from `../helpers/auth`
  (`:2`); intercepts `**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities` via
  `page.route(...)` (`:44`, `:112`) reading `JSON.parse(route.request().postData())`.
- Connect-JSON enum encoding: an enum serializes as its NAME string and the `0` default is omitted
  (`e2e/insights/opportunities.spec.ts:26` comment; `isExpirySort` checks
  `v === 2 || v === 'OPPORTUNITY_SORT_EXPIRY'` at `:36`). So a `CONVICTION` request carries
  `sort: 'OPPORTUNITY_SORT_CONVICTION'` (or `1`); an `UNSPECIFIED` request omits `sort` / sends `0`.
- Default single-page handler `mockOpportunities` (`:53`) is the one used by `beforeEach` (`:150`);
  ordering branches only on `isExpirySort(req.sort)` (`:35`), so `UNSPECIFIED` and `CONVICTION`
  return the same set + order in the mock (resolves the Open Risk for the e2e path).
- Request-count assertions already exist in this suite (feature 187/190 poll test at `:463`);
  reuse the same `page.route`/`postData` mechanism to count — no new fixture (C-12).
- `CopilotRail` mounts globally in `PlatformHeader.tsx:180` and its `useOpportunities(0)` hook runs
  above the `showCopilot` guard, so on `/insights/opportunities` the rail's page-1 RPC is in flight
  during initial load whether or not the rail is open — this is the second RPC the test must catch.

**TDD**: `red-green required` — the assertion asserts exactly one page-1 RPC; it fails on the
pre-Step-1 tree (page fires `CONVICTION`, CopilotRail fires `UNSPECIFIED` → two page-1 cache entries
→ two RPCs) and passes after Step 1 aligns the defaults.

**Covers**: `AC-1`

**Instructions**:
1. Add a new `@AC-1` regression test to `e2e/insights/opportunities.spec.ts` (a self-contained test
   or a small `describe` with its own setup — do **not** rely on the top `beforeEach`, which
   navigates before a counter can attach). Reuse `addAuthCookie` and the existing `OPPORTUNITIES`
   fixture import — no new fixture module (C-12; scenario setup only).
2. Before `page.goto('/insights/opportunities')`, register a `page.route` on
   `**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities` that (a) fulfils from `OPPORTUNITIES`
   like `mockOpportunities`, and (b) records, for each request, the parsed `req.page?.pageToken` and
   `req.sort`. Count only **page-1 default** requests: empty/absent `pageToken`, absent/`0`
   `minConviction`, empty `sources`.
3. After the queue renders (`await expect(card(page,'AAPL')).toBeVisible(...)` as in the existing
   beforeEach), assert **exactly one** page-1 default `ListOpportunities` request was issued, and
   that no page-1 request carried an unspecified/omitted `sort` distinct from the page's
   `CONVICTION` request (i.e. CopilotRail shares the page's page-1 cache rather than issuing a second
   request with a different sort — the exact wording of `@AC-1`). Scope the assertion to the initial
   load window (before the 15s poll at `useOpportunities.ts:45` fires) so the poll does not perturb
   the count.
4. Do not change the shared `mockOpportunities`/`mockOpportunitiesPaged` helpers (they feed the
   copilot/mobile-overflow specs — comment at `:106`); keep the new counter local to this test.
5. Follow-on (out of scope here, named for traceability): once this lands, the deferred feature-187
   `@AC-7` strict single-RPC guard becomes writable against this suite (context.md:29-30) — not part
   of this feature's steps.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/opportunities.spec.ts` — the new
  `@AC-1` test passes and the existing opportunities scenarios still pass (34 pre-existing +1 new).
  (No Go/Python-style coverage threshold applies to `xstockstrat-ui`; e2e is the coverage — see
  spec-template § coverage table.)
- `cd services/xstockstrat-ui && pnpm run lint` — passes (lint gate for the test file, §B).
- Red-before-green: `/sdd-execute` runs this test against the pre-Step-1 tree and captures the
  failing run (two page-1 RPCs), then the passing run after Step 1.

---

## Deviation Log

### 2026-09-26 — Open Risk resolved (set/order unchanged); CI-equivalent e2e verification
- **Open Risk (from design.md) RESOLVED**: the concern that `sort=UNSPECIFIED`→`CONVICTION` might change the returned opportunity *set* is cleared empirically — the **full `opportunities.spec.ts` suite (36 tests) passes** unchanged after the default flip, including the conviction-sort (`:304`), symbol-score-sort (`:314`), and server-order-authoritative (`:397`) tests. The mock sorts both `UNSPECIFIED` and `CONVICTION` by conviction grouping (`isExpirySort` false for both), so the set and order are identical; the three ambient consumers (Step 1 W1) consume by symbol lookup, not ranked position. No narrowing of the fix was needed.
- **Red→green captured (P-06)**: pre-fix the regression observed **2** RPCs (`["OPPORTUNITY_SORT_UNSPECIFIED", "OPPORTUNITY_SORT_CONVICTION"]`); post-fix **1**. Full suite green (36 passed).
- **Verification (CI-equivalent fallback)**: Docker e2e runner unavailable (no daemon); ran host-native in **CI mode** (`CI=1` — production build + widened test timeouts so the SSR-warmup step doesn't time out on cold `next dev`). `**Disposition**: CI-equivalent fallback.`
