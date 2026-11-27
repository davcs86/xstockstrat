# Implementation Spec: pipeline-job-graph

**Status**: `pending`
**Created**: 2026-11-27
**Feature**: `docs/roadmap/features/367-pipeline-job-graph/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/pipeline-job-graph`

---

## Execution Summary

The steps follow design.md § Build order. Design decisions are cited as `D-n` (debate.md); a step
that says "as design.md § X" means that section is the authority for the behaviour and this spec
adds only the file, symbol and test seams.

1. **Config (Steps 1-3, one atomic unit).** Six `analysis` keys: seed (config `060`), `SetConfig`
   bounds, the `JobGraphSettings` reader, the wiring registry, the regenerated stored set, the
   read-classification rows and the docs rows. One commit, because CI's whole-tree wiring check
   (`node scripts/check-config-wiring.mjs --final`) fails on a seeded-unread or read-unseeded key.
2. **Schema (Step 4).** Analysis migration `031`: two tables and their indexes.
3. **Bounded database access (Steps 5-6).** `bounded_txn` and the control-pool reset callback, with
   the real-Postgres tests that pin the asyncpg behaviour the design rests on. These gate the engine.
4. **Repository (Steps 7-8).** `PipelineJobsRepository` and its real-Postgres tests.
5. **Engine (Steps 9-12).** Pure primitives first (outcomes, classifier, backoff, registry), then
   the attempt, stop path, three loops and worker.
6. **Retention prune (Steps 13-14).** The only production job kind.
7. **Telemetry (Steps 15-16, one atomic unit).** Adding the loop name turns an existing
   all-members tick test red until its driver emits a pipeline tick.
8. **Startup wiring (Steps 17-18, one atomic unit).** Second pool, worker and three boot tasks.
9. **Docs (Step 19).**

**Consumer surfaces (C-14).** None. The product spec marks the feature internal and platform-only:
no `xstockstrat-ui` segment and no `xstockstrat-agent` tool consumes it, and FR-9 requires that no
RPC response changes. No UI or agent step exists; that is a decision, not an omission.

**Proto.** No proto change, so no `proto` or `proto-gen` step.

## Scenario Coverage (C-15)

| Scenario | Steps |
|---|---|
| `@AC-1` | 8 |
| `@AC-2` | 8 (two claimers), 12 (handler runs once) |
| `@AC-3` | 8 (reap, attempt count 2), 12 (takeover on a fake clock) |
| `@AC-4` | 8 (fenced report rejected, finish time kept), 16 (exactly 1 succeeded attempt counted) |
| `@AC-5` | 8 (ready again, not claimable before `next_attempt_at`), 10 (delay at least 5 s), 12 (retry delay through the worker) |
| `@AC-6` | 8 (state `failed`, error class `permanent`), 10 (classifier), 12 (through the worker) |
| `@AC-7` | 8 (attempt 5 ends `dead`), 10 (unknown error is transient), 12 (through the worker) |
| `@AC-8` | 8 (park and settle), 12 (parent re-claimed) |
| `@AC-9` | 8 (verdict propagates), 12 (handler does not run again) |
| `@AC-10` | 8 |
| `@AC-11` | 8 |
| `@AC-12` | 8 (prune batch), 14 (handler) |
| `@AC-13` | 8 (ready stats), 16 (exported gauges) |
| `@AC-14` | 3 (kill-switch read), 12 |
| `@AC-15` | 14 |
| `@AC-16` | 12 |
| `@AC-17` | 12 |
| `@AC-18` | 8 (prune batch), 14 (handler) |

## Spec-time decisions

Names and seams the design leaves open. Each is this spec's choice and is open to challenge at
`/sdd-review impl-spec`.

- **S-1. Repository method names.** design.md names the class and file only. Step 7 names the
  methods `enqueue`, `claim`, `reap`, `heartbeat`, `report`, `park`, `settle_batch`, `list_by_run`
  and `ready_stats`, plus the module-level `prune_batch`.
- **S-2. `prune_batch` is a module-level function.** design.md § Retention prune and § Handler
  database contract name "the repository module's `prune_batch` function" (D-61). A function
  taking `conn` lets `app/jobs/` import that one name without holding a repository instance.
  Called with `cutoff=None` it computes the cutoff on the database clock and returns it, so a
  handler reads one cutoff per DELETE loop through the one permitted import. That return value is
  this spec's choice; the design is silent on how the handler obtains the loop cutoff.
- **S-3. `control_pool_reset` lives in `app/repositories/read_budget.py`.** design.md says the
  control pool is built by a helper in `main.py` and that Step 6's tests pin the reset callback
  before the engine exists. The callback therefore lands in Step 5; `main.py` passes it in Step 17.
- **S-4. Boot task names.** `pipeline-claim`, `pipeline-maintenance`, `pipeline-heartbeat`. These
  are `asyncio` task names. The telemetry loop name stays the single `pipeline_worker` (D-11).
- **S-5. File names.** `app/jobs/retention_prune.py`, and the test files named in each test step.
  design.md names only `tests/test_job_handler_contract.py`.
- **S-6. The daily ensure is unconditional.** It enqueues `pipeline.retention_prune` whether or not
  the running registry has that kind, as design.md § Retention prune states. A test registry
  without the kind leaves that row `ready`.
- **S-7. The runner-versus-heartbeat test is an engine test.** design.md lists "a runner that
  waited for an in-flight heartbeat batch records no false loss" among Step 4's real-Postgres
  tests (D-61). It lands in Step 12.
- **S-8. Config docs rows land in Step 1.** design.md § Config puts the docs rows in the config
  commit (C-10); they are in Step 1's **Files**, not Step 19's.
- **S-9. Not in design.md or recon.md, found by search.** Three pins the build must update:
  `scripts/migration-rerun.py:1114` hard-codes the analysis tip `30` (Step 4);
  `tests/test_config_zero_clamps.py:96-97` requires `AC6_ROWS` to equal `FR3_KEYS` (Step 3);
  `tests/test_supervision.py:143-148` pins the number of `spawn(` calls in `app/main.py` (Step 18).
  A fourth, found at `/sdd-review impl-spec`: `tests/test_analysis_tick_telemetry.py:164-166`
  requires the emitted tick records to cover every `telemetry.Loop` member (Steps 15 and 16).
- **S-10. Seams the design leaves to the build.** Named in their steps and listed here so none is
  a silent choice: `lane()` and the `lane_held` parameters on repository methods (how the control
  lane is passed); `ClaimedJob.db` (the handler's `job.db()` entry point); `start_listening` (the
  `cfg.on_change` registration); `set_pipeline_ready_stats(at=)` (the gauge snapshot setter);
  and `heartbeat()` taking no `conn=`, because it never runs inside a caller's transaction.
- **S-11. Step 1 lists eight files.** The design requires the seed, bounds, stored set and docs
  rows in one commit (D-25, C-10), so the step cannot be split below the usual five-file guide.

## Step Dependencies

- **Steps 1+2+3 land together.** Triggers (`step-constraints.md` §C): a seeded config key needs its
  reader and wiring check in the same commit; and Step 2's five `int_positive` reads turn
  `tests/test_config_read_classification.py:206-212` (`test_rule2_key_sets_match_classification`)
  red until Step 3 classifies them. One backend surface; two services, as in feature 366's
  Steps 4-6.
- **Config migration number.** `060` is the next free number on `origin/main-dev` today (`059` is
  the highest). Feature 345 (`authelia-sso`, `implementation-ready`) also plans
  `060_authelia_sso_keys` (`docs/roadmap/features/345-authelia-sso/implementation-spec.md:254-260`).
  golang-migrate skips a lower version that lands after a higher one, and CI's
  `migration-order-gate` (`scripts/check-migration-order.py`) refuses it. Whichever feature merges
  first keeps `060`; the other takes the then-next number at its own merge. Re-check at execute
  (Step 1 item 1) and before the integration PR. No `merge-order.md` row exists yet for 367 against
  345; `/sdd-review pipeline-job-graph impl-spec` owns adding it.
- **Stored set.** Step 1 regenerates `scripts/config-wiring-stored.json`. Regenerate it again after
  any `origin/main-dev` merge that brings in another config migration (`inputs_sha256`), and after
  a renumber of `060`.
- Step 4 requires nothing from Steps 1-3. Steps 7-19 require Step 4 (the tables).
- Step 5 [service] is covered by Step 6 [test]. **Step 6 gates Step 9 onward**: if one of its
  asyncpg pins fails, apply the matching fallback from design.md § Open Risks (first item), record
  it in the Deviation Log, and only then continue.
- Step 7 requires Steps 4 and 5. Step 8 [test] covers Step 7.
- Step 9 requires Step 2 (it extends `app/engine/job_graph.py`). Step 10 [test] covers Step 9.
- Step 11 requires Steps 5, 7 and 9. Step 12 [test] covers Step 11.
- Step 13 requires Steps 7 and 11. Step 14 [test] covers Step 13.
- Step 15 requires Steps 7, 11 and 13 (it adds record calls to them). Step 16 [test] covers Step 15.
- **Steps 17+18 land together.** Trigger: Step 17 adds three `spawn(` calls to `app/main.py`, which
  turns `tests/test_supervision.py:143-148` red (`source.count("spawn(") == len(_BOOT_TASK_NAMES)`);
  Step 18 repairs it. Step 17 requires Steps 5, 7, 11, 13 and 15.
- Step 19 requires Steps 4, 11, 13, 15 and 17, because it documents their behaviour.
- **Open risks carried from design.md, with their owners:**
  - asyncpg behaviour (terminate wakes an in-flight await; `create_pool(reset=…)`; `min_size=0`):
    Step 6. `asyncpg.create_pool` on the locked 0.31.0 accepts `reset` and `min_size`.
  - PgBouncer queueing cannot be tested in CI. A frozen backend stands in for it (Step 6). The
    measurement is deferred to program feature 3, `strategy-eval-projection`, through
    `analysis.pipeline.db.duration{phase=wait}` (Step 15).
  - No requeue until program feature 4, `pipeline-cutover`. The manual recovery SQL ships in
    Step 19 and is pinned by Step 8.
  - Hazards H1 and H2 (D-33) and executor-thread handlers: program feature 3. No step here.
  - The remaining accepted risks are documented in Step 19's page and need no code.
- **Durable-suite promotion (C-16)** runs in the `/sdd-execute` integration PR, not in a step. It
  covers 367's scenarios and the EXTEND cases in design.md § Business Rules Touched: `@AC-4
  @feature-259` (three pipeline boot tasks), `@AC-1 @AC-4 @AC-6 @feature-244` (five int keys read
  through `int_positive`), `@AC-14 @feature-295` (six keys seeded in both environments) and `@AC-3
  @feature-337` (new instruments carry `host.provider`).
- **Verification runs recorded at spec time** (ledger, fix-legacy-formula-authors): on
  `origin/main-dev@19d095b`, `node scripts/check-config-wiring.mjs --final` and `--doc-check`,
  `python3 scripts/check-watcher-copies.py`, `python3 scripts/check-context-map.py`, `python3
  scripts/check-migration-order.py origin/main-dev`, and `ruff check . && ruff format --check .` in
  analysis all exit 0. `uv run --extra dev pytest` on five analysis files, including the `real_pg`
  ones, passes (77 tests; PostgreSQL 16 binaries are present). The `xstockstrat-config` commands
  were **not** run: its `node_modules` is not installed in this sandbox.
- **`uv run --extra dev`.** In this sandbox a bare `uv run pytest` resolved a `pytest` outside the
  service environment and failed on `import asyncpg`. Every analysis command below passes
  `--extra dev`.

---

### Step 1 — config: seed the six `analysis.pipeline.*` keys (config `060`), their SetConfig bounds, the stored set and the docs rows

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/060_analysis_pipeline_keys.up.sql` — create
- `services/xstockstrat-config/migrations/060_analysis_pipeline_keys.down.sql` — create
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/__tests__/analysisPipelineKeysSeedMigration.test.ts` — create
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-edited)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed rows only)
- `docs/patterns/config-governance.md` — modify (one new per-feature entry)

**Reviewers**: `xstockstrat-config` service owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`

