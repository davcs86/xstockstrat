# Design: fix-opportunities-read-hangs

**Created**: 2026-10-14
**Rounds**: 6 (full; round 6 by operator cap override, context.md 2026-10-14)
**Approved by**: operator, 2026-10-14 (round-6 gate)
**Grounded in**: recon.md

---

## Chosen Approach

Every hop on the opportunities read path gets its own bound. Each bound sits inside the deadline of the hop that calls it.

| Hop | Bound | Behavior on timeout |
|---|---|---|
| Agent → analysis | gRPC deadline | Explicit "deadline exceeded" error message |
| analysis DB phase | Server-enforced request budget | `UNAVAILABLE` for transient DB failures only |
| analysis → marketdata | Price-enrichment deadline | Rows returned unenriched |
| marketdata | Detached budget on the shared singleflight closure | Logs every error it used to drop |

The consumer surfaces are the agent's `list_opportunities` tool and the UI BFF:
- The tool gets the deadline and the error message.
- The BFF already enforces 30s (feature-191 @AC-1). Every bound below fits inside it.

### 1. analysis — request-scoped DB budget (operator decisions D1/D3/D4)

**New module:** `services/xstockstrat-analysis/app/repositories/read_budget.py` (~90 lines).

```
_READ_DB_BACKSTOP_GRACE_S = 2.0   # fixed invariant
_RELEASE_TIMEOUT_S = 1.0          # fixed invariant
_TRANSIENT = (OSError, apg.PostgresConnectionError, apg.InterfaceError, apg.TooManyConnectionsError,
              apg.QueryCanceledError, apg.AdminShutdownError, apg.CrashShutdownError,
              apg.CannotConnectNowError, apg.IdleSessionTimeoutError)      # apg = asyncpg.exceptions
_NOT_TRANSIENT = (ValueError, apg.UnsupportedClientFeatureError, apg.UnsupportedServerFeatureError)
def is_transient_db_error(e): return not isinstance(e, _NOT_TRANSIENT) and isinstance(e, _TRANSIENT)

class BudgetedConn:                         # single-task; DB-phase statements strictly sequential
    async def _arm(self):
        ms = int((self._deadline - time.monotonic()) * 1000)
        if ms <= 0: raise TimeoutError("read DB budget exhausted")   # no statement sent
        await self._con.execute(f"SET LOCAL statement_timeout = {ms}") # int only; simple-query, 1 RTT
    fetch / fetchval / fetchrow: await self._arm(); delegate

@asynccontextmanager
async def budgeted_read(pool, budget_s):
    deadline = time.monotonic() + budget_s
    con, tr, stage = None, None, "acquire"            # acquire|begin|open|commit|done
    backstop = asyncio.timeout(budget_s + _READ_DB_BACKSTOP_GRACE_S)
    try:
        async with backstop:
            con = await pool.acquire(timeout=budget_s)   # no await between this and stage="begin"
            stage = "begin";  tr = con.transaction(readonly=True); await tr.start()   # BEGIN READ ONLY (unmanaged)
            stage = "open";   yield BudgetedConn(con, deadline)
            stage = "commit"; await tr.commit()
            stage = "done"                               # no await follows inside the backstop
    except BaseException as e:
        cancelled = isinstance(e, asyncio.CancelledError) or backstop.expired()
        log.warning("budgeted_read: read DB phase failed at %s (%s: %s); %s", stage, type(e).__name__, e, <action>)  # before any await
        if con is not None:
            try:
                # invariant: rollback only at stage "open" (tr STARTED); every other stage terminates
                if stage == "open" and not cancelled and not con.is_closed():
                    await _rollback_then_release(pool, con, tr)   # one shared 1.0s cleanup deadline
                else:
                    con.terminate()                    # sync; slot freed via holder._release_on_close
            except Exception as ce:                    # e.g. InterfaceError on a proxy detached by pool.terminate()
                log.warning("budgeted_read: cleanup after %s skipped/failed (%s: %s) — connection may already be released by asyncpg; original error re-raised", ...)
        raise                                          # same exception object (a 2nd CancelledError during cleanup propagates instead)
    try: await pool.release(con, timeout=_RELEASE_TIMEOUT_S)
    except Exception as re: log.warning("budgeted_read: read connection release failed (%s: %s); connection terminated", ...)

async def _rollback_then_release(pool, con, tr):
    bounded `tr.rollback()` under asyncio.timeout(1.0) -> on any failure: log + con.terminate() (re-raise CancelledError)
    else pool.release(con, timeout=<remaining of the same 1.0s, min 0.05>) (failure logged)
```

