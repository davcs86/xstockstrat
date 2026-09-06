# Design: readiness-materializer-config-keys

**Created**: 2026-09-06
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-09-06 (key-scope = "all four + write-bounds"; ceiling = 5)
**Grounded in**: recon.md

---

## Chosen Approach

Register all four `analysis.readiness_materializer.*` keys via a data-only config seed migration **and**
add write-side bounds for the numeric tuning keys, so an operator can safely enable/tune the
feature-180 materializer from config-ui. Two work surfaces:

1. **Seed migration `027_analysis_readiness_materializer_keys.{up,down}.sql`** (`services/xstockstrat-config/migrations/`, next-free after 026 — recon.md Codebase Map) mirroring `026_analysis_engine_blend_keys.up.sql:23-38` verbatim in tuple shape: one `INSERT INTO config.config_values (namespace,key,value_type,value_data,description,default_value,consuming_service,environment,user_id)` with **8 rows** = 4 keys × {staging,production}, global (`user_id NULL`), `consuming_service='xstockstrat-analysis'`, closing `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING` (`017_config_secrets_and_scoping.up.sql:101-102`). The `key` column is the **full dotted** string (snapshot keyed by bare `row.key`, `configServiceImpl.ts:138,162`); per-key `value_type`/`value_data` = each getter's type and code default: `enabled`→`bool`/`false` (`servicer.py:4173`), `refresh_hour_utc`→`int`/`0` (`servicer.py:4075`), `valid_window_hours`→`int`/`24` (`servicer.py:3044,4092`), `max_concurrent_bars_fetches`→`int`/`2` (`servicer.py:454`). `.down.sql` = explicit `DELETE ... WHERE namespace='analysis' AND key IN (<the four full-dotted keys>) AND user_id IS NULL` (a deliberate tightening over 026's down — preserves any operator per-user override on rollback; see Rejected Alternatives).

