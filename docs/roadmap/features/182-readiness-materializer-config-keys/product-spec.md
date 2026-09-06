# Product Spec: readiness-materializer-config-keys

**Created**: 2026-09-06

---

## Problem Statement

The feature-180 readiness materializer (which pre-warms the `analysis.readiness_cache` so the
feature-181 `/insights/watchlists` list renders resolved verdicts instead of perpetual PENDING) is
gated by `analysis.readiness_materializer.enabled`, defaulting OFF. That key — and the materializer's
three tuning keys — follow the "`analysis.*` no-seed pattern": they are never seeded, resolve to code
defaults, and are therefore **invisible and un-creatable through config-ui** (which only edits
already-registered keys). An operator has no supported path to turn the materializer on: config-ui
cannot show/create the key, and a global `SetConfig create_key=true` requires the ADMIN scope bit.

## User Story

As a **platform operator/admin**, I want the `analysis.readiness_materializer.*` config keys to be
registered and visible in config-ui, so that I can enable the readiness materializer (and tune its
schedule/concurrency) without a code change or a raw admin-scoped `SetConfig`.

## Functional Requirements

FR-1. A config seed migration registers all four materializer keys as **global** rows for **both**
environments (`staging`, `production`), each keyed by the **full dotted key** the analysis service
reads and with a `value_type` matching that key's getter (verified against
`services/xstockstrat-analysis/app/handlers/servicer.py`):
- `analysis.readiness_materializer.enabled` — `bool`, seeded `false` (read via `get_bool`, servicer.py:4173)
- `analysis.readiness_materializer.refresh_hour_utc` — `int`, seeded `0` (read via `get_int_present`, servicer.py:4075)
- `analysis.readiness_materializer.valid_window_hours` — `int`, seeded `24` (read via `get_int_present`, servicer.py:3044/4092)
- `analysis.readiness_materializer.max_concurrent_bars_fetches` — `int`, seeded `2` (read via **`get_int`**, the zero-trap getter, servicer.py:454). Seeding `int`/`2` is correct because the seeded value **equals** the code default, so the zero-trap never fires for this row — but a future operator must not set it to `0` expecting "unlimited"; `get_int`'s zero-trap would collapse `0` back to the default `2`.

FR-2. Each key is seeded at its **current code default**, so applying the migration is a
**no-behavior-change** registration: `enabled=false` means the materializer stays OFF until an operator
explicitly flips it. Registration only makes the keys operator-visible/editable.

FR-3. The migration is idempotent (`ON CONFLICT (namespace, key, environment, COALESCE(user_id,''))
DO NOTHING`) and reversible (a `.down.sql` deleting exactly the four seeded keys by explicit
`key IN (...)`, global rows only — never a `LIKE` prefix).

FR-4. After the migration, `analysis.readiness_materializer.enabled` appears in config-ui's `analysis`
namespace and an admin can toggle it there (the existing admin-gated `SetConfig` update path — no
`create_key` needed once the global row exists).

FR-5. The docs that assert these keys have "No seed migration (the `analysis.*` no-seed pattern)" are
corrected (analysis `CLAUDE.md` Config Keys table) **for the four `readiness_materializer.*` rows only**
(the other ~5 `analysis.*`/`analysis.opportunity.*` no-seed notes stay intact), and the
config-governance per-feature registered-keys log records this registration.

