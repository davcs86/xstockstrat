# Implementation Spec: readiness-caching-poll-discipline

**Status**: `pending`
**Created**: 2026-09-05
**Feature**: `docs/roadmap/features/177-readiness-caching-poll-discipline/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/readiness-caching-poll-discipline`

---

## Execution Summary

Cut redundant recompute on the two decide-surface read paths without ever presenting stale data as
fresh, following the approved `design.md` (FAST/SLOW readiness cache, dedicated empty-universe
compute-state, conditional live-enrichment memo, per-query client `staleTime`). Order: the proto
field addition and codegen first (Steps 1–2) so the analysis service can populate `computed_at`;
then the two durable tables (Steps 3–4) and the config wiring (Step 5); then the three analysis
behaviors, each with its paired test (Steps 6–11); finally the UI `staleTime` and its e2e (Steps
12–13). The analysis behaviors are independent of one another (different functions) so they could
land in any order, but each is red-before-green paired.

**Post-176 baseline.** Feature 176 (`analysis-concurrency-offload`, status `code-completed`) has
already restructured `EvaluateReadiness` into an `asyncio.gather` over a per-symbol `_readiness_for`
coroutine (`servicer.py:2744-2766`) and added `_compute_opportunities` / the `ThreadPoolExecutor` /
`analysis.opportunity.max_concurrent_candidates` (`servicer.py:395-406`). All line citations below
are against that post-176 tree (the current feature branch already contains it). **176 must be
merged to `main-dev` before 177 integrates** (merge-order.md rows at `:238-242`).

**Consumer surface (C-14).** The product spec names exactly one surface: UI `/insights` (the
readiness `staleTime`, FR-2) — landed by Steps 12–13. The backend changes (FR-1/3/4) only make the
existing reads cheaper and add one **additive, optional** `computed_at` response field; the agent's
`list_opportunities` response shape is unchanged (product spec § Consumer Surface(s)). No new
page/route, so no `PLATFORM_SUBNAV`/C-10(a) registration is required. Surfacing `computed_at` in the
readiness pane is **out of scope** (the product spec asks only for the `staleTime`); the field is
added for FR-5 correctness/observability, not a mandated UI display.

## Scenario Coverage (C-15)

- `@AC-1` (repeat readiness within window skips fan-out) → Step 7
- `@AC-2` (new bar busts readiness cache) → Step 7
- `@AC-3` (remount within staleTime does not refetch) → Step 13
- `@AC-4` (empty-universe user does not recompute every poll) → Step 9
- `@AC-5` (warm reads skip live enrichment when fresh) → Step 11

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 6 (FR-1 service) requires Step 2 (the `computed_at` field must exist in the generated
  `analysis_pb2`) and Step 3 (the `readiness_cache` table) and Step 5 (the
  `analysis.readiness.stale_after_seconds` key + bound).
- Step 8 (FR-3 service) requires Step 4 (the `opportunity_compute_state` table) and Step 5 (the
  `analysis.opportunity.empty_recompute_ttl_seconds` key).
- Step 10 (FR-4 service) requires Step 5 (the `analysis.opportunity.live_enrich_ttl_seconds` key).
- Step 13 (FR-2 e2e) requires Step 12 (the `staleTime` change).
- Each `test` step immediately follows its `service` step and is red-before-green (P-06).
- **Cross-feature:** 176 → 177 hard sequence (see Execution Summary). No migration-number collision:
  the analysis dir tops at `021`, config dir tops at `026`; 177 claims analysis `022`+`023` — a
  scan of every other feature dir found no competing claim on analysis `022`/`023` (design.md locked
  these; recon.md:25/58 confirmed the `022` base before 176 landed and 176 added no migration).

---

### Step 1 — proto: add `computed_at` to `EvaluateReadinessResponse`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation; `xstockstrat-analysis` owner — backtest reproducibility / no look-ahead; `xstockstrat-ui` owner — no stale data shown as fresh

**Codebase Evidence**:
- `EvaluateReadinessResponse` today has a single field: `grep -n "message EvaluateReadinessResponse" packages/proto/analysis/v1/analysis.proto` → `:644-646`, body `repeated SymbolReadiness readiness = 1;`
- `google/protobuf/timestamp.proto` is **already imported** — `:7` (`import "google/protobuf/timestamp.proto";`); no new import needed. It is already used elsewhere in the file (e.g. `:150`, `:157`).
- Additive field `= 2` is buf-breaking-safe (design.md § Proto/config; C-09).

**TDD**: `N/A (proto — non-code-bearing; buf verification below)`

**Covers**: `—`

**Instructions**:
1. In `message EvaluateReadinessResponse` (`:644-646`), add a second field after `readiness = 1;`:
   ```proto
   // The oldest per-symbol cache "computed at" among the served rows — the response is never
   // presented as fresher than this (feature 177, FR-5). Bounded by the readiness staleness window.
   google.protobuf.Timestamp computed_at = 2;
   ```
