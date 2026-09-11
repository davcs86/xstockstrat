# Recon: readiness-materializer-config-keys

**Created**: 2026-09-06
**From**: product-spec.md
**Affected services**: xstockstrat-config (seed migration), xstockstrat-analysis (docs-only), xstockstrat-ui `/config-ui` (renders registered keys, no code change)

---

## Objective

Register the four `analysis.readiness_materializer.*` config keys as seeded global rows (both
environments) via a new config migration, so config-ui shows them and an admin can toggle the
feature-180 readiness materializer without a code change or a raw admin-scoped `SetConfig create_key`.
Seed each at its **current code default** so applying the migration is a no-behavior-change
registration; enabling stays a later operator config-ui action.

## Codebase Map

- **`xstockstrat-config`** (Node.js)
  - Migration home / tooling: `services/xstockstrat-config/migrations/`; applied by golang-migrate
    v4.17.1 via `scripts/db-migrate.sh:4,90` (config-first at `:138`, forward-only `up`), naming
    `NNN_name.{up,down}.sql` required (`scripts/db-migrate.sh:100`).
  - Last migration: `026_analysis_engine_blend_keys.{up,down}.sql` — **027 is next free** (024 is a
    permanent intentional gap, documented at `026_analysis_engine_blend_keys.up.sql:13`).
  - Table schema: `config.config_values` base cols in `001_config_tables.up.sql:6-21`
    (`namespace,key,value_type CHECK(string|int|float|bool|json),value_data,is_secret,description,
    default_value,consuming_service,...`); `user_id`/`value_encrypted` added in
    `017_config_secrets_and_scoping.up.sql:24-26`; scope-unique index / ON CONFLICT target
    `(namespace, key, environment, COALESCE(user_id,''))` at `017_config_secrets_and_scoping.up.sql:101-102`.
  - Snapshot keying: WatchConfig snapshot `values` map is keyed by the bare DB `row.key`
    (`src/grpc/configServiceImpl.ts:138,162`) — so the seeded `key` must equal the **full dotted**
    reader string.
  - Existence gate: a `SetConfig` to an unregistered global key is refused NOT_FOUND unless
    `create_key=true` (config CLAUDE.md § WatchConfig Flow) — seeding the row satisfies the gate.
- **`xstockstrat-analysis`** (Python) — **no code change**; already reads the keys (feature 180):
    `get_bool("analysis.readiness_materializer.enabled",False)` `servicer.py:4173`;
    `get_int_present(".refresh_hour_utc",0)` `:4075`; `get_int_present(".valid_window_hours",24)` `:3044,:4092`;
    `get_int(".max_concurrent_bars_fetches",2)` **(zero-trap getter)** `:454`. Docs to reconcile:
    `services/xstockstrat-analysis/CLAUDE.md` Config Keys table (currently "No seed migration" ×4).
- **`xstockstrat-ui`** (`/config-ui`) — **no code change**; the generic namespace editor renders any
    registered key via `useSetConfig` (`src/app/config-ui/[namespace]/NamespaceEditor.tsx`,
    `hooks/useSetConfig.ts`) and never sends `create_key` (only the unrelated signal-source secret flow
    does, `hooks/useSignalSourceMutations.ts:25`) — hence the seed is required for visibility/edit.

## Patterns to REUSE

