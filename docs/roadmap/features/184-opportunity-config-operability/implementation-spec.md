# Implementation Spec: opportunity-config-operability

**Status**: `pending`
**Created**: 2026-09-07
**Feature**: `docs/roadmap/features/184-opportunity-config-operability/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/opportunity-config-operability`

---

## Execution Summary

A **config-only** feature (design.md § Chosen Approach): `xstockstrat-analysis` stays **docs-only**
(the 15 `analysis.opportunity.*` getters already exist), there is **no proto change**, **no schema
change**, and **no analysis runtime-behavior change**. Implementation order:

1. **Migration 028** seeds all 15 `analysis.opportunity.*` keys as global rows (staging + production)
   at their current code defaults — a no-runtime-behavior-change registration (FR-1, FR-3).
2. **Bounds registry** grows the existing `SCALAR_BOUNDS_REGISTRY` by 10 data-only entries for the
   justified footgun keys — no new code path (FR-2), immediately followed by its paired bounds test.
3. **config-ui e2e fixture + coverage** proves the registered+bounded keys surface in the generic
   `analysis` namespace editor (FR-4, C-14 consumer surface) — **zero UI component code**.
4. **Docs reconciliation** drops the "no-seed" notes on the seeded opportunity rows and adds the
   config-governance registered-keys log entry (FR-5), in this same PR.

**Consumer surface (C-14).** The named surface is `/config-ui`'s `analysis` namespace editor. Design
§ and recon.md:52-56 confirm the editor is **fully generic** (`NamespaceEditor.tsx:69` renders exactly
the `ListKeys` rows, no per-namespace allow-list; the bounds hint at `:158-162` and description column
at `:181-183` are generic). So the surface is reached with **no component code** — a seeded + bounded
key surfaces automatically. Step 4 is the C-14/C-12 evidence step (e2e fixture + assertion), not a
component change. This was a deliberate design decision (design.md § 3 config-ui), not an omission.

## Scenario Coverage (Constitution C-15)

Every `@AC-*` in `acceptance.feature` maps to a covering step:

| Scenario | Covered by | Mechanism |
|---|---|---|
| `@AC-1` (per-env seed rows, full-dotted key) | Step 1 | offline SQL inspection |
| `@AC-2` (seeded at code default, getter-matching value_type) | Step 1 | offline SQL inspection |
| `@AC-3` (no runtime behavior change) | Step 1 | seeded value == code default, by inspection |
| `@AC-4` (out-of-bounds write rejected INVALID_ARGUMENT) | Step 3 | `setConfigScalarBounds.test.ts` |
| `@AC-5` (in-bounds write accepted without create_key) | Step 3 | `setConfigScalarBounds.test.ts` |
| `@AC-6` (keys visible + bounded hint in config-ui) | Step 4 | `api-smoke.spec.ts` e2e |
| `@AC-7` (docs no longer claim no-seed) | Step 5 | doc-state assertion, verified in review |
| `@AC-8` (lower-edge-0 accepted: refresh_hour_utc=0, signal_rank_weight=0) | Step 3 | `setConfigScalarBounds.test.ts` |

AC-1/2/3 (migration) and AC-7 (docs) have no runnable unit test by design (design.md § 3): migration
verification is **offline SQL inspection** (no DB brought up — see the migration-verification rule),
docs is review-verified. Their `**Covers**` lines are carried on the migration and docs steps
respectively so no scenario is left unclaimed.

## Step Dependencies

- Step 3 [test] covers Step 2 [service] — the paired red-before-green bounds test (C-08 / P-06).
- Step 5 [docs] requires Step 1 (cite migration `028`) and Step 2 (cite the new bounds) — write it
  after both land so the citations are accurate.
- Step 4 [test] mirrors the Step 1 defaults and Step 2 bounds in its fixture rows — author it after
  the bound ranges are settled in Step 2.
- **Migration number `028` is provisional / bind-at-rebase** (design.md Open Risks; C-07; ledger
  fails 1699/1702). At execute, reconfirm `max(NNN)+1` for `services/xstockstrat-config/migrations/`
  against `main-dev` — the local tip today is `027_analysis_readiness_materializer_keys` (contiguous
  through 027; `024` is a permanent, harmless gap). Feature 185's own config work, if it merges first,
  shifts this number.
