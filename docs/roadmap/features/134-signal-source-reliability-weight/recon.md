# Recon: signal-source-reliability-weight

**Created**: 2026-08-13
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ui, packages/proto

---

## Objective

Move signal-source reliability from an analysis-owned config blob (`analysis.signals.source_weights`,
consumed only by the Screener) onto the `ingest.SignalSource` definition itself as a first-class
`reliability_weight` field, and apply it when the Opportunities queue (`_compute_opportunities`)
builds each candidate's `signal_axis` ranking input — today built from raw, unweighted
`sig.conviction`.

## Codebase Map

- **`xstockstrat-ingest`** (Python)
  - Entry point: `services/xstockstrat-ingest/app/main.py`
  - `ManageSignalSource` handler: `services/xstockstrat-ingest/app/handlers/servicer.py:1058-1187`
    (dispatch via `_resolve_ss_operation`, `servicer.py:51-62`)
  - `ListSignalSources` handler: `services/xstockstrat-ingest/app/handlers/servicer.py:1004-1042`
  - Repository CRUD: `services/xstockstrat-ingest/app/repositories/signal_sources.py`
    (`insert_source:94-122`, `update_source:125-154`, `validate_config_json:174-218`,
    `get_source:88-91` `SELECT *`, `list_all_sources:43-56` explicit column list)
  - AIP-161 mask constants: `servicer.py:41-48`
    (`_SS_MASKABLE_PATHS = {"display_name","source_type","extractor_module","config_json","credentials_ref"}`,
    `_SS_COLUMN_AUTH_PATHS = {"slug","active"}`)
  - Last migration: `009_signal_dedup_keys.up.sql` (`services/xstockstrat-ingest/migrations/`)
  - `[0.0,1.0]`-range precedent (`conviction`): reject-at-write (`servicer.py:719-727`,
    `INVALID_ARGUMENT`) + DB `CHECK (conviction BETWEEN 0 AND 1)`
    (`migrations/001_newsletter_signals.up.sql:14`) — **not** a silent clamp

- **`xstockstrat-analysis`** (Python)
  - `_compute_opportunities`: `services/xstockstrat-analysis/app/handlers/servicer.py:2083-2242`
  - Signals-merge write site: `servicer.py:2152-2168`, `signal_axis` write at `:2163`
    (`c["signal_axis"] = max(c["signal_axis"], sig.conviction)`)
  - `self._ingest` stub: constructed `servicer.py:132`, channel from `INGEST_ENDPOINT`
    (`main.py:30,63`) — only `QuerySignals` called on it today (`servicer.py:2366,2447`)
  - `analysis.signals.source_weights` read+clamp: `servicer.py:1890-1898`, scoped to `ScreenSymbols`
    only — `_compute_opportunities` never reads this key
  - `scoring.compute_signal_score`/`combine_score`: `app/services/scoring.py:10-42,45-60`; sole live
    callers both in `app/services/screener.py:235-237,456-462`
  - `opportunities.py` persistence: `app/repositories/opportunities.py:56-68` (INSERT),
    `:86,98,112` (SELECT/ORDER BY — reads the stored column, no second computation site)
  - Config-read pattern: `self._cfg.get_str/get_float/get_int` via `ConfigWatcher`

- **`xstockstrat-ui`** (Next.js)
  - Sources page: `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx`
    — weight column (display-only, `:344` `{weights[src.slug] ?? 1.0}`), edit form
    (`formFromSource:152-170`, `FormState:55-68` — **omits weight**)
  - `useSignalSources.ts:12-33` — combines `IngestService.ListSignalSources` +
    `ConfigService.ListKeys('analysis.signals.source_weights')`
  - `useSignalSourceMutations.ts:1-20` (`useManageSignalSource`) — thin generic wrapper, typed off
    the generated client param; already supports arbitrary fields with no hardcoded list
  - BFF: `src/lib/configUiBff.ts:44-47` — plain `forward()` pass-through, no admin gate (unlike
    `SetConfig`)
  - Reusable inline-edit-cell pattern: `src/app/config-ui/[namespace]/NamespaceEditor.tsx:176-278`
    (click-to-edit `Input` + Save/Cancel, `validateFloatMap` range validator `:38-56`)

## Patterns to REUSE

- **Inline-edit table cell** → `NamespaceEditor.tsx:176-278`'s click-to-edit `Input`/Save/Cancel
  pattern + `validateFloatMap` (`:38-56`) for the `[0,1]` range check — reuse verbatim shape for the
  Sources page's weight cell instead of inventing a new UI interaction.
- **AIP-161 masked partial update** → already wired end-to-end (`servicer.py:41-48,1113-1153`
  ingest-side; `page.tsx:229-243` `update_mask.paths` UI-side) — `reliability_weight` is a pure
  additive entry into `_SS_MASKABLE_PATHS` and the `paths` array, not a new mechanism.
- **`[0,1]`-range validation** → `conviction`'s reject-at-write pattern
  (`servicer.py:719-727` + migration `001` `CHECK`) is this service's own established precedent —
  the design debate should weigh this against the config-blob's clamp precedent it's replacing.