FR-6. _(Added at the design gate — approved scope "all four + write-bounds", 2026-09-06.)_ Because
registering the numeric tuning keys makes them operator-editable in config-ui, the three int keys get
server-side write-bounds in `SCALAR_BOUNDS_REGISTRY` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts`)
so an out-of-range `SetConfig` is rejected `INVALID_ARGUMENT` (EXTEND of the feature-161 `@AC-11`/`@AC-12`
pattern): `refresh_hour_utc` `[0,23]`, `valid_window_hours` `[1,168]`, `max_concurrent_bars_fetches`
`[1,5]` (ceiling = marketdata PgBouncer pool size, guarding the feature-141 SEV-2). Bounds are
**write-path only** — they reject future out-of-range writes and touch no read path, so registration
remains a no-runtime-behavior-change change. `enabled` is a bool → no numeric bound.

## Out of Scope

- **Flipping `enabled=true`** in any environment — that is a subsequent operator action via config-ui,
  not this migration (FR-2 keeps it OFF).
- Any change to the materializer's behavior, cadence, or the `GetWatchlistReadiness` RPC (feature 180/181).
- Registering the other `analysis.*` no-seed families (`analysis.opportunity.*`, `analysis.readiness.stale_after_seconds`, etc.) — only the materializer family is in scope.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-config` — new seed migration under `services/xstockstrat-config/migrations/` (registers the rows) **plus a code change**: three new `SCALAR_BOUNDS_REGISTRY` entries in `src/grpc/configServiceImpl.ts` (FR-6, added at design gate). No schema change.
- `xstockstrat-analysis` — **docs only** (`CLAUDE.md` Config Keys table notes corrected). No code change: the reader already exists (feature 180).
- `xstockstrat-ui` (`/config-ui`) — **no code change**; it renders the newly-registered keys automatically (with the bounds hint from FR-6).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/config-ui`: the four `analysis.readiness_materializer.*` keys become
  visible in the `analysis` namespace editor and `enabled` is togglable there. No new page/route/control
  — the existing namespace editor renders any registered key; this feature makes the keys *exist* so it
  can render them.
- [ ] **Agent** — none.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

Registers (does not invent) these existing code-read keys as seeded global rows in both environments:
- `analysis.readiness_materializer.enabled` (bool, `false`)
- `analysis.readiness_materializer.refresh_hour_utc` (int, `0`)
- `analysis.readiness_materializer.valid_window_hours` (int, `24`)
- `analysis.readiness_materializer.max_concurrent_bars_fetches` (int, `2`)

## Database Changes

- [x] New config seed migration: `services/xstockstrat-config/migrations/027_analysis_readiness_materializer_keys.{up,down}.sql`
  (next free number after `026`; forward-only ordering — golang-migrate applies only versions > current).
  No schema/table change — data-only seed into `config.config_values`.

## Feature Workflow Notes

Branch to create: `feature/readiness-materializer-config-keys` (branch from `main-dev`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config change — config service owner + config team)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A (data-only seed, no schema change; config service owner review still applies)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

_All resolved at spec time (verified against the code); carried into design as assertions, not open forks._

- [x] **Known trap (migration 026 scar) — RESOLVED (design must assert):** the seeded `key` column must
  equal the **full dotted** string the analysis `ConfigWatcher` reads (`analysis.readiness_materializer.*`)
  — the WatchConfig snapshot is keyed by `values[row.key]` with no namespace prefix added
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:138/162`), so a bare
  `readiness_materializer.*` form would be a silent orphan (the exact bug that left staging's
  `fundsignal.*` rows dead). `value_type` must match each key's getter. Migration 027 uses the full
  dotted `key` and the per-key types in FR-1; design/execute assert this with a post-apply read-back.
- [x] **Getter typing — RESOLVED (spec corrected):** getters verified in `servicer.py` — `enabled`→`get_bool`,
  `refresh_hour_utc`/`valid_window_hours`→`get_int_present`, and **`max_concurrent_bars_fetches`→`get_int`**
  (the zero-trap getter, servicer.py:454), NOT `get_int_present`. Seeding `int`/`2` is nonetheless correct
  (seeded value == code default `2`, so no zero-trap and no orphan). FR-1 now records the exact getter per key.
- [x] **config-ui render columns — RESOLVED:** mirror 026's column set — populate `description` and
  `default_value` on every seeded row (026 did) so the `analysis` namespace editor renders each key with
  a meaningful label/hint. Migration 027 follows 026's `INSERT ... (namespace, key, value_type, value_data,
  description, default_value, consuming_service, environment, user_id)` shape verbatim.
