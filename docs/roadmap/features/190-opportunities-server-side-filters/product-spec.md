# Product Spec: opportunities-server-side-filters

**Created**: 2026-09-15

---

## Problem Statement

The Opportunities List page (`/insights/opportunities`) applies all four of its controls —
min-conviction floor, source multi-select, action filter, and sort — **client-side, in memory**,
over an already-paginated `useInfiniteQuery` (50 rows/page, hard-coding `minConviction: 0` on the
wire). This is incoherent under offset pagination: the filters and the chosen sort see only the
pages already loaded, while "Load more" appends rows in the *server's* rank order. Raising the
slider or selecting "soonest expiry" therefore operates on a partial, non-authoritative window, and
the source chip options (derived from loaded rows) are themselves incomplete.

## User Story

As a trader triaging the ranked opportunity queue, I want the min-conviction floor, source and
action filters, and the sort to be evaluated by the server across my whole queue, so that what I
see (and page through) is the authoritative filtered/sorted result rather than a client-side
approximation over whichever pages happen to be loaded.

## Functional Requirements

FR-1. `analysis.ListOpportunities` **applies the `min_conviction` floor server-side** as the sole
authoritative floor. The UI stops hard-coding `0` and sends the slider value. The muted/`denied` and
`data-unavailable`/`unavailable` provenance exemptions from the floor are **preserved** (a muted or
unavailable row is never hidden by raising the slider) — at the DB read layer, which is now the only
place the floor is applied.

FR-2. `analysis.ListOpportunities` **applies a source filter server-side**: the request carries zero
or more source names; when non-empty, only rows whose derived primary source
(`_primary_source(provenance)`) is in the set are returned. An empty set means "all sources". The
match reproduces the `_primary_source` derivation (real signal source, marker tokens like
`position`/`watchlist`/`denied`/`unavailable` excluded).

FR-3. `analysis.ListOpportunities` **applies an action filter server-side**: the request carries an
`OpportunityActionTag` selector; `..._UNSPECIFIED` (the zero value) means "any action", and a
specific value (`ENTER`/`ADD`/`REDUCE`) returns only rows with that `action`. A specific action
filter excludes muted placeholder rows (action `UNSPECIFIED`), matching today's client behavior.

FR-4. `analysis.ListOpportunities` **applies the sort server-side**, selected by a request enum:
`CONVICTION` (default / `UNSPECIFIED`) = the existing rank ordering, `EXPIRY` = soonest
`valid_until` first. Under **both** sorts the feature-187 symbol grouping is preserved: rows for one
symbol stay contiguous, and the symbol group is positioned by its **best-ranked** member
(conviction sort) or its **soonest-expiring** member (expiry sort). Rows with no `valid_until` sort
last under EXPIRY.

FR-5. `ListOpportunitiesResponse` carries a new **`available_sources`** facet: the distinct set of
derived primary sources present in the user's **full, unfiltered, valid** queue (independent of the
`min_conviction`/`source`/`action`/`sort` request params), so the UI's source chips are complete and
stable regardless of which filters are active or how far the user has paged. Marker tokens are
excluded (same derivation as FR-2). It is populated on every page of the response (or at minimum
page 0; the UI reads page 0).

FR-6. Pagination stays correct end-to-end: the filtered/sorted result set is what is offset-paged, so
`next_page_token` and "Load more" traverse the server-authoritative filtered/sorted list. The
response-level `computing`/`compute_failed` cold-read semantics (feature 185) are unchanged.

FR-7. The UI renders directly from the server result — it no longer re-filters or re-sorts in memory.
The min-conviction slider value, active sources, action filter, and sort key become **request
inputs** (part of the React Query key so an in-place `refetchInterval` refetch and a filter change
both re-fetch), not post-fetch transforms. The min-conviction slider retains its localStorage
persistence.

## Out of Scope

- Any change to how the queue is **computed/materialized** (`_compute_opportunities`, the Universe
  resolution, ranking math, live enrichment). This feature only changes the **read/return** path
  (`ListOpportunities` + `OpportunitiesRepository.read`) and the UI.
- New sort keys beyond conviction/expiry, or new filter dimensions (e.g. strategy, provenance
  marker) beyond the four named controls.
- Faceting for anything other than source (no action/count facets).
- Any migration or new column — source/action/expiry all filter over existing columns/JSONB.
- Mobile layout changes beyond passing the same server-driven rows into the existing
  `SectionRenderer` path.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — additive fields on `ListOpportunitiesRequest` (source filter, action filter,
  sort enum) and `ListOpportunitiesResponse` (`available_sources`), plus a new `OpportunitySort`
  enum.
