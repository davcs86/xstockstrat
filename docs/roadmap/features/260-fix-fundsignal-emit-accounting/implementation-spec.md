# Implementation Spec: fix-fundsignal-emit-accounting

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/260-fix-fundsignal-emit-accounting/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-fundsignal-emit-accounting`
**Severity**: SEV-2

---

## Execution Summary

All code lands in one file, `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`, with its tests in
`services/xstockstrat-analysis/tests/`. This follows design.md's Chosen Approach: analysis only, no migration, no
ingest code change, and a proto edit that touches a comment only. The work runs as three red-before-green pairs in
dependency order:

1. **D-57** (Steps 1-2). `_paced_fetch` returns a `failed` bucket, and the status order is `partial` >
   `budget_deferred` > `completed`. This pair stands alone.
2. **D-43 claim/accounting** (Steps 3-4). Any unconfirmed exit releases the claim, the confirm is scoped by `run_id`,
   and only accepted signals are counted. This pair also adds the one `local_pg` real-SQL test.
3. **Retry stability** (Steps 5-6). `_already_emitted` returns `{symbol: score}`, `_map_directions` takes the
   day-wide `reference_scores`, and the `valid_until` anchor depends on the run mode. This pair needs Step 4,
   because without the release a failed symbol never gets a retry run.

Steps 7-8 add `"partial"` to the proto comment and regenerate the stubs. Step 9 updates the docs and runs the
teardown audit.

**xstockstrat-ingest** is listed under Affected Services but gets no step, because design.md rejected the
ingest-side alternative. This spec re-verified the dedup claim that @AC-8 depends on, at
`services/xstockstrat-ingest/app/handlers/servicer.py:1016-1066`:

- One `async with self._db.acquire() as conn, conn.transaction():` (`:1016`) wraps both the `newsletter_signals`
  INSERT and the `signal_dedup_claims` INSERT.
- The conflict key is `ON CONFLICT (user_id, source, symbol, direction)` (`:1044`). `valid_from` is not part of it.
- The overwrite `WHERE` applies only when the claim is outside the window, or when `conviction` or `valid_until`
  differs (`:1048-1053`).

**Consumer surfaces (C-14).** Both surfaces named in the product spec pass values through unchanged, so neither
needs a code step:

- **Agent** `run_fundamentals_scan` (`services/xstockstrat-agent/app/tools.py:1401`). It returns
  `client.run_fundamentals_scan`, which copies `resp.status` and `resp.deferred_count` field by field
  (`services/xstockstrat-agent/app/client.py:1718-1725`). Its docstring does not list the status values.
- **UI** `/config-ui/fundamentals-scan`. It renders `{summary.status}` and `{summary.deferredCount}` verbatim
  (`services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx:101,106`).

Step 9 updates the one consumer doc that lists the status values (`docs/runbooks/mcp-tools.md:845`) and greps both
pass-through sites as its check.

### Scenario Coverage (C-15)

| Scenario | Covered by | RED on pre-fix tree? |
|---|---|---|
| @AC-1 failed emit retried same day | Step 3 (fake + `local_pg`) | yes, the second run skips AAPL |
| @AC-2 `signals_emitted` counts accepted only | Step 3 | yes, today it reports 2 |
| @AC-3 abort leaves no orphan claim | Step 3 | yes, a NULL row remains |
| @AC-4 failed chunk reported as `partial` | Step 1 | yes, today `completed` with deferred 0 |
| @AC-5 abort keeps confirmed rows | Step 3 | yes, a NULL MSFT row remains |
| @AC-6 `partial` beats `budget_deferred` | Step 1 | yes, today `budget_deferred` with deferred 20 |
| @AC-7 confirmed same-day rows skipped, zero fetch | Step 3 | no; PRESERVE guard of `services/xstockstrat-analysis/CLAUDE.md:123` |
| @AC-8 lost-response retry resends identical signal | Step 5 | yes, `valid_until` is now-anchored today |
| @AC-9 one-symbol retry keeps day-wide direction | Step 5 | yes, today `buy` |
| @AC-10 force keeps a now-anchored `valid_until` | Step 5 | no; PRESERVE pin of today's force behaviour |

## Step Dependencies

- **Test pairing (C-08/P-06):** Step 1 [test] covers Step 2 [service], Step 3 [test] covers Step 4 [service], and
  Step 5 [test] covers Step 6 [service]. Each test step is written and run RED before its service step.
- **Step 3 requires Step 2:** Step 3's `TestEmitAccounting` reads the summary that the 4-tuple `_paced_fetch` call
  site produces, and its fake has to tolerate Step 2's code.
- **Step 5 requires Step 4:** @AC-8 and @AC-9 retry a symbol that the first run failed to emit. That symbol reaches
  the second run only if Step 4 released its claim.
- **Step 8 requires Step 7:** buf-gen regenerates the comment that Step 7 edits.
- **Step 9 requires Steps 2, 4, 6 and 8:** it documents the shipped behaviour and the regenerated comment.
- **Cross-feature merge order:** `246-fix-fundsignal-neutral-score` (implementation-ready) edits the same `run_once`
  claim/skip/emit lines and the `_fund` / `_emitted_inserts` test helpers. **246 merges to `main-dev` first, then
  260 rebases onto it.** Line numbers in this spec are from `main-dev` @ the design base. After the rebase, find
  every site by the symbol or SQL text cited next to it, and record line shifts in the Deviation Log.
  `/sdd-execute` lands the `merge-order.md` row (text in Step 9 item 4) **before Step 1**, so the dependency is
  recorded for the whole execution window; Step 9 only verifies it is present.
- **Peers, rebase only:** `259-fix-python-loop-supervision` (`run_forever`/`_tick`, still `spec-ready` with no
  design), `244-fix-python-config-stored-zero` (the `retry_seconds` reads at `:143,154`) and
  `215-block-fundamentals-strategy-on-etf` (`analysis.proto`, a different message).
- **Loop-path `x-trace-id` (design §8, optional):** not added. Peer 259 has no design yet, so there is nothing to
  coordinate with. The loop path `run_once(metadata=())` (`fundsignal_loop.py:147`) stays trace-less, as recorded
  in design.md. The `RunFundamentalsScan` path keeps the inbound `x-trace-id` through `sys_meta` (`:175-178`) and
  `metadata`.
- **Out of scope:** a chunk that succeeds but returns fewer fundamentals than requested still drops symbols
  silently. That belongs to `255-fix-marketdata-fundamentals-cache` (design Open Risks).

---

### Step 1 — test: failed fetch chunks are reported as `partial` (RED)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_paced_fetch(self, symbols, budget, metadata, chunk_size=50)` is at `app/engine/fundsignal_loop.py:394-420`
  (re-spec 2026-10-29, after the 246 merge).
  - The per-chunk `except Exception as e:  # noqa: BLE001` at `:414-415` only logs.
  - `calls += 1; i += chunk_size` runs regardless (`:416-417`).
  - `deferred = symbols[i:]` (`:419`) and `return fetched, deferred, calls` (`:420`), still a 3-tuple.
