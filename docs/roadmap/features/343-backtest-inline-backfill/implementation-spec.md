# Implementation Spec: backtest-inline-backfill

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/343-backtest-inline-backfill/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/backtest-inline-backfill`
**Tree**: `feature/backtest-inline-backfill@42f5e7b2e`. `origin/main-dev@d1c97273b` is 4 commits ahead and not merged; those commits change no file this spec cites except `services/xstockstrat-ingest/docs/context-constitution-findings.md`, whose cited line is unchanged (`:39` on both). `/sdd-execute` BRANCH SYNC merges `main-dev` before Step 1.

---

## Execution Summary

The work runs backend first, then the Agent surface, then the UI, so that every consumer lands on a server that already accepts it. Steps 2-4 add the span-cap config key (seed, reader, tests). Steps 5-6 turn the `TriggerBackfill` admin gate into "admin or self-serve envelope" with per-symbol de-duplication, proven by one table-driven test. Step 7 updates the ingest and platform docs. Steps 8-9 bring the Agent tool wording, the runbook and the `strat-lab` skill in line. Steps 10-15 build the UI: the pure helper with vitest, the symbol-page Backtests card with its e2e, and the insights strategy button with its e2e. Step 1 (merge-order row) and Step 16 (homelab runbook) are documentation only.

Design decisions carried in: `design.md` § Chosen Approach is followed without change. No proto change, no ingest schema migration, no BFF change, no new hook, no second lock-breach counter, no edit to `insights/backfills/page.tsx`, no automatic re-run.

Consumer surfaces (C-14), each with its own step:

- UI `/trader` symbol page, Backtests card: Steps 12-13.
- UI `/insights` strategy page button: Steps 14-15.
- Agent `trigger_backfill`: Steps 8-9.

## Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` | 13 |
| `@AC-2` | 11, 13 |
| `@AC-3` | 11, 13 |
| `@AC-4` | 13 |
| `@AC-5` | 13 |
| `@AC-6` | 11, 13 |
| `@AC-7` | 6 (server), 9 (Agent), 13 (UI) |
| `@AC-8` | struck (FR-7 not taken, `design.md` R-6); commented out in `acceptance.feature`, no step |
| `@AC-9` | 11 |
| `@AC-10` | 11 (request shape), 15 (page) |
| `@AC-11` | 6 (server), 11 (copy), 13 (card) |
| `@AC-12` | 6 (server), 11 (copy) |
| `@AC-13` | 11 (copy), 13 (card) |
| `@AC-14` | 11 |
| `@AC-15` | 6 |
| `@AC-16` | 11 |

## Assumptions made at /sdd-spec

Each item is a choice the design left open. A reviewer who disagrees changes it at `/sdd-review impl-spec`.

1. **`343@AC-9` rewrite (O-33).** The scenario's examples were rewritten in `acceptance.feature`. Basis: the round-5 approval ("Agreed") covers a design that lists the rewrite under CHANGE (D-12). No operator decision names the scenario on its own. The old examples cannot be met by the approved PARTIAL copy.
2. **Runbook access route.** Step 16 reads the three Postgres parameters with `psql` over ssh on the database host, and falls back to the DB-owner DSN. Basis: the relayed operator note "I plan to do psql over ssh if possible" is read as answering this open thread; the design names the DSN.
3. **Shared token fixture home.** `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`, loaded through a `tests/conftest.py` fixture on the ingest side and by a repo-root-relative read on the UI side. Basis: ingest owns the contract; C-13 names `tests/conftest.py` as the Python home, and a JSON file must sit beside it.
4. **CI path filter.** The fixture path is added to both filters whose jobs read it in `.github/workflows/ci.yml`: `xstockstrat-agent` (Step 9) and `xstockstrat-ui` (Step 11). Basis: without them a change to the fixture alone runs only the ingest job, which is the drift R-13 rejects. The agent filter was added at `/sdd-review impl-spec` (2026-11-15): it lists ingest `servicer.py` but not the fixture.
5. **Generic denial copy.** "This backfill is not available here. Ask an admin to backfill {symbol}." Basis: the design asks for "one generic sentence" and gives no text.
6. **`@AC-16` copy.** "Backfill failed: {failed} of {total} chunks failed" when `error` is empty. Basis: the design says "failure copy from chunk counts" and gives no text.
7. **Window end source.** The card takes the end of the backtest window from `coverageGaps[0].requestedRange.end`. Basis: analysis sets `requested_range=request.range` on every gap (`services/xstockstrat-analysis/app/handlers/servicer.py:1025`, `:1132`).
8. **De-dup scope.** `has_active_job` matches any QUEUED or RUNNING job that lists the symbol, whatever its data kind. Basis: the design says "per symbol" and does not narrow by kind.
9. **Admin request on the insights button.** Admins send no `fillMode` (UNSPECIFIED, which the server treats as FULL), so the admin request is byte-identical to today. Basis: R-5 "admins keep FULL".
10. **`useTriggerBackfill` is unchanged.** It keeps no `meta.errorHandled`, so the global mutation-error fallback also reports a refused trigger, as it does for the three existing consumers. Basis: the design says "no new hook"; changing the shared hook changes three other callers.
11. **No `strat-lab` version bump.** Basis: `docs/patterns/strat-lab-plugin.md:54` only requires the two `plugin.json` versions to stay identical; no rule found that a skill text change bumps them.
12. **Doubled path in the batch task text** (`docs/roadmap/features/docs/roadmap/features/343-…`) is read as `docs/roadmap/features/343-backtest-inline-backfill/`.

## Step Dependencies

- Steps 2+3+4 land together: Step 2 seeds a config key (§C row 5), so it lands with the reader (Step 3) and the wiring tests (Step 4). Apart, Step 2 fails `check-config-wiring.mjs --final` (`seeded-unread`), and Step 3 turns `tests/test_config_read_classification.py` red until Step 4 classifies the key. All three are backend. RED is captured with Step 4's tests against a tree that has neither the seed nor the reader.
- Steps 5+6 land together: Step 6's tests reference symbols Step 5 creates (`backfill_jobs.has_active_job`, `_SELF_SERVE_DENIAL_TOKENS`, `_self_serve_denial_detail`) (§C row 3). Step 5 alone also turns two existing tests red (`test_permission_denied_without_admin_scope`, `test_validation_runs_after_the_admin_gate`), which Step 6 rewrites. Capture RED with the new symbols present as signatures only, so the failure is an assertion.
- Step 5 requires Step 3 (it reads `backfill_self_serve_max_range_days`).
- Step 7 requires Steps 2-6 (it documents their key and gate).
- Step 9 [test] covers Step 8 [service]. Not a unit: the tests read text and call existing symbols. RED is captured before Step 8's edit.
- Step 8 requires Step 5: the wording is true only once the gate accepts non-admins.
- Step 9 requires Step 6 (it reads `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`) and adds that path to the `xstockstrat-agent` CI filter, so a fixture-only edit runs the agent job.
- Steps 10+11 land together: `xstockstrat-ui`'s `tsc` compiles tests (`services/xstockstrat-ui/tsconfig.json:21`, `"include": [… "**/*.ts", "**/*.tsx" …]`) and Step 11 imports the symbols Step 10 creates (§C row 3). Capture RED with the helpers exported as signatures only.
- Step 11 requires Step 6 (it reads `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json`). The fixture is created on the backend surface and read on the UI surface; the two are separate units because a unit stays on one surface (§C).
- Steps 12+13 land together: Step 12 rewrites the sentence that `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:337` asserts (§C row 4, a referenced resource is removed), and Step 13's mock change is what makes the card's range logic observable.
- Step 12 requires Step 10. Step 14 requires Step 10. Step 15 [test] covers Step 14 [service]; not a unit (the spec references no new symbol).
- Step 16 requires Steps 2 and 5 (it sets the key and describes the denial) and names feature 341's counter.
- **Depends on feature 341 (`fix-indicator-pane-warmup`)** for the marketdata lock-budget breach counter (`marketdata.ohlcv.out_of_memory_errors`, 341 Steps 5-6 on `origin/feature/fix-indicator-pane-warmup`). This feature adds no counter (R-8). Its integration PR waits for 341; Step 1 records the row.
- **Volatile at merge — config migration number.** `050` is the next free number on this tree (`ls services/xstockstrat-config/migrations | tail -1` → `049_notify_commsgun_channel_keys.up.sql`). Two other branches already hold `050`: feature 341 (`050_ui_chart_history_bars`) and feature 330 (`050_analysis_live_enrich_ttl_reseed`). Because this feature merges after 341, expect a renumber. Re-derive the number at Step 2 and again at the integration PR; a renumber means regenerating `scripts/config-wiring-stored.json`. The actor sentinel in the migration is number-free.
- Step 2 needs a reachable Postgres 16 plus `psql` and `migrate` on `PATH` to **generate** `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:4-6`). That is artifact generation, not verification. If no Postgres can be reached the step is blocked (P-03); the JSON is never written by hand.
- **Peer file overlap (C-16 re-scan, 2026-11-15).** No config key, proto field or ingest migration collides. Shared files, disjoint regions, second merger rebases and re-greps its anchors:
  - `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`: 339 and 341.
  - `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` and `e2e/trader/position-detail.spec.ts`: 341.
  - `services/xstockstrat-ingest/app/handlers/servicer.py`, `tests/test_ingest_servicer.py`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `e2e/fixtures/INVENTORY.md`: 344.
  - No durable `@AC-*` rule was added to `origin/main-dev` for ingest, ui or agent since recon (`git diff --name-only HEAD...origin/main-dev` lists no `acceptance/*.feature` and no `platform.feature`).
- Line numbers below were read on the tree named in the header. Re-grep each anchor before editing; a peer merge moves them.

---

### Step 1 — docs: merge-order row for feature 341

**Status**: `done`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Table header at `docs/roadmap/features/merge-order.md:23`: `| Feature | Must wait for | Reason | Resolved |`; row shape at `:27` (`` | `third-party-sso-oidc` (280) | `fix-config-keys-contract` (296) | **Hard — …** | ``).
- Prose-note precedent for a config seed number shared by several features: the section "Config seed number: 334 ↔ 322, 330, 321 (2026-11-11, non-blocking)" at the end of the file.
- Re-spec 2026-11-15 (merged tree `cf9f49aff`): commit `4b1d1e36f` (#1545) already added both entries this step was written to create.
  - Table row at `:127`: `` `backtest-inline-backfill` (343) | `fix-indicator-pane-warmup` (341) | **Hard — merge order only; 341 need not be `launched`.** … `marketdata.ohlcv.out_of_memory_errors` … 343 numbers its migration above 341's at merge time and regenerates `scripts/config-wiring-stored.json`. | No ``. It carries the dependency, the counter and the renumber that the old Instruction 1 asked for.
  - Prose section at `:403-411`, "## Symbol-page cohort: 339-344 (2026-11-15, non-blocking)". It covers the shared symbol page (`src/app/trader/positions/[symbol]/page.tsx`, 339 and 341) and the shared `050` seed number. It does not name 343's other overlaps from this spec's Step Dependencies: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` and `e2e/trader/position-detail.spec.ts` (341), and `services/xstockstrat-ingest/app/handlers/servicer.py`, `tests/test_ingest_servicer.py`, `services/xstockstrat-ui/e2e/mock-backend.ts`, `e2e/fixtures/INVENTORY.md` (344).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add no table row. The existing 343 row at `:127` stays as written.
2. In the "Symbol-page cohort: 339-344" section (`:403-411`), append one sentence before the "Config seed number:" sentence: 343 also shares `src/app/insights/strategies/[id]/page.tsx` and `e2e/trader/position-detail.spec.ts` with 341, and `services/xstockstrat-ingest/app/handlers/servicer.py`, `tests/test_ingest_servicer.py`, `e2e/mock-backend.ts` and `e2e/fixtures/INVENTORY.md` with 344; the regions are disjoint and the second merger rebases. Add no new section.

**Verification**:
```bash
grep -c 'backtest-inline-backfill' docs/roadmap/features/merge-order.md    # 1 (the row at :127; no duplicate row)
grep -n 'insights/strategies/\[id\]/page.tsx' docs/roadmap/features/merge-order.md    # one hit inside the Symbol-page cohort section
```

---

### Step 2 — migration: seed `ingest` / `backfill.self_serve_max_range_days`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/051_ingest_backfill_self_serve_keys.up.sql` — create
- `services/xstockstrat-config/migrations/051_ingest_backfill_self_serve_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`)

