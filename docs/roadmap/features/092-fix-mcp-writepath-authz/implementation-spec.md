# Implementation Spec: fix-mcp-writepath-authz

**Status**: `done`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/092-fix-mcp-writepath-authz/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-mcp-writepath-authz`

---

## Execution Summary

Close the F-11 write-path authorization gap in the order the design fixed as load-bearing:
**backends gated first, then the agent flips its forwarded scope.** Step 1 gates ingest's
`TriggerBackfill` (the quota-spending RPC) with the same admin check `CancelBackfill` already uses,
paired with Step 2's test. Step 3 switches notify to a compile-first test harness and pins the
deliberate `EmitAlert` internal-service-caller contract (no code gate — the design's adversary-ruled
decision). Step 4 flips the four hardcoded-admin agent tools (`manage_strategy`,
`manage_signal_source`, `set_strategy_live`, `trigger_backfill`) to the proven `set_config`
caller-derived-scope template and deletes the now-orphaned `_admin_metadata()`, paired with Step 5's
per-tool tests. Step 6 lands all documentation in the same PR (C-10). No proto, migration, or config
changes.

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** (ingest `TriggerBackfill` gate) — red-before-green pair.
- **Step 5 [test] covers Step 4 [service]** (agent tool flip) — red-before-green pair.
- **Step 4 requires Step 1**: `trigger_backfill`'s flip is a **no-op until the ingest gate lands**
  (product-spec § Sequencing). The other three tools hit backends that already gate, so their flip is
  meaningful immediately — but Step 1 must land in this same PR/branch stack before or with Step 4 so
  a legitimate admin is never denied and no gate-less backend starts trusting an unverified header.
- **Step 4 breaks existing agent tests by construction** (deleting `_admin_metadata()`; the
  `test_client.py` `"7"` assertions and `test_config_tools.py:262-264` reference the old behavior).
  Per the F-05 green-making-minimum split (insights.md 2026-07-27, feature 072 execute), Step 4's
  commit carries only the minimal test adaptations needed to keep collection/run green; Step 5 adds
  the new per-tool scope-forwarding + ctx-injection assertions (the red-before-green new coverage).
- **Step 6 [docs]** depends on Steps 1, 3, 4 being final (it describes their landed behavior); same PR.

---

### Step 1 — service: Gate ingest `TriggerBackfill` on admin scope

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `_has_admin_scope(context)` reads the propagated `x-access-scope` ADMIN bit (`access_scope & 0x04`):
  `services/xstockstrat-ingest/app/handlers/servicer.py:146-159` (confirmed via `grep -n "_has_admin_scope"`).
- The exact gate to copy — `CancelBackfill`'s two-line admin check:
  `servicer.py:587-588` → `if not self._has_admin_scope(context): await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")`.
  `ManageSignalSource` uses the identical gate at `:916-917`.
- `TriggerBackfill` today is UNGATED: `servicer.py:169-203` — only guard is `if self._db is None:`
  at `:170-172` (aborts `UNAVAILABLE`), then it queues the job and spawns the runner unconditionally
  (`asyncio.create_task(self._run_backfill(...))` at `:199`).
- `grpc` is already imported in this module (used at `:171`, `:588`).

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-ingest/app/handlers/servicer.py`, inside `TriggerBackfill`
   (`:169`), immediately **after** the `if self._db is None:` block (ends `:172`) and **before**
   `job_id = str(uuid.uuid4())` (`:173`), insert the verbatim `CancelBackfill` gate:
   ```python
   if not self._has_admin_scope(context):
       await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
       return
   ```
   Reuse `_has_admin_scope` (`:146`) as-is — do not add a new helper (DRY; it is the same check
   `CancelBackfill`/`ManageSignalSource` use). Order matters: the `_db is None` check stays first so
   an unconfigured DB still returns `UNAVAILABLE`, matching `CancelBackfill` (`:584` then `:587`).
2. Change nothing else in `TriggerBackfill` — the canonical-timeframe logic (`:181-198`) and the
   runner spawn (`:199`) are untouched.

**Verification**:
- `grep -n "_has_admin_scope\|_db is None" services/xstockstrat-ingest/app/handlers/servicer.py` —
  confirm the new gate appears between the `_db is None` abort and `job_id =` inside `TriggerBackfill`.
- Behavioral verification is the paired Step 2 test run.

---

### Step 2 — test: `TriggerBackfill` gate test + migrate bare-`MagicMock` cases; centralize `_ctx`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_cancel_backfill.py` — modify
- `services/xstockstrat-ingest/tests/conftest.py` — modify

