# Implementation Spec: fix-mcp-target-user-authz

**Status**: `pending`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/111-fix-mcp-target-user-authz/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-mcp-target-user-authz`

---

## Execution Summary

Single-service fix (`xstockstrat-agent`, Python), grounded in `recon.md` + `design.md`. Step 1 adds
one shared claims-derivation primitive (`_require_claims`) and a thin `_caller_user_id` wrapper over
it, refactoring the existing `_caller_access_scope` to reuse `_require_claims` instead of duplicating
the claims-read-and-raise. Steps 3 and 5 then consume `_caller_user_id` in `emit_alert` (replacing
`target_user_id: str = ""` with a required `broadcast: bool`) and `manage_formula` (removing `author`
and `formula_author_user_id` entirely, deriving both the register-path `author` and the
update/delete-path `user_id` from the same caller identity). Each service step is paired with a test
step per C-08/P-06. Step 7 rewrites both tools' parameter/error tables in
`docs/runbooks/mcp-tools.md` per design.md's explicit Docs scope — no other doc surface (agent
`CLAUDE.md`, `plugins/strat-lab/`) references either tool's removed parameters (confirmed in recon).
No proto, migration, or config-key changes — both target RPC fields already exist and already accept
plain strings; only the agent's source for populating them changes.

Consumer Surface(s) (C-14): both named surfaces — the `emit_alert` and `manage_formula` Agent MCP
tools — are covered by Steps 3–6 directly; no `xstockstrat-ui` segment calls either tool (confirmed
in product-spec.md).

## Step Dependencies

- Step 2 [test] pairs Step 1 [service] — tests the new `_require_claims`/`_caller_user_id` helpers
  directly.
- Step 3 [service] requires Step 1 — calls `_caller_user_id`.
- Step 4 [test] pairs Step 3 [service].
- Step 5 [service] requires Step 1 — calls `_caller_user_id`.
- Step 6 [test] pairs Step 5 [service].
- Step 7 [docs] requires Steps 3 and 5 — documents the final parameter shapes of both tools.

---

### Step 1 — service: Add shared claims-derivation primitive `_require_claims` / `_caller_user_id`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability, OAuth edge-auth
correctness; Security — auth scope / caller-identity correctness

**Codebase Evidence**:
- `_claims_from_context(ctx: Context) -> dict | None` — `app/tools.py:59-74` — reads
  `scope["state"][MCP_CLAIMS_SCOPE_KEY]` off the request, returns `None` if absent.
- `_caller_access_scope(ctx: Context, tool: str) -> int` — `app/tools.py:77-93` — the function to
  refactor:
  ```python
  def _caller_access_scope(ctx: Context, tool: str) -> int:
      claims = _claims_from_context(ctx)
      if claims is None:
          raise RuntimeError(
              f"{tool} requires the Streamable HTTP transport, where the tool call itself "
              "is authenticated. No verified caller claims are present on this request, so the "
              "caller's role cannot be established. (The legacy SSE transport, which never "
              "authenticated individual tool calls, was removed by feature 079.)"
          )
      return roles_to_access_scope(claims.get("roles"))
  ```
- Notify's broadcast sentinel, confirming why an empty-string identity must never be silently
  derived: `packages/proto/notify/v1/notify.proto:34` (`Alert.target_user_id`, `// empty =
  broadcast`), `:56` (`EmitAlertRequest.target_user_id`).
- `MCP_CLAIMS_SCOPE_KEY` — `app/scopes.py:20`.

**TDD**: `red-green required`

**Instructions**:
1. In `app/tools.py`, insert a new module-level function `_require_claims(ctx: Context, tool: str)
   -> dict` immediately before `_caller_access_scope` (i.e. after `_claims_from_context`, currently
   ending at line 74). It is the single materialize-and-validate step both `_caller_access_scope` and
   the new `_caller_user_id` will share:
   ```python
   def _require_claims(ctx: Context, tool: str) -> dict:
       """Materialize and validate the caller's claims, raising if absent.

       Single choke point for "no verified claims on this request" — both
       ``_caller_access_scope`` (role-derived ``x-access-scope``) and ``_caller_user_id``
       (identity for ``emit_alert``/``manage_formula``) go through this so the raise condition
       and message live in exactly one place."""
       claims = _claims_from_context(ctx)
       if claims is None:
           raise RuntimeError(
               f"{tool} requires the Streamable HTTP transport, where the tool call itself "
               "is authenticated. No verified caller claims are present on this request, so the "
               "caller's role cannot be established. (The legacy SSE transport, which never "
               "authenticated individual tool calls, was removed by feature 079.)"
           )
       return claims
   ```
2. Refactor the existing `_caller_access_scope` (`app/tools.py:77-93`) to call `_require_claims`
   instead of duplicating the claims-read + raise, preserving its docstring and return behavior
   exactly:
   ```python
   def _caller_access_scope(ctx: Context, tool: str) -> int:
       """Derive the REAL caller's ``x-access-scope`` from their verified claims.
       ...(existing docstring unchanged)..."""
       claims = _require_claims(ctx, tool)
       return roles_to_access_scope(claims.get("roles"))
   ```
3. Add a new sibling function `_caller_user_id(ctx: Context, tool: str) -> str` immediately after
   `_caller_access_scope`, a thin wrapper over `_require_claims` that additionally raises when the
   claims' `user_id` is falsy — this is the fix for the accidental-broadcast footgun `design.md`
   identifies (an empty identity must never silently reach notify's `target_user_id=""` broadcast
   sentinel):
   ```python
   def _caller_user_id(ctx: Context, tool: str) -> str:
       """Derive the REAL caller's own user id from their verified claims, raising if empty.

       A thin wrapper over ``_require_claims`` for tools (``emit_alert``, ``manage_formula``)
       that need the caller's own identity rather than their access scope. Raises rather than
       returning "" on a falsy claims user_id: notify's EmitAlertRequest.target_user_id == ""
       means BROADCAST (packages/proto/notify/v1/notify.proto:34), so silently returning "" here
       would make a caller who explicitly chose not to broadcast broadcast anyway."""
       claims = _require_claims(ctx, tool)
       user_id = claims.get("user_id")
       if not user_id:
           raise RuntimeError(
               f"{tool} requires the caller's verified claims to carry a non-empty user_id, "
               "but none was present. Refusing rather than deriving an empty identity."
           )
       return user_id
   ```
4. Do not touch `emit_alert` or `manage_formula` in this step — that is Steps 3 and 5.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
python3 -c "import ast; ast.parse(open('app/tools.py').read())"  # syntax sanity, no runtime deps needed
grep -n "_require_claims\|_caller_user_id" app/tools.py  # both new functions present
```