- Steps 1, 2 are otherwise independent (bounds enforce keys regardless of whether a seed row exists —
  recon.md:97).

---

### Step 1 — migration: Seed the 15 analysis.opportunity.* keys (028)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql` — create
- `services/xstockstrat-config/migrations/028_analysis_opportunity_keys.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance; xstockstrat-config owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Migration tip confirmed via `ls services/xstockstrat-config/migrations/` → last file is
  `027_analysis_readiness_materializer_keys.{up,down}.sql`; next-free NNN = `028` (contiguous through
  027; `024` is a pre-existing gap, never backfilled — C-07).
- Seed template `027_analysis_readiness_materializer_keys.up.sql`: INSERT columns
  `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`;
  two rows per key (`'staging',NULL` + `'production',NULL`); full-dotted `key` column stored verbatim;
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- Down template `027_..._keys.down.sql`: `DELETE ... WHERE namespace = 'analysis' AND user_id IS NULL
  AND key IN (...)` — explicit `key IN`, never `LIKE` (so no sibling `analysis.*` key is touched).
- `value_type` DB domain `001_config_tables.up.sql:10` — `CHECK (value_type IN ('string','int','float','bool','json'))`.
- Getter/default/value_type per key confirmed in
  `services/xstockstrat-analysis/app/handlers/servicer.py` (recon.md:32-47) and the analysis
  `CLAUDE.md` Config Keys table (`services/xstockstrat-analysis/CLAUDE.md:322-338`):
  `signal_rank_weight` `get_float` `0.3` → `float`; the other 14 → `int`:
  `empty_recompute_ttl_seconds 30`, `sparkline_bars 20`, `live_enrich_ttl_seconds 10`,
  `max_universe_size 100`, `valid_window_hours 24`, `max_live_strategies_per_symbol 5`,
  `max_live_only_symbols_per_compute 20`, `max_live_held_symbols_per_compute 20`,
  `refresh_hour_utc 0`, `startup_jitter_seconds 30`, `retry_seconds 300`, `snooze_default_hours 24`,
  `max_concurrent_bars_fetches 2`, `max_concurrent_candidates 4`.
- WatchConfig snapshot is `values[row.key]` with no namespace prefix (recon.md:96, ledger insights
  905/907) — the `key` column **must** be the full dotted reader string or the row is a silent orphan.

**TDD**: `N/A (migration — offline SQL verification only; the real apply/rollback runs in CI/deploy)`

**Covers**: `AC-1, AC-2, AC-3` — verified by offline SQL inspection (no DB brought up), per design.md § 3.

**Instructions**:
1. Create `028_analysis_opportunity_keys.up.sql` mirroring `027_...up.sql` verbatim in shape. Header
   comment (≤ the 027 style): state this seeds the 15 `analysis.opportunity.*` keys at their current
   code defaults (no-runtime-behavior change), full-dotted `key` column (WatchConfig `values[row.key]`),
   `value_type` = each getter's storage type.
2. One `INSERT INTO config.config_values (namespace, key, value_type, value_data, description,
   default_value, consuming_service, environment, user_id) VALUES ...` with **two rows per key**
   (`environment='staging', user_id=NULL` and `environment='production', user_id=NULL`),
   `namespace='analysis'`, `consuming_service='xstockstrat-analysis'`. Seed all 15 keys with the
   `value_type` / `value_data` / `default_value` from Codebase Evidence (`value_data` == `default_value`
   == the code default). End with
   `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;` (idempotent — FR-3).
3. `description` per key: reuse the analysis `CLAUDE.md:322-338` wording, condensed. **Design §4 caveats
   are mandatory in the seed descriptions:**
   - `max_concurrent_bars_fetches` and `max_concurrent_candidates`: append **"Takes effect at service
     restart."** (both read once in `AnalysisServicer.__init__`, `servicer.py:413`/`:419` — a live
     config-ui edit is ignored until restart; the generic `NamespaceEditor` renders the description
     column so the caveat is visible).
   - `signal_rank_weight`: append **"0 is not honored — reads as the 0.3 default (get_float)."**
     (`get_float` zero-trap, recon.md:48; the read-path fix is routed to feature 185).
4. Create `028_analysis_opportunity_keys.down.sql` mirroring `027_...down.sql`: single
   `DELETE FROM config.config_values WHERE namespace = 'analysis' AND user_id IS NULL AND key IN (...)`
   listing exactly the 15 full-dotted keys seeded by `.up.sql` (explicit `key IN`, never `LIKE`;
   global rows only, preserving any later per-user override — F-01 / the 027 down convention).
5. Do **not** seed `analysis.compute.max_worker_threads` — it is an `analysis.compute.*` key, not an
   `analysis.opportunity.*` key, and is out of scope (product-spec Out of Scope).

**Verification**:
```
ls services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql \
   services/xstockstrat-config/migrations/028_analysis_opportunity_keys.down.sql