**Codebase Evidence**:
- Last config migration: `059_trading_broker_paper_per_environment` (`ls services/xstockstrat-config/migrations | tail -2`). `060` is free on `origin/main-dev`; see Step Dependencies for feature 345.
- Multi-key seed precedent with a `bool` type: `migrations/052_alpaca_adaptive_rate_limit_keys.up.sql:4-17`, `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id) VALUES (…) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`. Its down (`052_….down.sql`) deletes by actor, `user_id IS NULL`, environment, value and an OR-list of keys; its header notes "the outer parentheses are load-bearing".
- Single-key int precedent: `migrations/056_analysis_live_only_cycle_max_days.up.sql` and `.down.sql`.
- Test precedents: `src/__tests__/alpacaAdaptiveRateLimitSeedMigration.test.ts` (multi-key, `HEAD` / `CONFLICT` / `ROW` regex) and `src/__tests__/liveOnlyCycleMaxDaysSeedMigration.test.ts`; both use `findOne` / `splitStatements` from `src/__tests__/migrationSql.ts`.
- Bounds registry: `const SCALAR_BOUNDS_REGISTRY` at `src/grpc/configServiceImpl.ts:115`, keyed `${namespace}.${relative key}` (`lookupScalarBounds`, `:194-196`). Last analysis entry: `'analysis.compute.max_worker_threads': { minValue: 1, maxValue: 16 },` at `:188`.
- Bounds test table: `TIMEOUT_KEY_FORMS` at `src/__tests__/setConfigScalarBounds.test.ts:299-321`, driven by the accept/reject loops at `:323-341` and the prefixed-form loop at `:343-`.
- Stored-set generator: `scripts/config-wiring-stored.py:1-6` (needs `DATABASE_URL`, `psql`, `migrate`). CI job `config-wiring-stored` (`.github/workflows/ci.yml:1444-1495`) regenerates it on `timescale/timescaledb:latest-pg16` with the `scripts/Dockerfile.migrate` image and uploads the result as the artifact `config-wiring-stored`.
- Row shape in the stored set: `scripts/config-wiring-stored.json` holds one object per (key, environment) with `file`, `value_type`, `default_value`, `consuming_service` (for example the `opportunity.live_only_cycle_max_days` rows).
- Docs: `services/xstockstrat-analysis/CLAUDE.md:211` (§ Config Keys Consumed; last row `patterns.indicator_bucket_count` at `:292`); `docs/patterns/config-governance.md:148-152` (§ Per-Feature Registered Keys, "Newest first"), with feature 366's entry at `:221-240` as the shape.
- Ledger: `SCALAR_BOUNDS_REGISTRY` bounds fire only at the `SetConfig` write edge (insights, 2026-09-06). A lower bound must match the reader's getter (insights, 2026-09-07): all five int keys are read through `int_positive`, so each lower bound is at least 1.

**Lands with**: `Step 2, Step 3`

**TDD**: `red-green required (the bounds rows: add the `setConfigScalarBounds.test.ts` rows first and see them fail before editing `SCALAR_BOUNDS_REGISTRY`; the seed SQL itself is N/A and its static test is written alongside)`

**Covers**: —

**Instructions**:
1. **Number.** `ls services/xstockstrat-config/migrations | tail -2`; use highest + 1 (`060` today).
   Any other number goes in the Deviation Log, and every `060` below reads as that number.
2. **Up.** One `INSERT` in the 052 shape, namespace `analysis`, twelve tuples: each key once for
   `staging` and once for `production`, `user_id NULL`, `consuming_service`
   `'xstockstrat-analysis'`, actor `'system:config-migration-feature-pipeline-job-graph'`, ending
   `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. Stored keys are
   namespace-relative. `value_data` equals `default_value` equals the code default:

   | Stored key | `value_type` | Value | Description must state |
   |---|---|---|---|
   | `pipeline.worker_enabled` | `bool` | `true` | Kill switch: when false no job is claimed, the daily prune job is not enqueued and expired leases are not reaped; running jobs finish |
   | `pipeline.worker_concurrency` | `int` | `4` | Jobs one instance runs at once; bounds `[1,16]`; 0 or less reads as 4 |
   | `pipeline.poll_interval_ms` | `int` | `1000` | Delay between claim polls while work flows; idle polling backs off to `max(poll_interval_ms, 5000)` ms; bounds `[200,5000]`; 0 or less reads as 1000 |
   | `pipeline.lease_seconds` | `int` | `60` | Lease length without a heartbeat; bounds `[45,600]`; 0 or less reads as 60 |
   | `pipeline.max_attempts` | `int` | `5` | Attempts before a job ends `dead`; bounds `[2,20]`; 0 or less reads as 5 |
   | `pipeline.retention_days` | `int` | `7` | Age at which succeeded jobs are pruned; failed, dead and blocked jobs are kept `max(30, retention_days)` days; bounds `[1,90]`; 0 or less reads as 7 |

   Header comment in the 052 style: file name, service, feature slug, and that stored keys are
   namespace-relative.
3. **Down.** One `DELETE` restricted by `namespace = 'analysis'`,
   `environment IN ('staging', 'production')`, `user_id IS NULL`, the actor, and a parenthesised
   OR-list pairing each key with its seeded value, for example
   `(key = 'pipeline.worker_enabled' AND value_data = 'true') OR (key = 'pipeline.worker_concurrency' AND value_data = '4') OR …`.
   A row an operator changed survives a rollback.
4. **Bounds.** Directly after `configServiceImpl.ts:188` add five entries:
   `'analysis.pipeline.worker_concurrency': { minValue: 1, maxValue: 16 }`,
   `'analysis.pipeline.poll_interval_ms': { minValue: 200, maxValue: 5000 }`,
   `'analysis.pipeline.lease_seconds': { minValue: 45, maxValue: 600 }`,
   `'analysis.pipeline.max_attempts': { minValue: 2, maxValue: 20 }`,
   `'analysis.pipeline.retention_days': { minValue: 1, maxValue: 90 }`. One comment of at most two
   lines: the lease floor of 45 s is what lets a holder survive two failed renewals at the fixed
   7.5 s heartbeat period (design.md § Lease timing). `pipeline.worker_enabled` is a bool and gets
   no entry. Do not touch `CROSS_KEY_ORDERING`.
5. **Seed test** `analysisPipelineKeysSeedMigration.test.ts`, mirroring
   `alpacaAdaptiveRateLimitSeedMigration.test.ts`:
   - the up is exactly one statement, starting with the `HEAD` column list and ending with the
     `CONFLICT` clause;
   - the tuples are exactly the six keys times `staging` and `production`, with the types and values
     of the table above, each with a non-empty description;
   - no stored key repeats its namespace (`'analysis.pipeline.…'` is absent);
   - each seeded int lies inside its bounds (a local table mirroring item 4);
   - the down is exactly one `DELETE` restricted by the actor, `user_id IS NULL`,
     `namespace = 'analysis'`, and each key's value pair.
6. **Bounds test.** Add five `{ ns: 'analysis', key: 'pipeline.…', field: 'intVal', min, max }`
   rows to `TIMEOUT_KEY_FORMS` (`setConfigScalarBounds.test.ts:299-321`). The existing loops then
   assert accept-at-bounds, reject-just-outside and the prefixed-form refusal for each.
7. **Stored set.** Regenerate `scripts/config-wiring-stored.json` with
   `scripts/config-wiring-stored.py`; never edit the JSON by hand. Routes, in order of preference:
   - the CI-equivalent Docker route (`.github/workflows/ci.yml:1468-1476`: the
     `timescale/timescaledb:latest-pg16` service and the `xstockstrat-migrate-ci` image);
   - the `config-wiring-stored` artifact of a CI run on the pushed branch (record the run URL in
     `context.md`);
   - a throwaway local PostgreSQL 16, the route feature 366 used under an operator ruling.
   The first and third start a database for artifact generation, so name the route at the Phase-2
   confirmation. If no route works the unit is blocked (P-03). The expected diff is `inputs_sha256`
   plus twelve rows whose `file` is `060_analysis_pipeline_keys.up.sql`.
8. **Docs rows (C-10).**
   - `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed: six rows after `:292`, each
     with type, default, bounds, reader (`app/engine/job_graph.py:JobGraphSettings`), "read fresh at
     each use", "seeded by config migration `060`", and for the int keys "read via `int_positive`,
     then clamped to the bounds with one WARN per distinct clamped value".
   - `docs/patterns/config-governance.md`: a `### feature 367 — pipeline-job-graph
     (`xstockstrat-config` / `xstockstrat-analysis`)` entry directly under the intro at `:152`
     (newest first), in feature 366's shape: one paragraph, the actor sentinel, the down's rule,
     "Approval: owner + config team", then the table `Namespace | Key | Type | Default | Reader |
     Bounds | Notes` with six rows. Edit no earlier entry.

**Verification**: Step 3's combined gate for the Steps 1+2+3 unit, which includes this step's
config, stored-set and wiring commands.

---

### Step 2 — service: `JobGraphSettings` reader and the wiring registry entries

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/job_graph.py` — create
- `scripts/config-wiring.json` — modify (`registry.receivers` only)

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/engine/job_graph.py`: **Not found** — created by this step.
- Int read form: `def int_positive(cfg, key: str, default: int) -> int` at `app/config/watcher.py:72`, used as `int_positive(self._cfg, "fundsignal.run_interval_hours", 24)` (`app/engine/fundsignal_loop.py:148`).
- Bool read form: `self._cfg.get_bool("fundsignal.enabled", default=False)` (`app/engine/fundsignal_loop.py:147`); `def get_bool(self, key: str, default: bool = False)` at `app/config/watch_core.py:223`.
- Reads are fresh per call: `WatchCore._lookup` reads `self._snapshot` at each call (`app/config/watch_core.py:197-203`).
- Wiring attribution: `scripts/config-wiring-py-reads.py:143-145` records the receiver as the callee name for a bare call (`int_positive`) and as the unparsed object for an attribute call (`self._cfg`). `scripts/config-wiring.json:71` (`registry.receivers`) maps `"<file>:<receiver>"` to a namespace; analysis precedents at `:85-86` (`…/live_loop.py:int_positive`, `…/live_loop.py:self._cfg`). A read with no entry is an `unattributed` finding, which gates (`scripts/check-config-wiring.mjs:691`).
- `registry.receivers` is not the findings baseline (`scripts/config-wiring.json:5`, `"findings": []`). No baseline entry is added: a key seeded and read under the same string produces no finding (ledger fails, fix-marketdata-dead-symbol-ingest).
- The gate compares a literal default with the seeded `default_value` (`scripts/check-config-wiring.mjs:538-544`, `defaultMatches`), so each read passes its default as a literal.
- `tests/test_config_read_classification.py:177-179` rejects a clamp read whose key is not a string constant, and `tests/test_config_zero_clamps.py:84-86` evaluates the read's default expression in the reader module's namespace.
- `app/config/watch_core.py` and `app/config/live_limits.py` are byte-identical across services (`scripts/check-watcher-copies.py:19-29`). Do not edit either.

**Lands with**: `Step 1, Step 3`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `app/engine/job_graph.py` with a one-line module docstring and class `JobGraphSettings`:
   - `__init__(self, config_watcher)` stores it as `self._cfg` (the receiver name the registry
     entry below depends on) and an empty per-key record of the last clamped value warned about.
   - `worker_enabled() -> bool`: `self._cfg.get_bool("pipeline.worker_enabled", default=True)`.
   - `worker_concurrency()`, `poll_interval_ms()`, `lease_seconds()`, `max_attempts()`,
     `retention_days()`: each calls `int_positive(self._cfg, "<literal key>", <literal default>)`
     with defaults `4`, `1000`, `60`, `5`, `7`, then clamps to its bounds (`[1,16]`, `[200,5000]`,
     `[45,600]`, `[2,20]`, `[1,90]`).
   - A clamp that changes the value logs one WARN naming the FQN `analysis.pipeline.<key>`, the
     stored value and the value used. It logs again only when the stored value differs from the
     last one warned about for that key.
   - No caching: every call reads the watcher (PLAT-6, FR-9).
2. The config-key contract for this reader (C-05). Namespace `analysis`, live mechanism: the
   service's `WatchConfig` watcher, read at each use. Seed migration: config `060` (Step 1).

   | Key | `value_type` | Code default | Reader |
   |---|---|---|---|
   | `pipeline.worker_enabled` | bool | `true` | `app/engine/job_graph.py:JobGraphSettings.worker_enabled` |
   | `pipeline.worker_concurrency` | int | `4` | `…:JobGraphSettings.worker_concurrency` |
   | `pipeline.poll_interval_ms` | int | `1000` | `…:JobGraphSettings.poll_interval_ms` |
   | `pipeline.lease_seconds` | int | `60` | `…:JobGraphSettings.lease_seconds` |
   | `pipeline.max_attempts` | int | `5` | `…:JobGraphSettings.max_attempts` |
   | `pipeline.retention_days` | int | `7` | `…:JobGraphSettings.retention_days` |

3. `scripts/config-wiring.json`: add two `registry.receivers` entries beside the other analysis
   ones, both mapping to `"analysis"`:
   `"services/xstockstrat-analysis/app/engine/job_graph.py:int_positive"` and
   `"services/xstockstrat-analysis/app/engine/job_graph.py:self._cfg"`. Add nothing to `findings`.
4. Bounds are literals in this module mirroring `SCALAR_BOUNDS_REGISTRY`; they are the read-side
   clamp design.md § Config requires (a row written before the bounds existed, or by a migration,
   is not checked at `SetConfig`).

**Verification**: Step 3's combined gate for the Steps 1+2+3 unit.

---

