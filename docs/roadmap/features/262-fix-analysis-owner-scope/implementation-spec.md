# Implementation Spec: fix-analysis-owner-scope

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/262-fix-analysis-owner-scope/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-analysis-owner-scope`

---

## Execution Summary

The work follows design.md's Chosen Approach and is confined to `services/xstockstrat-analysis`.
There are no proto, migration, config, trading or `app/main.py` changes, so no `buf`/migration
verification applies.

1. Step 1 (docs, already done at /sdd-spec) appends `@AC-9` to `acceptance.feature`.
2. Steps 2–3 make the boot entry-backfill's `ListOrders` owner-scoped: body `user_id`,
   `owner_metadata(user_id)` and a per-pass `x-trace-id` (FR-1/FR-2).
3. Steps 4–5 isolate failures in `run_once`: the strategies read, the blend-universe resolve, the
   system drain, a row-scoped parse/resolve, owner-scoped held/watch prep with `failed_owners`, an
   owner-signal fallback, per-owner skip summaries and gather-result logging (FR-3/FR-4).
4. Steps 6–7 delete the dead owner-agnostic `StrategiesRepository.get_by_id`/`.update` and apply
   the operator-approved **deletion-first** test-mock rule (FR-5/FR-6). They go last because
   `tests/test_analysis_servicer.py` is the highest-churn overlap (215/244/245).
5. Step 8 fixes the analysis `CLAUDE.md:230` dependency row and runs the context teardown.

Steps 2 and 4 both edit `run_once` and are sequential. Each `service` step is paired with the
`test` step right after it. Both carry `red-green required`, so `/sdd-execute` captures the RED run
of the paired tests against the pre-step tree.

**Consumer surface (C-14).** The product spec names `/trader` live alerts. They are affected only
through the alerts analysis already emits, and "No UI code changes" is stated there. FR-5/FR-6 are
internal. So no `xstockstrat-ui` or `xstockstrat-agent` step is needed; this is a decision, not an
omission.

**Trading-domain constraints (step-constraints §A).** Broker coverage, trading-mode gate, order
types and env parity: unaffected. No order placement, `BrokerType`, `OrderType` or env var is
touched. Fill state: `_infer_open_entry_time` (`entry_backfill.py:26-46`) is unchanged; only the
set of orders it receives narrows to the owner's. The existing
`test_infer_open_entry_time_counts_canceled_partial_fill` (`tests/test_entry_backfill.py:102`)
already covers a nonzero partial fill, and Step 3 adds no new fill semantics.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` owner-scoped `ListOrders` (body `user_id` + `x-user-id`) | Step 3 |
| `@AC-2` another owner's fills never seed | Step 3 |
| `@AC-3` a `system` owner does not stop other owners | Step 5 |
| `@AC-4` failed live-strategies read ends quietly | Step 5 |
| `@AC-5` failed system-signal drain does not stop the pass | Step 5 |
| `@AC-6` no owner-agnostic repository method | Step 7 |
| `@AC-7` tests mock only methods the servicer calls | Step 7 |
| `@AC-8` a non-`ValueError` drain failure is isolated | Step 5 |
| `@AC-9` a failed blend-universe resolve skips only the blend pairs | Step 5 (scenario appended by Step 1) |
| PRESERVE 193 `@AC-3` (blend anchored only in the fundamentals universe) | Step 5 (existing `test_blend_backfill_restricted_to_fundamentals_universe` stays green) |
| PRESERVE analysis `@AC-20`/`@AC-21`/`@AC-34` | Step 7 (full analysis suite green after the deletions) |

## Step Dependencies

- Step 2 requires Step 1, since the `@AC-9` scenario must exist before code (C-15).
- Step 3 [test] covers Step 2 [service].
- Step 4 requires Step 2. Both edit `run_once` in `app/engine/entry_backfill.py`, and Step 4's
  warnings reuse Step 2's `pass_trace_id`.
- Step 5 [test] covers Step 4 [service]. It also moves the `_live_loop` helper into
  `tests/conftest.py`.
- Step 6 is independent of Steps 2–5 in code, but it is sequenced after them to keep the
  `test_analysis_servicer.py` churn last.
- Step 7 [test] covers Step 6 [service].
- Step 8 requires Steps 2 and 6, because it documents their final shape.
- **Merge order (cross-feature):**
  - `244-fix-python-config-stored-zero` merges **before** 262. 244 edits the semaphore clamp at
    `entry_backfill.py:56-58`. Step 4's `try` around `:59-61` re-indents the lines next to it, so
    the overlap is **ADJACENT** and a textual rebase conflict is expected.
  - The `docs/roadmap/features/merge-order.md` row ("244 before 262, adjacent at
    `entry_backfill.py:56-61`, rebase conflict expected") is still unwritten: neither /sdd-spec
    nor /sdd-review impl-spec could write outside this feature's directory. Add it (operator
    yes/no) **before** `/sdd-execute` Step 2, or at the latest with the integration PR. It is an
    open thread in `context.md`.
  - `app/main.py:174` (the unretained backfill task) stays with `259-fix-python-loop-supervision`.
    262's guards are in-function and need no supervised-task helper.
