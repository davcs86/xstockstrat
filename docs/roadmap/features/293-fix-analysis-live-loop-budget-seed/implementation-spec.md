# Implementation Spec: fix-analysis-live-loop-budget-seed

**Status**: `pending`
**Created**: 2026-11-05
**Feature**: `docs/roadmap/features/293-fix-analysis-live-loop-budget-seed/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-analysis-live-loop-budget-seed`

---

## Execution Summary

Two independent units, per `design.md`. **PR-1 (Steps 1-2)** is the analysis-only overflow-WARN latch: no migration dependency, ships on its own. **PR-2 (Steps 3-7)** seeds both live-loop keys (`analysis.engine.max_strategies_per_cycle`, `analysis.engine.eval_interval_seconds`) in one config migration, registers their `SetConfig` bounds, removes both `read-unseeded` baseline entries atomically with the seed (Step 3), proves the migration on real Postgres through the existing `migration-rerun` harness (Step 6), and updates docs (Step 7). Each `service` step is followed by its paired `test` step (C-08); the latch test (Step 2) and the bounds test (Step 5) are written to fail against the pre-implementation tree (P-06).

**Consumer surface (C-14): internal/platform-only.** `/config-ui`, `list_config_keys` and `set_config` pick up the two registry rows generically (verified in `product-spec.md` § Consumer Surface(s)); no UI or agent step is required. The overflow-WARN change is observable only in Loki/Grafana.

**Migration number placeholder.** Every `NNN` below is a placeholder. Spec-time value is `038` (above 291's `035` and 281's `037`, the latter verified on `origin/feature/signal-watchlist-expiry-pruning`; `origin/main-dev` now ends at `037_portfolio_signal_prune_interval` (feature 281 landed 2026-11-05; it ended at `034_retire_portfolio_snapshot_interval` when this spec was first written, so max+1 is still `038`)). At merge, NNN = max(`origin/main-dev` config migration) + 1 **exactly, renumbering down as well as up** (C-07; soft ordering, operator decision 2026-11-05). A renumber is a `## Deviation Log` entry (F-09: step bodies stay immutable). Embedded NNN sites: (1) up/down file names and `-- Migration:` headers; (2) the `'system:config-migration-NNN'` literal in the up INSERT; (3) the expected `changed_by`/`updated_by` literal in `config-NNN.sql`; (4) the `\ir` paths in `config-NNN.sql`; (5) the assertion file name and its temp-table names; (6) the `--declared-migration` argument in verification commands; (7) analysis `CLAUDE.md` rows; (8) the `config-governance.md` entry; (9) the two `fix-analysis-live-loop-budget-seed` (293) rows in `merge-order.md` (currently lines 99-100); (10) the assertion file's header comments (`-- config NNN …`, `-- Replays the NNN up/down files`); (11) the old-number literal in Step 7's Verification (re-point it to the pre-renumber value). After any renumber `grep -rn` for the **old** number across the feature directory, the touched `CLAUDE.md`/docs and `@feature-` tags.

**Scenario Coverage (C-15):**