# Then read both and confirm by inspection:
#  - exactly 15 keys × 2 environments = 30 rows in .up.sql, each key full-dotted (analysis.opportunity.<name>)
#  - value_type: 'float' for signal_rank_weight, 'int' for the other 14; value_data == default_value == code default
#  - .up ends with ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING
#  - .down deletes exactly those 15 keys via explicit key IN (...), user_id IS NULL, namespace='analysis'
grep -c "analysis.opportunity." services/xstockstrat-config/migrations/028_analysis_opportunity_keys.up.sql   # expect 30
```
Do **not** bring up a database (offline verification only — the migration-step rule; ledger fails re
v5 executors hanging on containers).

---

### Step 2 — service: Add SCALAR_BOUNDS_REGISTRY entries for the 10 footgun keys

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — bounds registry, config key naming/scoping, WatchConfig stream stability

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` at `configServiceImpl.ts:100-113` — `Record<string, {minValue; maxValue}>`
  keyed on the **full dotted key**; existing entries include the three feature-182 int keys
  (`analysis.readiness_materializer.refresh_hour_utc [0,23]` `:107`,
  `analysis.readiness_materializer.valid_window_hours [1,168]` `:108`,
  `analysis.readiness_materializer.max_concurrent_bars_fetches [1,5]` `:112`) — proves int enforcement
  works today.
- `lookupScalarBounds(namespace, key)` `:118-120` — two-operand probe
  `REGISTRY[key] ?? REGISTRY[`${namespace}.${key}`]`; consumes the registry with **no new code**.
- Write-edge reject `:396-405` — `const n = Number(extractValueData(value)); if (Number.isNaN(n) || n <
  min || n > max) callback({code: 3 /* INVALID_ARGUMENT */, ...})`; `0` survives the parse
  (`extractValueData` handles all oneof shapes, no falsy-zero trap on the write path — recon.md:25).
- ListKeys bounds hint (FR-4, no new code) `:527-533` — `validation: scalarBounds ? {...} : undefined`.
- Bound ranges + per-key lower-bound rule are fixed by design.md § 2 (the justified set of 10) and its
  lower-bound rule (recon.md:94,99): `get_int_present`/`get_float` legitimate-0 keys keep lower `0`;
  `get_int` zero-trap keys use lower `1` (a stored `0` already collapses to the code default on read,
  so `min ≥ 1` documents `0` is intentionally unreachable — read-path `max(1,…)` clamps stay untouched).

**TDD**: `red-green required` (paired test = Step 3).

**Covers**: `—`