**Why each mechanism (asyncpg 0.31.0):**
- **Unmanaged transaction.** `start` and `commit` are called manually. A managed `async with` would block on rollback after a cancel (F1). Manual control is allowed when the transaction is unmanaged: `transaction.py:96-151,213-219`.
- **Terminate after a failed BEGIN or COMMIT.** Those failures leave the transaction FAILED, so a rollback raises `InterfaceError` (`transaction.py:110,145-149,162-165,178-190`).
- **Stage invariant: rollback runs only at `open`.**
  - `tr.start()` reaches STARTED only after `BEGIN` succeeds (`transaction.py:145-151`).
  - Stage `acquire` implies `con is None`, because there is no await between the assignment and `stage="begin"`.
  - Stage `done` cannot raise inside the backstop, because no await follows it. A backstop expiry that races a COMMIT result is thrown in at the commit await.
  - Every non-`open` stage is therefore routed to terminate by construction.
- **Cleanup is guarded so the original error always surfaces (H4).**
  - After `pool.terminate()` (shutdown) **or a lost connection** (`protocol.pyx:943-953` → `connection.py:1584-1587` → `pool.py:304-323`), our proxy is detached and the holder already freed (`pool.py:990-997,270-274,95-101`). So for a real connection loss (`ConnectionDoesNotExistError`), `con.is_closed()` raises `InterfaceError` into this guard; the `is_closed()` → terminate branch is only a defensive path.
  - From then on every wrapped proxy method, including `is_closed` and `terminate`, raises `InterfaceError` (`pool.py:39-50,61-67`), and `tr.rollback()` raises through `connresource.py:40-44`.
  - The `except Exception` guard logs those failures, and the bare `raise` re-raises the original.
  - A success-path release of a detached proxy is a no-op (`pool.py:921-923`).
- **Bounded rollback on any other error.** Rolling back clears `_top_xact`, which avoids asyncpg's asyncio ERROR "Resetting connection with an active transaction" (`connection.py:1532-1539`).
- **Release is bounded and shielded.** It terminates the connection on failure (`pool.py:221-249,934-937`).
- **Terminate is synchronous.** It hands the pool slot back through `_release_on_close`, and a later acquire reconnects (`connection.py:1521-1525,1579-1587`; `pool.py:159-161,304-326,921-923`).
- **The backstop is told apart from our own `TimeoutError`.** It is identified by `backstop.expired()`. Our own budget-exhausted `TimeoutError` and an acquire timeout do not terminate the connection (G1).
- **The backstop never wraps cleanup.** A late backstop therefore cannot replace the original exception (G7).
- **On cancel:**
  - The backstop's `CancelledError` becomes a `TimeoutError`, which is transient, so the request gets `UNAVAILABLE`.
  - An external gRPC cancel stays a `CancelledError` and propagates.

**Transient classes** (`asyncpg/exceptions/__init__.py`):
- `PostgresConnectionError`, which covers 08000/08003/08006/08P01 (:52-77);
- 53300 (:823);
- 57014 (:871);
- 57P01/57P02/57P03 (:875-884, D4);
- 57P05 (:891-892).

**Carve-outs — these propagate as `UNKNOWN`:**
- The `ValueError` mixins `ClientConfigurationError` and the interface `DataError` (`_base.py:225,229`). The exported `asyncpg.DataError` is the 22000 Postgres error, which is not transient anyway.
- `Unsupported{Client,Server}FeatureError` (`_base.py:233,237`).

**Handler** (`services/xstockstrat-analysis/app/handlers/servicer.py:4178-4320`):
- `@owner_scoped` still runs first (:416-426).
- The `:4204` early return is unchanged.
- The page/offset parse moves up from :4293-4297.

The DB phase moves into `_read_opportunity_queue(opps, state_repo, user_id, request, offset, q)`. Its statements run strictly sequentially:

```
w = cfg.get_float(signal_rank_weight)                                     # :4207
rows = await opps.read(include_expired=False)                             # :4210
if rows:   (fresh) if user_id not in _opportunity_retrying: q.retry_symbols = {stale-unavailable}   # :4279-4288
else:
    n = await opps.count_for_user(user_id)                                # :4229
    q.kick_full = True                                                    # every no-rows branch kicks today (:4240,:4249,:4262)
    if n == 0:
        state = await state_repo.get(user_id) if state_repo else None     # :4234-4238
        if not (state and now < state.valid_until):                       # :4239
            q.compute_failed = failures[u] >= MAX  else q.computing = True # :4250-4258 — counter read at the same instant as today
    else: q.served_include_expired = True; rows = await opps.read(include_expired=True)   # :4263-4264
q.rows = rows
q.available = await opps.available_sources(include_expired=q.served_include_expired) if offset == 0 else []   # hoisted from :4307
```

