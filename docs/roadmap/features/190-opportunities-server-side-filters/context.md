# Context: opportunities-server-side-filters  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Moved all four Opportunities controls (min-conviction, source, action, sort) plus a source-facet from in-memory UI compute into `analysis.ListOpportunities` (additive proto), driving them server-side over the whole materialized queue while leaving the compute/materialize path untouched. It shipped green through the full test suite + e2e, then broke 100% of UI Opportunities loads on staging with an `asyncpg IndeterminateDatatypeError` — the exact fake/mock runtime-SQL gap the design had flagged, realized in production and hotfixed forward pre-promotion.

**Why (irrecoverable rationale)**:
- `UNSPECIFIED` sort was deliberately kept as the legacy blended-rank default, NOT an alias of `CONVICTION`, so the non-UI agent caller's order is unchanged and feature-097's OR-G blended invariant is not broken; `CONVICTION` is the explicit raw-conviction option only the UI sends.
- The facet was built as a separate `available_sources()` sibling method gated to `offset==0`, not a CTE folded into `read()`, because pagination is in-memory list-slicing so `read()` runs in full every RPC — a CTE would run the `DISTINCT` on every page (twice on the stale path) and would break `read()`'s `list[dict]` contract.
- The facet takes no filter params — that structural independence is what makes the `@AC-12` vanished-source self-heal safe.

**Rejected alternatives**:
- `UNSPECIFIED ≡ CONVICTION ≡ raw conviction` — lost: would silently change default server order for the agent tool and break feature-097's blended invariant.
- Facet as single-snapshot CTE in `read()` (Option B) — lost: DISTINCT per page, twice on the stale path, and breaks the `list[dict]` return contract.
- `read()`+facet in one transaction snapshot — lost: holds a PgBouncer transaction slot across two round-trips to close a sub-ms, self-healing, non-authoritative race.
- Per-feature testcontainers / real-PG harness — lost on C-18: the whole analysis SQL surface is fake-verified; a one-off rig would exceed the bar and rot → deferred to a platform follow-up.
- String-interpolated `NOT IN (...)` marker list — lost to a `$N::text[]` bind (single source of truth, no injection surface).
- Muted/unavailable rows "always survive" filters — lost: operator chose client-parity (floor-exempt only), no C-16 CHANGE.

**Scars & gotchas**:
- **Shipped `IndeterminateDatatypeError` on staging (marquee scar)**: `$3` (signal_rank_weight) is referenced ONLY in the sort=0 blended `ORDER BY`; the UI never emits sort=0 (only CONVICTION/EXPIRY, whose fragments omit `$3`), so `$3` was bound-but-unreferenced and Postgres aborted PREPARE for every UI load. The agent tool (always sort=0) kept working, masking it; fake-pool unit tests + JS mock e2e never run a real PREPARE, so it shipped green. Fix: anchor the type unconditionally with `AND $3::double precision IS NOT NULL` in the WHERE clause; regression guard `test_read_every_bound_param_is_referenced_in_every_sort_branch`. (Ledgered.)
- **React #185 (max update depth) in the facet wiring**: the naive `data.pages[0].availableSources` read oscillated (facet feeds the query key but arrives from that query → key change → data undefined → facet `[]` → loop). Fix: hold `availableSources` in component state, hydrated by an effect that returns early while the page-0 facet is `undefined` and writes only on real element-wise change. (Ledgered.)
- **e2e fixture trap**: `'alpaca'` is a standalone CAPR fixture row, NOT an Opportunities-queue provenance source — AC-11 had to be re-pointed to `'dividendology'`→TSLA and the facet test to the 3 real queue sources.
- **Playwright harness**: dev-server cold-compile blew the 10s default; run under `CI=true` (production build, 30s timeouts) with `E2E_PREBUILT=1` to reuse the build across re-runs.

**Permanent deviations**:
- design said the UI reads `data.pages[0].availableSources` directly into the dropdown → shipped a component-state-hydrated-by-effect pattern with in-flight-undefined guard → because the direct read caused the React #185 oscillation.
- design bound `$3` only for the blended sort branch → shipped an unconditional `AND $3::double precision IS NOT NULL` type-anchor → because unreferenced-in-branch `$3` aborts asyncpg PREPARE for CONVICTION/EXPIRY sorts.

**Cross-feature signal**: This is the FIRST realized production failure of the analysis fake/mock runtime-SQL gap logged at fails.md:2253 — it confirms the O10 platform follow-up (shared analysis conftest real-DB fixture) is not theoretical. Ties to the vacuous-green fake family (fails.md:577) and the muted-vanish filter-at-every-layer trap (fails.md:1547). Builds directly on feature-187's landed `useInfiniteQuery` hook + `PARTITION BY o.symbol` grouping window; all three sort branches preserve the symbol-partition group key + `opportunity_key ASC` paging tiebreak.

**Deferred follow-ons**: Named platform follow-up — a shared `xstockstrat-analysis` conftest real-DB fixture (not a per-feature testcontainers rig) so repo SQL is runtime-verified. Now upgraded from "risk" to "realized failure" — should be prioritized.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-16 entries. (The marker-drift-by-construction pattern and the design-caught fake/mock SQL-gap lesson are already covered by fails.md:2253 and were not re-appended.)
**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* candidate — `OpportunitiesRepository.read` builds branch-conditional `ORDER BY` fragments over shared bound params; every bound `$n` MUST be referenced (or type-anchored) in every sort branch or asyncpg PREPARE fails at runtime, and unit/mock tests do not catch it.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 594ea7e.