- The status line is `status = "budget_deferred" if deferred else "completed"` (`:281`), and the budget warning is at
  `:282-286`.
- Existing test `TestBudgetDefer.test_paced_fetch_respects_budget` (class at `tests/test_fundsignal_loop.py:157`, method
  at `:159`) unpacks a
  3-tuple at `:162`: `fetched, deferred, calls = await loop._paced_fetch(symbols, budget=1, metadata=())`.
- `test_run_marks_deferred_and_warns` (`:169`) asserts `status == "budget_deferred"`, `deferred_count == 70` and
  `EmitAlert.assert_awaited()`. It must stay green.
- The `_make_loop` `_get_multi` side-effect shape is at `:62-65`.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-6`

**Instructions**:
1. In `test_paced_fetch_respects_budget` (`:162`), change the unpack to
   `fetched, deferred, failed, calls = await loop._paced_fetch(symbols, budget=1, metadata=())` and add
   `assert failed == []`.
2. Add `class TestFailedChunk` after `TestBudgetDefer`. It holds a local `_fail_first_chunk(loop)` helper that
   replaces `loop._marketdata.GetFundamentalsMulti` with an `AsyncMock(side_effect=...)`. The side effect counts
   calls and:
   - on the first call, raises `_rpc_error(grpc.StatusCode.UNAVAILABLE)` (`_rpc_error` is at `:528`; import `grpc`
     inside the test, as `:702` does);
   - on later calls, returns `SimpleNamespace(fundamentals=[_fund(s) for s in request.symbols])`.
3. `test_ac4_failed_chunk_is_partial_and_deferred` (@AC-4):
   - Set up `loop = _make_loop()` with the side effect and 60 symbols (`[f"S{i}" for i in range(60)]`).
   - Run `summary = await loop.run_once(override_symbols=symbols)`.
   - Assert `summary.status == "partial"`, `summary.deferred_count == 50` and `summary.symbols_processed == 10`.
   - Assert the `fundsignal_runs` UPDATE (`loop._db.execute` call whose SQL contains
     `"UPDATE analysis.fundsignal_runs"`) received `"partial"` and `50` as its `status` and `deferred_count` args.
   - Assert `loop._paced_fetch` returned the failed chunk. Call `_paced_fetch(symbols, 200, ())` directly on a fresh
     failing loop and check `len(failed) == 50`, `deferred == []` and `calls == 2`.
4. `test_ac6_failed_chunk_beats_budget_cutoff` (@AC-6):
   - Set up `_make_loop({"analysis.fundsignal.daily_call_budget": 2})` with the same side effect and 120 symbols.
   - Assert `status == "partial"`, `deferred_count == 70` and `symbols_processed == 50`.
   - Assert exactly one `EmitAlert` whose `body` names both the failed-chunk count (`50`) and the budget cutoff
     (`20`).
5. The test data is `_fund` / `_make_loop`, already one consumer in this file. The new helper is inline and has a
   single consumer (C-13 compliant, so no conftest move).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -k "TestFailedChunk or test_paced_fetch_respects_budget" -q
# RED (pre-Step-2): test_paced_fetch_respects_budget fails (ValueError: not enough values to unpack)
# and both TestFailedChunk tests fail (status "completed"/"budget_deferred", deferred 0/20)
grep -n "conftest" tests/test_fundsignal_loop.py   # C-13: no new conftest fixture introduced
# Coverage (B2): no --cov-fail-under here, since this step is RED by design; the paired Step 2 carries --cov-fail-under=40
```

---

### Step 2 — service: `_paced_fetch` failed bucket and `partial` status

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_paced_fetch` (`fundsignal_loop.py:394-420`): `fetched = {}` is at `:400`, the `except` is at `:414-415` and the
  return is at `:420` (re-spec 2026-10-29). Its only callers are `run_once` (`:223`,
  `fetched, deferred, calls_spent = await self._paced_fetch(to_process, budget, metadata)`) and the test at
  `tests/test_fundsignal_loop.py:162` (recon.md:108-110).
- `_abort_cycle(..., deferred=len(deferred), ...)` is at `:272-279`, and `_finish(..., deferred=len(deferred), ...)`
  is at `:287-294`.
- `migrations/003_fundsignal_runs.up.sql:9`: `status text NOT NULL DEFAULT 'running'`, with no CHECK constraint, so
  no migration is needed (F-01: the comment in that applied migration is not edited).
- `_emit_warning(msg, severity=...WARNING)` is at `:642-656`. Its broadcast stays untargeted (`@AC-6 @feature-224`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `_paced_fetch`:
   - Add `failed = []` next to `fetched = {}` (`:400`).
   - Inside the existing `except` (`:414-415`), after the `log.warning`, add `failed.extend(chunk)`.
   - Change the return to `return fetched, deferred, failed, calls`.
   - Extend the docstring by one clause: a raising chunk's symbols are returned in `failed`.
   - `calls += 1` stays: a failed call still spends budget.
2. In `run_once`:
   - Change `:223` to `fetched, deferred, failed, calls_spent = await self._paced_fetch(...)`.
   - Compute `deferred_count = len(deferred) + len(failed)` once, after the fetch.
   - Pass `deferred=deferred_count` to both the `_abort_cycle` call (`:272-279`) and the `_finish` call
     (`:287-294`).
   - `symbols_done=len(fetched)` is unchanged at both sites (FR-4).
3. Replace `:281-286` with:
   ```python
   status = "partial" if failed else ("budget_deferred" if deferred else "completed")
   if failed or deferred:
       parts = []
       if failed:
           parts.append(f"{len(failed)} symbols from failed GetFundamentalsMulti chunks")
       if deferred:
           parts.append(f"{len(deferred)} symbols at the daily call budget ({budget})")
       await self._emit_warning("fundsignal: deferred " + " and ".join(parts))
   ```
   This is one warning per run. `_finish`, `_abort_cycle` and `_emit_warning` keep their signatures.
4. No other change. In particular, the `dry_run` early return (`:195-199`) and the universe-enumeration outage path
   are not touched (PRESERVE `@AC-7`/`@AC-8` of `fundsignal-watchlist-universe.feature`).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q   # GREEN: Step 1 tests + all existing
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n '"partial"' services/xstockstrat-analysis/app/engine/fundsignal_loop.py
```