How the handler runs the DB phase:
- **Pool path** (`self._db_pool is not None`): `async with budgeted_read(self._db_pool, budget_s) as bc:` builds per-request repositories from `self._opps_repo_factory(bc)` / `self._state_repo_factory(bc)`.
  - The factories default to `OpportunitiesRepository` / `OpportunityComputeStateRepository`, set next to `servicer.py:511,524`.
  - The constructors take only `db` (`opportunities.py:70`, `opportunity_compute_state.py:14`).
  - The read path uses only `fetch` (:221,:285), `fetchval` (:314) and `fetchrow` (`opportunity_compute_state.py:19`).
- **Injected-repo path** (tests): the repositories run directly, with no budget.

**Error path (H6):** the classifying `try` catches `Exception`, not `BaseException`, and `abort` sits outside it.

```
err = None
try:
    if self._db_pool is not None:
        async with budgeted_read(self._db_pool, budget_s) as bc:
            await self._read_opportunity_queue(self._opps_repo_factory(bc), self._state_repo_factory(bc), user_id, request, offset, q)
    else:
        await self._read_opportunity_queue(self._opportunities_repo, self._opportunity_compute_state_repo, user_id, request, offset, q)
except Exception as e:          # external CancelledError (BaseException) propagates, unlogged here
    err = e
finally:
    <fire q.kick_full / q.retry_symbols kicks>      # after release; also on error and cancel paths (G3)
if err is not None:
    if is_transient_db_error(err):
        log.warning("ListOpportunities: opportunities store unavailable (%s: %s); returning UNAVAILABLE", ...)
        await context.abort(grpc.StatusCode.UNAVAILABLE, "opportunities store unavailable; retry")  # outside the try
        return None             # test contexts' abort does not raise (precedent servicer.py:425)
    log.error("ListOpportunities: opportunities read failed (%s: %s)", ...)
    raise err                   # client sees UNKNOWN
```

Kicks and error handling:
- Kicks (`_kick_opportunity_recompute` / `_kick_opportunity_retry`) fire in a `finally` **after** the connection is released, including on the error and cancel paths (G3). They are a synchronous set-add plus `create_task` (:4425-4427), so this is harmless. No kick competes for the held 2-slot pool connection.
- A transient failure aborts with `UNAVAILABLE`, following the precedent at `servicer.py:5709-5711`. Anything else re-raises, so the client sees `UNKNOWN`. An external `CancelledError` is neither classified nor logged.
- The connection is always released **before** enrichment.

**G3 — no change in meaning:**
- Today `_kick_opportunity_recompute` is synchronous: a set-add plus `create_task` (:4425-4427,4446). The failure counter is written only inside the task body (:4435,:4439).
- The counter read at :4251 therefore sees its value at the moment `compute_state.get` returned. The new code reads it at that same moment.
- Results are unchanged:
  - `compute_failed = (n==0) ∧ ¬fresh ∧ failures≥MAX`
  - `computing = (n==0) ∧ ¬fresh ∧ failures<MAX`
- The retry scan has no await before it on the fresh path, so it is identical.

**Budget reads:**
- `read_db_budget_ms` and `live_enrich_timeout_ms` use `get_int`, with ≤0 falling back to the default. `get_int` treats 0 as unset and passes negatives through (`watcher.py:99-105`).
- A float-typed value reads `int_val=0` and therefore falls back to the default. Each `CLAUDE.md` row documents that `value_type` must be int (F4).

### 2. analysis — enrichment deadline

- At `servicer.py:4367-4377` the call becomes `await asyncio.wait_for(self._marketdata.BatchGetLatestPrice(...), timeout=live_enrich_ms/1000)`. This reuses the pattern at `engine/pnl_pattern_consumer.py:364-388`.
- The existing `except` now logs `_enrich_opportunities_live: BatchGetLatestPrice failed (%s: %s); serving unenriched`, including the type name.
- The memo write at :4383 stays success-only.
- `data_unavailable`, ranking and composite are untouched, because enrichment runs after ranking and the window slice.

### 3. marketdata — bounded, observable `BatchGetLatestPrice`

In `services/xstockstrat-marketdata/internal/service/marketdata_service.go:730-805`:
- **Detached budget.** The singleflight closure uses `fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), resolveBatchPriceBudget(s.budgetCfg))`. Go 1.27, `WithoutCancel` OK.
  - It is detached from the first caller's cancellation and deadline, so coalesced waiters are no longer cancelled by that caller.
- **Single test seam.** `budgetCfg intGetter` is set only when `cfgWatcher != nil`, which avoids the typed-nil trap (precedent `fundamentalsConfig`, :99-104). nil or ≤0 falls back to 2500ms.
- **prevClose seam.** A `prevCloseReader` interface over `GetPreviousDailyCloseBatch` (`marketdata_repo.go:399`), set when `repo != nil`.
  - It runs **concurrently** with the trade fetch and is joined through a `done` channel, so the join is `-race`-safe.