---

### Step 2 — test: Direct unit tests for `_require_claims` / `_caller_user_id`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security — auth
scope / caller-identity correctness

**Codebase Evidence**:
- Existing import already brings in the fixtures this step reuses:
  `from tests.conftest import ADMIN, _ctx` — `tests/test_tools.py:14`.
- `ADMIN = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "http://x"}` —
  `tests/conftest.py:12`.
- `_ctx(claims: dict | None, *, with_request: bool = True)` — `tests/conftest.py:17-27` — builds a
  fake `Context`; `_ctx(None)` exercises the no-claims branch.
- Existing module-import pattern for reaching non-tool module internals directly:
  `from app import tools as tools_mod` — `tests/test_tools.py:547`.
- No existing direct test of `_caller_access_scope`'s `RuntimeError` branch (confirmed via recon —
  it is only exercised transitively through tool call sites, e.g.
  `tests/test_config_tools.py:254-259` `TestManagementToolsForwardDerivedScope::
  test_refuses_without_verified_claims`). This step is the first direct test of the shared surface.

**TDD**: `red-green required` — `_require_claims`/`_caller_user_id` do not exist before Step 1, so
this suite fails to import/collect against the pre-Step-1 tree.

**Instructions**:
Add a new test class near the top of `tests/test_tools.py` (after the existing imports/fixtures
block, before the `list_signal_sources` tests at line 53), importing `tools as tools_mod` the same
way `test_run_backtest_debug_info` does at line 547:
```python
class TestCallerIdentityHelpers:
    """Direct coverage of the shared claims primitive (feature 111) — both
    _caller_access_scope and _caller_user_id depend on it, so it is tested directly rather than
    only transitively through one consumer (Constitution C-10)."""

    def test_require_claims_raises_without_claims(self):
        from app import tools as tools_mod

        with pytest.raises(RuntimeError, match="Streamable HTTP"):
            tools_mod._require_claims(_ctx(None), "emit_alert")

    def test_caller_user_id_happy_path(self):
        from app import tools as tools_mod

        assert tools_mod._caller_user_id(_ctx(ADMIN), "emit_alert") == "u-1"

    def test_caller_user_id_raises_on_empty_user_id(self):
        from app import tools as tools_mod

        claims = {"user_id": "", "email": "x@y.z", "roles": ["trader"], "aud": "http://x"}
        with pytest.raises(RuntimeError):
            tools_mod._caller_user_id(_ctx(claims), "emit_alert")

    def test_caller_access_scope_still_raises_without_claims(self):
        """Regression: the Step 1 refactor of _caller_access_scope onto _require_claims must not
        change its observable raise behavior."""
        from app import tools as tools_mod

        with pytest.raises(RuntimeError, match="Streamable HTTP"):
            tools_mod._caller_access_scope(_ctx(None), "manage_strategy")
```
The `claims = {"user_id": "", ...}` literal is a scenario one-off with exactly one consumer in this
step (C-13) — it stays inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py::TestCallerIdentityHelpers -v
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 3 — service: `emit_alert` — replace `target_user_id` with required `broadcast: bool`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security — auth
scope / caller-identity correctness

