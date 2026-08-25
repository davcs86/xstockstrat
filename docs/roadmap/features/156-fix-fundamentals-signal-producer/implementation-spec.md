# Implementation Spec: fix-fundamentals-signal-producer

**Status**: `pending`
**Created**: 2026-08-25
**Feature**: `docs/roadmap/features/156-fix-fundamentals-signal-producer/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-fundamentals-signal-producer`

---

## Execution Summary

The core fix lives in `xstockstrat-analysis`: a new durable, crash-safe schedule row
(`analysis.fundsignal_schedule`) plus a rewritten `run_forever` that seeds the row at boot, sleeps a
bounded startup jitter, computes-sleep-until-due (no polling), and advances `blocked_until_ms`
**only after** a cycle completes (retry cadence on a caught error). Two new config keys tune the
jitter and retry. The already-existing admin-scoped `RunFundamentalsScan` RPC is then surfaced
through two consumer surfaces (C-14): a new MCP agent tool (`run_fundamentals_scan`) and a new
admin-only **/config-ui** "Run fundamentals scan" card. No proto change (the RPC + messages already
exist).

Order: migration and config-key registration land first (they are prerequisites the analysis service
step reads). The analysis scheduler rewrite + its unit tests are the heart of the fix. The agent and
UI surfaces are independent of each other and of the analysis rewrite (they wrap an RPC that already
exists), so they can execute in any order after the analysis code.

### Scenario Coverage (C-15)

| Scenario | Covered by step |
|---|---|
| AC-1 first cycle runs promptly on fresh deploy | Step 4 |
| AC-2 redeploy within interval does not reset schedule | Step 4 |
| AC-3 hard crash mid-cycle re-runs promptly | Step 4 |
| AC-4 caught cycle error retries after retry_seconds | Step 4 |
| AC-5 disabled producer neither runs nor advances schedule | Step 4 |
| AC-6 manual scan does not contaminate scheduled cadence | Step 4 |
| AC-7 startup jitter is bounded | Step 4 |
| AC-8 MCP tool triggers for admin, rejects non-admin | Step 6 |
| AC-9 config-ui trigger control is admin-gated + nav-reachable | Step 9 |

### Consumer surfaces (C-14)

Both surfaces named in `product-spec.md` § Consumer Surface(s) earn dedicated steps:
- MCP agent tool `run_fundamentals_scan` → Steps 5 (impl) + 6 (test).
- config-ui "Run fundamentals scan" card → Steps 8 (impl) + 9 (test).
The scheduled producer itself stays internal/platform (background loop, no direct surface) — the fix
to it (Steps 1–4) is the internal half.

## Step Dependencies

- Step 3 (analysis service) requires Step 1 (schedule table exists) and Step 2 (jitter/retry config
  keys registered — read via `get_int_present`).
- Step 4 (analysis test) covers Step 3; both are `red-green required`.
- Step 6 (agent test) covers Step 5; Step 7 (agent docs) may land with Step 5's PR or after — it is
  non-code-bearing.
- Step 9 (UI test) covers Step 8.
- Steps 5–7 and Steps 8–9 have no dependency on Steps 1–4 (they wrap the pre-existing
  `RunFundamentalsScan` RPC) and no dependency on each other.

---

### Step 1 — migration: create `019_fundsignal_schedule`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/019_fundsignal_schedule.up.sql` — create
- `services/xstockstrat-analysis/migrations/019_fundsignal_schedule.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, up+down pair), index correctness;
`xstockstrat-analysis` owner — schema reuse, no new pool (F-06)

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/migrations/ | sort` → highest applied is
  `018_backtest_runs_fill_model.{up,down}.sql`, so `019` is the next free NNN (C-07 / F-01).
- Header/style precedent: `migrations/016_order_snapshots_pnl_patterns.up.sql:1-5`
  (`-- Migration: ...`, `-- Service: xstockstrat-analysis`, `-- Feature ...`).
- Down precedent: `migrations/003_fundsignal_runs.down.sql` (`-- 003_...down.sql` + single
  `DROP TABLE IF EXISTS analysis.fundsignal_runs;`).
- Up precedent (`CREATE TABLE IF NOT EXISTS analysis.<name>` in the `analysis` schema):
  `migrations/003_fundsignal_runs.up.sql:5`.

**TDD**: `N/A (migration — offline structural check only)`

**Covers**: —