- **Trade fetch.** The multi-symbol fetch and the sequential per-symbol fallback both use `fctx`. The fallback breaks once `fctx.Err() != nil`, and the remainder is counted as skipped.
  - The rate limiter does not serialize (burst = rps = 200). The fallback stays sequential because a concurrent fallback is YAGNI; at ~200ms per symbol it covers about 12 of 50 symbols in 2.5s, and the rest are omitted.
- **Logging.** Every dropped error is logged with `slog.Warn`, keys `symbols` / `error`, matching the style at :600 and :606:
  - `BatchGetLatestPrice: source lookup failed`
  - `…: multi-symbol fetch failed; falling back to per-symbol`
  - `…: budget exhausted by multi-symbol fetch; per-symbol fallback skipped` (with `budget_ms`)
  - `…: per-symbol fallback incomplete` (`failed,fetched,skipped,total,sample_error`, emitted once when failed+skipped > 0, in the warm-poller shape :875-898)
  - `…: previous-close lookup failed`
- The closure still returns nil, so symbols are omitted rather than fabricated. The singleflight key is unchanged.

### 4. agent — deadline + explicit error

- **Client.** `client.list_opportunities(..., timeout)` passes `stub.ListOpportunities(..., timeout=timeout)` (`app/client.py:862-867`).
- **Policy reader.** `_extract_policy` is renamed to `_agent_policy` (`app/tools.py:2324-2337`; 4 call sites at :2351-2354, none referenced by tests). Its log line is generalized.
- **Tool.**
  - It reads `timeout_s = await asyncio.wait_for(_agent_policy("opportunities.read_timeout_seconds", 40.0, float), _POLICY_READ_TIMEOUT_S)`. It is a module constant read at call time, so the AC-2 test can monkeypatch it to 0.1.
  - If the policy read times out, it logs `agent policy read timed out; using safe default` and uses 40.
  - A non-finite or ≤0 value also falls back to 40.
  - The shared `get_config_value` is untouched.
- **Error mapping.** `_grpc_error_message(e, deadline_s=timeout_s)` gets an explicit `DEADLINE_EXCEEDED` branch: `upstream did not respond within {N:g}s (deadline exceeded); retry shortly`.

### 5. config — bounds keep the nested budget valid