2. Do **not** touch `SymbolReadiness` (`:595-601`) or `EvaluateReadinessRequest` (`:635-643`) — the
   field is response-level only (design.md § Proto/config).

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/readiness-caching-poll-discipline"
```
Both pass (lint clean; breaking reports no incompatibility — a new field is non-breaking).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (regenerated; do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation; `xstockstrat-analysis` owner; `xstockstrat-ui` owner (inherited from Step 1)

**Codebase Evidence**:
- Codegen entrypoint: `scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — "generates TypeScript, Python, and Go stubs and compiles the TS package").
- CI `proto-freshness` job enforces an empty `git diff packages/proto/gen/` after regen (root `CLAUDE.md` § Proto Contract Governance).

**TDD**: `N/A (proto-gen — non-code-bearing; freshness verification below)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage the regenerated stubs under `packages/proto/gen/` (TS/Python/Go). Only `analysis` message
   deltas for `computed_at` should appear.

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 after staging the regen (no residual diff — regen is deterministic and complete).

---

### Step 3 — migration: `022_readiness_cache`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/022_readiness_cache.up.sql` — create
- `services/xstockstrat-analysis/migrations/022_readiness_cache.down.sql` — create

**Reviewers**: DBA — NNN numbering (no gap/conflict), up+down pair, index correctness; `xstockstrat-analysis` owner — backtest reproducibility / determinism

**Codebase Evidence**:
- Last analysis migration: `ls services/xstockstrat-analysis/migrations/ | sort | tail -1` → `021_pnl_positions_fees_total` → next free NNN = **022** (recon.md:25; confirmed against the live dir).
- Mirror target for the `analysis` schema + `computed_at`/`valid_until` columns: `011_opportunities.up.sql` and `app/repositories/opportunities.py` `replace_for_user` (`:41`, `computed_at` defaults `now()`), `read` (`:77`, `valid_until > now()` freshness filter `:94`).
- No new DB pool: the repo reuses the existing `db_pool` like every other analysis repo (`servicer.py:384-431`); budget stays 2 (F-06).

**TDD**: `N/A (migration — non-code-bearing; offline inspect verification below)`

**Covers**: `—`

**Instructions**:
1. `022_readiness_cache.up.sql` — create `analysis.readiness_cache` (design.md § FR-1, § Literal upserts):
   ```sql
   CREATE TABLE IF NOT EXISTS analysis.readiness_cache (
       user_id         TEXT        NOT NULL,
       strategy_id     TEXT        NOT NULL,
       rule            TEXT        NOT NULL,   -- 'entry' | 'exit' (servicer.py:2730)
       symbol          TEXT        NOT NULL,
       def_fingerprint TEXT        NOT NULL,
       bar_epoch       BIGINT      NOT NULL,
       readiness_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
       computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
       valid_until     TIMESTAMPTZ NOT NULL,
       PRIMARY KEY (user_id, strategy_id, rule, symbol)
   );
   ```
2. `022_readiness_cache.down.sql`: `DROP TABLE IF EXISTS analysis.readiness_cache;`
3. Follow the exact schema-qualified (`analysis.`) style of `011_opportunities.up.sql`. Do not add a
   Timescale hypertable (this is a keyed cache, not a time series).

**Verification** (offline — never bring up a database):
```
ls services/xstockstrat-analysis/migrations/022_readiness_cache.up.sql services/xstockstrat-analysis/migrations/022_readiness_cache.down.sql
```
Then read both: confirm the `CREATE TABLE` in `.up` has its inverse `DROP TABLE` in `.down`, and the
NNN is `022` (one past `021`).

---