- Seed migration → **mirror `026_analysis_engine_blend_keys.up.sql` verbatim**: same INSERT tuple
  `(namespace,key,value_type,value_data,description,default_value,consuming_service,environment,user_id)`
  (`:23-24`), one row per environment (`staging`,`production`), global (`user_id NULL`), closing
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING` (`:38`).
- `.down.sql` → mirror `026_analysis_engine_blend_keys.down.sql:7-12`: explicit
  `DELETE ... WHERE namespace='analysis' AND key IN (<the four full-dotted keys>)` — **never** a `LIKE` prefix.
- Full-dotted `key` column + per-key `value_type` matching the getter (feature-161 decay-key precedent
  did this correctly; the bare `fundsignal.*` staging rows are the counter-example orphan).
- config-ui surfacing of a seed-migrated key → the feature-161 decay-key is the working precedent
  (see Existing Business Rules `@AC-6`/`@AC-7`).

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-6 @FR-5 @feature-161` "the decay half-life key is registered and visible in config-ui with default + description" (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`) — adds the four `analysis.readiness_materializer.*` keys to the same analysis-namespace editor; must not regress the decay key's render.
- **EXTEND** `@AC-7 @FR-5 @feature-161` "a registered config key is settable via set_config without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — the newly-seeded keys become admin-settable the same way (existence gate satisfied by the seed row).
- **PRESERVE** `@AC-3 @feature-181 @feature-180` "a bar-busted watchlist-readiness row is PENDING, never a stale RESOLVED" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — governed by `.{enabled,valid_window_hours,max_concurrent_bars_fetches}`; seeding at code defaults (esp. `enabled=false`) must leave it byte-identical.
- **PRESERVE** `@AC-2 @feature-181` "a data-unavailable readiness row is UNKNOWN, not perpetual PENDING" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — same materializer keys govern the refresh kick; registration must not alter UNKNOWN/recovery-cooldown behavior.

## Dependencies

- Proto/RPC: none.
- Migration: next number **027** for `services/xstockstrat-config/migrations/` (data-only seed into `config.config_values`, no schema change).
- Config keys: `analysis.readiness_materializer.{enabled,refresh_hour_utc,valid_window_hours,max_concurrent_bars_fetches}` — existing code-read keys, newly *registered* (not invented).
- Inter-service edges: none new.
- New env vars / ports: none.
- Logical dependency: feature 180 (the reader + materializer loop) must be on trunk for the registration to be meaningful — it is `code-completed`/merged (feature 181 built on it and merged). Advisory 180→182 ordering only; overlap scan found no blocking merge-order row.

## Risks / Not-found

- **No migration CI gate (from discovery `## Not found`):** `ci.yml` has no migration-freshness/lint/apply
  job; only `promote.yml:95-99` lists new `.up.sql` files in the promotion summary. → A bad migration is
  **not** caught by CI. Execute must self-verify (apply up→down→up against a local/throwaway config DB if
  one is reachable in-sandbox; otherwise a careful column/tuple/type read-back review + note the gap).
- **C-16 silent-CHANGE risk (loud flag from scenario-recon):** the feature is no-behavior-change **only**
  if every seeded value equals the code default — critically `enabled=false`. Seeding `enabled=true`
  (or any value ≠ code default) would silently flip the materializer on and **CHANGE** `@AC-3 @feature-181`
  / `@AC-2 @feature-181`, a C-16 regression requiring explicit user sign-off in `context.md`. Design must
  assert seeded == code defaults.
- **`get_int` zero-trap on `max_concurrent_bars_fetches` (fails.md:1217, insights.md:142):** read via
  `get_int` not `get_int_present` (`servicer.py:454`); seed `int`/`2` is safe (== default) but a future
  operator setting `0` would collapse back to `2`. Document, do not seed `0`.
- **Bounds-registry decision (scenario-recon ambiguity):** the decay key carries `SCALAR_BOUNDS_REGISTRY`
  bounds (`@AC-11/@AC-12 @feature-161`); these four keys have **no** documented bounds. Registering
  without bounds means config-ui renders them with no min/max validation hint (a mild divergence from the
  `@AC-6` decay-key render). Decision for the debate: register bounds now (EXTEND `@AC-11/12`) or defer.
- **Migration-number provisionality (fails.md:1697-1703, feature 020 scar):** 027 is free now, but a
  config-migration feature merging first could take it — treat 027 as provisional until merge; renumber to
  next-free if a collision appears at merge time. (Overlap scan: no in-flight config migration today.)

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`):
1. **Migration 027** — `027_analysis_readiness_materializer_keys.{up,down}.sql` mirroring 026 (4 keys ×
   2 envs, global, code-default values + description + default_value; down = explicit key-IN delete).
2. **Docs reconciliation (analysis)** — flip the four "No seed migration" notes in
   `services/xstockstrat-analysis/CLAUDE.md` Config Keys table to cite migration 027.
3. **Config-governance registered-keys log** — add the four keys under feature 182 in
   `docs/patterns/config-governance.md` § Per-Feature Registered Keys.
4. **Verification** — apply up/down locally if a config DB is reachable; else read-back review; add/adjust
   any acceptance mapping. (No new code, no proto, no schema change.)