Four entries go into `SCALAR_BOUNDS_REGISTRY` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:100-128`).
- Lookup tries the bare key, then `${namespace}.${key}` (:133-135). Every registry string is therefore the **full-dotted** key, so a namespace-stripped `key` column still resolves through the second probe (H7).
- Bounds apply even to `create_key=true` writes, because they are checked before the existence gate (:412-424).
- All four keys are **unseeded**, per operator decision D2. This consciously deviates from feature 184's convention of seeding `analysis.opportunity.*` keys.

| Registry key (exact string) | value_type | Default | Bounds |
|---|---|---|---|
| `'analysis.opportunity.read_db_budget_ms'` | int | 20000 | [1000, 20000] |
| `'analysis.opportunity.live_enrich_timeout_ms'` | int | 3000 | [500, 4000] |
| `'marketdata.price.batch_timeout_ms'` | int | 2500 | [500, 2500] |
| `'agent.opportunities.read_timeout_seconds'` (stored in ns `agent` as key `opportunities.read_timeout_seconds`) | float (int accepted) | 40 | [30, 55] |

These are fixed invariants, not config keys:
- `_READ_DB_BACKSTOP_GRACE_S=2.0`
- `_RELEASE_TIMEOUT_S=1.0`
- agent `_POLICY_READ_TIMEOUT_S=3.0`

**Worst-case arithmetic:**
- The analysis DB phase takes at most B+3.05. The B+2 backstop terminates synchronously. A near-deadline COMMIT plus release adds ≤1.0, and a near-deadline body error's rollback plus release adds ≤1.05 (the release floor is 0.05s).
- Analysis total ≤ B+3.05+E: ≈26.05s at the defaults and ≈27.05s at the ceilings, under the BFF's 30s.
- The agent floor of 30 is above 27.05, so the agent never pre-empts analysis's own answer.
- Agent end to end ≤ 3+55 = 58s, under 60s.
- If E ≤ M, a marketdata stall that runs to its own budget M always yields unenriched rows, because analysis gives up first. A healthy marketdata still enriches. That is a documented safe degrade.

### 6. Tests (AC → test)

**Shared fakes** go in `tests/conftest.py`, following the `RecordingStub` precedent (:45-72): `FakePool`, `FakeConn`, `FakeTx` with stall/raise injection, and `bc_routed(fake_repo)`.

**Session-scoped `local_pg` fixture:**
- Finds binaries via `$XSTOCKSTRAT_PG_BIN`, then `which pg_ctl`, then `/usr/lib/postgresql/*/bin`, then Homebrew.
- Uses `tempfile.mkdtemp(dir="/tmp")`.
- Under root with a `postgres` user it runs through `runuser -u postgres --`.
- Starts with `initdb -A trust --no-sync`, then `pg_ctl -w start` on a Unix socket only with `fsync=off`.
- The finalizer runs `pg_ctl -m immediate stop` and `rmtree`.
- If it cannot start, the test is skipped locally and fails under `CI=true`.
- A `real_pg` marker is added in `pyproject.toml`.
- The CI analysis `python-test` job gets a guarded step: `ls /usr/lib/postgresql/*/bin/initdb || (sudo apt-get update && sudo apt-get install -y --no-install-recommends postgresql)`.

**Hang guard (red step).** pytest-timeout is not a dev dependency, and the pre-fix code has no bound. Every stall-injection test (AC-1, AC-2, AC-4, G5) therefore wraps its call in `asyncio.wait_for(…, 10)` and fails on that outer `TimeoutError`. The Go AC-3 hang and G10 tests run the call in a goroutine and `select` on `time.After(5*time.Second)` → `t.Fatal`. Without this, the P-06 red run hangs instead of failing. G6 keeps its own `asyncio.timeout(0.3)`.

| Scenario / fix | Test |
|---|---|
| **@AC-1** | `test_list_opportunities_deadlines.py`: `BatchGetLatestPrice` never returns; `live_enrich_timeout_ms=200` via a real `ConfigSnapshot` (full-dotted key). Expect 2 rows in < enrichment deadline + 1.5s (<1.7s here), no `live_price`, `data_unavailable` false, a log naming `BatchGetLatestPrice` + `TimeoutError`, and an empty memo. |
| **@AC-2** | agent `tests/test_list_opportunities_deadline.py`: an in-process `grpc.aio` server on `add_insecure_port("127.0.0.1:0")` whose handler sets an `asyncio.Event` and then never returns. `monkeypatch` `client.ANALYSIS_ENDPOINT` to that port and `client.mtls.secure_channel` to `lambda ep, _svc: grpc.aio.insecure_channel(ep)`; otherwise conftest's dummy PEM and the `analysis-test` host fail or time out before the server is reached. The policy returns 0.2. Expect a `RuntimeError` containing "deadline" in <1.5s **and** the handler-entered event set, then `server.stop(0)`. A hung policy read with the cap at 0.1 gives timeout 40; the values 0, -1, NaN and inf all give 40; the mapper branch is checked in `tests/test_tools.py`, where `_rpc_error` lives (:929); a new file must not import a helper from another test module (C-13). |
| **@AC-3** | Go: a multi-fetch error, captured with a recording slog handler, logs `symbols=1` and the fallback message. A hang with a 50ms budget returns in <1s, omits the symbol and logs "skipped". The incomplete, source-lookup and prevClose records are covered. The resolver is tested with 0, -5, nil and 50. |
| **@AC-4** | real_pg, proving the **acquire timeout** fired (not the backstop): a pool with min=max=2 and `statement_cache_size=0`; the test holds both connections; a real servicer pool path; a 300ms budget; `Connection.terminate` wrapped by a spy. Expect `UNAVAILABLE` with elapsed < budget+0.5s (well under the B+2 backstop), a `budgeted_read` warning naming stage `acquire` and `TimeoutError`, the terminate spy never called, and both held connections still open. A headerless call still gets `UNAUTHENTICATED`. |
| **G2** | real_pg: a pool with min=max=1 and `statement_cache_size=0`; record `pg_backend_pid()`. `pg_sleep(5)` under a 300ms budget raises `QueryCanceledError` with no asyncio "Resetting connection with an active transaction" record. The reacquired connection has the **same** pid (rollback + release kept it), runs `SELECT 1`, and shows `statement_timeout` '0'. Unit: rollback/release/terminate counts for each error kind. |
| **F2 leak** | real_pg: a pool with min=max=1, `statement_cache_size=0`, `connection_class` with an empty reset query. On the same connection pid, `SHOW statement_timeout` is '0'. Negative control: a session `SET` persists. |
| **G4** | The existing `ListOpportunities` tests (every test calling it: 18 call sites in `test_analysis_servicer.py`, 3 in `test_opportunity_compute_state.py`) are parametrized over `read_path` = direct or pool. In pool mode every `bc_routed` fake-repo method issues **exactly one** `bc.fetch`/`fetchval`/`fetchrow`, so the order assertion is not vacuous. Per acquired FakeConn, assert the order BEGIN READ ONLY → (SET LOCAL nᵢ → stmt)* → COMMIT → release, with every nᵢ ≤ the budget in ms and the sequence **non-increasing** (instant fakes may give equal values). Also assert that the connection *this request* acquired is released (`FakeConn.released`) at enrichment and at the kicks; do not use a global `in_use==0`, because :5897 runs 6 requests concurrently, and results identical to direct mode. |
| **G5** | `monkeypatch.setattr(read_budget, "_READ_DB_BACKSTOP_GRACE_S", 0.1)` with a 0.2s budget. Stall at BEGIN, SET LOCAL, fetch and COMMIT; each gives `UNAVAILABLE` within B+G+0.5s with terminate called exactly once. |
| **G1** | Unit: once the deadline has passed, `_arm` raises `TimeoutError` with no `SET LOCAL` sent, and `budgeted_read` routes it to rollback + release (terminate count 0). An acquire timeout performs no terminate (stage `acquire`). |
| **G6** | Unit: an external `task.cancel()` of the task running the handler during a fetch (no inner `wait_for`) propagates `CancelledError` with no abort, no "opportunities read failed" log, and one terminate. real_pg: a pool with min=max=1, a budget ≥ 10s (so `statement_timeout` cannot fire), pid recorded. `asyncio.timeout(0.3)` wrapping the **entire** `async with budgeted_read(...)` block (not the fetch inside it), with `pg_sleep(30)` as the body, raises the outer `TimeoutError` (**not** `QueryCanceledError`) with elapsed < 1s. The next acquire on the single-connection pool has a **different** pid and `statement_timeout` '0'. |
| **G7** | The original exception object is preserved, and its log is written before the rollback runs. H4: after `pool.terminate()` (proxy detached), a body error re-raises the **original** exception, not `InterfaceError`, and a "cleanup … failed" warning is logged; the same holds when `con.terminate()` / `tr.rollback()` are faked to raise `InterfaceError`. The connection-lost case (`ConnectionDoesNotExistError`) is modelled as a **detached** proxy whose `is_closed()` raises `InterfaceError`: expect 0 terminate calls, the original error re-raised, and `UNAVAILABLE` at the handler. The attached-proxy `is_closed()=True` case is tested only as the defensive branch (terminate=1). |
| **Release failure (H5)** | Unit: on the success path `FakePool.release` raises `TimeoutError`. `ListOpportunities` still returns the rows, logs `read connection release failed`, and does not abort. |
| **Classification** | Each transient class gives `UNAVAILABLE`. 22000 `DataError`, interface `DataError`, `ClientConfigurationError`, the `Unsupported*` errors, `ValueError` and `UndefinedTableError` propagate. A `compute_state.get` `TimeoutError` gives exactly one kick, then `UNAVAILABLE`. |
| **G3** | On both paths: failures ≥MAX gives `compute_failed`; fewer gives `computing`; a fresh empty stamp gives neither plus a kick; a stale queue gives a kick plus the include_expired facet; a fresh queue with a stale unavailable row gives a retry kick. |
| **G8** | `setConfigScalarBounds.test.ts`: each key at min/max and just outside. The agent key is tested both as ns `agent` + stripped key and as the full-dotted key; the analysis keys in both forms. |
| **G10** | Go under `-race`: the multi fetch blocks until the fake prevCloseReader has been entered. With an injected 1s budget, both results are present. A sequential implementation blocks until the budget expires and drops the trade. |
| **O8** | A realistic `ConfigSnapshot` with a float-typed or negative `*_ms` value reads as the default. |

### 7. Doc-drift edits (in scope; touched path)

- **analysis `CLAUDE.md`:**
  - :182 — the memo now skips only `BatchGetLatestPrice`.
  - :454 — the `sparkline_bars` row is inert, since nothing reads it.
  - :457 — the default is 20 in code and seeded as 10 by config migration 028.
  - Add two key rows (int).
  - Add a fixed-invariants note, following the `_INTENT_SWEEP_SECONDS` precedent.
  - Add the constraint that the read DB phase is strictly sequential.
- **marketdata `CLAUDE.md`:** add a key row (int).
- **agent `CLAUDE.md`:** add a key row with the exact key-column string and the 3s policy-read invariant.
- **agent `tools.py:1515`:** drop "a sparkline".
- **`docs/patterns/config-governance.md`:**
  - :269 — the TTL/no-seed wording.
  - A feature-227 per-feature log entry, including the D2 waiver.
- **`docs/context-constitution-findings.md`** — flag only:
  - The agent's `GetConfig` call has no deadline (`client.py:1746`), mitigated by the 3s wrapper.
  - The durable feature-191 @AC-8 text still names `BatchGetBars`.
  - The seeded TTL of 10 is below the 15s poll, so the memo never hits.
  - The G6 residual.

## Operator Decisions (2026-10-14)

- **D1** (round-1 gate): one request-scoped DB budget, with `pool.acquire(timeout=remaining)`, a short read transaction carrying `SET LOCAL statement_timeout = <remaining ms>` (server-side abort, no CancelRequest churn), and a bounded `pool.release`. Only transient DB errors become UNAVAILABLE; always log the type and message.
- **D2** (round-1 gate): the new keys are unseeded. This consciously deviates from feature 184's `analysis.opportunity.*` seeding convention.
- **D3** (round-1 gate): the AC-4 proof runs against a real local Postgres binary, test-scoped, with no long-running container.
- **D4** (round-2 gate): 57P01/57P02/57P03 are transient (UNAVAILABLE).

## Rejected Alternatives

- **Service-wide asyncpg `command_timeout` or pool `timeout`.** It would abort legitimate long background, materializer and backtest queries.
- **`asyncio.wait_for` around each DB await (round 1).** It is a soft bound: cancelling a query triggers a shielded, unbounded release/reset plus a CancelRequest against the saturated DB. It also uses a fixed 4s per await, so a slow read that would complete fails anyway.
- **Managed `async with con.transaction()`.** On cancel, `__aexit__`'s ROLLBACK waits unbounded on the protocol's `cancel_waiter`, and it masks the original error type.
- **Parameterized `set_config(...)`.** It costs 2 round trips under `statement_cache_size=0`; the simple-query `SET LOCAL` costs 1.
- **Skipping the rollback entirely and releasing (round 3).** asyncpg logs an asyncio ERROR on every statement_timeout.
- **Terminating on every error.** It turns a saturation incident into a reconnect storm.
- **Letting `pool.release` handle cancels.** That brings back CancelRequest churn through PgBouncer, which D1 rejected.
- **Threading `con=` through the repository signatures.** It churns the fakes and the `assert_awaited_with` calls. Per-request repository factories avoid that.
- **A ScreenSymbols-style outer `DEADLINE_EXCEEDED`.** It is a second mechanism that gives no guarantee beyond the budget.
- **Seeding the new keys.** The operator waived it (D2).
- **Bounded concurrency in the marketdata fallback (`errgroup` limit 4).** YAGNI for a path that only runs when the multi-fetch fails.
- **A native stub `timeout=` for enrichment.** It cannot be tested with an `AsyncMock` fake. Propagating `grpc-timeout` buys nothing because the marketdata closure is detached.
- **A shared default deadline across all ~69 agent call sites.** Out of scope ("touch only what the task requires").
- **A tolerant int-or-float reader for the `*_ms` keys.** Documenting the `value_type` plus tests showing the default fallback is the minimal fix.

## Open Risks

- [ ] **PgBouncer saturation stalls at BEGIN or COMMIT.** Only the client backstop at B+2 bounds this, via cancel and terminate. That costs a reconnect, and the backend runs until `statement_timeout` (G6). Accepted; handled in steps 5, 6 and 8 (G5). Real PG cannot simulate a PgBouncer stall.
- [ ] **G6 residual: orphaned backend.** On terminate, asyncpg's CancelRequest task is cancelled, so the backend runs until `statement_timeout` (≤ the remaining budget) and counts against the cluster's `max_connections`. Record in findings at step 13.
- [ ] **Full-kick dedup timing.** The dedup check now happens after release, so one extra kick is possible if a prior recompute finished in that window. It is serialized by the per-user lock (:4431). Accepted.
- [ ] **A COMMIT stall after data was read** returns `UNAVAILABLE` instead of the rows. Rare, and the behavior is consistent. Accepted.
- [ ] **UI retry load.** The UI's `retry:1` on a fast `UNAVAILABLE` doubles the read rate per tab. Acquire timeouts put no load on the DB, and `statement_timeout` aborts on the server side. Accepted and recorded.
- [ ] **ubuntu-latest PostgreSQL binaries are unverified.** The guarded apt step covers both cases. Handled at step 9.
- [ ] **Success-path release can terminate after a good read (H5).** Release runs asyncpg's default reset (`pool.py:234-239`; `connection.py:1544-1571,1744-1757`), an implicit second transaction that needs a PgBouncer server slot. Under saturation the 1.0s release timeout terminates the connection (`pool.py:240-249`); the error is logged and the rows are still returned. One reconnect; strictly better than today's unbounded release (`pool.py:931-932`). Accepted; covered by the Release failure (H5) test.
- [ ] **Repository SQL is not run against real Postgres under `BudgetedConn`.** Only the connection object changes. Accepted.
- [ ] **The trigger is still unconfirmed** (DB saturation vs Alpaca). The design bounds both. Confirm on staging after deploy, now that the logs exist.
- [ ] **Two warning lines per DB failure** (the context manager and the handler). Deliberate, for G7.

## Constitution Rules Touched

- `C-01` (evidence-cited claims): every mechanism is cited to code or asyncpg source, and recon has no claims beyond what was found.
- `C-05`/`C-10` (config governance): new keys follow `<service>.<category>.<key>`, with defaults in code and in `CLAUDE.md`, bounds in the registry, and the value_type documented. The seeding deviation is operator waiver D2 (§ Operator Decisions), also recorded in context.md.
- `C-15`/`C-16`: AC-1..4 each map to a test. Of 37 existing rules, 36 are PRESERVE and 1 is EXTEND; none is a CHANGE.
- `C-18` (design quality): a single seam for each concern; the rename stays in one file; no speculative abstractions.
- `P-03` (no guessing): the bounds are hard by construction, and the unconfirmed trigger is recorded as a risk.
- `P-06` (red before green): every service step is paired with a test step.
- `F-06` (resource budgets): pool sizes are unchanged and each request holds at most one connection.
- `F-07` (no hard-coded policy): every policy value is a config key. The three fixed mechanism constants are documented invariants, following the `_INTENT_SWEEP_SECONDS` precedent.
- `F-11`: no Floor breach was found in rounds 1–6.

## Business Rules Touched (C-16)

- **PRESERVE** `@AC-1 @feature-191` "BFF enforces a 30s gRPC deadline on ListOpportunities" (`services/xstockstrat-ui/acceptance/opportunities-latency-fix.feature`). Not regressed: the analysis worst case is ≤27s.
- **EXTEND** `@AC-11 @feature-095` "An unavailable live quote omits the price field rather than fabricating it" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`). New cause: a stalled enrichment past its deadline.
- **PRESERVE** `@AC-15/@AC-14 @feature-095` and `@AC-7 @feature-199`. Not regressed: the omit-not-0 behavior holds, and ranking and composite come before enrichment.
- **PRESERVE** `@AC-1/@AC-5 @feature-185` (analysis), `@AC-3` (UI) and `@AC-10` (agent). Not regressed: a timeout never sets `data_unavailable`.
- **PRESERVE** `@AC-6/@AC-7/@AC-8/@AC-9 @feature-185`. Not regressed:
  - G3 equivalence.
  - A cold read with an undeterminable state returns `UNAVAILABLE`; @AC-6 is preserved wherever the state is determinable.
  - The kicks are still fire-and-forget.