| Scenario | Covered by |
|---|---|
| AC-1 (budget key registered in fresh env) | Step 6 |
| AC-2 (WARN once per state change) | Step 2 |
| AC-3 (seed preserves runtime value, backfills metadata) | Step 6 |
| AC-4 (apply twice, one row per env) | Step 6 |
| AC-5 (SetConfig works without `create_key`) | Step 5 |
| AC-6 (budget bounds `[1,1000]`) | Step 5 |
| AC-7 (rollback keeps operator value) | Step 6 |
| AC-8 (wiring check passes, baseline entries gone) | Step 3 (its verification is the repo's wiring checker, the test for that rule) |
| AC-9 (operator-written metadata never overwritten) | Step 6 |
| AC-10 (interval key registered in fresh env) | Step 6 |
| AC-11 (interval bounds `[30,600]`) | Step 5 |
| AC-12 (rollback keeps operator interval) | Step 6 |

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (C-08); the Step 2 test is authored to fail against the current tree (P-06).
- Step 5 [test] covers Step 4 [service] (C-08); same red-first rule.
- Step 6 [test] requires Step 3: it `\ir`s the Step 3 up/down files and asserts against the NNN-named literals.
- Step 7 [docs] requires Step 3 (NNN) and Step 4 (bounds) so the docs state final values.
- PR split (operator decision 2026-11-05): Steps 1-2 integrate as **PR-1** and must not wait on Steps 3-7; Steps 3-7 are **PR-2**. Steps 1-2 and Steps 3-7 have no code dependency in either direction, so execute may run the groups in either order. How PR-1 reaches `main-dev` independently of the single `feature/fix-analysis-live-loop-budget-seed` development branch (a separate integration PR opened when Step 2 completes) is an execute-time decision to confirm with the operator at the first gate (P-03) — this spec does not guess it.
- Soft ordering against features 281 / 291 / 294 (the two 293 rows in `merge-order.md`, currently lines 99-100, plus the 293↔294 row): rebase-only. Feature 294 also edits `live_loop.py` (`run_forever`, per-pair handler, possible cycle wrapper) and shifts line numbers — Step 1 anchors **by symbol**, never by line number. Feature 291 also inserts above feature 249 in `docs/patterns/config-governance.md` (expect an append-order rebase conflict in Step 7) and may land `035`.
- Operator actions before the PR-2 deploy (not steps, no repo change): confirm or re-set the assistant-chosen staging `200`; run the pre-apply SELECT in `design.md` § Pre-apply operator check on both environments (full-dotted key under `namespace='analysis'`, no stripped twin, `value_type='int'`).

---

### Step 1 — service: overflow-WARN latch in the live loop

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "_fund_unavailable\|_logged_unresolved\|max_pairs\|if not records\|_TRUNCATION_COUNTER" services/xstockstrat-analysis/app/engine/live_loop.py` → `__init__` at `:275`; per-instance once-per-state precedents `self._fund_unavailable: set[...] = set()` at `:304` (comment: "in-memory, so a restart re-alerts at most once per still-unavailable pair") and `self._logged_unresolved` at `:314`; `self._lock = asyncio.Lock()` at `:315`.
- Reader sites (`@AC-6 @FR-3 @feature-278`, `platform.feature:833-838`): `LiveEvaluationLoop.run_forever` reads `analysis.engine.eval_interval_seconds` via `int_positive(self._cfg, …, 60)` at `live_loop.py:337`; `LiveEvaluationLoop._run_cycle` reads `analysis.engine.max_strategies_per_cycle` at `:359` — both unchanged by this feature.
- Budget read, re-read every cycle: `max_pairs = int_positive(self._cfg, "analysis.engine.max_strategies_per_cycle", 50)` at `:359` (`int_positive` ≥ 1 or the default, `app/config/watcher.py:142-144`).
- Zero-records early return: `if not records:` / `return  # zero-guard: nothing live → leave the rotation cursor untouched` at `:435-436`, before any overflow state update.
- `n = min(max_pairs, len(pairs))` / `if n == 0: return` at `:439-441` — unreachable because `int_positive` ≥ 1; **left alone**.
- Overflow block: `if len(pairs) > max_pairs:` at `:445`, `log.warning("live_loop: %d live (strategy,symbol) pairs across %d strategies exceed max_strategies_per_cycle=%d — evaluating %d this cycle (window %d..%d of %d%s, resuming after %s), rotating the rest; full rotation takes ~%d cycles", …)` at `:447-461`, `_TRUNCATION_COUNTER.add(len(pairs) - max_pairs)` at `:462`.
- Single instance per process, cycles never overlap: `run_forever` awaits `_run_cycle` inline (`:334-347`), so no lock is needed.
- Unchanged: `run_forever`, the dead `_lock` skip, the per-cycle INFO `live_loop: evaluated %d/%d pairs …` (`:481-489`), the dataless WARN (`:490-499`), rotation/cursor logic, `int_positive`, the code default `50`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `LiveEvaluationLoop.__init__`, immediately after `self._logged_unresolved` (before `self._lock`), add `self._overflow_warned_budget: int | None = None` with a comment of at most two lines stating the constraint (the effective budget the overflow WARN already fired for; `None` = not over budget; in-memory so a restart re-warns once).
2. In `_run_cycle`, in the `if not records:` early return, set `self._overflow_warned_budget = None` before `return` (a drained fleet must not leave a stale latch — FR-5 zero-live-pairs clause). Keep the existing return comment.
3. In the `if len(pairs) > max_pairs:` block, wrap **only** the existing `log.warning(...)` call in `if self._overflow_warned_budget != max_pairs:` and set `self._overflow_warned_budget = max_pairs` inside that guard. The WARN text and arguments stay **byte-identical** (Loki queries keep matching). `_TRUNCATION_COUNTER.add(len(pairs) - max_pairs)` stays **outside** the guard and unconditional.
4. Add an `else:` arm to that `if len(pairs) > max_pairs:` setting `self._overflow_warned_budget = None` (an under-budget cycle clears the state, so the next overflow warns again).
5. `max_pairs` is the **effective** budget (post-`int_positive`), so the latch compares the effective value, not the raw stored one.
6. Anchor every edit by symbol (`__init__`, `if not records:`, `if len(pairs) > max_pairs:`), not line number — feature 294 shifts lines in this file.
7. Do not add a "recovered" log line, a time-window throttle, or any new config key (rejected in `design.md`); do not reuse `analysis.engine.alert_throttle_seconds`.

**Verification**:
```
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . && grep -n "_overflow_warned_budget" app/engine/live_loop.py
```
(Expect exactly 5 references: init, `!=` guard, assignment in guard, `None` in the empty-records branch, `None` in the `else` arm. The behavioral proof is Step 2.)

---

### Step 2 — test: overflow WARN is emitted once per state change

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "class TestLiveLoopFairShare\|test_truncation_warns_only\|test_rotation_logs_window\|warns\[1\]" services/xstockstrat-analysis/tests/test_live_loop.py` → class at `:706`, `_cfg_max` at `:707-712`, `test_truncation_warns_only_when_over_budget` at `:759-780` (asserts exactly one WARN in one over-budget cycle — stays valid), `test_rotation_logs_window_cursor_and_cycle_summary` at `:783-808` with `warns[1]` assertions at `:803-804`.
- Helpers: `_make_loop` at `:37-59`; `_live_row(strategy_id, user_id, symbols=None, …)` at `:647`; multi-cycle driver pattern `loop._db.fetch = AsyncMock(return_value=[...])`, `loop._eval_pair = fake_eval`, repeated `await loop._run_cycle()` (`:714-731`); zero-pair cycle `loop._db.fetch = AsyncMock(return_value=[])` (`:736`).
- Modified helper region: `TestLiveLoopHeartbeat._one_iteration` at `test_live_loop.py:1650-1659` (currently returns `None`; Step 2 appends `return calls`, safe because its three existing callers at `:1669`, `:1679`, `:1689` ignore the return value).
- Module alias for monkeypatching the counter: `import app.engine.live_loop as live_loop_module` at `:20`.
- Snapshot-built config at the live-loop reader site: `snapshot_watcher(**values)` at `services/xstockstrat-analysis/tests/conftest.py:62-87` (imported at `test_live_loop.py:23`) builds a real `ConfigWatcher` so `int_positive` runs against a real reader.
- No existing test reads `_TRUNCATION_COUNTER` (recon "Not found"); the test replaces it with a `MagicMock` rather than adding an `InMemoryMetricReader`.
- C-13: the 690-symbol list is a single-consumer inline literal in this one test; stays inline (no fixture home created).

**TDD**: `red-green required`

**Covers**: `AC-2` (the reader tests in instruction 4 additionally satisfy `@AC-6 @FR-3 @feature-278` for both keys)

**Instructions**:
1. In `TestLiveLoopFairShare`, add `test_overflow_warn_once_per_state(self, caplog, monkeypatch)` (`@pytest.mark.asyncio`):
   - `loop = _make_loop()`; a local helper rebinds `loop._cfg = snapshot_watcher(**{"analysis.engine.max_strategies_per_cycle": budget})`.
   - `loop._eval_pair` = no-op async `fake_eval(defn, symbol, throttle, deny_entry=False)`; `counter = MagicMock()`; `monkeypatch.setattr(live_loop_module, "_TRUNCATION_COUNTER", counter)`.
   - A helper sets `loop._db.fetch = AsyncMock(return_value=[_live_row("s1", "u1", symbols=[f"S{i:04d}" for i in range(n)])])` (or `[]` for zero rows) and runs one `await loop._run_cycle()` under `caplog.at_level("INFO")`.
   - Sequence and cumulative-WARN assertions (WARN = records whose message contains `"exceed max_strategies_per_cycle"`): 10 cycles of 690 pairs @ budget 200 → cumulative 1; 5 cycles of 700 @ 200 → still 1; budget rebound to 250 with 700 pairs → 2; 240 pairs @ 250 (under budget) → still 2; 690 @ 250 → 3; zero rows → still 3; 690 @ 250 → 4.
   - For each of the first 10 cycles assert an INFO record containing `"evaluated 200/690 pairs"`.
   - Assert `counter.add.call_args_list == [call(490)] * 10 + [call(500)] * 5 + [call(450), call(440), call(440)]` exactly (import `call` from `unittest.mock`; the 240-pair and zero-row cycles add nothing).
2. Change `test_rotation_logs_window_cursor_and_cycle_summary` (`:783-808`): assert `len(warns) == 1`; keep the `warns[0]` assertions (`:799-802`); delete the two `warns[1]` assertions (`:803-804`, "window 2..3 of 5" / "resuming after s1/B"); add `assert "cursor now at s1/B" in summaries[0]` (the later windows' start is now recoverable only from the previous INFO's cursor). Keep the existing `summaries` length/`errors=0, no_bars=0`/`cursor now at s1/D` assertions.
3. Leave `test_truncation_warns_only_when_over_budget` (`:759-780`) unchanged.
4. **Reader tests (`@AC-6 @FR-3 @feature-278`, both keys; snapshot-built):**
   - In `TestLiveLoopHeartbeat` (`test_live_loop.py:1647`), add `test_run_forever_reads_interval_from_snapshot` (`@pytest.mark.asyncio`, `@pytest.mark.parametrize("value", (60, 90))`): modify `_one_iteration` (`test_live_loop.py:1650-1659`) to `return calls` as its last statement (its three existing callers at `:1669`, `:1679`, `:1689` ignore the return value) and reuse it with `_StopLoop` (`:1643`); in the new test: `loop = _make_loop()`; `loop._cfg = snapshot_watcher(**{"analysis.engine.eval_interval_seconds": value})`; `loop._run_cycle = AsyncMock()`; `calls = self._one_iteration(monkeypatch)`; `with pytest.raises(_StopLoop): await loop.run_forever()`; assert `calls[0] == value` (the `90` case proves the key is read, not defaulted).
   - In `TestLiveLoopFairShare`, add `test_budget_read_from_snapshot_seeded_value` parametrised over `budget` in `(50, 40)`: `loop._cfg = snapshot_watcher(**{"analysis.engine.max_strategies_per_cycle": budget})`, `loop._eval_pair = fake_eval` (no-op async `fake_eval(defn, symbol, throttle, deny_entry=False)`, as the neighbouring tests), one `_live_row` with 60 symbols, one `await loop._run_cycle()` under `caplog.at_level("INFO")`; assert the INFO record `evaluated {budget}/60 pairs` (the `50` case is the seeded value equal to the code default; the `40` case proves the key is read, not defaulted).
   - These two tests are green-on-both-trees characterisation guards (the readers are unchanged); only the latch test and the changed rotation test carry the RED proof.
5. **RED proof**: against the pre-Step-1 tree the new latch test fails (cumulative WARN count is 2 after cycle 2) and `test_rotation_logs_window…` fails on `len(warns) == 1`.

**Verification**:
```
cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py -q && uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
```

---

### Step 3 — migration: seed both live-loop keys and remove their wiring-baseline entries

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql` — create
- `services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.down.sql` — create
- `scripts/config-wiring.json` — modify (remove two baseline entries, same step: a baseline entry whose finding is gone is a hard `STALE:` failure under `--final`, and a seed without the removal leaves one)

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last migration in `origin/main-dev` (re-verified 2026-11-06): `ls services/xstockstrat-config/migrations | tail` → `037_portfolio_signal_prune_interval.{up,down}.sql` (000-034 paired except `024`, an old harmless gap, plus 037; `035`/`036` unusable because `037` is already applied) — max+1 today is `038`. Branch scan (`git ls-tree --name-only origin/feature/<branch> services/xstockstrat-config/migrations/`): `filter-otc-symbols` (282) carries `038_marketdata_asset_refresh_interval.{up,down}.sql` and `039_portfolio_servability_timeout.{up,down}.sql` (matches the Deviation Log's `038`/`039`); `fix-config-keys-drift` (295) and `fix-marketdata-dead-symbol-ingest` (291) carry nothing above `037` yet. All three are unmerged.
- **NNN = `043`** per the Deviation Log pin (order 282 `038`/`039` → 295 `040`/`041` → 291 `042` → 293 `043`; `merge-order.md` rows `:100` and `:103`). `043` is valid only if 282, 295 and 291 have merged first. **The Instruction 0 gate fires on the 2026-11-06 base**: max+1 is `038`, not `043`. **At the PR-2 merge, re-derive NNN = max(`origin/main-dev` config migration)+1 exactly (C-07)**; if that is not `043` (e.g. 293 would merge before a predecessor, leaving a `038`-`042` gap), stop and raise an operator decision (blocker) before renaming, and log the outcome in the Deviation Log. Steps 6 and 7 carry the same number and inherit this gate.
- Seed pattern: `033_ledger_stream_resolve_timeout.up.sql:8-17` — `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (…) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`, full-dotted `key`, `user_id` NULL, one row per `staging`/`production`; header rationale at `:5-6` (`key` must equal the string the reader looks up). Same shape in `028_analysis_opportunity_keys.up.sql:24-117`.
- Metadata-only UPDATE precedent: `032_analysis_zero_trap_descriptions.up.sql:5-9` (never touches `value_data`/`value_type`; idempotent via WHERE guard).
- Down precedent scoped to global rows: `028_analysis_opportunity_keys.down.sql:8-27`. `033_…down.sql` has no env/user filter — **do not copy it**.
- `updated_by` sentinel: `docs/patterns/config-governance.md:138` — `system:config-migration-<NNN>` (first used by 031); 028/033 do not set it.
- Audit triggers: BEFORE UPDATE audits only on `IS DISTINCT FROM` `value_data` (`017_config_secrets_and_scoping.up.sql:66-79`, guard `:69`; it also moves `updated_at` `:76`); AFTER INSERT writes one audit row per new row (`017:81-91`). So the metadata UPDATE writes no audit row; the INSERT writes one per newly inserted row; the down's DELETE writes none.
- Runtime-created staging row: `SetConfig create_key=true` upsert inserts only `namespace,key,value_type,value_data,value_encrypted,is_secret,updated_by,update_reason,environment,user_id,caller_identity` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:~635-648`; INSERT at `:636`, column list `:637`, `ON CONFLICT … DO UPDATE` `:639`) → NULL description/default_value/consuming_service.
- Wiring checker: `scripts/check-config-wiring.mjs` `applyInsert` `:172-201` (accepts only a bare INSERT or `ON CONFLICT … DO NOTHING`; `DO UPDATE` exits 2), `applyUpdate` `:203-248` (SET columns outside `SCOPE_COLS` are modelled), `buildStoredSet` `:352-376` (reads only `*.up.sql`), `ratchet` `:683-697` (`--final`: a baseline entry no longer produced → `STALE:`, emitted at `:695`); `--final` and `--declared-migration <file>` are documented in the usage header (`:3-4`). Neither key is seeded by any existing migration (`grep -rln "max_strategies_per_cycle\|eval_interval_seconds" services/xstockstrat-config/migrations/` → nothing).
- Baseline entries to remove: `scripts/config-wiring.json:78-83` (`analysis.engine.eval_interval_seconds`) and `:84-89` (`analysis.engine.max_strategies_per_cycle`), both `"kind": "read-unseeded"`, `"owner": "feature 278"`. The adjacent `analysis.engine.alert_throttle_seconds` entry (`:72-77`) is a **deliberate omission** — leave it.
- Readers: `live_loop.py:337` (`analysis.engine.eval_interval_seconds`, `int_positive`, default 60) and `:359` (`analysis.engine.max_strategies_per_cycle`, default 50).

**TDD**: `N/A (migration + baseline JSON are non-code-bearing; behavior is proven by Step 6's real-Postgres assertion and the wiring checker below)`

**Covers**: `AC-8` (the wiring checker named in Verification is the repo's own test for this rule)

**Instructions**:
0. `NNN` in this step and in Steps 6-7 is `043` (Deviation Log pin). Before creating the files, re-check `ls services/xstockstrat-config/migrations | tail -2` on the current `origin/main-dev`; if max+1 is not `043`, follow the merge-time rule in Codebase Evidence (operator decision, then a Deviation Log entry) rather than guessing a number. As of 2026-11-06 max+1 is `038`, so this gate is open: do not create the files until either 282, 295 and 291 have merged (max+1 becomes `043`), or the operator explicitly approves writing `043` now with a mandatory merge-time re-check, recorded in `context.md` and the Deviation Log.
1. Create `NNN_analysis_live_loop_keys.up.sql`. Header comment `-- Migration: NNN_analysis_live_loop_keys.up.sql`, `-- Service: xstockstrat-config, feature 293 (fix-analysis-live-loop-budget-seed).`, plus the `key`-must-equal-reader-string rationale (as `033:5-6`). **No `BEGIN`/`COMMIT`** (the Step 6 assertion `\ir`s it inside its own transaction). Three statements:
   1. One `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id) VALUES …` with four rows — keys `analysis.engine.max_strategies_per_cycle` (`'int'`, `'50'`, `default_value '50'`) and `analysis.engine.eval_interval_seconds` (`'int'`, `'60'`, `default_value '60'`), each for `'staging'` and `'production'`, `namespace='analysis'`, **full-dotted `key`**, `consuming_service='xstockstrat-analysis'`, `user_id` NULL, `updated_by 'system:config-migration-NNN'` — ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`. Descriptions (operator-visible effect only — no bounds, cost figures or loop mechanism; the config-ui renders bounds from `ListKeys` `scalarBounds`):
      - budget: `Most (strategy, symbol) pairs the live strategy loop evaluates per cycle. When more pairs are live, the loop rotates through them across cycles, so each pair is re-evaluated less often; raising it lengthens each cycle.`
      - interval: `Seconds the live strategy loop waits after finishing a cycle before starting the next. Raising it delays live entry and exit alerts.`
   2. and 3. One metadata-only `UPDATE config.config_values SET description = COALESCE(NULLIF(description,''), '<d>'), default_value = COALESCE(NULLIF(default_value,''), '<v>'), consuming_service = COALESCE(NULLIF(consuming_service,''), 'xstockstrat-analysis') WHERE namespace='analysis' AND key='<k>' AND user_id IS NULL AND environment IN ('staging','production') AND (NULLIF(description,'') IS NULL OR NULLIF(default_value,'') IS NULL OR NULLIF(consuming_service,'') IS NULL);` per key (`<v>` = `50` / `60`). It must **never** set `value_data`, `value_type` or `updated_by` (the runtime author stays attributed; a second apply is a no-op via the WHERE guard).
2. Create `NNN_analysis_live_loop_keys.down.sql` (no `BEGIN`/`COMMIT`), one statement with the outer parentheses load-bearing: `DELETE FROM config.config_values WHERE namespace='analysis' AND environment IN ('staging','production') AND user_id IS NULL AND ((key='analysis.engine.max_strategies_per_cycle' AND value_data='50') OR (key='analysis.engine.eval_interval_seconds' AND value_data='60'));`. It does not revert the metadata backfill; accepted limitation: an operator-created global row equal to the seeded value is also deleted (it equals the code default).
3. In `scripts/config-wiring.json` remove the `analysis.engine.eval_interval_seconds` object (`:78-83`) and the `analysis.engine.max_strategies_per_cycle` object (`:84-89`); keep the JSON valid (the preceding object ends the array element list correctly; the following `analysis.strategy.default_exit_cooldown_days` entry stays).
4. Do **not** edit 027/028/032/033 (F-01).

**Verification**:
```
ls services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.down.sql
node scripts/check-config-wiring.mjs --declared-migration services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql
node scripts/check-config-wiring.mjs --final
node --test scripts/config-wiring.test.mjs
grep -c "max_strategies_per_cycle\|eval_interval_seconds" scripts/config-wiring.json
grep -n "BEGIN\|COMMIT\|DO UPDATE" services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.*.sql
```
Expected: both files exist with the correct NNN (`043`, which must equal max(`origin/main-dev`)+1 at merge; if written early under the operator approval in Instruction 0, re-run `ls services/xstockstrat-config/migrations | tail -2` on `origin/main-dev` before the PR-2 merge and confirm max+1 is still `043`); `--declared-migration` and `--final` exit 0 with no `STALE:`; `config-wiring.test.mjs` passes; the baseline `grep -c` prints `0`; the last grep prints nothing. Read both SQL files and confirm the down reverses only what the up created (offline; the live apply/rollback is proven by Step 6 in CI).

---

### Step 4 — service: register `SetConfig` bounds for both keys

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "SCALAR_BOUNDS_REGISTRY\|live_enrich_timeout_ms\|last_close_lookback_days\|signal_prune_interval_seconds\|function lookupScalarBounds" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → registry declared at `:103` (`const SCALAR_BOUNDS_REGISTRY: Record<string, { minValue: number; maxValue: number }> = {`); the analysis group's last entry `'analysis.opportunity.live_enrich_timeout_ms': { minValue: 500, maxValue: 4000 },` at `:134` (preceded by the feature 227 comment `:131-132` and `read_db_budget_ms` `:133`, followed by `'marketdata.price.batch_timeout_ms'` `:135`); the table tail is now `'portfolio.marketdata.last_close_lookback_days'` `:148` then feature 281's `'portfolio.watchlist.signal_prune_interval_seconds': { minValue: 60, maxValue: 86400 },` `:150`, closing `};` at `:151`. The tail is 282's/295's insertion point, so 293 inserts in the analysis group instead (Deviation Log; `merge-order.md:103`). `lookupScalarBounds(namespace, key)` at `:156-158` tries the bare key then `${namespace}.${key}`, so full-dotted registry keys resolve under both column forms.
- Existing pattern for same-shaped entries: `'analysis.opportunity.max_universe_size': { minValue: 1, maxValue: 1000 },` at `:124` (typo-guard max, "Python reader clamps ≤ 0 to the default" comment on the min-1 keys in the block above it).
- Enforcement ordering: bounds check (`lookupScalarBounds` call `:559`) is before the feature-091 existence gate (`configServiceImpl.ts:~557-568` before `:~571-606`; `create_key` read `:573`, `NOT_FOUND` `:602-603`); out-of-range / NaN → `INVALID_ARGUMENT`.
- Alert rule named in the comment: `packages/otel/alerts/alert-rules.yaml:127` (`uid: xstk-analysis-no-scoring`, counts `live_loop: cycle complete` over 30 m; heartbeat logged only after a successful cycle, `live_loop.py:345`).
- Bound rationales (`design.md`): budget min 1 because `int_positive` turns ≤ 0 into 50 (`app/config/watcher.py:140-144`); max 1000 is a typo guard matching `max_universe_size` (pairs are evaluated serially, `live_loop.py:467-479`, so the budget bounds cycle duration, not concurrency; 400 was rejected as below today's ~690 live pairs). Interval min 30 (each iteration runs a full strategies SELECT, a signal drain and per-owner RPCs with no per-RPC timeout; 1 is the likeliest minutes-for-seconds typo); max 600 keeps interval + cycle duration under the 1800 s heartbeat window.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Immediately after the `'analysis.opportunity.live_enrich_timeout_ms'` entry (inside the analysis group, before `'marketdata.price.batch_timeout_ms'`; anchor by that symbol, not by line number), add:
   - a comment of at most two lines naming the alert uid `xstk-analysis-no-scoring` and the joint condition (interval + cycle duration must stay under its 1800 s window, and the cycle duration scales with the budget) — **no migration number** in the comment;
   - `'analysis.engine.max_strategies_per_cycle': { minValue: 1, maxValue: 1000 },`
   - `'analysis.engine.eval_interval_seconds': { minValue: 30, maxValue: 600 },`
2. Change nothing else in the file (no change to `lookupScalarBounds`, enforcement order or the existence gate).

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && grep -n "analysis.engine.max_strategies_per_cycle\|analysis.engine.eval_interval_seconds" src/grpc/configServiceImpl.ts
```
(Behavioral proof is Step 5.)

---

### Step 5 — test: bounds are enforced and `SetConfig` works without `create_key`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "TIMEOUT_KEY_FORMS\|features 227/229/231\|bounds the float agent" services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` → comment at `:264-265` ("features 227/229/231: read-path timeout, quote-window/retention and mark keys must be bounded under both key-column forms (G8)…"), `const TIMEOUT_KEY_FORMS: { ns; key; field: 'intVal' | 'floatVal'; min; max }[] = [` at `:266`; the `analysis.opportunity.live_enrich_timeout_ms` pair (stripped + full-dotted) at `:269-270`, followed by the `marketdata.price.batch_timeout_ms` pair `:271-272`; the table tail is now feature 281's `watchlist.signal_prune_interval_seconds` pair before the closing `];` (the 282/295 insertion point, so 293 inserts after the `live_enrich_timeout_ms` pair — Deviation Log); generated loop `for (const { ns, key, field, min, max } of TIMEOUT_KEY_FORMS) {` at `:293` (accepts `min` and `max`, rejects `min-1` and `max+1` with `INVALID_ARGUMENT` and `assert.match(err.details ?? err.message, /\[min, max\]/)` and no INSERT); after it, feature 281's hand-written `it('rejects portfolio.watchlist.signal_prune_interval_seconds = 0 …` at `:313`, then `it('bounds the float agent timeout key…` at `:321`.
- Harness: `setConfig(value, key = KEY, namespace = NS)` helper and the loopback `recordingPool` that returns `{ rows: [{ is_secret: false }] }` for the existence SELECT (models a registered row, so an in-bounds write without `create_key` reaching the INSERT proves AC-5) at the file's `before()` (`:41-65`); `insertQuery()` finds the `INSERT INTO config.config_values` query. Hand-written precedents `AC-4`/`AC-5` tests at `:216-250` using `OPP_*` constants.
- C-13: the key/bounds rows are the file's existing table shape; no new fixture home.

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6, AC-11`

**Instructions**:
1. Immediately after the `analysis.opportunity.live_enrich_timeout_ms` pair (anchor by that symbol, not line number; not at the table tail), add four rows to `TIMEOUT_KEY_FORMS` (stripped `engine.*` and full-dotted forms of each key, `ns: 'analysis'`, `field: 'intVal'`): `engine.max_strategies_per_cycle` and `analysis.engine.max_strategies_per_cycle` with `min: 1, max: 1000`; `engine.eval_interval_seconds` and `analysis.engine.eval_interval_seconds` with `min: 30, max: 600`. The generated loop then covers min/max accepted and min−1 / max+1 rejected for both forms. (The stripped `engine.*` form is the registry's `${namespace}.${key}` lookup; it never collides with the stored full-dotted key.)
2. Update the comment at `:264-265` to say it also covers the two `analysis.engine.*` live-loop keys (features 227/229/231/293).
3. Add hand-written cases after the generated loop, after feature 281's `signal_prune_interval_seconds = 0` test and before `'bounds the float agent timeout key…'` (using the existing `setConfig`/`insertQuery`/`queries` helpers, **no `create_key`** in the request):
   - budget (`analysis.engine.max_strategies_per_cycle`): `0` and `-5` rejected `INVALID_ARGUMENT` with `/\[1, 1000\]/` and no INSERT (AC-6); `1001` rejected; `1`, `200`, `1000` accepted and reaching the INSERT; value `150` accepted without `create_key` (AC-5).
   - interval (`analysis.engine.eval_interval_seconds`): `0`, `-5`, `29`, `601` rejected `INVALID_ARGUMENT` (`grpc.status.INVALID_ARGUMENT`, code 3) with `/\[30, 600\]/` and no INSERT; `30`, `60`, `600` accepted without `create_key` (AC-11).
4. **RED proof**: against the pre-Step-4 tree the keys are unregistered, so the out-of-range rejection cases fail — the generated min−1 / max+1 cases and the hand-written `0`, `-5`, `29`, `601`, `1001` cases. The in-range and AC-5 (`150` without `create_key`) cases pass on both trees: they are regression guards (the recording pool always returns a registered row), and AC-5's real-Postgres counterpart is the Step 6 seed assertion.

**Verification**:
```
cd services/xstockstrat-config && pnpm test && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 6 — test: real-Postgres assertion for the seed migration

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `scripts/migration-assertions/config-NNN.sql` — create

**Reviewers**: xstockstrat-config owner — Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Harness exists (correcting the product spec's earlier "no real-Postgres harness" claim): `scripts/migration-rerun.sh:183-190` — `for sql in "$assertions"/*.sql; do … case … fixtures-*) continue ;; … psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v seed_user_id="$SEED_USER_ID" -f "$sql"` runs every non-`fixtures-*` assertion in alphabetical order **after the full migration chain**; CI job `migration-rerun` at `.github/workflows/ci.yml:676-714`, path filter includes `scripts/migration-assertions/**` (`ci.yml:77-78`). Existing files: `ls scripts/migration-assertions/` → `analysis-026.sql, analysis-027.sql, config-031.sql, fixtures-*.sql, indicators-007.sql, ingest-013.sql, ingest-014.sql`.
- Template `scripts/migration-assertions/config-031.sql`: header comment ("Replays the historical 031 up-file: a later migration changing these rows or config_values columns must update or retire this file."), a pre-transaction `DO $$ … RAISE EXCEPTION 'AC-N: …'` block, `BEGIN;` (`:63`), fixture `INSERT INTO config.config_values` with its column list on the next line (`:76-77`), `CREATE TEMP TABLE b031 AS SELECT * FROM config.config_values;` (`:94`), `\ir ../../services/xstockstrat-config/migrations/031_…up.sql` (`:96`), assertion `DO` blocks, a no-collateral `EXCEPT` diff, `ROLLBACK;` (`:163`).
- Fixture constraints: because the assertion runs after the whole chain, the seeded rows already exist — fixtures DELETE them first; **every fixture INSERT names `environment` explicitly** and a `value_type` from the CHECK set (the column default `'dev'` violates `config_values_environment_check`, `017:41`); conflict target `config_values_scope_uniq (namespace, key, environment, COALESCE(user_id,''))` (`017:101-102`); audit table `config.config_audit` (`id BIGSERIAL`, `001_config_tables.up.sql:27`; columns `id`, `old_value`, `changed_by`, `environment`) written by the AFTER INSERT trigger (`017:81-91`). No migration after `017` redefines the audit triggers (`grep -ln "TRIGGER\|config_audit" services/xstockstrat-config/migrations/*.up.sql` → 001, 002, 010, 014, 017 only).
- Fixture-only literals (single consumer, inline per C-13): the key strings and values from Step 3.

**TDD**: `N/A (SQL assertion replays the Step 3 migration on real Postgres; no offline red/green runner exists — the red state is a missing migration file / unseeded rows, observed in the CI migration-rerun job)`

**Covers**: `AC-1, AC-3, AC-4, AC-7, AC-9, AC-10, AC-12`

**Instructions**:
Create `scripts/migration-assertions/config-NNN.sql` with header `-- config NNN (AC-1, AC-3, AC-4, AC-7, AC-9, AC-10, AC-12): run by migration-rerun.sh after passes 0-3.` and `-- Replays the NNN up/down files: a later migration touching these rows must update or retire this file.` Three parts, each failing with `RAISE EXCEPTION 'AC-N: …'`:
1. **Pre-transaction `DO` block (AC-1, AC-10):** for each environment (`staging`, `production`) × key (`analysis.engine.max_strategies_per_cycle` → `50`, `analysis.engine.eval_interval_seconds` → `60`): exactly one global row, `namespace='analysis'`, the exact full-dotted key string, `value_type='int'`, value as given, `default_value` equal to the value, non-empty `description`, `consuming_service='xstockstrat-analysis'`; no namespace-stripped `engine.*` twin row.
2. **Transaction A (`BEGIN`):** DELETE both keys' rows (all environments and users); insert fixtures — staging global budget `'200'` (`description=''`, `default_value`/`consuming_service` NULL, `updated_by='admin-x'`), staging global interval `'90'` (all metadata NULL), per-user staging budget rows `user-2` = `'75'` and `user-3` = `'50'` (the **seeded** value) and a per-user `user-2` staging interval `'60'` (the **seeded** value), a staging global `analysis.engine.alert_throttle_seconds` row, and staging global `ledger`-namespace rows holding `'60'` and `'50'`. Then `CREATE TEMP TABLE a_NNN AS SELECT COALESCE(max(id),0) AS m FROM config.config_audit` (after the inserts, which fire the audit trigger) and `CREATE TEMP TABLE b_NNN AS SELECT * FROM config.config_values`. `\ir ../../services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql`; assert (AC-3): staging budget still `200`/`int`, exactly one row, description now non-empty, `default_value '50'`, consumer filled; staging interval still `90` with metadata filled; production both rows `50`/`60` with `updated_by = 'system:config-migration-NNN'`; exactly 2 new `config_audit` rows (`id > m`; both `environment='production'`, `old_value` NULL, `changed_by` = the sentinel, one per key — none for staging, since the BEFORE UPDATE trigger audits only `value_data` changes); a no-collateral `EXCEPT` diff vs `b_NNN` excluding the two keys' global rows = 0. Capture `m2` and `CREATE TEMP TABLE c_NNN`; `\ir` the up file again; assert (AC-4): one row per environment per key, values unchanged (staging `200`/`90`, production `50`/`60`), **no audit rows with `id > m2`**, full-table `EXCEPT` vs `c_NNN` = 0 — and state plainly in a comment that this diff cannot detect a spurious re-UPDATE (`NOW()` is constant inside a transaction; idempotency rests on the WHERE guard). `\ir ../../services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.down.sql`; assert (AC-7, AC-12): both production rows gone; surviving — staging budget `200`, staging interval `90`, per-user `user-2` budget `75`, `user-3` budget `50` and `user-2` interval `60`, the `alert_throttle_seconds` row, both `ledger` rows (`'60'` and `'50'`); `EXCEPT` vs `c_NNN` = exactly the two production rows. `ROLLBACK;`.
3. **Transaction B (`BEGIN`, AC-9 and probes):** DELETE both keys' rows; insert staging budget `'200'` with description `'Operator note'`, `default_value '75'`, `consuming_service` NULL; staging interval `'50'` (the budget's seed value) with operator description/`default_value` and consumer NULL. `\ir` up; assert (AC-9) both operator descriptions and defaults unchanged, only the blank column filled (proves the per-key OR-guard and per-column `COALESCE` for **both** UPDATE statements); `\ir` down; assert the staging interval `'50'` survives (catches a `key IN (A,B) AND value_data IN ('50','60')` mis-write). `ROLLBACK;`.

Every fixture INSERT lists `environment` explicitly and a valid `value_type`, and writes its column list on the line immediately after `INSERT INTO config.config_values` (as in `config-031.sql:76-77`; the Verification `grep -A2` check depends on this). Per-user and global fixture rows carry `namespace='analysis'` and the exact full-dotted key.

**Verification**:
```
ls scripts/migration-assertions/config-NNN.sql services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.down.sql
grep -o "AC-[0-9]*" scripts/migration-assertions/config-NNN.sql | sort -u
grep -n '\\ir ' scripts/migration-assertions/config-NNN.sql
test "$(grep -c 'INSERT INTO config.config_values' scripts/migration-assertions/config-NNN.sql)" -eq "$(grep -A2 'INSERT INTO config.config_values' scripts/migration-assertions/config-NNN.sql | grep -c environment)" && echo ok
```
Coverage threshold: N/A — this is a SQL assertion file with no instrumented source; the gate is the CI `migration-rerun` job (`ci.yml:676-714`).
Offline only (HARD CONSTRAINT: no database is started by a step verification): confirm the file and both `\ir` targets exist, every one of AC-1/3/4/7/9/10/12 is raised somewhere, the five `\ir` lines (up ×3, down ×2) resolve relative to `scripts/migration-assertions/`, and no fixture INSERT omits `environment`. The real replay is the CI `migration-rerun` job (`ci.yml:676-714`; `./scripts/migration-rerun.sh`) — re-run it after each rebase onto 282/295/291 (281 has merged), since a sibling migration touching `config_values` columns or audit triggers can stale the "exactly 2 audit rows" expectation.

---

### Step 7 — docs: analysis CLAUDE.md rows and the registered-keys log

**Status**: `pending`
**Service**: `docs/patterns/`, `services/xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (Config Keys rows `analysis.engine.eval_interval_seconds` and `analysis.engine.max_strategies_per_cycle`)
- `docs/patterns/config-governance.md` — modify (new Per-Feature Registered Keys entry)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "analysis.engine" services/xstockstrat-analysis/CLAUDE.md` → `:528` `| analysis.engine.eval_interval_seconds | int | 60 | Live evaluation polling cadence in seconds |` and `:529` `| analysis.engine.max_strategies_per_cycle | int | 50 | Max (strategy × symbol) pairs evaluated per cycle |`; sibling phrasing precedent "Seeded by migration `028` (feature 184); bounds `[1,1000]`" in the same table.
- `docs/patterns/config-governance.md` (re-verified 2026-11-05): `## Per-Feature Registered Keys` at `:140`, "Append-only log … Newest first" at `:142`; the first (newest) entry is now `### feature 281 — signal-watchlist-expiry-pruning (`xstockstrat-portfolio` / `xstockstrat-config`)` at `:144` (its seeded-key table `| Key | Type | Default | Bounds | Notes |` at `:151`), with `### feature 249 — fix-ibkr-request-signing` moved to `:155`; feature 248's table header at `:179`; the global key table header at `:334` already carries a `Bounds` column convention (`analysis.opportunity.max_universe_size` … `[1,1000]` at `:339`).
- `docs/roadmap/features/merge-order.md` (re-verified 2026-11-06): the 293 rows are at `:100` (293 ↔ 291, pinned hard order; its "insert above the feature 249 entry" wording predates 281's entry and is stale), `:101` (293 ↔ 281, superseded), `:103` (293 ↔ 282/295, hard order + registry anchors) and `:105` (293 ↔ 294, soft). These four anchors are authoritative; the spec header's "currently lines 99-100" (placeholder note site 9 and the Step Dependencies soft-ordering bullet) is stale.
- Root `CLAUDE.md` § Config Governance Rules: "Per-feature registered keys live in the Per-Feature Registered Keys log … retrieved on demand, not restated here" — no root `CLAUDE.md` change.

**TDD**: `N/A (docs-only)`

**Covers**: —

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md`, append to the two rows' description cells: `Seeded by migration NNN (feature 293); bounds [30,600].` (interval) and `Seeded by migration NNN (feature 293); bounds [1,1000].` (budget). Keep the rest of each cell unchanged.
2. In `docs/patterns/config-governance.md`, insert as the first entry under `## Per-Feature Registered Keys` (newest first: directly above whatever entry is first at execution time — today feature 281 at `:144`; after the pinned merge order, likely 291's or 295's/282's entry — never "above feature 249") `### feature 293 — fix-analysis-live-loop-budget-seed (xstockstrat-config / xstockstrat-analysis)` with a short paragraph (both keys seeded for `staging` + `production` by config migration `NNN_analysis_live_loop_keys`, stored as `int`; the migration never changes an existing row's value and only backfills blank metadata; the code defaults 50/60 stay in the readers) and a table: `analysis.engine.max_strategies_per_cycle | int | 50 | [1,1000]` and `analysis.engine.eval_interval_seconds | int | 60 | [30,600]`, noting the interval's ceiling is tied to the `xstk-analysis-no-scoring` heartbeat window. Expect an append-order rebase conflict with the 282/295/291 entries; resolve by keeping 293 first.
3. The 293 rows in `merge-order.md` (`:100`, `:101`, `:103`, `:105`; see Codebase Evidence) already pin `043` — no edit here; on a renumber away from `043`, update their NNN text and log it in the Deviation Log. The NNN written in Instructions 1-2 is the one Step 3 settled through its Instruction 0 gate (open on the 2026-11-06 base, where max+1 is `038`); do not write the docs before that gate is resolved.
4. Teardown (root `CLAUDE.md`): this step changes a context file and a doc listed for refresh; run `/context-forge:context-constitution refresh` scoped to these two files before pushing, or, if the plugin is unavailable, re-read both against the current code and record **both** the unavailability and the manual reconciliation in the PR body.

**Verification**:
```
grep -n "feature 293" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
grep -rn "<previous NNN>" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md | grep -i "migration"
grep -n "bounds \[30,600\]\|bounds \[1,1000\]" services/xstockstrat-analysis/CLAUDE.md
```
(The second command is the old-number check after a renumber: substitute the pre-renumber NNN — `038`, the spec-time value, per the Deviation Log — and it must print nothing once the migration carries a different number. The third confirms both bounds notes were written.) Also `ls services/xstockstrat-config/migrations/NNN_analysis_live_loop_keys.up.sql` to confirm the NNN written in the docs matches the real file.

---

## Deviation Log

### Deviation: Pre-execution — config migration number and registry anchors (2026-11-05)

Pinned by operator decision (merge order 282 → 295 → 291 → 293); step bodies stay immutable (F-09), so the executor applies these overrides:

- **`NNN` = `043`** (replaces the spec-time `038`). `043` = max(`origin/main-dev`)+1 once 282 (`038`/`039`), 295 (`040`/`041`) and 291 (`042`) have merged; if the base differs at merge time, take max+1 exactly (C-07) and log it here. Apply to all eleven embedded NNN sites listed in the placeholder note, and set Step 7's old-number check to `038`.
- **`SCALAR_BOUNDS_REGISTRY` anchor.** Insert the two `analysis.engine.*` entries (and their comment) immediately after `'analysis.opportunity.live_enrich_timeout_ms'`, inside the analysis group, not "after `last_close_lookback_days`" (that tail now holds 281's entry and is 282's/295's insertion point).
- **`TIMEOUT_KEY_FORMS` anchor.** Insert the four rows immediately after the `analysis.opportunity.live_enrich_timeout_ms` pair, not at the table tail.

### Deviation: Step 1 — WARN format-string source wrap and TDD probe (2026-11-06)

- **WARN format string re-wrapped in source.** Nesting the `log.warning(...)` under the new guard adds one indent level, so the implicit string concatenation is split at `of ` / `%d%s,` instead of `of %d%s, ` / `resuming` to stay within the 100-column ruff limit. The concatenated format string and the arguments are byte-identical (checked with `==` on both literals); only the source line break moved. **Disposition**: within Instruction 3 (rendered text unchanged; Loki queries unaffected).
- **RED/GREEN via a temporary probe.** Step 1's **Files** exclude `tests/test_live_loop.py`, so the TDD cycle (service + paired Step 2 test, `reference/tdd-gate.md`) ran a temporary `tests/test_tmp_step1_latch_probe.py` that followed Step 2 Instruction 1's sequence. It was deleted before the commit; Step 2 writes the real test. **Disposition**: process-only; nothing staged outside **Files**.

### Deviation: Step 2 — RED captured against a temporarily restored pre-Step-1 `live_loop.py` (2026-11-06)

- **RED run on a swapped-in pre-Step-1 file.** Step 1 was already committed (`8692b3bd`), so Instruction 5's RED proof ("against the pre-Step-1 tree") was captured by temporarily copying `8692b3bd~1:services/xstockstrat-analysis/app/engine/live_loop.py` over the working file, running the four new or changed tests, and then restoring the file with `git checkout --`. Nothing outside **Files** was staged. **Disposition**: process-only.

### Deviation: Step 3 — `043` written ahead of its predecessors under operator approval (2026-11-06)

- **NNN `043` written before 295 and 291 merged.** Instruction 0's gate was open: on 2026-11-06 `origin/main-dev` config migrations end at `039_portfolio_servability_timeout` (282 has merged), so max+1 is `040`, not `043`. The operator chose Option A on 2026-11-06 and approved writing `043` now. **Mandatory merge-time re-check:** immediately before the PR-2 merge, max(`origin/main-dev` config migration)+1 must equal `043`. If it does not, renumber (all eleven embedded NNN sites) or stop for an operator decision, and log the result here. 293 still merges after 282, 295 and 291. **Disposition**: operator-approved (Instruction 0 alternative branch).
- **Offline migration check.** No database was started. Reversibility was confirmed by reading both files: the up inserts four global staging/production rows (`DO NOTHING`) and backfills blank metadata; the down deletes only global staging/production rows still holding `50`/`60`. The live apply and rollback are proven by Step 6 in the CI `migration-rerun` job. **Disposition**: offline migration check — live apply deferred to CI.

### Deviation: Step 4 — RED via temporary Step 5 table rows (2026-11-06)

- **RED/GREEN via a temporary probe.** Step 4's **Files** exclude `setConfigScalarBounds.test.ts`, so the TDD cycle temporarily added Step 5 Instruction 1's four `TIMEOUT_KEY_FORMS` rows, ran `pnpm test` before and after the registry edit, then restored the test file with `git checkout --`. Step 5 writes the real test. **Disposition**: process-only; nothing staged outside **Files**.

### Deviation: Step 5 — RED captured against a temporarily restored pre-Step-4 `configServiceImpl.ts` (2026-11-06)

- **RED run on a swapped-in pre-Step-4 file.** Step 4 was already committed (`7b2d2b9a`), so Instruction 4's RED proof was captured by temporarily writing `7b2d2b9a~1:services/xstockstrat-config/src/grpc/configServiceImpl.ts` over the working file, running `pnpm test`, and then restoring the file with `git checkout --`. Nothing outside **Files** was staged. **Disposition**: process-only.
- **Hand-written cases grouped into four `it` blocks.** Instruction 3's values are covered by four loop-style tests, each request sent without `create_key`: budget rejects `0`/`-5`/`1001`; budget accepts `1`/`200`/`1000`/`150`; interval rejects `0`/`-5`/`29`/`601`; interval accepts `30`/`60`/`600`. They use two local key constants (`ENGINE_BUDGET`, `ENGINE_INTERVAL`) in the file's `OPP_*` style. **Disposition**: within Instruction 3.

### Deviation: Step 6 — fixture values the spec left open, and an extra offline parse (2026-11-06)

- **Fixture values chosen.** The spec named these fixtures but not their values:
  - The two `ledger`-namespace rows reuse the two full-dotted key strings (`'60'` on the interval key, `'50'` on the budget key), so an up or down predicate that lost its `namespace` filter would touch them.
  - The `analysis.engine.alert_throttle_seconds` row holds `'60'`, so a down filtered on value without its key would delete it.
  - Transaction B's operator interval metadata is description `'Operator interval note'` and `default_value '45'`.
  - Every other fixture row has NULL metadata, so an UPDATE that loses its `user_id`/`namespace` scope shows up in the no-collateral diff.
  - Survival checks on the interval side and the unrelated rows raise `AC-12`; the budget side raises `AC-7`.
  - **Disposition**: within Instructions 2-3.
- **Extra offline syntax check.** Beyond the spec's `ls`/`grep` checks, the new assertion, the 043 up/down files and the `config-031.sql` control were parsed offline with `pglast==7.22` (libpg_query). It ran in a scratchpad venv; nothing was committed and no DB was started. The `\ir` meta-commands were stripped first, and each `DO` body was parsed as PL/pgSQL. The real replay is still the CI `migration-rerun` job. **Disposition**: process-only.

_Populated by /sdd-execute as implementation proceeds._