**Reviewers**: xstockstrat-ingest owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `test_cancel_backfill.py` defines the reusable fake-context builder `_ctx(access_scope="4")`
  (`:34-45`): `invocation_metadata` carries `("x-access-scope", access_scope)` and
  `ctx.abort = AsyncMock(side_effect=Exception("aborted"))` (`:44`). The gate-denial assertion
  pattern is `test_cancel_without_admin_scope_aborts_permission_denied` (`:70-75`):
  `ctx = _ctx("0")`, `pytest.raises(Exception, match="aborted")`, then
  `assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED` (`:75`).
- `TestTriggerBackfill`-adjacent existing cases in `test_ingest_servicer.py` use **bare
  `MagicMock()`** contexts with no `x-access-scope` metadata (e.g. `context=MagicMock()` at
  `:116,130,138`), so once Step 1's gate lands they will hit `_has_admin_scope` → `& 0x04` on a
  MagicMock and misbehave — these must be migrated onto an admin-scoped context.
- `conftest.py` exists (`services/xstockstrat-ingest/tests/conftest.py`) but currently only holds
  `_setup_gen_path()` (`:14`) — no shared `_ctx`. This is the second consumer of `_ctx` (C-13).

**TDD**: `red-green required`

**Instructions**:
1. **Centralize `_ctx` (C-13 — second consumer).** Move the `_ctx(access_scope="4")` builder from
   `test_cancel_backfill.py:34-45` into `services/xstockstrat-ingest/tests/conftest.py` (the
   service's canonical Python fixture home). Import it in both `test_cancel_backfill.py` and
   `test_ingest_servicer.py`. Do not leave a second inline copy (this is exactly the C-13 trigger:
   two consumers force the literal into `conftest.py`). Keep `test_cancel_backfill.py`'s behavior
   identical after the import swap.
2. **Add the gate test** for `TriggerBackfill` in `test_ingest_servicer.py`, mirroring
   `test_cancel_without_admin_scope_aborts_permission_denied`:
   - `test_trigger_backfill_without_admin_scope_aborts_permission_denied`: build the servicer with a
     DB (so the `_db is None` guard passes), call `TriggerBackfill(TriggerBackfillRequest(...), _ctx("0"))`,
     assert `pytest.raises(Exception, match="aborted")` and
     `ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED`.
   - `test_trigger_backfill_with_admin_scope_queues`: call with `_ctx("4")` (ADMIN bit set) and assert
     the response `status == ingest_pb2.BACKFILL_STATUS_QUEUED` (AC1's "admin still gets a QUEUED job").
     Patch `backfill_jobs.insert_job` and the runner spawn as the existing servicer tests do so no real
     DB/task is required.
3. **Migrate the bare-`MagicMock` cases**: any existing `TriggerBackfill`-invoking case using
   `context=MagicMock()` gets `_ctx("4")` instead, so an admin-scoped context flows through the new
   gate. (The `ListBackfillJobs`/timeframe cases at `:106-138` do not call `TriggerBackfill`; leave
   those unless they invoke it.)

**Verification**:
- Red-before-green: run Step 2's two new cases against the pre-Step-1 tree — the denial case must
  **fail** (no gate yet, so it queues instead of aborting). After Step 1, both pass.
- `cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40` — confirm ≥ 40% and all pass.
- `cd services/xstockstrat-ingest && ruff check . && ruff format --check .` — lint/format gate.
- C-13 check: `grep -n "def _ctx\|from .conftest\|from conftest" services/xstockstrat-ingest/tests/*.py`
  — confirm exactly one `def _ctx` (in `conftest.py`), imported by both suites, no second inline copy.

---

### Step 3 — test: notify `EmitAlert` internal-caller contract + compile-first harness

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/package.json` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: xstockstrat-notify owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- **No code gate is added** (design §3, adversary-ruled). `emitAlert(call, callback)`
  (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:30`) reads only `call.request` (`:31`),
  writes the alert row (`:36-58`) and fans out synchronously (`:60+`). No RPC in this impl reads
  `metadata`/scope/`x-mcp-secret`. Every current caller is unauthenticated/internal (analysis loops
  send no metadata; the agent sends only `x-mcp-secret`), so an admin gate breaks all callers and
  `x-mcp-secret` enforcement inverts the trust boundary — the contract stays "private-network,
  internal-caller" and is proven by a test, not a gate.
- **074 zero-assertion trap present** (fails.md 2026-07-29): the test file wraps its import in
  `try { const mod = await import('../grpc/notifyServiceImpl.js'); ... } catch {}` (`:24-31`) and
  every case early-returns on `if (!NotifyServiceImpl) return;` (`:47,125,155,177,185,193`) — a
  *passing* skip. The `emitAlert` cases build `call = { request: {...} }` with no `metadata`
  (`:120-171`).
- Current scripts run against **source `.ts`** with strip-types:
  `package.json:12` `"test": "node --experimental-strip-types --test src/__tests__/*.test.ts"`,
  `:13` `test:coverage` same shape with `c8 ... --lines 40`.
- **Config's proven compile-first form** (verified-safe reference):
  `services/xstockstrat-config/package.json:12` `"test": "tsc && node --test dist/__tests__/*.test.js"`,
  `:13` `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`.
- notify `tsconfig.json` emits tests to `dist/`: `include: ["src/**/*"]` (`:14`), `outDir: "./dist"`
  (`:6`), `rootDir: "./src"` (`:7`) — so `dist/__tests__/*.test.js` will exist after `tsc`.
- Lint command: `package.json:14` `"lint": "eslint src --ext .ts"`.

**TDD**: `red-green required`

**Instructions**:
1. **Switch to the compile-first harness** in `services/xstockstrat-notify/package.json`, matching
   config verbatim in shape:
   - `"test": "tsc && node --test dist/__tests__/*.test.js"`
   - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
2. **Remove the silent skip** in `notifyServiceImpl.test.ts`:
   - Change the lazy import specifier to the compiled path and **drop the `try/catch`** at `:24-31` so
     an import failure throws instead of silently disabling every case (import from
     `'../grpc/notifyServiceImpl.js'` now resolves against `dist/`).
   - Remove every `if (!NotifyServiceImpl) return;` / `if (!impl) return;` early-return guard
     (`:47,70,95,125,155,177,185,193`).
   - Add a hard **"import succeeded"** assertion in a `before`/first test:
     `assert.ok(NotifyServiceImpl, 'NotifyServiceImpl import must succeed');` so a broken import goes
     RED instead of green-skipping.
3. **Add the EmitAlert internal-caller contract test**: a case that constructs
   `call = { request: {...valid alert...} }` **with no `metadata`**, calls `impl.emitAlert(call, cb)`
   against a mock `pool` (mirror the existing `capturedParams`/mock-pool pattern at `:133-149`), and
   asserts it **succeeds** — the DB `INSERT` ran (assert on the captured query params) and the
   callback resolved without error. This pins "EmitAlert accepts an unauthenticated internal caller"
   as the contract.
4. **Demonstrate a deliberate red** (074 backstop, per design §3 AC2 binding condition): temporarily
   stub an admin gate at the top of `emitAlert` (e.g. throw when metadata lacks `x-access-scope & 0x04`),
   run the suite, confirm the no-metadata contract test **fails**, then **revert the stub**. Record
   the observed red in the step's `context.md`/deviation note — do not leave the stub in the tree.

**Verification**:
- `cd services/xstockstrat-notify && pnpm run test:coverage` — confirm it compiles (`tsc`), the cases
  **execute** (non-zero assertions; the import-succeeded assert is present), coverage passes `--lines 40`.
- `cd services/xstockstrat-notify && pnpm run lint`.
- `grep -n "try {\|catch {\|if (!NotifyServiceImpl) return\|if (!impl) return" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`
  — confirm the silent-skip guards are gone.
- C-13 check: the alert `call.request` payload is a scenario one-off (single consumer, inline) —
  notify has no `src/__tests__/fixtures/` home and none should be created speculatively; record that
  verdict.

---

### Step 4 — service: Flip the four hardcoded-admin agent tools to caller-derived scope; delete `_admin_metadata()`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/scopes.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape); admin `x-access-scope` forwarded only by the management tools; OAuth 2.1 edge-auth correctness

**Codebase Evidence**:
- **The `set_config` template to mirror end-to-end:**
  - Tool side, `app/tools.py:786-872`: `ctx: Context` is the **first** parameter (`:787`);
    `claims = _claims_from_context(ctx)` (`:829`) with the None-claims → `RuntimeError` guard
    (`:830-836`); `access_scope = roles_to_access_scope(claims.get("roles"))` (`:858`); the client
    call passes `access_scope=access_scope` (`:869`).
  - Client side, `app/client.py:916-960`: `set_config` takes `access_scope: int` (`:925`) and sends
    `metadata=[*_metadata(), ("x-access-scope", str(access_scope))]` (`:960`), explicitly **not**
    `_admin_metadata()` (comment `:959`).
  - `_claims_from_context(ctx)` at `app/tools.py:43`; `roles_to_access_scope` imported from
    `app.scopes` (`app/tools.py:35`); mapping admin→15, trader→11, viewer→1, no-roles→0
    (`app/scopes.py:26-41`), `& 0x04` = ADMIN.
- **The four tools to flip (tool side, `app/tools.py`)** — each currently lacks `ctx`:
  `manage_strategy` (`:392`), `manage_formula` is **NOT** in scope (`:508`, ownership-based),
  `manage_signal_source` (`:579`), `set_strategy_live` (`:621`), `trigger_backfill` (`:643`).
  `set_config` (`:786`) is the only one with `ctx` today.
- **The four client wrappers (`app/client.py`)** — each calls `_admin_metadata()`:
  `manage_strategy` builds `meta = _admin_metadata()` (`:343`), `manage_signal_source` (`:520`),
  `set_strategy_live` (`:662`), `trigger_backfill` sends `metadata=_admin_metadata()` inline (`:767`).
- **`_admin_metadata()` definition** `app/client.py:30-32` (returns `[*_metadata(), ("x-access-scope","7")]`).
  Full ref sweep (absence claim for deletion, `grep -rn "_admin_metadata" services/xstockstrat-agent/`):
  the definition (`:30`), the four call sites (`:343,520,662,767`), two set_config **comments**
  referring to it by name (`:929,959`), the `scopes.py:10` docstring, and two **test** refs
  (`test_config_tools.py:264`, `test_streamable_http_auth.py:99`). After the four call sites flip,
  the function is orphaned in `app/` (only comments + tests reference it) → delete it.
- Backends all gate on ADMIN `0x04` (design §AC3, verified): analysis `ManageStrategy`
  (`servicer.py:1543-1546`), analysis `SetStrategyLive` (`:1697-1701`, NOT TRADING 0x08), ingest
  `ManageSignalSource` (`servicer.py:912-918`), ingest `TriggerBackfill` (Step 1's new gate).

**TDD**: `red-green required`

**Instructions**:
1. **Flip each of the four tools** (`manage_strategy`, `manage_signal_source`, `set_strategy_live`,
   `trigger_backfill`) in `app/tools.py` to the `set_config` template — **do not touch
   `manage_formula`** (ownership-based; design §Rejected Alternatives):
   - Add `ctx: Context` as the **first** parameter of each tool's signature.
   - After input validation, derive the caller's scope exactly as `set_config` does
     (`tools.py:829-836,858`):
     ```python
     claims = _claims_from_context(ctx)
     if claims is None:
         raise RuntimeError(
             "<tool> requires the Streamable HTTP transport, where the tool call itself "
             "is authenticated. No verified caller claims are present on this request..."
         )
     access_scope = roles_to_access_scope(claims.get("roles"))
     ```
     (reuse the same wording as `set_config`'s guard for consistency).
   - Pass `access_scope=access_scope` into the corresponding `client.<tool>(...)` call.
2. **Add `access_scope: int` to each of the four client wrappers** in `app/client.py`
   (`manage_strategy`, `manage_signal_source`, `set_strategy_live`, `trigger_backfill`) and replace
   `_admin_metadata()` with `[*_metadata(), ("x-access-scope", str(access_scope))]` — mirroring
   `client.set_config` (`:960`). For `trigger_backfill` this is the inline
   `metadata=_admin_metadata()` at `:767`.
3. **Delete `_admin_metadata()`** (`app/client.py:30-32`) once all four call sites no longer use it.
   Update the two `set_config` **comments** that name it (`client.py:929,959`) so they no longer refer
   to a deleted function (reword to "the caller's real derived scope, same as every management tool
   now forwards").
4. **Update `app/scopes.py` docstring** (`:8-11`): it currently documents `7 — the legacy hardcoded
   tuple in client._admin_metadata(), used by the other management tools (invariant AGENT-3)`. Rewrite
   so it no longer claims a live hardcoded-`7` path exists (all management tools now forward the
   caller's derived scope; `_admin_metadata()` is gone).
5. **F-05 green-making minimum** (see Step Dependencies): deleting `_admin_metadata()` breaks
   `test_config_tools.py:264` and the `test_client.py` `"7"` assertions at run time. Carry only the
   minimal adaptation needed to keep the suite from erroring in this step's commit; the full
   assertion rewrites are Step 5.

**Verification**:
- `grep -rn "_admin_metadata" services/xstockstrat-agent/app/` — returns **nothing** (definition and
  all `app/` call sites/comments gone).
- `grep -n "ctx: Context\|access_scope = roles_to_access_scope" services/xstockstrat-agent/app/tools.py`
  — confirm all four flipped tools plus `set_config` derive scope (five sites); `manage_formula`
  absent from the list.
- `grep -n 'access_scope' services/xstockstrat-agent/app/client.py` — confirm the four wrappers plus
  `set_config` accept `access_scope` and forward `("x-access-scope", str(access_scope))`.
- Behavioral verification is the paired Step 5 test run.
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .` — lint/format gate.
- Header propagation (C-03): these calls forward `x-access-scope` (not `x-user-id`/`x-trace-id`),
  matching `set_config` — the agent *originates* requests (AGENT-4; PLAT-4 N/A). No new propagation
  surface; the flip narrows an existing forwarded header from a constant to the caller's value.

---

### Step 5 — test: Per-tool caller-derived-scope + ctx-injection tests; flip the `"7"` assertions

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_streamable_http_auth.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape); admin `x-access-scope` forwarded only by the management tools

**Codebase Evidence**:
- **Scope-forwarding test template** `TestSetConfigForwardsRealScope` (`test_config_tools.py:184-227`):
  `test_forwards_the_admin_scope_derived_from_roles` calls the tool with `ctx=_ctx(ADMIN)` and asserts
  `write.await_args.kwargs["access_scope"] == 15` (`:203`); `test_forwards_a_non_admin_scope_unchanged`
  uses `ctx=_ctx(TRADER)` (`:217`) → 11 (`:225-227`). The `_ctx(claims)` builder is at `:35`.
- **ctx-injection guard template** `TestSdkWiring` (`test_config_tools.py:251-259`):
  `assert server._tool_manager.get_tool("set_config").context_kwarg == "ctx"` (`:256`) and
  `assert "ctx" not in props` where `props = ...get_tool("set_config").parameters["properties"]`
  (`:258-259`) — proves `ctx` is SDK-wired and absent from the public `inputSchema`.
- **The invariant test to REWRITE** `test_other_management_tools_still_use_the_hardcoded_admin_tuple`
  (`test_config_tools.py:262-264`): asserts `client._admin_metadata()[-1] == ("x-access-scope", "7")`
  — this whole premise inverts (there is no `_admin_metadata()` and no hardcoded `7`).
- **The `test_client.py` `"7"` assertions to flip** (`grep -n '"7"'`):
  `TestManageStrategyClient` `:102` (`assert ("x-access-scope", "7") in meta`),
  `TestSetStrategyLiveClient` `:295`, `TestTriggerBackfillClient` `:328`;
  `TestManageSignalSourceClient` currently asserts *no* scope (`:256` region — the omit-credentials
  case) and its call at `:267` will need an `access_scope` argument.
- **Comment referencing `_admin_metadata()`** in `test_streamable_http_auth.py:99` (inside the
  `set_config` real-transport proof) — reword, do not assert the deleted function.

**TDD**: `red-green required`

**Instructions**:
1. **Per-tool scope-forwarding tests** (mirror `TestSetConfigForwardsRealScope`) for each of
   `manage_strategy`, `manage_signal_source`, `set_strategy_live`, `trigger_backfill` — in
   `test_config_tools.py` (or the relevant tool's test module, matching where `set_config`'s live):
   - admin claims (`_ctx(ADMIN)`) → the client wrapper receives `access_scope == 15` (has `0x04`).
   - a non-admin (`_ctx(TRADER)` → 11, and/or `_ctx(VIEWER)` → 1) → `access_scope` carries **no**
     `0x04`; assert the derived value is forwarded unchanged (the backend gate — not the agent — does
     the rejection; the agent's job is to forward the *real* scope). Reuse the `ADMIN`/`TRADER`
     claim constants already in `test_config_tools.py`.
2. **ctx-injection guard per tool** (mirror `TestSdkWiring:252-259`): for each of the four flipped
   tools assert `get_tool("<name>").context_kwarg == "ctx"` and `"ctx" not in ...parameters["properties"]`,
   proving `ctx` is SDK-wired and hidden from the public `GET /api/tools` schema. Also add the
   None-claims → `RuntimeError` case per tool (mirror `test_refuses_without_verified_claims`
   `:160-173`, which uses `ctx=_ctx(None)`).
3. **Rewrite the invariant test** `test_other_management_tools_still_use_the_hardcoded_admin_tuple`
   (`test_config_tools.py:262-264`) to assert the **new** invariant: all four management tools forward
   the caller's derived `x-access-scope`, none hardcode `"7"`, and `_admin_metadata` no longer exists
   (e.g. `assert not hasattr(client, "_admin_metadata")`). Rename it to match (e.g.
   `test_all_management_tools_forward_the_callers_derived_scope`).
4. **Flip the `test_client.py` `"7"` assertions** (`:102,295,328`) to assert the wrapper forwards the
   `access_scope` it was given (e.g. call with `access_scope=15` → `("x-access-scope","15") in meta`;
   call with `access_scope=11` → `("x-access-scope","11") in meta`). Update
   `TestManageSignalSourceClient` (`:256,267`) to pass `access_scope` and assert the forwarded tuple.
5. **Reword the `test_streamable_http_auth.py:99` comment** so the `set_config` real-transport proof
   no longer references `client._admin_metadata()` as a live contrast (the contrast is now "the
   hardcoded `7` that used to exist"). The assertion at `:100` (`access_scope == 15`) is unchanged.

**Verification**:
- Red-before-green: the new per-tool `access_scope == 15` (admin) and ctx-injection assertions must
  **fail** against the pre-Step-4 tree (tools have no `ctx`, wrappers hardcode `7`), and pass after.
- `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` — confirm ≥ 40% and all pass.
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .` — lint/format gate.
- `grep -rn '"7"' services/xstockstrat-agent/tests/` — no remaining assertion that a management tool
  forwards the hardcoded `"7"`.
- C-13 check: the `_ctx`/`ADMIN`/`TRADER` claim helpers already live in `test_config_tools.py` and are
  reused, not re-declared — confirm no second inline `_ctx` copy is introduced
  (`grep -n "def _ctx" services/xstockstrat-agent/tests/*.py`).

---

### Step 6 — docs: Re-forge invariants + same-PR surface parity (C-10)

**Status**: `done`
**Service**: `docs/` + service `CLAUDE.md`s + `plugins/strat-lab/`
**Files**:
- `services/xstockstrat-agent/docs/context-constitution.md` — modify (AGENT-3, AGENT-4)
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify (F-11)
- `services/xstockstrat-agent/CLAUDE.md` — modify (§ Management-tool authorization; header line)
- `services/xstockstrat-ingest/CLAUDE.md` — modify (`TriggerBackfill` now admin-gated)
- `services/xstockstrat-notify/CLAUDE.md` — modify (EmitAlert internal-caller contract + harness)
- `docs/runbooks/mcp-tools.md` — modify (per-tool authz)
- `docs/roadmap/features/092-fix-mcp-writepath-authz/product-spec.md` — modify (behavior-change call-out)
- `plugins/strat-lab/skills/backtest/SKILL.md` — **verify only** (see instruction 8)

**Reviewers**: none

**Codebase Evidence**:
- **AGENT-3** (`context-constitution.md:17`) states admin scope is a hardcoded `("x-access-scope","7")`
  via `_admin_metadata()` on write RPCs with `set_config` as the "one documented exception" — and its
  evidence line refs (`app/client.py:32,298,466,608,713`) are **already stale** (real sites were
  343/520/662/767). **AGENT-4** (`:18`) scopes the caller-derived amendment to `set_config` only and
  says "every other management tool keeps `_admin_metadata()`".
- **F-11 finding** row (`context-constitution-findings.md:46`): "`TriggerBackfill` is ungated
  server-side while `CancelBackfill` is admin-gated; the agent's 'admin-scoped' label is decorative
  (unverified `x-access-scope=7`)".
- **Agent CLAUDE.md** § Management-tool authorization groups `manage_formula` with the hardcoded-admin
  forwarders ("The management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`,
  `set_strategy_live`, `trigger_backfill`) forward a hardcoded admin `x-access-scope`") — **wrong**,
  `manage_formula` is ownership-based; and the header line ("the management tools forward a hardcoded
  admin `x-access-scope` ... with one exception, `set_config`") is now obsolete.
- **Ingest CLAUDE.md** does not currently note `TriggerBackfill` admin-gating (Role/Ports sections
  only). **Notify CLAUDE.md** describes `EmitAlert` fan-out (`:26-34`) but nothing about the
  authorization contract or the test harness.
- **mcp-tools.md** `trigger_backfill` §568 says "**Write/management op** — sends `x-mcp-secret`
  **and** the hardcoded admin `x-access-scope`" (`:571`); `set_config` §689-691 documents the
  real-role forwarding as the exception. These per-tool authz notes need updating for the four
  flipped tools.
- **strat-lab** (`grep -rn` over `plugins/strat-lab/`): the backtest skill references
  `manage_strategy`, `trigger_backfill`, `set_strategy_live` but only describes the **partial-merge
  mutation guard** (feature 070) — it contains **no** authorization/admin-scope/PERMISSION language
  for these tools. So the root-CLAUDE.md same-PR mandate is satisfied by verification: no authz text
  exists there to update.

**TDD**: `N/A (docs)`

**Instructions**:
1. **AGENT-3** (`context-constitution.md:17`): rewrite so admin scope on the management write tools is
   the **caller's derived `x-access-scope`** (via `app/scopes.py` `roles_to_access_scope`), no longer a
   hardcoded `("x-access-scope","7")`; `_admin_metadata()` removed. Drop the "`set_config` is the one
   exception" framing (it generalized). Fix the stale evidence line refs.
2. **AGENT-4** (`:18`): update — the caller-derived-scope forwarding now applies to **all** management
   tools (`manage_strategy`, `manage_signal_source`, `set_strategy_live`, `trigger_backfill`,
   `set_config`), not just `set_config`; still no `x-user-id`/`x-trace-id`.
3. **F-11 finding** (`context-constitution-findings.md:46`): mark resolved by feature 092 — ingest
   `TriggerBackfill` now admin-gated, agent forwards the caller's real scope.
4. **Agent CLAUDE.md** § Management-tool authorization: drop the hardcoded-admin language; state all
   management write tools forward the caller's derived scope; **correct the `manage_formula` grouping**
   (it is ownership-based via the indicators author check, not a scope forwarder). Update the header
   paragraph accordingly.
5. **Ingest CLAUDE.md**: note `TriggerBackfill` is admin-gated (`_has_admin_scope`, `x-access-scope &
   0x04`), matching `CancelBackfill`/`ManageSignalSource`.
6. **Notify CLAUDE.md**: document the `EmitAlert` **internal-service-caller contract** (private-network
   gRPC-only; trust boundary is the network + the agent's OAuth edge; no per-call role check — every
   caller is internal/unauthenticated) and the compile-first test harness (`tsc && node --test dist/...`).
7. **mcp-tools.md**: update `trigger_backfill` (§568), `manage_strategy` (§408), `manage_signal_source`
   (§536), `set_strategy_live` per-tool authz notes to "forwards the **caller's** derived
   `x-access-scope`; a non-admin is rejected `PERMISSION_DENIED` by the backend" (the `set_config`
   wording at §689-691 becomes the shared model, not an exception). Note the intended access change.
8. **strat-lab (verify only)**: re-run `grep -rn "admin\|scope\|PERMISSION\|authoriz" plugins/strat-lab/`
   — if it still surfaces no authorization text for `manage_strategy`/`set_strategy_live`/`trigger_backfill`
   (only partial-merge guidance), make **no change** and record the verification. Update only if authz
   text is found (root CLAUDE.md § strat-lab-plugin same-PR mandate).
9. **product-spec.md**: add the intended-behavior-change call-out — post-flip, non-admin OAuth
   operators (trader=11, viewer=1) lose `manage_strategy`/`manage_signal_source`/`set_strategy_live`/
   `trigger_backfill` (backends require ADMIN 0x04); this is the F-11 fix, not a regression (design
   § Open Risks).

**Verification**:
- `grep -rn "_admin_metadata\|hardcoded admin" services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/docs/context-constitution.md`
  — no live "hardcoded admin"/`_admin_metadata` claim remains (except historical "used to be" framing).
- `grep -n "manage_formula" services/xstockstrat-agent/CLAUDE.md` — confirm it is no longer grouped
  with the scope-forwarding management tools.
- `grep -n "hardcoded admin\|caller" docs/runbooks/mcp-tools.md` — confirm `trigger_backfill` et al.
  describe caller-derived scope.
- `grep -rn "admin\|scope\|PERMISSION\|authoriz" plugins/strat-lab/` — record the verify verdict.
- Run `/context-scrubber scan` scoped to the touched context files (Teardown rule) and fix grounded
  findings.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