**Instructions**:
1. In `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:100`), add **10** entries keyed on the full
   dotted key, exactly the design.md § 2 justified set:

   | Registry key | Bound | Getter | Lower-bound rationale |
   |---|---|---|---|
   | `analysis.opportunity.refresh_hour_utc` | `{ minValue: 0, maxValue: 23 }` | `get_int_present` | lower 0 = midnight is a documented value (PRESERVE `@AC-8 @feature-158`) |
   | `analysis.opportunity.max_concurrent_bars_fetches` | `{ minValue: 1, maxValue: 5 }` | `get_int` | ceiling 5 = marketdata PgBouncer pool size (feature-141 SEV-2 guard); 0 collapses to default |
   | `analysis.opportunity.signal_rank_weight` | `{ minValue: 0, maxValue: 1 }` | `get_float` | weight ∈ [0,1] (FR-2); lower 0 is valid operator intent (the sole `get_float`-zero-trap exception) |
   | `analysis.opportunity.max_universe_size` | `{ minValue: 1, maxValue: 1000 }` | `get_int` | compute-cost cap; 0 collapses to default |
   | `analysis.opportunity.max_live_strategies_per_symbol` | `{ minValue: 1, maxValue: 50 }` | `get_int` | compute-cost cap |
   | `analysis.opportunity.max_live_only_symbols_per_compute` | `{ minValue: 1, maxValue: 500 }` | `get_int` | compute-cost cap |
   | `analysis.opportunity.max_live_held_symbols_per_compute` | `{ minValue: 1, maxValue: 500 }` | `get_int` | compute-cost cap |
   | `analysis.opportunity.max_concurrent_candidates` | `{ minValue: 1, maxValue: 50 }` | `get_int` | concurrency fan-out cap |
   | `analysis.opportunity.sparkline_bars` | `{ minValue: 1, maxValue: 500 }` | `get_int` | per-candidate bar-fetch cost footgun |
   | `analysis.opportunity.valid_window_hours` | `{ minValue: 1, maxValue: 168 }` | `get_int` | mirrors the feature-182 materializer twin `[1,168]` (`:108`) |

2. Do **not** add bounds for the 5 seeded-but-unbounded keys (design.md § 2 "Seeded but UNBOUNDED"):
   `live_enrich_ttl_seconds`, `empty_recompute_ttl_seconds`, `retry_seconds`, `startup_jitter_seconds`,
   `snooze_default_hours` — no documented failure mode; under-bounding is the cheap-to-reverse
   direction, and `retry_seconds`/`startup_jitter_seconds` are shared with the feature-180 materializer
   loop (recon.md:95), so leaving them unbounded constrains neither loop.
3. Add a short 2-line comment above the new block matching the existing feature-182 comment style
   (`:105-106`): cite feature 184 + migration `028` + that bounds are write-edge-only (no read path).
   Do **not** touch `lookupScalarBounds`, the write edge (`:396`), or the ListKeys hint (`:513/:527`) —
   they already consume the registry (data-only growth; recon.md:61, ledger insights 3085-3101).