**Instructions**:
1. Create `019_fundsignal_schedule.up.sql` with the standard migration comment header (Feature 156)
   (`-- 019_fundsignal_schedule.up.sql` / `-- Service: xstockstrat-analysis` / `-- Feature 156
   (fix-fundamentals-signal-producer): durable, crash-safe schedule for the fundamentals producer
   loop.`), then:
   ```sql
   CREATE TABLE IF NOT EXISTS analysis.fundsignal_schedule (
     job_name         text PRIMARY KEY,
     blocked_until_ms bigint NOT NULL,
     process_name     text,
     updated_at       timestamptz NOT NULL DEFAULT now()
   );
   ```
   Column semantics per `design.md` §1: `blocked_until_ms` = next-due epoch-ms (advanced only after a
   cycle completes); `process_name` = diagnostic last-runner (not load-bearing at `instance_count:1`).
2. Create `019_fundsignal_schedule.down.sql` (`-- 019_fundsignal_schedule.down.sql` header) with
   `DROP TABLE IF EXISTS analysis.fundsignal_schedule;` — the exact inverse of the `.up.sql`.
3. Do NOT edit any existing applied migration (F-01).

**Verification**:
```
ls services/xstockstrat-analysis/migrations/019_fundsignal_schedule.up.sql \
   services/xstockstrat-analysis/migrations/019_fundsignal_schedule.down.sql
```
Then read both: confirm the single `CREATE TABLE ... analysis.fundsignal_schedule` in `.up` has its
inverse `DROP TABLE IF EXISTS analysis.fundsignal_schedule` in `.down`. Offline only — do NOT start a
database (the real apply/rollback runs in CI/deploy).

---

### Step 2 — config: register `startup_jitter_seconds` + `retry_seconds`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed table)
- `docs/patterns/config-governance.md` — modify (§ Per-Feature Registered Keys — feature 062 block)

**Reviewers**: `xstockstrat-analysis` owner — config key naming (`<service>.<category>.<key>`),
default declared in service CLAUDE.md (C-05)

**Codebase Evidence**:
- Existing analysis config table: `services/xstockstrat-analysis/CLAUDE.md:296-307`
  (rows `analysis.fundsignal.enabled` … `analysis.fundsignal.valid_days`).
- Per-feature log block for these keys: `docs/patterns/config-governance.md` § "feature 062 —
  fundamentals signal producer (`xstockstrat-analysis`)" table (rows end at
  `analysis.fundsignal.valid_days`).
- Naming convention `<service>.<category>.<key>` and "defaults declared in each service's CLAUDE.md":
  root `CLAUDE.md` § Config Governance Rules; C-05.
- Presence-aware getter (why not `get_int`): `services/xstockstrat-analysis/app/config/watcher.py:103`
  `def get_int_present(self, key, default)` — the zero-value is a legitimate choice for jitter
  (`0` = no jitter), so `get_int`'s zero-trap is wrong here (mirrors `analysis.opportunity.refresh_hour_utc`
  presence-aware note at `CLAUDE.md`).

**TDD**: `N/A (config — key registration in docs)`

**Covers**: —

**Instructions**:
1. Add two rows to the analysis CLAUDE.md § Config Keys Consumed table (after
   `analysis.fundsignal.valid_days` at `:307`):
   - `| \`analysis.fundsignal.startup_jitter_seconds\` | int | \`30\` | One-shot random delay [0, N] seconds applied once at producer loop entry to stagger concurrent redeploys (feature 156); read presence-aware (\`get_int_present\`) — \`0\` disables jitter. |`
   - `| \`analysis.fundsignal.retry_seconds\` | int | \`300\` | On a caught cycle error, \`blocked_until_ms\` advances by this many seconds (not a full \`run_interval_hours\`), so a transient failure retries in minutes (feature 156); read presence-aware. |`
2. Add the same two rows to the feature-062 block table in `docs/patterns/config-governance.md`
   (after its `analysis.fundsignal.valid_days` row), noting `(feature 156)` in the description.
3. Do NOT change any existing key's `value_type` (fails.md 2026-08-06 — value_type is immutable once
   read); these are net-new keys.

**Verification**:
```
grep -n "startup_jitter_seconds\|retry_seconds" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
```
Confirm both keys appear in both files with type `int` and defaults `30` / `300`.

---

### Step 3 — service: rewrite `run_forever` with durable crash-safe schedule + jitter + retry

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — scheduler correctness, crash-safety (advance after
completion), no look-ahead / determinism, no new pool (F-06)

**Codebase Evidence**:
- The bug: `app/engine/fundsignal_loop.py:96-110` — `run_forever` does
  `await asyncio.sleep(max(1, interval_hours) * 3600)` at `:100` **before** `run_once` at `:108`; the
  `enabled` gate at `:101` is checked *after* the sleep; `self._lock` overlap guard at `:103-106`
  with the `"previous cycle still running — skipping"` log; try/except "never let one bad cycle kill
  the loop" at `:107-110`.