- **Test-file rebase churn:** 215, 244 and 245 also edit `tests/test_analysis_servicer.py`. Before
  Step 7's commit, rebase and re-run its grep (`get_by_id` count in `tests/` = 0). A rebase can
  resurrect a deleted mock line, and it would then be silently dead, because
  `svc._strategies_repo` is a bare `AsyncMock`.

---

### Step 1 — docs: append `@AC-9` to acceptance.feature

**Status**: `done`
**Service**: `docs/roadmap/features/262-fix-analysis-owner-scope/`
**Files**:
- `docs/roadmap/features/262-fix-analysis-owner-scope/acceptance.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: the file ended at `@AC-7` ("Servicer tests mock only repository methods the
  servicer calls") before this run. design.md § Chosen Approach "Step 0" mandates the append.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
Done at /sdd-spec (commit `72aea957`). The scenario `@AC-9 @FR-4 @regression` "A failed
blend-universe resolve skips only the blend pairs" was appended after `@AC-7`.
- Given: the blend is enabled and live; `"s-2"` is owned by `"u-a"` on `"MSFT"`; trading holds a
  filled BUY 5 MSFT at 2026-10-01T14:30:00Z; the fundamentals-universe resolve raises.
- Then: the pass completes; the u-a entry time is seeded; no `ListOrders` goes out for the blend
  strategy; a warning names the failed resolve.

The change is additive, so it needs no C-16 sign-off.

**Verification**:
`grep -n "@AC-9 @FR-4 @regression" docs/roadmap/features/262-fix-analysis-owner-scope/acceptance.feature` → 1 hit

---

### Step 2 — service: owner-scoped `ListOrders` in the entry-backfill (FR-1/FR-2)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; Security — auth scope (tenant isolation: owner header + body `user_id` on the cross-service read)

**Codebase Evidence**:
- `entry_backfill.py:63` is `async def _backfill_pair(user_id, strategy_id, symbol):`.
- `:64-65` is the comment "Key must match live_loop's 3-tuple … ListOrders stays owner-implicit via
  the order's own user_id."
- `:70-76` is the pair-local `try`. It contains
  `resp = await trading_stub.ListOrders(trading_pb2.ListOrdersRequest(strategy_id=strategy_id, symbol=symbol))`,
  which sends no `user_id` and no `metadata=`. Its failure branch is
  `except Exception as e: log.warning("entry_backfill: (%s,%s) ListOrders failed: %s", ...)`.
- `:123` is `log.info("entry_backfill: boot pass complete (%d pairs considered)", len(tasks))`.
- Imports at `:14-21` are `asyncio`, `logging`, `datetime.UTC`, `trading_pb2`, `resolve_universe`,
  `_row_to_strategy_definition` and `blend_strategy_id`. There is no `uuid` and no `owner_metadata`.
- `app/identity.py:6-10` is
  `def owner_metadata(owner) -> list[tuple[str, str]]`. It raises `ValueError` for an empty or
  `"system"` owner and returns `[("x-user-id", owner)]`.
- Reuse pattern: `app/handlers/servicer.py:6315-6318` is the owner-scoped sibling
  `ListOrders(ListOrdersRequest(strategy_id=strategy_id, user_id=user_id), metadata=propagation_meta)`
  (recon.md § Patterns to REUSE).
- Trace-id precedent: `servicer.py:3602-3604` builds
  `*owner_metadata(user_id), ..., ("x-trace-id", uuid.uuid4().hex)`.
- Trading fails open on an empty body `user_id`: `services/xstockstrat-trading/internal/repository/trading_repo.go:229-231`
  adds `AND user_id = $n` only when `userID != ""` (recon.md:65, :176-178). Trading is read-only
  here.
- Header propagation (step-constraints §B): this is not a new edge. It is the existing analysis →
  trading `ListOrders` call (stub `servicer._trading`, `app/main.py:174-176`), and it gains Python
  per-call `metadata=`. The backfill has no inbound request, so there is no `x-access-scope` to
  forward. Per the operator decision of 2026-10-21, a background pass mints its own trace id. The
  call carries `x-user-id` (owner) and `x-trace-id` (per pass).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `import uuid` to the stdlib imports and `from app.identity import owner_metadata` to the
   `app.` imports (`:14-21`, keeping ruff's isort order).
2. In `run_once`, after the `trading_stub is None` early return (`:54-55`), mint
   `pass_trace_id = uuid.uuid4().hex` once per pass.
3. In `_backfill_pair`, replace the `:64-65` comment with exactly two lines (How-to-Act #5):
   `# Key must match live_loop's 3-tuple (user_id, strategy_id, symbol) or the slot is never read.`
   and `# Body user_id is load-bearing: trading treats an empty user_id as all users.`
4. Inside the existing `try` at `:70-76`, first build
   `md = owner_metadata(user_id) + [("x-trace-id", pass_trace_id)]`. Then call
   `trading_stub.ListOrders(trading_pb2.ListOrdersRequest(user_id=user_id, strategy_id=strategy_id, symbol=symbol), metadata=md)`.
   An `owner_metadata` `ValueError` stays pair-local via the existing `except Exception`.