- `xstockstrat-analysis` — `ListOpportunities` handler + `OpportunitiesRepository.read` (SQL filter,
  ORDER BY selection, facet aggregate).
- `xstockstrat-ui` — `insights/opportunities/page.tsx`, `hooks/useOpportunities.ts` (send params,
  drop in-memory filter/sort, read `available_sources`), `insightsBff.ts` is a pass-through forward
  (no logic change expected).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/insights` (the `insights/opportunities` page, reached from
  the **Decide** nav group). The four controls become server-driven; the source chip list is fed by
  the new `available_sources` facet. Reachable per C-10 (route already registered).
- [ ] **Agent** — no MCP tool change. (`list_opportunities` agent tool is out of scope; it does not
  expose these UI controls today and the story is UI-scoped.)
- [ ] **None**

## Proto Contract Changes

- [x] Additive, non-breaking changes to `packages/proto/analysis/v1/analysis.proto`:
  - `ListOpportunitiesRequest`: add `repeated string sources = 3;`, `OpportunityActionTag
    action_filter = 4;` (UNSPECIFIED = any), `OpportunitySort sort = 5;` (new enum, UNSPECIFIED =
    CONVICTION). (`min_conviction` field 2 already exists.)
  - New `enum OpportunitySort { OPPORTUNITY_SORT_UNSPECIFIED = 0; OPPORTUNITY_SORT_CONVICTION = 1;
    OPPORTUNITY_SORT_EXPIRY = 2; }` (closed set → enum, `_UNSPECIFIED=0` sentinel, per governance).
  - `ListOpportunitiesResponse`: add `repeated string available_sources = 5;` (fields 1–4 already
    used).
  - No field removals, renames, or type changes → `buf breaking` clean.

## Config Key Changes

- [x] No new config keys. (`analysis.opportunity.signal_rank_weight` still governs the CONVICTION
  rank; no new tunable is introduced.)

## Database Changes

- [x] No schema changes. Source filter and facet read `analysis.opportunities.provenance` (JSONB);
  action filter reads `analysis.opportunities.action`; expiry sort reads `valid_until`. All exist.

## Feature Workflow Notes

Branch to create: `feature/opportunities-server-side-filters` (branch from `main-dev`).
_Harness note: this session develops on `claude/opportunities-server-side-filters-ug9u95` per the
assigned branch; SDD artifacts + code land there and PR into `main-dev`._

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — non-breaking proto change (Proto Reviewer + `xstockstrat-analysis`
  owner) + `xstockstrat-ui` owner for the consumer surface.
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, additive only.
- [ ] DBA review + service owner (schema migration) — N/A, no migration.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Source facet source of truth** — RESOLVED (operator, 2026-09-15): server returns
  `available_sources` computed over the full unfiltered valid queue (FR-5), not client-derived.
- [x] **Expiry sort vs. symbol grouping** — RESOLVED (operator, 2026-09-15): preserve symbol
  grouping; group positioned by its soonest-expiring member under EXPIRY (FR-4).
- [x] **Scope** — RESOLVED (operator, 2026-09-15): all four controls move server-side; full SDD.

### Known traps (from the Ledger — design/review must address)

- **`fails.md:1547` (muted-row "vanish" bug)** — a floor/filter applied at one layer while another
  layer applies its own silently re-introduces the vanish bug. The min-conviction floor is moving to
  be applied **only** at the DB read; the muted/`denied` + `unavailable` exemptions must be preserved
  **there** and the UI must stop applying its own floor. Grep every layer (UI + BFF + DB) for a
  residual floor/filter (P-05, C-01 family).
- **`fails.md:577` ("already supports" ≠ actually consumed)** — `min_conviction` is on the proto
  message *and* read by `OpportunitiesRepository.read`, but the UI passes `0`, so it is a de-facto
  no-op today. The new `sources`/`action_filter`/`sort` fields must be **consumed by the handler +
  SQL**, verified by a test that fails if the field is accepted-but-ignored — not merely present on
  the message.
- **`fails.md:1648` (mount-persistent state vs in-place refetch)** — moving filters into the query
  key: a RED test for "filter change re-fetches" must keep the component **mounted** (an in-place
  `refetchInterval`/param change), never `page.reload()` which remounts and resets state.
- **`fails.md:1780` (inspect the RPC read/return path, not just compute)** — this feature touches
  only the read path; verify pagination defaults, the facet, and the ORDER BY all on the return path.