- Constructor pool: `fundsignal_loop.py:72` `self._db = db_pool`; `:79` `self._lock = asyncio.Lock()`.
  Reuse `self._db` — no new pool (F-06).
- Self-seed upsert precedent: `app/engine/pnl_pattern_consumer.py:397-401`
  (`INSERT INTO analysis.ledger_stream_cursor (...) VALUES ($1,$2) ON CONFLICT (consumer) DO UPDATE ...`)
  — mirror the `ON CONFLICT DO NOTHING` self-seed shape.
- `run_once` is untouched and already idempotent: day-claim `_already_emitted` at `:293-299`, the
  `fundsignal_emitted` `ON CONFLICT DO NOTHING RETURNING` claim inside `run_once` at `:172-183`
  (verified: `INSERT INTO analysis.fundsignal_emitted ... ON CONFLICT (symbol, source, as_of_date) DO
  NOTHING RETURNING symbol`), so an eager boot run that lands the same UTC day is a zero-emit no-op.
- Presence-aware config getter: `app/config/watcher.py:103` `get_int_present`. Existing interval/enable
  reads: `self._cfg.get_int("analysis.fundsignal.run_interval_hours", default=24)` and
  `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)` (currently at `:99`/`:101`).
- Loop is started non-blocking after config snapshot: `app/main.py:161`
  `asyncio.get_event_loop().create_task(fundsignal_loop.run_forever())`; snapshot awaited at
  `main.py:42-50`. No `main.py` change required — the seed/hydrate happens **inside** `run_forever`
  (self-seed precedent), not as a separate best-effort `main.py` hydrate call.
- `md_config_watcher` (2nd watcher, `namespace="marketdata"`) is only for the FMP-gated cap — unrelated
  to scheduling; do not touch it.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Rewrite `run_forever` (`:96-110`) to the durable-schedule shape from `design.md` §1:
   a. **Boot self-seed** (once, before the loop): `await self._db.execute("INSERT INTO
      analysis.fundsignal_schedule (job_name, blocked_until_ms) VALUES ('fundsignal', 0) ON CONFLICT
      DO NOTHING")` — a fresh deploy seeds `0` (immediately due → prompt first cycle, AC-1); an existing
      row keeps its future due-time (redeploy does not reset, AC-2).
   b. **Startup jitter** (once, before the first tick): read
      `jitter = self._cfg.get_int_present("analysis.fundsignal.startup_jitter_seconds", default=30)`
      and `await asyncio.sleep(random.uniform(0, jitter))`. Bound is `[0, jitter]` (AC-7). `import
      random` at module top if absent.
   c. Extract a testable seam `async def _next_sleep_seconds(self) -> float` (or equivalent) that:
      reads `blocked_until_ms` for `job_name='fundsignal'` (via `self._db.fetchrow`/`fetchval`);
      computes `now_ms` **from a single clock source** — use SQL `extract(epoch from now())*1000` or a
      single Python `datetime.now(UTC)` read consistently (design Open Risk: do not mix). If
      `now_ms < blocked_until_ms`, return `(blocked_until_ms - now_ms)/1000` (compute-sleep-until-due,
      no polling). If due, return `0`.
   d. The loop: `sleep_s = await self._next_sleep_seconds()`; if `sleep_s > 0`, `await
      asyncio.sleep(sleep_s)` and `continue`. If due (`0`): check
      `self._cfg.get_bool("analysis.fundsignal.enabled", default=False)` — **false ⇒ do NOT run and
      do NOT advance `blocked_until_ms`** (AC-5), sleep one `run_interval_hours` and `continue` (this
      is the design's accepted disabled-window re-check latency; the manual trigger is the immediate
      "enable then run now" path). Preserve the `self._lock.locked()` skip + `"previous cycle still
      running — skipping"` log.
   e. When enabled and due, run under `async with self._lock:` with the retained try/except
      ("never let one bad cycle kill the loop"). On **success**: advance
      `blocked_until_ms = now_ms + get_int("analysis.fundsignal.run_interval_hours", default=24)*3600*1000`.
      On **caught exception**: advance `blocked_until_ms = now_ms +
      get_int_present("analysis.fundsignal.retry_seconds", default=300)*1000` (retry in minutes, AC-4).
      Write via `UPDATE analysis.fundsignal_schedule SET blocked_until_ms=$1, process_name=$2,
      updated_at=now() WHERE job_name='fundsignal'`, with `process_name = os.environ.get("HOSTNAME")
      or socket.gethostname()` (diagnostic). Advance happens **after** the run — a crash before it
      leaves the row due (AC-3).
2. Do NOT modify `run_once`, `_finish`, `_already_emitted`, or the `fundsignal_emitted` guard — the
   idempotency net stays intact and the manual RPC path (`servicer.RunFundamentalsScan → run_once`)
   never reads/writes `fundsignal_schedule` (AC-6 by construction).