5. Add `pass_trace_id` to the `:75` warning, e.g.
   `"entry_backfill: (%s,%s,%s) ListOrders failed [trace %s]: %s"` with `user_id, strategy_id, symbol, pass_trace_id, e`.
   Also add it to the `:123` info log: `"entry_backfill: boot pass complete (%d pairs considered) [trace %s]"`.
6. Leave the pair set, the blend gating (`:84-111`) and the seeding writes (`:77-82`) unchanged.
   That keeps 193 `@AC-3` intact.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "user_id=user_id, strategy_id=strategy_id, symbol=symbol\|metadata=md\|owner_metadata(user_id)\|pass_trace_id" app/engine/entry_backfill.py
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Behavioural verification is Step 3.

---

### Step 3 — test: `@AC-1`/`@AC-2` owner scoping + runtime header guard on the trading stub

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_entry_backfill.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_entry_backfill.py` helpers:
  - `:21` `_order(side, filled_qty, updated_at, status=...)` builds a real `trading_pb2.Order`.
  - `:29` `_strategy_row(strategy_id="s1", symbols=("AAPL",), user_id="u1", ...)`.
  - `:49` `_fake_live_loop(...)`.
  - `:64` `_cfg()`.
  - `:115` `class TestRunOnce`.
- The existing side-effect fakes take only `req`: `:153` `async def _list_orders(req):` and `:227`
  `async def _list_orders(req):`. Once Step 2 passes `metadata=`, they raise `TypeError`, which is
  swallowed per pair (recon.md:103).
- `trading_pb2.Order` has `user_id = 16` (`packages/proto/trading/v1/trading.proto`,
  `message Order`), so a fake can tag orders by owner.
- `tests/test_owner_header_guard.py:175-183` is `test_entry_backfill_run_once`. It stubs
  `trading = MagicMock()` with `trading.ListOrders = AsyncMock(...)` at `:180-181` and asserts
  ingest headers only (`:183`).
- `RecordingStub` (`tests/conftest.py:83-110`) records `(method, request, list(metadata))` into
  `.calls`. It is already imported in `test_owner_header_guard.py:27`.
- `fails.md:2659` (2026-10-06 header): assert a non-empty `x-user-id` at runtime and assert the
  call list is non-empty first, because a vacuous guard passes.

**TDD**: `red-green required`. Against the pre-Step-2 tree:
- `@AC-1` fails because the call has no `metadata` kwarg and the body `user_id` is `""`.
- `@AC-2` fails because the unfiltered fake returns u-b's fill and u-a is seeded `True`.
- The header-guard extension fails on the missing `x-user-id`.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. In `tests/test_entry_backfill.py`, change both existing fakes (`:153`, `:227`) to
   `async def _list_orders(req, metadata=None):`. Make no other change to those tests.
2. Add `TestRunOnce.test_list_orders_carries_owner_in_body_and_metadata` (`@AC-1`):
   - Setup: one `_strategy_row("s-1", ("AAPL",), user_id="u-a")` and
     `trading_stub.ListOrders = AsyncMock(return_value=SimpleNamespace(orders=[]))`.
   - After `run_once`, take `call = trading_stub.ListOrders.await_args`. Assert
     `call.args[0].user_id == "u-a"`, `call.args[0].strategy_id == "s-1"` and
     `call.args[0].symbol == "AAPL"`.
   - Bind `md = call.kwargs["metadata"]`. Assert `[v for k, v in md if k == "x-user-id"] == ["u-a"]`
     and that exactly one non-empty `x-trace-id` is present.
3. Add `TestRunOnce.test_other_owner_fills_never_seed` (`@AC-2`):
   - The fake `async def _list_orders(req, metadata=None)` holds one filled BUY 10 AAPL
     `_order(...)` with `o.user_id = "u-b"` on `strategy_id` `"s-1"`. It returns only the orders
     whose `user_id == req.user_id`.
   - Assert `("u-a","s-1","AAPL") not in live_loop._last_entry_at`, and
     `live_loop._last_state.get(("u-a","s-1","AAPL")) is not True`, and
     `live_loop._write_entry_cooldown.assert_not_awaited()`.
4. In `tests/test_owner_header_guard.py::test_entry_backfill_run_once` (`:175`):
   - Replace `trading = MagicMock()` / `trading.ListOrders = AsyncMock(...)` (`:180-181`) with
     `trading = RecordingStub({"ListOrders": SimpleNamespace(orders=[])})`.
   - After `run_once`, keep `_assert_owner_headers(ingest)`.
   - Add `assert trading.calls, "no ListOrders issued — the guard would be vacuous"`.
   - For each `(method, req, meta)` in `trading.calls`, assert `method == "ListOrders"`,
     `[v for k, v in meta if k == "x-user-id"] == ["bob"]`, and
     `[v for k, v in meta if k == "x-trace-id"]` has length 1 and is non-empty. Also assert
     `req.user_id == "bob"`.
   - Explanation for the reader: `_row()` is signal-eligible and has no allowlist. The ingest stub
     returns `MSFT`, so a pair exists.
5. C-13 verdict: the u-a/u-b order literals are single-consumer within `test_entry_backfill.py`,
   so keeping them inline is compliant. `RecordingStub` is reused from `tests/conftest.py`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_entry_backfill.py tests/test_owner_header_guard.py -q
cd services/xstockstrat-analysis && grep -n "from tests.conftest\|conftest" tests/test_owner_header_guard.py tests/test_entry_backfill.py
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 4 — service: failure isolation in `run_once` (FR-3/FR-4, `@AC-9`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `entry_backfill.py:50-53` is the docstring ("Never raises — a per-pair failure is logged and
  skipped").
- `:59-61` is `rows = await db_pool.fetch("SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE")`,
  which is unguarded.
- `:89-91` is `fundamentals_universe = (await live_loop._resolve_fundamentals_universe() if blend_active else set())`,
  which is unguarded.
- `:94` is `system_signals = await live_loop._drain_system_signals()`, which is unguarded.
- `:99-121` is the row loop:
  - `:100` `definition = _row_to_strategy_definition(dict(row))` is strict. Per
    `servicer.py:7193-7220` (verified in design r2), it raises `KeyError` on a missing
    `strategy_id`/`display_name`/`active` and `ParseError` on bad `definition_json`.
  - `:102-104` drains held then watch into the caches one at a time. A raise in between leaves a
    partial cache, which then causes a `KeyError` at `:114`.
  - `:106-109` is the owner-signal drain.
  - `:110-111` is the blend skip.
  - `:112-119` is `resolve_universe(...)`.
- `:122` is `await asyncio.gather(*tasks, return_exceptions=True)`, and its results are discarded.
- Drains:
  - `live_loop.py:476-478` `_drain_owner_signals` and `:517-522` `_drain_held` call
    `owner_metadata(owner)`.
  - `:545-551` `_drain_watchlist` does the same.
  - `:472` `_drain_system_signals` uses `_SYSTEM_READ_META`.
  - `:510` is `_resolve_fundamentals_universe`.
- Reuse pattern: `live_loop.py:384-395` is the per-strategy skip guard
  (`except ValueError as e: log.warning("live_loop: strategy %s skipped — %s", ...); continue`).
  Here it is widened to `Exception` and also names the owner (recon.md § Patterns to REUSE).
  `except Exception` excludes `asyncio.CancelledError`, which is a `BaseException` in 3.13.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **(a) Strategies read.** Wrap the `:59-61` fetch. On `except Exception as e`, call
   `log.warning("entry_backfill: live-strategies read failed [trace %s]: %s", pass_trace_id, e)`
   and `return`.
2. **(b) Blend-universe resolve.** Turn `:89-91` into: if `blend_active`, `try` the awaited
   `_resolve_fundamentals_universe()`. On `except Exception as e`, warn
   `"entry_backfill: fundamentals-universe resolve failed [trace %s]: %s"` and set
   `fundamentals_universe = set()`; otherwise use `set()`.
   - The existing `:110-111` skip then drops the blend pairs.
   - That skip must stay **ahead of** `resolve_universe` and of any task append (193 `@AC-3`;
     fails.md 2026-10-05/2026-10-07).
3. **(c) System drain.** Wrap `:94`. On `except Exception as e`, warn
   `"entry_backfill: system-signal drain failed [trace %s]: %s"` and set `system_signals = set()`.
   Add **no** comment claiming production protection (C-18).
4. **(d) Row loop (`:99-121`).** Add `failed_owners: dict[str, list[str]] = {}`, mapping each
   failed owner to the `strategy_id`s it skipped. Then, per row:
   - **Row-scoped parse.**
     `try: definition = _row_to_strategy_definition(dict(row))`. On `except Exception as e`, warn
     `"entry_backfill: strategy %s (owner %s) skipped — unparseable row [trace %s]: %s"` with
     `dict(row).get("strategy_id")` and `dict(row).get("user_id")`, then `continue`. Do **not**
     touch `failed_owners`.
   - **Owner-scoped prep.** Set `owner = definition.user_id`.
     - If `owner in failed_owners`, append `definition.strategy_id` to `failed_owners[owner]` and
       `continue`.
     - If `owner not in held_cache`, `try` `held = await live_loop._drain_held(owner)` and
       `watch = await live_loop._drain_watchlist(owner)` into locals. Then commit
       `held_cache[owner] = held` and `watch_cache[owner] = watch` **together**.
     - On `except Exception as e`, warn
       `"entry_backfill: strategy %s owner %s skipped [trace %s]: %s"`, set
       `failed_owners[owner] = [definition.strategy_id]` and `continue`.
   - **Owner-signal drain** (`:106-109`). Keep the `signal_eligible and strategy_id != blend_id`
     condition. Wrap the `_drain_owner_signals(owner)` await in its own `try`.
     - On `except Exception as e`, warn
       `"entry_backfill: owner-signal drain failed for owner %s [trace %s]: %s"` and cache
       `own_cache[owner] = set()`, so the owner falls back to `system_signals` and does not
       re-warn. Do **not** add the owner to `failed_owners`.
     - Only a held/watch failure poisons an owner (design decision, context.md 2026-10-22).
   - **Row-scoped resolve.** The `:110-111` blend skip runs first, unchanged.
     - Then `try` the `resolve_universe(...)` call (`:112-119`, arguments unchanged). On
       `except Exception as e`, warn
       `"entry_backfill: strategy %s (owner %s) skipped — universe resolve failed [trace %s]: %s"`
       and `continue`.
     - The `for symbol in resolved.union` append (`:120-121`) is unchanged.
5. **(e) Per-owner summary.** After the loop, for each `owner, sids in failed_owners.items()`,
   warn once: `"entry_backfill: owner %s skipped strategies %s [trace %s]"`.
6. **(f) Gather results.** Bind `results = await asyncio.gather(*tasks, return_exceptions=True)`.
   For each `r` that `isinstance(r, Exception)`, warn
   `"entry_backfill: pair task failed [trace %s]: %s"`. Keep the Step 2 `boot pass complete` info
   log.
7. **(g) Docstring.** Rewrite `:50-53` so it says the pass never raises. A failed strategies read
   ends the pass with a warning. Blend-universe and system-drain failures fall back to empty sets.
   A malformed row or failed resolve skips that row. A held/watchlist drain failure skips that
   owner's rows. Every failure is logged with the pass trace id. Keep it at most ~5 lines.
8. Catch `Exception` everywhere, never `BaseException`, so cancellation still propagates.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "failed_owners\|except Exception\|pass_trace_id\|return_exceptions=True" app/engine/entry_backfill.py
cd services/xstockstrat-analysis && grep -n "except BaseException\|except:" app/engine/entry_backfill.py   # expect no output
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Behavioural verification is Step 5.

---

### Step 5 — test: `@AC-3`/`@AC-4`/`@AC-5`/`@AC-8`/`@AC-9` failure isolation (real loop for `@AC-3`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_header_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_entry_backfill.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_owner_header_guard.py:139-154` is `_live_loop(ingest, indicators, rows)`. It builds
  a real `LiveEvaluationLoop` (`config_watcher=_cfg()`, a `db` `MagicMock` with
  `db.fetch = AsyncMock(return_value=rows)`, `marketdata_stub=_marketdata()`, a `portfolio`
  `MagicMock` whose `ListPositions`/`ListWatchlists` return empty pages,
  `evaluator=StrategyEvaluator(indicators, ())`).
  - Its consumers are `:162`, `:177`, `:415` and `:425`.
  - It depends on the file-local `_cfg` (`:117`), `_marketdata` (`:128`, which uses `_real_bars`
    from `tests/test_readiness_opportunities_source_symbol.py:23`) and `_EOF` (`:46`).