---

### Step 3 — test: claim release, accepted-only count, abort cleanup, and real SQL (RED)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_fundsignal_emitted_real_pg.py` — create

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Claim INSERT `... ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol`, args
  `(symbol, source_slug, as_of_date, score, directions[symbol], run_id)`: `fundsignal_loop.py:247-258`
  (re-spec 2026-10-29, rev 2). `row is None` → `continue` at `:259-260`.
- The emit call is at `:261-263`. The confirm UPDATE `SET signal_id=$4 WHERE symbol=$1 AND source=$2 AND as_of_date=$3`
  is unscoped (`:264-272`). The unconditional `emitted += 1` is at `:273`.
- **Feature 246 (merged to `main-dev`) changed `_score`** (def `:430`) to return a tuple `(scores, unscored)`.
  `run_once` does `scores, unscored = await self._score(fetched, sys_meta)` at `:229` and then calls
  `self._warn_unscored(...)` (`:230`, defined `:365`). A `_score` mock that returns a bare dict makes `run_once` fail
  to unpack, so every mock here returns `(scores, [])`.
- The force DELETE is at `:210-216`, `_already_emitted` at `:391-397`, `_emit_signal`'s `NOT_FOUND` →
  `_SystemWriteRejected` at `:578-582`, and its other errors → `None` at `:583-584`.
- Test harness:
  - `_identity_loop(overrides, author, ingest_responses)` is at `tests/test_fundsignal_loop.py:586-602`. It is built
    on `RecordingStub` (`tests/conftest.py:90-117`), whose responses may be a value, an exception, or a function of
    the request (`isinstance(resp, types.FunctionType)`, `:108`).
  - `_rpc_error` is at `:580-583`, and `loop._db` comes from `_make_loop` (`:47-70`, `_db.*` mocks at `:58-60`).
  - Existing `test_already_emitted_skips_fetch_and_emit` (`:99`) stubs `fetch` rows as `{"symbol": ...}` only
    (`:102`).
  - 246's `_emitted_inserts(loop)` (`:603`) reads `loop._db.fetchrow.await_args_list`, so it only works on the
    `AsyncMock` `_db`. The `_EmittedTable` tests assert on `table.rows` instead.