### Step 3 — test: settings reader, read classification and the unit gate

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_job_graph_settings.py` — create
- `services/xstockstrat-analysis/tests/test_config_read_classification.py` — modify
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `FR3_KEYS` at `tests/test_config_read_classification.py:25-63`. `test_rule2_key_sets_match_classification` (`:206-212`) requires the clamp-read set to equal it in both directions. `test_rule6_every_fr3_key_has_a_test_literal` (`:233-238`) requires each key as a double-quoted literal in another `tests/*.py`.
- `AC6_ROWS` at `tests/test_config_zero_clamps.py:34-70`, rows `("<key>", "int", <effective>)`; `test_ac6_table_covers_every_fr3_key` (`:96-97`) asserts `{key for key, _, _ in AC6_ROWS} == FR3_KEYS`. `test_ac6_stored_zero_reads_as_site_default` (`:100-104`) is parametrized over the rows. **Not in design.md**: the design names only the read-classification file.
- Dial-free watcher: `def snapshot_watcher(namespace="analysis", **values)` at `tests/conftest.py:62`; it rejects a namespace-prefixed key (`:75-79`) and stores a bool as `bool_val` (`:81-82`).
- `get_bool` is not a classified read (`READ_NAMES`, `tests/test_config_read_classification.py:19-22`), so `pipeline.worker_enabled` joins neither set.

**Lands with**: `Step 1, Step 2`

**TDD**: `red-green required`

**Covers**: `AC-14` (the kill-switch read only: a stored `false` is honoured and an unset key reads `true`; the no-claim behaviour is Step 12)

**Instructions**:
1. `tests/test_job_graph_settings.py`, using `snapshot_watcher` from `tests.conftest`:
   - unset keys read the six code defaults (`True`, 4, 1000, 60, 5, 7);
   - `pipeline.worker_enabled` stored `False` reads `False` (RED: this assertion, `@AC-14`);
   - a stored 0 or negative int reads as the default (one case per int key);
   - a stored value below or above the bounds is clamped (for example `lease_seconds` 10 reads 45,
     `worker_concurrency` 64 reads 16);
   - the clamp WARN fires once for a repeated read of the same stored value and again after the
     stored value changes (`caplog`), and names `analysis.pipeline.<key>`;
   - a value changed in the snapshot between two calls is seen by the second call (no caching);
   - seed-to-reader: parse the twelve tuples of
     `services/xstockstrat-config/migrations/<NNN>_analysis_pipeline_keys.up.sql` (the number from
     Step 1) into a snapshot, one per environment, and assert the real `JobGraphSettings` returns
     each seeded value, so a seed that drifts from the code default fails here and not only in
     CI's wiring gate.
   The watcher values are scenario one-offs with one consumer, so they stay inline (C-13); the
   seed-to-reader case reads its values from the migration file.
2. `test_config_read_classification.py`: add the five int keys to `FR3_KEYS`
   (`"pipeline.worker_concurrency"`, `"pipeline.poll_interval_ms"`, `"pipeline.lease_seconds"`,
   `"pipeline.max_attempts"`, `"pipeline.retention_days"`). Add nothing to `HONOUR_KEYS` or
   `ZERO_IS_LEGIT`.
3. `test_config_zero_clamps.py`: add five rows to `AC6_ROWS` with effective values 4, 1000, 60, 5
   and 7. This is also the literal `test_rule6` needs.

**Verification** (the single gate for the Steps 1+2+3 unit):
```bash
# analysis (Steps 2+3)
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_graph_settings.py tests/test_config_read_classification.py tests/test_config_zero_clamps.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "snapshot_watcher\|from tests.conftest\|conftest" tests/test_job_graph_settings.py   # C-13: harness imported, not copied
# config (Step 1)
cd ../xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
ls migrations/060_*.up.sql migrations/060_*.down.sql
# read both: every seeded (key, value) in the .up is deleted by the .down's guarded DELETE
# whole-tree wiring, stored set and docs (Steps 1+2)
cd ../.. && node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check
python3 scripts/check-watcher-copies.py && python3 scripts/check-context-map.py
python3 scripts/check-migration-order.py origin/main-dev
grep -c '"file": "060_analysis_pipeline_keys.up.sql"' scripts/config-wiring-stored.json   # 12
grep -n "analysis.pipeline\." services/xstockstrat-config/src/grpc/configServiceImpl.ts   # 5 entries
```

---

### Step 4 — migration: analysis `031_pipeline_job_graph` (jobs and dependency edges)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/031_pipeline_job_graph.up.sql` — create
- `services/xstockstrat-analysis/migrations/031_pipeline_job_graph.down.sql` — create
- `scripts/migration-rerun.py` — modify (the analysis clean-end version only)

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Last analysis migration: `030_opportunity_compute_state_live_only_cursor` (`ls services/xstockstrat-analysis/migrations | tail -2`). No in-flight feature spec names an analysis `031`.
- Layout precedent: `migrations/022_readiness_cache.up.sql:1-8` (header `-- Migration: …`, `-- Service: xstockstrat-analysis`, then `CREATE TABLE IF NOT EXISTS analysis.readiness_cache (`); its down is `DROP TABLE IF EXISTS analysis.readiness_cache;`.
- Index naming: `CREATE INDEX IF NOT EXISTS idx_opportunities_user_valid` (`migrations/011_opportunities.up.sql:24`); `CREATE UNIQUE INDEX IF NOT EXISTS uidx_pnl_positions_open` (`migrations/016_order_snapshots_pnl_patterns.up.sql:51`).
- `gen_random_uuid()` is already used by sibling services' migrations (`services/xstockstrat-identity/migrations/001_identity_tables.up.sql:7`); this migration only declares the `UUID` column, the token is generated by the claim (Step 7).
- Disjoint from the existing scheduler: `analysis.job_schedule` (`migrations/020_job_schedule.up.sql:8-11`) is not referenced.
- Run order: analysis runs last (`scripts/db-migrate.sh:175`), after config (`:150`).
- **Not in recon.md**: `scripts/migration-rerun.py:1114` asserts each service's clean end version, `for schema, want in (("ingest", 18), ("analysis", 30), ("config", p.cfg_top)):`. Feature 366 changed this literal in its own PR (`git show 540f8ff --stat`). CI job `migration-rerun` (`.github/workflows/ci.yml:944-980`) fails with "analysis should be clean at 30" otherwise (ledger fails, 2026-11-18 webhook-fanout-callback).
- No earlier assertion file pins these tables: `ls scripts/migration-assertions/` has `analysis-026.sql` to `analysis-029.sql` only, and none can mention a table that does not exist yet.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Number.** `ls services/xstockstrat-analysis/migrations | tail -2`; use highest + 1 (`031`
   today). A different number goes in the Deviation Log and changes item 5's literal with it.
2. **Up, table `analysis.pipeline_jobs`**, `CREATE TABLE IF NOT EXISTS … WITH (fillfactor = 70)`,
   columns as design.md § Data model:
   - `job_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`;
   - `kind`, `subject`, `epoch`, `run_id`: `TEXT NOT NULL`;
   - `lane SMALLINT NOT NULL CHECK (lane IN (10, 20))`;
   - `state TEXT NOT NULL CHECK (state IN ('ready','running','waiting','succeeded','failed','dead','blocked'))`;
   - `attempts INT NOT NULL DEFAULT 0`, `wait_round SMALLINT NOT NULL DEFAULT 0`,
     `next_attempt_at TIMESTAMPTZ NOT NULL`;
   - `lease_token UUID`, `lease_expires_at TIMESTAMPTZ`;
   - `verdict TEXT`, `error_class TEXT CHECK (error_class IN ('transient','permanent'))`,
     `last_error TEXT` (no length check), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
     `finished_at TIMESTAMPTZ`. No result column (R-15).
   - Table checks: `(state = 'running') = (lease_token IS NOT NULL)`;
     `(lease_token IS NULL) = (lease_expires_at IS NULL)`;
     `state <> 'blocked' OR verdict IS NOT NULL`;
     `(state IN ('succeeded','failed','dead','blocked')) = (finished_at IS NOT NULL)`.
3. **Up, indexes on `pipeline_jobs`** (`IF NOT EXISTS`):
   - `uidx_pipeline_jobs_kind_subject_epoch`, unique on `(kind, subject, epoch)`;
   - `idx_pipeline_jobs_state_lane_next_attempt_at` on
     `(state, lane DESC, next_attempt_at, job_id) WHERE state IN ('ready','running','waiting')`.
     The predicate is on `state`, not on `finished_at IS NULL`, so every claim, reap, settle and
     stats query implies it (O-82);
   - `idx_pipeline_jobs_state_finished_at` on
     `(state, finished_at) WHERE state IN ('succeeded','failed','dead','blocked')`;
   - `idx_pipeline_jobs_run_id` on `(run_id)`.
4. **Up, table `analysis.pipeline_job_deps`**: `parent_id BIGINT NOT NULL REFERENCES
   analysis.pipeline_jobs (job_id) ON DELETE CASCADE`, `child_id` the same,
   `PRIMARY KEY (parent_id, child_id)`, `CHECK (parent_id <> child_id)`, and
   `idx_pipeline_job_deps_child_id` on `(child_id)`.
   Header comment: at most a few lines stating that lane 10 is `watchlist` and 20 is `held`, that
   the tables are disjoint from `analysis.job_schedule`, and that they are plain tables (no
   hypertable).
5. **Down.** `DROP TABLE IF EXISTS analysis.pipeline_job_deps;` then
   `DROP TABLE IF EXISTS analysis.pipeline_jobs;` (the edge table first).
6. `scripts/migration-rerun.py:1114`: change `("analysis", 30)` to `("analysis", 31)`. Nothing else
   in that file.
7. The up must stay self-contained (no dependency on another analysis table): Step 8's fixture runs
   this file alone on a throwaway database.

**Verification** (offline; no database is started):
```bash
ls services/xstockstrat-analysis/migrations/031_*.up.sql services/xstockstrat-analysis/migrations/031_*.down.sql
# read both: each CREATE TABLE in the .up has a DROP TABLE in the .down; the indexes drop with their tables
python3 scripts/check-migration-order.py origin/main-dev
grep -n '("analysis", 31)' scripts/migration-rerun.py
grep -rn "pipeline_job" services/xstockstrat-analysis/migrations/ | grep -v "031_pipeline_job_graph" ; test $? -eq 1   # sole mention
```

---

### Step 5 — service: `bounded_txn` and the control-pool reset callback

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/read_budget.py` — modify (additions only)

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The file today: `budgeted_read(pool, budget_s)` at `app/repositories/read_budget.py:61-116`, a read-only transaction; `BudgetedConn` at `:35-58` exposes `fetch`, `fetchval`, `fetchrow`; `_arm` at `:42-46` re-arms `SET LOCAL statement_timeout` to the remaining budget before each statement.
- Constants to reuse, not redeclare (DRY guard rail): `_READ_DB_BACKSTOP_GRACE_S = 2.0` (`:12`), `_RELEASE_TIMEOUT_S = 1.0` (`:13`). design.md's "grace 2 s; release bound 1 s" are these values.
- Terminate-versus-rollback rule today: `:79-99` (rollback only at stage `open` and not cancelled; otherwise `con.terminate()`); the detached-connection note at `:100-107`.
- `budgeted_read` wraps the block in `asyncio.timeout` (`:66-68`). design.md § Bounded database access forbids that for `bounded_txn` ("No asyncio cancellation bounds any database I/O").
- `asyncpg` is locked at 0.31.0 (`services/xstockstrat-analysis/uv.lock:44-47`); its `create_pool` accepts `reset` and `min_size`.
- `budgeted_read` has callers on the `ListOpportunities` read path (ANALYSIS-14); it must stay byte-for-byte unchanged in behaviour. Its tests: `tests/test_read_budget.py`, `tests/test_read_budget_real_pg.py`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `bounded_txn(pool, budget_s, *, on_acquired=None, on_terminate=None)` as an async context
   manager beside `budgeted_read`, implementing design.md § Bounded database access in full. The
   points a reader must not get wrong:
   - the deadline is fixed at entry, before the pool acquire; `pool.acquire(timeout=remaining)` is
     the only cancellable wait, and it happens before any transaction is open;
   - `on_acquired` is called synchronously when `pool.acquire` returns, before `BEGIN`;
   - the transaction opens with `BEGIN; SET LOCAL statement_timeout = <remaining ms>` as one query,
     and the timeout is re-armed to the remaining budget before each statement;
   - a client timer (`loop.call_later`, not `asyncio.timeout`) terminates the connection at
     deadline + `_READ_DB_BACKSTOP_GRACE_S`; when it fired, the error raised is `DbBudgetExceeded`;
   - `COMMIT`'s command tag is checked; anything but `COMMIT` raises a transient error;
   - on a server timeout or an exception from the block, `ROLLBACK` is sent while the client timer
     is still armed, and the connection is terminated if that fails;
   - under cancellation, expiry or abort the connection is terminated with no rollback and no
     awaited release;
   - a `terminated` flag, set by whoever terminates first, guards later cleanup; `on_terminate`
     runs exactly once, whoever terminates;
   - the release on the normal path is bounded by `_RELEASE_TIMEOUT_S`.
2. The handle yielded by `bounded_txn` exposes `fetch`, `fetchrow`, `fetchval`, `execute` and a
   synchronous, idempotent `abort()` that terminates the connection and sets `terminated`.
3. Add `class DbBudgetExceeded(Exception)`; it is transient for the engine's classifier.
4. Add `control_pool_reset(conn)`: an `async def` usable as `asyncpg.create_pool(reset=…)`. It
   sends no query and raises if `conn.is_in_transaction()`.
5. Record the send time of `BEGIN` on the handle (taken before the query is sent, from an
   injectable `monotonic` defaulting to `time.monotonic`): Step 11's fence deadline is computed
   from it (design.md § Lease timing).
6. Leave `budgeted_read`, `BudgetedConn`, `is_transient_db_error` and the constants untouched.
   Comments: at most two lines each, constraints only.

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev pytest tests/test_read_budget.py tests/test_read_budget_real_pg.py -q   # budgeted_read unchanged
git diff --numstat -- app/repositories/read_budget.py   # additions only: the deletions column is 0
```

---

### Step 6 — test: `bounded_txn` against real PostgreSQL, and the asyncpg pins

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_bounded_txn_real_pg.py` — create
- `services/xstockstrat-analysis/tests/test_bounded_txn.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Real-Postgres harness: session fixture `local_pg` at `tests/conftest.py:438-503` (yields a DSN; skips locally without binaries, fails under `CI=true`); marker `real_pg` (`pyproject.toml:34`); CI installs PostgreSQL for the analysis job (`.github/workflows/ci.yml:510-514`).
- Pool helper and hang guard to mirror: `_pool(dsn, size, **kwargs)` at `tests/test_read_budget_real_pg.py:25-28` (`statement_cache_size=0`), `_HANG_GUARD_S = 10` at `:22`, `_pid_and_timeout` at `:31-37`.
- Already pinned, do not repeat: a terminated pooled connection frees its pool slot (`tests/test_read_budget_real_pg.py:148-164`).
- Fake-connection unit style for the cleanup branches: `tests/test_read_budget.py:37-235`.
- A virtual-time event loop or fake clock helper: **Not found** in `tests/` — the unit file uses the injected `monotonic` and a fake connection, with no real sleeps.

**TDD**: `red-green required`

**Covers**: — (no scenario of its own: these are the design's gate tests for build step 4. The lease takeover and the fenced report they make safe are asserted in Steps 8 and 12 for `@AC-3` and `@AC-4`.)

**Instructions**:
1. `tests/test_bounded_txn_real_pg.py`, `pytestmark = pytest.mark.real_pg`, each test under an
   `asyncio.wait_for(…, _HANG_GUARD_S)`:
   - a statement over budget is cancelled by the server (`QueryCanceledError`) and the same backend
     pid is reused afterwards;
   - a frozen backend is cut at budget + 2 s, the error is `DbBudgetExceeded`, and the pool serves
     a new connection. Freeze the backend with `SIGSTOP` on its `pg_backend_pid()` and always
     `SIGCONT` it in a `finally`; keep the budget small (for example 0.3 s) so the test takes under
     3 s;
   - cancelling the task inside an open transaction terminates the connection and sends no
     `ROLLBACK` (observe through a new backend pid and no "active transaction" reset warning);
   - a `COMMIT` that returns `ROLLBACK` raises: inside the block, run a failing statement and
     swallow its error, then leave the block normally;
   - cancelling during `pool.acquire` on an exhausted pool returns the connection, and two later
     acquires succeed;
   - a pool built with `min_size=0`, `max_size=2`, `reset=control_pool_reset`: releasing a
     connection issues no query (compare a statement counter from `pg_stat_activity` or a
     connection subclass, as `_NoResetConnection` at `tests/test_read_budget_real_pg.py:40-44`
     does), and releasing one that is inside a transaction raises;
   - `on_acquired` runs before `BEGIN`; `on_terminate` runs once when the timer fires and once when
     `abort()` is called twice;
   - `SET LOCAL statement_timeout` does not leak past the transaction (`SHOW statement_timeout` is
     `0` afterwards).
2. `tests/test_bounded_txn.py`, fake connection and injected clock, no database: the deadline is
   fixed before the acquire; the re-armed timeout shrinks across statements; a block exception
   sends `ROLLBACK` and re-raises the original; a failed `ROLLBACK` terminates; the `terminated`
   flag suppresses a second terminate and an awaited release.
3. RED, run before Step 5's code exists as behaviour: the `COMMIT`-returns-`ROLLBACK` test (today
   nothing checks the tag) and the frozen-backend test.
4. If a pin fails on asyncpg 0.31.0, apply the fallback named in design.md § Open Risks (terminate
   does not wake the await: race each statement as a child task against the timer; no `reset=`:
   drop it; no `min_size=0`: use 1), record it in the Deviation Log, and adjust the pin to the
   fallback's behaviour. Do not start Step 9 before this file is green.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_bounded_txn.py tests/test_bounded_txn_real_pg.py tests/test_read_budget.py tests/test_read_budget_real_pg.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
uv run --extra dev pytest tests/test_bounded_txn_real_pg.py -q -rs | grep -c SKIPPED ; test $? -eq 1   # nothing skipped: PostgreSQL binaries were found
```

---

### Step 7 — service: `PipelineJobsRepository`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/pipeline_jobs.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/repositories/pipeline_jobs.py`: **Not found** — created by this step.
- Repository shape: `class OpportunitiesRepository`, `__init__(self, db_pool)` storing `self._db`, an `asynccontextmanager` `transaction()` and methods taking `*, conn=None` (`app/repositories/opportunities.py:82-92`).
- Claim shape precedent (a CTE that locks candidates, then an `UPDATE … RETURNING`): `services/xstockstrat-marketdata/internal/repository/profile_repo.go:250-256`, `… ORDER BY symbol LIMIT $3 FOR UPDATE SKIP LOCKED) UPDATE marketdata.symbol_profile p SET alert_claimed_at = now() …`. This feature uses `FOR NO KEY UPDATE` (D-55).
- No `SKIP LOCKED` exists in analysis today: `grep -rn "SKIP LOCKED" services/xstockstrat-analysis/app` returns nothing; the only row lock is a plain `FOR UPDATE` (`app/repositories/strategies.py:119-122`).
- Tables and index names: Step 4.
- `bounded_txn` and its handle: Step 5.
- `is_transient_db_error` (`app/repositories/read_budget.py:31-32`) is **not** the job classifier (R-8); this module does not use it to decide a job's outcome.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Class `PipelineJobsRepository(control_pool, *, monotonic=time.monotonic)`. It owns the control
   lane: one `asyncio.Lock` (FIFO), taken before the control-pool acquire and released after the
   connection is released or terminated; no retry or sleep under it. Without `conn`, a method runs
   through the lane and `bounded_txn(control_pool, 5.0)`; `heartbeat` uses
   `bounded_txn(control_pool, 3.0)` and never takes the lane. With `conn=`, a method issues its
   statements on that handle and takes neither. Budgets 5 s and 3 s are module constants (recorded
   invariants, F-07 per design.md § Constitution Rules Touched).
2. Expose the lane to the engine: an async context manager `lane()` that acquires the lock and
   yields, so a runner can take the lane, become `reporting`, wait for an in-flight heartbeat batch
   and only then call `report` or `park` (design.md § Worker runtime, Heartbeat loop). `report` and
   `park` accept `lane_held=True` so they do not take it twice.
3. Methods (S-1), each implementing the bullet of the same name in design.md § Repository and SQL:
   - `enqueue(kind, subject, epoch, *, run_id, lane, conn=None)` → the job id and whether it was
     created. `INSERT … ON CONFLICT (kind, subject, epoch) DO NOTHING` with
     `next_attempt_at = now()`; on a conflict return the existing row unchanged (it keeps its own
     `run_id` and lane); if that row vanished, retry the insert once in the same transaction.
   - `claim(kinds, limit, lease_seconds, *, conn=None)` → claimed rows (`job_id`, `kind`,
     `subject`, `epoch`, `run_id`, `lane`, `attempts`, `wait_round`, `lease_token`) and the
     transaction's send time. Candidates: `state = 'ready' AND next_attempt_at <= now() AND kind =
     ANY($kinds)`, `ORDER BY lane DESC, next_attempt_at, job_id LIMIT $limit FOR NO KEY UPDATE SKIP
     LOCKED`; the update sets `running`, `attempts + 1`, `lease_token = gen_random_uuid()`,
     `lease_expires_at = now() + lease`. An empty `kinds` issues no statement.
   - `reap(max_attempts, *, conn=None)` → counts `(requeued, dead)`. Expired `running` rows, chosen
     `ORDER BY job_id FOR NO KEY UPDATE SKIP LOCKED` with no `LIMIT`; the outer update re-checks
     state and expiry; `ready` with `next_attempt_at = now()`, or `dead` with `error_class =
     'transient'`, `last_error = 'lease_expired'` and `finished_at = now()` once `attempts >=
     max_attempts`. A reap never increments `attempts`.
   - `heartbeat(pairs, lease_seconds)` → the renewed `(job_id, lease_token)` pairs and the send
     time. One batched update fenced by `job_id`, `lease_token` and `state = 'running'`, with no
     expiry test. An empty `pairs` issues no statement. The result counts as committed only when
     `COMMIT` returned `COMMIT`.
   - `report(job_id, lease_token, outcome, *, max_attempts, retry_delay_s=0, verdict=None,
     error=None, lane_held=False)` → `True` when one row changed, `False` when the fence matched
     nothing. One statement fenced by `job_id`, `lease_token` and `state = 'running'`; the target
     state is computed in SQL: success → `succeeded`; permanent → `failed` with `error_class =
     'permanent'`; verdict → `blocked` with the verdict; transient → `dead` when `attempts >=
     max_attempts`, else `ready` with `next_attempt_at = now() + retry_delay_s` and `error_class =
     'transient'`. Every branch clears the lease; a finished state sets `finished_at = now()`. It
     also returns the state written, so the caller can count the outcome.
   - `park(job_id, lease_token, children, *, lane_held=False)` → `True`, `False` (fenced out), or
     raises `ParkRace`. One transaction of fixed length, in the design's order: fence and lock the
     parent `FOR NO KEY UPDATE`; insert children `ON CONFLICT (kind, subject, epoch) DO NOTHING` (a
     new child takes the parent's `run_id` and, unless the child names one, its lane); lock the
     children by key `FOR KEY SHARE`; if fewer rows came back than deduplicated children, raise
     `ParkRace` before inserting edges; insert edges `ON CONFLICT (parent_id, child_id) DO
     NOTHING`; set the parent `waiting`, clear its lease and refund the attempt (`attempts - 1`).
   - `settle_batch(*, conn=None)` → `(woken, blocked, full)`. One `UPDATE … WHERE j.job_id IN
     (SELECT job_id … ORDER BY job_id LIMIT 500 FOR NO KEY UPDATE SKIP LOCKED) RETURNING`, the
     settleable predicate inside the subquery before `LIMIT`, the outer update adding no predicate.
     All children succeeded → `ready`, `wait_round + 1`, `next_attempt_at = now()`. Any child in
     `failed`, `dead` or `blocked` → `blocked` with `dependency_failed`, `dependency_dead` or the
     child's own verdict, decided by the lowest such `job_id`. `full` is true when 500 rows were
     chosen.
   - `list_by_run(run_id, *, conn=None)` → `job_id, kind, subject, epoch, lane, state` ordered by
     `job_id`.
   - `ready_stats(*, conn=None)` → per lane, the count of rows with `state = 'ready' AND
     next_attempt_at <= now()` and `now() − min(next_attempt_at)` in seconds.
4. Module-level `async def prune_batch(conn, *, state, older_than_days, cutoff=None)` (S-2) →
   `(candidates, deleted, cutoff)`. `conn` is required: a handler's `job.db()` handle. Two
   statements in the caller's transaction, as design.md § Repository and SQL, Prune: the unordered
   candidate `SELECT j.job_id … WHERE j.state = $state AND j.finished_at < $cutoff AND NOT EXISTS
   (unfinished-parent sublink) FOR UPDATE OF j SKIP LOCKED LIMIT 500`, then `DELETE … WHERE job_id
   = ANY($ids)` repeating the guard. With `cutoff=None` it first reads `now() − make_interval(days
   => $older_than_days)` on the database clock and returns it.
5. `class ParkRace(Exception)` in this module. Every candidate select locks only the outer
   `pipeline_jobs` alias; any predicate over another table is an `EXISTS` / `NOT EXISTS` subquery.
6. Lane values come from the caller as integers 10 and 20 (the `Lane` enum is Step 9); this module
   does not import `app/engine/`.
7. Nothing here calls `asyncio.timeout`, `wait_for` or `shield`, and nothing reads the instance
   clock for a database decision: lease expiry, next-attempt time, cutoffs and ready age use
   `now()` (D-2).

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev python -c "from app.repositories.pipeline_jobs import PipelineJobsRepository, ParkRace, prune_batch"
grep -n "asyncio.timeout\|wait_for\|shield\|is_transient_db_error\|datetime.now\|app.engine" app/repositories/pipeline_jobs.py ; test $? -eq 1
grep -c "SKIP LOCKED" app/repositories/pipeline_jobs.py   # claim, reap, settle, prune
```

---

### Step 8 — test: repository SQL against real PostgreSQL, and the job-row fixtures

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify (add the pipeline fixtures)
- `services/xstockstrat-analysis/tests/test_pipeline_jobs_real_pg.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Fixture home (C-13): `tests/conftest.py`; `local_pg` at `:438-503`. No job-row fixture exists; `FakeConn` (`:204`) asserts a read-only transaction and does not fit claim writes (recon.md § Risks).
- Schema-from-migration precedent: `tests/test_strategy_templates_real_pg.py:14-37` reads the owning migration, asserts it was found and that no other `migrations/*.up.sql` changes the table (ledger insights, 2026-11-04 fix-template-update-metadata). Here `031` creates both tables and is self-contained (Step 4 item 7), so the fixture executes the whole file.
- Other `real_pg` tests share the session cluster and create schema `analysis` with `CREATE SCHEMA IF NOT EXISTS analysis` (`tests/test_strategy_templates_real_pg.py:46`), so the fixture must drop and recreate only its own two tables.
- The fixtures have more than one consumer (this step and Steps 12 and 14), which is what places them in `conftest.py`.
- Database time is moved by rewriting time columns, never by sleeping (D-13).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-18`

**Instructions**:
1. `tests/conftest.py`, appended after `local_pg`:
   - an async fixture `pipeline_pg(local_pg)` that opens a pool (`statement_cache_size=0`), runs
     `CREATE SCHEMA IF NOT EXISTS analysis`, drops `analysis.pipeline_job_deps` and
     `analysis.pipeline_jobs`, executes `migrations/031_pipeline_job_graph.up.sql`, asserts no other
     `migrations/*.up.sql` mentions `pipeline_job`, yields the pool and closes it;
   - a helper `insert_pipeline_job(pool, **overrides)` that inserts one row in any state with
     consistent defaults (kind `probe`, subject `AAPL`, epoch `2026-11-27`, run id
     `run-2026-11-27`, lane 10, state `ready`) and lets a test set `next_attempt_at`,
     `lease_expires_at`, `finished_at` and `attempts` directly;
   - a helper `shift_pipeline_job(pool, job_id, **columns_to_interval)` that rewrites time columns
     relative to `now()`.
2. `tests/test_pipeline_jobs_real_pg.py`, `pytestmark = pytest.mark.real_pg`. Scenario tests, each
   named `test_ac<N>_…` for its scenario:
   - `@AC-1`: enqueue the same key twice → one row; the second call reports the existing job id and
     `created` false; the existing row keeps its `run_id` and lane.
   - `@AC-2`: two repositories on two pools claim concurrently (`asyncio.gather`) → exactly one
     gets the row.
   - `@AC-3`: claim, rewrite `lease_expires_at` 61 s into the past, `reap(5)`, claim from a second
     repository → the second holds a new token and `attempts` is 2.
   - `@AC-4`: after that takeover the second holder reports success; the first holder's `report`
     returns `False`; `finished_at` is unchanged by the rejected call.
   - `@AC-5`: a transient report with `retry_delay_s=5` → state `ready`, `attempts` 1, and `claim`
     returns nothing until `next_attempt_at` is rewritten into the past.
   - `@AC-6`: a permanent report → `failed`, `error_class` `permanent`; `claim` never returns it.
   - `@AC-7`: with `max_attempts=5`, the fifth transient report → `dead`; `claim` never returns it.
     The same for a reap of an expired fifth attempt (`last_error` `lease_expired`).
   - `@AC-8`: park a parent on a child → parent `waiting` with its attempt refunded, not claimable;
     child succeeds; `settle_batch` → parent `ready`, `wait_round` 1, and `claim` returns it.
   - `@AC-9`: the child reports the verdict `no_vendor_data` → `settle_batch` leaves the parent
     `blocked` with that verdict and a `finished_at`. A `failed` child gives `dependency_failed`, a
     `dead` child `dependency_dead`; with several, the lowest `job_id` decides.
   - `@AC-10`: one `watchlist` row with an earlier `next_attempt_at` and one `held` row with a later
     one → `claim(limit=1)` returns the `held` row.
   - `@AC-11`: three rows under `run-2026-11-27` and one under `run-2026-11-26` →
     `list_by_run("run-2026-11-27")` returns three, each with its state.
   - `@AC-12`: one `succeeded`, `failed`, `dead` and `blocked` row each finished 8 days ago;
     `prune_batch(state="succeeded", older_than_days=7)` deletes the first; the others survive a
     `prune_batch` at 30 days.
   - `@AC-18`: `dead` rows finished 31 and 29 days ago; `prune_batch(state="dead",
     older_than_days=30)` deletes only the first.
   - `@AC-13`: four `ready` `watchlist` rows, the oldest `next_attempt_at` 120 s ago →
     `ready_stats()` gives depth 4 and age at least 120 for that lane; a row whose
     `next_attempt_at` is in the future is not counted.
3. The same file, the design's gate tests (design.md § Build order, "Step 3's real-Postgres
   tests"):
   - a park that repeats a child key succeeds; two overlapping parks that name the same children in
     opposite order do not deadlock;
   - a park whose parent is a new or an existing child of a concurrent park neither waits nor
     deadlocks;
   - the prune batch's `DELETE` keeps a row that gained an edge from an unfinished parent after the
     ids were chosen (select ids without a lock, commit a park that re-declares that finished
     child, lock the ids `FOR UPDATE`, run the batch's `DELETE`: row and edge survive);
   - a park started after an open batch's candidate select but before its `DELETE` waits on the
     child lock and raises `ParkRace`; its re-run inserts the child afresh and leaves the parent
     `waiting` with every edge present; a park started after the `DELETE` inserts the child afresh;
   - the `blocked`-job recovery SQL printed in design.md § Retention prune, run a second time after
     the parent was re-claimed and parked again, deletes no edge and updates no row; a park naming
     a `blocked` row as a child is not blocked by an open recovery transaction on it; the
     `failed`/`dead` recovery `UPDATE` run twice changes the row once;
   - a 10 000-child park plus its settle finishes within 5 s;
   - 1 200 settleable parents are settled by three `settle_batch` calls (500, 500, 200, the first
     two reporting `full`), each with the lowest-id verdict (the single-tick form of this design
     test is in Step 12);
   - on a seeded and `ANALYZE`d table, `EXPLAIN` of each prune candidate select names
     `idx_pipeline_jobs_state_finished_at` and of the claim select
     `idx_pipeline_jobs_state_lane_next_attempt_at`; with `retention_days` 7 a `dead` row aged
     8 days survives;
   - a `waiting` parent held `FOR KEY SHARE` by another parent's open park is still settled, and a
     `ready` child held the same way is still claimed;
   - two repositories running `reap` and `settle_batch` on the same rows neither block nor
     deadlock;
   - an enqueue whose existing row is deleted between the insert and the read retries once and
     creates the row (drive the gap through `conn=`: a wrapping handle that deletes the row on a
     second connection after the first statement); an empty `kinds` claim and an empty heartbeat
     issue no statement.
4. The recovery SQL is copied from design.md into this file as its one test consumer (Step 19's
   page is prose). Other row values come from `insert_pipeline_job`.
5. RED: the `@AC-2` and `@AC-4` assertions, run before Step 7's module exists as behaviour.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_pipeline_jobs_real_pg.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "pipeline_pg\|insert_pipeline_job" tests/conftest.py tests/test_pipeline_jobs_real_pg.py | head   # C-13: fixtures defined once in conftest, imported by the test
grep -cE "^async def test_ac[0-9]+_" tests/test_pipeline_jobs_real_pg.py   # >= 14, one per covered scenario
```

---

### Step 9 — service: engine primitives (lanes, outcomes, classifier, backoff, handler registry)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/job_graph.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/engine/job_graph.py` holds only `JobGraphSettings` after Step 2.
- Poison-classification precedent with the same default direction (a positive allow-list, anything unlisted is replayed): `_POISON` and `_is_poison` at `app/engine/pnl_pattern_consumer.py:63-77`. FR-3 fixes the direction here: only `PermanentJobError` is permanent.
- Recorded misuse to avoid: `is_transient_db_error` used as a park classifier (ledger fails, fix-python-loop-supervision; R-8).
- Fixed-constant precedent: `_LOOP_ERROR_BACKOFF_SECONDS = 30` with the comment "Fixed invariant, not a config key" (`app/supervision.py:9-10`).
- No injected clock or UTC-day helper exists in the service (`app/engine/durable_schedule.py:25,52` call `datetime.now(UTC)` directly); the engine takes `monotonic` and `utc_today` as parameters (D-13).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `class Lane(IntEnum)`: `WATCHLIST = 10`, `HELD = 20`; the label written to telemetry is the
   lower-cased member name.
2. Outcomes a handler may return: `Succeeded`, `WaitOn(children)` and `Verdict(label)`. A child is
   a key `(kind, subject, epoch)` with an optional lane.
3. `class PermanentJobError(Exception)` and `class AttemptStopped(BaseException)` (design.md §
   Handler database contract).
4. `classify(exc)` → `permanent` only for `PermanentJobError`; every other `Exception` is
   `transient`. A value returned by a handler that is not one of the three outcomes is a permanent
   failure.
5. `backoff_seconds(attempt, *, rand=random.random)` → `min(5 · 2^(attempt − 1), 300)` plus up to
   20 % jitter; never below 5.
6. `truncate_error(text)` → at most 1 KB of UTF-8, cut on a character boundary.
7. `class HandlerRegistry`: `register(kind, handler, *, child_kinds=())`, `kinds()`, `get(kind)`.
   `validate()` raises at boot when the kind graph formed by `child_kinds` has a cycle (a kind
   listing itself included) or names an unregistered child kind.
8. `validate_wait_on(parent, children, registry)` → the deduplicated, sorted children, or raises
   `PermanentJobError` naming the failed check: fewer than 1 or more than 10 000 children; the
   parent's own key; a child kind not in the parent kind's `child_kinds`; `wait_round` already 8.
   A key repeated with two lanes keeps the higher one. `validate_verdict(label)` rejects an empty
   label the same way.
9. The fixed constants listed at the end of design.md § Build order that this step needs (park
   rounds 8, children per park 10 000, backoff base 5 s and cap 300 s) are module constants, each
   named, with no config key.
10. The prune job's identity as module constants, used by Step 11's daily ensure and Step 13's
    handler: kind `pipeline.retention_prune`, subject `global`, lane `Lane.WATCHLIST`, and
    functions giving the epoch (the UTC date as `YYYY-MM-DD`) and `run_id`
    (`retention_prune:<UTC date>`) for a date.

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev python -c "from app.engine.job_graph import Lane, Succeeded, WaitOn, Verdict, PermanentJobError, AttemptStopped, HandlerRegistry, backoff_seconds, classify"
uv run --extra dev pytest tests/test_job_graph_settings.py tests/test_config_read_classification.py -q   # Step 2's reader still classified
grep -n "is_transient_db_error" app/engine/job_graph.py ; test $? -eq 1
```

---

### Step 10 — test: engine primitives

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_job_graph_core.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Table-driven classification tests to mirror: `tests/test_read_budget.py:265-282` (`test_transient_errors_classify_transient`, `test_non_transient_errors_classify_not_transient`).
- No fixture is needed: every input is a scenario one-off with one consumer (C-13: inline is compliant).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6, AC-7`

**Instructions**:
1. `@AC-5`: `backoff_seconds(1)` is at least 5 for `rand` 0 and at most 6 for `rand` 1; the
   sequence for attempts 1 to 8 is 5, 10, 20, 40, 80, 160, 300, 300 before jitter. RED: the
   lower-bound assertion.
2. `@AC-6`: `classify(PermanentJobError("x"))` is `permanent`; a subclass is too.
3. `@AC-7` (and FR-3's default): `classify` returns `transient` for `RuntimeError`, `OSError`,
   `asyncpg.PostgresError`, `ValueError`, `TimeoutError` and `DbBudgetExceeded`; a non-outcome
   return value is a permanent failure.
4. Registry: a two-kind cycle, a self-edge and an unregistered child kind each raise at
   `validate()`; a DAG passes.
5. `validate_wait_on`: 0 children, 10 001 children, the parent's own key, an undeclared child kind
   and `wait_round` 8 each raise `PermanentJobError` whose message names the check; duplicates are
   removed; a key given with lanes 10 and 20 keeps 20; an empty verdict label raises.
6. `truncate_error`: a 2 KB string with multi-byte characters comes back at most 1 024 bytes and
   decodes cleanly.
7. Prune identity: the epoch and `run_id` for 2026-11-27 are `2026-11-27` and
   `retention_prune:2026-11-27`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_graph_core.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_job_graph_core.py ; echo "C-13: single-consumer inline literals; no fixture expected"
```

---

### Step 11 — service: attempt, stop path, the three loops and the worker

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/job_graph.py` — modify
- `services/xstockstrat-analysis/app/jobs/__init__.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Task start: `def spawn(coro, name: str, *, forever: bool) -> asyncio.Task` at `app/supervision.py:16-20`; `_on_done` logs an exception exit at ERROR (`:27-33`), which is why the handler runs inside an engine wrapper.
- Loop net: `async def run_supervised(tick, name: str)` at `app/supervision.py:55-68`; a tick returns its next delay; a raised `Exception` backs off `_LOOP_ERROR_BACKOFF_SECONDS` (30 s). Both helpers catch `Exception` only, so `AttemptStopped` (a `BaseException`) is not swallowed by them.
- Concurrency bound: `class ResizableLimiter` at `app/config/live_limits.py:12`; `in_use` (`:21`), `limit` (`:23-25`), `acquire` (`:27-36`), `release` (`:38-40`), `wake` (`:42-46`). Wired to config changes as `self._cfg.on_change(lim.wake)` (`app/handlers/servicer.py:544-547`); `on_change` at `app/config/watch_core.py:92`. PLAT-16 forbids a `Semaphore(n)` built once. `live_limits.py` is not edited.
- Done-callback slot release shape: `_done` and `fut.add_done_callback(_done)` at `app/config/live_limits.py:67-72`.
- `app/jobs/`: **Not found** — created by this step.
- Repository API: Step 7. `bounded_txn`, its `on_acquired` / `on_terminate` hooks and `abort()`: Step 5. Primitives: Step 9.
- Ledger traps this step must not repeat: a guard that covers only the cycle body while the `except` handler does unguarded DB I/O (fails, fix-python-loop-supervision); a hang raises nothing, so every DB step is bounded by `bounded_txn`, never by a supervisor (insights, fix-python-loop-supervision); `except: log` plus an advancing cursor loses events (fails, fix-offline-book-consistency), so no failure path here ends in silent success.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Implement design.md § Worker runtime, § Dependencies, § Handler database contract and § Lease
   timing in `app/engine/job_graph.py`. Those sections are the behaviour; the seams are:
   - `class ClaimedJob`: `kind`, `subject`, `epoch`, `run_id`, `lane`, `attempts`, `wait_round`,
     and `db(budget)`, the handler's only database access: an async context manager over the
     **service** pool, behind a per-worker gate of one, inside `bounded_txn`.
   - `class JobGraphWorker(repo, service_pool, settings, registry, *, monotonic=time.monotonic,
     utc_today=<UTC date now>, rand=random.random)` with three tick coroutines that each return the
     next delay in seconds (`claim_tick`, `maintenance_tick`, `heartbeat_tick`) and three
     `run_*_forever` coroutines that drive them through `run_supervised`.
   - The constructor calls `registry.validate()` and builds the `ResizableLimiter` over
     `settings.worker_concurrency`; `start_listening()` registers `limiter.wake` with
     `config_watcher.on_change` (kept out of the constructor so a test can build a worker without a
     watcher hook).
2. **Claim tick.** As the design's Claim loop bullet: block on the limiter while full; take free
   slots by repeated `acquire()` while `in_use < limit`; read `worker_enabled` after the limiter
   returns and again after the control lane is taken, immediately before the claim; when false,
   release the lane and the taken slots, issue no statement and return 5 s; release unused slots
   after the claim and all taken slots when the claim fails; start one runner per job. Next delay:
   0 when every free slot was filled; `poll_interval_ms` when some were; after an empty claim,
   double up to `max(poll_interval_ms, 5 s)`. `lease_seconds` is read once per claim.
3. **Maintenance tick** (returns 5 s − elapsed, at least 0): reap, settle, the daily prune ensure,
   and stats every third tick, each its own lane operation and transaction, each guarded on its
   own so one failing step does not skip the others (R-16). `worker_enabled` is read before each
   step and before queueing each settle batch. Settle repeats while a batch is `full`, stopping
   after 20 batches or 8 s. The "ensured for this UTC day" marker is set only after a committed
   ensure, and is in memory only (a restart ensures again). The ensure enqueues the prune identity
   from Step 9 (S-6).
4. **Heartbeat tick** (fixed period 7.5 s; returns 7.5 s − elapsed, at least 0): one batched
   renewal of the attempts in phase `running` or `retry_wait`; an empty set issues no statement.
   The batch is registered in flight in the synchronous step that snapshots its keys and its
   completion is signalled in a `finally`. Loss is declared only from a committed result that
   omits the pair, and never for an attempt already `reporting`. `lease_seconds` is read once per
   tick. A renewed attempt's fence deadline becomes the batch's send time + `lease_seconds` − 3 s;
   a failed batch leaves it unchanged.
5. **Runner.** Runner and handler tasks start through `supervision.spawn(..., forever=False)`. The
   handler runs in a wrapper that catches `Exception` and `AttemptStopped` and returns an outcome;
   `CancelledError` propagates. The runner is never cancelled. It takes the control lane, becomes
   `reporting` and checks for an in-flight heartbeat batch in one synchronous step, waits for that
   batch with its own 6 s timer, then writes the report or park. Retry on failure 1, 2, 4 … 30 s
   while heartbeated, until success, a fence rejection or the 300 s give-up measured from the end
   of the handler task; `ParkRace` is a failed try and the handler is not re-run. `WaitOn` is
   validated (`validate_wait_on`) before any park; a failed check is a permanent failure. The
   limiter slot is released by a done-callback on the runner task.
6. **Stop path.** A stop is a lost lease, the self-fence (3 s before the lease last renewed would
   expire) or the 900 s attempt deadline; the latter two apply only while the handler task runs.
   The attempt records the stage of its current database block (`gate`, `acquire`, `txn`; `txn` is
   set through `bounded_txn`'s `on_acquired`). A stop terminates the connection (`abort()`) when
   the stage is `txn` and cancels the handler task otherwise. Once a stop is pending or the fence
   deadline has passed, `job.db()` raises `AttemptStopped`. Everything else as design.md § Worker
   runtime, Stop path (lost lease or self-fence writes nothing; deadline within 10 s reports;
   unresponsive handler after 10 s is logged at ERROR and keeps its slot).
7. **`job.db(budget)`.** A budget outside (0, 30] s raises `PermanentJobError` before the gate.
   The gate wait is bounded by `asyncio.timeout(budget)` (it does no I/O). The gate is released at
   most once and only if acquired, by whichever comes first of block exit, a stop's abort, or the
   transaction's expiry through `on_terminate`.
8. **Disabled worker and shutdown.** As design.md: a tick that reads `worker_enabled` false issues
   no further statement; jobs already running keep their heartbeat and write their result; no
   lease is released at shutdown (R-5).
9. Fixed constants (design.md § Build order, last paragraph) are named module constants: heartbeat
   period 7.5 s, maintenance period 5 s, self-fence margin 3 s, tolerated lag 2 s, attempt
   deadline 900 s, stop grace 10 s, report give-up 300 s, report retry 1 to 30 s, settle at most
   20 batches or 8 s, stats every third tick, stats stale after 45 s, idle claim ceiling 5 s,
   runner batch wait 6 s, claim acknowledgement window 7 s, handler block cap 30 s. The settle and
   prune batch size of 500 is one named constant in `app/repositories/pipeline_jobs.py` (Step 7),
   used by the SQL and by the "full batch" test. Timer lateness beyond 2 s is logged.
10. `app/jobs/__init__.py`: `def build_registry(settings) -> HandlerRegistry` returning an empty,
    validated registry. Step 13 registers the prune kind in it.
11. This step adds no telemetry call (Step 15) and no `main.py` wiring (Step 17). No
    `asyncio.timeout`, `wait_for` or cancellation is delivered inside an open transaction.
12. Per-subject serialization is not added (product-spec § Design Constraints).

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev python -c "from app.engine.job_graph import JobGraphWorker, ClaimedJob; from app.jobs import build_registry"
grep -n "create_task(\|asyncio.Semaphore(\|asyncio.shield" app/engine/job_graph.py app/jobs/__init__.py ; test $? -eq 1   # spawn only; ResizableLimiter only
grep -n "spawn(" app/engine/job_graph.py | head
uv run --extra dev pytest tests/test_job_graph_core.py tests/test_job_graph_settings.py tests/test_live_limits.py -q
python3 ../../scripts/check-watcher-copies.py ../..
```

---

### Step 12 — test: worker runtime, takeover invariants and the handler contract

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_job_graph_worker.py` — create
- `services/xstockstrat-analysis/tests/test_job_graph_worker_real_pg.py` — create
- `services/xstockstrat-analysis/tests/test_job_handler_contract.py` — create
- `services/xstockstrat-analysis/tests/conftest.py` — modify (shared worker test helpers)

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Stopping a supervised loop in a test needs a `BaseException` subclass: `class _Stop(BaseException)` at `tests/test_loop_supervision.py:16-17` and `tests/test_supervision.py:25-26`.
- A virtual-time event loop: **Not found** — created from scratch here. Two consumers (the unit file and the invariants tests), so it lives in `tests/conftest.py`.
- A fake job repository: **Not found** — created here, in `tests/conftest.py`, for the unit file; the real one is exercised through `pipeline_pg` (Step 8).
- `snapshot_watcher` (`tests/conftest.py:62`) builds the settings watcher; `pipeline_pg` and `insert_pipeline_job` come from Step 8.
- AST-scan test precedents: `tests/test_identity.py:22-38` and `tests/test_telemetry_allowlist.py:134-155`.
- design.md § Handler database contract lists what `tests/test_job_handler_contract.py` must reject; § Build order lists "Step 4's unit tests".

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-14, AC-16, AC-17`

**Instructions**:
1. `tests/conftest.py`: a virtual-time event-loop helper (time advances only when the test advances
   it or when every task is blocked on a timer) and a recording fake repository implementing
   Step 7's method names with scripted results and injectable failures. Keep both small; a test
   builds its handlers inline (a `probe` kind).
2. `tests/test_job_graph_worker.py` (fake repository, virtual time):
   - `@AC-14`: `worker_enabled` false and one ready job → 10 s of claim and maintenance ticks call
     no repository method; the job's recorded state is unchanged.
   - `@AC-16`: `worker_enabled` false across 10 s on 2026-11-27 → no `enqueue` of
     `pipeline.retention_prune`.
   - `@AC-17`: a job is running; the flag becomes false; the handler then returns → the report is
     written as succeeded, and a second ready job is never claimed.
   - `@AC-3`: a holder stops renewing; after `lease_seconds` + 10 s (plus up to 4 s of lag) of
     virtual time a second worker with a free slot has claimed it, with an enabled instance, the
     kind registered and the database answering.
   - The design's unit list: a stop inside a database block aborts it and raises `AttemptStopped`;
     a new block is refused after a stop; an unresponsive handler keeps its slot until its task
     ends; an attempt retrying its report keeps its slot; a claim loop blocked on a full limiter
     when the worker is disabled claims nothing once the slot is freed; a job claimed right after
     `lease_seconds` is lowered is renewed before its fence; the claim delay sequence (0,
     `poll_interval_ms`, doubling to the idle ceiling); a `ParkRace` re-runs the park and not the
     handler; the 300 s give-up counts once and drops the key; a committed heartbeat that omits a
     `reporting` attempt declares no loss.
   - The lane invariants of design.md § Lease timing: at most (slots held + 2) operations queued; a
     lane operation lasts at most 8 s and a runner's at most 14 s; a maintenance tick issues at
     most 3 lane operations besides settle and at most 20 settle batches, none queued after 8 s;
     the idle claim delay is at most 5 s.
   - The daily ensure: enqueued once per UTC day per worker, again after the marker is lost (a new
     worker), and the marker is not set when the ensure fails.
3. `tests/test_job_graph_worker_real_pg.py` (`real_pg`, `pipeline_pg`, real repository, short
   budgets):
   - `@AC-2`: two workers and one ready job → the handler runs once.
   - `@AC-8`: a parent handler returns `WaitOn` on a child; the child handler succeeds; a
     maintenance tick settles; the parent runs again with `wait_round` 1 and succeeds.
   - `@AC-9`: the child handler returns `Verdict("no_vendor_data")` → the parent ends `blocked`
     with that verdict and its handler ran once.
   - a runner that waited for an in-flight heartbeat batch records no false loss (S-7).
   - a handler raising `PermanentJobError` ends `failed`; one raising `RuntimeError` is `ready`
     again with a `next_attempt_at` at least 5 s ahead.
4. `tests/test_job_handler_contract.py`: a checker function that parses a module's source and
   returns its violations, applied to every file under `app/jobs/`. It rejects each item of
   design.md § Handler database contract: `asyncpg` imports, any `.acquire(` call, the names
   `db_pool` / `control_pool`; imports from `app.repositories.read_budget`, or from
   `app.repositories.pipeline_jobs` other than `prune_batch`; catching `BaseException`,
   `CancelledError` or `AttemptStopped`, or a bare `except:`; `asyncio.shield`, or
   `asyncio.timeout` / `wait_for` around a `.db(` block; inside a `job.db()` block, an await that
   is neither a call on the block's `conn` nor a call passing `conn=`. One synthetic offending
   source per rule proves each rule fires (so the test is not vacuous while `app/jobs/` is empty),
   and one compliant source passes.
5. Design gate tests that need the engine (`real_pg`, `tests/test_job_graph_worker_real_pg.py`):
   - 1 200 settleable parents are all woken by ONE maintenance tick of a real worker (three settle
     batches inside the tick), each with the lowest-id verdict;
   - a runner that waited for an in-flight heartbeat batch records no false loss (S-7).
6. RED: `@AC-17`'s "second job still ready with attempt count 0" and the contract checker's
   bare-`except:` case.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_job_graph_worker.py tests/test_job_graph_worker_real_pg.py tests/test_job_handler_contract.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "pipeline_pg\|snapshot_watcher\|from tests.conftest\|conftest" tests/test_job_graph_worker.py tests/test_job_graph_worker_real_pg.py | head   # C-13: shared helpers imported from conftest
grep -c "asyncio.sleep(" tests/test_job_graph_worker.py   # 0: virtual time only
```

---

### Step 13 — service: the retention-prune job kind

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/jobs/retention_prune.py` — create
- `services/xstockstrat-analysis/app/jobs/__init__.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `app/jobs/__init__.py` (`build_registry`) and the handler contract: Step 11 and Step 12.
- `prune_batch(conn, *, state, older_than_days, cutoff=None)`: Step 7 (S-2).
- Prune identity constants and `Lane`: Step 9. `JobGraphSettings.retention_days`: Step 2.
- design.md § Retention prune: the handler's rules; FR-7 in product-spec.md.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `app/jobs/retention_prune.py`: `make_handler(settings, *, monotonic=time.monotonic)` returning
   `async def handler(job)`. Its only imports from the service are the outcome types from
   `app.engine.job_graph` and `prune_batch` from `app.repositories.pipeline_jobs`.
2. The handler reads `retention_days` once at entry. It runs four DELETE loops in this order:
   `failed`, `dead`, `blocked` (each `older_than_days = max(30, retention_days)`), then `succeeded`
   (`older_than_days = retention_days`), so a succeeded backlog cannot starve the terminal states.
3. Each batch runs in its own `async with job.db(30) as conn` block and awaits only
   `prune_batch(conn, …)` inside it. The first batch of a loop passes `cutoff=None` and reuses the
   returned cutoff for the rest of that loop. A loop ends when a batch reports fewer than 500
   candidates.
4. Before starting each batch, if 600 s have passed since entry (injected `monotonic`), stop and
   return `Succeeded`; the rest waits for the next day's job. Otherwise return `Succeeded` when the
   four loops end.
5. No `try`/`except` in the handler: an error is classified by the engine (transient unless
   `PermanentJobError`).
6. `app/jobs/__init__.py`: `build_registry(settings)` registers the prune kind with
   `make_handler(settings)` and no `child_kinds`, then validates.

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev pytest tests/test_job_handler_contract.py tests/test_job_graph_worker.py -q   # the new handler passes the contract scan
grep -n "^from\|^import" app/jobs/retention_prune.py
```

---

### Step 14 — test: retention prune end to end

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_retention_prune_job.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `pipeline_pg`, `insert_pipeline_job`, `shift_pipeline_job`: `tests/conftest.py` (Step 8); `snapshot_watcher` at `tests/conftest.py:62`.
- The worker under a real repository: Step 12's `tests/test_job_graph_worker_real_pg.py` is the pattern for building two workers on one database.

**TDD**: `red-green required`

**Covers**: `AC-12, AC-15, AC-18`

**Instructions**:
1. `pytestmark = pytest.mark.real_pg`. Rows come from `insert_pipeline_job`; finish times are set
   by rewriting `finished_at`.
2. `@AC-12`: `retention_days` 7; one `succeeded`, `failed`, `dead` and `blocked` row each finished
   8 days ago; run the prune job through a worker (ensure, claim, handler, report) → the
   `succeeded` row is gone, the other three remain, and the prune job itself is `succeeded`.
3. `@AC-18`: `retention_days` 7; `dead` rows finished 31 and 29 days ago → only the first is
   deleted. Add a `retention_days` 45 case: a `dead` row aged 40 days survives (`max(30, 45)`).
4. `@AC-15`: two workers on one database, both with `utc_today` 2026-11-27, each run their first
   maintenance tick → exactly one `pipeline.retention_prune` row for epoch `2026-11-27`; after the
   claim and report it is `succeeded`, and its handler ran once. RED: the "exactly 1" assertion.
5. FR-7's guard: a `succeeded` child aged 8 days that an unfinished (`waiting`) parent depends on
   is not deleted; once the parent is finished and aged, both go.
6. The 600 s self-stop: with an injected `monotonic` that jumps past 600 s after the first batch
   and more than 500 prunable rows, the handler returns `Succeeded` with rows left, and the job
   ends `succeeded`.
7. More than 500 prunable rows in one state are deleted across batches in one run.
8. After the prune deleted a succeeded key, the same key can be enqueued again and is created
   (FR-7).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_retention_prune_job.py tests/test_job_handler_contract.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "pipeline_pg\|insert_pipeline_job\|from tests.conftest\|conftest" tests/test_retention_prune_job.py | head   # C-13: fixtures from conftest
```

---

### Step 15 — service: pipeline telemetry

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify
- `services/xstockstrat-analysis/app/engine/job_graph.py` — modify (record calls only)
- `services/xstockstrat-analysis/app/repositories/pipeline_jobs.py` — modify (duration record calls only)

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Wrappers: `class Counter(_Bound)` at `app/telemetry.py:325`, `class Histogram(_Bound)` at `:341` (takes `buckets`), `class Gauge(_Bound)` at `:365-397`. The gauge callback returns `[Observation(value)]` for a scalar and nothing for `None` (`:378-387`); it carries no attributes today and has no production user (`grep -rn "Gauge(" app` returns only the class).
- Loop names: `class Loop(StrEnum)` at `:404-411`, five members; `log_tick_ok(logger, loop, duration_ms, state=None)` at `:414-419`.
- Label keys: `KEY_OUTCOME`, `KEY_SOURCE`, `KEY_TRIGGER`, `KEY_KIND`, `KEY_SERVICE` at `:423-427`; the helper shape is a module-level instrument plus `record_x(outcome)` (`:466-507`).
- New instruments must go through these rebinding wrappers and gauges are registered after telemetry init (ledger insights, otel-metrics-logs-export).
- `host.provider` is stamped on every datapoint by the exporter wrapper (`app/telemetry.py:49-66`), so new instruments need no label for it.
- `tests/test_telemetry_allowlist.py:158` asserts `len(telemetry.Loop) <= 8`; `:157-164` requires every `log_tick_ok` loop argument to be a `Loop.<MEMBER>` attribute.

**Lands with**: `Step 16`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `app/telemetry.py`, as design.md § Telemetry:
   - `Loop.PIPELINE_WORKER = "pipeline_worker"` (six of eight).
   - `KEY_LANE = "lane"`, `KEY_STEP = "step"`, `KEY_PHASE = "phase"`.
   - Counter `analysis.pipeline.attempts` with `record_pipeline_attempt(outcome)`; outcomes
     `succeeded|parked|blocked|retried|failed|dead|expired`.
   - Counter `analysis.pipeline.lease_events` with `record_pipeline_lease_event(outcome)`; outcomes
     `lost_heartbeat|lost_self_fence|report_rejected|report_abandoned|handler_abandoned`.
   - Histogram `analysis.pipeline.db.duration`, unit `s`, buckets
     `[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]`, with
     `record_pipeline_db_duration(step, phase, seconds, outcome=None)`; `step` in
     `heartbeat|claim|reap|settle|ensure|stats|report|park|handler`, `phase` in `wait|total`,
     `outcome` (`ok|error|timeout`) only on `phase=total`.
   - Extend `Gauge` so `observe()` may return a list of `(value, attributes)` pairs; a scalar
     return keeps today's single attribute-less observation and `None` still reports nothing.
   - Gauges `analysis.pipeline.ready_depth` and `analysis.pipeline.oldest_ready_age` (unit `s`),
     both labelled by `KEY_LANE`, reading one module-level snapshot;
     `set_pipeline_ready_stats(stats, *, at)` stores it and the gauges report nothing when it is
     older than 45 s; `register_pipeline_gauges()` registers both.
2. `app/engine/job_graph.py`, record calls only:
   - the claim loop writes `log_tick_ok(log, Loop.PIPELINE_WORKER, …)` at most once per 60 s: no
     state after a claim that returned jobs, `idle` after an empty claim, `disabled` when disabled,
     nothing while blocked on a full limiter;
   - `record_pipeline_attempt` once by whoever writes the transition out of `running` (the report
     for `succeeded|blocked|retried|failed|dead`, the park for `parked`, the reap for `expired`
     and `dead`); a fenced-out report or park counts nothing here;
   - `record_pipeline_lease_event` at the five places design.md § Worker runtime names;
   - the stats step calls `set_pipeline_ready_stats` with the repository's result and the label
     `Lane(...).name.lower()`;
   - `record_pipeline_db_duration` for `step=handler` around `job.db()` (wait: gate request to
     pool acquire; total: gate request to transaction exit).
3. `app/repositories/pipeline_jobs.py`: `record_pipeline_db_duration` for the control steps (wait:
   from requesting the lane, or the pool for `heartbeat`, until the pool acquire returns; total:
   until the transaction exits, with the outcome). A method called with `conn=` records nothing.
4. No label carries a job id, subject, kind, run id, user or symbol (`@AC-7 @feature-294`).
5. No alert, dashboard or `packages/otel/produced-signals.tsv` row ships (design.md § Telemetry;
   that registry lists only signals an alert or dashboard queries).

**Verification**:
```bash
cd services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run --extra dev pytest tests/test_telemetry_allowlist.py tests/test_telemetry_instruments.py tests/test_job_graph_worker.py tests/test_pipeline_jobs_real_pg.py -q   # existing gauge and allow-list behaviour kept
grep -n "PIPELINE_WORKER\|KEY_LANE\|KEY_STEP\|KEY_PHASE" app/telemetry.py
cd ../.. && python3 scripts/check-otel-produced-signals.py
```

---

### Step 16 — test: pipeline telemetry

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pipeline_telemetry.py` — create
- `services/xstockstrat-analysis/tests/test_telemetry_allowlist.py` — modify
- `services/xstockstrat-analysis/tests/test_telemetry_instruments.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_analysis_tick_telemetry.py:164-166` asserts the set of `loop` values in the emitted tick records equals every `telemetry.Loop` member, so adding `Loop.PIPELINE_WORKER` (Step 15) turns it red until its driver emits a pipeline tick. Steps 15 and 16 therefore land in one commit.
- `ALLOWED_KEYS` is derived from the module's `KEY_*` names (`tests/test_telemetry_allowlist.py:16`); `MIN_INSTRUMENTS` at `:34-42`; `_drive()` at `:46-56`; `_keys_by_instrument` at `:59-68`.
- In-memory reader fixture: `metric_reader` in `tests/test_telemetry.py:154-163`, re-exported the way `tests/test_telemetry_allowlist.py:10-13` does.
- Gauge tests to extend: `tests/test_telemetry_instruments.py:86-106` (`test_gauge_rebinds_on_provider_change`, `test_gauge_reports_nothing_when_observe_returns_none`).
- Tick-record tests: `tests/test_analysis_tick_telemetry.py:64-149` read `loop tick ok` records by `Loop` member.
- `pipeline_pg`, the fake repository and the virtual-time helper: `tests/conftest.py` (Steps 8 and 12).

**Lands with**: `Step 15`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-13`

**Instructions**:
1. `tests/test_telemetry_allowlist.py`: add `analysis.pipeline.attempts`,
   `analysis.pipeline.lease_events` and `analysis.pipeline.db.duration` to `MIN_INSTRUMENTS`, and
   one call of each new record helper plus a `log_tick_ok(…, telemetry.Loop.PIPELINE_WORKER, 1.0)`
   to `_drive()`.
2. `tests/test_analysis_tick_telemetry.py`: extend the driver that feeds the all-members assertion
   at `:164-166` so it also drives one pipeline claim tick (a worker with a fake repository), and
   the emitted records include `loop=pipeline_worker`. `tests/test_telemetry_allowlist.py:158`
   (`len(telemetry.Loop) <= 8`) needs no change at 6 of 8.
3. `tests/test_telemetry_instruments.py`: a gauge whose `observe()` returns
   `[(4, {"lane": "watchlist"}), (1, {"lane": "held"})]` exports two points with those attributes;
   the scalar and `None` cases keep passing unchanged.
4. `tests/test_pipeline_telemetry.py`:
   - `@AC-13` (`real_pg`): four ready `watchlist` rows, the oldest 120 s old; run the stats step;
     collect through `metric_reader` → `analysis.pipeline.ready_depth{lane=watchlist}` is 4 and
     `analysis.pipeline.oldest_ready_age{lane=watchlist}` is at least 120. A snapshot older than
     45 s exports no point for either gauge. RED: the depth assertion.
   - `@AC-4` (`real_pg`): worker A loses its lease to worker B; B reports success; A's report is
     rejected → `analysis.pipeline.attempts{outcome=succeeded}` is exactly 1,
     `analysis.pipeline.attempts{outcome=expired}` is 1 and
     `analysis.pipeline.lease_events{outcome=report_rejected}` is 1.
   - one counted outcome per transition: `parked`, `blocked`, `retried`, `failed`, `dead`;
   - the claim loop's tick record: no state after a claim with jobs, `idle` after an empty claim,
     `disabled` when disabled, at most one record per 60 s of virtual time;
   - `analysis.pipeline.db.duration` carries only `step`, `phase` and (on `total`) `outcome`;
   - the durable `@AC-3 @feature-337` case: collected through the exporter wrapper, a point of
     each new instrument carries `host.provider`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_pipeline_telemetry.py tests/test_telemetry_allowlist.py tests/test_telemetry_instruments.py tests/test_analysis_tick_telemetry.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "metric_reader\|pipeline_pg\|from tests.conftest\|conftest" tests/test_pipeline_telemetry.py | head   # C-13: shared fixtures imported
```

---

### Step 17 — service: startup wiring (control pool, worker, three boot tasks)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `init_telemetry()` at `app/main.py:41`; the analysis watcher `cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")` at `:43`.
- The service pool at `:53-63`: `asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2")), statement_cache_size=0 if os.environ.get("DB_PGBOUNCER") in ("true", "1") else 100)`.
- Background tasks start only `if db_pool is not None` (`:127`); the last is `spawn(servicer.run_template_intent_sweep_forever(), "template-intent-sweep", forever=True)` at `:228`, before `await grpc_server.wait_for_termination()` at `:231`.
- `handle_shutdown` (`:120-121`) only stops the gRPC server; no lease is released at shutdown (R-5).
- Source pins on this file: `tests/test_supervision.py:143-148` (`source.count("create_task(") == 1`, `source.count("spawn(") == len(_BOOT_TASK_NAMES)`); `tests/test_owner_header_guard.py:114-116` (no `interceptors=` other than `server_interceptors()`); `tests/test_telemetry.py:429-433` (no `os._exit` / `sys.exit`); `tests/test_strategy_templates.py:671`.
- Deploy files need no change: no new env var or port. `DB_PGBOUNCER` is already set for analysis and `DB_POOL_MAX` is deliberately unset (`.do/app.yaml:330-332`).
- F-06: pooled client connections are not backend slots (`docs/patterns/database.md:175-180`); the control pool adds client connections to PgBouncer only.

**Lands with**: `Step 18`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module-level helper `_create_pool(dsn, **kwargs)` that calls `asyncpg.create_pool` with
   the `statement_cache_size` rule of `:59-61` (one copy of the rule; keep the two-line PgBouncer
   comment with it). Build the service pool through it with the same `min_size=1` and
   `max_size=int(os.environ.get("DB_POOL_MAX", "2"))`.
2. When `DATABASE_URL` is set, also build the control pool through it: `min_size=0`, `max_size=2`,
   `reset=control_pool_reset`. The size is a literal: it is fixed and not env-overridable (design.md
   § Bounded database access). If Step 6 recorded a fallback (`min_size=1`, or no `reset`), use
   that.
3. After `init_telemetry()` (`:41`) call `register_pipeline_gauges()`.
4. Inside the `if db_pool is not None:` block, after `:229`: build `JobGraphSettings(cfg_watcher)`,
   `PipelineJobsRepository(control_pool)`, `build_registry(settings)` and
   `JobGraphWorker(repo, db_pool, settings, registry)`; call `worker.start_listening()`; then
   three `spawn(…, forever=True)` calls named `pipeline-claim`, `pipeline-maintenance` and
   `pipeline-heartbeat` (S-4) for the three `run_*_forever` coroutines; one `log.info`.
5. Follow the file's existing local-import style for the engine modules (`:146-148`, `:183`).
6. Add no `create_task(`, no shutdown hook and no env var. `analysis.job_schedule` and
   `DurableSchedule` are not touched or imported by the new code.

**Verification**: Step 18's combined gate for the Steps 17+18 unit.

---

### Step 18 — test: boot wiring

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_supervision.py` — modify
- `services/xstockstrat-analysis/tests/test_pipeline_boot.py` — create

**Reviewers**: `xstockstrat-analysis` service owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_BOOT_TASK_NAMES` at `tests/test_supervision.py:13-22` (eight names) and `test_boot_sites_are_spawned_and_retained` at `:143-148`. This is the durable rule `@AC-4 @FR-2 @feature-259`, which design.md marks EXTEND.
- `tests/test_supervision.py:10` already imports `from app import main as app_main` and `:7` imports `asyncpg`.
- Disjointness from the existing scheduler is a design constraint (product-spec § Design Constraints, "Existing scheduler"); `DurableSchedule` lives in `app/engine/durable_schedule.py:32`.

**Lands with**: `Step 17`

**TDD**: `red-green required`

**Covers**: — (no 367 scenario; it extends the durable `@AC-4 @feature-259` and pins F-06 for the new pool)

**Instructions**:
1. `tests/test_supervision.py`: append `"pipeline-claim"`, `"pipeline-maintenance"` and
   `"pipeline-heartbeat"` to `_BOOT_TASK_NAMES`. The existing count and name assertions then cover
   the three new tasks.
2. `tests/test_pipeline_boot.py`:
   - `_create_pool` passes `statement_cache_size=0` when `DB_PGBOUNCER` is `true` or `1` and `100`
     otherwise (`monkeypatch` `asyncpg.create_pool` with an `AsyncMock` and the env var). RED: this
     assertion (`_create_pool` does not exist today).
   - the control pool is requested with `min_size=0`, `max_size=2` and
     `reset=control_pool_reset`, and its `max_size` does not follow `DB_POOL_MAX` (set
     `DB_POOL_MAX=7`: the service pool asks for 7, the control pool still for 2);
   - `inspect.getsource(app_main)` contains `register_pipeline_gauges(` after `init_telemetry(`;
   - disjointness: neither `app/engine/job_graph.py`, `app/repositories/pipeline_jobs.py` nor any
     file under `app/jobs/` contains `job_schedule` or `DurableSchedule`.
3. The pool arguments are scenario one-offs with one consumer; they stay inline (C-13).

**Verification** (the single gate for the Steps 17+18 unit):
```bash
cd services/xstockstrat-analysis
uv run --extra dev pytest tests/test_supervision.py tests/test_pipeline_boot.py tests/test_owner_header_guard.py tests/test_telemetry.py tests/test_strategy_templates.py -q
uv run --extra dev pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -c "spawn(" app/main.py   # 11
git status --short -- ../../docker-compose.yml ../../.do ../../deploy/homelab/compose.yml   # empty: no new env var or port, so no deploy-file change
```

---

### Step 19 — docs: pool budget, pooling pattern, analysis service docs, recovery page, program plan

**Status**: `pending`
**Service**: `docs/` and `services/xstockstrat-analysis/` (documentation only)
**Files**:
- `CLAUDE.md` — modify (the analysis row of § Connection Pool Budget only)
- `docs/patterns/database.md` — modify (§ Connection pooling)
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-analysis/docs/pipeline-jobs.md` — create
- `docs/roadmap/program-job-graph-analysis-pipeline.md` — modify (line 81 only)

**Reviewers**: none

**Codebase Evidence**:
- Root budget row: `CLAUDE.md:220`, `| xstockstrat-analysis | Python | pool `:25061` | default 2 | `DB_POOL_MAX` unset |`.
- `docs/patterns/database.md:175-180` ("`DB_POOL_MAX` is not set on the pooled services … it bounds only the client→PgBouncer connection count, not backend slots") and `:182-187` (pool size 5).
- `services/xstockstrat-analysis/CLAUDE.md:74-75`, "Reuses the existing asyncpg pool (no new pool — budget stays 2)."; `:95`, "No lease/CAS fencing is added (`instance_count:1` trap, ledger 2026-08-25)." (about `DurableSchedule`, which stays true); § Observability at `:329`; the per-topic pointer style, for example `:111` ("Detail → this service's `docs/` folder (**`pnl-consumer.md`**)").
- Per-service docs pages live in `services/xstockstrat-analysis/docs/` (eleven files today); `scripts/check-context-map.py` validates doc cross-references and passes on the current tree.
- Program plan: `docs/roadmap/program-job-graph-analysis-pipeline.md:81`, feature 1's "Retires or reuses" cell reads "Reuses the transaction-scoped advisory lock pattern from 311 and the supervision helpers from 259". The design rejected advisory locks (R-1); P-03 requires the note be corrected, not dropped.
- `node scripts/check-config-wiring.mjs --doc-check` scans the root `CLAUDE.md` and every `services/*/CLAUDE.md` for retired config wording.
- The config rows of the analysis `CLAUDE.md` and the config-governance entry already landed in Step 1 (S-8).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md:220`: the Pool max and Notes cells become "service 2 (`DB_POOL_MAX` unset) +
   pipeline control 2 (fixed, not env-overridable); client connections to PgBouncer, not backend
   slots". Change no other row and no total: the direct backend total (8) and the pooled cap (5)
   are unchanged (F-06).
