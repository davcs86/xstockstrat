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

## Session 2026-09-15 — sdd-spec

- Generated implementation-spec.md with **9 steps**. Status: design-approved → implementation-ready.
  Consumed recon.md (Codebase Map reused as evidence) + design.md (Chosen Approach followed; O1–O10
  mapped to step Targets). All path:line citations re-verified against the current tree.
- Steps: 1 proto (additive `sources=3`/`action_filter=4`/`sort=5` + `available_sources=5` +
  `enum OpportunitySort`), 2 proto-gen, 3 analysis repo (LATERAL source-derivation + source/action
  predicates + sort-branch dict + `available_sources()` facet + `_PROVENANCE_STRUCTURAL_MARKERS`
  constant), 4 repo SQL-text/bind + `_primary_source` parity test, 5 handler (thread fields into both
  `read()` calls + facet at `offset==0` with served `include_expired`), 6 servicer boundary spy +
  vanish-trap test, 7 UI hook (four params in queryKey + request), 8 UI page (drop in-memory
  filter/sort useMemo, `DropdownMenu` from page-0 facet, slider → server floor), 9 Playwright e2e.
- Key codebase findings (grep/Read-confirmed):
  - `ListOpportunitiesRequest` fields 3/4/5 free, `ListOpportunitiesResponse` field 5 free
    (`analysis.proto:627-640`); reuse `OpportunityActionTag` (`:531`); `OpportunitySort` mirrors
    `StrategyOperation`/`ReadinessRule` UNSPECIFIED-as-named-default convention.
  - `read()` binds today `$1-$5` (user_id, min_conviction, w, DISMISS, SNOOZE) with the sole floor +
    exemption at `opportunities.py:153` and the blended grouping ORDER BY at `:164-170`; new params must
    default to a no-op.

## Session 2026-09-15 — sdd-review impl-spec (advisory)

- Result: **0 failures, 3 warnings** (advisory — did not block). Criteria pass: PASS WITH WARNINGS
  (all cited anchors resolve; C-08 pairing, C-15 AC-1..15 coverage, C-14 surface, the read() no-op
  default / `_retry_unavailable_symbols` guard, the sole floor at `opportunities.py:153`, and O1–O10
  all satisfied; no Floor breach).
- Unresolved ✗ / ⚠ carried into execution (all NOTE-level, non-actionable):
  - Step 2: `packages/proto/gen/**` glob in Files — [x] no change needed (conventional for codegen).
  - Step 8: a `service` step carries a `**Covers**: AC-15` tag — [x] no change needed (AC-15 also
    covered by test Step 9; harmless).
  - Step 9: no `--cov-fail-under` — [x] no change needed (xstockstrat-ui has no unit-coverage
    threshold; e2e is the named paired verification).
- Overlap findings (WARN-level, no FAIL-class collision): shared-file / same-function overlaps with
  **187-opportunities-pagination-drain** (in-progress) and **188-sparkline-ohlc-replacement**
  (implementation-ready) on `opportunities.py`, `useOpportunities.ts`, `insights/opportunities/page.tsx`,
  the opportunities e2e spec, and `mock-backend.ts`. No proto field-number / migration / config
  collision. **Trunk already carries 187's landed `useInfiniteQuery` hook + `PARTITION BY` window
  ORDER BY**, so this branch builds on top of them; 188 is the reconcile-at-merge concern. Suggested
  landing order **187 → 188 → 190**; reconcile the page/e2e/mock at merge time (manual, not mechanical).
    default to a no-op because `_retry_unavailable_symbols` (`servicer.py:3645`) also calls `read()`.
  - Handler fresh read `servicer.py:3398`, stale read `:3442` (track `served_include_expired`), offset
    parse `:3464`, response assembly `:3475-3480`.
  - `_primary_source` skips exactly `("watchlist","position","denied")` (`servicer.py:4926`);
    `"unavailable"` intentionally NOT skipped → hoist to `_PROVENANCE_STRUCTURAL_MARKERS` (O9).
  - UI: hook hard-codes `minConviction:0` (`useOpportunities.ts:19-26`); page filters/sorts in memory
    (`page.tsx:134-154`) over derived-from-rows `sources` (`:122-125`); `DropdownMenuCheckboxItem`
    primitive present (`ui/dropdown-menu.tsx:74`); e2e mock `listOpportunities` at
    `mock-backend.ts:828-843` reads only `minConviction`; in-place-refetch RED at
    `opportunities.spec.ts:165-185` (keep mounted, no `page.reload()`).
  - No real-Postgres harness in xstockstrat-analysis → repo tests are SQL-text/bind + pure-function
    parity (matches the existing fake/mock bar; O10 runtime-LATERAL gap already logged in fails.md).