- Real Postgres:
  - The session fixture `local_pg` (`tests/conftest.py:375`) yields a DSN. It skips locally and fails under
    `CI=true`. A local PostgreSQL 16 at `/usr/lib/postgresql/16` is found by its glob.
  - The marker is `real_pg` (`pyproject.toml:33`), and `asyncio_mode = "auto"` (`pyproject.toml:32`).
  - Pool precedent: `asyncpg.create_pool(dsn, min_size=size, max_size=size, statement_cache_size=0)`
    (`tests/test_read_budget_real_pg.py:25-28`), with `pytestmark = pytest.mark.real_pg` (`:20`). That file imports
    helpers from another test module (`from tests.test_analysis_servicer import ...`, `:18`).
  - Schema: `migrations/003_fundsignal_runs.up.sql` and `migrations/004_fundsignal_emitted.up.sql`, both
    `CREATE TABLE IF NOT EXISTS`. `fundsignal_emitted.run_id` REFERENCES `fundsignal_runs(run_id)`
    (`004...up.sql:13`).
  - **Not found:** no existing test applies migration SQL files, and no stateful fake of `fundsignal_emitted` exists
    (recon.md:226). Both are created here.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-5, AC-7`

**Instructions**:
1. **Inline fake (C-13: single consumer, kept in `test_fundsignal_loop.py`).** Add `class _EmittedTable`. It holds
   `rows: dict[(symbol, source, as_of_date)] -> {"score", "direction", "run_id", "signal_id"}` and `runs: list` and
   exposes `async fetch / fetchrow / execute(sql, *args)`. These honour **exactly the predicates present in the SQL
   text**, so the fake tracks both the pre-fix and the post-fix statements:
   - `fetchrow` with `INSERT INTO analysis.fundsignal_emitted`: insert if the key is absent and return
     `{"symbol": symbol}`; otherwise return `None`.
   - `fetch` with `FROM analysis.fundsignal_emitted`: return `[{"symbol": s, "score": r["score"]}]` for the matching
     `source`/`as_of_date`. Both keys are returned, so the fake works before and after Step 6.
   - `execute` with `UPDATE analysis.fundsignal_emitted`: set `signal_id=args[3]`. When the SQL contains `run_id=$5`,
     also require `row["run_id"] == args[4]`; when it contains `signal_id IS NULL`, also require the row's
     `signal_id is None`.
   - `execute` with `DELETE FROM analysis.fundsignal_emitted`: if the SQL contains `symbol=$1`, delete the one key
     under the predicates present (`signal_id IS NULL`, `run_id=$4`). Otherwise, delete every row for
     `source`/`as_of_date` (the force path).
   - Any other SQL (`analysis.fundsignal_runs`) is appended to `runs` and returns `"OK"`.
   - An optional `fail_delete=True` flag makes the per-symbol DELETE raise `RuntimeError`.
2. Add `_fake_loop(scores, ingest)`. It calls `loop = _identity_loop(ingest_responses={"IngestSignal": ingest})`,
   sets `loop._db = _EmittedTable()` (or a passed-in shared table) and
   `loop._score = AsyncMock(return_value=(scores, []))`. The tuple is required by 246's `(scores, unscored)` return.
   `ingest` may be a function of the request that raises for some symbols and returns
   `SimpleNamespace(signal_id=..., deduplicated=...)` for others.
3. Update `test_already_emitted_skips_fetch_and_emit` (`:102`) to stub rows as
   `{"symbol": "AAPL", "score": 0.5}` / `{"symbol": "MSFT", "score": 0.5}`. Step 6 reads `r["score"]`.
4. Add `class TestEmitAccounting` (feature 260). Every test asserts on `table.rows` and on the summary:
   - `test_ac1_failed_emit_is_retried_same_day`:
     - Run 1 uses `{"AAPL": 0.85}` with `IngestSignal` = `_rpc_error(UNAVAILABLE)`.
     - Run 2 shares the same table and uses a healthy `SimpleNamespace(signal_id=777)`.
     - Assert run 2 called `IngestSignal` once for `AAPL`, and `rows[("AAPL","fundamentals",date)]["signal_id"] == 777`.
     - RED today: run 2 skips AAPL.
   - `test_ac2_signals_emitted_counts_accepted_only`:
     - Scores are `{"AAPL": 0.85, "MSFT": 0.90}`. Ingest raises UNAVAILABLE for `AAPL` and returns `signal_id=5` for
       `MSFT`.
     - Assert `summary.signals_emitted == 1`, there is no AAPL row, and the MSFT row has `signal_id == 5`.
   - `test_ac3_abort_leaves_no_orphan_claim`:
     - Use `{"AAPL": 0.85}` with NOT_FOUND.
     - Assert `summary.status == "failed"` and that no row with `signal_id is None` exists for AAPL.
   - `test_ac5_abort_keeps_confirmed_rows`:
     - Scores are `{"AAPL": 0.85, "MSFT": 0.90}`. Ingest returns `signal_id=501` for `AAPL` and NOT_FOUND for `MSFT`
       (sorted order: AAPL first, per the @AC-5 description).
     - Assert `status == "failed"`, `signals_emitted == 1`, the AAPL row has `signal_id == 501`, and there is no MSFT
       row.
   - `test_ac7_confirmed_rows_skip_fetch` (PRESERVE guard, green on the pre-fix tree):
     - Pre-seed confirmed rows for AAPL and MSFT on today's date: `as_of_date = datetime.now(UTC).date()`, matching
       `fundsignal_loop.py:172`.
     - Assert `GetFundamentalsMulti.assert_not_called()`, `loop._ingest.of("IngestSignal") == []` and
       `signals_emitted == 0`.
   - `test_confirm_is_scoped_to_own_run_id`:
     - The ingest function rewrites the AAPL row's `run_id` to `"other-run"` (a concurrent force re-claim) and then
       returns `signal_id=9`.
     - Assert the row keeps `signal_id is None` and `run_id == "other-run"`, and `signals_emitted == 1`.
     - RED today: the unscoped UPDATE writes 9.
   - `test_release_failure_is_swallowed_and_abort_still_reported`:
     - Use `_EmittedTable(fail_delete=True)` with NOT_FOUND.
     - Assert `summary.status == "failed"` and exactly one ERROR alert (`_alert_severities`, `:609`).
   - `test_cancelled_emit_releases_claim`:
     - The ingest function raises `asyncio.CancelledError`.
     - Assert `pytest.raises(asyncio.CancelledError)` around `run_once`, and that the AAPL row is gone.
   - `test_crash_orphan_skipped_then_recovered` (PRESERVE carve-out, design Open Risks; `fails.md:2689-2691`):
     - Pre-seed a NULL row for AAPL with `run_id="crashed-run"`.
     - A non-force run does not call `IngestSignal` for AAPL and leaves the row untouched.
     - A `force=True` run then emits AAPL and confirms it with its own `run_id`.
     - Separately, a NULL row seeded only for `as_of_date - timedelta(days=1)` does not block today's run.
5. **Real SQL (C-08).** Create `tests/test_fundsignal_emitted_real_pg.py` with `pytestmark = pytest.mark.real_pg`:
   - An async fixture builds `asyncpg.create_pool(local_pg, min_size=1, max_size=1, statement_cache_size=0)` and runs
     `CREATE SCHEMA IF NOT EXISTS analysis`. It then executes the text of `migrations/003_fundsignal_runs.up.sql` and
     `migrations/004_fundsignal_emitted.up.sql`, read from `pathlib.Path(__file__).resolve().parents[1] / "migrations"`.
     It ends with `TRUNCATE analysis.fundsignal_emitted, analysis.fundsignal_runs`.
   - Import `_identity_loop` and `_rpc_error` from `tests.test_fundsignal_loop`. These are imported, not copied, so
     no second inline copy exists (C-13). Set `loop._db = pool` and
     `loop._score = AsyncMock(return_value=(scores, []))` (tuple, per 246).
   - `test_failed_emit_releases_then_reclaims_and_confirms` (@AC-1): run 1 gets UNAVAILABLE. Assert
     `SELECT count(*) FROM analysis.fundsignal_emitted` is 0. Run 2 is healthy (`signal_id=777`). Assert the row's
     `signal_id == 777` and that `run_id` equals run 2's `summary.run_id`.
   - `test_confirm_does_not_overwrite_a_foreign_run_claim`:
     - Insert a second `analysis.fundsignal_runs` row (for the FK).
     - The ingest function runs `UPDATE analysis.fundsignal_emitted SET run_id=<that uuid>` through the pool and then
       returns `signal_id=9`.
     - Assert `signal_id IS NULL` on the row afterwards.
   - `test_abort_deletes_only_the_unconfirmed_claim` (@AC-5 at the SQL level): AAPL is accepted, MSFT gets NOT_FOUND.
     Assert exactly one row remains (AAPL, non-NULL `signal_id`).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -k "TestEmitAccounting or test_already_emitted" -q
# RED (pre-Step-4): test_ac1, test_ac2, test_ac3, test_ac5, test_confirm_is_scoped_to_own_run_id and
# test_cancelled_emit_releases_claim fail; test_ac7, test_crash_orphan_* and test_release_failure_* pass (guards)
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_emitted_real_pg.py -m real_pg -q
# RED with a local PostgreSQL (XSTOCKSTRAT_PG_BIN); skipped without one locally, run in CI
grep -n "from tests.test_fundsignal_loop import\|conftest" tests/test_fundsignal_emitted_real_pg.py   # C-13: imports, no copy
# Coverage (B2): no --cov-fail-under here, since this step is RED by design; the paired Step 4 carries --cov-fail-under=40
```

