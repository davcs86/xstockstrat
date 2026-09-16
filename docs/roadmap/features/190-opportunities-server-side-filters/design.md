# Design: opportunities-server-side-filters

**Created**: 2026-09-15
**Rounds**: 4 (full; termination: approved — no unresolved Floor breach)
**Approved by**: user @ 2026-09-15
**Grounded in**: recon.md

---

## Chosen Approach

Move all four Opportunities controls plus a source facet into `analysis.ListOpportunities`,
changing only the **read/return path** and the UI — the compute/materialize path is untouched
(product-spec Out of Scope). Consumer surface (C-14): the `/insights` opportunities page.

### Proto (additive, non-breaking — `packages/proto/analysis/v1/analysis.proto`)
- `ListOpportunitiesRequest` (fields 3/4/5 free, recon.md Codebase Map): add
  `repeated string sources = 3;`, `OpportunityActionTag action_filter = 4;` (reuse the existing enum
  `analysis.proto:531`), `OpportunitySort sort = 5;`.
- New `enum OpportunitySort { OPPORTUNITY_SORT_UNSPECIFIED = 0; OPPORTUNITY_SORT_CONVICTION = 1;
  OPPORTUNITY_SORT_EXPIRY = 2; }` beside `OpportunityActionTag`, mirroring the `<NAME>_UNSPECIFIED=0`
  closed-set convention (recon.md Patterns to REUSE). **`UNSPECIFIED` preserves the existing
  feature-187 blended-rank default order** `(1-w)·conviction + w·signal_axis` (`opportunities.py:164-170`)
  — it is **not** an alias of `CONVICTION` (O6). `CONVICTION` = **raw** `o.conviction` ordering
  (exact parity with today's client re-sort `page.tsx:147`); `EXPIRY` = soonest `valid_until`.
- `ListOpportunitiesResponse.available_sources = 5;` (field 5 free). Response-level → does **not**
  trip the `Opportunity`-only descriptor-parity guard (`test_analysis_servicer.py:5780`).
- Regenerate via `scripts/buf-gen.sh`; `buf breaking` clean; verify empty `git diff packages/proto/gen/`.

### Analysis repo (`OpportunitiesRepository.read`, `opportunities.py:120`)
- Hoist `_primary_source`'s skip-list (`servicer.py:4926`, currently the inline tuple
  `("watchlist","position","denied")`; note its docstring omits `"denied"`) to a **module constant
  `_PROVENANCE_STRUCTURAL_MARKERS`** — the single canonical skip-set (O9, DRY/C-18).
- Add a `LEFT JOIN LATERAL` deriving the primary source once per row:
  `SELECT elem FROM jsonb_array_elements_text(o.provenance) WITH ORDINALITY t(elem,ord) WHERE elem <> ALL($N::text[]) ORDER BY ord LIMIT 1` — the marker list **bound as a `$N::text[]` param** from
  `_PROVENANCE_STRUCTURAL_MARKERS` (O9 — a bind, not an interpolated `NOT IN` literal; no injection
  surface, single source of truth; `"unavailable"` deliberately **not** a marker, so it stays a
  selectable source in parity with `_primary_source`). `LEFT JOIN … LIMIT 1` never changes cardinality.
- **Source filter (guarded):** `AND (cardinality($S::text[]) = 0 OR ps.elem = ANY($S::text[]))` — an
  empty array means **no predicate** (O2), never `= ANY('{}')`.
- **Action filter:** `AND ($A::int = 0 OR o.action = $A::int)` — compares `o.action` (the
  `OpportunityActionTag` SMALLINT), **not** the disposition enum (`opportunity_actions.action`); muted
  placeholders carry `o.action = 0` so a specific filter drops them, parity with `page.tsx:143`.
- **Floor stays the SOLE floor, unchanged** (`opportunities.py:153`):
  `o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable'`. The muted/denied +
  data-unavailable exemption is **from the min-conviction floor only** — source/action filters apply
  to those rows like any other (O8, operator parity decision 2026-09-15). The UI drops its own floor
  (fails.md:1547).