- `tests/conftest.py` imports no test modules (`:6-46`). It already exports `RecordingStub` (`:83`)
  and `ctx_with` (`:71`), so it is the Python C-13 home.
- `tests/test_entry_backfill.py:49-61` `_fake_live_loop` uses plain `AsyncMock` drains that never
  raise. A `@AC-3` built on it would pass before the fix (design r1 blocking objection).
- `tests/test_entry_backfill.py:213-243` is `test_blend_backfill_restricted_to_fundamentals_universe`,
  the PRESERVE guard for 193 `@AC-3`. Its blend-cfg pattern is `:233-236`.
- caplog style: `tests/test_live_loop.py:101` / `:119`
  `with caplog.at_level(logging.WARNING, logger="app.engine.live_loop"):`. Here the logger is
  `app.engine.entry_backfill`.
- `live_loop.py:896-906` `_write_entry_cooldown` returns early when `self._cooldowns_repo is None`
  (`:901-902`). The constructor at `live_loop.py:267` defaults `cooldowns_repo=None` (`:276`,
  stored at `:300`), and `_live_loop` (`test_owner_header_guard.py:139-154`) passes none. So the
  real loop needs no cooldowns repo, and `@AC-3` fails RED on the escaped `ValueError`, not on a
  constructor error (re-verified at /sdd-review impl-spec). Still check the RED failure message.