3. `import os` / `import socket` at module top if absent.

**Verification**:
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- Behavior proven by the paired Step 4 tests (red-green). The `service` step's own targeted check:
  `grep -n "fundsignal_schedule\|_next_sleep_seconds\|startup_jitter_seconds\|retry_seconds\|blocked_until_ms" services/xstockstrat-analysis/app/engine/fundsignal_loop.py`
  — confirm the seam, both new config reads, and the schedule read/seed/advance are all present.

---

### Step 4 — test: scheduler unit tests (red-before-green)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify (add a `TestScheduler` class)

**Reviewers**: `xstockstrat-analysis` owner — scheduler determinism, crash-safety assertions

**Codebase Evidence**:
- Reuse module helpers: `tests/test_fundsignal_loop.py:19` `_make_cfg(overrides)` (a `MagicMock` whose
  `get_int/get_bool/get_str/get_float` read from `overrides`), `:43` `_make_loop(overrides)`
  (constructs `FundamentalsSignalLoop` with all stubs `AsyncMock`, `_db.execute/fetch/fetchrow` faked).
  Note: `_make_cfg` currently mocks `get_int`; the test must extend it (or override on the returned
  mock) to also stub `get_int_present` for the new keys — C-13 note below.
- C-13 canonical home is `tests/conftest.py` (holds only the proto-path shim,
  `tests/conftest.py:_setup_gen_path`) — reuse the module-level helpers; promote to conftest only if a
  2nd test file needs them (single consumer today → inline module helpers are compliant).
- Existing test style: `@pytest.mark.asyncio` async cases under classes (`TestIdempotency`,
  `TestBudgetDefer`, …) at `:93`, `:153`, etc.
- Monkeypatch precedent (boot-time fix proved without a real sleep): insights.md 2026-07-29 (feature
  082) + `import app.engine.fundsignal_loop as fundsignal_module` already imported at
  `test_fundsignal_loop.py:16` for monkeypatching module symbols.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7`

**Instructions**:
Add a `TestScheduler` class. Monkeypatch `asyncio.sleep` (via `fundsignal_module.asyncio.sleep` or
`monkeypatch.setattr`) to a no-op / recorder so no real time passes, and stub `_make_cfg` to also
answer `get_int_present`. Extend `_make_loop` (or build a schedule-aware `_db` mock) so
`fundsignal_schedule` reads are controllable. Cases (each must FAIL against the pre-Step-3 tree):
1. **AC-1** — seeded row = `0` (due), `enabled=true`: assert `run_once` is invoked before any
   full-interval sleep, and the boot self-seed `INSERT ... ON CONFLICT DO NOTHING` ran.
2. **AC-2** — schedule row `blocked_until_ms = now_ms + interval` (future): assert `_next_sleep_seconds`
   returns ≈ the remaining time (not a fresh full interval) and `run_once` is NOT called this tick.
3. **AC-3** — row due (past `blocked_until_ms`) simulating a crash that never advanced it: assert the
   tick runs `run_once` promptly (no full-interval wait).
4. **AC-4** — due + `run_once` raises a caught exception: assert the `UPDATE ... blocked_until_ms`
   advances by `retry_seconds*1000` (≈ `now_ms + 300_000`), NOT by `run_interval_hours`.
5. **AC-5** — `enabled=false`, row due: assert `run_once` is NOT called AND no `UPDATE` advances
   `blocked_until_ms` AND the tick does not busy-spin (a sleep was issued).
6. **AC-6** — call `loop.run_once(...)` directly (mirroring `servicer.RunFundamentalsScan`): assert it
   issues NO SQL against `analysis.fundsignal_schedule` (grep the recorded `_db.execute` calls' SQL for
   `fundsignal_schedule` → none), so a manual/dry-run scan cannot move the scheduled due-time.
7. **AC-7** — `startup_jitter_seconds = N`: capture the argument passed to the one-shot startup
   `asyncio.sleep`; assert it is within the closed `[0, N]` interval. Add a paired teeth assertion
   (insights.md 2026-07-27) that `N=0` yields `0` so the bound isn't vacuous.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_fundsignal_loop.py -v \
  && pytest --cov=app --cov-fail-under=40
```
Confirm the new `TestScheduler` cases pass and overall coverage stays ≥ 40%. (`/sdd-execute` captures
the red run against the pre-Step-3 tree first — P-06.)

---

### Step 5 — service: add `run_fundamentals_scan` MCP tool + client wrapper

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (add `run_fundamentals_scan` wrapper)
- `services/xstockstrat-agent/app/tools.py` — modify (register tool + bump the module-docstring count
  from 28→29 and add its enumeration line)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract (name/params/return shape), admin