- **Sort:** the `ORDER BY` fragment is selected from a **constant dict keyed by the sort enum** (no
  interpolation of user input — same safety class as the existing `valid_clause` f-string
  `opportunities.py:137`): `UNSPECIFIED` → today's blended block verbatim; `CONVICTION` →
  `MAX(o.conviction) OVER (PARTITION BY o.symbol) DESC, o.symbol ASC, o.conviction DESC,
  o.opportunity_key ASC`; `EXPIRY` → `MIN(o.valid_until) OVER (PARTITION BY o.symbol) ASC NULLS LAST,
  o.symbol ASC, o.opportunity_key ASC`. **All three keep the symbol-partition group key + the
  `opportunity_key ASC` paging tiebreak** (O6; preserves @AC-9 grouping, @AC-8 paging stability).

### Analysis facet (`available_sources(user_id, *, include_expired)` — new sibling method)
- Beside `queue_share`/`taken_count` (`opportunities.py:211,233`), same asyncpg pool (F-06). One
  `SELECT DISTINCT` using `CROSS JOIN LATERAL` (drops empty-source rows so they never become chips)
  over the user's disposition-filtered queue (same DISMISS + active-SNOOZE drop as `read`), the
  `{valid_clause}` threaded from `include_expired`, reusing the **same** `_PROVENANCE_STRUCTURAL_MARKERS`
  bind. **Takes no `sources`/`action_filter`/`min_conviction` params** — that absence makes the facet
  independent of the request filters *structurally* (O3), which is what makes @AC-12's no-strand
  self-heal safe.

### Analysis handler (`servicer.py:3368`)
- Thread `list(request.sources)`, `request.action_filter`, `request.sort` into **both** `read()` calls
  — fresh `:3397` and stale `:3441`.
- Track the `include_expired` actually served (`False` fresh, `True` on the stale branch). **Only when
  `offset == 0`** call `available_sources(user_id, include_expired=<served value>)` and set
  `available_sources=` on the response (`:3475-3480`); `offset > 0` pages return `[]` (O1, O7). This is
  Option A — chosen over folding the facet into `read()` as a CTE because pagination is in-memory
  list-slicing (`window = rows[offset:offset+page_size]`, `servicer.py:3469`), so `read()` runs in full
  every call; a CTE would run the `DISTINCT` on every page and twice on the stale path, while the
  sibling method gates it to `offset==0` and keeps `read()`'s `list[dict]` contract intact.

### UI (`xstockstrat-ui`)
- `useOpportunities(minConviction, sources, actionFilter, sort)` — all four folded into the `queryKey`
  **and** the request, so an in-place `refetchInterval` refetch and a filter change both re-fetch
  (fails.md:1648); expose page-0 `availableSources`.
- `page.tsx`: delete the in-memory `rows` filter/sort useMemo (`:134-154`) and the derived-from-rows
  `sources` (`:122-125`); render server rows directly via the existing `symbolGroups`. Feed chips from
  `data.pages[0].availableSources` (O1). Keep `effectiveSources = activeSources ∩ availableSources`
  sent as the request `sources` (empty → server no-filter; preserves @AC-12). Keep the slider's
  `MIN_CONVICTION_KEY` localStorage (`:44,105-120`), now driving the server floor (stop hard-coding 0,
  `page.tsx:93`). Replace the "All sources" pill + `ToggleGroup` (`:212-236`) with `DropdownMenu` +
  `DropdownMenuCheckboxItem` (reuse `ui/dropdown-menu.tsx`, present; C-17), **multi-select preserved**,
  trigger label "All sources" / "N sources" with a **unique accessible name** (O5). Action/sort
  `Select`s stay, wired to the enums.
- `insightsBff.ts:54-56` stays a pure `forward` pass-through.

### Verification strategy (matches the repo's existing fake/mock-verified bar — C-18)
No real-Postgres harness exists in `xstockstrat-analysis` (conftest proto-path only; no testcontainers;
`integration-test.sh` dead); the **entire** repo SQL surface (the existing `read()` floor/ORDER BY,
`queue_share`) is fake/mock-verified today. So:
- **Repo SQL-text/bind tests** (extend `test_opportunities_repo.py` AsyncMock pool): empty `sources` ⇒
  no source predicate; action predicate present-only-when-passed; the three `ORDER BY` branches emit
  the correct lead expression; the facet + filter bind the marker array and **assert the bind equals
  `_PROVENANCE_STRUCTURAL_MARKERS`** (O9).