**Codebase Evidence**:
- Current `emit_alert` tool, `app/tools.py:298-333`:
  ```python
  @server.tool()
  async def emit_alert(
      severity: str,
      category: str,
      title: str,
      body: str,
      source_service: str = "xstockstrat-agent",
      target_user_id: str = "",
      context: dict | None = None,
      tags: list[str] | None = None,
      correlation_id: str = "",
  ) -> dict:
      ...
      return await client.emit_alert(
          severity=severity,
          category=category,
          title=title,
          body=body,
          source_service=source_service,
          target_user_id=target_user_id,
          context=context,
          tags=tags,
          correlation_id=correlation_id,
      )
  ```
- `client.emit_alert` — `app/client.py:189-224` — unchanged by this step; still accepts
  `target_user_id: str = ""` and passes it straight to `EmitAlertRequest.target_user_id`
  (`:212`) — this step only changes what value `app/tools.py` computes before calling it.
- `manage_strategy`'s established `ctx: Context` first-parameter convention —
  `app/tools.py:442-443`.
- `ingest_signal`'s internal auto-alert — `app/tools.py:284-291` — a direct `client.emit_alert(...)`
  call (not through the `emit_alert` tool), hardcoding `target_user_id=""` at line 290. **Not
  touched by this step** — it is a system-decided broadcast, out of scope per product-spec.
- `_caller_user_id` — added by Step 1.

**TDD**: `red-green required`

**Instructions**:
1. In `app/tools.py`, change the `emit_alert` signature (currently `:298-309`) to add `ctx: Context`
   as the first parameter (mirrors `manage_strategy`, `app/tools.py:443`) and replace
   `target_user_id: str = ""` with `broadcast: bool` — **required, no default** — placed before the
   first defaulted parameter (`source_service`) so the signature stays syntactically valid (a
   parameter without a default cannot follow one that has a default):
   ```python
   @server.tool()
   async def emit_alert(
       ctx: Context,
       severity: str,
       category: str,
       title: str,
       body: str,
       broadcast: bool,
       source_service: str = "xstockstrat-agent",
       context: dict | None = None,
       tags: list[str] | None = None,
       correlation_id: str = "",
   ) -> dict:
   ```
2. Update the docstring: replace the `target_user_id: defaults to '' which BROADCASTS to all
   users; set it to target one user.` line (currently `:316`) with:
   ```
   broadcast: REQUIRED, no default. True sends a system-wide broadcast (unchanged semantic —
       target_user_id="" on the wire). False addresses the alert to the OAuth-authenticated
       caller's own derived identity — you can no longer address another user.
   ```
3. Replace the body (currently `:323-333`) to derive `target_user_id` from `broadcast` before
   calling `client.emit_alert`, which is otherwise called with the exact same keyword shape as
   today:
   ```python
   target_user_id = "" if broadcast else _caller_user_id(ctx, "emit_alert")
   return await client.emit_alert(
       severity=severity,
       category=category,
       title=title,
       body=body,
       source_service=source_service,
       target_user_id=target_user_id,
       context=context,
       tags=tags,
       correlation_id=correlation_id,
   )
   ```
