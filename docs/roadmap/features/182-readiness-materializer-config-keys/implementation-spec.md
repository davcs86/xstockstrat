# Implementation Spec: readiness-materializer-config-keys

**Status**: `pending`
**Created**: 2026-09-06
**Feature**: `docs/roadmap/features/182-readiness-materializer-config-keys/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/readiness-materializer-config-keys`

---

## Execution Summary

Register the four `analysis.readiness_materializer.*` keys as seeded **global** rows for both
environments via a data-only config migration (Step 1), add write-side bounds for the three numeric
tuning keys (Step 2) with a paired config-service test (Step 3), then reconcile the two docs surfaces
(Steps 4–5). Step 1 (migration) and Step 2 (bounds code) are independent and can land in either order;
Step 3 tests Step 2; the docs steps (4–5) close FR-5 and the teardown audit. The whole feature is
**config-service code + a data-only seed + docs** — no proto, no schema change, no analysis code change
(feature 180 already ships the readers).

**Design fork surfaced at spec time (refines design.md Open Risk #1).** design.md's Open Risk #1 asked
only whether `SCALAR_BOUNDS_REGISTRY` enforces **int** values — it does (verified: `configServiceImpl.ts:379-389`
parses via `Number(extractValueData(value))` with no float/int discrimination, and the existing
`setConfigScalarBounds.test.ts:131-147` already exercises the int path against `readiness.stale_after_seconds`).
Discovery found a **different, unanticipated wrinkle**: the registry + `listKeys` + `setConfig` all key
the lookup on `` `${namespace}.${key}` `` where `key` is the SetConfig **request** key (= the DB `key`
column, echoed by config-ui verbatim). The existing two bounded keys (decay, stale) use a
**namespace-stripped** `key` column (`scoring.signal_decay_half_life_hours`), so `` `${namespace}.${key}` `` =
`analysis.scoring...` matches. But **feature 182's keys must use the full-dotted `key` column**
(`analysis.readiness_materializer.enabled`) because the analysis reader looks them up by that exact string
(`watcher.py:90` `values.get(key)`, servicer.py reads `get_bool("analysis.readiness_materializer.enabled")`
— verified 4×). Storing the stripped form would silently orphan the reader (the migration-008 /
migration-019 trap; see Codebase Evidence in Step 1). With the full-dotted `key` column, config-ui's
lookup becomes `analysis.analysis.readiness_materializer.*` (double prefix) and the current registry
would **miss** — bounds would silently not fire. **Chosen resolution (Step 2): make the registry lookup
robust** — check the bare `key` first, then fall back to `` `${namespace}.${key}` `` — in **both** the
`setConfig` write edge and the `listKeys` render-hint path. This lets the three keys register under their
natural full-dotted names, is backward-compatible with the stripped-column keys (they fall through to the
second operand — no regression to decay/stale), and self-documents. Alternatives (double-prefix registry
keys; re-gate to seed-only-`enabled`) are recorded in Step 2. This resolution is within design.md Open
Risk #1's explicit envelope ("the spec adds the minimal type handling") and is flagged for `/sdd-review
<slug> impl-spec` sign-off.

**Consumer surface (C-14).** Product spec marks **UI** (`/config-ui` analysis namespace editor) — reached
with **no UI code change**: the generic `NamespaceEditor` renders any registered key, and its numeric
validation hint reads the `ValidationRule` that `listKeys` emits (Step 2 makes that fire for these keys).
The keys become visible only after a **config-service reload** (a raw migration `INSERT` fires no
`pg_notify`) — i.e. after a config-service restart/deploy or the next analysis-namespace
`SetConfig`-triggered `reloadNamespace` (design Open Risk #4). No new page/route/control, so no
`xstockstrat-ui` step; this is a decision, not an omission. **Agent surface: none.**

## Step Dependencies

- **Step 3 tests Step 2** (config bounds). Both carry `TDD: red-green required`.
- Step 1 (migration) and Step 2 (bounds code) are independent; either order.
- **Migration number 027 is bind-at-rebase** (fails.md:1697, feature-020 scar; 026's own renumber
  comment): 027 is confirmed next-free vs the local tree today (last is `026_analysis_engine_blend_keys`),
  but reconfirm against `origin/main-dev` immediately before execute and renumber to next-free on
  collision; announce in `merge-order.md`.
- **Branch caveat (context.md 2026-09-06):** the standing harness constraint restarts a `claude/*`
  branch from `origin/main-dev` and PRs to `main-dev` rather than a literal `feature/<slug>` branch.
  `buf breaking` is **N/A** (no proto changes).
- **No migration CI gate** (recon Risks): Step 1 verification is **offline SQL read-back only** — never
  bring up a DB in the execute loop. The real apply/rollback runs at deploy.

## Scenario Coverage (Constitution C-15)

- `@AC-1` (registers 4 keys × 2 envs, global, full-dotted `key`) → Step 1
- `@AC-2` (seeded at code defaults, getter-matching `value_type`) → Step 1
- `@AC-3` (no runtime behavior change; materializer stays OFF) → Step 1 (+ Step 3 write-path-only assertion)
- `@AC-4` (idempotent `ON CONFLICT DO NOTHING`; reversible scoped down-delete) → Step 1
- `@AC-5` (admin can enable from config-ui after registration — registered row satisfies existence gate, no `create_key`) → Step 3
- `@AC-6` (docs no longer claim "No seed migration"; governance log records the four; other analysis no-seed rows untouched) → Steps 4 + 5
- `@AC-7` (in-bounds tuning write accepted) → Step 3
- `@AC-8` (out-of-bounds write rejected `INVALID_ARGUMENT`, stored value unchanged) → Step 3
- `@AC-9` (bounds are write-path only, no read path altered) → Step 3

---

### Step 1 — migration: seed the four readiness_materializer keys (027)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/027_analysis_readiness_materializer_keys.up.sql` — create
- `services/xstockstrat-config/migrations/027_analysis_readiness_materializer_keys.down.sql` — create

**Reviewers**: DBA — migration run order + reversibility; xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment/global scoping (reviewer-registry.md rows 22, 48)

**Codebase Evidence**:
- Next-free number: last migration is `026_analysis_engine_blend_keys.{up,down}.sql` → `027` is next
  (`024` is a permanent intentional gap, documented at `026_...up.sql:13-17`). Confirmed via
  `ls services/xstockstrat-config/migrations/ | grep -oE '^[0-9]+' | sort -n | tail` → `…025 026`.
- Seed pattern to mirror **verbatim**: `026_analysis_engine_blend_keys.up.sql:23-38` — INSERT tuple
  `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`,
  one row per environment (`staging`,`production`), global (`user_id NULL`), closing
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. ON CONFLICT target
  confirmed at `017_config_secrets_and_scoping.up.sql:101-102`.
- Down pattern: `026_analysis_engine_blend_keys.down.sql:7-12` — explicit
  `DELETE ... WHERE namespace='analysis' AND key IN (...)`, never a `LIKE` prefix. Design tightens this
  with `AND user_id IS NULL` (preserve any operator per-user override on rollback — design Rejected Alt 4).
- **Full-dotted `key` column is mandatory** (not stripped): the WatchConfig snapshot is keyed by the
  bare DB `row.key` (`configServiceImpl.ts:138` `byKey[k].values[row.key]=...`, `:162`), and the analysis
  reader does an exact-string lookup `self._snapshot.values.get(key)` (`watcher.py:90,98,111,119`) with
  the full-dotted key: `get_bool("analysis.readiness_materializer.enabled",False)` (servicer.py:4173),
  `get_int_present("analysis.readiness_materializer.refresh_hour_utc",0)` (servicer.py:4075),
  `get_int_present("analysis.readiness_materializer.valid_window_hours",24)` (servicer.py:3044,4092),
  `get_int("analysis.readiness_materializer.max_concurrent_bars_fetches",2)` (servicer.py:454).
  Migration 026 uses this same full-dotted form and is the verified-correct precedent; migration 019
  (`scoring.signal_decay_half_life_hours`, stripped) is a **latent reader-orphan masked by
  default==seeded** — the exact trap `026_...up.sql:9-11` warns about for migration 008. **Do not
  replicate the stripped form.**
- Per-key `value_type`/`value_data` = each getter's type and code default (product-spec FR-1):
  `enabled`→`bool`/`false`; `refresh_hour_utc`→`int`/`0`; `valid_window_hours`→`int`/`24`;
  `max_concurrent_bars_fetches`→`int`/`2`. `value_type` CHECK domain is `string|int|float|bool|json`
  (`001_config_tables.up.sql`, per recon). `consuming_service='xstockstrat-analysis'`.
- `max_concurrent_bars_fetches` is read via `get_int` (the zero-trap getter, servicer.py:454) — seeding
  `2` is safe (==default, no zero-trap), but never seed `0` (would collapse to the default `2`;
  insights.md:142, fails.md:1217).

**TDD**: `N/A (migration — data-only seed; offline SQL read-back verification, no DB brought up)`

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:
1. Create `027_...up.sql` mirroring `026_...up.sql` structure: a header comment (mirror 026's) noting
   this **supersedes feature 180's no-seed/no-bounds** registration of the same four keys, the full-dotted
   `key` requirement, and the getter-per-key. One `INSERT INTO config.config_values
   (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`
   with **8 VALUES rows** = 4 keys × {`staging`,`production`}:
   - `('analysis','analysis.readiness_materializer.enabled','bool','false', <description>, 'false','xstockstrat-analysis','staging'|'production', NULL)`
   - `('analysis','analysis.readiness_materializer.refresh_hour_utc','int','0', <description>, '0', ...)`
   - `('analysis','analysis.readiness_materializer.valid_window_hours','int','24', <description>, '24', ...)`
   - `('analysis','analysis.readiness_materializer.max_concurrent_bars_fetches','int','2', <description>, '2', ...)`
   Populate `description` + `default_value` on every row (mirror 026 — config-ui renders these as the
   label/hint; product-spec Open Question 3 RESOLVED). Reuse the analysis `CLAUDE.md` Config Keys
   descriptions for each key (keep the `max_concurrent_bars_fetches` "never set 0" note). Close with
   `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`.
2. Create `027_...down.sql` mirroring `026_...down.sql`: `DELETE FROM config.config_values WHERE
   namespace='analysis' AND key IN ('analysis.readiness_materializer.enabled',
   'analysis.readiness_materializer.refresh_hour_utc','analysis.readiness_materializer.valid_window_hours',
   'analysis.readiness_materializer.max_concurrent_bars_fetches') AND user_id IS NULL;` — explicit
   key list, global-only scope, never a `LIKE`.

**Verification** (offline, no DB — mirrors the execute-loop HARD CONSTRAINT):
```
ls services/xstockstrat-config/migrations/027_*.up.sql services/xstockstrat-config/migrations/027_*.down.sql
```
Then read both files and confirm by inspection: `.up.sql` has exactly 8 rows (4 keys × 2 envs), every
`key` is the **full-dotted** `analysis.readiness_materializer.*` form, `value_type`/`value_data` match
FR-1 per key, `user_id` is `NULL` on all rows, and it closes with the `ON CONFLICT ... DO NOTHING`
matching `017_...up.sql:101-102` (AC-4 idempotency). Confirm `.down.sql` deletes exactly those four keys,
`user_id IS NULL`, no `LIKE`, and touches no other `analysis.*` key (AC-4 reversibility). Confirm `027`
is still next-free: `ls services/xstockstrat-config/migrations/ | grep -oE '^[0-9]+' | sort -n | tail`.

---

### Step 2 — service: register the three numeric bounds + make the registry lookup robust

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config mutation safety, WatchConfig stream stability, config key naming (reviewer-registry.md rows 22, 49)

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` declared at `configServiceImpl.ts:98-103` (currently two entries:
  `analysis.scoring.signal_decay_half_life_hours` [0,8760], `analysis.readiness.stale_after_seconds`
  [0,86399]). Keyed on the full config path, per its own comment `:96-97`.
- Write-edge enforcement `:379-389`: `const scalarBounds = SCALAR_BOUNDS_REGISTRY[\`${namespace}.${key}\`];`
  then `Number(extractValueData(value))` compared numerically → `INVALID_ARGUMENT` (code 3) on
  NaN/out-of-range. **Type-agnostic** (int works): `extractValueData` reads `int_val ?? intVal ?? ...`
  (`:559-563`); existing `setConfigScalarBounds.test.ts:131-147` proves the int path against a
  `readiness.stale_after_seconds` `intVal` write.
- Render-hint path `listKeys` `:495`: `const scalarBounds = SCALAR_BOUNDS_REGISTRY[\`${call.request.namespace}.${r.key}\`];`
  → emits `validation: { valueType: VALUE_TYPE_FLOAT_SCALAR, minValue, maxValue }` (`:509-515`) that
  config-ui's `NamespaceEditor` reads (`NamespaceEditor.tsx:88` gates numeric validation on
  `VALUE_TYPE_FLOAT_SCALAR`). The `FLOAT_SCALAR` render type is reused for int scalar bounds — consistent
  with feature 177's stale int key; no proto/UI change.
- **Double-prefix problem** (see Execution Summary): with the full-dotted `key` column from Step 1,
  config-ui sends `namespace='analysis'`, `key='analysis.readiness_materializer.*'`, so
  `` `${namespace}.${key}` `` = `analysis.analysis.readiness_materializer.*` — the current lookup would
  miss. Fixed by the robust two-operand lookup below.
- Bound values (design Chosen Approach 2): `refresh_hour_utc` `[0,23]` (UTC wall-clock hour; reader has
  no clamp), `valid_window_hours` `[1,168]` (1h–1 week; reader clamps 1h low side only), and
  `max_concurrent_bars_fetches` `[1,5]` (ceiling = marketdata PgBouncer pool size 5, root CLAUDE.md
  § Connection Pool Budget — guards the feature-141 SEV-2 "out of shared memory"). `enabled` is bool → no bound.

**TDD**: `red-green required` (paired with Step 3)

**Covers**: `—`

**Instructions**:
1. Add three entries to `SCALAR_BOUNDS_REGISTRY` (`:98-103`) under their **natural full-dotted** names:
   - `'analysis.readiness_materializer.refresh_hour_utc': { minValue: 0, maxValue: 23 }`
   - `'analysis.readiness_materializer.valid_window_hours': { minValue: 1, maxValue: 168 }`
   - `'analysis.readiness_materializer.max_concurrent_bars_fetches': { minValue: 1, maxValue: 5 }`
   Add a ≤2-line comment on the concurrency entry stating the ceiling tracks marketdata's PgBouncer
   pool size (feature-141 SEV-2 guard) — a load-bearing constraint (CLAUDE.md comment rule).
2. **Make the lookup robust** at **both** sites so a full-dotted `key` column matches its natural
   registry name while stripped-column keys still resolve via the namespace-prefixed form:
   - `:379` → `const scalarBounds = SCALAR_BOUNDS_REGISTRY[key] ?? SCALAR_BOUNDS_REGISTRY[\`${namespace}.${key}\`];`
   - `:495` → `const scalarBounds = SCALAR_BOUNDS_REGISTRY[r.key] ?? SCALAR_BOUNDS_REGISTRY[\`${call.request.namespace}.${r.key}\`];`
   Update the registry's `:96-97` doc comment to record that the lookup tries the bare key first (for a
   full-dotted `key` column, e.g. the readiness_materializer keys) then the `namespace.key` form (for a
   namespace-stripped `key` column, e.g. decay/stale) — ≤2 lines.
   - **Backward-compat:** decay (`key='scoring.signal_decay_half_life_hours'`) → `registry['scoring...']`
     undefined ⇒ falls through to `registry['analysis.scoring...']` (unchanged). No regression.
   - **Alternatives considered (recorded, not chosen):** (A) register the three under double-prefixed
     `analysis.analysis.readiness_materializer.*` names — functional but a footgun contradicting the
     registry comment; (B) re-gate to design's seed-only-`enabled` fallback, dropping FR-6 bounds. Chosen:
     robust lookup (minimal, principled, no regression).

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint
```
Plus the paired Step 3 (`pnpm run test:coverage`). Confirm `grep -n "readiness_materializer" src/grpc/configServiceImpl.ts`
shows the three new registry entries, and `grep -n "SCALAR_BOUNDS_REGISTRY\[" src/grpc/configServiceImpl.ts`
shows the two-operand `?? ` lookup at both the setConfig (`:~379`) and listKeys (`:~495`) sites.

---

### Step 3 — test: config bounds + registration acceptance for the readiness_materializer keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — config mutation safety (reviewer-registry.md rows 22, 51)

**Codebase Evidence**:
- Existing in-process loopback gRPC harness in `setConfigScalarBounds.test.ts:41-78` (real `grpc.Server`
  + `ConfigServiceImpl(recordingPool)` + generated `ConfigServiceClient`); recording pool returns
  `{is_secret:false}` for the existence SELECT (`:45-48`) so a write reaches the bounds guard as an
  already-registered key. `setConfig(value, key)` helper `:72-78` sends `namespace='analysis'` +
  `HEADER_ACCESS_SCOPE='7'` (admin, for a global write) and resolves `{err, res}`; `insertQuery()`
  `:37-39` asserts whether the INSERT ran.
- Int-bounds precedent already in-file: `READINESS_KEY='readiness.stale_after_seconds'` block `:129-147`
  (accepts `intVal` in-range, rejects out-of-range `INVALID_ARGUMENT` with no INSERT). Mirror this for
  the three new keys — but send the **full-dotted** `key` (matching Step 1's DB `key` column and the
  robust lookup from Step 2), e.g. `setConfig({intVal:6}, 'analysis.readiness_materializer.refresh_hour_utc')`.
- Node coverage/lint commands (step-constraints.md §B): `pnpm run test:coverage` (c8 `--lines 40`) and
  `pnpm run lint` (eslint); scripts confirmed in `services/xstockstrat-config/package.json`.
- C-13 test data: the assertions use only key-name strings + numeric bounds (the values under test), not
  reusable domain fixtures — single-consumer, inline compliant; no fixture home needed.

**TDD**: `red-green required` — written to fail against the pre-Step-2 tree (the three keys are not yet
in the registry, so out-of-range writes would be accepted / no `INVALID_ARGUMENT`), passing after Step 2.
RED assertions name their `@AC-*`.

**Covers**: `AC-5, AC-7, AC-8, AC-9`

**Instructions**:
Add a `describe('readiness_materializer write-time scalar bounds', …)` block (or extend the existing
suite) reusing the harness, with cases:
1. **`@AC-7` in-bounds accepted:** `setConfig({intVal:6},'analysis.readiness_materializer.refresh_hour_utc')`
   → `err===null` and `insertQuery()` truthy; `setConfig({intVal:5},'analysis.readiness_materializer.max_concurrent_bars_fetches')`
   → accepted; `setConfig({intVal:168},'analysis.readiness_materializer.valid_window_hours')` → accepted
   (inclusive max).
2. **`@AC-8` out-of-bounds rejected, nothing written:**
   `setConfig({intVal:10000},'analysis.readiness_materializer.max_concurrent_bars_fetches')` → `err.code===INVALID_ARGUMENT`,
   message matches `/\[1, 5\]/`, `insertQuery()===undefined`; `setConfig({intVal:99},'analysis.readiness_materializer.refresh_hour_utc')`
   → rejected `/\[0, 23\]/`; also assert a below-min (`intVal:0` for concurrency → rejected `/\[1, 5\]/`;
   `intVal:0` for valid_window_hours → rejected `/\[1, 168\]/`).
3. **`@AC-5` registered key settable without create_key:** an in-bounds `setConfig` (case 1) reaching the
   INSERT with the default request (no `create_key`) proves the registered global row satisfies the
   existence gate — assert the INSERT ran and `err===null` (the recording pool's `{is_secret:false}` row
   models the seeded row). Add an explicit assertion/comment tying this to AC-5.
4. **`@AC-9` write-path only (no read path altered):** assert the **unbounded** `enabled` key is
   unaffected — `setConfig({boolVal:true},'analysis.readiness_materializer.enabled')` → `err===null`,
   INSERT ran (no numeric bound applies to a bool). Document in a comment that bounds are a write-edge
   guard only and touch no `WatchConfig`/`GetConfig` read path (the materializer stays OFF at the seeded
   `enabled=false`; no read-path change).

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
```
Confirm the new cases pass and `--lines 40` coverage threshold still holds. Run against the pre-Step-2
tree first (execute TDD gate) to capture the RED failure, then after Step 2 for GREEN.

---

### Step 4 — docs: correct the analysis CLAUDE.md "No seed migration" notes (4 rows only)

**Status**: `pending`
**Service**: `xstockstrat-analysis` (docs only)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: None (reviewer-registry.md row 52 — `docs`)

**Codebase Evidence**:
- The four `analysis.readiness_materializer.*` rows in the `## Config Keys Consumed` table each currently
  end with "No seed migration (the `analysis.*` no-seed pattern)." (`services/xstockstrat-analysis/CLAUDE.md`,
  Config Keys table). The `max_concurrent_bars_fetches` row additionally carries the feature-181 R-F note
  — preserve it.
- The other ~5 `analysis.*`/`analysis.opportunity.*` no-seed rows (`max_concurrent_candidates`,
  `compute.max_worker_threads`, `sparkline_bars`, `opportunity.empty_recompute_ttl_seconds`,
  `opportunity.live_enrich_ttl_seconds`) must keep their "No seed migration" note (product-spec FR-5;
  design docs-reconciliation "surgical — only the four rows"; recon adversary objection 3).

**TDD**: `N/A (docs)`

**Covers**: `AC-6`

**Instructions**:
For **only** the four `analysis.readiness_materializer.*` rows, replace "No seed migration (the
`analysis.*` no-seed pattern)." with a note citing **seed migration `027_analysis_readiness_materializer_keys`**
(and, for the three int keys, the server-enforced bounds added in `configServiceImpl.ts`
`SCALAR_BOUNDS_REGISTRY`: `refresh_hour_utc [0,23]`, `valid_window_hours [1,168]`,
`max_concurrent_bars_fetches [1,5]`). Leave the `enabled` row's getter/default text and every other
`analysis.*` no-seed row unchanged.

**Verification**:
```
grep -n "readiness_materializer" services/xstockstrat-analysis/CLAUDE.md
grep -c "No seed migration" services/xstockstrat-analysis/CLAUDE.md
```
Confirm the four readiness_materializer rows now cite `027` (no "No seed migration" on them) and the
remaining no-seed count matches the untouched sibling rows (design: only the four flipped).

---

### Step 5 — docs: config-governance per-feature registered-keys log entry

**Status**: `pending`
**Service**: `docs` (`xstockstrat-config` governance)
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: None (reviewer-registry.md row 52 — `docs`)

**Codebase Evidence**:
- The `## Per-Feature Registered Keys` log (`docs/patterns/config-governance.md:101`) is append-only,
  newest first (`:103`). Entry format confirmed against feature 180 (`:105-119`), feature 177 (`:121-135`),
  feature 161 (`:216-…`): a `### feature NNN — <slug> (<services>)` heading, a prose paragraph, and a
  key table.
- Feature 180's entry (`:105-119`) already lists these four keys as **no-seed / no-bounds**; feature 182
  **supersedes** that for all four (adds seed migration 027) and adds bounds to the three int keys — record
  as a **new** entry, never a rewrite of 180's (`:103` don't-edit-past-entries rule).

**TDD**: `N/A (docs)`

**Covers**: `AC-6`

**Instructions**:
Add a newest-first entry `### feature 182 — readiness-materializer-config-keys (\`xstockstrat-config\` /
\`xstockstrat-analysis\`)` above the feature-180 entry. Prose: notes it **registers via seed migration
027** the four keys feature 180 declared no-seed (so config-ui can show/toggle them and an operator can
enable the materializer without a raw admin `SetConfig create_key`), all seeded at code defaults
(`enabled=false` ⇒ no runtime behavior change), and adds `SCALAR_BOUNDS_REGISTRY` write-bounds to the
three int keys (with the robust bare-key lookup, Step 2). Include a key table (mirror feature 180's) with
Type/Default/Bounds/Notes per key: `enabled` bool/`false`/— ; `refresh_hour_utc` int/`0`/`[0,23]`;
`valid_window_hours` int/`24`/`[1,168]`; `max_concurrent_bars_fetches` int/`2`/`[1,5]` (ceiling =
marketdata PgBouncer pool size). Note the config-service-reload visibility caveat (raw INSERT fires no
`pg_notify`).

**Verification**:
```
grep -n "feature 182" docs/patterns/config-governance.md
```
Confirm the new entry sits above the feature-180 entry (newest-first) and lists all four keys with their
bounds; confirm the feature-180 entry is unchanged (append-only rule).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
