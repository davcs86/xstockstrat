# Recon: opportunity-config-operability

**Created**: 2026-09-07
**From**: product-spec.md
**Affected services**: xstockstrat-config (migration + bounds registry), xstockstrat-analysis (docs only), xstockstrat-ui /config-ui (C-14 surface, no code)

---

## Objective

Register the 15 `analysis.opportunity.*` config keys the analysis code reads as seeded global rows
(both environments) at their **current code defaults** — a no-runtime-behavior-change registration —
and add server-side `SCALAR_BOUNDS_REGISTRY` write-bounds to the numeric footgun keys, so an operator
can see and safely tune the opportunities queue in config-ui without a code change or a raw admin
`SetConfig(create_key)`, and cannot write a value that re-opens a known SEV. This is exactly the gap
feature 182 closed for the readiness-materializer keys; it reuses that mechanism verbatim.

## Codebase Map

- **`xstockstrat-config`** (Node.js)
  - Migration tip: `027_analysis_readiness_materializer_keys.{up,down}.sql` (`services/xstockstrat-config/migrations/`) — **next-free NNN = `028`** (contiguous through 027).
  - Seed template (feature 182): `027_analysis_readiness_materializer_keys.up.sql:28-55` — INSERT cols `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`; full-dotted `key` stored verbatim (`:37`); two rows/key `('staging',NULL)`+`('production',NULL)`; `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` (`:55`); down predicate `DELETE ... WHERE namespace='analysis' AND user_id IS NULL AND key IN (...)` (`027_...down.sql:9-17`, explicit `key IN`, never `LIKE`).
  - `SCALAR_BOUNDS_REGISTRY`: `src/grpc/configServiceImpl.ts:100` — `Record<string,{minValue,maxValue}>`; current entries `:101-112` incl. three **int** readiness_materializer keys (`refresh_hour_utc [0,23]`, `valid_window_hours [1,168]`, `max_concurrent_bars_fetches [1,5]`) — proves int enforcement works today.
  - `lookupScalarBounds(namespace, key)`: `src/grpc/configServiceImpl.ts:118-120` — two-operand probe `REGISTRY[key] ?? REGISTRY[`${namespace}.${key}`]`. Call sites: SetConfig write edge `:396`, ListKeys read edge `:513`.
  - Write-edge coercion + reject: `:396-406` — `const n = Number(extractValueData(value)); if (NaN || n<min || n>max) callback({code:3,...})`. `extractValueData` `:577-588` returns `String(scalar)` (oneof order `string ?? int ?? float ?? bool`), so **`0` survives on the write/bounds path** (no falsy-zero trap here).
  - `value_type` DB domain: `001_config_tables.up.sql:10` — `CHECK (value_type IN ('string','int','float','bool','json'))`. A float bound stores `value_type='float'`; no special type. `VALUE_TYPE_FLOAT_SCALAR` is a **proto** ValidationRule enum, emitted only in the ListKeys hint (`:529`), never written to the column.
  - ListKeys bounds hint (FR-4): `:527-533` — `validation: scalarBounds ? {valueType: VALUE_TYPE_FLOAT_SCALAR, minValue, maxValue} : undefined`.
  - Admin-scope gate on global (`user_id NULL`) write: `:343-358` (`hasAdminAccessScope` || internal-caller); `src/grpc/authz.ts` `ADMIN_SCOPE=0x04` `:8`, `ADMIN_SCOPE_ERROR` PERMISSION_DENIED `:32-34`.
  - Bounds test pattern: `src/__tests__/setConfigScalarBounds.test.ts:163-191` (in-process loopback gRPC harness; int in/out-of-range asserts).