4. Do not modify `app/client.py` — `client.emit_alert`'s signature and body are unchanged (design.md
   §"No client.py or proto changes").

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n "def emit_alert" -A 12 app/tools.py  # confirm ctx + broadcast, no target_user_id param
```

---

### Step 4 — test: Update `emit_alert` call sites; add broadcast/claims-derivation coverage

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security — auth
scope / caller-identity correctness

**Codebase Evidence**:
- Breaking call site 1 — `test_emit_alert_calls_grpc`, `tests/test_tools.py:302-322`:
  ```python
  result = await _tool_fn(server, "emit_alert")(
      severity="info", category="signal", title="Test alert", body="Body text"
  )
  ...
  mock_alert.assert_called_once_with(
      severity="info", category="signal", title="Test alert", body="Body text",
      source_service="xstockstrat-agent", target_user_id="", context=None, tags=None,
      correlation_id="",
  )
  ```
- Breaking call site 2 — `test_emit_alert_forwards_extra_fields`, `tests/test_tools.py:1153-1168`
  (no `ctx=`, no `target_user_id`/`broadcast`).
- `ADMIN`, `_ctx` already imported — `tests/test_tools.py:14`.

**TDD**: `red-green required` — this step's rewritten assertions fail against the pre-Step-3 tree
(old `emit_alert` has no `ctx`/`broadcast` params) and pass once Step 3 lands.

**Instructions**:
1. Update `test_emit_alert_calls_grpc` (`tests/test_tools.py:302-322`) to pass `ctx=_ctx(ADMIN)` and
   `broadcast=True`, keeping the `mock_alert.assert_called_once_with(...)` assertion's
   `target_user_id=""` (the broadcast=True → `""` mapping):
   ```python
   result = await _tool_fn(server, "emit_alert")(
       ctx=_ctx(ADMIN),
       severity="info",
       category="signal",
       title="Test alert",
       body="Body text",
       broadcast=True,
   )
   ```
2. Update `test_emit_alert_forwards_extra_fields` (`tests/test_tools.py:1153-1168`) to add
   `ctx=_ctx(ADMIN)` and `broadcast=True` to its call.
3. Add a new test asserting `broadcast=False` derives `target_user_id` from the caller's claims:
   ```python
   @pytest.mark.asyncio
   async def test_emit_alert_broadcast_false_derives_caller_identity():
       mock_alert = AsyncMock(return_value={"alert_id": "a2"})
       with patch.object(client, "emit_alert", mock_alert):
           server = _make_server()
           await _tool_fn(server, "emit_alert")(
               ctx=_ctx(ADMIN), severity="info", category="signal", title="t", body="b",
               broadcast=False,
           )
       assert mock_alert.call_args.kwargs["target_user_id"] == "u-1"
   ```
4. Add a test proving the removed parameter is actually rejected, not just unused (AC: "reject
   attempts to supply a caller-controlled identity parameter"):
   ```python
   @pytest.mark.asyncio
   async def test_emit_alert_rejects_caller_supplied_target_user_id():
       server = _make_server()
       with pytest.raises(TypeError):
           await _tool_fn(server, "emit_alert")(
               ctx=_ctx(ADMIN), severity="info", category="signal", title="t", body="b",
               broadcast=True, target_user_id="someone-else",
           )
   ```
5. Add a test for the `broadcast=False` + no-claims path (the RuntimeError path AC-3 requires,
   exercised at the tool level in addition to Step 2's direct-helper test):
   ```python
   @pytest.mark.asyncio
   async def test_emit_alert_broadcast_false_without_claims_raises():
       server = _make_server()
       with pytest.raises(RuntimeError, match="Streamable HTTP"):
           await _tool_fn(server, "emit_alert")(
               ctx=_ctx(None), severity="info", category="signal", title="t", body="b",
               broadcast=False,
           )
   ```

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -k emit_alert -v
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 5 — service: `manage_formula` — remove `author`/`formula_author_user_id`, derive both from claims

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security — auth
scope / caller-identity correctness

**Codebase Evidence**:
- Current `manage_formula` signature and body, `app/tools.py:565-659` (relevant excerpts):
  ```python
  @server.tool()
  async def manage_formula(
      operation: str,
      name: str | None = None,
      description: str | None = None,
      source: str | None = None,
      is_public: bool | None = None,
      formula_id: str = "",
      author: str = "",
      formula_author_user_id: str = "",
      parameters: list[dict] | None = None,
      outputs: list[dict] | None = None,
      warmup_period: int | None = None,
  ) -> dict:
      ...
      formula: dict = {
          "formula_id": formula_id,
          "user_id": formula_author_user_id,
          "author": author,
          "name": name or "",
          ...
      }
  ```
- Client passthrough — `app/client.py:558-628` — unchanged: `formula.get("author", "")` feeds
  `RegisterFormulaRequest.author` (`:592`), `formula["user_id"]` feeds
  `UpdateFormulaRequest.user_id` (`:605`) and `DeleteFormulaRequest.user_id` (`:624`).
- Proto contract confirming `author` was always meant to be claims-derived:
  `packages/proto/indicators/v1/indicators.proto:169` — `string author = 6; // set by BFF from JWT
  claims; stored immutably`. `:197` `UpdateFormulaRequest.user_id` and `:217`
  `DeleteFormulaRequest.user_id` — `// must match formula.author; returns PERMISSION_DENIED
  otherwise`.
- Backend proof that `author` and `user_id` are the same identity the indicators service already
  treats as one: `services/xstockstrat-indicators/app/handlers/servicer.py:317` —
  `if row["author"] != request.user_id and not self._has_admin_scope(context):` (mirrored for
  delete at `:416`).
- The live sentinel-impersonation hole this closes: `RegisterFormula`,
  `services/xstockstrat-indicators/app/handlers/servicer.py:215-216` — `if request.author: author =
  request.author` (accepts caller-supplied `author` verbatim when non-empty) — a caller could pass
  `author="system"`, the reserved sentinel at
  `services/xstockstrat-indicators/app/formulas/__init__.py:7` (`SYSTEM_AUTHOR = "system"`).
- `_caller_user_id` — added by Step 1.

**TDD**: `red-green required`

**Instructions**:
1. In `app/tools.py`, change the `manage_formula` signature (`:566-578`) to add `ctx: Context` as
   the first parameter, and remove `author: str = ""` and `formula_author_user_id: str = ""`
   entirely:
   ```python
   @server.tool()
   async def manage_formula(
       ctx: Context,
       operation: str,
       name: str | None = None,
       description: str | None = None,
       source: str | None = None,
       is_public: bool | None = None,
       formula_id: str = "",
       parameters: list[dict] | None = None,
       outputs: list[dict] | None = None,
       warmup_period: int | None = None,
   ) -> dict:
   ```
2. Update the docstring: remove the `author: stored immutably on register.` line (currently `:583`)
   and the `formula_author_user_id: required for update/delete; must match the formula's original
   author...` line (currently `:585-586`); replace both with:
   ```
   Ownership is always derived from the OAuth-authenticated caller's own verified identity — there
   is no author/formula_author_user_id parameter. On register, the caller becomes the formula's
   author. On update/delete, the caller's own identity is checked against the formula's stored
   author (PERMISSION_DENIED on mismatch) — you cannot assert someone else's ownership.
   ```
3. Replace the `formula: dict = {...}` construction (currently `:627-638`) to derive the identity
   once via `_caller_user_id` and use it for both fields:
   ```python
   user_id = _caller_user_id(ctx, "manage_formula")
   formula: dict = {
       "formula_id": formula_id,
       "user_id": user_id,
       "author": user_id,
       "name": name or "",
       "description": description or "",
       "source": source or "",
       "is_public": bool(is_public),
       "parameters": parameters or [],
       "outputs": outputs or [],
       "warmup_period": warmup_period or 0,
   }
   ```
4. Do not modify `app/client.py` — `client.manage_formula`'s signature and body are unchanged
   (design.md §"No client.py or proto changes").

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n "def manage_formula" -A 12 app/tools.py  # confirm ctx present, author/formula_author_user_id absent
grep -n "formula_author_user_id\|author: str" app/tools.py  # expect zero hits
```