- Scenario coverage: all `@AC-1..15` mapped (table in implementation-spec.md § Scenario Coverage);
  backend behaviors covered by Steps 4/6, UI + end-to-end by Step 9.
- Consumer surface C-14: UI `/insights` opportunities page reached by Steps 7/8/9; Agent tool out of
  scope (no step). No migration, no config keys, no new env vars/ports/edges.

## Session 2026-09-15 — sdd-execute (sequential)

Tooling setup (Steps 1–9): uv/ruff/pytest ✓ (analysis) · pnpm 9.15.9/node 22 ✓ (ui deps installed) ·
buf ⬇ via Docker codegen (`Dockerfile.codegen` image built, `buf-gen.sh` run inside; localenv-setup
exit 0). Docker daemon started. Dev-branch adapted to `claude/opportunities-server-side-filters-ug9u95`.

### Step 1 — proto: additive request/response fields + OpportunitySort enum [done]
- Added `enum OpportunitySort {UNSPECIFIED=0, CONVICTION=1, EXPIRY=2}` (UNSPECIFIED = legacy blended,
  not an alias of CONVICTION — O6 comment), `ListOpportunitiesRequest.{sources=3, action_filter=4,
  sort=5}`, `ListOpportunitiesResponse.available_sources=5`. Additive only.
- Verification: `buf lint` + `buf breaking` passed inside the codegen container (localenv-setup exit 0).
- Files modified: `packages/proto/analysis/v1/analysis.proto`. Deviations: none. TDD: N/A (proto).

### Step 2 — proto-gen: regenerate stubs [done]
- `./scripts/localenv-setup.sh` ran `buf-gen.sh` in the pinned `Dockerfile.codegen` container →
  regenerated Go/Python/TS stubs, confined to `analysis/v1`. New symbols present (37 hits in the Go
  stub). The Go diff re-indexing churn (`EnumInfo, 16`→`17`) is the legitimate deterministic
  consequence of inserting an enum mid-file — not plugin drift.
- Verification: proto-gen is deterministic. Proto codegen ran via **Docker** (CI-equivalent,
  `Dockerfile.codegen` pins the plugins) — logged as a sanctioned sequential-mode fallback.
- Files modified: `packages/proto/gen/**`. TDD: N/A (proto-gen).

### Step 3 — analysis repo: source/action filter, sort branches, available_sources facet [done]
- Hoisted `_PROVENANCE_STRUCTURAL_MARKERS = ["watchlist","position","denied"]` + `_SORT_ORDER_BY` dict
  to `opportunities.py`; refactored `servicer._primary_source` to iterate the same constant (O9).
- Extended `read()` with keyword-only `sources/action_filter/sort` (all no-op defaults — the
  `_retry_unavailable_symbols` caller at servicer.py:3645 is unchanged): LEFT JOIN LATERAL primary-source
  (marker array bound as `$6`), guarded source filter (`$7`, empty = no predicate), action filter on
  `o.action` (`$8`), sort branch from `_SORT_ORDER_BY`. Floor + exemption unchanged (sole floor).
- Added `available_sources(user_id, *, include_expired)` (no filter params — O3; CROSS JOIN LATERAL
  drops empty sources; freshness via include_expired).
- Files modified: `app/repositories/opportunities.py`, `app/handlers/servicer.py`.

