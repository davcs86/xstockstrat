# Recon: opportunities-server-side-filters

**Created**: 2026-09-15
**From**: product-spec.md
**Affected services**: packages/proto, xstockstrat-analysis, xstockstrat-ui

---

## Objective

Move the Opportunities List page's four controls (min-conviction floor, source multi-select, action
filter, sort) from client-side in-memory post-processing over a paginated infinite query into true
server-side execution in `analysis.ListOpportunities`, and add a server-computed `available_sources`
facet so the source chips stay complete/stable under pagination and active filters. Only the
read/return path and the UI change — the compute/materialization path is untouched.

## Codebase Map

- **`packages/proto`** (protobuf)
  - `ListOpportunitiesRequest` — `packages/proto/analysis/v1/analysis.proto:627-630` (`page=1`,
    `min_conviction=2`; **fields 3,4,5 free**)
  - `ListOpportunitiesResponse` — `analysis.proto:631-640` (`opportunities=1`, `page=2`,
    `computing=3`, `compute_failed=4`; **field 5 free**)
  - `OpportunityActionTag` — `analysis.proto:531-536` (`UNSPECIFIED=0`/`ENTER=1`/`ADD=2`/`REDUCE=3`)
  - No `*Sort`/`order_by` enum precedent anywhere in the proto tree; naming precedent for a closed-set
    enum is `StrategyOperation` (`analysis.proto:365`) / `SignalSourceOperation` (`ingest.proto:180`),
    each `<NAME>_UNSPECIFIED=0`.
  - Codegen: `scripts/buf-gen.sh` → `buf lint` → `buf breaking --against main-dev` → `buf generate`
    (Go+TS) → grpcio-tools (Python `gen/python`) → `pnpm --filter @xstockstrat/proto run build`
    (TS→JS). Verify empty `git diff packages/proto/gen/`.

- **`xstockstrat-analysis`** (Python, gRPC 50056)
  - Handler `ListOpportunities` — `services/xstockstrat-analysis/app/handlers/servicer.py:3368`
  - Repo `read` call sites: **fresh** `servicer.py:3397`, **stale/serve-expired** `servicer.py:3441`
    (both must receive the new args)
  - Offset pagination — `servicer.py:3463-3470`; response assembly (add facet here) — `:3475-3480`
  - `_primary_source(provenance)` — `servicer.py:4921-4926`: returns the first provenance token **not
    in `("watchlist","position","denied")`**. NOTE: `"unavailable"` is **not** skipped, so a row
    whose provenance leads with `unavailable` yields source `"unavailable"` today. The SQL source
    filter + facet must replicate this exact 3-token skip-list to keep parity with `Opportunity.source`.
  - `_row_to_opportunity` — `servicer.py:4931` (`muted`=`"denied"∈provenance`, `data_unavailable`=
    `"unavailable"∈provenance`)
  - Repo `OpportunitiesRepository.read` — `services/xstockstrat-analysis/app/repositories/opportunities.py:120`
    - Floor + exemptions — `opportunities.py:153`:
      `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable')`
    - Feature-187 window-function symbol grouping ORDER BY — `opportunities.py:164-170`
    - SELECT cols — `opportunities.py:140-142` (no `source` column — derived)
  - Table columns — `services/xstockstrat-analysis/migrations/011_opportunities.up.sql:8-22`
    (`action` SMALLINT, `conviction`/`signal_axis` DOUBLE, `provenance` JSONB, `valid_until`/
    `computed_at` TIMESTAMPTZ; **no `source` column**). **Last migration is not touched — no new one.**
  - Config read: `analysis.opportunity.signal_rank_weight` via `self._cfg.get_float(...)` —
    `servicer.py:3396` (reused, not new)
  - Tests: in-memory `_FakeOppRepo` — `tests/test_analysis_servicer.py:4030` (its `read` mirrors the
    SQL floor/exemptions + grouping); `_materialized_svc` wiring — `:4265`; seed-and-assert exemplar
    (grouping+pagination) — `:5462-5515`; default-page-size test — `:5517`; `Opportunity`
    descriptor-parity guard `TestOpportunityRowParity` — `:5780-5820` (**pins `Opportunity` only** —
    a Response-level facet does NOT trip it).