- **Pure-function parity test** for `_primary_source` over the provenance permutation matrix (empty,
  leading structural markers, leading `unavailable`, multi-source, all-structural ⇒ `""`).
- **Servicer boundary spy** (do **not** teach `_FakeOppRepo` the new filter/sort logic — avoids the
  vacuous-green fake divergence): assert the servicer forwards `sources`/`action_filter`/`sort` into
  `repo.read(...)` (O4, fails.md:577) and calls `available_sources` only at `offset==0` with the
  **served** `include_expired` (O7).
- **Vanish-trap test** (O8): pin that the min-conviction floor exemption survives the new SQL (a muted
  and a data-unavailable row survive a raised floor) **and** that an active source filter drops a
  muted row with no real source (client parity), so neither the exemption is broken nor silently
  widened.
- **E2E (Playwright)**: extend `mock-backend.ts:828-841` to honor the three fields + emit
  `available_sources`; re-point the `@AC-11` source-narrows spec from `ToggleGroup` to the dropdown
  (O5); the in-place-refetch RED stays **mounted** (no `page.reload()`, fails.md:1648); chips come from
  the facet (survive pagination); a vanished source doesn't strand the queue.

## Rejected Alternatives

- **`UNSPECIFIED ≡ CONVICTION ≡ raw conviction`** — rejected: would silently change the default server
  order for non-UI callers (the agent `list_opportunities` tool) and break feature-097's OR-G blended
  invariant. `UNSPECIFIED` keeps the legacy blended rank; `CONVICTION` is the explicit raw option the UI
  sends (operator sign-off, no behavior change).
- **Fold the facet into `read()` as a single-snapshot CTE (Option B)** — rejected: `read()` already
  runs in full every RPC (in-memory pagination), so the CTE would run the `DISTINCT` on every page and
  twice on the stale path, and would change `read()`'s `list[dict]` return contract (rippling into
  `_FakeOppRepo` + all existing `read()` tests). The sibling method gated to `offset==0` is strictly
  cheaper and localizes the change.
- **Run `read()` + facet in one transaction snapshot** — rejected: holds a PgBouncer transaction slot
  across two round-trips to close a sub-millisecond, background-only, self-healing race (non-authoritative
  chip data).
- **Introduce a testcontainers / real-Postgres harness for this feature** — rejected on C-18: the whole
  analysis SQL surface is fake-verified; a one-off live-PG harness would exceed the bar and rot.
  Deferred to a named platform follow-up (see Open Risks O10).
- **String-interpolate the marker list into `NOT IN (...)`** — rejected in favor of a `$N::text[]`
  array bind (single source of truth, no quote-escaping/injection surface).
- **Muted/unavailable rows exempt from source/action filters ("always survive")** — rejected by
  operator (2026-09-15): parity with today's client (floor-exempt only) chosen; no C-16 CHANGE.
- **Single-select source** — not chosen: multi-select preserved (proto `repeated string sources`).

## Open Risks

- [ ] **O1** — UI reads the facet from `data.pages[0].availableSources` only (never flat-mapped/last
  page). Target: UI page step.
- [ ] **O2** — empty `sources` ⇒ no source predicate (guard), never `= ANY('{}')`. Target: repo step +
  RED.
- [ ] **O3** — facet method carries no filter params (independence held structurally); seam RED asserts
  it. Target: repo + servicer test steps.
- [ ] **O4** — servicer→repo call-arg RED (forwards `sources`/`action_filter`/`sort`; `available_sources`
  only at `offset==0`) + BFF-forward / E2E end-to-end assertion (fails.md:577). Target: servicer + e2e
  test steps.
- [ ] **O5** — dropdown trigger unique accessible name; re-point `@AC-11` e2e from `ToggleGroup` to the
  dropdown (C-17/C-15). Target: UI page + e2e steps.
- [ ] **O6** — proto comment `UNSPECIFIED = legacy blended rank (not an alias of CONVICTION)`; all three
  `ORDER BY` branches keep the symbol-partition group key + `opportunity_key ASC` tiebreak. Target: proto
  + repo steps.
- [ ] **O7** — the `offset==0` facet call uses the **same** `include_expired` that produced the served
  rows (fresh=`False`, stale=`True`); RED asserts the stale-path arg. Target: servicer + test steps.