---

### Step 4 — service: release the claim on any unconfirmed exit; scope the confirm; count accepted only

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Claim INSERT (`:247-258`): **unchanged**. It is the in-flight fence against the lock-less manual
  `RunFundamentalsScan` (`app/handlers/servicer.py:3812`; the loop takes `self._lock` at `fundsignal_loop.py:139-145`).
- `signal_id = await self._emit_signal(...)` is at `:261-263`, the unscoped UPDATE at `:264-272`, and the
  unconditional `emitted += 1` at `:273` (re-spec 2026-10-29, rev 2). This block runs after 246's unscored filtering
  (`:229-230`); unscored symbols never reach it, so the two changes do not conflict.
- `except _SystemWriteRejected` → `_abort_cycle` is at `:274-282`.
- Release SQL precedent: the force DELETE `DELETE FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2`
  at `:211-215`, issued through `self._db.execute`.
- Best-effort log-and-swallow precedent: `_emit_ledger` / `_emit_warning`, which catch `except Exception as e:  # noqa: BLE001`
  (`:633`, `:663`).
- The module docstring at `:9` says "(ingest's ``IngestSignal`` does not dedup)". This is stale: ingest dedups per
  `(user_id, source, symbol, direction)` inside one transaction (`services/xstockstrat-ingest/app/handlers/servicer.py:1017`,
  `signal_dedup_claims` INSERT at `:1041`, conflict key at `:1045`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a private helper next to `_already_emitted`:
   ```python
   async def _release_claim(self, symbol, source, as_of_date, run_id):
       try:
           await self._db.execute(
               "DELETE FROM analysis.fundsignal_emitted WHERE symbol=$1 AND source=$2 "
               "AND as_of_date=$3 AND signal_id IS NULL AND run_id=$4::uuid",
               symbol, source, as_of_date, run_id,
           )
       except Exception as e:  # noqa: BLE001 - never mask the exit that triggered the release
           log.warning("fundsignal: claim release failed for %s: %s", symbol, e)
   ```
   It catches `Exception` only, never `BaseException`, so `CancelledError` still propagates (PLAT-N1).
2. Replace `:261-273` (from the `_emit_signal` call through `emitted += 1`) with:
   ```python
   confirmed = False
   try:
       signal_id = await self._emit_signal(...)  # args as today (Step 6 adds valid_anchor)
       if signal_id is not None:
           await self._db.execute(
               "UPDATE analysis.fundsignal_emitted SET signal_id=$4 "
               "WHERE symbol=$1 AND source=$2 AND as_of_date=$3 "
               "AND run_id=$5::uuid AND signal_id IS NULL",
               symbol, source_slug, as_of_date, signal_id, run_id,
           )
           confirmed = True
           emitted += 1
   finally:
       if not confirmed:
           await self._release_claim(symbol, source_slug, as_of_date, run_id)
   ```
   - `confirmed`/`emitted` are set once the UPDATE has executed, whether or not it matched a row.
   - A `deduplicated=true` response that carries a `signal_id` counts (`fails.md:2627-2640`).
   - The success path adds no DB round-trip (C-18).
3. The `except _SystemWriteRejected` block (`:274-282`) is unchanged apart from Step 2's `deferred_count`.
   `_SystemWriteRejected` still propagates out of the `finally` into it, so earlier confirmed rows stay (@AC-5).
4. Correct the stale docstring clause on line `:9`. Say that the `analysis.fundsignal_emitted` claim guards re-emits:
   a NULL `signal_id` marks an in-flight claim that is released when the emit fails. Drop the "does not dedup"
   claim. No new inline comment is needed beyond the helper's `noqa` justification.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q   # GREEN: all Step 3 tests + existing
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_emitted_real_pg.py -m real_pg -q   # GREEN where PostgreSQL is available
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "signal_id IS NULL" services/xstockstrat-analysis/app/engine/fundsignal_loop.py   # release DELETE + scoped confirm
```

---

### Step 5 — test: retry direction stability and the mode-dependent `valid_until` anchor (RED)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_map_directions(scores, buy_quantile, sell_quantile)` is at `fundsignal_loop.py:505-521` (re-spec 2026-10-29, rev 2).
  Its cuts come from `sorted(scores.values())` (`:510`). `_quantile` is at `:667-676`: with a single value,
  `buy_cut == sell_cut`, so `s >= buy_cut` → `"buy"` (`:515`).
- The `run_once` call `directions = self._map_directions(scores, buy_q, sell_q)` is at `:234`. The quantile defaults
  are `0.80`/`0.20` (`:231-232`).
- `_emit_signal` is at `:556`: `now = datetime.now(UTC)` (`:557`) and
  `valid_until.FromDatetime(now + timedelta(days=valid_days))` (`:561`). `valid_days` defaults to 90 (`:236`).
- **Feature 246 (merged):** `_score` returns `(scores, unscored)` (def `:430`, unpacked at `:229`), so the
  `_fake_loop` `_score` mock returns `(scores, [])`, never a bare dict.
- 246's `TestUnscoredSymbols.test_ac1_dataless_symbols_not_scored_ranked_or_emitted` wraps `_map_directions` in a spy
  and unpacks `(scores, *_), _kw = spy.call_args` (`tests/test_fundsignal_loop.py:814-831`). It stays compatible with
  an added `reference_scores=` keyword.
- `as_of_date = datetime.now(UTC).date()` (`:172`). The module imports `from datetime import UTC, datetime, timedelta`
  (`:19`). Existing tests monkeypatch module attributes, e.g. `monkeypatch.setattr(fundsignal_module.random, "uniform", ...)`
  (`tests/test_fundsignal_loop.py:547`).
- `TestScoreDirection.test_quantile_buckets` (`:234-240`) calls `_map_directions` with keyword args
  (`buy_quantile=0.80, sell_quantile=0.20`, `:237`). It stays compatible with the added `reference_scores=()` default
  and must stay green.
- Recorded requests: `loop._ingest.of("IngestSignal")` returns `(name, request, metadata)` tuples
  (`tests/conftest.py:116-117`). The request's `signal.valid_until` is a protobuf `Timestamp`.
- Contract doc: `analysis.fundsignal.valid_days` reads "`valid_until` = run date + this"
  (`services/xstockstrat-analysis/CLAUDE.md:513`).

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9, AC-10`

**Instructions**:
1. Add an inline fixed clock for this class (single consumer, C-13). `class _FixedClock(datetime)` gets
   `@classmethod now(cls, tz=None)` returning `datetime(2026, 10, 21, 15, 30, tzinfo=UTC)`. Each test applies it
   with `monkeypatch.setattr(fundsignal_module, "datetime", _FixedClock)`. Reuse Step 3's `_EmittedTable` and
   `_fake_loop` (whose `_score` mock returns `(scores, [])`, per 246).
2. Add `class TestRetryStability` (feature 260):
   - `test_ac8_lost_response_retry_resends_identical_signal`:
     - Run 1 uses `{"AAPL": 0.85, "MSFT": 0.90}`. Ingest raises UNAVAILABLE for AAPL and returns `signal_id=11` for
       MSFT.
     - Run 2 uses `{"AAPL": 0.85}` on the same table (to_process = `[AAPL]`), and ingest returns
       `SimpleNamespace(signal_id=10, deduplicated=True)`.
     - Assert the two AAPL `IngestSignal` requests have equal `direction`, `conviction` and `valid_until`.
     - Assert `valid_until.ToDatetime(tzinfo=UTC) == datetime(2027, 1, 19, tzinfo=UTC)`.
     - Assert run 2 `signals_emitted == 1` and that the AAPL row has `signal_id == 10`.
     - RED today: `valid_until` is `2027-01-19T15:30Z`, and run 1 vs run 2 direction can differ.
   - `test_ac9_one_symbol_retry_keeps_day_wide_direction`:
     - Pre-seed confirmed rows `MSFT 0.90`, `NVDA 0.70` and `GOOG 0.50` for today.
     - The scores mock returns `({"AAPL": 0.10}, [])`. Use override universe `["AAPL", "GOOG", "MSFT", "NVDA"]` and the
       default quantiles.
     - Assert exactly one `IngestSignal`, for AAPL, with `direction == "sell"`.
     - RED today: `"buy"`.
   - `test_map_directions_reference_scores_set_the_cuts`: a pure unit test.
     `_map_directions({"AAPL": 0.10}, 0.80, 0.20, reference_scores=[0.90, 0.70, 0.50]) == {"AAPL": "sell"}`.
     Also check that the default (no `reference_scores`) still returns `{"AAPL": "buy"}`.
   - `test_ac10_force_keeps_now_anchored_valid_until` (PRESERVE pin, green today, mandatory):
     - Pre-seed a confirmed AAPL row and run `run_once(force=True, override_symbols=["AAPL"])`.
     - Assert `IngestSignal` was called for AAPL with
       `valid_until.ToDatetime(tzinfo=UTC) == datetime(2027, 1, 19, 15, 30, tzinfo=UTC)`, which is `!=` the midnight
       anchor.
3. Design's Open Risks are covered in the scenarios' descriptions rather than by tests: the boundary flip and the
   dedup conditions (`dedup_window_hours > 0`, unchanged conviction) are ingest/runtime conditions that this unit
   suite does not exercise.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -k "TestRetryStability or TestScoreDirection" -q
# RED (pre-Step-6): test_ac8 (valid_until 15:30 anchor), test_ac9 ("buy"), test_map_directions_reference_scores
# (TypeError: unexpected keyword) fail; test_ac10 and test_quantile_buckets pass
# Coverage (B2): no --cov-fail-under here, since this step is RED by design; the paired Step 6 carries --cov-fail-under=40
```

---

### Step 6 — service: day-wide direction cuts and the mode-dependent `valid_until` anchor

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_already_emitted` (`:391-397`, SELECT `:393`, re-spec 2026-10-29, rev 2) runs
  `SELECT symbol FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2` and returns a set. Its only caller
  is `:218-219`.
- The skip predicate is `to_process = [s for s in universe if s not in already]` (`:219`). It stays **unchanged**:
  every existing row, NULL or confirmed, is still skipped. Design rejected narrowing it to
  `signal_id IS NOT NULL`, and that must not be re-introduced.
- `004_fundsignal_emitted.up.sql:11`: `score numeric`, which is nullable. asyncpg returns `numeric` as `Decimal`.
- `_map_directions` is at `:505-521` and its call at `:234`. `_emit_signal(self, source, symbol, direction, conviction, valid_days, metadata)`
  is at `:556`, with `now` at `:557`, the `valid_until` computation at `:560-561` and its only call at `:261-263`.
- After 246, unscored symbols write no `fundsignal_emitted` row and are absent from `scores`, so `reference_scores`
  comes only from claimed rows. This matches the design.
- `as_of_date` is at `:172`, and `force` is a `run_once` parameter (`:169`).
- Under Step 5's `monkeypatch.setattr(fundsignal_module, "datetime", _FixedClock)`, `datetime.combine(...)` resolves
  to the inherited classmethod and returns a tz-aware `_FixedClock` instance (checked on Python 3:
  `_FixedClock.combine(date(2026, 10, 21), time.min, UTC)` gives `2026-10-21 00:00:00+00:00`), so `valid_anchor` stays
  a usable aware datetime in both branches. If `FromDatetime` or the arithmetic misbehaves on the subclass, log it in
  the Deviation Log rather than dropping the patch.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Imports.** Change `:19` to `from datetime import UTC, datetime, time, timedelta`.
2. **`_already_emitted`.** Change the SELECT to `SELECT symbol, score FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2`
   and return `{r["symbol"]: (None if r["score"] is None else float(r["score"])) for r in rows}`.
   - This is still one query (C-18).
   - The membership test at `:219` works unchanged on the dict.
3. **`run_once`.**
   - Initialise `prior = {}` before the `if force:` branch (`:210`), and rename `already` to `prior` in the else
     branch (`:218-219`).
   - Change `:234` to:
     ```python
     directions = self._map_directions(
         scores, buy_q, sell_q, reference_scores=[v for v in prior.values() if v is not None]
     )
     ```
   - Force runs pass an empty reference, since their rows were deleted first.
4. **`_map_directions`.**
   - Signature: `_map_directions(scores, buy_quantile, sell_quantile, reference_scores=())`.
   - Cuts are computed over `sorted([*scores.values(), *reference_scores])`. Directions are still mapped only for
     `scores`.
   - Update the docstring: the cross-sectional quantile is computed over the run's scores plus the day's stored
     scores.
5. **Anchor.** Right after `as_of_date` (`:172`), add:
   ```python
   # Force must stay now-anchored or a same-day force re-emit becomes an ingest dedup no-op (@AC-10);
   # non-force is date-anchored so a lost-response retry resends an identical valid_until (@AC-8).
   valid_anchor = datetime.now(UTC) if force else datetime.combine(as_of_date, time.min, UTC)
   ```
   This is the one inline constraint comment design.md allows (≤2 lines).
6. **`_emit_signal`.**
   - Add a `valid_anchor` parameter after `valid_days` and set
     `valid_until.FromDatetime(valid_anchor + timedelta(days=valid_days))`.
   - `valid_from` stays `now`.
   - Pass `valid_anchor` at the call site, which Step 4 placed inside the `try`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py tests/test_owner_header_guard.py -q   # GREEN
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "valid_anchor\|reference_scores\|SELECT symbol, score" services/xstockstrat-analysis/app/engine/fundsignal_loop.py
grep -n "signal_id IS NOT NULL" services/xstockstrat-analysis/app/engine/fundsignal_loop.py   # expect no match (rejected narrowing)
```

---

### Step 7 — proto: add `"partial"` to the `FundamentalsScanSummary.status` comment

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass;
xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `packages/proto/analysis/v1/analysis.proto:564`:
  `string status = 6;               // "completed" | "budget_deferred" | "failed"` (in `message FundamentalsScanSummary`, `:558`).

**TDD**: `N/A (comment-only proto edit — no wire change)`

**Covers**: —

**Instructions**:
1. Change the comment at `:564` to `// "completed" | "budget_deferred" | "partial" | "failed"`. Keep the field name,
   number and type unchanged.
2. Keep it a `string`, not an enum (C-04): the field is existing wire, and converting it is out of scope for this
   SEV-2 comment fix.

**Verification**:
```bash
git fetch origin main-dev && cd packages/proto && buf lint && buf breaking . --against '../../.git#branch=origin/main-dev,subdir=packages/proto'   # compare to trunk, not the branch itself
```

---

### Step 8 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis.ts` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/analysis/v1/analysis_pb.d.ts` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass;
xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias (inherited
from Step 7)

**Codebase Evidence**:
- `grep -rl '"completed" | "budget_deferred" | "failed"' packages/proto/gen` lists exactly the five files above. The
  generated comment is copied into Go and TS. Python `_pb2` stubs carry no field comments.
- The `proto-freshness` CI job enforces this (root `CLAUDE.md` § Proto Contract Governance; C-09).

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root. If the host toolchain is unavailable, see
   `docs/runbooks/codegen-toolchain-host-setup.md`.
2. Stage only the regenerated files. If the diff touches anything besides the comment line in the five files, stop
   and log it: that means the plugin pins have drifted (root `CLAUDE.md` § Version Bump Workflow).

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/
grep -rn '"budget_deferred" | "partial" | "failed"' packages/proto/gen | wc -l   # expect 5
```

---

### Step 9 — docs: analysis CLAUDE.md, MCP runbook, merge order, teardown audit

**Status**: `pending`
**Service**: `docs/` + `services/xstockstrat-analysis/CLAUDE.md`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/roadmap/features/merge-order.md` — verify only (row already present at `:81`; edit only if it is missing)

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:122`, **Cache-only FMP discipline**: "when the budget is exhausted the run
  is marked `budget_deferred`".
- `services/xstockstrat-analysis/CLAUDE.md:123`, **Idempotency** (re-spec 2026-10-29; rewritten by the 246 merge):
  "analysis owns the producer's day guard in `analysis.fundsignal_emitted` (PK `(symbol, source, as_of_date)`), and
  ingest also dedups per owner (`ingest.signal_dedup_claims`, …). A same-day re-run emits nothing new for
  already-emitted symbols, but re-fetches unscored symbols (they write no row), bounded by
  `analysis.fundsignal.daily_call_budget`; `force=true` re-emits by clearing the day's rows first." The stale
  "does **not** dedup" text is already gone, so the bullet is extended, not corrected.
- `services/xstockstrat-analysis/CLAUDE.md:513`, `valid_days`: "`valid_until` = run date + this". This is already
  correct for non-force runs after Step 6.
- `docs/runbooks/mcp-tools.md:846`: `` `status` is `"completed"` | `"budget_deferred"` | `"failed"`. ``
- `docs/roadmap/features/merge-order.md:81` already holds the 260-vs-246 row: "Same file and test helpers
  (`analysis/app/engine/fundsignal_loop.py`, `tests/test_fundsignal_loop.py`). 246 lands first; 260 rebases". 246 is
  merged to `main-dev` and this branch has merged `main-dev`, so the soft dependency is satisfied.
- Pass-through consumer sites (C-14): `services/xstockstrat-agent/app/client.py:1729` (`"status": resp.status`) and
  `services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx:101`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Analysis `CLAUDE.md` `:122`.** Add: a `GetFundamentalsMulti` chunk that raises counts its symbols in
   `deferred_count` and ends the run `partial`. `partial` wins over `budget_deferred`, and one warning names both.
2. **Analysis `CLAUDE.md` `:123`.** Extend the bullet in place, merging with 246's text. Keep its existing
   statements, including the unscored-symbol clause ("re-fetches unscored symbols (they write no row)") and the
   `force=true` clause, and add:
   - Ingest's per-owner dedup applies per `(user_id, source, symbol, direction)` only while conviction and
     `valid_until` are unchanged inside `ingest.signals.dedup_window_hours`.
   - A NULL `signal_id` is an in-flight claim. A failed, aborted or cancelled emit releases it (run_id-scoped
     DELETE), so the symbol retries the same day. Only accepted signals count in `signals_emitted`.
   - Non-force `valid_until` = `as_of_date` 00:00 UTC + `valid_days`, so a lost-response retry dedups at ingest.
     `force=true` keeps `now + valid_days` and re-emits fresh.
   - A crash between claim and confirm leaves a NULL row. That row is skipped until the next `as_of_date` or a
     `force=true` run. A release DELETE that itself fails is logged and swallowed (`_release_claim`), leaving the
     same NULL row with the same recovery.
   - Direction cuts include the day's stored scores. This also applies to a `budget_deferred` resume and to a
     non-force `override_symbols` scan.
3. **`docs/runbooks/mcp-tools.md:846`.** Change it to `` `status` is `"completed"` | `"budget_deferred"` | `"partial"` | `"failed"`. ``
   and add one sentence: `partial` = a fetch chunk failed and its symbols are in `deferred_count`.
4. **`merge-order.md`.** Confirm the existing 260-vs-246 row at `:81` is present. Leave it unchanged: its wording
   differs from the original spec text, but it records the same soft dependency, which is now satisfied (246 is merged).
   Append the row only if it is missing:
   `` | `fix-fundsignal-emit-accounting` (260) | `fix-fundsignal-neutral-score` (246) | Same file and test helpers (`analysis/app/engine/fundsignal_loop.py`, `tests/test_fundsignal_loop.py`). 246 lands first; 260 rebases | No | ``.
5. **Teardown (root `CLAUDE.md` § Teardown).** Run `/context-forge:context-constitution refresh` scoped to
   `services/xstockstrat-analysis/` and `docs/runbooks/mcp-tools.md`, and fix any grounded drift it reports. If the
   plugin is unavailable, re-read both touched docs against the code by hand. Record in the PR body both that the
   plugin was unavailable and what you reconciled.

**Verification**:
```bash
grep -n "partial" services/xstockstrat-analysis/CLAUDE.md docs/runbooks/mcp-tools.md
grep -n "does \*\*not\*\* dedup" services/xstockstrat-analysis/CLAUDE.md   # expect no match (already true after the 246 merge)
grep -n "unscored symbols" services/xstockstrat-analysis/CLAUDE.md   # 246's clause kept
grep -n "signal_id IS NULL\|run_id-scoped\|00:00 UTC" services/xstockstrat-analysis/CLAUDE.md   # 260's additions present
grep -n "fix-fundsignal-emit-accounting" docs/roadmap/features/merge-order.md
grep -n '"status": resp.status' services/xstockstrat-agent/app/client.py && grep -n "summary.status" services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx   # C-14 pass-through intact
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-10-29, Step 1 (minor, no scope change):** test-file line drift. `_rpc_error` is at
  `tests/test_fundsignal_loop.py:584` (spec `:528`), because Step 1's own `TestFailedChunk` class is inserted above it;
  the spec's other Step 1 citations matched. `_fail_first_chunk` is a `@staticmethod` on `TestFailedChunk` (the spec's
  "local helper"), and it calls the module-level `_rpc_error` at run time, so no conftest fixture is added (C-13).
  RED is as the spec predicted: an unpack `ValueError` (3 values, 4 expected), `'completed' == 'partial'` (AC-4) and
  `'budget_deferred' == 'partial'` (AC-6). The other 56 tests in the file pass.