2. `docs/patterns/database.md` § Connection pooling: one short paragraph after `:180` stating that
   analysis opens a second client pool of fixed size 2 for the pipeline job graph's control
   operations, that it is behind the same PgBouncer pool and adds no backend slot, and that
   `SKIP LOCKED` row locks and `SET LOCAL statement_timeout` are transaction-scoped and so work
   through transaction pooling, while `LISTEN`/`NOTIFY` and session advisory locks do not.
3. `services/xstockstrat-analysis/CLAUDE.md`:
   - amend `:74-75` so it no longer says the service has one pool: run-history persistence reuses
     the service pool, and the pipeline job graph has its own fixed control pool of 2;
   - add a short `### Pipeline job graph (feature 367)` section after § Shared durable scheduler:
     what it is, that it is disjoint from `DurableSchedule` and `analysis.job_schedule`, that its
     only production kind is `pipeline.retention_prune`, the handler contract in one sentence
     (`job.db()` is a handler's only database access; `tests/test_job_handler_contract.py` enforces
     it), and "Detail → this service's `docs/` folder (**`pipeline-jobs.md`**)". Leave `:95` as it
     is;
   - § Observability: the loop name `pipeline_worker` with its states, and the instruments
     `analysis.pipeline.attempts{outcome}`, `analysis.pipeline.lease_events{outcome}`,
     `analysis.pipeline.db.duration{step, phase, outcome}`, `analysis.pipeline.ready_depth{lane}`
     and `analysis.pipeline.oldest_ready_age{lane}`.