- **`xstockstrat-ui`** (Next.js, HTTP 3000)
  - Hook `useOpportunities` — `services/xstockstrat-ui/src/hooks/useOpportunities.ts:19-34`
    (`queryKey: ['opportunities', minConviction]`, hard-codes `minConviction`+`pageSize:50`,
    `refetchInterval:15_000`, `getNextPageParam` stops on computing/failed)
  - Page controls — `src/app/insights/opportunities/page.tsx`: state `:96-99`; `MIN_CONVICTION_KEY`
    localStorage `:44`,`:105-120`; `sources` derived-from-loaded-rows `:122-125`; `effectiveSources`
    (selection ∩ present) `:129-132`; in-memory filter+sort `rows` useMemo `:134-154`; chip
    `ToggleGroup` `:212-236`; action `Select` `:238-248`; sort `Select` `:249-257`; slider `:260-274`
  - Browser client `analysisClient` — `src/lib/browserClients/analysisClient.ts:5-6`
    (`makeBrowserTransport('/insights/api')`)
  - BFF `insightsBff.ts:54-56` — `listOpportunities: forward(...)` **pure pass-through**, no transform
  - E2E mock `ListOpportunities` — `e2e/mock-backend.ts:828-841` (reads only `minConviction`; no
    paging/source/action/sort — must be extended to honor the new fields + emit `available_sources`)
  - E2E specs — `e2e/insights/opportunities.spec.ts`: source-chip narrows `:83-87` (no reload),
    slider floor `:102-108` (no reload), snooze/dismiss use `page.reload()` `:117`,`:125`; the
    in-place-refetch spec `:162-185` (avoids reload deliberately)
  - Fixtures — `e2e/fixtures/opportunities.ts:54-226` (`OPPORTUNITIES`; sources present:
    `unusual_whales`, `marketwatch`, `dividendology`, `watchlist`, plus empty-source muted/live rows);
    INVENTORY row `e2e/fixtures/INVENTORY.md:28`

## Patterns to REUSE

- **New request fields** → additive proto fields on the existing `ListOpportunitiesRequest`, reusing
  the existing `OpportunityActionTag` enum for `action_filter` (`analysis.proto:531`) — do not mint a
  new action enum.
- **Sort enum** → new `OpportunitySort` mirroring the `<NAME>_UNSPECIFIED=0` closed-set convention of
  `StrategyOperation`/`SignalSourceOperation`; `UNSPECIFIED`≡`CONVICTION` (back-compat default,
  exactly like `ReadinessRule` UNSPECIFIED≡ENTRY at `analysis.proto:643-647`).
- **Source-derivation parity** → replicate `_primary_source`'s 3-token skip-list (`servicer.py:4926`)
  in the SQL for both the source filter and the facet — one canonical skip-set, not two.
- **Floor exemption** → keep the existing `OR provenance ? 'denied' OR provenance ? 'unavailable'`
  clause (`opportunities.py:153`) as the SOLE floor; the UI drops its own floor (fails.md:1547).
- **Sort branching in SQL** → parameterize the existing window-function ORDER BY
  (`opportunities.py:164-170`); for EXPIRY swap the group-positioning key to
  `MIN(valid_until) OVER (PARTITION BY symbol) ASC NULLS LAST` and keep `opportunity_key ASC` as the
  paging tiebreak (preserves `@AC-8 @feature-185`).
- **Facet method** → add one repo method alongside `queue_share`/`taken_count`
  (`opportunities.py:211,233`) that unnests `provenance` over the user's valid, disposition-filtered
  queue and applies the skip-list — same asyncpg pool, no new pool (F-06).
- **Query-key + params** → thread all four controls into the `useOpportunities` args AND the
  `queryKey` so an in-place refetch (`refetchInterval`) and a filter change both re-fetch
  (fails.md:1648).