- [ ] **O8** — parity: muted/denied + unavailable exempt from the FLOOR only (`opportunities.py:153`
  unchanged), not from source/action filters; vanish-trap test pins both halves. Target: repo + test
  steps.
- [ ] **O9** — hoist the skip-list to `_PROVENANCE_STRUCTURAL_MARKERS`; bind it as `$N::text[]` (`<> ALL`
  / `= ANY`) in both the `read()` LATERAL and the facet; SQL-text test asserts the bind equals the
  constant. Target: repo step + RED.
- [ ] **O10** — record the residual "SQL-text assertion ≠ proof Postgres evaluates the `LATERAL`/`ORDER
  BY` identically at runtime" gap in `docs/roadmap/ledger/fails.md` (durable cross-feature home, P-03)
  and note a **named follow-up** for a shared analysis real-DB test fixture. Target: ledger touch (this
  design phase) + context.md.

## Constitution Rules Touched

- `C-04` — honored: `OpportunitySort` has `OPPORTUNITY_SORT_UNSPECIFIED = 0`; closed set → enum.
- `C-08` / `P-06` — honored: each analysis service step pairs a red-before-green test step; RED
  assertions cite `@AC-*`.
- `C-09` — honored: proto step runs `buf lint` + `buf breaking` + `scripts/buf-gen.sh`, empty gen diff.
- `C-10` — satisfied: no new UI route (existing `/insights/opportunities`); the dropdown reuses an
  existing primitive.
- `C-14` — honored: consumer surface named (`/insights` opportunities page); the four controls + chips
  are the reached surface.
- `C-16` — honored: PRESERVE/EXTEND only, no CHANGE (see below).
- `C-17` — honored: dropdown reuses `ui/dropdown-menu.tsx` + variant, unique accessible name, state via
  `EmptyState`/`Skeleton`/`QueryStateMessages`.
- `C-18` — honored: sibling method over CTE (YAGNI/maintainability), one skip-list constant (DRY), no
  new test toolchain (match the repo bar), least mechanism throughout.
- `F-04` — honored: every path/symbol cited from recon.
- `F-06` — honored: facet reuses the existing asyncpg pool; no new pool.
- `F-07` — N/A: the markers are structural provenance tokens (deployment-time constants in code), not a
  config value; bound as a param, not hardcoded config (the R4 F-07 citation was withdrawn as a
  mis-citation).
- `P-03` — honored: the residual runtime-`LATERAL` gap is recorded (O10), not silently accepted.

## Business Rules Touched (C-16)

- PRESERVE `@AC-9 @feature-155` "groups signals by symbol" — every sort branch keeps the
  symbol-partition group key.
- PRESERVE `@AC-10 @feature-155` "shows the source tag" — source chip/provenance display retained.
- PRESERVE `@AC-8 @feature-185` "surgical heal + `opportunity_key ASC` paging tiebreak" — kept in all
  three ORDER BY branches.
- PRESERVE `@AC-1/@AC-2/@AC-3/@AC-5/@AC-6 @feature-185` — data-unavailable sentinel stays distinct,
  floor-exempt, survives the read; cold/empty distinctness untouched.
- PRESERVE `@AC-14 @feature-095` — live quote presentation-only; sort/rank stay deterministic.
- PRESERVE `@AC-4/@AC-5 @feature-177` — empty-universe no per-poll recompute; warm reads skip
  enrichment; the read-query change doesn't disturb either.
- EXTEND `@AC-11 @feature-155` "source filter narrows the queue" — execution relocates client→server;
  observable outcome (only the selected source's rows remain) preserved.
- EXTEND `@AC-12 @feature-155` "vanished source no-strand" — served by the server `available_sources`
  facet + the client `effectiveSources = selection ∩ availableSources` intersection.
- **No CHANGE** — the muted-rows parity decision (O8), the raw-conviction sort, and `UNSPECIFIED`=legacy
  blended all preserve existing observable behavior; no sign-off-requiring rule change.
- This feature also authors its own `@AC-2` (muted survives a raised floor) — filling the C-16 blind
  spot recon flagged (the muted/denied floor exemption had no durable `@AC`, only the data-unavailable
  half via feature-185).