**Verification**: (runs with Step 3's command block — lint + coverage there)
```
grep -c "analysis.opportunity." services/xstockstrat-config/src/grpc/configServiceImpl.ts   # expect 10 new registry keys
```

---

### Step 3 — test: Bounds enforcement for the analysis.opportunity.* keys

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — bounds registry test coverage

**Codebase Evidence**:
- `setConfigScalarBounds.test.ts` — in-process loopback gRPC harness (real `grpc.Server` +
  `ConfigServiceImpl` + generated client): `before` at `:41-65` (recording pool returns
  `{is_secret:false}` for the existence SELECT so every case reaches the bounds guard as a registered
  key, `:45-47`); `setConfig(value, key)` helper `:72-78` (admin scope `HEADER_ACCESS_SCOPE='7'`,
  `author:'tester'`); `insertQuery()` `:37-39` (an out-of-range value must produce **no** INSERT).
- Feature-182 precedent block `:149-204` — RM key consts `:154-157`, in-bounds accept-without-create_key
  test `:159-171` (AC-5 pattern: reaching `insertQuery()` proves the seeded row satisfies the existence
  gate with no `create_key`), out-of-bounds reject test `:173-195` (asserts
  `err.code === grpc.status.INVALID_ARGUMENT`, `insertQuery() === undefined`, message matches
  `/\[min, max\]/`).
- Config coverage threshold 40% via `pnpm run test:coverage` (`package.json:13` — `c8 ... --lines 40`);
  lint `pnpm run lint` (`package.json:14`).

**TDD**: `red-green required` — authored to FAIL against the pre-Step-2 tree (registry has no
`analysis.opportunity.*` entries yet, so an out-of-range write would be **accepted** and reach the
INSERT), then pass after Step 2.

**Covers**: `AC-4, AC-5, AC-8`

**Instructions**:
1. Add a new block to the existing `describe(...)` in `setConfigScalarBounds.test.ts` (reusing the
   shared `setConfig`/`insertQuery` helpers), mirroring the feature-182 RM block (`:149-204`). Declare
   full-dotted key consts, e.g. `const OPP_REFRESH = 'analysis.opportunity.refresh_hour_utc'`,
   `OPP_CONC = 'analysis.opportunity.max_concurrent_bars_fetches'`,
   `OPP_WEIGHT = 'analysis.opportunity.signal_rank_weight'`,
   `OPP_UNIVERSE = 'analysis.opportunity.max_universe_size'`.
2. **AC-4 (out-of-bounds rejected):** `setConfig({intVal: 10000}, OPP_CONC)` → `err.code ===
   grpc.status.INVALID_ARGUMENT`, message matches `/\[1, 5\]/`, `insertQuery() === undefined`;
   `setConfig({intVal: 99}, OPP_REFRESH)` → rejected `/\[0, 23\]/`;
   `setConfig({floatVal: 1.5}, OPP_WEIGHT)` → rejected `/\[0, 1\]/` (sent as `floatVal` — the agent's
   wire shape and the round-3 fail-open guard, mirroring `:82`).
3. **AC-5 (in-bounds accepted without create_key):** `setConfig({intVal: 50}, OPP_UNIVERSE)` → `err ===
   null` and `insertQuery()` truthy (the request carries no `create_key`; reaching the INSERT against
   the recording pool's registered row proves settability without `create_key`).
4. **AC-8 (legitimate lower-edge 0 accepted):** `setConfig({intVal: 0}, OPP_REFRESH)` → `err === null`,
   `insertQuery()` truthy (0 = midnight); `setConfig({floatVal: 0}, OPP_WEIGHT)` → `err === null`,
   `insertQuery()` truthy (0 within `[0,1]`). This is the C-16 guard the whole lower-bound split rests
   on — a `min ≥ 1` on these two keys would silently make a currently-settable value unsettable.
5. Optionally assert `max_concurrent_bars_fetches=5` (inclusive max) accepted, mirroring `:166`.

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
# confirm the new analysis.opportunity.* bounds cases pass and coverage stays ≥ 40% (c8 --lines 40)
```
Test data is inline gRPC scalars (`{intVal}`/`{floatVal}`), not domain objects — no C-13 fixture home
applies (the existing test uses the same inline convention).

---

### Step 4 — test: config-ui e2e fixture + bound-hint coverage (C-14 / C-12 / FR-4)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — config mutation safety, environment scope correctness

**Codebase Evidence**:
- `CONFIG_KEY_FIXTURES` (`e2e/fixtures/configKeys.ts:44-95`) already carries a bounded analysis row
  `analysis.scoring.signal_decay_half_life_hours` with `validation: { valueType: 2, minValue: 0.0,
  maxValue: 8760 }` (`:86-93`) — the exact template (`valueType 2 == VALUE_TYPE_FLOAT_SCALAR`).
- The mock backend serves these rows generically: `mock-backend.ts:1208-1215` `listKeys()` spreads each
  `CONFIG_KEY_FIXTURES` row (including `validation`) — a new bounded fixture row surfaces automatically.
- Existing FR-4 coverage `api-smoke.spec.ts:224-267` — `validation field in ListKeysResponse` describe:
  the decay-key test (`:225-250`) asserts `validation.valueType === 'VALUE_TYPE_FLOAT_SCALAR'` and
  bounds (note proto3 JSON omits a zero `minValue`, treated as 0, `:244-247`); the non-weight test
  (`:252-266`) asserts a key with no bound has `validation` undefined.
- INVENTORY.md row for `CONFIG_KEY_FIXTURES` at `e2e/fixtures/INVENTORY.md:35` (the "Config key
  ListKeys metadata rows" row) — update when the fixture changes (C-12).
- Config-ui is a **generic** namespace editor (recon.md:52-56): no component code is needed; the
  keys render from `ListKeys` automatically.

**TDD**: `red-green required` — the new `api-smoke.spec.ts` assertions fail against the pre-fixture
tree (the `analysis.opportunity.*` rows are absent from `CONFIG_KEY_FIXTURES`), pass after.

**Covers**: `AC-6`

**Instructions**:
1. In `CONFIG_KEY_FIXTURES` (`configKeys.ts`), add a small representative set of `analysis.opportunity.*`
   rows mirroring the `signal_decay_half_life_hours` row shape (C-12 — do **not** inline literals in the
   spec). Cover the three hint-relevant cases:
   - one bounded **int** key, e.g. `analysis.opportunity.refresh_hour_utc` with
     `validation: { valueType: 2 /* VALUE_TYPE_FLOAT_SCALAR */, minValue: 0, maxValue: 23 }`,
     `defaultValue: '0'` — the ListKeys hint emits `VALUE_TYPE_FLOAT_SCALAR` (`2`) for **every**
     bounded key regardless of int/float (`configServiceImpl.ts:529`), so the int row's `valueType`
     is `2`, identical to the float row's — there is no separate int-scalar enum member;
   - one bounded **float** key, `analysis.opportunity.signal_rank_weight` with
     `validation: { valueType: 2 /* VALUE_TYPE_FLOAT_SCALAR */, minValue: 0, maxValue: 1 }`,
     `defaultValue: '0.3'`;
   - one **unbounded** seeded key, e.g. `analysis.opportunity.snooze_default_hours` (`defaultValue: '24'`,
     **no** `validation` field) — proves a seeded-but-unbounded key surfaces with no hint.
   Set `consumingService: 'xstockstrat-analysis'`, `environment: 1`, `isSecret: false`, and a
   `description` on each (the `NamespaceEditor` renders it). Both bounded rows use `valueType: 2`
   (`VALUE_TYPE_FLOAT_SCALAR`) — `config.proto` `ValueType` (`:80-88`) has no int-scalar member, and
   the service's ListKeys hint (`configServiceImpl.ts:529`) surfaces `VALUE_TYPE_FLOAT_SCALAR` for all
   bounded keys; do not invent a distinct int enum.
2. Update the `INVENTORY.md` `CONFIG_KEY_FIXTURES` row (`:35`) to note the added
   `analysis.opportunity.*` bounded + unbounded rows (feature 184).
3. In `api-smoke.spec.ts` `validation field in ListKeysResponse` describe (`:224`), add assertions to
   the existing `namespace:'analysis'` query (or a new test in that describe): the returned `keys`
   include `analysis.opportunity.refresh_hour_utc` with a `validation` carrying its min/max (AC-6 bounded
   hint), `analysis.opportunity.signal_rank_weight` with `validation.valueType ===
   'VALUE_TYPE_FLOAT_SCALAR'` and bounds `[0,1]` (remember the proto3-JSON zero-omission for `minValue`,
   as `:244-247`), and the unbounded key present with `validation` undefined.
4. **Zero UI component code** — do not touch `NamespaceEditor.tsx` or any `src/` file (design.md § 3;
   the editor is generic).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
pnpm test:e2e -- config-ui/api-smoke.spec.ts
# confirm the analysis.opportunity.* validation-hint assertions pass
grep -n "from '../fixtures'\|configKeys\|CONFIG_KEY_FIXTURES" services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts
# confirm the spec imports fixtures (no inline domain literals); INVENTORY.md updated
```
`xstockstrat-ui` has no coverage threshold (spec-template table) — e2e coverage applies.

---

### Step 5 — docs: Reconcile analysis CLAUDE.md + config-governance registered-keys log (FR-5)

**Status**: `pending`
**Service**: `xstockstrat-analysis` (docs) + `docs/patterns/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `analysis/CLAUDE.md:322-338` — the `analysis.opportunity.*` Config Keys table rows. Confirmed via
  `grep -n "No seed migration\|no-seed pattern\|no config-service seed migration"`: exactly four
  opportunity rows carry a no-seed note — `:333` (`max_concurrent_candidates`), `:335`
  (`sparkline_bars`), `:337` (`empty_recompute_ttl_seconds`), `:338` (`live_enrich_ttl_seconds`).
- **`:334` (`analysis.compute.max_worker_threads`) also carries a "No seed migration" note but is an
  `analysis.compute.*` key, NOT an opportunity key** — it is genuinely still no-seed and its note
  **must be left unchanged** (FR-5 "leave any genuinely still-no-seed rows intact"; ledger fails 1512).
- config-governance registered-keys log: `docs/patterns/config-governance.md:101-104` header
  ("Per-Feature Registered Keys — Append-only log … Newest first"); feature-182 entry `:105-124` is the
  format template (a prose paragraph + a `| Key | Type | Default | Bounds | Notes |` table).

**TDD**: `N/A (docs)`

**Covers**: `AC-7` — verified by doc-state review.

**Instructions**:
1. In `analysis/CLAUDE.md`, for the four opportunity rows at `:333,:335,:337,:338`, **remove** the
   "No seed migration (the `analysis.opportunity.*` no-seed pattern)" / "no config-service seed
   migration" phrasing and replace with a citation of **migration `028_analysis_opportunity_keys`**
   (feature 184), adding the bound where the key is bounded (per Step 2: `sparkline_bars` bounded
   `[1,500]`, `max_concurrent_candidates` bounded `[1,50]`; `empty_recompute_ttl_seconds` and
   `live_enrich_ttl_seconds` are seeded but **unbounded** — say "Seeded by migration `028`; unbounded").
2. For the **other** 11 opportunity rows (`max_universe_size`, `valid_window_hours`,
   `snooze_default_hours`, `signal_rank_weight`, `refresh_hour_utc`, `startup_jitter_seconds`,
   `retry_seconds`, `max_live_strategies_per_symbol`, `max_live_only_symbols_per_compute`,
   `max_live_held_symbols_per_compute`, `max_concurrent_bars_fetches`), append a brief "Seeded by
   migration `028` (feature 184)" + the `SCALAR_BOUNDS_REGISTRY` bound where one was added in Step 2.
   Surgical edits only — do not rewrite the existing per-key descriptions (Behavior 3).
3. Leave `:334` (`analysis.compute.max_worker_threads`) **and** any non-opportunity `analysis.*` no-seed
   note untouched.
4. In `config-governance.md`, add a new **`### feature 184 — opportunity-config-operability
   (`xstockstrat-config` / `xstockstrat-analysis`)`** entry at the top of the Per-Feature Registered
   Keys log (immediately after the header at `:101-104`, newest-first). Mirror the feature-182 entry
   format: a short paragraph (seeds all 15 `analysis.opportunity.*` keys via migration `028` at code
   defaults = no-runtime-behavior change; 10 gain write-side `SCALAR_BOUNDS_REGISTRY` bounds, 5 seeded
   unbounded; the pg_notify visibility caveat — a raw migration INSERT fires no notify, so keys appear
   in config-ui only after a config-service reload) + a `| Key | Type | Default | Bounds | Notes |`
   table listing all 15 keys with the design.md § 2 bounds (or "—" for the 5 unbounded), the
   restart-only caveat on the two `__init__` sem keys, and the `signal_rank_weight` `get_float` zero-trap
   caveat.

**Verification**:
```
grep -n "No seed migration\|no-seed pattern\|no config-service seed migration" services/xstockstrat-analysis/CLAUDE.md
# confirm the 4 opportunity rows no longer carry the note; :334 (analysis.compute.max_worker_threads) STILL does
grep -n "028\|feature 184\|opportunity-config-operability" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
# confirm migration 028 cited in the analysis table and a new feature-184 log entry exists
```
Per the root CLAUDE.md Teardown rule: this step changes context files (`CLAUDE.md`,
config-governance), so run `/context-forge:context-constitution refresh` scoped to the touched docs
before pushing (or the manual equivalent recorded in the PR body if the plugin is unavailable).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