### Step 4 — analysis repo SQL/bind + _primary_source parity test [done]
- TDD red→green: RED = ImportError for `_PROVENANCE_STRUCTURAL_MARKERS` against pre-Step-3 code
  (`git stash` of the two source files); GREEN = 15 new tests pass. Full suite **759 passed, 83.96%
  coverage** (≥40%), ruff clean.
- Covers @AC-1..12 (empty-sources guard, source/action predicates, 3 sort branches + tiebreak, floor
  exemption survives, marker-bind==constant O9, facet independence O3, `_primary_source` matrix).
- Files modified: `tests/test_opportunities_repo.py`.

### Step 5 — analysis handler: thread filters into read(), facet on page 0 [done]
- Both `read()` calls (fresh + stale) forward `sources`/`action_filter`/`sort`; `served_include_expired`
  tracks which read produced the served rows; `available_sources(user_id, include_expired=served)` is
  called only at `offset==0` and attached to the response (`offset>0` → `[]`). `_retry_unavailable_symbols`
  read (servicer.py) untouched. Files modified: `app/handlers/servicer.py`.

### Step 6 — servicer boundary spy + vanish-trap parity test [done]
- TDD red→green: RED = the forwarding + stale-facet asserts fail against the pre-Step-5 handler
  (`git stash` of servicer.py); GREEN after. Widened `_FakeOppRepo.read` to accept-and-ignore the new
  kwargs (+ stub `available_sources`) — did NOT teach the fake the filter/sort logic (anti-vacuous-green);
  boundary spy (`AsyncMock(wraps=...)`) proves forwarding. New class `TestListOpportunitiesServerFilters190`
  (forwarding+facet page0 O4/@AC-1/@AC-11, facet-not-past-page0 O1, stale-facet include_expired O7,
  muted/unavailable survive raised floor @AC-2/@AC-3/O8). Full suite **763 passed, 83.97% cov**, ruff clean.
- Files modified: `tests/test_analysis_servicer.py`.

**Backend surface complete (Steps 1–6).** Checkpoint at the backend→UI seam next.


## Session 2026-09-16 — sdd-execute (sequential, UI Steps 7–9)

### Step 7 — UI hook: send four controls, expose availableSources [done]
- `useOpportunities(minConviction=0, sources=[], actionFilter=UNSPECIFIED, sort=UNSPECIFIED)`; all four
  folded into the query key (`['opportunities', minConviction, [...sources].sort(), actionFilter, sort]`)
  so an in-place `refetchInterval` refetch AND a filter change both re-fetch (fails.md:1648). Request
  carries the four fields; `availableSources` rides page 0 of the infinite query.
- Files modified: `src/hooks/useOpportunities.ts`.

### Step 8 — UI page: drop in-memory filter/sort, dropdown from facet, server floor [done]
- Removed all client-side filtering/sorting; page state = `minConviction/activeSources/actionFilter/
  sortKey/availableSources`; `actionFilterEnum`/`sortEnum` derived; hook called with the four controls.
