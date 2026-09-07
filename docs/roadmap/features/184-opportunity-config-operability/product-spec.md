# Product Spec: opportunity-config-operability

**Created**: 2026-09-07

---

## Problem Statement

The opportunities queue (`ListOpportunities` + the compute/materializer/refresh loop in
`xstockstrat-analysis`) is tuned by **15** `analysis.opportunity.*` config keys, but **none is seeded**
(the invisible "`analysis.*` no-seed pattern") and **none is bounded**. An operator therefore cannot
see or safely tune them in config-ui (which only edits registered keys; a raw global
`SetConfig(create_key)` needs admin scope), and several numeric keys are footguns: `refresh_hour_utc`
has no clamp, `max_concurrent_bars_fetches` is the feature-141 SEV-2 lever (TimescaleDB "out of shared
memory"), and `max_universe_size` / the `max_live_*` caps directly govern compute cost. This is the
exact gap feature 182 closed for the readiness materializer keys.

## User Story

As a **platform operator/admin**, I want the `analysis.opportunity.*` config keys registered and
visible in config-ui with safe write-bounds, so that I can observe and tune the opportunities queue
without a code change or a raw admin `SetConfig`, and cannot set a value that re-opens a known SEV.

## Functional Requirements

FR-1. A config seed migration registers the operator-relevant `analysis.opportunity.*` keys the
analysis code reads as **global** rows for **both** environments, each keyed by the **full dotted**
key the reader looks up and typed to match its getter, seeded at the **current code default** (a
no-runtime-behavior-change registration). The audited key set (getters/defaults confirmed in
`servicer.py`): `signal_rank_weight` (float 0.3), `empty_recompute_ttl_seconds` (int 30),
`sparkline_bars` (int 20), `live_enrich_ttl_seconds` (int 10), `max_universe_size` (int 100),
`valid_window_hours` (int 24), `max_live_strategies_per_symbol` (int 5),
`max_live_only_symbols_per_compute` (int 20), `max_live_held_symbols_per_compute` (int 20),
`refresh_hour_utc` (int 0), `startup_jitter_seconds` (int 30), `retry_seconds` (int 300),
`snooze_default_hours` (int 24), `max_concurrent_bars_fetches` (int 2), `max_concurrent_candidates`
(int 4). (Design settles the exact subset — e.g. whether the two init-time sem keys are worth
operator exposure.)

FR-2. Server-side `SCALAR_BOUNDS_REGISTRY` write-bounds are added for the numeric keys, rejecting an
out-of-range `SetConfig` with `INVALID_ARGUMENT` (EXTEND of the feature-161/182 bounds pattern), reusing
the feature-182 two-operand `lookupScalarBounds()` helper. At minimum the footgun keys:
`refresh_hour_utc [0,23]`, `max_concurrent_bars_fetches [1,5]` (marketdata PgBouncer pool ceiling,
feature-141 SEV-2 guard), `signal_rank_weight [0,1]`, and sane ceilings on `max_universe_size` and the
`max_live_*`/`max_concurrent_candidates` compute-cost caps. Exact ranges are a design decision.

FR-3. The migration is idempotent (`ON CONFLICT … DO NOTHING`) and reversible (a `.down.sql` deleting
exactly the seeded keys by explicit `key IN (...)`, global rows only).

FR-4. After the migration + a config-service reload, the registered keys appear in config-ui's
`analysis` namespace and an admin can tune them there (no `create_key`); bounded keys render a
min/max validation hint.

FR-5. Docs reconciled: the analysis `CLAUDE.md` Config Keys table rows for the registered keys drop the
"No seed migration" note and cite the new migration + bounds (surgically — leave any genuinely
still-no-seed rows intact); a config-governance per-feature registered-keys log entry is added.

FR-6. _(Design option — G6 from the audit.)_ Optionally add an `analysis.opportunity.refresh.enabled`
kill-switch for `run_opportunity_refresh_forever` (mirrors `readiness_materializer.enabled`) as an ops
safety valve. Unlike the materializer, the opportunities queue is a core surface, so an always-on
default is expected; design decides whether the kill-switch earns its place.

## Out of Scope

- The opportunities **compute correctness/robustness** changes (data-unavailable sentinel, dedicated
  background semaphore, non-blocking cold read) — those are **feature 185
  (opportunity-compute-robustness)**.
- Flipping any key away from its code default in any environment (registration is no-behavior-change).
- Registering the other `analysis.*` no-seed families beyond `analysis.opportunity.*`.

## Affected Services

- `xstockstrat-config` — new seed migration under `migrations/` + `SCALAR_BOUNDS_REGISTRY` entries in
  `src/grpc/configServiceImpl.ts` (reusing feature-182's `lookupScalarBounds`). No schema change.
- `xstockstrat-analysis` — **docs only** (`CLAUDE.md` Config Keys table). The readers already exist.
  (FR-6, if taken, adds a `get_bool` gate in `run_opportunity_refresh_forever` — an analysis code change.)
- `xstockstrat-ui` (`/config-ui`) — **no code change**; the generic namespace editor renders the keys.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/config-ui`: the registered `analysis.opportunity.*` keys become
  visible/tunable in the `analysis` namespace editor (existing editor; no new page/route/control).
- [ ] **Agent** — none.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required (FR-6's optional kill-switch is a config key, not proto).

## Config Key Changes

Registers (does not invent) the `analysis.opportunity.*` keys above as seeded global rows + adds
write-bounds to the numeric ones. FR-6 optionally adds one new key
`analysis.opportunity.refresh.enabled` (bool, default `true`).

## Database Changes

- [x] New config seed migration `services/xstockstrat-config/migrations/NNN_analysis_opportunity_keys.{up,down}.sql`
  (next-free NNN, bind-at-rebase — reconfirm vs `main-dev` at execute; the last config migration on
  main-dev today is `027_analysis_readiness_materializer_keys`). Data-only seed; no schema change.

## Feature Workflow Notes

Branch: harness `claude/*` off `main-dev`, PR to `main-dev` (per standing constraint).
Approval gates: 1 config service owner (config change). No breaking proto; no schema migration.

## Acceptance Criteria

See `acceptance.feature` (`@AC-*`) — single source of acceptance truth (C-15).

## Open Questions

- [ ] **Migration-026/182 scar:** the seeded `key` column must be the **full-dotted** reader string
  (the WatchConfig snapshot is keyed by `values[row.key]`) and `value_type` must match each getter, or
  the row is a silent orphan — assert both at design/execute (reuse the feature-182 verification).
- [ ] **Which keys get bounds, and what ranges?** Design decides; the footgun keys (`refresh_hour_utc`,
  `max_concurrent_bars_fetches`, `max_universe_size`, `signal_rank_weight`) are the priority. Note
  several are read via the `get_int` zero-trap (`max_concurrent_bars_fetches`, `max_universe_size`,
  `snooze_default_hours`, `signal_rank_weight` via `get_float`) — a min ≥ 1 bound means "0" is
  intentionally unreachable; document per key (feature-182 precedent).
- [ ] **FR-6 kill-switch:** include it, or leave the queue always-on? (Ops-safety vs a core surface
  that should not be casually disabled.)