**Reviewers**: DBA — NNN numbering, up+down pair, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — key naming, environment scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration: `049_notify_commsgun_channel_keys` (`ls services/xstockstrat-config/migrations | tail -2`). Next free on this tree is `050`; see "Volatile at merge" in Step Dependencies.
- Column list and actor sentinel: `services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql:4-5` (`(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)`), actor `'system:config-migration-feature-webhook-fanout-callback'`, one row per environment, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- An `ingest` int row in that file: `('ingest', 'backfill.webhook_sweep_interval_seconds', 'int', '60', …, '60', 'xstockstrat-ingest', …, 'staging', NULL)`.
- Down template: `048_webhook_fanout_callback_keys.down.sql:4-13` — sentinel **and** seeded `value_data`; its header says "The outer parentheses are load-bearing".
- The checker reads seeds only from `scripts/config-wiring-stored.json`; the generator is `scripts/config-wiring-stored.py:1-6` (needs `DATABASE_URL`, `psql`, `migrate`).
- The key is absent today: `grep -c "self_serve_max_range_days" scripts/config-wiring-stored.json` → 0; `grep -rn self_serve_max_range_days services` → none.
- Config-key contract (C-05, F-07): namespace `ingest`; key `backfill.self_serve_max_range_days`; `value_type` `int`; code default 730; reader `services/xstockstrat-ingest/app/config/watcher.py:backfill_self_serve_max_range_days` (Step 3); seed this step; live through `WatchConfig` (the property is read on every `TriggerBackfill`).

**Lands with**: `Step 3, Step 4`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-derive the number first (`ls services/xstockstrat-config/migrations | tail -2`). If another feature has taken `050`, use the next free number and record the renumber in the Deviation Log.
2. `051_ingest_backfill_self_serve_keys.up.sql`: one `INSERT INTO config.config_values` in the 048 column list with two rows (`staging`, `production`): namespace `'ingest'`, key `'backfill.self_serve_max_range_days'`, `value_type` `'int'`, `value_data` `'730'`, `default_value` `'730'`, `consuming_service` `'xstockstrat-ingest'`, `updated_by` `'system:config-migration-feature-backtest-inline-backfill'`, `user_id` `NULL`, ending with the 048 `ON CONFLICT … DO NOTHING`. Two-line header in the 048 style.
3. Description (same on both rows, no `;` inside the literal): the longest range in days a non-admin may request in one backfill; 730 covers a 200-bar warm-up plus a one-year backtest window; a 1000-bar warm-up needs 1830; raising it lets every signed-in user spend more vendor quota per request; a stored value of 0 or less reads as the default.
4. `051_ingest_backfill_self_serve_keys.down.sql`: one `DELETE FROM config.config_values` restricted to `environment IN ('staging', 'production')`, `user_id IS NULL`, `updated_by = 'system:config-migration-feature-backtest-inline-backfill'`, `namespace = 'ingest'`, `key = 'backfill.self_serve_max_range_days'` and `value_data = '730'`. A row an operator has changed is never deleted.
5. Regenerate the stored set: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`. Commit the result unedited. Blocked path: Step Dependencies.
6. Do not touch `backfill.max_concurrent_jobs`: its seed and default stay 3 (operator decision, option B).

**Verification**:
```bash
ls services/xstockstrat-config/migrations/050_*.up.sql services/xstockstrat-config/migrations/050_*.down.sql
# read both: 2 rows, relative key, sentinel actor; the down deletes exactly what the up inserts and nothing an operator changed
grep -c '"backfill.self_serve_max_range_days"' scripts/config-wiring-stored.json    # 2
# unit verification (with Steps 3 and 4):
node scripts/check-config-wiring.mjs --final      # exit 0, no STALE-STORED, no seeded-unread
node --test scripts/config-wiring.test.mjs
```

---

### Step 3 — service: ingest reader `backfill_self_serve_max_range_days`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion (here: config read with the stored-zero clamp)

**Codebase Evidence**:
- Neighbouring readers: `watcher.py:111-113` (`backfill_max_concurrent_jobs` → `int_positive(self, "backfill.max_concurrent_jobs", 3)`), `:138-139` (`backfill_webhook_sweep_interval_seconds` → `int_positive(self, "backfill.webhook_sweep_interval_seconds", 60)`).
- Clamp helper: `watcher.py:147-150` `def int_positive(cfg, key: str, default: int) -> int` (returns the default for a stored value ≤ 0).
- The checker already knows the forwarder: `scripts/config-wiring.json` → `registry.forwarders` → `"services/xstockstrat-ingest/app/config/watcher.py:int_positive": {"keyArg": 1}`. No registry edit is needed.

**Lands with**: `Step 2, Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a **new** property after `backfill_webhook_sweep_interval_seconds` (`:138-139`): `backfill_self_serve_max_range_days` returning `int_positive(self, "backfill.self_serve_max_range_days", 730)`. No comment is needed beyond what the neighbours carry.
2. No other reader changes. `backfill_max_concurrent_jobs` keeps default 3.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -n 'backfill.self_serve_max_range_days' app/config/watcher.py    # one read, through int_positive
```

---

### Step 4 — test: reader default, clamp and read classification

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_config_watcher.py` — modify
- `services/xstockstrat-ingest/tests/test_config_read_classification.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Clamp table: `tests/test_config_watcher.py:329-347`, `@pytest.mark.parametrize("prop,key,stored,expected", […])` feeding `test_fr3_properties_read_non_positive_as_default`; rows such as `("backfill_max_concurrent_jobs", "backfill.max_concurrent_jobs", -5, 3)`.
- Stored-value and default assertions: `tests/test_config_watcher.py:357-359` (`snapshot_watcher(**{key: 45}).backfill_webhook_sweep_interval_seconds == 45`, `snapshot_watcher().… == 60`).
- Classification guard: `tests/test_config_read_classification.py:24-33` `FR3_KEYS = frozenset({"backfill.max_concurrent_jobs", …})`; its docstring (`:1-6`) says a new read must be classified.
- C-13: the key string is the only literal; it already has its home in each of the two files' own tables. No shared fixture is created.

**Lands with**: `Step 2, Step 3`

**TDD**: `red-green required`

**Covers**: — (supports `244@AC-6`, EXTEND; no feature scenario)

**Instructions**:
1. `test_config_watcher.py`: add two rows to the parametrize list at `:329-347`: `("backfill_self_serve_max_range_days", "backfill.self_serve_max_range_days", 0, 730)` and the same with `-1`.
2. `test_config_watcher.py`: add a **new** test beside `:357-359` asserting a stored 1830 is returned as 1830 and an empty snapshot gives 730.
3. `test_config_read_classification.py`: add `"backfill.self_serve_max_range_days"` to `FR3_KEYS`.
4. RED: run the three tests before Steps 2-3 exist; the property is missing (`AttributeError`) and the classification guard has nothing to classify. Per `tdd-gate.md`, capture RED with the property present as a signature returning 0, so the failures are assertions.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && pytest tests/test_config_watcher.py tests/test_config_read_classification.py -q
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
node scripts/check-config-wiring.mjs --final && node --test scripts/config-wiring.test.mjs     # from the repo root
# C-13 verdict: the only literal is the key string, in each file's own existing table — single consumer per table, inline is compliant
```

---

### Step 5 — service: self-serve envelope and per-symbol de-dup on `TriggerBackfill`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion (here: backfill trigger authorization and duplicate-job prevention)