`x-access-scope` forwarded only by management tools, tool-count parity across inventory surfaces

**Codebase Evidence**:
- Target RPC already exists (no proto change): `packages/proto/analysis/v1/analysis.proto:30`
  `rpc RunFundamentalsScan(RunFundamentalsScanRequest) returns (FundamentalsScanSummary);`. Request
  (`:502-506`): `bool force = 1; bool dry_run = 2; repeated string symbols = 3;`. Response
  `FundamentalsScanSummary` (`:508-516`): `run_id, symbols_processed, signals_emitted, calls_spent,
  deferred_count, status, finished_at` — a clean flat projection (resolves design Open Risk on
  `_finish`→response mapping; the servicer returns exactly this message via
  `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:_finish` returning
  `analysis_pb2.FundamentalsScanSummary(...)`).
- Backend admin gate: `services/xstockstrat-analysis/app/handlers/servicer.py:2717` `RunFundamentalsScan`
  calls `self._has_admin_scope(context)` (`:2723`) → `abort(PERMISSION_DENIED, "admin scope required")`;
  `_has_admin_scope` at `:417-431` reads `int(x-access-scope) & 0x04`. The tool must forward the
  caller's DERIVED scope, never fabricate admin.
- Client wrapper precedent: `app/client.py:1224` `async def set_strategy_live(...)` — imports
  `analysis_pb2, analysis_pb2_grpc` lazily (`:1232`), dials `ANALYSIS_ENDPOINT` (`:21`,
  `grpc.aio.insecure_channel(ANALYSIS_ENDPOINT)`), builds `AnalysisServiceStub`, calls with
  `metadata=_metadata((\"x-user-id\", user_id), (\"x-access-scope\", str(access_scope)))`, projects the
  response to a dict.
- Header propagation (C-03): `app/client.py:58` `_metadata(*extra)` emits the caller trio
  (`x-user-id`/`x-access-scope`/`x-trace-id`) from the per-request caller contextvar, de-duping any
  redundant `extra`. The new call reuses this — no new propagation mechanism.
- Tool registration precedent (admin-gated write): `app/tools.py:978` `trigger_backfill` — decorated
  `@server.tool()`, derives scope via `_caller_access_scope(ctx, "trigger_backfill")` (`:1000`;
  `_caller_access_scope` at `:102`), calls `client.trigger_backfill(..., access_scope=...)`, wraps
  `grpc.aio.AioRpcError` via `_grpc_error_message`. `register_tools(server)` at `:208`.