**TDD**: `red-green required`. Against the pre-Step-4 tree:
- `@AC-3` fails because the real `owner_metadata` `ValueError` escapes `run_once` from
  `live_loop.py:522`.
- `@AC-8`, `@AC-4`, `@AC-5` and `@AC-9` fail because the injected exception escapes `run_once`.
- The row-split test fails because the `KeyError` from the parse escapes.

**Covers**: `AC-3, AC-4, AC-5, AC-8, AC-9`

**Instructions**:
1. **Move `_live_loop` into `tests/conftest.py` (C-13, second consumer).**
   - Add `def real_live_loop(ingest, indicators, rows, *, config_watcher, marketdata_stub):` to
     `tests/conftest.py`. Its body is the `:140-154` body of `_live_loop`, with the two
     test-module dependencies injected as parameters. That keeps conftest free of
     test-module imports; `_marketdata` needs `_real_bars`.
   - Import `LiveEvaluationLoop` and `StrategyEvaluator` inside the function or at module top
     (after `_setup_gen_path`, `# noqa: E402` as at `:44-46`).
   - The moved body also uses the file-local `_EOF` (`test_owner_header_guard.py:46`,
     `SimpleNamespace(next_page_token="")`) for the portfolio pages. conftest has no
     `SimpleNamespace` import (it imports `types`, `:17`), so build the page inline as
     `types.SimpleNamespace(next_page_token="")`. Do not import `_EOF` from the test module.
   - In `test_owner_header_guard.py`, replace the `_live_loop` body with
     `return real_live_loop(ingest, indicators, rows, config_watcher=_cfg(), marketdata_stub=_marketdata())`
     and import `real_live_loop` from `tests.conftest` (`:27`). The 4 call sites stay unchanged.
   - **Fallback (design Open Risk), preferred on any collision:** 244 (`snapshot_watcher`) and
     246 (`fundamentals_row`) also add conftest helpers. Rebase before this step; if the conftest
     edit then conflicts, keep `_live_loop` where it is. For `@AC-3`, use a `_drain_held` side effect that calls
     the real `app.identity.owner_metadata(owner)` and returns `set()`. Record that in the
     Deviation Log.