- **PRESERVE** `@AC-1/@AC-3/@AC-11/@AC-13 @feature-190`. Not regressed: `available_sources` uses the same arguments over the whole queue, and filtering and pagination are unchanged.
- **PRESERVE** `@AC-8/@AC-9 @feature-191` (single batch RPC; memo TTL ≥15s in code) and `@AC-4/@AC-5 @feature-177`.
- **PRESERVE** `@AC-4 @feature-176` and `@AC-4 @feature-180`. Not regressed: one connection per request, with no kick competing for it.
- **PRESERVE** `@AC-9 @feature-158`. Refresh-loop semantics are untouched.
- **PRESERVE** `@AC-8/@AC-16 @feature-225`. Not regressed: the identity gate runs before any DB work.
- **PRESERVE** `@AC-4/@AC-5 @feature-191` (marketdata) and `@AC-3 @feature-178`. Not regressed: symbols are omitted rather than fabricated, and the singleflight key is unchanged.
- **PRESERVE** `@AC-5 @feature-210`. Not regressed: the header trio is unchanged on the deadlined calls.

## Suggested /sdd-spec step breakdown

Each service step is followed by its test step (red before green):
1. config bounds → 2. bounds tests (G8)
3. marketdata → 4. Go tests (AC-3, G10)
5. `read_budget.py` → 6. `test_read_budget.py` (G1, G2 unit, G5 at the `budgeted_read` level: TimeoutError plus one terminate, G7 at the `budgeted_read` level, `is_transient_db_error` classification)
7. handler, factories, kicks-after-release, enrichment → 8. handler tests (AC-1, G3, G4, G5, G6 unit, G7 handler-level UNAVAILABLE for the connection-lost case, O8, H5 release failure, handler-level classification and the `compute_state.get` single-kick case)
9. `local_pg` fixture, marker, CI step → 10. real_pg tests (AC-4, G2, F2, G6)
11. agent → 12. agent tests (AC-2)
13. docs and teardown

## Rounds

6 rounds (full mode; the 5-round cap was overridden by the operator for round 6).
- **Round 1:** the per-await `wait_for` was shown to be a soft bound.
- **Round 2:** the request budget, `SET LOCAL`, the bounds registry and the real-PG test were adopted.
- **Round 3:** the manual transaction with terminate-on-cancel and the leak/cancel test fixes were adopted.
- **Round 4:** cancel-only terminate, bounded rollback, kicks after release, and pool-path test parametrization.
- **Round 5:** guarded cleanup and the stage invariant (H4), the handler error path (H6), test-strength fixes (H1–H3, H5, H8), the lost-connection detach correction, G6 timeout placement, and test/step placement.
- **Round 6:** whole-document re-review: test reachability and hang guards, the AC-1 Gherkin, the D1–D4 record, and arithmetic/placement fixes.

Termination: round-6 fixes applied; awaiting user approval.