- Module docstring tool-count surface: `app/tools.py:4` `"Twenty-eight tools:"` + the per-tool
  enumeration lines through `:33`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `app/client.py`, add `async def run_fundamentals_scan(force=False, dry_run=False,
   symbols=None, access_scope=0) -> dict[str, Any]` mirroring `set_strategy_live` (`:1224`): lazy-import
   `analysis_pb2, analysis_pb2_grpc`; `meta = _metadata(("x-access-scope", str(access_scope)))` (no
   `user_id` needed — the backend gate keys on the ADMIN bit; still forwarded automatically when the
   caller context has one); dial `ANALYSIS_ENDPOINT`; `stub.RunFundamentalsScan(
   analysis_pb2.RunFundamentalsScanRequest(force=force, dry_run=dry_run, symbols=list(symbols or [])),
   metadata=meta)`; project to `{"run_id", "symbols_processed", "signals_emitted", "calls_spent",
   "deferred_count", "status", "finished_at"}` (map `finished_at` via the existing timestamp→ISO helper
   used elsewhere, or `.ToDatetime().isoformat()` — match the module's existing convention).
2. In `app/tools.py`, register `run_fundamentals_scan` under `register_tools` next to `trigger_backfill`
   (`:978`): `@server.tool()` `async def run_fundamentals_scan(ctx, force=False, dry_run=False,
   symbols=None)`; derive `access_scope = _caller_access_scope(ctx, "run_fundamentals_scan")`; call
   `client.run_fundamentals_scan(...)`; wrap `grpc.aio.AioRpcError` via `_grpc_error_message`. Docstring
   must state it is admin-scoped and that a non-admin caller is rejected `PERMISSION_DENIED` by the
   backend.
3. Bump the module docstring (`app/tools.py:4`) "Twenty-eight tools:" → "Twenty-nine tools:" and add the
   `run_fundamentals_scan — ...` enumeration line.

**Verification**:
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- Header propagation: `grep -n "_metadata" services/xstockstrat-agent/app/client.py` — confirm the new
  wrapper builds its metadata via `_metadata(...)` (reuses the propagating helper, C-03).
- Behavior proven by Step 6.

---

### Step 6 — test: agent tool + client tests (red-before-green)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (tool-level admin/non-admin cases)
- `services/xstockstrat-agent/tests/test_client.py` — modify (client wrapper: endpoint + scope + projection)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (add `run_fundamentals_scan` to the
  asserted catalog name-set)

**Reviewers**: `xstockstrat-agent` owner — tool contract + `/api/tools` catalog parity

**Codebase Evidence**:
- Tool-test harness: `tests/test_tools.py:14` `from app.tools import ... register_tools`; `:20`
  `register_tools(server)`; `_caller_access_scope`/claims helpers tested at `:30-57`. Backtest tool
  test precedent `test_run_backtest_calls_grpc` at `:467`.
- Client-test precedent: `tests/test_client.py:79`
  `test_uses_analysis_endpoint_and_admin_scope` (asserts `ANALYSIS_ENDPOINT` + forwarded scope for an
  analysis RPC wrapper) — the exact shape for the new wrapper's endpoint+scope assertion.
- Catalog reachability test (C-10(a)): `tests/test_tools_endpoint.py:17`
  `test_list_tools_returns_all_registered_tools` asserts `names == {...}` (an exact set) — adding the
  tool without updating this set makes it FAIL, which is the built-in reachability proof.
- C-13: any domain literal reused here has a single consumer → inline is compliant (no
  `tests/conftest.py` fixture needed; conftest holds only the proto-path shim).

**TDD**: `red-green required`

**Covers**: `AC-8`

**Instructions**:
1. `test_client.py`: add a case mirroring `test_uses_analysis_endpoint_and_admin_scope` (`:79`) — patch
   the analysis stub, call `client.run_fundamentals_scan(force=True, dry_run=False, symbols=["AAPL"],
   access_scope=ADMIN)`, assert the channel dialed `ANALYSIS_ENDPOINT`, the request carried
   `force/dry_run/symbols`, the forwarded `x-access-scope` metadata equals the passed scope, and the
   returned dict has the 7 projected keys from `FundamentalsScanSummary`.
2. `test_tools.py`: (a) admin path — invoke the registered `run_fundamentals_scan` tool with an admin
   claims context, assert `_caller_access_scope` yields the admin bit and `client.run_fundamentals_scan`
   is called with that scope (patch `client.run_fundamentals_scan`); (b) non-admin path — assert that a
   backend `PERMISSION_DENIED` (`grpc.aio.AioRpcError`) surfaces as the tool's `RuntimeError` (the gate
   is the backend's, not the tool's — the tool forwards the real derived scope; AC-8's "rejects a
   non-admin" is the backend abort propagating).
3. `test_tools_endpoint.py`: add `"run_fundamentals_scan"` to the asserted `names` set.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest tests/test_client.py tests/test_tools.py tests/test_tools_endpoint.py -v \
  && pytest --cov=app --cov-fail-under=40
```
Confirm new cases pass and coverage ≥ 40% (agent CI threshold, `.github/workflows/ci.yml` python-test
matrix). Red captured against the pre-Step-5 tree first (P-06).

---

### Step 7 — docs: agent tool-doc surfaces (count + per-tool reference)

**Status**: `pending`
**Service**: `docs/runbooks/` + `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify (tool table + "twenty-eight" count)
- `docs/runbooks/mcp-tools.md` — modify (header count + a `### run_fundamentals_scan` section)

**Reviewers**: none (docs)

**Codebase Evidence**:
- Five-surface rule for a new MCP tool: insights.md 2026-07-20 (feature 066) — tools.py docstring
  (done in Step 5), agent CLAUDE.md tool table, mcp-tools.md (header count + per-tool section),
  docs/runbooks/CLAUDE.md index line (per-runbook, not per-tool → no change), and any operational
  runbook (no dedicated fundamentals-scan runbook exists → none to update).
- agent CLAUDE.md count + table: `services/xstockstrat-agent/CLAUDE.md:36` "registers twenty-eight
  tools", table rows incl. `:54` `set_strategy_live`, `:55` `trigger_backfill`.
- mcp-tools.md count: `docs/runbooks/mcp-tools.md:3` "twenty-eight tools", `:37` "the same
  twenty-eight tools", per-tool section precedent `:681` `### trigger_backfill`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-agent/CLAUDE.md`: bump "twenty-eight" → "twenty-nine" (`:36`), add a
   `run_fundamentals_scan` row to the tool table (admin-scoped manual fundamentals producer trigger,
   feature 156).
2. `docs/runbooks/mcp-tools.md`: bump both "twenty-eight" occurrences (`:3`, `:37`) → "twenty-nine";
   add a `### run_fundamentals_scan` section mirroring `### trigger_backfill` (`:681`) with the param
   table (`force`, `dry_run`, `symbols`), the `FundamentalsScanSummary` return shape, and the
   admin-scope / `PERMISSION_DENIED` error case.
3. Keep the count consistent across all three prose surfaces + the Step-5 docstring + the Step-6
   `/api/tools` name-set (the executable parity, insights.md 2026-08-02).

**Verification**:
```
grep -rn "twenty-nine\|run_fundamentals_scan" services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md
```
Confirm the count is updated and the tool is documented in both files.

---

### Step 8 — service: config-ui "Run fundamentals scan" admin card + BFF + nav

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify (register `AnalysisService` with only
  `runFundamentalsScan` via `forwardAdmin`)
- `services/xstockstrat-ui/src/lib/browserClients/configUiAnalysisClient.ts` — create (browser client
  at baseUrl `/config-ui/api`)
- `services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx` — create (the admin card)
- `services/xstockstrat-ui/src/app/config-ui/hooks/useRunFundamentalsScan.ts` — create (mutation hook)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (`PLATFORM_SUBNAV`
  config-ui entry)

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, admin-gate
correctness, no secret values rendered

**Codebase Evidence**:
- config-ui BFF pattern: `src/lib/configUiBff.ts` — `createBffRouter()`, `router.service(ConfigService,
  {...})`, `router.service(IngestService, {...})`, `createDispatch(router, '/config-ui/api')` at `:51`.
  Imports `forward`, `requireAdminScope`, `backendHeaders` from `@/lib/bffShared`.
- `forwardAdmin` gate: `src/lib/bffShared.ts:75` `forwardAdmin(call) = forward(call, { admin:true })`;
  `forward` (`:63`) does `requireSession` then `if (options.admin) requireAdminScope(claims)` (`:50`
  `requireAdminScope` throws `PermissionDenied` when `!hasAdminScope(claims.roles)`). This is the real
  gate (AC-9).
- Register ONLY the one RPC (design.md §3): connect-node leaves unlisted service methods unimplemented,
  so `router.service(AnalysisService, { runFundamentalsScan: forwardAdmin((req, opts) =>
  analysisClient.runFundamentalsScan(req, opts)) })` exposes no other analysis RPC. Server client
  `analysisClient` (dials `ANALYSIS_ENDPOINT`) already exists: `src/lib/connectClients.ts:36`.
- `insightsBff.ts` AnalysisService block (`:26`, many `forward(...)` methods) is the "do NOT copy the
  whole block" anti-pattern reference; config-ui registers a single method.
- Browser client precedent (segment-specific baseUrl): `src/lib/browserClients/traderAnalysisClient.ts`
  (`makeBrowserTransport('/trader/api')`) and `.../ingestClient.ts`
  (`makeBrowserTransport('/config-ui/api')`) — the new `configUiAnalysisClient.ts` uses
  `makeBrowserTransport('/config-ui/api')` + `createClient(AnalysisService, transport)`.
- Mutation-hook precedent: `src/app/config-ui/hooks/useSignalSourceMutations.ts` (`useMutation`,
  `mutationFn`, `ConnectError` handling).
- Nav registration (C-10(a)): `src/components/shared/PlatformHeader.tsx:87-89` `PLATFORM_SUBNAV`
  `config-ui` array (`Namespaces` `/config-ui`, `Audit Log` `/config-ui/audit`, `Sources`
  `/config-ui/sources`). Add `{ label: 'Fundamentals Scan', href: '/config-ui/fundamentals-scan' }`.
- Cosmetic-only admin hide: `src/lib/auth.ts:113` `hasAdminScope(roles)` (`& ADMIN_SCOPE`, `:96`
  `ADMIN_SCOPE = 0x04`) — may hide the control for non-admins, but `forwardAdmin` is the load-bearing
  gate.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `configUiBff.ts`: import `AnalysisService` from `@xstockstrat/proto/analysis/v1/analysis_pb`,
   `analysisClient` from `@/lib/connectClients`, and `forwardAdmin` from `@/lib/bffShared`; add
   `router.service(AnalysisService, { runFundamentalsScan: forwardAdmin((req, opts) =>
   analysisClient.runFundamentalsScan(req, opts)) })`. Register nothing else on AnalysisService.
2. Create `configUiAnalysisClient.ts` mirroring `traderAnalysisClient.ts` but
   `makeBrowserTransport('/config-ui/api')`.
3. Create `useRunFundamentalsScan.ts` mirroring `useSignalSourceMutations.ts`, calling
   `configUiAnalysisClient.runFundamentalsScan`.
4. Create `config-ui/fundamentals-scan/page.tsx`: an admin-only card with `force` / `dry_run` toggles
   and an optional `symbols` input, a "Run scan" button, and a response summary
   (`symbols_processed`/`signals_emitted`/`calls_spent`/`deferred_count`/`status`). Cosmetically gate
   the control behind `hasAdminScope` (defense-in-depth; the BFF `forwardAdmin` is authoritative).
   Follow the config-ui page/layout conventions (`config-ui/sources/page.tsx`, `layout.tsx`,
   `providers.tsx`).
5. `PlatformHeader.tsx`: add the `Fundamentals Scan` nav item to the `config-ui` `PLATFORM_SUBNAV`
   array (`:87-89`).

**Verification**:
- Lint/build: `cd services/xstockstrat-ui && pnpm run lint`
- `grep -n "runFundamentalsScan\|AnalysisService" services/xstockstrat-ui/src/lib/configUiBff.ts` —
  confirm the single-method registration via `forwardAdmin`.
- `grep -n "fundamentals-scan" services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` —
  confirm nav entry.
- Behavior proven by Step 9.

---

### Step 9 — test: config-ui e2e (admin gate + nav-reachability) + mock handler

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add `runFundamentalsScan` to the insights-port
  `AnalysisService` block — the config-ui BFF's `analysisClient` dials `ANALYSIS_ENDPOINT=9092` in e2e)
- `services/xstockstrat-ui/e2e/config-ui/fundamentals-scan.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (only if a new fixture is added)

**Reviewers**: `xstockstrat-ui` owner — e2e admin-gate + nav-reachability correctness

**Codebase Evidence**:
- e2e AnalysisService mock lives on port 9092 (insights segment): `e2e/mock-backend.ts:622`
  `router.service(AnalysisService, {...})`; `playwright.config.ts:174` `ANALYSIS_ENDPOINT:
  '127.0.0.1:9092'`. The config-ui BFF's `analysisClient` (from `connectClients`) dials
  `ANALYSIS_ENDPOINT`, so its `runFundamentalsScan` forwards to the 9092 mock — the handler belongs in
  the existing 9092 `AnalysisService` block, NOT a new config-ui (9093) service block.
- config-ui e2e precedent: `e2e/config-ui/sources.spec.ts`, `.../namespace-nav.spec.ts`,
  `.../env-gate.spec.ts` (admin-gate + nav specs on the config-ui segment).
- Auth helpers (C-12 — never re-implement JWT signing): `e2e/helpers/auth.ts:70` `addAdminCookie(page)`
  (roles `['admin']`), `:65` `addAuthCookie(page)` (no roles), `:51` `addCookieWithRoles`.
- Fixture inventory home: `e2e/fixtures/INVENTORY.md` — reuse an existing fixture; only add a
  `FundamentalsScanSummary` fixture + catalog row if the response is reused by a second consumer (a
  single-spec inline literal is a compliant scenario one-off, C-12).

**TDD**: `red-green required`

**Covers**: `AC-9`

**Instructions**:
1. `mock-backend.ts`: add `runFundamentalsScan(req)` to the port-9092 `AnalysisService` block (`:622`),
   returning a deterministic `FundamentalsScanSummary` (e.g. `symbols_processed: 3, signals_emitted: 1,
   status: "completed"`). Make the distinguishing fields distinct (not echoing the request) so the
   spec's assertions have teeth (insights.md 2026-07-27).
2. Create `fundamentals-scan.spec.ts` with:
   - **admin path** — `addAdminCookie(page)`, navigate to `/config-ui/fundamentals-scan` via the
     config-ui nav (proving C-10(a) reachability), trigger a scan, assert the response summary renders.
   - **nav-reachability** — assert the `Fundamentals Scan` sub-nav item is present and links to the page
     (mirror `namespace-nav.spec.ts`).
   - **admin-gate** — with `addAuthCookie(page)` (non-admin), assert the BFF route rejects the
     `runFundamentalsScan` call (the `forwardAdmin` → `PermissionDenied` path surfaces as an error / the
     control is not actionable). This is AC-9's "non-admin session reaching the BFF route is rejected".
3. Import auth helpers from `e2e/helpers/auth.ts`; do not inline JWT signing (C-12).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint \
  && pnpm test:e2e -- config-ui/fundamentals-scan.spec.ts
```
(If the harness lacks a browser runtime, fall back to the structural checks: the spec exists, imports
`addAdminCookie`/`addAuthCookie` from `helpers/auth`, and the mock handler is registered — note the
Docker/browser limitation in the Deviation Log per fails.md 2026-08-05.) Confirm the admin path passes
and the non-admin path asserts rejection. Red captured against the pre-Step-8 tree first (P-06).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
