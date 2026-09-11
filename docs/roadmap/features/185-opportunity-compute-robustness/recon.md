# Recon: opportunity-compute-robustness

**Created**: 2026-09-07
**From**: product-spec.md (feature 185)
**Affected services**: xstockstrat-analysis (compute/materialize/persist/read + FR-3 semaphore), packages/proto (additive `Opportunity` field), xstockstrat-ui (`/insights/opportunities` render, C-14), xstockstrat-agent (`list_opportunities` projection, C-14), **xstockstrat-config** (FR-3's new sem key seed + bounds — surfaced by recon, not in the original Affected Services list)

---

## Objective

Give the opportunities compute the two robustness properties the audit found missing vs the watchlist
philosophy: (FR-1) a **terminal data-unavailable sentinel** so a per-symbol bars/indicator fetch failure
surfaces as a distinct "unavailable" state instead of degrading to a misleading `0/0` `_empty_readiness`
row; (FR-2) the `/insights/opportunities` Decide queue renders that state explicitly via C-17 primitives;
(FR-3) a **dedicated background bars-fetch semaphore** so the compute fan-out cannot starve the
interactive read-path enrichment (the feature-176/180 priority-inversion split the readiness materializer
already has). No change to the watchlist readiness paths (180/181/182).

## Codebase Map

### xstockstrat-analysis (`app/handlers/servicer.py` unless noted)
- `_compute_opportunities` def `:3542`; three-phase fan-out `:3820` (Phase 0 def-load, Phase 1 bars, Phase 2 eval).
- **Bars-fetch FAILURE branch caches `[]`** (best-effort per symbol, not retried this pass) `:3837-3847`
  (`except … return sym, []`); benchmark twin `:3851-3857`; per-pass dedup contract comment `:3811-3813`.
- Row build (conviction/readiness_json/signal_axis/provenance/thesis/valid_until) `:3927-3950`.
- `_empty_readiness` — usage `:3883` (compute Phase-2 default) & `:4488`; **definition `app/services/evaluator.py:775-783`** →
  `{symbol, conviction=0.0, passing_conditions=0, total_conditions=0, conditions=[]}` — **NO `bar_epoch`/state field**.
  So the compute-path default cannot distinguish "no bars fetched (failure cached `[]`)" from "genuinely 0/0".
- Readiness UNKNOWN sentinel (the precedent, NOT to be touched): classifier `c["bar_epoch"] < 0` → `READINESS_STATE_UNKNOWN`
  `:2980-2984`; docstring `:2886`; retry cooldown `_READINESS_UNKNOWN_RETRY_SECONDS=300` `:260-263`; writer
  `bar_epoch = -1 if not fetch_ok` `app/services/readiness.py:80-96`; FAST-gate `is_readiness_row_fresh` `readiness.py:16-28`.
- Semaphores: shared `_bars_fetch_sem` from `analysis.opportunity.max_concurrent_bars_fetches` (default 2, `get_int`+`max(1,…)`) at `__init__` `:412-413`;
  call sites — compute fan-out `:3838`/`:3852`/`:3895`, **interactive `_enrich_opportunities_live` `:3444`/`:3458`**, EvaluateReadiness SLOW `bars_sem=self._bars_fetch_sem` `:2826`.
  Isolation precedent `_readiness_materializer_bars_sem` from `analysis.readiness_materializer.max_concurrent_bars_fetches` at `__init__` `:448-456`, used only in the materializer loop `:4144`; sibling `_candidates_sem` `:415-420`.
- `_materialize_opportunities` (cold sync compute under lock, double-checked) `:3514-3521`; `_replace_and_stamp_compute_state` (replace + empty-only stamp) `:3492-3512`.
- Cold `ListOpportunities` RPC `:3327`; cold-vs-stale branch `:3354-3378`; `_kick_opportunity_recompute` (fire-and-forget, `_opportunity_recomputing` guard) `:3523-3540`; `_opportunity_lock` `:3484-3490`; empty-recompute TTL `analysis.opportunity.empty_recompute_ttl_seconds` `get_int_present` `:3503-3510`.
- `_row_to_opportunity` (producer↔reader↔UI contract point, OR-F parity) `:4568-4589`; **`muted` derived at read** `muted=("denied" in provenance)` `:4588`; compute-side marker `_add_provenance(c,"denied")`+`c["muted"]=…` `:3786-3787`; candidate seed `"muted":False`/`"provenance":[]` `:3626-3632`.
- Persistence `app/repositories/opportunities.py`: `replace_for_user` DELETE+`executemany` INSERT, JSONB cols `readiness_json` (`$7::jsonb`) + `provenance` (`$9::jsonb`) `:41-75`; **READ conviction floor `:107` — `AND (o.conviction >= $2 OR o.provenance ? 'denied')`** (denied/muted exempted; an unattributed `conviction=0` row is DROPPED); JSONB decode `:23-32`. Table `migrations/011_opportunities.up.sql:8-22` (no `muted`/`bar_epoch` column). **Highest analysis migration on disk = `023`** (the `026/027/028` cited in CLAUDE.md are *config*-service migrations).

### packages/proto (`analysis/v1/analysis.proto`)
- `Opportunity` message `:549-580`; **highest field `signal_confidence = 19` `:579` → next free = `20`**; message-level comment `:546-548` warns **`conviction`(#3) is a deterministic ordinal, NOT a probability** (fails 313 — do not reuse by name); `signal_confidence`(#19) is the real 0–1 probability, deliberately distinct.
- **`muted = 12` (bool) `:561`** — the additive-flag precedent ("never conviction=0").
- `ReadinessState` enum `:656-661` — `READINESS_STATE_UNSPECIFIED=0` (C-04 ✓), `…RESOLVED=1/PENDING=2/UNKNOWN=3` where **UNKNOWN=3 is the data-unavailable value keyed to `bar_epoch<0`** (on `WatchlistReadinessRow`, not `Opportunity`). `ConditionState` enum `:539-544` (UNSPECIFIED=0/PASS/SOFT/FAIL). `SparklinePoint`/`IndicatorValue` use `optional` for absent = the "unavailable ≠ 0" pattern.
- `ListOpportunitiesResponse.opportunities` carries `Opportunity` **directly** `:627-630` — a new field flows straight through, no row wrapper.
- Codegen: `buf.gen.yaml` (Go/TS via buf; Python via grpcio-tools in `scripts/buf-gen.sh:61-66`); additive field 20 is buf-breaking-safe but all 3 stubs regen+commit (proto-freshness gate).

### xstockstrat-ui
- Queue page `src/app/insights/opportunities/page.tsx:97`; conviction/readiness/action render `:455-511`; **the 0/0 "quiet" fallback to replace: `no conditions` `:509-510`**; `readinessVariant` already has a `'muted'`/`nodata` mapping `:47-58`; `SymbolGroupCard` `:386`, `OpportunityRow` `:442`; mobile `signalGroup` `:203-219`.
- Enum maps `src/lib/opportunityShared.tsx` (`OPPORTUNITY_ACTION` `:28`, `CONDITION_STATE` `:36`, …) + `EnumBadge` `:70` — "adding a proto enum value without a map entry breaks tsc here" `:1-2`. `muted` (bool) renders as inline `<Badge variant="outline">Muted</Badge>` `page.tsx:465` (bool→inline Badge; enum→map entry).
- **Canonical unavailable cell to mirror**: `WatchlistReadiness.tsx:320-328` renders `ReadinessState.UNKNOWN` as `TriangleAlert` + `QueryStateMessages errorText="unavailable"` (`data-testid=readiness-unknown-…`).
- Path is **pure passthrough**: browser `analysisClient.ts:6` (generic typed client) → BFF `insightsBff.ts:54` `forward()` → hook `useOpportunities.ts:16-22` → `page.tsx:99`. A new proto field surfaces automatically; only the render branch must handle it.
- e2e: `e2e/fixtures/opportunities.ts` (`OPPORTUNITIES` `:54`, 0/0 rows `:83/:95`, muted GME `:124`, `READINESS_BUCKET_OVERRIDE.NODATA1={0,0}` `:278`); `INVENTORY.md:28`; mock `e2e/mock-backend.ts:791-797` (filters `muted || conviction>=min`); spec `e2e/insights/opportunities.spec.ts` (`toJson` `:22`, muted-survives-floor `:102`).

### xstockstrat-agent
- `list_opportunities` tool `app/tools.py:1161` → `client.list_opportunities` `app/client.py:792-805` → **hand-projection `_opportunity_to_dict` `:747-789`**. Enums via `.Name()` (string names) `:756/:784`. `muted` = plain bool key `:765`.
- **NO descriptor-parity test for `Opportunity`** — projection already silently omits `valid_until`(9) & `signal_confidence`(19) with no failing test. Behavioral-only test `tests/test_client.py:1084`. Parity templates elsewhere: `test_backtest_view.py:189`, `test_signal_source_projection.py:29`, `test_position_parity.py:49`.

## Patterns to REUSE

- **`muted` additive-flag round-trip (the FR-1 template):** a marker rides `provenance` JSONB, the bool is
  **derived at read** (`servicer.py:4588`), exposed as an additive proto bool (`muted=12`), rendered as an
  inline UI Badge, projected as a bool key in the agent. Mirror this for an `"unavailable"` marker →
  additive `Opportunity` bool (field 20) → **no analysis migration** (rides existing `provenance`/`readiness_json` JSONB). (Alternative: a new enum paralleling `ReadinessState.UNKNOWN` — heavier, C-04 zero-value; a **design fork**.)
- **`_readiness_materializer_bars_sem` (the FR-3 template):** a dedicated `asyncio.Semaphore` built at `__init__`
  from its own config key, explicitly separate from `_bars_fetch_sem` (`servicer.py:448-456`). FR-3 adds an
  analogous sem for the `_compute_opportunities` fan-out (`:3838/:3852`), leaving `_enrich_opportunities_live`
  (`:3444/:3458`) on `_bars_fetch_sem`.
- **Feature-184 config mechanism (for FR-3's key):** seed via a config-service migration (`029`, after 184's `028`)
  + a `SCALAR_BOUNDS_REGISTRY` entry (`configServiceImpl.ts`), reusing 184's `lookupScalarBounds` — the exact
  pattern feature 184 just landed for the 15 `analysis.opportunity.*` keys.
- **`bar_epoch=-1` readiness sentinel semantics (`readiness.py:80-96`)** — the shape of "fetch_ok=False → sentinel"
  and the 300s UNKNOWN retry cooldown (`:260-263`), as the model for FR-1's write + (open question) retry cadence.
- **WatchlistReadiness UNKNOWN cell (`WatchlistReadiness.tsx:320-328`)** — the C-17 render to mirror for FR-2.
- **Agent parity-test templates** (`test_backtest_view.py:189`) — for adding the (currently missing) `Opportunity` projection parity guard.
- C-13 fixtures: extend `e2e/fixtures/opportunities.ts` + `INVENTORY.md:28`; agent/analysis fixtures in their `tests/conftest.py`.

## Existing Business Rules (C-16 — from scenario-recon)

- **PRESERVE** `@AC-14` "Folding in the live quote does not leak look-ahead into ranking" (`services/xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — the additive data-unavailable sentinel is state/presentation-only and must be provably absent from the conviction + readiness ranking hot path, like the live quote.
- **PRESERVE** `@AC-4` "An empty-universe user does not recompute on every poll" (`.../readiness-caching-poll-discipline.feature`) — **CORE C-16**: a data-down symbol surfacing an "unavailable" row (instead of a dropped 0/0) must not corrupt the empty-only compute-state stamping (`_replace_and_stamp_compute_state`) or thrash the ListOpportunities poll loop.
- **PRESERVE** `@AC-5` "Warm reads skip live enrichment when values are fresh" (same suite) — a failed/unavailable fetch must stay **uncached** (success-only memo), never served as a current price.
- **PRESERVE** `@AC-1` / `@AC-2` (feature-177) FAST readiness cache + `bar_epoch` bust — readiness path stays byte-identical.
- **PRESERVE** `@AC-2` (feature-181) readiness `bar_epoch=-1`→UNKNOWN + `@AC-3` bar-busted→PENDING — the FR-1 precedent; 185 must not touch the readiness paths.
- **PRESERVE** `@AC-11` "An unavailable live quote omits the price rather than fabricating it" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — FR-2 keeps omit/em-dash for the live quote (distinct from the whole-row unavailable state).
- **EXTEND** `@AC-4` "Every state icon is paired with text, never icon-only" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — FR-2's "unavailable" state rides the shared state-cue map with **icon AND text**, and must **not silently reclassify** the existing "quiet"/"no data" meaning.
- **PRESERVE** `@AC-3` in-queue marker coding consistency (same suite); `@AC-3` `/insights/opportunities` `staleTime` poll discipline (`readiness-caching-poll-discipline.feature`); `@AC-2` per-row failure degrades one row (`watchlist-readiness-list-ux.feature`) — UI precedent for FR-2 per-row render.
- **PRESERVE** `@AC-15` "The agent list_opportunities tool surfaces enrichment and omits an absent target" (`services/xstockstrat-agent/acceptance/opportunity-live-market-enrichment.feature`) — C-14; the additive field flows through, never fabricated; **may EXTEND** to surface the unavailable state.

**C-16 verdict:** no CHANGE as recon stands → no sign-off required, PROVIDED the design (a) keeps the sentinel out of the ranking hot path and (b) does not redefine what a `0/0`/"quiet"/"no data" row means. Exempting the unavailable sentinel from the read conviction floor (`opportunities.py:107`, like `denied`) is **not** a literal regression (no written rule pins data-down to "quiet"; no durable rollup/conviction-floor guarantee in the affected suites). If the design reclassifies existing 0/0 rows, that becomes a CHANGE needing sign-off.

## Dependencies

- Proto: additive `Opportunity` field #20 (or a new enum) — `buf breaking` safe; regen Go/TS/Python stubs.
- Config (FR-3): a new sem key (`analysis.opportunity.materializer_max_concurrent_bars_fetches` or an
  `analysis.opportunity_materializer.*` shape — **C-05 naming fork**) → config seed migration `029` + `SCALAR_BOUNDS_REGISTRY`
  bound, via 184's mechanism (184 is code-completed on the shared branch). Distinct from 184's interactive
  `analysis.opportunity.max_concurrent_bars_fetches` (overlap scan CLEAN).
- Migration: **no analysis migration** (sentinel rides existing `analysis.opportunities` JSONB). One config
  migration `029` only if FR-3 seeds its key.
- Consumer surfaces (C-14): UI `/insights/opportunities` (passthrough — render only); agent `list_opportunities`
  (hand-projection — must edit `_opportunity_to_dict` + optionally add a parity test).
- No new env var / port / inter-service edge.

## Risks / Not-found

- **Read-floor vanish trap (fails 1547):** `opportunities.py:107` drops a `conviction=0` row unless
  `provenance ? 'denied'`. A data-unavailable row is `conviction=0` — it will **vanish at read** unless the
  sentinel is exempted here (mirror the `denied` exemption). Hard correctness requirement for FR-1.
- **`conviction`-by-name trap (fails 313):** do not reuse `conviction`(#3, an ordinal) as the sentinel carrier.
- **Agent projection drift (fails 1151/308/309):** `Opportunity` has **no** parity test and already omits
  fields; the new field will NOT auto-fail CI. Design must decide (a) project it + add the parity test
  (fixes the drift, honors "surface at every read path", insights 491) or (b) leave it unprojected. **C-14 fork.**
- **Empty-compute-state interaction (CORE C-16, @AC-4):** an unavailable row is a *non-empty* result — verify it
  does not break `_replace_and_stamp_compute_state`'s empty-only stamping / empty-recompute suppression, and does
  not thrash the poll loop.
- **UI state-cue ambiguity (@AC-4 feature-155):** does "unavailable" reuse the existing "no data" cue or is it a
  new state? Must not silently reclassify "quiet". (Design/adversary to resolve.)
- **Sentinel retry semantics (open):** cadence (like readiness's 300s cooldown) vs wait-for-next-recompute —
  avoid a hot retry loop and a stuck-forever row.
- **FR-3 has no C-16 regression guard** — isolation is structural convention only (CLAUDE.md prose); a new AC for FR-3 would be additive, not a regression guard.
- **FR-4 (cold-read non-blocking)** — deferred design option (not a committed FR); decide keep-synchronous vs change.
- **Not-found:** no data-unavailable field/enum on `Opportunity` today; no dedicated opportunity-compute background sem; no agent `Opportunity` parity test.

## Recommended Scope (advisory — input to grilling + /sdd-spec)

1. **proto** — additive data-unavailable representation on `Opportunity` (field #20): design picks **bool derived from a provenance marker (muted-style)** vs **a new enum (ReadinessState.UNKNOWN-style, C-04)**. `buf-gen` all 3 stubs.
2. **analysis (compute/persist)** — on a bars-fetch failure, write the `"unavailable"` marker (mirror `_add_provenance("denied")`) instead of degrading silently; carry through `_materialize_opportunities` JSONB; **exempt it from the read conviction floor** (`opportunities.py:107`); derive the field in `_row_to_opportunity`. Preserve `@AC-14`/`@AC-4`/`@AC-5`.
3. **analysis (FR-3 semaphore)** — a dedicated `asyncio.Semaphore` from a new config key for the `_compute_opportunities` fan-out (`:3838/:3852`); keep `_enrich_opportunities_live` on `_bars_fetch_sem`. Mirror `:448-456`.
4. **config** — seed migration `029` + `SCALAR_BOUNDS_REGISTRY` bound for the new sem key (via 184's mechanism). Paired bounds test.
5. **ui** — render the unavailable state on the queue (mirror `WatchlistReadiness.tsx:320-328`); enum-map entry or inline Badge per the fork; e2e fixture + spec (C-12); icon+text (@AC-4 feature-155).
6. **agent** — project the new field in `_opportunity_to_dict` + add the `Opportunity` descriptor-parity test (template `test_backtest_view.py:189`) — C-14.
7. **(design option) FR-4 cold-read non-blocking** — only if design takes it, with its own `@AC`.
8. **retry semantics** — decide cadence vs next-recompute for a data-unavailable row.