**Codebase Evidence**:
- Handler: `servicer.py:417` `async def TriggerBackfill(self, request, context)`. `_db is None` → UNAVAILABLE at `:418-420`. Admin gate at `:421-425`: `if not self._has_admin_scope(context): await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")`.
- `_has_admin_scope`: `servicer.py:356-357` (`@staticmethod`), also called at `:405`, `:965`, `:1613`. Only the `:423` call site changes.
- Later checks, unchanged: fundamentals branch `:431-434`, `_canonical_timeframe` + 1d-only reject `:438-446`, `callback_url` validation `:447-451`, `backfill_jobs.insert_job(self._db, …)` `:453-463`, `_emit_backfill_event("ingest.backfill.queued", …)` `:464-471`, `asyncio.create_task(self._run_backfill(…))` `:472`, response `:473-476`.
- Propagation metadata: `_propagation_meta` at `:373-378` keeps `x-user-id`, `x-access-scope`, `x-trace-id`; the queued event is sent with `metadata=propagation_meta` (`:502-515`). No new outbound call is added, so §B header propagation is satisfied by the existing call.
- Caller id lookup pattern: `_resolve_owner` `:384-385` (`metadata = {k: v for k, v in context.invocation_metadata()}`, `metadata.get("x-user-id")`). `SYSTEM_OWNER` is imported at `:32` and compared at `:388`.
- Timestamp helper: `_ts_to_dt(ts)` at `:287-291` returns `None` for an unset timestamp.
- Proto enums: `ingest_pb2.FILL_MODE_GAPS_ONLY` (used at `:654`), `ingest_pb2.BACKFILL_DATA_KIND_FUNDAMENTALS` (`:431`), `BACKFILL_DATA_KIND_UNSPECIFIED = 0`, `BACKFILL_DATA_KIND_BARS = 1` (`packages/proto/ingest/v1/ingest.proto:73-75`), request fields `:78-89`.
- Transaction + advisory lock pattern in this file: `servicer.py:1568-1571` — `async with self._db.acquire() as conn, conn.transaction():` then `await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", src.slug)`.
- Repository: `backfill_jobs.insert_job(db_pool, *, job_id, symbols, timeframe, range_start, range_end, status, data_kind="BARS", callback_url=None)` at `app/repositories/backfill_jobs.py:29-58`; it only calls `db_pool.execute(…)`, so a connection can be passed in place of the pool with no signature change. Symbol predicate precedent: `:111` (`f"${len(params)} = ANY(symbols)"`). The module is proto-free: the servicer passes status ints in (`:1-7`).
- `has_active_job` — **Not found** (`grep -rn has_active_job services/xstockstrat-ingest` → none). It is created here.
- Denial tokens and formatter — **Not found**; created here.
- Reader from Step 3: `self._cfg.backfill_self_serve_max_range_days`.
- Break radius: `TriggerBackfill`'s signature does not change. Call sites of the RPC in tests are all in `tests/test_ingest_servicer.py` (8 calls; `grep -rn 'TriggerBackfill(' tests`). Two of them assert the old gate and are rewritten in Step 6 (`:362`, `:594`). `make_servicer` (`tests/test_ingest_servicer.py:34-62`) builds `cfg` as a `MagicMock`, so the new config attribute must be a real int there (Step 6).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `backfill_jobs.py`: add **new** `async def has_active_job(db, symbol: str, active_statuses: list[int]) -> bool`, placed after `list_jobs`. One parameterized query: whether any row of `ingest.backfill_jobs` has `$1 = ANY(symbols)` and `status = ANY($2::int[])`. It matches every data kind (Assumption 8). `db` may be a pool or a connection.
2. `servicer.py`, next to `_has_admin_scope` (`:356`): add **new**
   - `_SELF_SERVE_DENIAL_PREFIX = "self-serve backfill denied: "`,
   - `_SELF_SERVE_DENIAL_TOKENS`, one frozen tuple in this order: `multi_symbol`, `data_kind`, `fill_mode`, `overwrite`, `range_unset`, `range_too_long`, `callback_url`, `no_user`,
   - `_self_serve_denial_detail(token, max_days=None)` returning the prefix plus the token, plus ` (max <N> days)` when `max_days` is given,
   - `_self_serve_denial(request, context, max_days)` returning the **first** failed condition's token or `None`, checked in the tuple's order:

     | Token | Fails when |
     |---|---|
     | `multi_symbol` | `len(request.symbols) != 1` |
     | `data_kind` | `request.data_kind` is neither UNSPECIFIED nor BARS |
     | `fill_mode` | `request.fill_mode != FILL_MODE_GAPS_ONLY` |
     | `overwrite` | `request.overwrite` is true |
     | `range_unset` | `_ts_to_dt(start)` or `_ts_to_dt(end)` is `None`, or `start >= end` |
     | `range_too_long` | `end - start > timedelta(days=max_days)` |
     | `callback_url` | `request.callback_url` is non-empty |
     | `no_user` | `x-user-id` is missing, empty, or equals `SYSTEM_OWNER` |

   Use the tuple's members in the predicate; do not repeat the eight strings (DRY guard rail).
3. Replace the gate body at `:423-425`, keeping its position after the `_db` check:
   - admin → continue as today (`self_serve = False`);
   - otherwise call `_self_serve_denial(request, context, self._cfg.backfill_self_serve_max_range_days)`; on a token abort `PERMISSION_DENIED` with `_self_serve_denial_detail(token, max_days if token == "range_too_long" else None)` and return; on `None` continue with `self_serve = True`.
   Rewrite the two-line comment above the gate to state the constraint only (≤ 2 lines).
4. Leave `:426-451` unchanged (fundamentals branch, 1d-only reject, callback validation). A self-serve request never reaches the fundamentals branch or the callback validation, because the envelope already denied both.
5. Insert (`:453-463`):
   - admin path: unchanged call on `self._db`.
   - self-serve path: `async with self._db.acquire() as conn, conn.transaction():` → `pg_advisory_xact_lock(hashtext($1))` keyed on `"backfill:" + symbol` → `has_active_job(conn, symbol, [BACKFILL_STATUS_QUEUED, BACKFILL_STATUS_RUNNING])` → when false, `insert_job(conn, …)` with the same keyword arguments as the admin call.
   - on a hit, after the transaction block exits, abort `ALREADY_EXISTS` with a detail that names the symbol and says a backfill is already queued or running. The detail carries no job id (R-4). No insert, no event, no spawn.
6. The `ingest.backfill.queued` emit (`:464-471`) and the `_run_backfill` spawn (`:472`) stay after the insert and therefore after the commit. An `insert_job` exception propagates before either runs. Do not add `user_id` to the event payload (D-11).
7. Before choosing between "inline the two insert branches" and "a small private helper", run the existing suite (`pytest tests/test_ingest_servicer.py -q`) against each shape; keep the one that leaves the admin-path tests untouched (ledger rule, `fails.md` 2026-08-06 backfill-management-ui). Record the shape kept, and the suite result for each, in the Deviation Log.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -c '_has_admin_scope(context)' app/handlers/servicer.py      # 5, as before (the definition at :357 plus call sites :405, :423, :965, :1613)
grep -n 'metadata=propagation_meta' app/handlers/servicer.py      # the queued event still forwards x-user-id / x-access-scope / x-trace-id (PLAT-4)
grep -n '"multi_symbol"' app/handlers/servicer.py                 # exactly one line: the tuple
grep -n 'admin scope required' app/handlers/servicer.py           # no longer inside TriggerBackfill (CancelBackfill and :1613 keep theirs)
# behaviour: Step 6
```

---

### Step 6 — test: envelope table, de-dup, shared denial fixture

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json` — create
- `services/xstockstrat-ingest/tests/conftest.py` — modify
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_backfill_jobs.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Context builder: `tests/conftest.py:17-45` `_ctx(access_scope="4", user_id="u1", peer_sans=(), internal_caller="")`; `"0"` is no admin bit; `user_id=""` omits the header.
- Servicer builder: `tests/test_ingest_servicer.py:34-62` `make_servicer(db=None, *, max_concurrent=5, …)` with `cfg = MagicMock()` and real ints assigned per key (`:53-59`).
- Patch target: `_REPO = "app.repositories.backfill_jobs"` at `:104`; pattern `patch(f"{_REPO}.insert_job", AsyncMock())` and `patch("asyncio.create_task")` at `:307-310`.
- Gate tests to rewrite (MagicMock requests): `test_permission_denied_without_admin_scope` `:362-381`, `test_validation_runs_after_the_admin_gate` `:594-602`. `test_admin_scope_queues` `:383-398` stays.
- Helpers used by `:594`: `_callback_req` `:426-432`, `_trigger` `:435-446`, `_notify_stub` `:449-455`.
- Queued-event assertion precedent: `:320-321` (`svc._ledger.AppendEvent.call_args_list`, `c.args[0].event_type`).
- Transaction mock: `tests/_helpers.py:25-61` `transaction_conn(…)` returns `(db, conn)` with `db.acquire()` yielding `conn`, `conn.execute` and `conn.fetchrow` as `AsyncMock`.
- Repo tests: `tests/test_backfill_jobs.py:17` and `:106` call `backfill_jobs.insert_job(…)` with a mock pool.
- `tests/fixtures/` — **Not found** in ingest (`ls services/xstockstrat-ingest/tests | grep -v '\.py$'` → nothing). Created here (Assumption 3).
- Cross-tree read precedent on the UI side: `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts:9` (`const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))`).
- Ledger trap this guards: `docs/roadmap/ledger/fails.md:308` and `:1516` (hand-mirrored contract strings drift without an executable link).
- C-13 verdict: the denial contract has **two** consumers after this feature (this suite and the UI vitest in Step 11), so it is centralized now, in one JSON file loaded through `conftest.py`. The request literals in the table have one consumer and stay inline.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-7, AC-11, AC-12, AC-15`

**Instructions**:
1. Create `tests/fixtures/self_serve_denial.json` with three keys: `"prefix": "self-serve backfill denied: "`, `"tokens": [the eight tokens in the Step 5 order]`, `"range_too_long_suffix": " (max {max_days} days)"`.
2. `conftest.py`: add a **new** session-scoped fixture `self_serve_denial_contract` that loads that file with `json.loads(pathlib.Path(__file__).parent.joinpath("fixtures", "self_serve_denial.json").read_text())`.
3. `test_ingest_servicer.py` → `make_servicer`: add keyword `self_serve_max_range_days: int = 730` and set `cfg.backfill_self_serve_max_range_days` from it.
4. Add a **new** class `TestTriggerBackfillSelfServe` after `TestTriggerBackfill`. Every row builds a real `ingest_pb2.TriggerBackfillRequest` (never a `MagicMock`) from one in-envelope base request: one symbol, `timeframe_enum` 1DAY, `fill_mode=FILL_MODE_GAPS_ONLY`, `overwrite=False`, a 300-day `range`, no `callback_url`; context `_ctx("0")`. Rows:
   - **contract**: `IngestServicer._SELF_SERVE_DENIAL_TOKENS == tuple(contract["tokens"])`, the prefix equals `contract["prefix"]`, and `_self_serve_denial_detail("range_too_long", 730)` equals prefix + token + the suffix formatted with 730.
   - **eight denial rows** (parametrized over the fixture's tokens, one mutation each: two symbols; `data_kind=FUNDAMENTALS`; `fill_mode=FULL`; `overwrite=True`; range unset, plus a second case `start >= end`; a 731-day range; a `callback_url`; `_ctx("0", user_id="")`, plus a second case `user_id="system"`). Each asserts `PERMISSION_DENIED`, the exact detail from the fixture, `insert_job` not awaited, `asyncio.create_task` not called, and `svc._notify.FanoutWebhook` not awaited. `@AC-15`; the 731-day row is `@AC-12` and also asserts the ` (max 730 days)` suffix.
   - **first-failure order**: a request breaking two conditions (two symbols and `overwrite=True`) is denied with `multi_symbol`.
   - **at cap**: a 730-day range is QUEUED. `@AC-7`.
   - **non-admin accepted**: the base request returns `BACKFILL_STATUS_QUEUED` and a job id; the lock statement and `has_active_job` ran on the transaction connection; `insert_job` received that connection. `@AC-7`.
   - **queued event metadata**: `svc._ledger.AppendEvent` was awaited with `metadata` containing `("x-user-id", "u1")`, and the payload has no `user_id` key (D-11, PLAT-4).
   - **admin row**: `_ctx("4")` with two symbols and `fill_mode=FULL` is QUEUED; `db.acquire` not called; `has_active_job` not awaited. It asserts QUEUED only, never de-dup (D-27).
   - **duplicate**: `has_active_job` returns true → `ALREADY_EXISTS`; the detail names the symbol and contains no UUID; no insert, no event, no spawn. `@AC-11`.
   - **race**: two self-serve requests for one symbol run with `asyncio.gather` against a fake whose `has_active_job` turns true after the first insert; exactly one is QUEUED and one is `ALREADY_EXISTS`. Both are self-serve.
   - **insert raises**: `insert_job` raises → the exception propagates; no `AppendEvent`, no `create_task`.
5. Rewrite `test_permission_denied_without_admin_scope` (`:362`) with a real request that breaks the envelope (FULL fill mode) and assert the `fill_mode` detail. Rewrite `test_validation_runs_after_the_admin_gate` (`:594`) with a real non-admin request carrying a `callback_url`: denied `PERMISSION_DENIED` with the `callback_url` token, `FanoutWebhook` not awaited, no insert (`334@AC-26` preserved). Keep the test names unless the name becomes false; if renamed, grep for the old name first.
6. `test_backfill_jobs.py`: add **new** tests for `has_active_job`: the query is parameterized (symbol and status list are bind parameters, not interpolated), returns true for a truthy row and false otherwise.
7. RED before Step 5: with the new symbols present as signatures only, the denial rows fail (the old gate answers "admin scope required"), the accepted rows fail (denied), and the duplicate row fails.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && pytest tests/test_ingest_servicer.py tests/test_backfill_jobs.py -q
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
grep -n "self_serve_denial_contract\|conftest" tests/test_ingest_servicer.py       # the contract comes from conftest, not an inline copy
grep -rn '"multi_symbol"' tests --include='*.py' | wc -l                             # 0 — the tokens live only in the JSON fixture
grep -n 'MagicMock()' tests/test_ingest_servicer.py | sed -n '1,3p'                  # read: no TestTriggerBackfillSelfServe row builds its request from a MagicMock
```

---

### Step 7 — docs: ingest gate wording, key table, registered-keys log, business-rule row

**Status**: `done`
**Service**: `xstockstrat-ingest`, `docs/`
**Files**:
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/sdd/business-rules/platform.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- Gate wording: `services/xstockstrat-ingest/CLAUDE.md:15-20` ("`TriggerBackfill` (the provider-quota-spending op) and `CancelBackfill` are **admin-gated** — they abort `PERMISSION_DENIED` ("admin scope required") …").
- Key table: `services/xstockstrat-ingest/CLAUDE.md:118-126`; last `backfill.*` row at `:126` (`backfill.webhook_sweep_interval_seconds`, which names its seed migration).
- Open finding: `services/xstockstrat-ingest/docs/context-constitution-findings.md:39` ("`ListBackfillJobs` and `GetBackfillStatus` carry no admin or owner gate …, while `TriggerBackfill` and `CancelBackfill` are admin-only — … status: **open**").
- Registered-keys log: `docs/patterns/config-governance.md` § "Per-Feature Registered Keys" ("Append-only log … Newest first"); entry shape in the feature 334 entry, whose table has columns `Namespace | Key | Type | Default | Reader | Notes` (row for `backfill.webhook_sweep_interval_seconds` at `:191`).
- Business rule: `docs/sdd/business-rules/platform.feature:487-507`, `@AC-6 @FR-3 @regression @feature-244` "A trap-dependent site keeps the coded default for a stored zero"; ingest rows at `:495-498` with columns `service | key | type | stored | site | effective` and the FQN in the key column.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Ingest `CLAUDE.md` § Authorization: `CancelBackfill` stays admin-gated. `TriggerBackfill` is "admin, or the self-serve envelope": list the eight conditions and their tokens, the detail format `self-serve backfill denied: <token>` (with ` (max <N> days)` for `range_too_long`), and the per-symbol de-dup (`ALREADY_EXISTS`, self-serve only, QUEUED and RUNNING). Say the admin path is unchanged.
2. Ingest `CLAUDE.md` key table: add a row after `:126` for `backfill.self_serve_max_range_days` (int, `730`): longest range a non-admin may request in one backfill; 730 = `prefix_calendar_days(200)` (300 days) + the 366-day card window; a 1000-bar warm-up needs 1830; a stored ≤ 0 reads as the default; seed migration `051_ingest_backfill_self_serve_keys` (use the number Step 2 landed on).
3. Findings `:39`: reword the clause "while `TriggerBackfill` and `CancelBackfill` are admin-only" to say `TriggerBackfill` is admin-or-self-serve-envelope since feature 343 and `CancelBackfill` is admin-only. The status stays **open**: the question is about the reads.
4. `config-governance.md`: add a newest-first entry "feature 343 — backtest-inline-backfill (`xstockstrat-ingest`)" with one table row (namespace `ingest`, key `backfill.self_serve_max_range_days`, int, `730`, reader `app/config/watcher.py:backfill_self_serve_max_range_days`, note "`≤ 0` → `730`. Read on every non-admin `TriggerBackfill`."). State: seeded by the Step 2 migration, global, non-secret, insert-if-absent; no `SCALAR_BOUNDS_REGISTRY` entry; no `scripts/config-wiring.json` baseline entry; approval owner + config team. Add one sentence that `backfill.max_concurrent_jobs` keeps default and seed 3 and that the homelab alone sets 8 through `SetConfig` (see `docs/runbooks/config-rollout.md`).
5. `platform.feature`: add one Examples row after `:497`: `xstockstrat-ingest | ingest.backfill.self_serve_max_range_days | int | 0 | the self-serve backfill range cap in days | 730`, aligned with the table. Change nothing else in the scenario (`244@AC-6`, EXTEND).

**Verification**:
```bash
grep -n 'self_serve_max_range_days' services/xstockstrat-ingest/CLAUDE.md docs/patterns/config-governance.md docs/sdd/business-rules/platform.feature
grep -n 'admin scope required' services/xstockstrat-ingest/CLAUDE.md     # no longer attached to TriggerBackfill
node scripts/check-config-wiring.mjs --final                                # the doc scan still passes
```

---

### Step 8 — service: Agent `trigger_backfill` wording, runbook and `strat-lab` skill

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools

**Codebase Evidence**:
- Tool: `services/xstockstrat-agent/app/tools.py:1546` `async def trigger_backfill(ctx, symbols, timeframe="1d", start=None, end=None, overwrite=False, fill_mode=None, data_kind="bars", callback_url="")`. Docstring first line `:1557` "… (admin-scoped write)."; the false sentence at `:1578-1580` ("Apart from callback_url, ingest performs no synchronous input validation — it queues unconditionally …").
- Module header line `:21`: "trigger_backfill — triggers an OHLCV history backfill via gRPC TriggerBackfill (admin-scoped)".
- Scope forwarding, unchanged: `:1582` `access_scope = _caller_access_scope(ctx, "trigger_backfill")`.
- Error pass-through, unchanged: `_PASS_THROUGH_CODES` at `:225-236` contains `PERMISSION_DENIED` and `ALREADY_EXISTS`, so both new backend details reach the caller verbatim.
- Client docstring: `services/xstockstrat-agent/app/client.py:2074` "Trigger a historical backfill via gRPC TriggerBackfill (admin-scoped write)."
- Agent `CLAUDE.md:36-42`: lists `trigger_backfill` among the tools that hit a backend admin gate and says "ingest `TriggerBackfill` checks the ADMIN bit `0x04`".
- Runbook: `docs/runbooks/mcp-tools.md:964` (section heading), `:966-969` ("**Admin-scoped write** … a non-admin caller is rejected `PERMISSION_DENIED` ("admin scope required")"), the `fill_mode` parameter row at `:980`, the section's **Errors** table at `:1019-1027` (its last row says "**No synchronous error** — apart from `callback_url`, ingest queues unconditionally"), and the `cancel_backfill` contrast at `:1068-1069` ("unlike `trigger_backfill`, this RPC is checked server-side").
- Skill: `plugins/strat-lab/skills/backtest/reference/backfill.md:12-17` (step 2 "Trigger if needed"), `plugins/strat-lab/skills/backtest/SKILL.md:205-217` (Phase 1). Neither says the tool is admin-only (`grep -n -i 'admin\|scope' reference/backfill.md` → no match; the file has 67 lines).
- Same-PR rule: `docs/patterns/strat-lab-plugin.md:21-24` (a change to the `trigger_backfill` contract updates `skills/backtest/reference/backfill.md`).
- No tool is added or removed, so the six tool-count surfaces do not change (`tests/test_tools_endpoint.py` `test_every_tool_count_surface_states_the_catalog_size`).
- Ledger traps: `fails.md` 2026-08-02 mcp-tools-alignment-triage (every surface that describes a tool changes in one PR, pinned by a parity test) and 2026-08-06 trigger-backfill-mcp-tool.

**TDD**: `red-green required` (the tool docstring is served as the MCP tool description, so the wording is behaviour)

**Covers**: —

**Instructions**:
1. `tools.py:21` and `client.py:2074`: replace "admin-scoped" with wording that says admins may request anything and any other signed-in caller is limited to the self-serve envelope.
2. `tools.py` docstring (`:1557-1580`): state the envelope for a non-admin caller in parameter terms: exactly one symbol; `data_kind='bars'`; `fill_mode='gaps_only'`; `overwrite=False`; both `start` and `end` given with `start < end`; a range no longer than the operator limit (`backfill.self_serve_max_range_days` in namespace `ingest`, default 730 days); no `callback_url`. State the two synchronous refusals: `PERMISSION_DENIED: self-serve backfill denied: <token>` (list the eight tokens) and `ALREADY_EXISTS` when a backfill for that symbol is already queued or running (retry after it finishes; the other job's id is not returned). Replace the sentence at `:1578-1580` with a true one: these refusals and the `callback_url` check are synchronous and create no job; other bad input still surfaces as a terminal FAILED or PARTIAL job.
3. Do not change the tool's parameters, its 50-symbol client-side cap, the scope forwarding or the return shape.
4. Agent `CLAUDE.md:36-42`: take `trigger_backfill` out of the "non-admin is rejected" sentence. Say it still forwards the caller's real scope; ingest admits an admin, or a non-admin inside the envelope. `cancel_backfill`, `run_fundamentals_scan` and the global `set_config` write stay as written.
5. `mcp-tools.md` § `trigger_backfill`: rewrite `:966-969` to match; add a short "Non-admin callers (self-serve envelope)" list with the same seven parameter rules; add the two refusals as rows of the **Errors** table at `:1019-1027` and correct its "queues unconditionally" row; in the `fill_mode` row (`:980`) note that a non-admin must pass `"gaps_only"`. Fix the contrast at `:1068-1069` so it no longer implies `trigger_backfill` is unchecked.
6. `reference/backfill.md` step 2 and `SKILL.md` Phase 1: say a non-admin must trigger one symbol per call with `fill_mode="gaps_only"`, explicit `start` and `end`, and no `callback_url`; that `PERMISSION_DENIED: self-serve backfill denied: range_too_long (max N days)` means shorten the range or ask an operator; and that `ALREADY_EXISTS` means a backfill for the symbol is in flight, so poll `get_backfill_status` and retry later. Keep the existing `callback_url` section; add one line that it is admin-only.
7. No `plugin.json` version change (Assumption 11).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n 'admin-scoped' services/xstockstrat-agent/app/tools.py | grep -i 'trigger_backfill'   # no match
grep -n '_caller_access_scope(ctx, "trigger_backfill")' services/xstockstrat-agent/app/tools.py   # still forwards the real scope
cd services/xstockstrat-agent && pytest tests/test_tools_endpoint.py tests/test_tools.py -q
```

---

### Step 9 — test: Agent docs parity and refusal pass-through

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `.github/workflows/ci.yml` — modify (one path added to the `xstockstrat-agent` filter)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Parity-test precedent: `tests/test_tools_endpoint.py:100-111` `test_docs_and_skill_parity_with_backfill_callback_url` — splits the runbook on ``"### `trigger_backfill`"``, reads `plugins/strat-lab/skills/backtest/reference/backfill.md` and `SKILL.md`, asserts shared terms. `_REPO = Path(__file__).resolve().parents[3]` at `:13`; `_catalog()` gives the live tool catalog.
- Tool test class: `tests/test_tools.py:1638` `class TestTriggerBackfillTool`; `test_any_grpc_error_maps_through_grpc_error_message` at `:1659`; error construction precedent at `:2099-2104` (`grpc.aio.AioRpcError(grpc.StatusCode.PERMISSION_DENIED, None, None, details="admin scope required")`, `pytest.raises(ToolError, match=…)`).
- Shared denial contract: `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json` (Step 6). Agent tests already read other trees through `_REPO` (`tests/test_tools_endpoint.py:13`).
- CI filter: `.github/workflows/ci.yml:59` `xstockstrat-agent:` lists `'services/xstockstrat-ingest/app/handlers/servicer.py'` and `'docs/runbooks/mcp-tools.md'` but no path under `services/xstockstrat-ingest/tests/`, so a fixture-only edit skips the agent job. No script parses the per-service filter lines (`ciFilterGlobs` in `scripts/config-wiring.test.mjs:663-674` reads only block-list filters and is called for `config-wiring` alone), so the check is a grep.
- C-13 verdict: the tokens are read from the shared JSON (third consumer of the same file, no new copy). The error-detail strings in the pass-through test are scenario one-offs and stay inline.

**TDD**: `red-green required`

**Covers**: `AC-7`

**Instructions**:
1. `test_tools_endpoint.py`: add **new** `test_docs_and_skill_parity_with_self_serve_backfill`. Load the shared JSON through `_REPO`. Assert for each of: the runbook's `trigger_backfill` section, `reference/backfill.md`, and the live catalog description of `trigger_backfill`:
   - it contains `gaps_only` and the prefix `self-serve backfill denied`;
   - it does not contain "admin scope required".
   Assert the runbook section and the tool description each name all eight tokens from the JSON. Assert `SKILL.md` contains `gaps_only`.
2. `test_tools.py` → `TestTriggerBackfillTool`: add **new** `test_self_serve_refusals_pass_through`, parametrized over (`PERMISSION_DENIED`, `"self-serve backfill denied: range_too_long (max 730 days)"`) and (`ALREADY_EXISTS`, a detail naming the symbol): `client.trigger_backfill` raises the `AioRpcError`; the tool raises `ToolError` whose message carries the code name and the detail unchanged. Use a non-admin `_ctx`.
3. `.github/workflows/ci.yml:59`: add `'services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json'` to the `xstockstrat-agent` array, keeping the one-line array form of the neighbouring lines (Assumption 4). Re-grep the line first; a peer merge moves it.
4. RED before Step 8: the parity test fails on the runbook ("admin scope required" present, no token list).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && pytest tests/test_tools_endpoint.py tests/test_tools.py -q
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
grep -rn '"multi_symbol"' services/xstockstrat-agent/tests | wc -l     # 0 — tokens come from the shared JSON
grep -n "xstockstrat-agent:.*self_serve_denial.json" .github/workflows/ci.yml    # one line: a fixture-only edit runs the agent job
```

---

### Step 10 — service: UI helper `src/lib/backtestBackfill.ts`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/backtestBackfill.ts` — create

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `src/lib/backtestBackfill.ts` — **Not found** (`ls services/xstockstrat-ui/src/lib | grep -i backfill` → nothing). Created here.
- Request shape to reuse verbatim: `src/app/insights/strategies/[id]/page.tsx:541-547` — `{ symbols: [gap.symbol], timeframeEnum: gap.timeframe, range: gap.gap, overwrite: false }`.
- Request type: `Parameters<typeof insightsIngestClient.triggerBackfill>[0]` (`src/hooks/useBacktest.ts:15`).
- Gap fields: `CoverageGap` — `symbol=1`, `timeframe=2`, `requested_range=3`, `bars_have=4`, `bars_need=5`, `gap=6` (`packages/proto/analysis/v1/analysis.proto:109-117`). Analysis always sets `timeframe=TIMEFRAME_1DAY` and `requested_range=request.range` (`services/xstockstrat-analysis/app/handlers/servicer.py:1022-1028`, `:1129-1137`).
- Fill mode enum: `FillMode` in `packages/proto/ingest/v1/ingest.proto:63-67` (`FILL_MODE_GAPS_ONLY = 2`; UNSPECIFIED is treated as FULL). No UI file uses it yet (`grep -rn 'FillMode\.' services/xstockstrat-ui/src` → none).
- Job fields: `BackfillJob` — `bars_processed=6`, `bars_total=7`, `error=10`, `chunks_total=13`, `chunks_completed=14` (`packages/proto/ingest/v1/ingest.proto:33-50`); `BackfillStatus` import precedent `src/hooks/useBackfills.ts:4`.
- Server facts behind the copy: `bars_total` is written when the plan is made (`services/xstockstrat-ingest/app/handlers/servicer.py:715-716`), so a QUEUED job has none; PARTIAL is set for failed symbols or failed chunks (`:739-740`) and the terminal write carries no `error` (`:744-752`); the all-chunks-failed FAILED write carries no `error` either, while an exception path stores `error=str(e)` (`:584`).
- Error access: `ConnectError.rawMessage` (`src/lib/errMessage.ts:3-5`); `Code.AlreadyExists` / `Code.PermissionDenied` from `@connectrpc/connect` (`src/lib/connectClients.ts:135`, `:139`). The BFF `forward` rethrows the backend `ConnectError` unchanged (`src/lib/bffShared.ts:77-91` has no catch), so code and detail reach the browser.
- Date helper: `timestampToDate` in `src/lib/protoTime.ts` (imported at `insights/strategies/[id]/page.tsx:14`).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Create the module with pure functions only (no React, no client import beyond types and enums):

1. `SELF_SERVE_DENIAL_PREFIX` and `SELF_SERVE_DENIAL_TOKENS` — the prefix and the eight tokens as literals, in the ingest order. Step 11 pins them to the shared JSON.
2. `gapToBackfillRequest(gap, opts?: { fillMode?: FillMode; rangeEnd?: Timestamp })` → the insights request shape. `range` is `{ start: gap.gap?.start, end: opts.rangeEnd ?? gap.gap?.end }`. `fillMode` is set only when `opts.fillMode` is given. `overwrite` is always `false`.
3. `backfillSpanDays(range)` → whole days between `start` and `end`, rounded up; 0 when either is unset.
4. `gapKey(gap)` → a stable string of symbol, gap start seconds and gap end seconds, for the D-7 memory.
5. `backfillJobMessage(job, symbol)` → `{ state, text }`:

   | Status | `state` | `text` |
   |---|---|---|
   | QUEUED / RUNNING, `barsTotal > 0` | `running` | `Backfilling… {barsProcessed} / {barsTotal} bars` |
   | QUEUED / RUNNING, `barsTotal` 0 | `running` | `Backfilling…` |
   | COMPLETED | `ready` | `Data ready` |
   | FAILED, `error` set | `failed` | `Backfill failed: {error}` |
   | FAILED, no `error`, `chunksTotal > 0` | `failed` | `Backfill failed: {chunksTotal − chunksCompleted} of {chunksTotal} chunks failed` |
   | FAILED, neither | `failed` | `Backfill failed` |
   | PARTIAL, `chunksTotal − chunksCompleted > 0` | `partial` | `Backfill partial: {n} of {chunksTotal} chunks failed` |
   | PARTIAL, otherwise | `partial` | `Backfill partial: {symbol} returned no data for part of the range` |
   | CANCELED | `canceled` | `Backfill canceled` |

6. `triggerErrorMessage(err, { symbol, spanDays })` → string:
   - `Code.AlreadyExists` → `A backfill for {symbol} is already queued or running. Try again when it finishes.`
   - `Code.PermissionDenied` whose `rawMessage` starts with the prefix and whose token is `range_too_long` → `This backtest needs {spanDays} days of history, more than the self-serve limit of {max} days. Ask an admin to backfill {symbol}.` with `max` parsed from ` (max N days)`. If `max` cannot be parsed, fall through to the generic sentence.
   - any other `Code.PermissionDenied` (another token, an unknown token, no prefix) → `This backfill is not available here. Ask an admin to backfill {symbol}.` A raw token is never returned.
   - anything else → `Could not start backfill: {message}` (the phrase already used at `insights/strategies/[id]/page.tsx:559`).
7. `noVendorDataMessage(gap)` → `No vendor data for {start} to {end}` with both dates as `YYYY-MM-DD` (UTC).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run format:check && pnpm exec tsc --noEmit
# behaviour: Step 11
```

---

### Step 11 — test: vitest for the helper, pinned to the shared denial fixture

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/backtestBackfill.test.ts` — create
- `.github/workflows/ci.yml` — modify (one path added to the `xstockstrat-ui` filter)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Vitest config: `services/xstockstrat-ui/vitest.config.ts` — node environment, `include: ['src/**/*.test.ts']`, coverage `include: ['src/lib/**']` with 40% thresholds (`thresholds` at `:29-33`: lines, functions, statements). The coverage run is `pnpm run test:coverage` (`package.json:19`, `vitest run --coverage`); `test:unit` (`:17`) checks no threshold.
- Repo-root read from a UI test: `src/lib/dbTlsPlatformGuard.test.ts:9` (`const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))`) and `:85` (`readFileSync(ROOT + rel, 'utf8')`).
- Shared fixture: `services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json` (Step 6).
- CI filter: `.github/workflows/ci.yml:64` `xstockstrat-ui:         ['services/xstockstrat-ui/**', '.do/**']`. Cross-service path precedent in a filter: `:59` (`xstockstrat-agent` lists `services/xstockstrat-analysis/app/handlers/servicer.py`). UI vitest runs on a full checkout (`node-test` job, `:746`; `pnpm run test:coverage` at `:796`). The existing one-line array form is kept to match the neighbouring lines. No script parses the per-service filter lines (`ciFilterGlobs` in `scripts/config-wiring.test.mjs:663-674` reads only block-list filters and is called for `config-wiring` alone), so the filter check is a grep; the agent filter gains the same path in Step 9.
- Test-data inventory (C-12): gap inputs come from `e2e/fixtures/backtests.ts` (`insufficientDataResult`, `prefixGapRange`, `:39`, `:69`) and job inputs from `e2e/fixtures/backfillJobs.ts` (`backfillJob(over)`, `:18`); catalog rows at `e2e/fixtures/INVENTORY.md:34` and `:56`. `ConnectError` instances are scenario one-offs (error payloads) and stay inline. No new fixture module.
- vitest trap: never assert on `vi.spyOn` history recorded in `beforeAll` (`fails.md`, vitest 5.0.3). Not needed here: the helpers are pure.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-6, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-16`

**Instructions**:
1. Contract cases (drift guard, D-25): read the shared JSON through `ROOT`; assert `SELF_SERVE_DENIAL_PREFIX === contract.prefix` and `SELF_SERVE_DENIAL_TOKENS` deep-equals `contract.tokens`; build the over-cap detail from `contract.prefix + 'range_too_long' + contract.range_too_long_suffix` with 730 and assert `triggerErrorMessage` parses 730 from it.
2. `gapToBackfillRequest`:
   - `@AC-2`: with `{ fillMode: GAPS_ONLY, rangeEnd: gap.requestedRange.end }` on `insufficientDataResult(…, range)` the range is gap start → requested end, the gap end is **not** used, `overwrite` is false, `timeframeEnum` is the gap's, one symbol.
   - `@AC-10`: with `{ fillMode: GAPS_ONLY }` and no `rangeEnd` the range equals the gap exactly; with no options there is no `fillMode` key and the result deep-equals today's inline request.
3. `backfillJobMessage`, one case per table row in Step 10, built with `backfillJob(over)`: `@AC-3` ("Backfilling… 120 / 200 bars"), `@AC-14` ("Backfilling…"), COMPLETED, `@AC-6` (error text), `@AC-16` (0 of 3 completed, no error), both `@AC-9` PARTIAL branches (2 of 3; 3 of 3) and CANCELED, with the exact strings from `acceptance.feature`. Cover both bigint and string int64 inputs if the helper accepts both.
4. `triggerErrorMessage`: `@AC-11` exact copy; `@AC-12` exact copy with span 1825 and max 730; **every** other token from the JSON maps to the generic sentence and the returned text contains no token; an unknown token and a prefix-less `PermissionDenied` map to the generic sentence; a non-Connect `Error` maps to "Could not start backfill: …".
5. `noVendorDataMessage` (`@AC-13`): "No vendor data for 2023-03-17 to 2024-01-01". `gapKey`: equal for the same symbol and gap, different when either bound or the symbol differs. `backfillSpanDays`: 0 for an unset bound.
6. `.github/workflows/ci.yml:64`: add `'services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json'` to the `xstockstrat-ui` array (Assumption 4).
7. RED: with Step 10's functions exported as signatures only, the assertions fail.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run format:check && pnpm exec tsc --noEmit
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/backtestBackfill.test.ts
cd services/xstockstrat-ui && pnpm run test:coverage    # src/lib/** lines, functions and statements each >= 40% (vitest.config.ts thresholds); exit 0
grep -n "fixtures/backtests\|fixtures/backfillJobs" services/xstockstrat-ui/src/lib/backtestBackfill.test.ts    # C-12 imports
grep -n "self_serve_denial.json" .github/workflows/ci.yml services/xstockstrat-ui/src/lib/backtestBackfill.test.ts    # ci.yml: the xstockstrat-ui line (this step) and the xstockstrat-agent line (Step 9)
node --test scripts/config-wiring.test.mjs      # regression only: it reads ci.yml but not the per-service filter lines
```

---

### Step 12 — service: inline backfill on the symbol-page Backtests card

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Component: `BacktestsSection` at `page.tsx:1133`, mounted at `:453`.
- Run state: `const { mutate: runBacktest, isPending, data: runResult, error } = useRunBacktest();` at `:1144`. `handleRun` at `:1178-1197` sends `strategyId` + `strategyIdRef` (`:1186-1187`) and range 2024-01-01..2024-12-31 (`:1190`), and invalidates `['analysis-backtests', strategyId]`.
- Callout: `:1224-1240`, `data-testid="backtest-insufficient"` at `:1229`, sentence ". Ingest it from the Backfill coverage panel, then re-run." at `:1237`. It reads only `coverageGaps[0].barsHave` / `barsNeed`.
- OK line: `:1241-1246` (`data-testid="backtest-ok"`).
- Imports already present: `useBackfillJobs, useTriggerBackfill` from `@/hooks/useBackfills` (`:31`), `ConnectError` (`:52`), `Button`, `Badge`, `BacktestStatus`. `useBackfillStatus` is exported by the same hook module (`src/hooks/useBackfills.ts:30`) and is not yet imported here.
- `useTriggerBackfill` — `src/hooks/useBacktest.ts:19-23`; unchanged (Assumption 10).
- Polling: `useBackfillStatus(jobId)` polls every 4 s and stops on a terminal status (`useBackfills.ts:30-40`, `isTerminal` `:13-20`).
- The admin-only `BackfillSection` (`:1376-1432`) is a different card and is not touched (product spec, Out of Scope).
- Cross-segment client use is already sanctioned for this page (`services/xstockstrat-ui/CLAUDE.md:72`, UI-2).
- C-17: only existing primitives (`Button`, `Badge`) and token classes already used in this card (`text-muted-foreground`, `text-destructive`).

**Lands with**: `Step 13`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Imports: add `useBackfillStatus` to the `:31` import; import `gapToBackfillRequest`, `backfillJobMessage`, `triggerErrorMessage`, `backfillSpanDays`, `gapKey`, `noVendorDataMessage` from `@/lib/backtestBackfill`; import `FillMode` from `@xstockstrat/proto/ingest/v1/ingest_pb`.
2. In `BacktestsSection`, add local state only (no storage, no URL): the tracked `jobId` (string or undefined) and the `gapKey` of the gap whose backfill reached COMPLETED. Call `useTriggerBackfill()` and `useBackfillStatus(jobId)`. Never read `useBackfillJobs` here: jobs have no owner, so the card follows only the id its own trigger returned.
3. Callout (`:1224-1240`), when `runResult.status === INSUFFICIENT_DATA`:
   - keep the badge and the "has N, needs M bars" text; delete the sentence ". Ingest it from the Backfill coverage panel, then re-run." and end the sentence with a full stop.
   - with `gap = runResult.coverageGaps[0]`: render a "Backfill missing data" `Button` (`data-testid="backtest-backfill-action"`). On click call the trigger with `gapToBackfillRequest(gap, { fillMode: FillMode.GAPS_ONLY, rangeEnd: gap.requestedRange?.end })` and store the returned `jobId` on success. Same request for admins and non-admins.
   - no `coverageGaps[0]` → no action (nothing to request).
   - disable the button while the trigger is pending or the tracked job's `state` is `running`.
4. Status line (`data-testid="backtest-backfill-status"`), from `backfillJobMessage(job, symbol)` when a job is tracked:
   - `running` → the text; button disabled.
   - `ready` → "Data ready" plus a "Re-run backtest" `Button` (`data-testid="backtest-rerun"`) that records `gapKey(gap)` as filled, clears the tracked `jobId` and calls the existing `handleRun`. Nothing calls `handleRun` on its own (R-3).
   - `failed`, `partial`, `canceled` → the text; the "Backfill missing data" button is enabled again.
5. Trigger error (`data-testid="backtest-backfill-error"`): `triggerErrorMessage(error, { symbol, spanDays: backfillSpanDays(request.range) })`. The button stays enabled.
6. No vendor data (D-7): when the current insufficient result's `gapKey(gap)` equals the recorded filled key, render `noVendorDataMessage(gap)` (`data-testid="backtest-no-vendor-data"`) and hide the "Backfill missing data" button for that gap. A different gap shows the button again.
7. Do not change `handleRun`, the Run button, the history table, the no-strategy branch or `BackfillSection`.
8. Local state is lost on reload or remount; that is accepted (D-2). Do not add persistence.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run format:check && pnpm exec tsc --noEmit && pnpm run test:unit
grep -n 'Backfill coverage panel' 'services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx'   # no match
grep -n 'handleRun' 'services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx'                  # called from the Run button and the Re-run button only
# behaviour: Step 13
```

---

### Step 13 — test: e2e for the Backtests card, mock and fixtures

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing test: `e2e/trader/position-detail.spec.ts:325-338` — goes to `/trader/positions/ZZZZ?strategy=strat-insufficient-001`, clicks `run-backtest`, asserts `/Insufficient data/` and `/Backfill coverage panel/` (`:337`). It is the only consumer of the sentinel (`grep -rn strat-insufficient-001 e2e src`).
- Mock sentinel: `e2e/mock-backend.ts:1073-1097` returns `barsHave: BigInt(0)`, `barsNeed: BigInt(200)`, no `timeframe`, no `requestedRange`, and a `gap` of 2024-01-01..2024-12-31 — identical to the window `handleRun` requests, so a test cannot tell `gap` from the window (`insights.md`, 071-backtest-time-window).
- Mock ingest handlers: `triggerBackfill` at `:1581-1583` (always `{ jobId: 'job-e2e-1', status: 1 }`), `listBackfillJobs` at `:1587`. `getBackfillStatus` — **Not found** in `e2e/` (`grep -rn getBackfillStatus services/xstockstrat-ui/e2e` → none). Created here.
- Fixtures (C-12): `prefixGapRange` (`e2e/fixtures/backtests.ts:39`), `insufficientDataResult` (`:69`), `backfillJob(over)` (`e2e/fixtures/backfillJobs.ts:18`; numeric enums are valid both as a Connect-server response and as a `page.route` Connect-JSON body). `mock-backend.ts` already imports `insufficientDataResult` (`:53`), `backfillJob` (`:98`) and `BackfillStatus` (`:102`). The int64 pattern for a server response is at `:1595-1600` (spread the fixture, override the two int64 fields with `BigInt`).
- Catalog rows: `e2e/fixtures/INVENTORY.md:34` ("Backtest coverage gaps") and `:56` ("Backfill jobs").
- Browser-side interception precedent: `e2e/insights/backfills.spec.ts:14` (`const IngestPath = (m: string) => `**/xstockstrat.ingest.v1.IngestService/${m}``), `:17-19` (`fulfillJson`), `:98-101` (a `TriggerBackfill` route).
- Auth helpers: `addAuthCookie` (`e2e/helpers/auth.ts:83`, no admin role), `addAdminCookie` (`:88`). Never re-implement JWT signing.
- Timings: Playwright `expect.timeout` is 15 s in CI and 5 s locally (`playwright.config.ts:89`); the status poll is 4 s.
- Ledger traps: mock sentinels return the status the real server returns (`fails.md`, 215); a full local Playwright run against `pnpm dev` is unreliable, verify statically plus one diagnosed run (`fails.md`, 2026-08-06 backfill-management-ui).

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-11, AC-13`

**Instructions**:
1. `mock-backend.ts`, sentinel `strat-insufficient-001` (`:1073-1097`): set `barsHave: BigInt(53)`, add `timeframe: 4`, `requestedRange: req.range`, and `gap: prefixGapRange(req.range)` so the gap is a pre-window span distinct from the window. Import `prefixGapRange` beside `insufficientDataResult` (`:53`). Keep the two-line comment accurate.
2. `mock-backend.ts`, `IngestService`: add a **new** `getBackfillStatus(req)` handler after `triggerBackfill` returning a COMPLETED job for the requested id, built from `backfillJob({ jobId: req.jobId, status: BackfillStatus.COMPLETED, … })` with the `BigInt` overrides used at `:1595-1600`. COMPLETED is the status the real server reaches for a successful job. Two-line comment at most.
3. `position-detail.spec.ts`: update the test at `:325-338` — keep `/Insufficient data/`, replace the `:337` assertion with `has 53, needs 200 bars` and a visible, enabled `backtest-backfill-action` (`@AC-1`).
4. Add a **new** `test.describe('inline backfill from the Backtests card')` block. All tests use `addAuthCookie` (no admin role) and the sentinel strategy. Non-default job states are served with `page.route(IngestPath('GetBackfillStatus'), …)` and `backfillJob(over)` bodies; error replies are inline Connect error JSON (scenario one-offs, exempt from C-12). Copy `IngestPath` and `fulfillJson` only if they are not exported; if a second spec would then hold a copy, move them to a helper under `e2e/helpers/` in this step (C-12, second consumer).
   - `@AC-2`: capture the `RunBacktest` and `TriggerBackfill` requests; the backfill `range.start` is earlier than the backtest `range.start`, `range.end` equals the backtest `range.end`, `fillMode` is GAPS_ONLY, `overwrite` is falsy, one symbol.
   - `@AC-7`: a non-admin triggers; no error element; the status line appears.
   - `@AC-3`: route returns RUNNING with 120 / 200 → "Backfilling… 120 / 200 bars"; the action is disabled.
   - `@AC-4`: default mock (COMPLETED) → "Data ready" and `backtest-rerun` visible; the count of `RunBacktest` requests is still 1.
   - `@AC-5`: route the second `RunBacktest` to an OK body; click `backtest-rerun`; `backtest-ok` is visible and `backtest-insufficient` is gone; the second request carries `strategyId` and `strategyIdRef` (`270@AC-4`).
   - `@AC-13`: the second `RunBacktest` falls through to the sentinel (same gap) → "No vendor data for …" and no `backtest-backfill-action`.
   - `@AC-6`: route returns FAILED with `error: 'vendor rate limit exceeded'` → "Backfill failed: vendor rate limit exceeded"; the action is enabled.
   - `@AC-11`: route `TriggerBackfill` to a Connect `already_exists` error (HTTP 409) → the D-27 sentence for the symbol; the action is enabled.
5. `INVENTORY.md`: add `e2e/trader/position-detail.spec.ts` and the `strat-insufficient-001` branch of `mock-backend.ts` to the consumers of the "Backtest coverage gaps" row (`:34`), and `getBackfillStatus` plus the spec to the "Backfill jobs" row (`:56`).
6. RED before Step 12: the new block fails on the missing `backtest-backfill-action`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "from '../fixtures'\|from './fixtures'\|fixtures/backfillJobs\|fixtures/backtests\|helpers/auth" services/xstockstrat-ui/e2e/trader/position-detail.spec.ts services/xstockstrat-ui/e2e/mock-backend.ts
grep -n 'getBackfillStatus\|position-detail' services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
grep -n 'Backfill coverage panel' services/xstockstrat-ui/e2e/trader/position-detail.spec.ts     # no match
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/position-detail.spec.ts -g "Backtests card|INSUFFICIENT_DATA"
# One diagnosed local run of this file is the bar; the full suite runs in CI on the prebuilt server.
```

---

### Step 14 — service: insights strategy button uses the shared helper

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Button: `page.tsx:537-551`, `data-testid="backfill-action"`; the inline request at `:541-547` (`symbols: [gap.symbol]`, `timeframeEnum: gap.timeframe`, `range: gap.gap`, `overwrite: false`). It has no `isAdmin` wrapper, so a non-admin already sees a button that ingest rejects today (recon).
- Admin signal already in scope: `const { data: isAdmin } = useIsAdmin();` at `:57` (import at `:19`; hook at `src/hooks/useLiveStrategies.ts:61`).
- Mutation: `useTriggerBackfill()` at `:67-72` (`mutate: triggerBackfillMutate`, `error: backfillErrorObj`); confirmation at `:552-556` (`backfill-confirmation`), error line at `:557-560` ("Could not start backfill: …").
- The create form on `src/app/insights/backfills/page.tsx` is **not** touched (operator decision, R-9).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Import `gapToBackfillRequest` from `@/lib/backtestBackfill` and `FillMode` from `@xstockstrat/proto/ingest/v1/ingest_pb`.
2. Replace the inline object at `:541-547` with `gapToBackfillRequest(gap, isAdmin ? undefined : { fillMode: FillMode.GAPS_ONLY })`. The range stays the exact gap for everyone. An admin's request is unchanged (no `fillMode`, Assumption 9, R-5).
3. Leave the button label, test ids, confirmation and error line as they are. Do not add an `isAdmin` wrapper.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run format:check && pnpm exec tsc --noEmit && pnpm run test:unit
grep -n 'gapToBackfillRequest' 'services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx'   # one call
git diff --stat -- services/xstockstrat-ui/src/app/insights/backfills/page.tsx                         # empty
```

---

### Step 15 — test: e2e for the insights strategy button by role

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a consumer list changes)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing tests: `e2e/insights/backtest-coverage.spec.ts:29-47` (gap panel + `backfill-action` + `backfill-confirmation` containing `job-e2e-1`) and `:53-79` (captures the `TriggerBackfill` request with `page.waitForRequest`, asserts `range.end` equals the requested start and `range.start` is earlier). Both use `addAuthCookie`, a non-admin, and neither asserts `fillMode`, so they stay green.
- Mock: `runBacktest` default branch returns `insufficientDataResult(req.strategyId, req.symbols, req.range)` (`e2e/mock-backend.ts:1238`), already listed as a consumer at `INVENTORY.md:34`.
- Auth helpers: `addAuthCookie` / `addAdminCookie` (`e2e/helpers/auth.ts:83`, `:88`).
- C-12: no new domain object; the tests reuse the existing mock result. The role is the only variable.

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. Add two **new** tests beside `:53-79`, sharing the capture code of that test (extract a local helper in the spec rather than copying the block twice):
   - non-admin (`addAuthCookie`): the captured `TriggerBackfill` body has `fillMode` GAPS_ONLY (`"FILL_MODE_GAPS_ONLY"` in Connect-JSON), `range.end` equal to the requested start and `range.start` earlier; the confirmation shows the job id.
   - admin (`addAdminCookie`): the captured body has no `fillMode` key (or the UNSPECIFIED value) and the same exact-gap range (`198@AC-7` admin behaviour unchanged).
2. Do not change the two existing tests.
3. RED before Step 14: the non-admin test fails (no `fillMode` in the body).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "helpers/auth\|from '../fixtures'" services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/backtest-coverage.spec.ts
```

---

### Step 16 — docs: homelab rollout subsection in the config-rollout runbook

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/config-rollout.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Homelab anchor: `docs/runbooks/config-rollout.md:288-299` ("### Per-platform failure and recovery"; the homelab compose row at `:293`; the fresh-deploy assertion at `:296-297`). MCP write path: "### Via the MCP agent (feature 073)" at `:115`.
- Lock background: `docs/runbooks/ohlcv-lock-budget-tuning.md` ("## The countable lock-budget invariant (AC-1)" at `:41`).
- DSN route: `docs/runbooks/operator-db-access.md` (out-of-band admin SQL; no SQL over MCP).
- Pool metrics exist: `marketdata.db.pool.empty_acquire_count` and `marketdata.db.pool.empty_acquire_wait` (`services/xstockstrat-marketdata/internal/telemetry/otel.go:478-479`). This closes the design's open risk on the metric names.
- Feature 341's counter name: `marketdata.ohlcv.out_of_memory_errors` (341 `implementation-spec.md` Step 5 on `origin/feature/fix-indicator-pane-warmup`; not on this tree).
- Values and bound: `design.md` § Homelab rollout and `debate.md` D-22…D-26 (operator values 1024 / 70 / 0; marketdata pool of 2 connections; two databases).
- Config keys to read: ingest `backfill.max_concurrent_jobs`, `backfill.max_concurrent_chunks`, `backfill.chunk_window_days`; analysis `readiness_materializer.max_concurrent_bars_fetches`, `opportunity.max_concurrent_bars_fetches`, `opportunity.max_concurrent_candidates`, `backtest.portfolio_max_concurrent`, `strategy.max_concurrent_entry_backfill`, `backtest.max_range_days` (`context.md`, round 4 read over the homelab MCP).
- The checker scans this file for banned phrases only (`scripts/check-config-wiring.mjs:864`, `docWide`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
Add a subsection "### Homelab: self-serve backfill capacity (feature 343)" after the paragraph at `:296-299`. Staging environment only (the homelab has no production instance). Nothing in the homelab-edge repo is edited and no Postgres parameter is changed (R-12). Content, as numbered steps:

1. **Read the config inputs** over the homelab staging MCP with `get_config`: the three ingest keys and the six analysis keys listed above. Record the values.
2. **Read the Postgres parameters, read-only**, on the homelab database host: `SHOW max_locks_per_transaction;`, `SHOW max_connections;`, `SHOW max_prepared_transactions;`. Route: `psql` over ssh on the database host (the operator's stated plan); if ssh is not available, the DB-owner DSN per `docs/runbooks/operator-db-access.md`. Expected after homelab-edge PR #79 is applied: 1024, 70, 0. In the same pass confirm marketdata runs one replica with `DB_POOL_MAX` unset, and that the database is the fresh deploy the runbook already asserts (no pre-`004` one-day ohlcv chunks).
3. **Compute the lock inequality** from the values read. This is the only stop:
   `marketdata connections (2) × replicas × L_stmt_max × databases (2) ≤ max_locks_per_transaction × (max_connections + max_prepared_transactions)`, with `L = (⌈span_days ÷ 30⌉ + 1) × 4` and `span_days` the longest of: the analysis bar fetch (2,555 days, L = 348), the new self-serve cap (1,830 days, L = 248), and the longest admin gaps-only range the operator accepts. Give the two worked rows from `design.md` (L = 348 → 1,392; L = 1,000 → 4,000) against 71,680. If the inequality fails, stop and change nothing. Values that differ from 1024 / 70 / 0 are recorded as "PR #79 not applied" and do not stop the rollout while the inequality holds.
4. **Write and read back** over the homelab staging MCP: `set_config` namespace `ingest`, `backfill.max_concurrent_jobs` = 8 and `backfill.self_serve_max_range_days` = 1830; then `get_config` both. DigitalOcean is not changed: its values stay 3 and 730.
5. **Observe for one readiness cycle**: feature 341's `marketdata.ohlcv.out_of_memory_errors` stays at 0, and `marketdata.db.pool.empty_acquire_count` / `marketdata.db.pool.empty_acquire_wait` do not climb while eight jobs run. If either moves, set `backfill.max_concurrent_jobs` back to 3.

Then a short checklist:
- Re-run step 4 after a homelab database rebuild (the seed restores 3 and 730).
- Apply the same two values per environment when a homelab production app is first deployed.
- Reverted symptom: a 1000-bar backtest's inline backfill is refused with "more than the self-serve limit of 730 days", and at most 3 backfill jobs run at once.

Use macOS-compatible commands only; no hostnames, DSNs or secrets in the text.

**Verification**:
```bash
grep -n 'Homelab: self-serve backfill capacity' docs/runbooks/config-rollout.md
grep -n 'self_serve_max_range_days\|max_locks_per_transaction\|out_of_memory_errors\|empty_acquire' docs/runbooks/config-rollout.md
node scripts/check-config-wiring.mjs --final     # the banned-phrase scan of this file still passes
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **Steps 2+3+4 (2026-11-15) — Step 4 Verification run per line.** The fence chains `cd services/xstockstrat-ingest && …` on three lines of one block, and its last line is marked "from the repo root". Run verbatim as one subshell, the second `cd` fails (already inside the service), so the two `pytest` lines never ran and `node scripts/…` resolved under the service directory (log `v-4`, exit 1). Each command line was then run unchanged from the repo root (logs `v-5`, `v-6`, `v-7`, all exit 0). The ingest `pytest`/`ruff` ran from the service's own `uv sync --extra dev` venv on `PATH`. **Disposition**: execution form only, no command changed. Step 2's `scripts/config-wiring-stored.json` was regenerated against the operator-provided scratch Postgres at `127.0.0.1:5432` (operator decision, Option B), not a database this run started. Migration number `050` re-derived: `049` is the tip on both the branch and `origin/main-dev`.
- **Steps 5+6 (2026-11-15) — Step 5 Instruction 7, insert shape.** Ran `pytest tests/test_ingest_servicer.py -q` against both shapes, with the Step 6 tests in place. Shape A (two insert branches inlined in `TriggerBackfill`): `156 passed` (log `v-2`, exit 0). Shape B (private helper `_insert_self_serve_job(symbol, job_fields) -> bool` holding the lock, `has_active_job` and `insert_job(conn, …)` transaction; the admin branch keeps `insert_job(self._db, …)`): `156 passed` (log `v-3`, exit 0). Neither shape needed an edit to an admin-path test. **Kept: shape B**, because it keeps the transaction's result out of `TriggerBackfill`'s locals and the `ALREADY_EXISTS` abort after the block exits. Both shapes pass `insert_job` the same keyword arguments, built once as `job_fields`. **Disposition**: recorded per the instruction; no spec change.
- **Steps 5+6 (2026-11-15) — Step 6 Verification run per line.** Same execution-form defect as Step 4: the fence chains `cd services/xstockstrat-ingest && …` on three lines of one block. Run verbatim (log `v-5`, exit 0), the second and third `cd` fail (`cd: services/xstockstrat-ingest: No such file or directory`), so neither `pytest` line ran. That `exit=0` was not taken as verification. The two `pytest` lines were then run unchanged from the repo root (logs `v-6` and `v-7`, exit 0). The fence's ruff and grep lines ran in `v-5` from the service directory as intended. **Disposition**: execution form only, no command changed.
- **Steps 5+6 (2026-11-15) — token literal in the gate.** As Instruction 3 states, the gate compares `token == "range_too_long"`, so that one token string appears twice in `servicer.py` (the tuple and the comparison). The Verification only pins `"multi_symbol"` to one line, so this is no deviation from it. Noted because of Instruction 2's "do not repeat the eight strings". **Disposition**: followed Instruction 3 as written.
- **Step 7 (2026-11-15) — `platform.feature` row alignment.** The specified site text "the self-serve backfill range cap in days" is 41 characters; the table's site column is 37 wide. Re-padding the whole Examples table would touch every row, which Instruction 5 forbids ("Change nothing else in the scenario"). The new row's site cell overflows by 4 characters and its `effective` cell is padded 4 shorter, so the row keeps the table's line length (169) and closing `|`. Gherkin ignores cell padding. **Disposition**: text as specified; partial alignment.
- **Step 7 (2026-11-15) — forward reference in the registered-keys entry.** Instruction 4's sentence points at `docs/runbooks/config-rollout.md` for the homelab `SetConfig` of `backfill.max_concurrent_jobs` = 8; that runbook has no such subsection yet. Step 16 of this feature writes it. The default and seed 3 were confirmed (`watcher.py:113`, config migration `041` row at `:132`). **Disposition**: written as specified; Step 16 closes the reference.
- **Step 8 (2026-11-15) — RED captured with an uncommitted scratch test.** Step 8's paired test is Step 9 (not a unit), and Step 9 Instruction 4 asks for RED before Step 8's edit. Step 9's files are outside Step 8's **Files** (F-08), so RED and GREEN ran a scratch copy of Step 9 Instruction 1's parity test (`.sdd-logs/test_step8_red.py`, worktree-only, not committed): RED `v-1` exit=1 (`AssertionError: mcp-tools.md § trigger_backfill` — `'self-serve backfill denied'` absent), GREEN `v-2` `1 passed`. Step 9 still writes the committed test. **Disposition**: TDD evidence only; no spec change.
- **Step 8 (2026-11-15) — Verification run per line.** Same execution-form defect as Steps 4 and 6: the fence's first line `cd`s into the service, so run verbatim as one subshell (`v-3`, exit=1) the two `grep` lines and the last `cd` fail on the service-relative path. `v-3` did run the ruff line (`All checks passed!`, `75 files already formatted`). The remaining three lines were run unchanged from the repo root (`v-4` grep no match, exit=1 as expected; `v-5` `1593:` match, exit=0; `v-6` `145 passed`, exit=0), with the agent's `uv sync --extra dev` venv on `PATH` (ruff 0.16.9 from the host). **Disposition**: execution form only, no command changed.

- **Step 9 (2026-11-15) — RED captured against the pre-Step-8 tree.** Step 8 had already landed, so Instruction 4's RED ("before Step 8's edit") was taken by checking out the four Step 8 files the parity test reads (`app/tools.py`, `mcp-tools.md`, `SKILL.md`, `reference/backfill.md`) from `d494abc61^` into the worktree, running the tests (`v-2`: `1 failed, 147 passed`, `AssertionError: mcp-tools.md § trigger_backfill`, `'self-serve backfill denied'` absent), then restoring them from `HEAD` before any commit (`git status` showed only the two test files). The two `test_self_serve_refusals_pass_through` cases passed in that RED run: the agent already passed `PERMISSION_DENIED` and `ALREADY_EXISTS` through (`_PASS_THROUGH_CODES`), so they are characterization tests (red N/A for that test). The CI-filter grep matched nothing before the edit (`v-3`). **Disposition**: TDD evidence only; no spec change.
- **Step 9 (2026-11-15) — Verification run per line.** Same execution-form defect as Steps 4, 6 and 8: run verbatim as one subshell (`v-4`, exit=2), only the ruff line ran (`All checks passed!`, `75 files already formatted`); the later `cd` and the repo-relative `grep`s fail. The remaining lines were run unchanged from the repo root (`v-5` `148 passed`, `v-6` `765 passed`, `Total coverage: 88.11%`, `v-7` `0` and the `:59` filter line), all exit=0, with the agent's `uv sync --extra dev` venv on `PATH`. **Disposition**: execution form only, no command changed.- **Step 2 (2026-11-16) — migration renumbered 050 → 051 after 341 merged.** Feature 341's `050_ui_chart_history_bars` reached `main-dev` first, so when `main-dev` was merged into this branch the seed was moved with `git mv` to `051_ingest_backfill_self_serve_keys.{up,down}.sql` (content unchanged apart from the header line). Every reference to the file name was updated, in the done steps and in the pending ones, and `scripts/config-wiring-stored.json` was regenerated with `scripts/config-wiring-stored.py`, not hand-merged. The migration had not been applied to any deployed database.
- **Steps 10+11 (2026-11-16) — Verification run per line.** Same execution-form defect as Steps 4, 6, 8 and 9: Step 11's fence chains `cd services/xstockstrat-ui && …` on three lines of one block. Run verbatim as one subshell (`v-2`, exit=1), only the first line ran (lint, `All matched files use Prettier code style!`, tsc silent); the second and third `cd` fail and the repo-relative `grep`s and `node --test` resolve under the service. Each line was then run unchanged from the repo root (`v-3` … `v-8`, all exit=0). Step 10's Verification is the same command as Step 11's first line (`v-3`). Fence lines ending in a `#` comment got the closing `)` on its own line in the run script. **Disposition**: execution form only, no command changed.
- **Steps 10+11 (2026-11-16) — choices the instructions left open.** `backfillJobMessage` sends any status outside COMPLETED/FAILED/PARTIAL/CANCELED (QUEUED, RUNNING and UNSPECIFIED) to the running rows. `noVendorDataMessage` prints `?` for an unset gap bound. `triggerErrorMessage` reads the token as the text after the prefix up to the first space. **Disposition**: within the step's instructions; noted for review.
- **Steps 12+13 (2026-11-16) — Verification run per line.** Same execution-form defect as Steps 4, 6, 8, 9 and 10+11: both fences open with `cd services/xstockstrat-ui && …` and then use repo-relative paths. Run verbatim as one subshell, Step 12's fence (`v-4`, exit=2) ran lint, `All matched files use Prettier code style!`, tsc and `Tests  593 passed | 2 skipped (595)`, and its two `grep`s failed on the path; Step 13's fence (`v-7`, exit=1) ran lint and tsc, then its `grep`s and the last `cd` failed. Each remaining line was run unchanged from the repo root: `v-5` (no `Backfill coverage panel` in `page.tsx`, exit=1 as expected), `v-6` (`handleRun` at `:1215` definition, `:1257` Re-run handler, `:1277` Run button), `v-8`, `v-9`, `v-10` (no match, exit=1 as expected), `v-11`. **Disposition**: execution form only, no command changed.
- **Steps 12+13 (2026-11-16) — Playwright line: diagnosed local run.** Run unchanged (`v-11`), the local `pnpm dev` harness failed the `warmup.setup.ts` project on its 10 s local test timeout, so no test ran. The diagnosed run (`v-13`, exit=0) added only `--reporter=list --timeout=90000 --retries=1` (CI runs `retries: 1`): `8 passed`, `2 flaky`. The two flaky tests were the first two to start, and both stopped at `backtest-insufficient` with the Run button still `Running…` (the first `RunBacktest` through the dev BFF route compiling); both passed on retry, and the same step passes in the other eight. The Docker runner was not used: the repo has no `.dockerignore`, so `Dockerfile.e2e`'s `COPY services/xstockstrat-ui/` would copy this worktree's linked `node_modules` over the image's install. **Disposition**: CI-equivalent fallback (the fence's own "one diagnosed local run" bar).
- **Steps 12+13 (2026-11-16) — choices the instructions left open.** (1) Step 13 Instruction 4: `IngestPath` was not copied. The new block uses full route globs, as this spec file already does for its other services, and the file's own `fulfillJson` (local to `routeIndicatorHistory`) was moved to module scope and reused. So no second spec holds a copy, and no helper move was due; that move would have edited `e2e/insights/backfills.spec.ts`, outside the step's Files. (2) The action is also disabled while a tracked job has no status yet (between the trigger's success and the first poll). (3) The trigger-error span is `backfillSpanDays` of gap start through `requestedRange.end`, the same range the request sends; the mutation's `variables` are typed `MessageInit` and do not fit `RangeLike`. (4) The mock's COMPLETED job carries `barsProcessed`/`barsTotal` 200/200. (5) `e2e/fixtures/INVENTORY.md` was already not Prettier-clean before this step and was not reformatted. **Disposition**: within the steps' instructions; noted for review.
- **Step 14 (2026-11-16) — RED captured with an uncommitted scratch e2e.** Step 14's paired test is Step 15 (not a unit), whose files are outside Step 14's **Files** (F-08). RED and GREEN ran a worktree-only scratch spec (`.sdd-logs/step14-scratch.spec.ts`, run through `.sdd-logs/pw-step14.config.ts`, which reuses `playwright.config.ts` with the chromium project and no warmup dependency): a non-admin `TriggerBackfill` body carries `fillMode: FILL_MODE_GAPS_ONLY`, an admin body has no `fillMode`. RED `v-2` exit=1 (`Expected: "FILL_MODE_GAPS_ONLY"`, `Received: undefined`; the admin case passed, characterization), GREEN `v-3` `2 passed`, exit=0. Step 15 still writes the committed e2e. **Disposition**: TDD evidence only; no spec change.
- **Step 14 (2026-11-16) — Verification run per line.** Same execution-form defect as Steps 4, 6, 8, 9, 10+11 and 12+13: run verbatim as one subshell (`v-4`, exit=0), the first line ran (lint warnings only in untouched files, `All matched files use Prettier code style!`, tsc silent, `Tests  593 passed | 2 skipped (595)`), but the `grep` failed on the service-relative path and the `git diff --stat` pathspec resolved under the service, so that `exit=0` was not taken as verification of lines 2-3. Both were run unchanged from the repo root: `v-5` `26:` (import) and `545:` (the one call), `v-6` empty output, both exit=0. **Disposition**: execution form only, no command changed.
- **Step 15 (2026-11-16) — RED captured against the pre-Step-14 page.** Step 14 had landed, so Instruction 3's RED ("before Step 14") was taken by checking out `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` from `34ebb5635^` into the worktree, running the spec (`v-1`, `--reporter=list --timeout=90000`, exit=1: the new non-admin test failed `Expected: "FILL_MODE_GAPS_ONLY"`, `Received: undefined`; the new admin test passed, characterization), then restoring the page from `HEAD` before any commit. The two existing gap tests also failed in `v-1` on the 10 s `insufficient-data` wait (cold dev compile; they were the first to start). **Disposition**: TDD evidence only; no spec change.
- **Step 15 (2026-11-16) — Verification run per line; Playwright line diagnosed.** Same execution-form defect as Steps 4-14: run verbatim as one subshell (`v-2`, exit=1), line 1 ran (lint warnings only in untouched files, tsc silent) and the repo-relative `grep` and second `cd` failed. Run unchanged from the repo root: `v-3` grep exit=0 (`:2` auth helpers, `:3` fixtures); `v-4` Playwright exit=1, only the `warmup.setup.ts` project failed on its 10 s local timeout and 14 tests did not run. The diagnosed run (`v-5`, exit=0) added only `--reporter=list --timeout=90000 --retries=1`, as in Steps 12+13: `13 passed`, `2 flaky` (the two unchanged existing gap tests, first to start, passed on retry); both new tests passed on the first attempt. **Disposition**: CI-equivalent fallback (as Steps 12+13).
- **Step 15 (2026-11-16) — shared helper and the existing tests.** Instruction 1 asks to share the `:53-79` capture code through a local helper; Instruction 2 forbids changing the existing tests. The new `captureStrategyBackfill(page)` is used by the two new tests only, so the existing test keeps its own copy of the capture block. `e2e/fixtures/INVENTORY.md` was not changed: row `:34` already lists this spec and the auth-helper row lists "all specs". **Disposition**: within the step's instructions; noted for review.
