# Design: fix-copilotrail-duplicate-rpc

**Created**: 2026-09-26
**Rounds**: 1 (quick; termination: approved — folds into the caller's consolidated spec-review gate)
**Approved by**: user @ pending (consolidated 189/213 impl-spec review)
**Grounded in**: recon.md

---

## Chosen Approach

**Single-source the default opportunity sort so every default page-1 consumer computes the same
React-Query key.**

Change the `sort` parameter default of `useOpportunities` from `OpportunitySort.UNSPECIFIED` to
`OpportunitySort.CONVICTION` (`src/hooks/useOpportunities.ts:27`) — the ranked queue's natural order
and the value the Opportunities page already falls back to (`page.tsx:105`). Because the query key is
`['opportunities', minConviction, sources, actionFilter, sort]` (`useOpportunities.ts:30`), aligning
the default `sort` makes the page's default-state key `['opportunities', 0, [], UNSPECIFIED, CONVICTION]`
identical to what every defaulting consumer produces, so React Query holds one entry and issues one
`ListOpportunities` RPC for the default page-1 queue.

This corrects the bug at its root — the divergence is a *default-value* drift (feature 190 moved the
page default to `CONVICTION` but left the hook default at `UNSPECIFIED`), so the fix belongs on the
shared default, not on one caller. Also update CopilotRail's stale `:36` comment to describe the shared
`CONVICTION` page-1 key.

**Consumer surface (C-14):** `xstockstrat-ui` `/insights/opportunities` (and, as a global rail, every
route CopilotRail mounts on). No backend/agent change — analysis passes the sort through and returns
the same opportunity set.

**Why not touch the page:** the page already passes `CONVICTION` explicitly via its `sortEnum`
fallback; once the hook default matches, the page needs no change. The four ambient consumers
(`CopilotRail`, `SignalReadiness`, `WatchlistDetail`, `trader/positions/[symbol]`) all rely on the
default and therefore converge automatically.

## Rejected Alternatives

- **Pin only CopilotRail's `sort` arg to `CONVICTION`** (the product-spec's "single-file" fix) — rejected: CopilotRail's hook runs on every route (global rail, above the `showCopilot` guard, `CopilotRail.tsx:37`), and three other ambient consumers still default to `UNSPECIFIED` (`SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`, `trader/positions/[symbol]/page.tsx:176`). Pinning one caller merely relocates the duplicate RPC to `/insights/watchlists` and `/trader/positions/[symbol]`. It passes @AC-1 while leaving the same defect class live elsewhere.
- **Introduce a `DEFAULT_OPPORTUNITY_SORT` const referenced by both the hook default and the page fallback** — rejected as over-built for the need: making it the hook's parameter default is already the single source; the page's explicit fallback becomes redundant (can be simplified opportunistically but is not required). Avoids a new exported symbol (Behavior rule #2, minimum change).
- **Make CopilotRail read the page's live query state instead of issuing its own hook** — rejected: CopilotRail is global and mounts without the page; it legitimately needs its own subscription to the default page-1 queue for its templated summary. Coupling it to the page's component state breaks the off-route case.

## Open Risks

- [ ] Confirm `sort=UNSPECIFIED` and `sort=CONVICTION` return the **same opportunity set** from analysis (order-only difference, which the ambient consumers don't depend on). Verify at execution against the e2e mock backend + the analysis `ListOpportunities` handler; if the set differs, narrow the fix to the query-key alignment only (map the ambient consumers' key to `CONVICTION` without changing the request `sort` sent). Target: execute step (test) + a quick analysis-handler read.
- [ ] Ensure the 5-tuple key shape is preserved (fails.md:1648) — no collapsing of controls.

## Constitution Rules Touched

- `C-14` — honored by: the consumer surface (`/insights/opportunities` + the global rail) is the thing under test; the fix is verified at that surface via e2e, not just at the hook.
- `F-04`/`P-03` — honored by: every claim cites a real `path:line` from recon; the one unverified item (server sort semantics) is carried as an Open Risk, not guessed.
- DRY guard rail — honored by: the fix removes the drift-prone duplicated default rather than adding a second pinned literal.

## Business Rules Touched (C-16)

- EXTEND feature-187 `@AC-7` "single page-1 ListOpportunities RPC" — this fix enables the deferred strict-single-RPC guard to be written against `e2e/insights/opportunities.spec.ts`.
- PRESERVE ranked-queue ordering on `/insights/opportunities` — not regressed: the returned opportunity set is unchanged (Open Risk confirms order-only equivalence); the page keeps its explicit `CONVICTION` sort.