2. **Write-bounds in `SCALAR_BOUNDS_REGISTRY`** (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:98-103`, enforced at the `SetConfig` write edge ~`:379-386`), EXTENDing the feature-161 `@AC-11`/`@AC-12` bounds pattern for the three int keys:
   - `analysis.readiness_materializer.refresh_hour_utc` → `[0, 23]` (wall-clock UTC hour; the reader has **no** clamp).
   - `analysis.readiness_materializer.valid_window_hours` → `[1, 168]` (1h–1 week; reader clamps 1h min, this bounds the top).
   - `analysis.readiness_materializer.max_concurrent_bars_fetches` → `[1, 5]` — ceiling tied to marketdata's PgBouncer pool size (root CLAUDE.md § Connection Pool Budget: pooled size 5), the true max concurrent bars-fetches marketdata can execute; prevents an operator re-opening the **feature-141 SEV-2** (TimescaleDB "out of shared memory"). `enabled` is a bool → no numeric bound.

   Bounds are **write-path only** — they reject out-of-range future `SetConfig` writes and touch **no read path**, so seeding + bounds remains a no-runtime-behavior-change registration (the materializer stays OFF at `enabled=false`).

3. **Docs reconciliation** (surgical): flip **only** the four `readiness_materializer.*` rows' "No seed migration" note in `services/xstockstrat-analysis/CLAUDE.md` Config Keys table to cite migration 027 (leave the other ~5 `analysis.*`/`analysis.opportunity.*` no-seed notes intact — recon adversary objection 3); add a feature-182 entry to the config-governance per-feature registered-keys log; record the four keys' bounds alongside.

**Consumer surface (C-14):** config-ui `/config-ui` analysis namespace editor renders the four keys (no UI code change — generic editor renders any registered key). **Visibility requires a config-service reload**: a raw migration `INSERT` fires no `pg_notify`, so the keys appear only after a config-service restart (deploy) or the next analysis-namespace `SetConfig`-triggered `reloadNamespace` (`configServiceImpl.ts:112-124,153-173`) — verification/rollout must account for this (adversary objection 5).

## Rejected Alternatives

- **Defer bounds (seed all four, no registry entries)** — rejected: hands an operator the feature-141 SEV-2 concurrency lever and an unclamped `refresh_hour_utc`; the "reader clamps absorb it" defense is false (`max(1,…)` guards only the low side; `refresh_hour_utc` has no clamp). Bounds are write-path only, so adding them does not break the no-behavior-change contract.
- **Seed only `enabled` (or `enabled`+`valid_window_hours`)** — rejected by operator choice; simplest/safest but loses operator tunability of schedule + concurrency that the "all four" decision wanted.
- **Reader-side clamp (`hour % 24`, concurrency cap) in analysis** — rejected: an analysis code change outside scope that still leaves config-ui with no validation hint; registry bounds are the right layer.
- **Verbatim 026 down-delete (no `user_id IS NULL`)** — rejected: 026's down deletes all rows for the key, destroying an operator per-user override on rollback; the scoped delete reverses only what `up` seeded.

## Open Risks

- [ ] **`SCALAR_BOUNDS_REGISTRY` int support (top risk):** the registry today holds only two **float** keys (`configServiceImpl.ts:98-103`). `/sdd-spec` must verify the enforcement path (~`:379-386`) applies bounds to `int`-typed values (not float-only). If int enforcement is missing, the spec adds the minimal type handling **or** falls back to the operator-approved smaller scope (seed-only-`enabled`) with a re-gate. — addressed at /sdd-spec Step (bounds).
- [ ] **Migration number 027 is bind-at-rebase** (feature-020 scar, fails.md:1697; 026 renumber comment): reconfirm next-free against `main-dev` immediately before execute, announce in `merge-order.md`, renumber to next-free on collision. — addressed at /sdd-execute pre-write.
- [ ] **No migration CI gate** (recon Risks): execute self-verifies up→down→up against a local/throwaway config DB (assert 8 rows, types, idempotency, clean scoped down, siblings untouched) if reachable; else column/tuple/type read-back review + record the gap in context.md. — addressed at /sdd-execute verify.
- [ ] **Config-ui visibility needs a config-service reload** (no pg_notify from a raw INSERT): note the deploy-restart dependency in the rollout/verification notes; do not assert the `@AC-6`-EXTEND "config-ui shows them" objective met until reload. — addressed at /sdd-execute verify + context.md.
- [ ] **`max_concurrent_bars_fetches` get_int zero-trap residual** (insights.md:142): an operator setting `0` (now within [1,5]? no — min is 1) is prevented by the `[1,5]` bound; document that `0`/"unlimited" is intentionally unreachable. — resolved by the bound; note in docs.

## Constitution Rules Touched

- `C-05` (config key naming) — honored: keys already `<service>.<category>.<key>`; seeded as full-dotted `key` column.
- `C-07` (migration discipline) — honored: numbered up+down, forward-only, next-free 027 (bind-at-rebase), data-only, idempotent, reversible.
- `C-16` (business-rule preservation) — honored: EXTENDs @AC-6/@AC-7/@AC-11/@AC-12 (feature-161), PRESERVEs @AC-2/@AC-3 (feature-181) by seeding at code defaults (esp. `enabled=false`); no CHANGE.
- `P-03` (no silent deviation) — honored: the footgun was surfaced and resolved via write-bounds with explicit operator sign-off (this gate), not hand-waved.
- `F-04`/`P-03` (never invent) — honored: bound values are reasoned (UTC hour range; marketdata pool size 5), and the registry int-support question is carried as an open risk for /sdd-spec to verify, not assumed.
- `F-06` (no new pool) — honored: no DB pool added; the concurrency bound *protects* the existing pool budget.
- `F-01`/`F-07` — honored: a new migration (not editing an applied one); values seeded in DB, not hardcoded.

## Business Rules Touched (C-16)

- EXTEND `@AC-6 @FR-5 @feature-161` "decay key registered + visible in config-ui with default/description" (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`) — the four keys render in the same editor; with bounds, `refresh_hour_utc`/`valid_window_hours`/`max_concurrent_bars_fetches` also get a min/max validation hint (full render parity).
- EXTEND `@AC-7 @FR-5 @feature-161` "registered key settable via set_config without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — the seeded keys become admin-settable the same way.
- EXTEND `@AC-11`/`@AC-12 @FR-8 @feature-161` "server-side bounds rejection at SetConfig" (config `surface-signal-weight-decay-config.feature`) — new bounded keys added to `SCALAR_BOUNDS_REGISTRY`; out-of-range writes rejected `INVALID_ARGUMENT`.
- PRESERVE `@AC-3 @feature-181 @feature-180` "bar-busted readiness row is PENDING, never stale RESOLVED" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — seeded at code defaults; materializer OFF; byte-identical at registration.
- PRESERVE `@AC-2 @feature-181` "data-unavailable readiness row is UNKNOWN, not perpetual PENDING" (same suite) — unchanged; registration alters no read path.