- Source control converted from inline chips to a shadcn `DropdownMenu` (per user decision "convert to
  drop-down on the UI") — `DropdownMenuCheckboxItem` per source (multi-select via `onSelect preventDefault`),
  "All sources" reset item; trigger is a `Button aria-label="source filter"` + `ChevronsUpDown`.
- **Deviation (design→impl):** spec Step 8 named a naive direct read of `data.pages[0].availableSources`
  into the dropdown. That created a render cycle: `effectiveSources` (activeSources ∩ availableSources)
  feeds the query key, but availableSources itself arrives *from* the query, so a source selection →
  key change → `data` momentarily undefined → facet read collapses to `[]` → effectiveSources empties →
  key changes again → oscillation, surfacing as **React #185 (max update depth)**. Fixed by keeping
  `availableSources` in component state hydrated by an effect that (a) returns early while the page-0
  facet is `undefined` (never resets to `[]` on an in-flight refetch), and (b) writes only on real
  change (length + element-wise equality guard, no NUL-join). `effectiveSources = useMemo(activeSources ∩
  availableSources)`. Debugged with a throwaway `_dbg.spec.ts` capturing `pageerror` (deleted after).
- Files modified: `src/app/insights/opportunities/page.tsx`.

### Step 9 — Playwright e2e: mock honors new fields, specs re-pointed, in-place RED [done]
- `mock-backend.ts` `listOpportunities` now honors `req.sources`/`actionFilter`/`sort` + the min-conviction
  floor (muted/unavailable exempt — fails.md:1547), applies symbol-grouped expiry sort (feature-187
  grouping preserved), and emits `availableSources` (structural markers + empty sources excluded).
- Spec rewrite: per-page `mockOpportunities` applies filter/sort/facet/hidden; added `selectSource`/
  `clearSources` dropdown helpers; 4 source tests re-pointed to the dropdown; added action-filter,
  facet-completeness, and sort tests. AC-12 in-place test asserts NO `page.reload()` (fails.md:1648).
- **Deviation (fixture):** AC-11 originally drove source `'alpaca'` → but `'alpaca'` is a standalone CAPR
  fixture row (mock-backend.ts:46), not an OPPORTUNITIES-queue provenance source (those rows carry
  `'watchlist'` markers). Re-pointed AC-11 to `'dividendology'`→TSLA and the facet test to the 3 real
  queue sources `['dividendology','marketwatch','unusual_whales']`.
- **Deviation (harness):** Playwright dev-server cold-compile blew the 10s default; ran under `CI=true`
  (production build, 30s timeouts) with `E2E_PREBUILT=1` to reuse the build across re-runs. Result:
  **27 passed** for `e2e/insights/opportunities.spec.ts --project=chromium`.
- Files modified: `e2e/mock-backend.ts`, `e2e/insights/opportunities.spec.ts`.

**UI surface complete (Steps 7–9). All 9 steps done.** Backend suite 763 passed / 83.97% cov; UI e2e 27
passed. Feature → code-completed; merge-order gate + C-16 promotion + integration PR next.

## Session 2026-09-16 — post-merge hotfix: ListOpportunities IndeterminateDatatypeError

**Symptom:** after #1143 squash-merged to main-dev (d938217) and auto-deployed to staging, the UI
Opportunities list stopped loading. Staging analysis logs showed
`asyncpg.exceptions.IndeterminateDatatypeError: could not determine data type of parameter $3` on
every `read()`.

**Root cause (the fails.md:190 runtime-SQL gap, realized):** `$3` (signal_rank_weight) is referenced
ONLY inside the sort=0 blended-rank `ORDER BY`. The UI's sort mapping (`page.tsx:99-100`) never emits
`UNSPECIFIED(0)` — it is always `CONVICTION(1)` or `EXPIRY(2)`, whose `ORDER BY` fragments omit `$3`.
With `$3` bound but referenced nowhere, Postgres/asyncpg cannot infer its type at PREPARE and aborts
the whole query. The MCP `list_opportunities` tool only ever sends sort=0 (uses `$3`), which is why it
worked while 100% of UI loads failed. Fake-pool unit tests + JS mock e2e never execute a real PREPARE,
so it shipped green — exactly the residual gap flagged in fails.md 2026-09-15 (190).

**Fix:** anchor `$3`'s type unconditionally in the `read()` WHERE clause
(`AND $3::double precision IS NOT NULL`, always true for w∈[0,1]) so PREPARE can type it in every sort
branch. **Regression guard** (`test_read_every_bound_param_is_referenced_in_every_sort_branch`): for
sort ∈ {0,1,2}, assert every bound `$1..$N` appears in the SQL text — a static proxy for the missing
real-DB harness that fails RED on the orphaned `$3`. Full analysis suite 764 passed, ruff clean.
Delivered as a fresh branch off main-dev (the #1143 PR was already merged).

## Session 2026-09-16 (CI: feature status automation)

- Promotion PR #1145 merged to main
- Feature promoted and committed: c91e0c535f10c15962ea856e909ea1a2c659f29a
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-16