---

### Step 6 — test: Update `manage_formula` call sites; add ownership-derivation coverage

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability; Security — auth
scope / caller-identity correctness

**Codebase Evidence**: every breaking call site enumerated explicitly (design.md requires the full
list, not an approximation):
- `TestManageFormulaTool.test_register_and_delete_paths` —
  `tests/test_tools.py:693-695` (register, no `ctx=`) and `:696-700` (delete, `formula_author_user_id="u1"`).
- `TestManageFormulaTool.test_register_carries_parameter_definitions` —
  `tests/test_tools.py:711-724` (register, no `ctx=`).
- `TestFormulaPartialUpdateTool.test_update_derives_mask_from_supplied_fields` —
  `tests/test_tools.py:1178-1183` (`formula_author_user_id="u1"`).
- `TestFormulaPartialUpdateTool.test_update_is_public_false_is_masked` —
  `tests/test_tools.py:1194-1199` (`formula_author_user_id="u1"`).
- `TestFormulaPartialUpdateTool.test_update_omitted_field_not_in_mask` —
  `tests/test_tools.py:1208-1212` (`formula_author_user_id="u1"`).
- `TestFormulaPartialUpdateTool.test_update_with_no_fields_raises` —
  `tests/test_tools.py:1220-1221` (`formula_author_user_id="u1"`).