- **2026-10-29, Step 2 (minor, no scope change):** two verification/format notes. (a) The `run_once` call
  `fetched, deferred, failed, calls_spent = await self._paced_fetch(to_process, budget, metadata)` is 101 columns, so
  `ruff format` wraps its arguments over three lines; the call is otherwise as specced. (b) The coverage command ran
  as `uv run --no-sync pytest --cov=app --cov-fail-under=40 -q -m "not real_pg"`. The 4 `real_pg` tests start a
  throwaway PostgreSQL through `tests/conftest.py` `local_pg`, and starting a database is forbidden here (HARD
  CONSTRAINT); CI runs them. **Disposition**: CI-equivalent fallback. Result: 1298 passed, 4 deselected, 88.63%.
- **2026-10-29, Step 3 (minor, no scope change):** three test-harness notes. (a) In
  `test_confirm_does_not_overwrite_a_foreign_run_claim` the ingest stub is
  `loop._ingest.IngestSignal = AsyncMock(side_effect=...)`, not a `RecordingStub` response function. `RecordingStub`
  calls a response function synchronously (`tests/conftest.py:108-109`), and this one has to `await` the pool's
  `UPDATE`. (b) Three small inline helpers support the spec's tests and live in `test_fundsignal_loop.py` (C-13,
  single consumer): `_EmittedTable.seed`, `_ingest_by_symbol` (a per-symbol IngestSignal response) and
  `_ingested_symbols`. (c) The `real_pg` file was collected (3 tests) but not run: `local_pg` starts a throwaway
  PostgreSQL, and starting a database is forbidden here (HARD CONSTRAINT). CI runs it under `CI=true` and it is RED
  until Step 4. **Disposition**: CI-equivalent fallback, as in Step 2. Before committing, the fake was checked against
  the post-fix SQL by applying Step 4's specced change temporarily, which gave 68 passed. That change was reverted and
  is not part of this commit.
- **2026-10-29, Step 4 (minor, no scope change):** line drift and one verification note. (a) On the branch tree
  the `_emit_signal` call through `emitted += 1` was `fundsignal_loop.py:258-270` (spec `:261-273`), the
  `except _SystemWriteRejected` block `:271-279` (spec `:274-282`) and `_already_emitted` `:386-392`; each site was
  found by its SQL text or symbol and changed as specced. `_release_claim` follows `_already_emitted`. (b) The
  `real_pg` verification command was run and gave 3 passed. Its `local_pg` fixture started a throwaway PostgreSQL
  cluster on a Unix socket under `/tmp` and stopped it at session end; no postgres process remains. Steps 2-3 had
  skipped this command under the "never start a database" HARD CONSTRAINT, so this run departs from that
  disposition. It touched no shared, staging or production database. The other commands ran as specced:
  `test_fundsignal_loop.py` 68 passed; coverage `-m "not real_pg"` 1307 passed, 7 deselected, 88.72%; ruff clean.