- **`xstockstrat-analysis`** (Python) — **docs-only** (readers already exist)
  - Getter call sites in `app/handlers/servicer.py` (getter / default / clamp):
    - `signal_rank_weight` `:3350` `get_float` 0.3 — no clamp
    - `sparkline_bars` `:3408` `get_int` 20 — `max(1,…)`
    - `live_enrich_ttl_seconds` `:3411` `get_int_present` 10 — no clamp
    - `empty_recompute_ttl_seconds` `:3505` `get_int_present` 30 — `max(1,…)`
    - `max_live_strategies_per_symbol` `:3607-3608` `get_int` 5
    - `max_live_held_symbols_per_compute` `:3656-3657` `get_int` 20
    - `max_live_only_symbols_per_compute` `:3692-3693` `get_int` 20
    - `max_universe_size` `:3791` `get_int` 100
    - `valid_window_hours` `:3818` `get_int` 24
    - `refresh_hour_utc` `:4007` `get_int_present` 0
    - `retry_seconds` `:4025` (+`:4181`) `get_int_present` 300 — `max(1,…)`
    - `startup_jitter_seconds` `:4064` (+`:4218`) `get_int_present` 30 — `max(0,…)` in sleep
    - `snooze_default_hours` `:4243` `get_int` 24
    - `max_concurrent_bars_fetches` `:413` (`__init__`) `get_int` 2 — `max(1,…)`
    - `max_concurrent_candidates` `:419` (`__init__`) `get_int` 4 — `max(1,…)`
  - Getter semantics in `app/config/watcher.py`: `get_int :95-101` (`v.int_val or default` — **zero-trap**), `get_int_present :103-114` (`HasField` — **0 honored**; docstring names `refresh_hour_utc`=midnight), `get_float :124-130` (zero-trap), `get_bool :116-122` (`HasField`).
  - Refresh loop `run_opportunity_refresh_forever` `:4043`; consumes `refresh_hour_utc`/`startup_jitter_seconds`/`retry_seconds`; **no `enabled` gate** today (only `_opportunities_repo is None` early-return `:4054-4055`). Kill-switch precedent = `analysis.readiness_materializer.enabled` `get_bool(...,False)` `:4173`.
  - CLAUDE.md Config Keys table rows `:322-338`; 4 rows carry an explicit "No seed migration (the `analysis.opportunity.*` no-seed pattern)" note (`:333,:335,:337,:338`); FR-5 doc-reconciliation target.

- **`xstockstrat-ui`** (Next.js) — **no code change** (claim verified)
  - `/config-ui` namespace editor is fully generic: `src/app/config-ui/[namespace]/NamespaceEditor.tsx:69` renders exactly `ListKeys` rows (no per-namespace allow-list); namespace is a route param (`page.tsx:20`, `hooks/useConfigKeys.ts:19-23`).
  - Bounds hint already generic: reads `validation.{valueType,minValue,maxValue}` (`NamespaceEditor.tsx:77`), renders "Must be a number in [min,max]" (`:158-162`), pre-validates (`validateScalar :35-41`, save `:88-93`, blur `:143-149`).
  - BFF pass-through: `src/lib/configUiBff.ts:26` `listKeys: forward(...)` (no field stripping); admin-gated SetConfig `:27-49`.
  - e2e fixtures: `e2e/fixtures/configKeys.ts:86-93` already carries an analysis-namespace bounded row `analysis.scoring.signal_decay_half_life_hours` (`validation {valueType:2,min:0,max:8760}`); catalog `e2e/fixtures/INVENTORY.md:34-35`; served by `e2e/mock-backend.ts:1208`; existing FR-4 coverage `e2e/config-ui/api-smoke.spec.ts:224-265`.

## Patterns to REUSE