- `ADMIN`, `_ctx` already imported — `tests/test_tools.py:14`.

**TDD**: `red-green required` — these six call sites fail against the pre-Step-5 tree (old
`manage_formula` requires `formula_author_user_id` on update/delete and has no `ctx` param) and pass
once Step 5 lands.

**Instructions**:
1. `tests/test_tools.py:693-695` (register) — add `ctx=_ctx(ADMIN)`:
   ```python
   await _tool_fn(server, "manage_formula")(
       ctx=_ctx(ADMIN), operation="register", name="rsi2", source="x = 1"
   )
   ```
2. `tests/test_tools.py:696-700` (delete) — replace `formula_author_user_id="u1"` with
   `ctx=_ctx(ADMIN)`:
   ```python
   await _tool_fn(server, "manage_formula")(
       ctx=_ctx(ADMIN), operation="delete", formula_id="f-1",
   )
   ```
3. `tests/test_tools.py:711-724` (register with parameters) — add `ctx=_ctx(ADMIN)`.
4. `tests/test_tools.py:1178-1183`, `:1194-1199`, `:1208-1212` (all three `update` calls) — replace
   `formula_author_user_id="u1"` with `ctx=_ctx(ADMIN)` in each.
5. `tests/test_tools.py:1220-1221` (`test_update_with_no_fields_raises`) — replace
   `formula_author_user_id="u1"` with `ctx=_ctx(ADMIN)`:
   ```python
   await _tool_fn(server, "manage_formula")(
       ctx=_ctx(ADMIN), operation="update", formula_id="f-1"
   )
   ```
6. Add a new test asserting register derives both `author` and `user_id` from the caller's claims
   (the AIP-161/ownership fix the design explicitly folds in):
   ```python
   @pytest.mark.asyncio
   async def test_register_derives_author_and_user_id_from_claims(self):
       server = _make_server()
       with patch.object(
           client, "manage_formula", AsyncMock(return_value={"formula_id": "f-3"})
       ) as m:
           await _tool_fn(server, "manage_formula")(
               ctx=_ctx(ADMIN), operation="register", name="rsi4", source="x = 1"
           )
       formula = m.call_args.kwargs["formula"]
       assert formula["author"] == "u-1"
       assert formula["user_id"] == "u-1"
   ```
   Add this to `TestManageFormulaTool` (after `test_register_and_delete_paths`,
   `tests/test_tools.py:686-703`).