### Step 4 — migration: `023_opportunity_compute_state`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/023_opportunity_compute_state.up.sql` — create
- `services/xstockstrat-analysis/migrations/023_opportunity_compute_state.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, index correctness; `xstockstrat-analysis` owner

**Codebase Evidence**:
- Follows Step 3; next free NNN after `022` = **023** (two independent migrations for independent
  rollback — design.md § Proto/config, round-2 adversary fold-in #6).
- Dedicated table (not an in-band `opportunities` sentinel) — the sentinel was rejected because the
  `read()` conviction floor filters it and it re-kicks every poll (design.md § Rejected Alternatives;
  context.md round-1 adversary #3).

**TDD**: `N/A (migration — non-code-bearing; offline inspect verification below)`

**Covers**: `—`

**Instructions**:
1. `023_opportunity_compute_state.up.sql` (design.md § FR-3, § Literal upserts):
   ```sql
   CREATE TABLE IF NOT EXISTS analysis.opportunity_compute_state (
       user_id     TEXT        NOT NULL,
       computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       valid_until TIMESTAMPTZ NOT NULL,
       PRIMARY KEY (user_id)
   );
   ```
2. `023_opportunity_compute_state.down.sql`: `DROP TABLE IF EXISTS analysis.opportunity_compute_state;`

**Verification** (offline):
```
ls services/xstockstrat-analysis/migrations/023_opportunity_compute_state.up.sql services/xstockstrat-analysis/migrations/023_opportunity_compute_state.down.sql
```
Read both: the `CREATE TABLE` in `.up` has its inverse `DROP TABLE` in `.down`; NNN is `023`.

---

### Step 5 — config: register the three new keys (+ readiness bound)

**Status**: `done`
**Service**: `xstockstrat-config` (bound) + `xstockstrat-analysis` (docs) + `docs/patterns`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify (add one `SCALAR_BOUNDS_REGISTRY` entry)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (add three `Config Keys Consumed` rows)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log row)

**Reviewers**: `xstockstrat-config` owner — config key naming (`<service>.<category>.<key>`), scoping, `SCALAR_BOUNDS_REGISTRY` correctness; `xstockstrat-analysis` owner — the analysis-side defaults/read semantics

**Codebase Evidence**:
- `SCALAR_BOUNDS_REGISTRY` is a code const in the config service: `grep -n "SCALAR_BOUNDS_REGISTRY" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → declared `:98`, the existing entry `'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 }` at `:99`, enforced at `SetConfig` with `INVALID_ARGUMENT` (code 3) at `:376-381` (and the batch path `:492`). This is the feature-161 precedent the design cites.
- Analysis config reads use presence-aware getters where `0` is legitimate: `app/config/watcher.py` `get_int_present` (`:103`). The neighbor `analysis.opportunity.*` keys are documented no-seed (e.g. `analysis.opportunity.max_concurrent_candidates`, `analysis.compute.max_worker_threads` — "No seed migration") in `services/xstockstrat-analysis/CLAUDE.md`.
- Config-governance per-feature key log lives in `docs/patterns/config-governance.md` (root `CLAUDE.md` § Config Governance Rules).

**TDD**: `N/A (config — the code delta is a registry-table entry; verified by the config test suite + lint below)`

**Covers**: `—`

