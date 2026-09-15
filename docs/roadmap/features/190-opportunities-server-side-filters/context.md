# Context: opportunities-server-side-filters

**Feature**: `docs/roadmap/features/190-opportunities-server-side-filters/feature.md`
**Product Spec**: `docs/roadmap/features/190-opportunities-server-side-filters/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/190-opportunities-server-side-filters/implementation-spec.md`

---

## Session 2026-09-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Operator decisions captured up front (behavior #1, avoid rework):**
  1. Source facets → **server returns `available_sources`** computed over the full unfiltered valid
     queue (not client-derived, not a static enum).
  2. Expiry sort → **preserve feature-187 symbol grouping**; group positioned by its
     soonest-expiring member.
  3. Scope → **all four controls** (min-conviction, source, action, sort) move server-side; run the
     **full** SDD pipeline.
- Grounding read of the current stack (pre-story recon):
  - UI `insights/opportunities/page.tsx` filters/sorts **in memory** over a 50/page
    `useInfiniteQuery`, hard-coding `minConviction: 0` (`useOpportunities.ts`).
  - `analysis.ListOpportunities` already accepts `min_conviction` (proto field 2) and offset-pages;
    `OpportunitiesRepository.read` already applies the floor with `denied`/`unavailable` exemptions
    and feature-187 symbol grouping in the ORDER BY.
  - `Opportunity.source` is **derived** (`_primary_source(provenance)`), not a column — the source
    filter + facet must reproduce that derivation in SQL over the `provenance` JSONB.
- **Ledger traps folded into the spec's Known Traps:** `fails.md:1547` (muted vanish — filter at
  every layer), `fails.md:577` ("already supports" ≠ consumed — the UI passes 0 today),
  `fails.md:1648` (mount-persistent state vs in-place refetch), `fails.md:1780` (inspect the read
  path incl. pagination + facet).
- Consumer surface (C-14): **UI `/insights`** (opportunities page). No agent change.

## Session 2026-09-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): **PASS** — 0 blockers, 0 warnings. Proto field numbers verified
  free on trunk (`ListOpportunitiesRequest` 3/4/5, `ListOpportunitiesResponse` 5); FR→AC coverage
  complete (AC-1..15); trading-domain checks N/A.
- Overlap pass (feature-overlap): **no blocking collision** (no proto field-number / config /
  migration collision). Soft file overlaps only, with in-flight features:
  - `187-opportunities-pagination-drain` — same hook (`useOpportunities.ts`), same page
    (`page.tsx`), same analysis read path (`servicer.py` + `opportunities.py` ORDER BY / window
    function). NOTE: the current trunk already carries feature-187's `useInfiniteQuery` hook and the
    `PARTITION BY o.symbol` grouping window in `opportunities.py:160` — 190 builds directly on that.
  - `188-sparkline-ohlc-replacement` — same page (`page.tsx`) row-rendering region.
  - Recommendation: execute/rebase 190 after/alongside 187 & 188; no hard `merge-order.md` row
    required (all soft/rebase). Reconcile at execute time.

## Session 2026-09-15 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-analysis, xstockstrat-ui;
  key reuse: `_primary_source` skip-list parity, feature-187 window ORDER BY, `queue_share`/
  `taken_count` sibling-method shape, `effectiveSources` intersection, `ui/dropdown-menu`). 4 parallel
  discovery + scenario-recon agents.
- Phase 1 Grilling: **4 rounds (full)**. Chosen approach: additive proto (`sources`/`action_filter`/
  `sort`+`OpportunitySort`, `available_sources`); analysis `read()` SQL filter/sort branches + a
  freshness-scoped, floor-independent `available_sources()` sibling method (Option A) replicating the
  `_primary_source` skip-list via a bound marker-array constant; UI drops the in-memory filter/sort,
  feeds a multi-select `DropdownMenu` from the page-0 facet. Rejected: `UNSPECIFIED≡CONVICTION` (would
  change agent-tool default order), Option-B CTE facet (read() runs full every RPC → CTE costlier),
  transaction-snapshot facet, a per-feature real-DB harness, string-interpolated marker list,
  always-survive muted rows.
- **Operator decisions at the gate (behavior #1):**
  1. Conviction sort → **raw** `o.conviction` (parity); `UNSPECIFIED` keeps the legacy blended default
     so non-UI callers (agent `list_opportunities`) are unchanged (no C-16 CHANGE).
  2. `available_sources` facet → **independent of the min-conviction floor**; source control → **convert
     to a dropdown** (multi-select `DropdownMenuCheckboxItem`).
  3. Muted/denied + data-unavailable rows → **parity: floor-exempt only** (source/action filters drop
     them like the client does); no always-survive, no C-16 CHANGE.
- **Ten pins O1–O10** recorded in design.md Open Risks (facet from pages[0]; empty-sources=no predicate;
  facet param-independence; servicer→repo call-arg RED; dropdown a11y + re-pointed e2e; proto comment +
  ORDER BY tiebreak; `include_expired` parity on the facet call; muted-parity vanish-trap test; bound
  marker-array constant; residual runtime-`LATERAL` gap → fails.md + named follow-up).
- Constitution rules touched: C-04/C-08/C-09/C-10/C-14/C-16/C-17/C-18/F-04/F-06/P-03. **Floor breaches:
  none** across all 4 rounds.
- C-16: PRESERVE @AC-9/@AC-10/@AC-8/@AC-1/@AC-2/@AC-3/@AC-5/@AC-6(185)/@AC-14(095)/@AC-4/@AC-5(177);
  EXTEND @AC-11/@AC-12(155) (client→server, outcomes preserved); no CHANGE.
- Status: spec-ready → design-approved.

### Known limitation (O10 — recorded here + fails.md, P-03)
No `xstockstrat-analysis` test executes repo SQL against a real Postgres (conftest is proto-path only;
no testcontainers; `integration-test.sh` is dead) — the whole repo SQL surface is fake/mock-verified.
This feature matches that bar (SQL-text/bind assertions + a `_primary_source` pure-function parity test
+ a servicer boundary spy), so a subtly-wrong `LATERAL`/`ORDER BY` runtime *semantic* (as opposed to a
marker-set drift, which the bound constant kills by construction) is not fully caught in CI. Closing it
is a **platform follow-up** (a shared analysis conftest real-DB fixture benefiting every repo query),
not this feature's burden — logged in `docs/roadmap/ledger/fails.md`.