2. **`@AC-3`** (`test_system_owner_does_not_stop_other_owners`, `tests/test_entry_backfill.py`):
   - Build `loop = real_live_loop(RecordingStub({"QuerySignals": SimpleNamespace(signals=[], page=SimpleNamespace(next_page_token=""))}), RecordingStub(), [], config_watcher=_cfg(), marketdata_stub=MagicMock())`.
   - `rows = [_strategy_row("s-sys", ("AAPL",), user_id="system"), _strategy_row("s-2", ("MSFT",), user_id="u-a")]`.
     The system row comes first.
   - `ListOrders` returns a filled BUY 5 MSFT at `datetime(2026, 10, 1, 14, 30, tzinfo=UTC)`.
   - Under `caplog.at_level(logging.WARNING, logger="app.engine.entry_backfill")`, `run_once` must
     not raise.
   - Assert `loop._last_entry_at[("u-a","s-2","MSFT")]` equals that time. Assert a WARNING record
     whose message contains both `"s-sys"` and `"system"`.
3. **`@AC-8`** (`test_non_value_error_drain_failure_isolated_per_owner`):
   - Use `_fake_live_loop()` and set `_drain_held = AsyncMock(side_effect=_held)`, where the local
     `async def _held(owner)` raises `RuntimeError("portfolio rpc")` for `"u-b"` and returns
     `set()` otherwise.
   - Rows: `("s-3", owner "u-b")`, then `("s-2", owner "u-a", ("MSFT",))`.
   - Assert the u-a pair is seeded and a WARNING names `"s-3"` and `"u-b"`.
4. **Row-vs-owner split** (`test_malformed_row_skips_only_that_row`):
   - Use two u-a rows. The first has `"display_name"` deleted from a `_strategy_row("bad", ...)`
     dict. The second is a valid `("s-2", ("MSFT",))`.
   - Assert `("u-a","s-2","MSFT")` is seeded, so the owner was **not** poisoned. Assert a
     WARNING names `"bad"`.
5. **Owner-signal fallback** (`test_owner_signal_drain_failure_falls_back_to_system_signals`):
   - The setup has a signal-eligible, allowlist-free u-a row; `_drain_owner_signals` raises;
     `_drain_system_signals` returns `{"MSFT"}`.
   - Assert the `("u-a", sid, "MSFT")` pair is still issued and seeded, and that a WARNING names
     the owner-signal drain.
6. **`@AC-4`** (`test_failed_live_strategies_read_ends_quietly`):
   - Set `db_pool.fetch = AsyncMock(side_effect=RuntimeError("db down"))`.
   - `run_once` returns. A WARNING mentions `"live-strategies read failed"`, and
     `trading_stub.ListOrders.assert_not_awaited()`.
7. **`@AC-5`** (`test_failed_system_signal_drain_does_not_stop_pass`):
   - Set `live_loop._drain_system_signals = AsyncMock(side_effect=RuntimeError("ingest down"))`
     and use a u-a `("s-2", ("MSFT",))` row.
   - Assert the pair is seeded and a WARNING mentions `"system-signal drain failed"`.
8. **`@AC-9`** (`test_failed_blend_universe_resolve_skips_only_blend_pairs`):
   - Rows: `_strategy_row("fundamentals_macd_blend", symbols=None, signal_eligible=True, user_id="u-a")`
     and `_strategy_row("s-2", ("MSFT",), user_id="u-a")`.
   - Set `live_loop._resolve_fundamentals_universe = AsyncMock(side_effect=RuntimeError("md down"))`.
     Use the blend cfg pattern from `:233-236`, so `get_str` → default blend id and
     `get_bool` → default `True`.
   - Record `seen` `(req.strategy_id, req.symbol)` in an `async def _list_orders(req, metadata=None)`
     fake.
   - Assert the u-a `s-2` MSFT entry is seeded, that no `seen` entry has the blend strategy id, and
     that a WARNING mentions `"fundamentals-universe resolve failed"`.
9. **Gather logging** (`test_pair_task_exception_is_logged`): make
   `live_loop._write_entry_cooldown = AsyncMock(side_effect=RuntimeError("cooldown"))`. Assert
   `run_once` returns and a WARNING mentions `"pair task failed"`.