- **Fresh-fetch-per-compute-pass** → `_compute_opportunities`'s `_drain_*` helpers
  (`servicer.py:2098-2100,2358-2410`) never cache cross-service reads; the one exception is an
  in-call-only memo (`strategy_defs`, `servicer.py:2183,2244-2258`) scoped to a single invocation.
  A `ListSignalSources`-derived weight map should follow one of these two existing shapes, not a new
  TTL cache (none exists anywhere in this service).

## Dependencies

- Proto/RPC: `ingest.SignalSource` fields 1–11 in use (`ingest.proto:142-156`); field **12** is free,
  no `reserved` block. `ManageSignalSourceRequest.update_mask` (field 4) already supports arbitrary
  maskable paths.
- Migration: next number **`010`** for `services/xstockstrat-ingest/migrations/` (last is
  `009_signal_dedup_keys`). Additive-`ALTER TABLE` template: `migrations/008_signal_source_health.up.sql:7-11`.
- Config keys: no new key — `analysis.signals.source_weights` (existing) is the one FR-4 must
  decide replace-vs-override for.
- Inter-service edges: `xstockstrat-analysis → xstockstrat-ingest` — existing edge, existing stub
  (`servicer.py:132`), reuse for the new `ListSignalSources` call (no new channel).
- New env vars / ports: none.

## Risks / Not-found

- **Not found**: `ListSignalSources` called anywhere in `xstockstrat-analysis` today — confirms
  FR-3's premise exactly.
- **Not found**: a reusable numeric-range-validator helper in `xstockstrat-ingest` (the `conviction`
  precedent is an inline check, not a shared function) — a new `reliability_weight` check would be
  similarly inline unless the design wants to extract a shared helper (scope creep risk — likely not
  worth it for one more field).
- **Not found**: any SignalSource e2e fixture module — data is inline in `e2e/mock-backend.ts:882-923`,
  listed under "Not yet centralized" in `e2e/fixtures/INVENTORY.md:60`. This feature is a second
  consumer of that domain (edit form) → **Constitution C-12 triggers**: a fixture module + catalog
  row is required in the same step that adds e2e coverage, not left inline.
- **Risk — new fork, not in product-spec**: `ingest`'s own `[0,1]`-range precedent (`conviction`)
  rejects at write time; the config blob it's replacing clamps at read time. The design debate must
  pick one for `reliability_weight`, not silently default to either.
- **Risk — new fork, not in product-spec**: `ManageSignalSourceResponse`'s row-construction
  (`servicer.py:1178-1187`) already omits `health`/`last_seen_at`/`last_error`/`signals_fed` (a
  pre-existing gap, unrelated to this feature) — the design must decide whether `reliability_weight`
  is included there (so the UI's post-save state is correct without a refetch) or whether the UI
  relies on `useSignalSourceMutations`'s existing `invalidateQueries` refetch instead.
- **fails.md 2026-08-05 (`signal-source-weighting`, feature 007)**: a `grpcio` version mismatch
  between regenerated proto stubs and `uv.lock` across analysis/indicators/ingest, caught only at
  test-import time. Re-check `uv.lock` in all three Python services after `./scripts/buf-gen.sh`.
- **fails.md 2026-08-05 (`023-position-sizing-engine`)**: `Opportunity.conviction` (ordinal) vs.
  `ExternalSignal.conviction` (cardinal) conflation trap — this feature's `signal_axis` input is
  `ExternalSignal.conviction`, the correct cardinal field; re-confirm explicitly in this design, per
  the ledger's own rule.
- **FR-6 is effectively pre-resolved this session**: `022-signal-time-decay`'s product-spec was
  retargeted (this same session) to explicitly depend on 134 landing first
  (`docs/roadmap/features/merge-order.md`) and multiply its own decay factor into the same
  `signal_axis` expression 134 introduces. This already satisfies FR-6's "defer with a named
  follow-up" branch — the debate should confirm this rather than re-litigate fold-in.

## Recommended Scope

1. **Proto**: add `double reliability_weight = 12;` to `SignalSource` (`ingest.proto`).
2. **Ingest migration `010`**: `ALTER TABLE ingest.signal_sources ADD COLUMN reliability_weight
   DOUBLE PRECISION NOT NULL DEFAULT 1.0`, plus DB `CHECK` if the debate picks reject-at-write.
3. **Ingest servicer**: extend `_SS_MASKABLE_PATHS`, the register/update field-merge logic
   (`servicer.py:1058-1187`), `insert_source`/`update_source` (repository), `list_all_sources`'s
   explicit column list, and the `ManageSignalSourceResponse`/`ListSignalSourcesResponse`
   row-construction — plus the request-time range check (reject or clamp, per debate).
4. **Analysis servicer**: new `ListSignalSources` call (reuse `self._ingest`), applied at
   `servicer.py:2163`'s `signal_axis` expression.
5. **UI**: replace `useSignalSources.ts`'s config-blob-derived `weights` with `reliability_weight`
   read directly off each `SignalSource`; add an inline-edit cell to the weight column (reuse
   `NamespaceEditor.tsx`'s pattern) — decide whether the full edit-form (`formFromSource`) also
   gains the field, or only the inline cell.
6. **Test data**: new `e2e/fixtures/signalSources.ts` fixture + `INVENTORY.md` catalog row (C-12).
7. **FR-4 decision** (replace vs. override `analysis.signals.source_weights`) and the two new forks
   above (reject-vs-clamp; response-construction parity) are the debate's real work — everything
   else above is comparatively mechanical once those are settled.