**Instructions**:
1. **Config-service bound** — add ONE row to `SCALAR_BOUNDS_REGISTRY` (`configServiceImpl.ts:98-100`):
   ```ts
   'analysis.readiness.stale_after_seconds': { minValue: 0, maxValue: 86399 },
   ```
   `86399 < 86400` (the 1d bar cadence) so a served-stale readiness verdict can never outlive a new
   daily bar (design.md § FR-1; round-2 adversary #2). `0` stays allowed (min inclusive) = "always
   stale".
2. **Document the three keys** in `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed:
   | Key | Type | Default | Notes |
   |---|---|---|---|
   | `analysis.readiness.stale_after_seconds` | int | `30` | FR-1 readiness cache staleness window (feature 177). Read via `get_int_present` (`0` = always stale; the `get_int` zero-trap would swallow a legitimate `0`). Server-bounded `[0, 86399]` via config-service `SCALAR_BOUNDS_REGISTRY` — `< 86400` so a served-stale verdict never crosses a daily-bar boundary. |
   | `analysis.opportunity.empty_recompute_ttl_seconds` | int | `30` | FR-3 empty-universe recompute suppression window (feature 177). Read via `get_int_present`. No seed migration (the `analysis.opportunity.*` no-seed pattern). |
   | `analysis.opportunity.live_enrich_ttl_seconds` | int | `10` | FR-4 short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via `get_int_present` (`0` = memo disabled → always fetch). No seed migration. |
3. **Per-feature key log** — add the three keys to the Per-Feature Registered Keys log in
   `docs/patterns/config-governance.md` under a `feature 177` row.
4. **No config-service seed migration is included** (minimal path — behavior #2): the two
   `analysis.opportunity.*` keys are no-seed by design, and the readiness key is enforced by the
   `SCALAR_BOUNDS_REGISTRY` code entry at `SetConfig` regardless of whether a seed row exists (unlike
   feature 161's migration `019`, which additionally seeded a row so the bounded key surfaces in
   config-ui). **Flag for impl-spec review / the config owner:** if config-ui discoverability of the
   bounded readiness key is desired, add a config-service seed migration mirroring
   `services/xstockstrat-config/migrations/019_register_analysis_signal_decay_half_life.up.sql` as a
   follow-up (next free config NNN = `027`; the `024` gap is not backfilled). Recorded here rather
   than silently decided (P-03).

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
```
Lint clean; the config suite passes with the new bound. Add/extend a config-service test asserting
`SetConfig('analysis','readiness.stale_after_seconds', 86400)` is rejected `INVALID_ARGUMENT` and
`86399` / `0` are accepted (mirror the existing `signal_decay_half_life_hours` bound test). Also:
```
grep -n "analysis.readiness.stale_after_seconds\|empty_recompute_ttl_seconds\|live_enrich_ttl_seconds" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
```
confirms all three keys are documented in both homes.

---

### Step 6 — service: FR-1 readiness cache (repository + FAST/SLOW `EvaluateReadiness`)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/readiness_cache.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias, no stale-as-fresh

**Codebase Evidence**:
- `EvaluateReadiness` post-176 shape: `servicer.py:2696`; per-symbol body `_readiness_for(symbol)` `:2744-2764`; gather `:2766`; response build `:2767` (`EvaluateReadinessResponse(readiness=list(readiness))`).
- Cache-key inputs already in scope: `rule` (`:2730`, `"exit"`/`"entry"`), `request.strategy_id`, `request.symbols`, and the DB row `row` from `get_by_owner_and_id` (`:2716-2717`) whose `row["definition_json"]` feeds the fingerprint.
- Fingerprint helper to **reuse** (never a new hash): `_definition_fingerprint(definition_json: dict)` at `servicer.py:4389`; canonical call form `_definition_fingerprint(strategy_row["definition_json"])` at `:2044` / `:641`.
- Bar-epoch source: bars are ascending, newest is `bars[-1].time.seconds` (paging keyed on `(b.time.seconds, b.time.nanos)`, `:1060-1069`; `_compute_opportunities` anchors "the newest bar seen across the whole compute", `:3418`). `bars` from `_fetch_bars_paged` (`:2748`); `benchmark_bars` from `_load_benchmark_bars_windowed` (`:2737`).
- Repo mirror target: `app/repositories/opportunities.py` `replace_for_user` (`:41`), `read` (`:77`); repos are wired in `servicer.__init__` as `Repo(db_pool) if db_pool else None` (`:384-431`, `_opportunities_repo` at `:425`). Reuses the existing pool (F-06, budget 2).
- Config getter: `self._cfg.get_int_present` (`app/config/watcher.py:103`).
- No new outbound gRPC call — the SLOW path reuses the already-propagating `_fetch_bars_paged` / evaluator / indicator calls; C-03 header trio already forwarded via `propagation_meta` (`:2706-2710`). DB-only repo needs no propagation.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **New repo** `app/repositories/readiness_cache.py` — `ReadinessCacheRepository(db_pool)` mirroring
   `OpportunitiesRepository`, with:
   - `read_many(user_id, strategy_id, rule, symbols: list[str]) -> dict[str, dict]` — SELECT the rows
     for the `(user_id, strategy_id, rule, symbol IN …)` set; return keyed by `symbol` with
     `def_fingerprint`, `bar_epoch`, `readiness_json`, `computed_at`, `valid_until`.
   - `upsert_many(rows: list[dict]) -> None` — literal `INSERT INTO analysis.readiness_cache
     (user_id, strategy_id, rule, symbol, def_fingerprint, bar_epoch, readiness_json, computed_at,
     valid_until) VALUES … ON CONFLICT (user_id, strategy_id, rule, symbol) DO UPDATE SET
     def_fingerprint=EXCLUDED.def_fingerprint, bar_epoch=EXCLUDED.bar_epoch,
     readiness_json=EXCLUDED.readiness_json, computed_at=EXCLUDED.computed_at,
     valid_until=EXCLUDED.valid_until`. **Every NOT NULL column supplied**; an empty-bars symbol
     writes `readiness_json = {}` (never NULL) — fails.md INSERT-vs-NOT-NULL trap (context.md round-2
     adversary #4). Serialize `readiness_json` with the same `json`/`jsonb` convention `opportunities.py`
     uses.
2. **Wire the repo** in `servicer.__init__` next to `_opportunities_repo` (`:425`):
   `self._readiness_cache_repo = ReadinessCacheRepository(db_pool) if db_pool else None`.
3. **Read the window once** in `EvaluateReadiness` (after `rule` is set, `:2730`):
   `stale_after = self._cfg.get_int_present("analysis.readiness.stale_after_seconds", 30)` and
   `fingerprint = _definition_fingerprint(row["definition_json"])`.
4. **Load cache rows** for the request set (one query) before the gather:
   `cached = await self._readiness_cache_repo.read_many(caller_user_id, request.strategy_id, rule,
   list(request.symbols))` (guard `_readiness_cache_repo is None` → `cached = {}`, the no-DB test path).
5. **Make `_readiness_for` a two-path state machine** (design.md § FR-1):
   - **FAST**: `c = cached.get(symbol)`; if `c is not None` AND `c["def_fingerprint"] == fingerprint`
     AND `now() < c["valid_until"]` → return `_symbol_readiness_from_json(c["readiness_json"], symbol)`
     **without acquiring `_bars_fetch_sem`, without `_fetch_bars_paged`, and without
     `evaluate_conditions_traced`**. (Add a small helper that rebuilds a `SymbolReadiness` proto from
     the stored JSON — reuse the same field set `_readiness_to_proto` produces so a FAST-served row is
     byte-identical to a freshly computed one, `@AC-1/@AC-2/155`.)
   - **SLOW** (miss / fingerprint mismatch / `valid_until` elapsed): run the **existing**
     `:2745-2764` body (acquire sem, fetch bars, **always** `evaluate_conditions_traced`), then stage
     a cache row: `bar_epoch = max(bars[-1].time.seconds if bars else 0, benchmark_bars[-1].time.seconds
     if benchmark_bars else 0)`, `readiness_json` = the JSON form of the proto (`{}` when the trace is
     empty), `computed_at = now()`, `valid_until = now() + timedelta(seconds=stale_after)`,
     `def_fingerprint = fingerprint`. **No slow-path `bar_epoch`-reuse** — always re-evaluate on any
     `valid_until` miss (design.md § FR-1; round-3 adversary #1: a same-`time.seconds` intraday 1d bar
     update must not freeze a day-one verdict).
6. **Persist the SLOW rows once** after the gather (collect staged rows from the coroutines, then a
   single `upsert_many`) — keep the write out of the per-symbol hot path; a write failure is
   best-effort (`try/except → log.warning`, mirroring the opportunity recompute at `:3149`) and never
   fails the read.
7. **Response `computed_at` (FR-5)**: set `EvaluateReadinessResponse(readiness=…, computed_at=…)`
   where `computed_at` = the **oldest (min)** per-symbol `computed_at` among the served rows
   (FAST rows contribute their cached `computed_at`; SLOW rows contribute `now()`) — the response is
   never presented fresher than its oldest served symbol. If `request.symbols` is empty or no rows
   are served, leave `computed_at` unset. **This min-of-computed_at rule is a spec-level realization
   of FR-5 not fully pinned in design.md** — recorded here (P-03), confirm at impl-spec review.

**Verification** (lint + the paired test in Step 7 provide the coverage gate):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Ruff clean. `grep -n "get_int_present(\"analysis.readiness.stale_after_seconds\"" services/xstockstrat-analysis/app/handlers/servicer.py` confirms the key is read via the presence-aware getter (F-07 — no hardcoded window). `grep -n "_definition_fingerprint(row\[.definition_json.\])" services/xstockstrat-analysis/app/handlers/servicer.py` confirms the existing fingerprint helper is reused (no new hash).

---

### Step 7 — test: FR-1 readiness cache (AC-1, AC-2)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness_cache.py` — create

**Reviewers**: `xstockstrat-analysis` owner — determinism, no stale-as-fresh

**Codebase Evidence**:
- Existing analysis test homes: `services/xstockstrat-analysis/tests/conftest.py`, `tests/test_readiness_opportunities_source_symbol.py`, `tests/test_opportunity_refresh.py` (real fixtures for readiness/opportunity paths to reuse).
- Coverage gate: `pytest --cov=app --cov-fail-under=40` (spec-template coverage table; analysis threshold 40%).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Author the test to **fail first** against the pre-Step-6 tree (no `ReadinessCacheRepository` /
   no FAST path). RED assertions:
   - **AC-1** (`@AC-1`): given a `readiness_cache` row for `(user, strategy S, rule=entry, [AAPL,
     MSFT])` with matching `def_fingerprint` and `valid_until > now()`, a second `EvaluateReadiness`
     serves from cache with **no** `_fetch_bars_paged` / `GetBars` and **no** `evaluate_conditions_traced`
     call (assert via a spy/mock on the marketdata stub + evaluator), and the returned
     `SymbolReadiness` values equal the cached ones. Assert `response.computed_at` is within
     `stale_after_seconds` of now (`@FR-5`).
   - **AC-2** (`@AC-2`): a cached row whose `bar_epoch = E`; when the newest served bar advances to
     `E+1` — model this as the SLOW path being taken because `valid_until` has elapsed (or the
     fingerprint differs) — a fresh compute runs (`evaluate_conditions_traced` IS called) and the
     upserted row's `bar_epoch` reflects `max(evaluated, benchmark)` newest bar. Include a
     **benchmark-only** new-bar case: the evaluated symbol dormant but the benchmark prints a newer
     bar → `bar_epoch` picks up the benchmark's `time.seconds` (round-2 adversary #1).
2. Prefer extending `conftest.py` fixtures over new inline domain literals; a strategy-row / bars
   literal used by only this file stays inline (C-13 single-consumer — state that verdict). If a
   second test file later needs the same readiness-row literal, move it to `conftest.py` then.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest tests/test_readiness_cache.py -q && pytest --cov=app --cov-fail-under=40
```
The targeted file passes; the full suite holds ≥ 40% coverage. (`/sdd-execute` captures the RED run
before Step 6 and the GREEN run after.)

---

### Step 8 — service: FR-3 empty-universe compute-state (repository + gate + shared stamp helper)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunity_compute_state.py` — create
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — determinism, no stale-as-fresh, feature-158 durable-refresh preservation

**Codebase Evidence**:
- Empty-universe recompute today: `ListOpportunities` empty branch `servicer.py:3022-3034` — `if not rows:` → `if count_for_user(user_id) == 0:` (`:3023`) forces `_materialize_opportunities` (`:3025`); `replace_for_user` returns after DELETE without insert when `rows==[]` → `count_for_user` stays 0 → recompute every poll (recon.md:23).
- The **three** empty-yielding `replace_for_user` sites: `_materialize_opportunities` (cold) `:3135`; `_kick_opportunity_recompute._run` (background) `:3148`; `_opportunity_refresh_tick` (daily) `:3649`.
- `_opportunity_refresh_tick` re-anchoring (`schedule.advance`, `:3640`/`:3654`) must be untouched — feature-158 `@AC-8/@AC-9/158` (design.md Open Risks; the helper only adds an upsert *after* `replace_for_user`, never touching the schedule).
- Config getter `get_int_present` (`watcher.py:103`); repo wiring pattern (`servicer.py:384-431`); reuses the existing pool (F-06).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **New repo** `app/repositories/opportunity_compute_state.py` — `OpportunityComputeStateRepository(db_pool)`:
   - `get(user_id) -> dict | None` — SELECT `computed_at, valid_until` for `user_id`.
   - `upsert(user_id, valid_until) -> None` — literal `INSERT INTO analysis.opportunity_compute_state
     (user_id, computed_at, valid_until) VALUES ($1, now(), $2) ON CONFLICT (user_id) DO UPDATE SET
     computed_at = now(), valid_until = EXCLUDED.valid_until` (both NOT NULL columns supplied —
     context.md round-2 adversary #4).
2. **Wire the repo** in `servicer.__init__` next to `_opportunities_repo` (`:425`):
   `self._opportunity_compute_state_repo = OpportunityComputeStateRepository(db_pool) if db_pool else None`.
3. **Shared stamp helper** `_replace_and_stamp_compute_state(self, user_id, rows, propagation_meta=None)`
   (design.md § FR-3 preferred wiring):
   - `await self._opportunities_repo.replace_for_user(user_id, rows)`
   - if `not rows` (empty universe) AND `self._opportunity_compute_state_repo is not None`:
     `ttl = max(1, self._cfg.get_int_present("analysis.opportunity.empty_recompute_ttl_seconds", 30))`;
     `await self._opportunity_compute_state_repo.upsert(user_id, now() + timedelta(seconds=ttl))`
     (best-effort `try/except → log.warning`, mirroring `:3149`).
   Replace the `replace_for_user` calls at `:3135`, `:3148`, `:3649` with this helper. **Do not**
   alter the surrounding lock / `schedule.advance` / exception handling at any of the three sites.
4. **Pre-check in the empty branch** (`servicer.py:3022-3028`): before forcing
   `_materialize_opportunities` in the `count_for_user(user_id) == 0` branch, consult compute-state:
   ```python
   state = (await self._opportunity_compute_state_repo.get(user_id)
            if self._opportunity_compute_state_repo else None)
   if state is not None and now() < state["valid_until"]:
       # Fresh empty result — serve empty without a synchronous recompute (FR-3),
       # but still kick a background revalidate so an empty→non-empty transition
       # self-heals within ≈ one poll cycle (design.md § FR-3 self-heal).
       self._kick_opportunity_recompute(user_id, propagation_meta)
       # rows stays [] → falls through to pagination/enrichment (empty)
   else:
       await self._materialize_opportunities(user_id, propagation_meta)
       rows = await self._opportunities_repo.read(user_id, request.min_conviction, w, include_expired=False)
   ```
   Keep the existing `else:` stale branch (`:3029-3034`) unchanged.
5. No new outbound gRPC call (DB-only repo; the self-heal `_kick` reuses the existing propagating
   path). F-07: the TTL is read from config, never hardcoded.

**Verification** (lint here; coverage in Step 9):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Ruff clean. `grep -n "_replace_and_stamp_compute_state" services/xstockstrat-analysis/app/handlers/servicer.py`
returns the helper def **plus three** call sites (the three former `replace_for_user` sites).
`grep -n "get_int_present(\"analysis.opportunity.empty_recompute_ttl_seconds\"" …` confirms the config read.

---

### Step 9 — test: FR-3 empty-universe (AC-4)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunity_compute_state.py` — create

**Reviewers**: `xstockstrat-analysis` owner

**Codebase Evidence**:
- Existing opportunity-refresh test home: `tests/test_opportunity_refresh.py` (reuse its fixtures for
  the `ListOpportunities` / refresh-tick paths). Coverage gate `--cov-fail-under=40`.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. Fail-first RED assertions (pre-Step-8 tree recomputes every poll):
   - **AC-4** (`@AC-4`): a user whose universe legitimately yields **zero** opportunities. Drive
     `ListOpportunities` **4 times over the window** (with a fresh compute-state row after the first
     empty completion) and assert `_compute_opportunities` runs **at most once**; polls 2–4 serve the
     cached empty result without a synchronous `_materialize_opportunities` (spy the compute).
   - **empty→non-empty within one TTL** (design.md Open Risk): after the empty state is stamped, a
     user who gains a watchlist binding surfaces their first opportunity within ≤ `empty_recompute_ttl_seconds`
     — assert the self-heal `_kick` fired on the fresh-empty serve, and a subsequent poll after the
     background recompute returns the new row.
   - **compute-state stamped on all three empty paths**: cold `_materialize_opportunities`,
     `_kick._run`, and `_opportunity_refresh_tick` each upsert `opportunity_compute_state` on an empty
     completion (assert the row's `valid_until` advanced), and the daily-tick path still advances the
     schedule (feature-158 `@AC-8/@AC-9` untouched — assert `schedule.advance` still called).
2. C-13: reuse `test_opportunity_refresh.py` / `conftest.py` fixtures; single-consumer literals stay
   inline (state the verdict).

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest tests/test_opportunity_compute_state.py -q && pytest --cov=app --cov-fail-under=40
```
Targeted file passes; full suite ≥ 40%.

---

### Step 10 — service: FR-4 conditional live-enrichment memo

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — no stale-as-fresh (never persist a memoized price as current), cross-surface price parity

**Codebase Evidence**:
- `_enrich_opportunities_live` (unconditional today): `servicer.py:3053`; per-symbol `_enrich_symbol` `:3070`; `GetLatestPrice` seam `:3076-3083`; `GetBars` sparkline seam `:3090-3099`; both bounded by `_bars_fetch_sem`; failure leaves fields UNSET (`:3084`, `:3100`) — the `@AC-11` never-fabricate guard to preserve.
- Cross-surface parity (`@AC-12`) proof: `SignalReadiness.tsx:28` (`const { data: opps } = useOpportunities();`) + `:31` (consumes `opps?.opportunities`) — the Signal-detail panel makes **no** direct `GetLatestPrice` call, so a server-side memo introduces no divergence (design.md § FR-4; round-3 adversary #3).
- Config getter `get_int_present` (`watcher.py:103`).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Add a process-lifetime **success-only** per-symbol memo (design.md § FR-4): a dict
   `self._live_enrich_memo: dict[str, tuple[float, dict]]` initialized in `servicer.__init__`, mapping
   `symbol → (monotonic_expiry, {"last_price", "prev_close", "spark"})`. Read the TTL per pass:
   `ttl = self._cfg.get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 10)`.
2. In `_enrich_symbol` (`:3070`): **before** the two RPCs, check the memo — if an unexpired entry
   exists for `symbol` (`monotonic() < expiry` and `ttl > 0`), apply its `last_price`/`prev_close`/
   `spark` to `targets` and **return early — skipping both `GetLatestPrice` and `GetBars`** (`@AC-5`).
3. On a memo **miss**, run the existing fetch body unchanged, then store the entry **only when the
   fetch succeeded** (both `last_price` obtained AND `spark` obtained) — a `GetLatestPrice`/`GetBars`
   failure or an unavailable quote is **never memoized**, so it drops within the TTL and never
   persists a memoized price as current (`@AC-11`; round-2 adversary #5). `ttl == 0` disables the
   memo (always fetch).
4. Do **not** change the ranking/ORDER BY path — enrichment stays read-time-only, after ranking
   (`:3045-3047`), so the live quote never becomes a ranking input (`@AC-14`).

**Verification** (lint here; coverage in Step 11):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Ruff clean. `grep -n "get_int_present(\"analysis.opportunity.live_enrich_ttl_seconds\"" …` confirms the
config read (F-07).

---

### Step 11 — test: FR-4 conditional enrichment (AC-5, AC-11)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_enrich_memo.py` — create

**Reviewers**: `xstockstrat-analysis` owner

**Codebase Evidence**:
- `_enrich_opportunities_live` / `_enrich_symbol` under test at `servicer.py:3053-3116`; marketdata
  stub methods `GetLatestPrice` / `GetBars` are the mock seams. Coverage gate `--cov-fail-under=40`.

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. Fail-first RED (pre-Step-10 tree fetches on every read):
   - **AC-5** (`@AC-5`): two consecutive `_enrich_opportunities_live` passes for the same symbol
     within `live_enrich_ttl_seconds`; assert the marketdata `GetLatestPrice` **and** `GetBars` mocks
     are called on pass 1 and **not** on pass 2 (memo hit), and pass 2's opportunity carries the same
     `live_price`/sparkline. Then advance past the TTL (or set `ttl=0`) and assert the RPCs fire again
     (`issues them only when stale`).
   - **AC-11** (never stale-as-fresh): a first pass where `GetLatestPrice` fails/omits the price →
     nothing memoized; a second pass within the TTL still issues the RPC (no memoized price served),
     and if the quote is now available the price appears — a memoized **miss** never suppresses a
     recovered price (round-2 adversary #5).
2. C-13: single-consumer literals inline (state the verdict); reuse `conftest.py` marketdata-stub
   helpers if present.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest tests/test_live_enrich_memo.py -q && pytest --cov=app --cov-fail-under=40
```
Targeted file passes; full suite ≥ 40%.

---

### Step 12 — service: FR-2 client `staleTime` on the readiness `useQueries`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, no stale data shown as fresh, no whole-list refetch

**Codebase Evidence**:
- Target: `WatchlistReadiness.tsx:193` `useQueries` — `grep -n "useQueries\|staleTime\|queryKey" …` shows `:193` `useQueries`, `:195` `queryKey: ['readiness', strategyId, [...symbols].sort()]`, and **no** `staleTime`/`refetchInterval`/`gcTime` today.
- Canonical **per-query** override to copy: `src/app/insights/opportunities/page.tsx:136` `staleTime: 30_000` (inside a `useQuery` at `:129`). Must be per-query, **not** a `QueryClient` default — a default would force a whole-list refetch (`@AC-6 @feature-167`; design.md § FR-2).

**TDD**: `red-green required` (paired e2e in Step 13)

**Covers**: `—`

**Instructions**:
1. In the `useQueries` config object at `WatchlistReadiness.tsx:193-195`, add `staleTime: 30_000` to
   each query descriptor (align with the 30s Opportunities cadence and the 15s poll). Do **not** add
   it to `src/lib/queryClient.ts` defaults, and do **not** change `queryKey` (`@AC-6/167` — the
   single-row-patch invalidation contract must be untouched).
2. No design-role token / primitive / a11y surface changes (C-17 not triggered — logic-only prop).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "staleTime" services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx
grep -n "staleTime" services/xstockstrat-ui/src/lib/queryClient.ts
```
Lint clean; `staleTime` present in `WatchlistReadiness.tsx` and **absent** from `queryClient.ts`
defaults (no whole-list refetch regression).

---

### Step 13 — test: FR-2 remount within `staleTime` (AC-3, Playwright e2e)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner

**Codebase Evidence**:
- Existing readiness e2e spec + fixtures (C-12 — reuse, don't recreate): `e2e/insights/watchlists.spec.ts`
  (readiness rollup); fixture factory `symbolReadiness` at `e2e/fixtures/opportunities.ts:236`
  (INVENTORY.md:30, proto `xstockstrat.analysis.v1.SymbolReadiness`); the `evaluateReadiness` mock
  handler in `e2e/mock-backend.ts` (INVENTORY.md:30/55); auth helpers `e2e/helpers/auth.ts`.
- `xstockstrat-ui` has no unit coverage threshold — Playwright e2e is the gate (spec-template
  coverage table).

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. Add a spec (RED against the pre-Step-12 tree, which refetches on remount): with the readiness
   `staleTime` at 30s and the detail pane rendered ≈10s ago, switch away from and back to the same
   watchlist and assert the `evaluateReadiness` mock handler is **not** hit a second time (count the
   BFF `evaluateReadiness` calls, or assert no second request via a route counter). Reuse the
   `symbolReadiness` fixture + `evaluateReadiness` handler and `helpers/auth.ts` — no inline mock
   literals (C-12).
2. If a request-count seam does not already exist in `mock-backend.ts`, add a minimal counter for the
   `evaluateReadiness` handler (a scenario one-off, exempt from fixture centralization) rather than a
   new domain fixture.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- e2e/insights/watchlists.spec.ts
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/watchlists.spec.ts
```
The spec passes (no second `evaluateReadiness` request on remount within `staleTime`); imports come
from the fixture/auth homes (C-12).

---

## Deviation Log

### Step 6 — bar_epoch benchmark contribution over the benchmark dict

**Disposition**: spec-sketch imprecision, corrected. The Step 6 sketch wrote
`benchmark_bars[-1].time.seconds` as if `benchmark_bars` were a list; `_load_benchmark_bars_windowed`
returns a `{source_symbol: [bars]}` dict (or None). Implemented `_benchmark_epoch()` as the max
last-bar `time.seconds` across `benchmark_bars.values()`, preserving the `max(evaluated, benchmark)`
intent. No behavior change from the design; covered by the benchmark-only bar_epoch test.

### Steps 1–2 — proto codegen via Docker + TS compile via pnpm prepare

**Disposition**: CI-equivalent fallback. `buf` is not on the host; ran `./scripts/localenv-setup.sh`
(builds the pinned `Dockerfile.codegen` and runs `buf lint` + `buf breaking` + `buf generate` +
grpcio-tools inside the container — all green). The container's final `tsc` compile of `gen/ts` failed
for lack of `node_modules`, so the compiled JS in `gen/ts/dist` was produced on the host via
`pnpm install --frozen-lockfile` (its `gen/ts` `prepare` hook runs `tsc`). Verified
`git diff packages/proto/gen/` is limited to `analysis/v1` (source + dist), matching CI's stale-stub
check; `buf lint`/`breaking` also re-run in CI's proto-lint job.