4. `services/xstockstrat-analysis/docs/pipeline-jobs.md`, new, written from design.md:
   - the state table and what each state means; lanes; the at-least-once rule (effects outside the
     fenced report must be idempotent);
   - the fixed timing constants and the takeover figure (`lease_seconds` + 10 s, plus up to 4 s of
     event-loop lag, with an enabled instance, the kind registered and a free slot);
   - **manual recovery**, copied exactly from design.md § Retention prune: the `failed`/`dead`
     `UPDATE`, the `blocked` transaction, the bottom-up order, the 10 s wait before walking
     upward, and that requeuing a job does not unblock jobs already `blocked` on it. Step 8 pins
     this SQL;
   - what to watch, as the design lists it: `loop tick ok loop=pipeline_worker` absent for over
     60 s while enabled; `lease_events{outcome=handler_abandoned}`; `attempts{outcome=dead}`;
     absent `ready_depth` / `oldest_ready_age` means disabled or failing stats, not an empty
     queue;
   - the "job not running" checklist (state, `next_attempt_at`, `lease_expires_at`, `last_error`,
     children through `pipeline_job_deps`, `worker_enabled`, whether the kind is registered);
   - `worker_enabled = false` stops claims, the ensure and reaping, so `running` rows past expiry
     are expected until it is re-enabled; an instance whose slots are all held by unresponsive
     handlers needs a restart;
   - the accepted risks an operator can meet, from design.md § Open Risks (no requeue until
     program feature 4; a kind no instance registers pins the ready gauges; a prune that fails
     every day shows only as `attempts{outcome=dead}`).
5. `docs/roadmap/program-job-graph-analysis-pipeline.md:81`: replace "Reuses the
   transaction-scoped advisory lock pattern from 311 and the supervision helpers from 259" with
   text saying the feature reuses the supervision helpers from 259 and uses row locks with a lease
   token, not advisory locks (feature 367 design, R-1). Change nothing else on the line.
6. Bash in the new page, if any, must be macOS-compatible (root `CLAUDE.md`). No banned config
   wording.

**Verification**:
```bash
python3 scripts/check-context-map.py
node scripts/check-config-wiring.mjs --doc-check
grep -n "pipeline control 2" CLAUDE.md
grep -n "advisory" docs/roadmap/program-job-graph-analysis-pipeline.md
grep -n "pipeline-jobs.md" services/xstockstrat-analysis/CLAUDE.md
grep -c "FOR NO KEY UPDATE" services/xstockstrat-analysis/docs/pipeline-jobs.md   # the blocked-job recovery lock (D-60)
grep -n "no new pool" services/xstockstrat-analysis/CLAUDE.md ; test $? -eq 1
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