- **Config seed migration** → mirror `027_analysis_readiness_materializer_keys.{up,down}.sql` (INSERT shape, env fan-out, `ON CONFLICT (namespace,key,environment,COALESCE(user_id,''))`, explicit `key IN (...)` down). Do NOT invent a new seed shape.
- **Write-bounds** → add entries to the existing `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:100`) keyed on the **full dotted key**; the existing `lookupScalarBounds` + write-edge (`:396`) + ListKeys hint (`:513`) need NO new code — data-only registry growth (feature 182 pattern, ledger insights 3085-3101).
- **config-ui rendering** → reuse the generic `NamespaceEditor` — zero UI code; a registered+bounded key surfaces automatically.
- **e2e fixture (C-12)** → extend `CONFIG_KEY_FIXTURES` (`configKeys.ts`) with `analysis.opportunity.*` rows mirroring the `signal_decay_half_life_hours` bounded row; do not inline literals.
- **Bounds unit test** → mirror `setConfigScalarBounds.test.ts` in/out-of-range block per new bounded key.
- **Getter-type ↔ value_type map** → seed each row's `value_type` to match its reader: `get_float`→`'float'`, `get_int`/`get_int_present`→`'int'`.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-5 @FR-4 @feature-182` "A registered materializer key is settable via SetConfig without create_key" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — closest precedent; applies the same seed→settable-without-create_key pattern to the 15 `analysis.opportunity.*` keys.
- **EXTEND** `@AC-7 @FR-6 @feature-182` "An in-bounds tuning write is accepted" (same suite) — opportunity numeric keys gain SCALAR_BOUNDS_REGISTRY bounds alongside the materializer trio.
- **EXTEND** `@AC-8 @FR-6 @feature-182` "An out-of-bounds tuning write is rejected at the write edge" (same suite) — the INVALID_ARGUMENT write-reject replicated for the opportunity footgun keys.
- **PRESERVE** `@AC-9 @FR-2 @feature-182` "The bounds are write-path only and change no read path" (same suite) — the C-16 guard for this feature's NO-runtime-change promise; new bounds must touch no WatchConfig/GetConfig read path.
- **EXTEND** `@AC-7 @FR-5 @feature-161` "the decay half-life is settable at the boundary without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — same existence-gate settability.
- **EXTEND** `@AC-11 @FR-8 @feature-161` "an out-of-range decay half-life write is rejected server-side without persisting" (same suite) — bounds-rejection precedent.
- **EXTEND** `@AC-12 @FR-8 @feature-161` "a negative or non-numeric decay half-life write is rejected server-side" (same suite).
- **EXTEND** `@AC-6 @FR-5 @feature-161` "the decay half-life key is registered and visible in config-ui with bounds" (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`) — the 15 keys surface in the config-ui analysis-namespace editor with default + guidance + type/min/max, as the decay key does.
- **PRESERVE** `@AC-4 @FR-3 @feature-177` "An empty-universe user does not recompute on every poll" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — consumes `empty_recompute_ttl_seconds`; seed at default, no compute change.
- **PRESERVE** `@AC-5 @FR-4 @feature-177` "Warm reads skip live enrichment when values are fresh" (same suite) — consumes `live_enrich_ttl_seconds`.
- **PRESERVE** `@AC-14 @FR-8 @feature-095` "Folding in the live quote does not leak look-ahead into ranking" (`services/xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — opportunity ranking (touching `sparkline_bars`/`live_enrich_ttl`) must stay byte-identical.
- **PRESERVE** `@AC-7 @FR-5 @feature-158` "A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — consumes `startup_jitter_seconds`+`retry_seconds`; bounds must admit the code-default values.
- **PRESERVE** `@AC-8 @FR-6 @feature-158` "The daily opportunity refresh re-anchors to its wall-clock hour across a redeploy" (same suite) — consumes `refresh_hour_utc`; `0`=midnight must remain settable.
- **PRESERVE** `@AC-9 @FR-6 @feature-158` "The opportunity refresh retries soon after a user-enumeration failure" (same suite) — consumes `retry_seconds`.

## Dependencies

- Proto/RPC: **none** (no proto change; bounds/hint ride existing `ConfigKeyMeta.validation` / `ValidationRule`, `packages/proto/config/v1/config.proto:97-101,164`).
- Migration: next number **`028`** for `services/xstockstrat-config/migrations/` (bind-at-rebase — reconfirm vs `main-dev` at execute; ledger fails 1699/1702).
- Config keys: the 15 `analysis.opportunity.*` (all C-05 3-segment; registered, not invented) + (design option) `analysis.opportunity.refresh_enabled` bool.
- Inter-service edges: config → analysis via `WatchConfig` — **read side unchanged** (write-path-only bounds; PRESERVE @AC-9/182).
- New env vars / ports: **none**.

## Risks / Not-found

- **Legitimate-`0` C-16 regression risk (design-critical).** The 5 `get_int_present` keys (`refresh_hour_utc`, `startup_jitter_seconds`, `live_enrich_ttl_seconds`, `empty_recompute_ttl_seconds`, and `retry_seconds` via `max(1,…)`) honor a stored `0` as a *documented operator value* (midnight / jitter-off / memo-off). A bound whose **lower edge excludes 0 on these keys would silently CHANGE a currently-settable value** — a C-16 regression requiring explicit user sign-off. Design MUST pick per-key lower bounds preserving each key's `0` semantics (`refresh_hour_utc [0,23]`, `startup_jitter_seconds [0,N]`, TTLs `[0,N]`). The `[1,…]` shape is correct **only** for the `get_int` zero-trap keys where `0` is already indistinguishable from unset.
- **Shared-reader keys.** `retry_seconds` and `startup_jitter_seconds` are also read by the feature-180 readiness-materializer loop (`servicer.py:4181`,`:4218`) — one `analysis.opportunity.*` key, two consumers. Any bound must be sane for both loops (they share defaults 300/30).
- **WatchConfig snapshot key shape** (ledger insights 905/907): snapshot is `values[row.key]` with no namespace prefixing — the seed `key` column MUST be the full dotted reader string or the row is a silent orphan.
- **`SCALAR_BOUNDS_REGISTRY` key shape** (ledger fails 2007): register each bound under the full dotted key; the `lookupScalarBounds` two-operand probe already handles both, but a namespace-relative registry key would double-prefix and miss.
- **`value_type` = storage type** (ledger fails 409): store `'float'`/`'int'` to match the getter, not a semantic/bounds type.
- **`get_int` zero-trap on read** (ledger insights 142): even after seeding, a stored `0` on a `get_int`/`get_float` key still reads back as the code default — bounds `min ≥ 1` on those keys documents that `0` is intentionally unreachable; leave the read-path `max(1,…)` clamps untouched (PRESERVE the compute behavior).
- **Docs-drift half is in-scope** (ledger fails 1512): the analysis `CLAUDE.md` "no-seed pattern" notes + the config-governance registered-keys log MUST be reconciled in the SAME PR (FR-5) — the pattern this feature deliberately reverses is currently documented as intentional.
- **Not-found**: no `analysis.opportunity.enabled` kill-switch exists (grep clean); no existing seed row or bounds entry for any `analysis.opportunity.*` key.

## Recommended Scope

Advisory step boundaries (input to grilling + /sdd-spec; not binding):

1. **config — seed migration `028`** (`services/xstockstrat-config/migrations/028_analysis_opportunity_keys.{up,down}.sql`): 15 keys × {staging,production} global rows at code defaults, `value_type` per getter; idempotent up, explicit-`key IN` down. (Offline-verified only — no DB brought up.)
2. **config — bounds registry + test**: add `SCALAR_BOUNDS_REGISTRY` entries for the numeric footgun keys with **per-key lower bounds respecting `0`-legitimacy** (design decides the exact set/ranges); extend `setConfigScalarBounds.test.ts` with in/out-of-range asserts per bounded key.
3. **ui — e2e fixture + coverage** (C-12; no component code): add `analysis.opportunity.*` rows to `CONFIG_KEY_FIXTURES`, extend `api-smoke.spec.ts` bound-hint coverage.
4. **docs reconciliation** (FR-5, same PR): analysis `CLAUDE.md` Config Keys table (drop "no-seed" notes, cite migration 028 + bounds) + config-governance per-feature registered-keys log entry.
5. **(design option) refresh kill-switch** — only if design takes it: `analysis.opportunity.refresh_enabled` bool seed + `get_bool` gate in `run_opportunity_refresh_forever`, with its own `@AC-*`.