10. Leave `test_blend_backfill_restricted_to_fundamentals_universe` (`:213`) unchanged. It must stay
    green (PRESERVE 193 `@AC-3`).
11. C-13 verdict: `real_live_loop` now has two consumer files, so it lives in `tests/conftest.py`.
    The new row and order literals are single-consumer inside `test_entry_backfill.py` and stay
    inline (compliant). Add `import logging` and `from tests.conftest import RecordingStub, real_live_loop`
    to `test_entry_backfill.py`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_entry_backfill.py tests/test_owner_header_guard.py -q
cd services/xstockstrat-analysis && grep -n "def real_live_loop\|from tests.conftest\|conftest" tests/conftest.py tests/test_owner_header_guard.py tests/test_entry_backfill.py
cd services/xstockstrat-analysis && grep -c "LiveEvaluationLoop(" tests/test_owner_header_guard.py   # the moved constructor is no longer declared here (0, or only unrelated sites)
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 6 — service: delete owner-agnostic `StrategiesRepository.get_by_id` / `.update` (FR-5)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (one comment)

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; Security — auth scope (no owner-agnostic strategy read/write remains)

**Codebase Evidence**:
- `app/repositories/strategies.py:89-97` is
  `async def get_by_id(self, strategy_id)` with `WHERE strategy_id = $1`.
- `:110-124` is `async def update(self, strategy_id, display_name, definition_json)` with
  `WHERE strategy_id = $1` at `:117`.
- `:99-102` is the `get_by_owner_and_id` docstring "Owner-scoped twin of :meth:`get_by_id` —
  resolves the row only under its owner (feature 133)…". Keep `get_by_owner_and_id` (`:99`) and
  `update_locked` (`:126`).
- Grep found 0 callers in `app/`. `grep -rn "get_by_id\|_strategies_repo.update\b" app/`, after
  excluding `strategy_scores`/`template`, hits only `strategies.py:89`, `:100` and the comment at
  `servicer.py:3174`.
- `app/handlers/servicer.py:3174` is
  `# Atomic backstop for a concurrent duplicate that raced the get_by_id check.`
- The `get_by_id` on `strategy_scores` and `strategy_templates` belongs to other repositories and is
  out of scope (`tests/test_strategy_scores_repo.py:127` calls the scores repo).

**TDD**: `red-green required`. The paired `@AC-6` assertion in Step 7 fails while the methods
exist.

**Covers**: —

**Instructions**:
1. Delete `get_by_id` (`strategies.py:89-97`) and `update` (`:110-124`) whole, including their
   blank separators.
2. Rewrite the `get_by_owner_and_id` docstring opening (`:100`) so it no longer cross-references
   `get_by_id`. For example: `"""Resolve the row only under its owner (feature 133). Returns ``None`` …`
   (keep the rest of the docstring).
3. Reword the `servicer.py:3174` comment to name the owner-scoped read it follows, e.g.
   `# Atomic backstop for a concurrent duplicate that raced the get_by_owner_and_id check.`
4. Leave the `import json` in place if `update_locked` or others still use it. Run
   `ruff check` to confirm no unused import was left behind.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "def get_by_id\|def update(" app/repositories/strategies.py   # expect no output
cd services/xstockstrat-analysis && grep -rnE "_strategies_repo\.(get_by_id|update\b)|get_by_id check" app/   # expect no output
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 7 — test: deletion-first mock cleanup + `@AC-6`/`@AC-7` (FR-6)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_readiness_opportunities_source_symbol.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Re-verified at /sdd-spec on `origin/feature/fix-analysis-owner-scope` @ `5afe0c84`. Every
  single-line `get_by_id = AsyncMock(...)` site is followed **on the next line** by an explicit
  `get_by_owner_and_id = AsyncMock(...)` with the same return value:
  - `tests/test_analysis_servicer.py`: 119, 684, 799, 812, 986, 1008, 1075, 2175 (`repo.`), 2285,
    2815, 2892, 3119, 3170, 3451 (`repo.`), 4036, 4149, 6216, 6234, 6252, 6269, 6286, 6407, 6427
    and 7592.
  - `tests/test_readiness_opportunities_source_symbol.py`: 61 and 189.
- `:1975-1983` / `:2003-2011` are multi-line `get_by_id = AsyncMock(return_value={...})`, and they
  are followed by the alias `get_by_owner_and_id = svc._strategies_repo.get_by_id` at `:1984` /
  `:2012`.
- `:4500` is `svc._strategies_repo.get_by_id = AsyncMock(side_effect=lambda sid: strategies.get(sid))`.
  The `:4501-4502` comment ends "so mirror get_by_id (owner-agnostic here)". `:4503-4505` already
  defines `get_by_owner_and_id = AsyncMock(side_effect=lambda uid, sid: strategies.get(sid))`.
- `:6335` is `svc._strategies_repo.get_by_id.assert_not_awaited()  # no precondition fetch on disable`.
  The disable path never calls `get_by_owner_and_id`: `servicer.py:3412-3415` fetches only under
  `if request.live_enabled:`.