7. Add a test proving the removed parameters are actually rejected (AC: "reject attempts to supply a
   caller-controlled identity parameter"):
   ```python
   @pytest.mark.asyncio
   async def test_rejects_caller_supplied_author_and_user_id(self):
       server = _make_server()
       with pytest.raises(TypeError):
           await _tool_fn(server, "manage_formula")(
               ctx=_ctx(ADMIN), operation="register", name="x", source="y = 1", author="system"
           )
       with pytest.raises(TypeError):
           await _tool_fn(server, "manage_formula")(
               ctx=_ctx(ADMIN), operation="delete", formula_id="f-1",
               formula_author_user_id="u1",
           )
   ```
   Add this to `TestManageFormulaTool` alongside the test in step 6.
8. Add a test for the no-claims path at the tool level:
   ```python
   @pytest.mark.asyncio
   async def test_refuses_without_verified_claims(self):
       server = _make_server()
       with pytest.raises(RuntimeError, match="Streamable HTTP"):
           await _tool_fn(server, "manage_formula")(
               ctx=_ctx(None), operation="register", name="x", source="y = 1"
           )
   ```
   Add this to `TestManageFormulaTool` alongside the tests in steps 6-7.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py -k "manage_formula or ManageFormula or FormulaPartialUpdate" -v
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 7 — docs: Rewrite `emit_alert` and `manage_formula` reference tables

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `emit_alert` section — `docs/runbooks/mcp-tools.md:230-264` (parameter table `:236-246` includes
  the `target_user_id` row `:243`; errors table `:260-263`).
- `manage_formula` section — `docs/runbooks/mcp-tools.md:541-589` (parameter table `:547-559`
  includes `author` `:558` and `formula_author_user_id` `:559`; errors table `:583-588` includes the
  `formula_author_user_id ≠ author` row `:585`).
- Recon confirmed (no other surface to update): no `plugins/strat-lab/` reference to either tool's
  removed parameters or to `emit_alert`/`manage_formula` at all; the `services/xstockstrat-agent/
  app/tools.py` module docstring (`:4-27`) and `services/xstockstrat-agent/CLAUDE.md`'s MCP Tools
  table describe both tools only by one-line purpose, not by parameter — no edit needed there
  (design.md scopes Docs to this file only).

**TDD**: `N/A (docs)`

**Instructions**:
1. Replace the `emit_alert` section (`docs/runbooks/mcp-tools.md:230-264`) in full:
   ```markdown
   ### `emit_alert`

   Emits an alert directly via `xstockstrat-notify`. Use for system-level alerts or notifications not tied to an ingested signal. Sends no security metadata (no shared secret, no admin `x-access-scope`): `EmitAlert` is an internal-service-caller RPC that is intentionally **not** role-gated (feature 092) — its trust boundary is the private network plus the agent's OAuth edge, and every caller (agent + internal service loops) is unauthenticated at the RPC layer. The alert's recipient is always derived from the OAuth-authenticated caller's own verified identity or an explicit system-wide broadcast (feature 111) — the caller can no longer address an alert to an arbitrary other user.

   **Parameters**

   | Parameter | Type | Required | Description |
   |---|---|---|---|
   | `severity` | `string` | Yes | Alert severity: `"info"`, `"warning"`, `"error"`, `"critical"` (unknown values coerce to `"info"`) |
   | `category` | `string` | Yes | Alert category, e.g. `"signal"`, `"system"` |
   | `title` | `string` | Yes | Short alert title |
   | `body` | `string` | Yes | Alert body text |
   | `broadcast` | `bool` | Yes | `true` sends a system-wide broadcast (`target_user_id=""` on the wire, unchanged semantic); `false` addresses the alert to the OAuth-authenticated caller's own derived identity. No default — omitting it is a schema error. |
   | `source_service` | `string` | No | Emitting service name (default `"xstockstrat-agent"`) |
   | `context` | `object` | No | Structured JSON context stored + fanned out with the alert (feature 087) |
   | `tags` | `string[]` | No | Tags for filtering/grouping (feature 087) |
   | `correlation_id` | `string` | No | Id to correlate related alerts (feature 087) |

   **Return**

   ```json
   { "alert_id": "3f9a1c2e-7b0d-4e5a-9c1f-2a6b8d0e4f11" }
   ```

   Unknown `severity` strings are silently coerced to `"info"` (valid values: `info`, `warning`,
   `error`, `critical`). `title` and `body` are required and non-blank — an empty or whitespace-only
   title or body is rejected `INVALID_ARGUMENT` by notify before the alert is persisted or delivered.

   **Errors**

   | Condition | Error |
   |---|---|
   | Empty or whitespace-only `title` or `body` | `invalid argument` (INVALID_ARGUMENT) from notify |
   | No verified OAuth claims on the request, when `broadcast=false` | `RuntimeError` — Streamable HTTP transport required |
   | Notify service unreachable | `httpx` connection error propagated |

   ---
   ```
2. Replace the `manage_formula` section (`docs/runbooks/mcp-tools.md:541-589`) in full:
   ```markdown
   ### `manage_formula`

   Registers, updates, or deletes a custom formula definition in `xstockstrat-indicators`. The formula's `author`/ownership identity is always derived from the OAuth-authenticated caller's own verified claims (feature 111) — it can no longer be asserted as a parameter.

   **Parameters**

   | Parameter | Type | Required | Description |
   |---|---|---|---|
   | `operation` | `string` | Yes | `"register"`, `"update"`, or `"delete"` |
   | `name` | `string` | register | Formula name (on update, pass only to change it) |
   | `description` | `string` | No | Formula description |
   | `source` | `string` | register | Python formula source (on update, pass only to change it; cannot be blanked) |
   | `is_public` | `bool` | No | Whether the formula is public (register default `false`) |
   | `parameters` | `list` | No | Typed parameter definitions `{name, type, default, description, required, min, max}` |
   | `outputs` | `list` | No | Declared secondary output series `{name, description}`; addressable in strategy rules as `<ref>.<name>`. The implicit `value` series is always present and must not be declared. |
   | `warmup_period` | `int` | No | Bars of warm-up before the formula's outputs are valid |
   | `formula_id` | `string` | update/delete | Formula identifier |

   **Ownership is derived, not asserted (feature 111).** `author` (register) and the ownership identity checked on `update`/`delete` are both the OAuth-authenticated caller's own `user_id` from their verified claims — there is no `author`/`formula_author_user_id` parameter. A caller can no longer register a formula under someone else's identity (including the reserved `"system"` sentinel), or claim someone else's ownership to update/delete a formula; the indicators backend's own PERMISSION_DENIED check (stored `author` vs. `user_id` mismatch) now always compares against the real caller.

   **Update is a partial merge (AIP-161).** Only the fields you pass are changed; omitted fields are
   preserved. Pass `is_public=false` to unpublish; omit it to leave it unchanged. At least one field
   must be supplied. `source` cannot be blanked. Use `get_formula`/`list_formulas` to read a formula
   back before editing.

   **Delete is a soft delete.** The formula is marked `deleted` (non-destructive), hidden from
   `list_formulas`, and can no longer be updated, but strategies that already reference it keep
   evaluating on its last-saved definition — and both their backtests (`run_backtest` →
   `warnings`) and live status (`get_strategy` → `warnings`) flag the deletion to the user. You
   cannot bind a **new** strategy to a deleted formula (`ManageStrategy` returns `INVALID_ARGUMENT`).

   **Return**

   ```json
   { "formula_id": "f-abc123" }
   ```

   register → `{"formula_id": …}`; update → the full stored formula in camelCase (incl. `deleted`);
   delete → `{"success": true}`.

   **Errors**

   | Condition | Error |
   |---|---|
   | Caller's derived identity ≠ the formula's stored `author` (update/delete) | `permission denied` (PERMISSION_DENIED) |
   | `update`/`delete` on unknown formula | `formula not found` (NOT_FOUND) |
   | `update` with no fields supplied | `update requires at least one field to change` |
   | `update` on a soft-deleted formula | `formula is deleted and cannot be updated` (FAILED_PRECONDITION) |
   | No verified OAuth claims on the request | `RuntimeError` — Streamable HTTP transport required |

   ---
   ```
3. Do not renumber or otherwise touch any other tool's section — this is a targeted rewrite of
   exactly these two sections' parameter/error tables (design.md §Docs: "full rewrite of both tools'
   parameter and error-code tables — old rows no longer apply, not an incremental edit").

**Verification**:
```bash
grep -n "target_user_id\|formula_author_user_id" docs/runbooks/mcp-tools.md  # expect zero hits
grep -n "\`broadcast\`" docs/runbooks/mcp-tools.md  # confirm new param documented
grep -c "^### \`" docs/runbooks/mcp-tools.md  # unchanged tool-section count before/after
```
Per root `CLAUDE.md` Teardown rule: this step changes a doc that describes tool behavior — run
`/context-scrubber scan` (scoped to `docs/runbooks/mcp-tools.md`) as the last step before pushing the
feature's final PR, and fix any grounded findings it reports.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