- **UI state primitives** → keep `EmptyState`/`Skeleton`/`QueryStateMessages` (C-17); keep
  `effectiveSources` = active selection ∩ `available_sources` (preserves the vanished-source
  no-strand behavior of `@AC-12 @feature-155`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-9 @feature-155` "Opportunities groups signals by symbol"
  (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — the durable
  symbol-grouping guarantee (the code calls it "feature 187"); server sort must not break grouping.
- **EXTEND** `@AC-11 @feature-155` "Selecting a source filter narrows the queue" (same file) — the
  observable outcome (only the selected source's rows remain) is preserved; execution relocates
  client→server. EXTEND, not CHANGE, because the outcome is unchanged (see Risks — sign-off note).
- **EXTEND** `@AC-12 @feature-155` "A vanished source does not strand the queue" (same file) — the new
  `available_sources` facet is the server-side home for this; preserved by keeping the client
  `effectiveSources = selection ∩ available_sources` intersection.
- **PRESERVE** `@AC-10 @feature-155` "shows the strategy, source, and expiry tags" (same file) — the
  source chip/provenance display survives.
- **PRESERVE** `@AC-3 @feature-185` "Decide queue renders the unavailable state explicitly"
  (`xstockstrat-ui/acceptance/opportunity-compute-robustness.feature`) — the server floor must exempt
  data-unavailable rows.
- **PRESERVE** `@AC-1/@AC-2/@AC-5 @feature-185` (`xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`)
  — data-unavailable sentinel stays distinct, floor-exempt, and survives the read.
- **PRESERVE** `@AC-8 @feature-185` "self-heals via surgical read-time recompute" (same file) — the
  `opportunity_key ASC` paging tiebreak the server sort must keep under both sort modes.
- **PRESERVE** `@AC-6 @feature-185` "cold read non-blocking, distinct from empty universe" (same file)
  — a floor/filter-emptied page must not be conflated with the cold `computing`/empty-universe state.
- **PRESERVE** `@AC-14 @feature-095` "live quote is presentation-only, never enters ranking"
  (`xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — sort/rank stay
  deterministic, independent of the live quote.
- **PRESERVE** `@AC-4/@AC-5 @feature-177` (`xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`)
  — empty-universe no per-poll recompute; warm reads skip live enrichment; the read-query change must
  not disturb either.

## Dependencies

- Proto/RPC: additive `ListOpportunitiesRequest.{sources=3, action_filter=4, sort=5}` +
  `ListOpportunitiesResponse.available_sources=5` + new `enum OpportunitySort` in
  `packages/proto/analysis/v1/analysis.proto`. Non-breaking (`buf breaking` clean).
- Migration: **none** — all filter/sort/facet columns exist (`011_opportunities.up.sql`).
- Config keys: **none** new (`analysis.opportunity.signal_rank_weight` reused).
- Inter-service edges: none new (UI → insightsBff `forward` → analysis gRPC, existing).
- New env vars / ports: none.

## Risks / Not-found

- **fails.md:1547 (muted "vanish")** — the floor must be applied at exactly one layer (DB) with the
  exemptions preserved there, and the UI floor removed. Grep every layer for a residual floor.
- **fails.md:577 ("already supports" ≠ consumed)** — `min_conviction` is already read by `read()` but
  the UI passes `0`; the new fields must be provably consumed (tests that fail if accepted-but-ignored).
- **fails.md:1648 (mount-state vs in-place refetch)** — the RED for "filter change refetches" must keep
  the component mounted (no `page.reload()`).
- **C-16 blind spot** — the **muted/denied** floor exemption has NO durable `@AC` (only the
  data-unavailable half is covered by feature-185). This feature authors it as `@AC-2` in its own
  `acceptance.feature` — the design-adversary otherwise has no scenario to enforce it.
- **C-16 EXTEND vs CHANGE** — `@AC-11`/`@AC-12 @feature-155` are authored as client-side behaviors;
  relocating them server-side is EXTEND *iff* observable outcomes hold. Design must confirm and, if it
  judges any outcome altered, get user sign-off recorded in `context.md` (defaulted to EXTEND here).
- **Latency guard** (`@AC-1 @feature-183`, 30s BFF deadline) — server-side filter/sort + one facet
  aggregate must stay well under it (SQL filtering returns *fewer* rows than today's full read; low
  risk, confirm in design).
- **`"unavailable"` as a source token** — since `_primary_source` does not skip it, an
  `unavailable`-only-provenance row would surface `"unavailable"` as a selectable chip. Preserve
  current behavior (replicate exactly); flag whether the facet should additionally suppress it
  (design decision — see grilling).

## Recommended Scope (advisory)

1. Proto: additive request/response fields + `OpportunitySort` enum; `buf-gen.sh`; verify empty gen diff.
2. Analysis repo: extend `read(...)` (source filter, action filter, sort branch) + new
   `available_sources(user_id)` method; unit tests (`_FakeOppRepo` parity).
3. Analysis handler: thread `request.{sources,action_filter,sort}` into both `read()` calls + attach
   `available_sources` to the response; servicer tests.
4. UI hook: send all four params, add to query key, expose `available_sources`.
5. UI page: drop the in-memory filter/sort useMemo; feed chips from `available_sources`; keep the
   slider localStorage + `effectiveSources` intersection; render server rows directly.
6. E2E: extend mock `ListOpportunities` to honor request fields + emit facet; update/author specs.