- The stale comments are `:978` ("…via get_by_id.") and `:1007` ("…from the get_by_id
  precondition fetch.").
- No test references `_strategies_repo.update`. `svc._strategies_repo` is a bare `AsyncMock`
  (e.g. `:1974`, `:6324`), so deleting a mock line changes no behavior when the explicit
  `get_by_owner_and_id` stays (design r2 rationale).
- The repo-level tests live in `class TestListLiveEnabled` (`tests/test_analysis_servicer.py:6667`),
  which builds `StrategiesRepository(db)` directly (`:6699`, `:6718`).

**TDD**: `red-green required`. The new `@AC-6` test fails before Step 6 (`hasattr` is True). The
`@AC-7` grep count is 30 before this step and 0 after.

**Covers**: `AC-6, AC-7`

**Instructions**: apply the **deletion-first** rule (operator-approved at the design gate r2; the
rename/retarget rules are a Rejected Alternative):
1. **(i)** Delete each `get_by_id = AsyncMock(...)` line listed above whose next line already sets
   `get_by_owner_and_id`. The cited line numbers are from `5afe0c84` and will drift after the
   rebase in instruction 7. Locate each site by `grep -n "get_by_id" <file>` on the rebased tree,
   not by the number. That is 24 sites in `test_analysis_servicer.py`, including `repo.` at
   2175/3451, and 2 in `test_readiness_opportunities_source_symbol.py`. Delete from the bottom of
   the file upward so the cited line numbers stay valid while editing.
2. **(ii)** At `:1975-1984` and `:2003-2012`, rename the multi-line `get_by_id = AsyncMock(` to
   `get_by_owner_and_id = AsyncMock(` (same `return_value` dict) and delete the alias line
   (`:1984`, `:2012`).
3. **(iii)** Delete `:4500`. Reword `:4501-4502` to say that the fixtures sit under a single owner
   (`_HEADERS` x-user-id="u1"), so the owner-scoped mock ignores `uid`. Remove the "mirror
   get_by_id" wording.
4. **(iv)** Retarget `:6335` to
   `svc._strategies_repo.get_by_owner_and_id.assert_not_awaited()  # no precondition fetch on disable`.
5. **(v)** Reword the `:978` and `:1007` comments to name `get_by_owner_and_id`.
6. **`@AC-6`:** add `class TestStrategiesRepositoryOwnerScopedOnly` right after
   `TestListLiveEnabled` with one test. It asserts that
   `not hasattr(StrategiesRepository, "get_by_id")`, `not hasattr(StrategiesRepository, "update")`
   and `hasattr(StrategiesRepository, "get_by_owner_and_id") and hasattr(StrategiesRepository, "update_locked")`.
   Import inside the test, as `TestListLiveEnabled` does at `:6676`.
7. Do this first: rebase onto the latest feature branch (215/244/245 churn). Then re-run the
   greps below, and delete any resurrected `get_by_id` line by rule (i).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -rnE "_strategies_repo\.(get_by_id|update\b)" tests/ app/ | wc -l   # expect 0 (was 30)
cd services/xstockstrat-analysis && grep -rn "repo.get_by_id\|get_by_id" tests/test_analysis_servicer.py tests/test_readiness_opportunities_source_symbol.py | wc -l   # expect 0
cd services/xstockstrat-analysis && uv run pytest -q   # full suite green — also closes the grep-based "no callers" Open Risk (a getattr caller would fail here)
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 8 — docs: analysis CLAUDE.md dependency row + context teardown

**Status**: `pending`
**Service**: `services/xstockstrat-analysis/` (docs)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:230` (the `xstockstrat-trading` dependency row) reads
  "`ListOrders(strategy_id, symbol)` boot-time-only for the exit-cooldown entry-time backfill
  (feature 116, `app/engine/entry_backfill.py`)".
- `services/xstockstrat-analysis/docs/context-constitution.md:23` (ANALYSIS-7) and
  `context-constitution-findings.md:28` mention `entry_backfill.py` only for the live-gate literal.
  Recon found no D-44/D-55/D-60 drift there (recon.md § Risks).
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped to the
  touched context files, or a manual reconciliation recorded in the PR body.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. In `CLAUDE.md:230`, replace "`ListOrders(strategy_id, symbol)` boot-time-only" with
   "`ListOrders(user_id, strategy_id, symbol)` + owner `x-user-id` (and a per-pass `x-trace-id`)
   boot-time-only". Leave the rest of the row unchanged.
2. Run `/context-forge:context-constitution refresh` scoped to `services/xstockstrat-analysis/`
   (CLAUDE.md + `docs/`), and fix any grounded drift it reports about `entry_backfill.py` or
   `StrategiesRepository`.
   - If the plugin is unavailable, re-read `CLAUDE.md` § Dependencies, ANALYSIS-7 and
     findings `:28` against the post-Step-7 code by hand.
   - Record in the integration PR body both that the plugin was unavailable and what was
     reconciled.

**Verification**:
```bash
grep -n "ListOrders(user_id, strategy_id, symbol)" services/xstockstrat-analysis/CLAUDE.md   # 1 hit
grep -n "ListOrders(strategy_id, symbol)" services/xstockstrat-analysis/CLAUDE.md            # expect no output
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
