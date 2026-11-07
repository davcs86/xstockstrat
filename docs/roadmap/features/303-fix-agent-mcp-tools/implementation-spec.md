# Implementation Spec: fix-agent-mcp-tools

**Status**: `pending`
**Created**: 2026-11-07
**Feature**: `docs/roadmap/features/303-fix-agent-mcp-tools/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-agent-mcp-tools`

---

## Execution Summary

Follows `design.md` (approved, 5 rounds) and its advisory decomposition, re-derived by grep against
tree `feature/fix-agent-mcp-tools@78c9dac ≡ origin/feature/fix-agent-mcp-tools (merged origin/main-dev@0d97dda)`; every cited `app/tools.py`, `app/client.py` and test line was re-verified by `/sdd-review impl-spec` on `@cedad85` (same code, spec commit only added).
All nine steps are on one consumer surface (**C-14**): the Agent MCP tools of `xstockstrat-agent`
(all 45, as seen by any MCP client); no UI, proto, migration, config key or backend change. No step adds
an outbound gRPC call, so the header-propagation rule (§B) is not triggered.

Order: the mapper first (Steps 1-2: `CODE: body`, collapse of internal detail, the two `pass_messages`
sites), then the client argument error (Steps 3-4), then the 47 gRPC refusals (Steps 5-6), then the 52
hand-written refusals plus the AST guard (Steps 7-8), then docs (Step 9). Each code step is paired with
the test step whose edits it turns red elsewhere, as an atomic unit (`**Lands with**`): execute commits
one step at a time and F-05 forbids a red commit. The 67 `pytest.raises` flips were **measured, not
estimated**: a scratch copy of the service with the Step 1/5/7 conversions applied failed on exactly the
20 (Step 6) and 47 (Step 8) assertions listed below, and the other 24 of the 91
`pytest.raises(RuntimeError|ValueError|PermissionError)` stayed green.

**Spec-time resolutions of design open points (recorded, not silent):**

1. *Merge state (design Open Risks, last item)*: `git log origin/main-dev -- services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/client.py`
   shows `c2e3703` (#1464, feature 294) and `149ca1f` (#1466, feature 295) already on `main-dev`, and
   `docs/roadmap/features/merge-order.md` has no 303 row → **no `merge-order.md` row is needed**.
   Features 296/298 (`spec-ready`) and 299 (`draft`) have no spec that edits `app/tools.py` yet.
2. *Line numbers* in this spec are from the tree above. Steps 1, 2 and 5-8 shift later line numbers in
   `app/tools.py` and the touched test files, so every edit is also anchored by quoted text or by the
   enclosing test name; locate by the anchor when the line has moved.
3. *`tools_ast_nodes` / `_rpc_error` centralization (C-13)*: both reach a second consumer in Step 2, so
   both move to `tests/conftest.py` there. `dispatch_error` and `_PROBES` have exactly one consumer file
   (`test_tool_errors.py`) and stay module-local (compliant: one consumer → inline).
4. *Inline `AioRpcError` builders that stay inline* (single consumer each, scenario one-offs):
   `test_offline_client.py:474`, `test_ingest_signal_watchlist.py:114/:181/:221`, `test_client.py:944/:986`,
   `test_account_tools.py:145/:161`, `test_watchlist_tools.py:85/:163`, `test_tools.py:2026`,
   `test_signal_source_reliability_weight.py:106`, `test_formula_deadline.py:25`.

**Verification environment (applies to every step's `**Verification**`):** run once before Step 1:
`cd services/xstockstrat-agent && uv sync --frozen --extra dev && python3 -m pip install ruff` — `ruff` is
not in the `dev` extra (`pyproject.toml:22`); CI installs it with `pip install ruff uv`
(`.github/workflows/ci.yml:389-396`), and the verifications use `uv run --no-sync` so they need that sync.

**Scenario Coverage (C-15):**

| Scenario | Covered by step(s) |
|---|---|
| AC-1 | 6 |
| AC-2 | 2 (mapper row), 6 (dispatch) |
| AC-3 | 2 (mapper rows + WARN), 6 (dispatch rows) |
| AC-4 | 4 |
| AC-5 | 2 (loopback + drift), 6 (flip to `ToolError`) |
| AC-6 | 6 (sweep), 8 (FR-1 AST guard) |
| AC-7 | 8 |
| AC-8 | 8 |
| AC-9 | 6 |
| AC-10 | 8 |
| AC-11 | 8 |

**Carried open risks (from `design.md`; none needs a step beyond what is listed):** UNAVAILABLE pass-string
drift (Step 2 drift test + `ci.yml` filter); feature 299's `log_reader` can read the new WARN, and its
`query_logs` must raise `ToolError` (Step 9 rewrites AGENT-5, which 299's recon reads); converted refusals
log INFO without a traceback instead of ERROR (accepted); still-masked crashes by declaration (FR-4);
config `INVALID_ARGUMENT (got: <value>)` echo and unpinned backend-detail echo (operator-waived, OQ2).
Rebase-only overlaps (`/sdd-review impl-spec` overlap scan, no FAIL): feature 299 (`draft`) edits the same
`app/tools.py`, `docs/runbooks/mcp-tools.md` and the tool count — **299 must add a `query_logs` entry to
`_PROBES` in `tests/test_tool_errors.py`** (Step 6's sweep asserts set equality with `list_tools()`) and
raise `ToolError`, not `RuntimeError`; features 297/298 edit other keys of `ci.yml`'s `changes` filter
(different keys from Step 2's `xstockstrat-agent` line). Whichever merges second rebases; no
`merge-order.md` row is required.

## Step Dependencies

- Steps 1+2 land together (`reference/step-constraints.md` §C): Step 1 changes every mapper return
  text, which turns three existing assertions red (`test_tools.py` `match="boom"` on UNAVAILABLE,
  `test_grpc_error_message_passes_through_server_deadline_detail`, `test_offline_client.py`
  `assert str(excinfo.value) == details`) until Step 2 edits them. Step 2 also adds the
  `ANALYSIS_ENDPOINT` loopback test that needs Step 1's `pass_messages`.
- Steps 3+4 land together: Step 3 has no test of its own, so its red proof is Step 4's (written and shown
  RED first on the pre-Step-3 tree, then Step 3's code lands). Step 4 requires Step 2 (`dispatch_error`
  helper and `tests/conftest.py` `_rpc_error`).
- Steps 5+6 land together: Step 5 converts the 47 `except grpc.aio.AioRpcError` raises to `ToolError`,
  which turns the 20 `pytest.raises(RuntimeError)` lines in Step 6's table red. Step 6 requires Steps 1-2.
- Steps 7+8 land together: Step 7 converts the 52 hand-written refusals, which turns the 47 lines in
  Step 8's table red. Step 8 requires Step 5 (its AST guard asserts every raise in `app/tools.py`).
- Step 9 requires Steps 1-8 (it documents the final state; the full suite there re-runs the doc-parity
  tests).

---

### Step 1 — service: gRPC error mapper emits `CODE: body`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "^def _grpc_error_message" services/xstockstrat-agent/app/tools.py` → `:225`; it ends at `:254` (`return exc.details() or str(code)`); `_score_strategy` starts at `:257`. Current signature `(exc, not_found="not found", *, deadline_s=None, write=False)`; the `DEADLINE_EXCEEDED` branch returns server `details` verbatim when it is not grpc's sentinel `"Deadline Exceeded"`, else `"upstream did not respond[ within Ns] (deadline exceeded); <tail>"` with tail `outcome unknown, verify before retrying` on writes, `retry shortly` on reads.
- Confirmed via: `grep -c "except grpc.aio.AioRpcError" services/xstockstrat-agent/app/tools.py` → 47 and `grep -c "_grpc_error_message(" …` → 48 (47 calls + the def). Call shape the deadline AST guard walks: `tests/test_tool_deadlines.py:303-327` (`_mapper_calls`), kwargs `deadline_s` / `write` unchanged by this step.
- Confirmed via: `log = logging.getLogger(__name__)` at `tools.py:97` (logger name `app.tools`).
- The two `pass_messages` sites: `_score_strategy` (`tools.py:257-271`, mapper call with `not_found=e.details() or "no eligible evidence"`, `write=True`; backend string `"fundamentals availability unknown — grade unchanged"` at `services/xstockstrat-analysis/app/handlers/servicer.py:2660-2663`) and `manage_offline_account` (`tools.py:2279`, mapper call at `:2382-2392` with `write=operation not in ("get_order", "list_orders", "list_positions")`; backend string `"positions not published; re-confirm to retry"` at `services/xstockstrat-trading/internal/service/trading.go:1001`, `codes.Unavailable`).
- Validated in a scratch copy of the final state (Steps 1-8 applied, outside the repo): the function below passes the 21-row mapper table of Step 2 and the full agent suite (732 passed, 88% coverage against the 40% gate; the scratch tree needed symlinks to the sibling `docs/`, `plugins/`, `services/xstockstrat-ui` and `-analysis`/`-trading` paths that the doc-parity and drift tests read).

**Lands with**: `Step 2`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. In `app/tools.py`, immediately above `def _grpc_error_message` (before `:225`), add the constants and replace the whole function body. Final code (mirrors the validated scratch copy):

```python
_PASS_THROUGH_CODES = frozenset(
    {
        grpc.StatusCode.FAILED_PRECONDITION,
        grpc.StatusCode.PERMISSION_DENIED,
        grpc.StatusCode.INVALID_ARGUMENT,
        grpc.StatusCode.ALREADY_EXISTS,
        grpc.StatusCode.OUT_OF_RANGE,
        grpc.StatusCode.UNAUTHENTICATED,
        grpc.StatusCode.RESOURCE_EXHAUSTED,
        grpc.StatusCode.ABORTED,
    }
)
# Exact backend strings a call site allow-lists for UNAVAILABLE; a cross-service contract pinned by
# tests/test_tool_errors.py::test_unavailable_pass_strings_match_backend_sources.
_SCORE_UNAVAILABLE_PASS = frozenset({"fundamentals availability unknown — grade unchanged"})
_OFFLINE_UNAVAILABLE_PASS = frozenset({"positions not published; re-confirm to retry"})
_RETRY_TAIL = "retry shortly"
_WRITE_TAIL = "outcome unknown, verify before retrying"
_WITHHELD_HINT = "upstream error, details withheld; report it"


def _grpc_error_message(
    exc: grpc.aio.AioRpcError,
    not_found: str = "not found",
    *,
    deadline_s: float | None = None,
    write: bool = False,
    pass_messages: frozenset[str] = frozenset(),
) -> str:
    """Map a gRPC error to `CODE: body` for an MCP tool caller."""
    code = exc.code()
    name = code.name
    details = exc.details() or ""
    tail = _WRITE_TAIL if write else _RETRY_TAIL
    if code == grpc.StatusCode.DEADLINE_EXCEEDED:
        # grpc's client-side sentinel is exactly this literal; other text came from the server.
        if details and details != "Deadline Exceeded":
            return f"{name}: {details}"
        head = "upstream did not respond"
        if deadline_s is not None:
            head += f" within {deadline_s:g}s"
        # A client deadline does not prove a write failed.
        return f"{name}: {head} (deadline exceeded); {tail}"
    if code == grpc.StatusCode.NOT_FOUND:
        if details and not_found in details:
            return f"{name}: {details}"
        return f"{name}: {not_found}: {details}" if details else f"{name}: {not_found}"
    if code in _PASS_THROUGH_CODES:
        return f"{name}: {details or name.replace('_', ' ').lower()}"
    if code == grpc.StatusCode.UNAVAILABLE and details in pass_messages:
        return f"{name}: {details}"
    log.warning("backend error withheld from tool caller: code=%s details=%r", name, details)
    if code == grpc.StatusCode.UNAVAILABLE:
        return f"{name}: upstream unavailable; {tail}"
    if code == grpc.StatusCode.CANCELLED:
        return f"{name}: upstream call cancelled; {tail}"
    return f"{name}: {_WITHHELD_HINT}" + (f"; {_WRITE_TAIL}" if write else "")
```

2. In `_score_strategy`'s mapper call (`tools.py:262-270`), add `pass_messages=_SCORE_UNAVAILABLE_PASS,` after `write=True,`. In `manage_offline_account`'s mapper call (`:2384-2391`), add `pass_messages=_OFFLINE_UNAVAILABLE_PASS,` after the `write=operation not in (...)` line. Do **not** change the `raise RuntimeError(` wrapper at either site here (Step 5 does it).
3. Do not touch any other call site: `deadline_s=` / `write=` kwargs stay exactly as they are, because `tests/test_tool_deadlines.py::test_every_catch_site_passes_deadline_s` and `::test_mutating_tool_catch_sites_pass_write_explicitly` walk them.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
(Run together with Step 2 — the unit's single verification.) Expect all green, then
`grep -n "pass_messages" app/tools.py` shows the parameter plus exactly two call-site uses.

---

### Step 2 — test: mapper table, WARN, drift guard, loopback, shared helpers, CI filter

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_errors.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_tool_deadlines.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_mtls_backend_errors.py` — modify
- `services/xstockstrat-agent/tests/test_offline_client.py` — modify
- `services/xstockstrat-agent/tests/test_score_trailer_loopback.py` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "_rpc_error" services/xstockstrat-agent/tests/*.py` → three local copies: `test_tool_deadlines.py:51` and `test_tools.py:918` (both `(code, details="")` → `AioRpcError(code, Metadata(), Metadata(), details=details)`), and `test_mtls_backend_errors.py:21` (`(code)` only). `tests/test_tool_errors.py` is the fourth consumer → centralize (C-13 second-consumer rule).
- Confirmed via: `tests/test_tool_deadlines.py:303-322` — `_mapper_calls` is an `ast` walker yielding `(innermost enclosing function name, call)` for `_grpc_error_message` calls, skipping the `_grpc_error_message` body; Step 8's raise guard is its second consumer → generalize to `tools_ast_nodes(node_type)` in `conftest.py`.
- Confirmed via: `tests/conftest.py:167-209` — `hung_backend`; `:201` `context.abort(outcome, "rejected")` hard-codes the detail; the docstring documents the answer shapes `(delay_s, msg)`, `(delay_s, msg, trailers)`, `(delay_s, grpc.StatusCode)`.
- Confirmed via: `tests/test_tools.py:1668-1671` (`err = _rpc_error(grpc.StatusCode.UNAVAILABLE, "boom")` … `pytest.raises(RuntimeError, match="boom")`, in `TestTriggerBackfillTool::test_any_grpc_error_maps_through_grpc_error_message`), `:2124-2126` (three `assert _grpc_error_message(err, …) == details` in `test_grpc_error_message_passes_through_server_deadline_detail`), `tests/test_offline_client.py:494` (`assert str(excinfo.value) == details`, parametrized over `("INVALID_ARGUMENT", …)` and `("UNAVAILABLE", "positions not published; re-confirm to retry")`). These three are the only suite failures after Step 1 (measured).
- Confirmed via: `.github/workflows/ci.yml:59` → `xstockstrat-agent:      ['services/xstockstrat-agent/**']` in the `changes` job filter block; the `python-test` job (`:405-477`) checks out the whole repo and runs `uv run --no-sync pytest --cov=app … --cov-fail-under=40`, so sibling sources are readable by `Path(__file__).resolve().parents[3]` (idiom already used at `tests/test_tools_endpoint.py:13`).
- Confirmed via: backend strings are anchored in source: `servicer.py:2660-2663` (`grpc.StatusCode.UNAVAILABLE,\n "fundamentals availability unknown — grade unchanged"`) and `trading.go:1001` (`codes.Unavailable, "positions not published; re-confirm to retry"`); the same analysis literal also appears in a log line at `servicer.py:1421`, so the drift regex must be anchored on `StatusCode.UNAVAILABLE,\s*` (validated: it matches exactly once in each file).

**Lands with**: `Step 1`

**TDD**: red-green required

**Covers**: AC-2, AC-3, AC-5

**Instructions**:
1. `tests/conftest.py`: add `import ast` at the top (conftest imports the `pathlib` module, not `Path` — write `pathlib.Path(__file__)…`); add module-level `_rpc_error(code, details="")` (`AioRpcError(code, Metadata(), Metadata(), details=details)`, importing `grpc.aio` inside the function with `# noqa: PLC0415` like the neighbours) and `tools_ast_nodes(node_type)` (the `_mapper_calls` walker generalized: parse `app/tools.py` via `pathlib.Path(__file__).resolve().parents[1] / "app" / "tools.py"`, yield `(enclosing function name, node)` for every node that is an instance of `node_type`, skipping the `_grpc_error_message` body). In `hung_backend._handle` change `context.abort(outcome, "rejected")` to `context.abort(outcome, rest[0] if rest else "rejected")` and extend its docstring: `(delay_s, grpc.StatusCode[, details])`.
2. `tests/test_tool_deadlines.py`: delete the local `_rpc_error` (`:51-54`) and the now-unused `from pathlib import Path` (`:8`; `Path` was used only inside `_mapper_calls`); import `_rpc_error, tools_ast_nodes` from `tests.conftest` (extend the existing `from tests.conftest import ADMIN, HANG_GUARD_S, _ctx` line at `:16`); reimplement `_mapper_calls()` as `for fn_name, node in tools_ast_nodes(ast.Call): if isinstance(node.func, ast.Name) and node.func.id == "_grpc_error_message": yield fn_name, node`. `_kwarg` and both consumers stay as they are.
3. `tests/test_tools.py`: delete the local `_rpc_error` (`:918-922`) and add `_rpc_error` to the existing `from tests.conftest import ADMIN, HANG_GUARD_S, _ctx` (`:22`). `:1668`: change the injected code to `grpc.StatusCode.FAILED_PRECONDITION` (keep detail `"boom"` and `pytest.raises(RuntimeError, match="boom")` — Step 6 flips the class). `:2124-2126`: compare against `expected = f"DEADLINE_EXCEEDED: {details}"` for all three assertions.
4. `tests/test_mtls_backend_errors.py`: delete the local `_rpc_error` (`:21-22`), import it from `tests.conftest` (extend the existing `from tests.conftest import ADMIN, HANG_GUARD_S, _ctx`), and drop the now-unused `Metadata` import (`:9`: `from grpc.aio import AioRpcError, Metadata`).
5. `tests/test_offline_client.py:494`: `assert str(excinfo.value) == f"{code}: {details}"` (both parametrized rows hold: INVALID_ARGUMENT passes through, the UNAVAILABLE row passes through via `_OFFLINE_UNAVAILABLE_PASS`).
6. `tests/test_score_trailer_loopback.py`: add the imports `import grpc`, `from mcp.server.mcpserver import MCPServer`, `from app import client, tools` (extend the existing `from app import client`) and `from tests.conftest import ADMIN, _ctx`, and add `test_unavailable_detail_round_trips_em_dash(hung_backend, bound_admin)` (AC-5): `hung_backend("ANALYSIS_ENDPOINT", answers={"ScoreStrategy": (0, grpc.StatusCode.UNAVAILABLE, "fundamentals availability unknown — grade unchanged")})`, build `MCPServer("test-agent")` + `tools.register_tools`, fetch `server._tool_manager.get_tool("manage_strategy").fn`, `await fn(_ctx(ADMIN), operation="score", strategy_id="s")` inside `pytest.raises(RuntimeError) as exc_info` (Step 6 flips it to `ToolError`), assert `str(exc_info.value) == "UNAVAILABLE: fundamentals availability unknown — grade unchanged"`.
7. Create `tests/test_tool_errors.py` with, at this step: (a) module header + imports (`re`, `logging`, `pathlib`, `pytest`, `grpc`, `ToolError`, `UnexpectedToolError`, `MCPServer`, `AsyncMock`, `patch`, `tools`, `client`, `ADMIN`, `_rpc_error`); the `async def dispatch_error(name, args, *, claims=ADMIN) -> ToolError` helper (returns the `ToolError` instance, i.e. `exc_info.value`, so callers write `raised = await dispatch_error(...)` and `str(raised)`; it patches `tools._claims_from_context` to return the claims — `server.call_tool` injects a ctx with none, see `test_tools.py:795-807` — calls `MCPServer("test-agent")` + `tools.register_tools(server)` `.call_tool(name, args)` inside `pytest.raises(ToolError)`, then `assert type(exc_info.value) is ToolError`, because `UnexpectedToolError` subclasses `ToolError`); (b) `test_mapper_table` — parametrized rows `(id, code, details, kwargs, expected)`: `fp`, `pd_empty` (`PERMISSION_DENIED: permission denied`), `ia`, `ae`, `oor`, `unauth_empty` (`UNAUTHENTICATED: unauthenticated`), `re`, `ab`, `nf_empty`, `nf_same`, `nf_contains` (`not_found="no eligible evidence"`, details `no eligible evidence — run a backtest` → body = details), `not_found_other` (**AC-2**: `not_found="config key not found"`, details `config key not registered: analysis.foo` → `NOT_FOUND: config key not found: config key not registered: analysis.foo`), `deadline_server`, `deadline_sentinel_read` (`DEADLINE_EXCEEDED: upstream did not respond within 10s (deadline exceeded); retry shortly`), `deadline_sentinel_write` (no `deadline_s`, `write=True`), `unavail_pass` (details in `pass_messages` → verbatim), `unavail_not_listed` (grpc-core `failed to connect … ipv4:10.0.0.1:50056` → `UNAVAILABLE: upstream unavailable; retry shortly`), `unavail_write` (`…; outcome unknown, verify before retrying`), `cancelled` (`CANCELLED: upstream call cancelled; retry shortly`), `internal_read` / `internal_write` (**AC-3** hints), `unimplemented`; (c) `test_mapper_warns_on_withheld_details(caplog)` — one WARNING on logger `app.tools` containing `code=INTERNAL` and the detail, and none for FAILED_PRECONDITION (**AC-3**); (d) `test_unavailable_pass_strings_match_backend_sources` — reads `services/xstockstrat-analysis/app/handlers/servicer.py` and `services/xstockstrat-trading/internal/service/trading.go` via `Path(__file__).resolve().parents[3]`, asserts `re.search(rf'StatusCode\.UNAVAILABLE,\s*"{re.escape(s)}"', analysis)` and `re.search(rf'codes\.Unavailable,\s*"{re.escape(s)}"', trading)`, plus `tools._SCORE_UNAVAILABLE_PASS == {s1}` / `tools._OFFLINE_UNAVAILABLE_PASS == {s2}`. A missing sibling file **fails** (plain `read_text()`), never skips.
8. `.github/workflows/ci.yml:59`: change to `xstockstrat-agent:      ['services/xstockstrat-agent/**', 'services/xstockstrat-analysis/app/handlers/servicer.py', 'services/xstockstrat-trading/internal/service/trading.go']`, so a producer-side change to either pass-string re-runs the agent suite.
9. Format with `ruff format` / fix imports with `ruff check --fix`; wrap lines > 100 columns (a scratch draft of this file tripped E501 only).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_errors.py tests/test_score_trailer_loopback.py tests/test_tool_deadlines.py tests/test_offline_client.py -q \
 && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . \
 && cd ../.. && grep -n "xstockstrat-agent:" .github/workflows/ci.yml | grep -c "servicer.py.*trading.go"
```
Expect the last count to be `1`. RED proof (executor, before Step 1's code): the new mapper-table, WARN and loopback tests fail on the pre-change tree.

---

### Step 3 — service: `ClientArgumentError` for client.py argument refusals

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "raise ValueError(" services/xstockstrat-agent/app/client.py` → 21 sites at `:504, :668, :733, :751, :980, :1208, :1234, :1459, :1962, :2072, :2074, :2078, :2083, :2085, :2094, :2166, :2411, :2414, :2489, :2491, :2601`; no other `raise` type exists in the file (`grep -n "raise " app/client.py` shows only these).
- Confirmed via: client.py's own `except ValueError` catches at `:345` (around `_iso_to_timestamp(valid_until)`), `:1058`, `:1170` (formula output), `:1228` (`FundamentalMetric.Value`), `:2165` (`BackfillStatus.Value`). A `ToolError`+`ValueError` subclass keeps all of them working (validated: full suite green with the class in place).
- Confirmed via: `_iso_to_timestamp` at `client.py:105-111` (`datetime.fromisoformat(...)` raises a `ValueError` whose text echoes the input); callers `:243, :248, :344, :661-662, :1964-1965, :2024-2026, :2087-2088`.
- Confirmed via: `set_config` at `client.py:2279-2330`: `:2308-2316` `cv = config_pb2.ConfigValue()` then `cv.int_val = int(value)` (`:2310`) / `cv.float_val = float(value)` (`:2312`) / `cv.bool_val = …` (`:2314`) / `cv.string_val = value` (`:2316`); `int("12abc")` raises `invalid literal for int() … '12abc'` and the protobuf int64 assignment of `99999999999999999999` raises `Value out of range: 99999999999999999999`, both echoing the value; the conversion runs before `mtls.secure_channel` opens, so no RPC is sent on failure.
- SDK: `mcp.server.mcpserver.exceptions.ToolError` is a plain-message `MCPServerError(Exception)`; `class X(ToolError, ValueError)` builds (MRO validated). `client.py` has no `mcp` import today (imports at `:6-19`: `grpc`, `google.protobuf.*`, `from app import mtls`).
- Declared out of scope (FR-4, still masked crashes): implicit `float()`/`int()` casts of caller input at `client.py:169, :171, :725, :734, :757, :1219, :2498-2499`.

**Lands with**: `Step 4`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. After `from google.protobuf.timestamp_pb2 import Timestamp` (`:16`) add `from mcp.server.mcpserver.exceptions import ToolError` (keep isort order: third-party block before `from app import mtls`).
2. After `log = logging.getLogger(__name__)` (`:21`) add:
   ```python
   class ClientArgumentError(ToolError, ValueError):
       """An argument refusal raised before any RPC; its text is caller-safe and reaches the caller."""
   ```
3. Replace all 21 `raise ValueError(` in `client.py` with `raise ClientArgumentError(` (leave every `except ValueError` as is). After items 3-5, `grep -c "raise ClientArgumentError(" app/client.py` is 23 (the 21 replaced + the one in `_iso_to_timestamp` + the one in `set_config`) and `grep -n "raise ValueError(" app/client.py` finds nothing.
4. `_iso_to_timestamp`: wrap the body in `try:` … `except (ValueError, TypeError, OverflowError, AttributeError): raise ClientArgumentError("value is not a valid ISO-8601 timestamp") from None` and `return ts` after the block (no echo of `iso_str`).
5. `set_config`: wrap the whole value-conversion chain (`client.py:2308-2316`) in one `try/except (ValueError, TypeError, OverflowError)`. The `try` must contain the protobuf field assignment, not just `int()`/`float()` (the int64 overflow is raised by `cv.int_val = …` and echoes the value). Final code — the existing four-way chain moves inside the `try` unchanged:
   ```python
   cv = config_pb2.ConfigValue()
   try:
       if value_type == "int":
           cv.int_val = int(value)
       elif value_type == "float":
           cv.float_val = float(value)
       elif value_type == "bool":
           cv.bool_val = value.strip().lower() in ("true", "1", "yes")
       else:
           cv.string_val = value
   except (ValueError, TypeError, OverflowError):
       raise ClientArgumentError(f"value is not a valid {value_type}") from None
   ```
   (`cv.is_secret = is_secret` and everything after stay below the `try`, unchanged. The bool and string branches cannot raise; they sit inside only to keep the chain intact.)
6. No conversion may be added inside any gRPC path of `client.py` (273 `@AC-5`/`@AC-10`; 247 `@AC-1`).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . \
 && ! grep -n "raise ValueError(" app/client.py && test "$(grep -c 'raise ClientArgumentError(' app/client.py)" -eq 23
```
Existing client tests (`test_client.py`, `test_broker_account_client.py`, `test_offline_client.py`, `test_watchlist_client.py`, `test_strategy_builders.py`, `test_template_tools.py`) stay green unmodified because `ClientArgumentError` is a `ValueError`.

---

### Step 4 — test: malformed `set_config` value is refused without echo

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_errors.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: Step 2 creates `dispatch_error` and imports `_rpc_error` in `tests/test_tool_errors.py`; Step 3 creates `client.ClientArgumentError`.
- Confirmed via: `set_config` tool at `app/tools.py:1834-1899` — `_caller_access_scope(ctx, "set_config")`, `_caller_user_id(ctx, "set_config")`, `env = _resolve_scope("")`, then `client.set_config(...)`; with `ADMIN` claims and `value_type="int"` the call reaches the conversion in `client.set_config` (validated in a scratch run).
- Confirmed via: the client opens its stub inside the function (`from gen.config.v1 import config_pb2, config_pb2_grpc`, `client.py:2305`), so patching `config_pb2_grpc.ConfigServiceStub` intercepts the real stub path; AC-4 must mock `ConfigServiceStub`, **not** `client.set_config`, or the conversion under test is bypassed.

**Lands with**: `Step 3`

**TDD**: red-green required

**Covers**: AC-4

**Instructions**:
1. Add to `tests/test_tool_errors.py`: `_SET_CONFIG_ARGS = {"namespace": "analysis", "key": "a", "value_type": "int", "value": "5", "reason": "r"}` (reused by Step 6) and
   `test_set_config_bad_int_is_refused_without_echo` parametrized over `"12abc"` and `"99999999999999999999"`: `from gen.config.v1 import config_pb2_grpc`; `stub_cls = MagicMock()`; `with patch.object(config_pb2_grpc, "ConfigServiceStub", stub_cls): raised = await dispatch_error("set_config", {**_SET_CONFIG_ARGS, "key": "analysis.x", "value": value})`; assert `str(raised) == "Error executing tool set_config: value is not a valid int"`, `value not in str(raised)`, and `stub_cls.assert_not_called()` ("no SetConfig RPC is sent").
2. Add `test_iso_to_timestamp_refuses_without_echo` (`client._iso_to_timestamp("not-a-date-xyz")` raises `client.ClientArgumentError` whose text is `value is not a valid ISO-8601 timestamp` and does not contain the input) and `test_client_argument_error_is_both_tool_error_and_value_error` (`issubclass` of `ToolError` and `ValueError`).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_errors.py -q -k "set_config or iso_to_timestamp or client_argument" \
 && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
RED proof (executor, before Step 3's code): the AC-4 rows fail with `UnexpectedToolError` (the type assertion in `dispatch_error`).

---

### Step 5 — service: the 47 backend-refusal raises become `ToolError`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: the 47 `except grpc.aio.AioRpcError` sites at `app/tools.py` lines `261, 389, 423, 458, 485, 525, 672, 771, 868, 944, 1170, 1275, 1293, 1309, 1322, 1336, 1376, 1467, 1507, 1555, 1580, 1613, 1630, 1672, 1690, 1744, 1762, 1795, 1826, 1892, 1909, 1938, 2010, 2024, 2036, 2051, 2079, 2103, 2120, 2208, 2271, 2382, 2472, 2497, 2524, 2553, 2584`; each raises `RuntimeError(_grpc_error_message(...)) from e` (15 one-line and 32 multi-line shapes). A single regex `raise RuntimeError\((\s*)_grpc_error_message\(` → `raise ToolError(\1_grpc_error_message(` converted exactly 47 in the scratch run.
- Confirmed via: `app/tools.py:72` `from mcp.server.mcpserver import Context, MCPServer` is the only `mcpserver` import; `ToolError` is imported nowhere in `app/` today (`grep -rn ToolError app tests` → none).
- SDK contract: `tools/base.py:208-213` re-raises `ToolError` as `ToolError("Error executing tool <name>: <text>")` and anything else as `UnexpectedToolError("Error executing tool <name>")`; `server.py:441-456` logs `ToolError` at INFO without a traceback, others at ERROR.
- Telemetry unaffected: `agent.backend.rpc_errors` is counted at the channel (`app/mtls.py:39-56`); `mcp.tool.duration` scores both outcomes as `error` (`app/tool_metrics.py:87-92`, `:121-133`).
- The swallowed post-commit failures are not converted: `except Exception` at `tools.py:683, :705, :721, :881` stay (durable `consolidate-watchlist-signal.feature` `@AC-4`).

**Lands with**: `Step 6`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add `from mcp.server.mcpserver.exceptions import ToolError` directly after `from mcp.server.mcpserver import Context, MCPServer` (`:72`).
2. At each of the 47 sites replace `raise RuntimeError(` with `raise ToolError(` where the argument is `_grpc_error_message(...)` (keep `from e`; do not touch `deadline_s=`/`write=`/`not_found=`/`pass_messages=` arguments). Do **not** convert any other `raise` in this step.
3. Leave the 52 hand-written refusals and 4 allow-listed internal raises for Step 7.

**Verification**:
```bash
cd services/xstockstrat-agent && ! grep -n "raise RuntimeError(_grpc_error_message" app/tools.py \
 && ! grep -nB1 -E "^\s+_grpc_error_message\($" app/tools.py | grep "raise RuntimeError(" \
 && grep -c "raise ToolError(" app/tools.py
```
Expect the two `!` checks to print nothing and the count to be `47`. Then run the full unit verification together with Step 6.

---

### Step 6 — test: flip the 20 gRPC-path assertions; dispatch, sweep, characterization and durable edit

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_errors.py` — modify
- `services/xstockstrat-agent/tests/test_account_tools.py` — modify
- `services/xstockstrat-agent/tests/test_formula_deadline.py` — modify
- `services/xstockstrat-agent/tests/test_list_opportunities_deadline.py` — modify
- `services/xstockstrat-agent/tests/test_mtls_backend_errors.py` — modify
- `services/xstockstrat-agent/tests/test_offline_client.py` — modify
- `services/xstockstrat-agent/tests/test_signal_source_reliability_weight.py` — modify
- `services/xstockstrat-agent/tests/test_tool_deadlines.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify
- `services/xstockstrat-agent/tests/test_score_trailer_loopback.py` — modify
- `services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Measured (scratch copy with Step 1 + Step 5 applied, tests unmodified): exactly these 20 `pytest.raises(RuntimeError, …)` lines fail; flipping only them returns the suite to green. **Rule**: a test that injects an `AioRpcError` through a `tools.py` path flips here. Line numbers are pre-Step-2 originals — locate by the enclosing test name:

| File | Line | Enclosing test |
|---|---|---|
| `test_account_tools.py` | 150 | `test_deregister_permission_denied_maps_to_runtimeerror` |
| `test_account_tools.py` | 169 | `test_update_credentials_ibkr_incomplete_maps_invalid_argument` |
| `test_formula_deadline.py` | 91 | `test_deadline_error_names_the_derived_deadline` |
| `test_list_opportunities_deadline.py` | 59 | `test_ac2_hung_analysis_read_fails_fast_with_deadline_error` |
| `test_mtls_backend_errors.py` | 62 | `test_list_opportunities_deadline_is_attributed_to_analysis` |
| `test_offline_client.py` | 485 | `test_manage_offline_account_confirm_order_surfaces_error_details` |
| `test_signal_source_reliability_weight.py` | 114 | `test_manage_out_of_range_weight_is_surfaced_as_tool_error` |
| `test_tool_deadlines.py` | 72 | `_timed_error` (helper; serves 7 tests) |
| `test_tool_deadlines.py` | 281, 289 | `test_instantiate_template_deadline_after_bearer_is_not_success` |
| `test_tool_deadlines.py` | 403 | `test_six_unmapped_tools_now_map` |
| `test_tools.py` | 634 | `test_run_backtest_maps_permission_denied_to_tool_error` |
| `test_tools.py` | 1208 | `TestManageStrategyTool::test_grpc_error_reraised_as_clear_message` |
| `test_tools.py` | 1270 | `TestManageStrategyScore::test_server_detail_surfaces_in_error` |
| `test_tools.py` | 1670 | `TestTriggerBackfillTool::test_any_grpc_error_maps_through_grpc_error_message` |
| `test_tools.py` | 1697 | `TestGetBackfillStatusTool::test_not_found_maps_to_backfill_job_not_found` |
| `test_tools.py` | 1836 | `TestGetStrategyTool::test_not_found_is_a_clear_message` |
| `test_tools.py` | 2030 | `TestRunFundamentalsScanTool::test_backend_permission_denied_surfaces_as_runtime_error` |
| `test_watchlist_tools.py` | 90 | `test_get_watchlist_permission_denied_maps_to_runtimeerror` |
| `test_watchlist_tools.py` | 171 | `test_manage_watchlist_delete_system_list_refused` |

- Confirmed via: `tests/test_tools.py:795-807` — `server.call_tool("run_backtest", …)` is the in-repo precedent for dispatch-level calls; it patches `_caller_user_id` because the framework-injected ctx carries no claims. `dispatch_error` (Step 2) patches `tools._claims_from_context` instead, so admin claims reach `_caller_access_scope` and `_caller_user_id`.
- Confirmed via: `inspect`-listing of the registered server — `list_tools()` returns the 45 tools; required parameters per tool listed by name (e.g. `set_config`: `namespace, key, value_type, value, reason`; `trigger_backfill`: `symbols`; `list_templates`: `kind`). The probe table below was validated in a scratch run (all 45 pass).
- Confirmed via: durable `services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature:52` tag line `  @AC-7 @FR-5 @feature-164` and `:57` `    Then the tool raises a RuntimeError conveying the permission denial` (the rule goes false when the `manage_account` PERMISSION_DENIED path stops raising `RuntimeError`, i.e. in this step).
- Characterization: `UnexpectedToolError` is exported from `mcp.server.mcpserver.exceptions` (`['MCPServerError','ResourceError','ResourceNotFoundError','ToolError','UnexpectedResourceError','UnexpectedToolError']`).

**Lands with**: `Step 5`

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-5, AC-6, AC-9

**Instructions**:
1. In each file of the table add `from mcp.server.mcpserver.exceptions import ToolError` (isort-ordered) and change the listed `pytest.raises(RuntimeError…)` to `pytest.raises(ToolError…)`, keeping `match=`/`as exc_info`. Where an assertion compares against a message verbatim, make it prefix-aware (none other than the Step 2 edits were needed in the scratch run).
2. `test_account_tools.py:150` (**AC-9**): after the flip set `match` to `r"PERMISSION_DENIED: account does not belong to caller"` so the test pins both the code name and the denial (the mocked detail stays in the test, not in the durable suite).
3. `test_score_trailer_loopback.py`: change the `pytest.raises(RuntimeError)` added in Step 2 to `pytest.raises(ToolError)` (**AC-5**).
4. `tests/test_tool_errors.py` — add:
   - `test_dispatch_refusal_reaches_caller` (**AC-1**): `patch.object(client, "set_config", AsyncMock(side_effect=_rpc_error(grpc.StatusCode.FAILED_PRECONDITION, "ambiguous config key spelling: a and b both exist")))`, `dispatch_error("set_config", _SET_CONFIG_ARGS)`; `str(raised) == "Error executing tool set_config: FAILED_PRECONDITION: ambiguous config key spelling: a and b both exist"`.
   - the **AC-2** row: `NOT_FOUND` `"config key not registered: analysis.foo (env=staging, user=global); pass create_key=true to register it"` with `key="analysis.foo"` → `"Error executing tool set_config: NOT_FOUND: config key not found: <that hint>"`.
   - **AC-3** rows (parametrized: patch the client function, `caplog.at_level(logging.WARNING, logger="app.tools")`): `get_config` ← `client.get_config` `INTERNAL` `"pq: connection refused 10.0.0.12:25060"`, args `{"namespace": "analysis"}`, hint `upstream error, details withheld; report it`; `manage_strategy` ← `client.score_strategy` `UNAVAILABLE` `"evidence store unavailable"`, args `{"operation": "score", "strategy_id": "s"}`, hint `upstream unavailable; outcome unknown, verify before retrying`. Assert text `== f"Error executing tool {tool}: {code.name}: {hint}"`, detail not in text, and one WARNING from `app.tools` containing `code=<CODE>` and the detail.
   - `test_every_tool_refusal_is_a_tool_error` (**AC-6**, never cut): module-level `_PROBES: dict[str, dict]` with one entry per tool — `query_bars {symbol}`, `query_fundamentals {symbol}`, `list_signal_sources {}`, `extract_email_content {source_slug, urls: ["https://x.example"]}`, `extract_website_content {source_slug}`, `ingest_signal {source, symbol, direction: "long", valid_from}`, `emit_alert {severity, category, title, body, broadcast: True}`, `run_backtest {strategy_id, symbols}`, `screen_symbols {symbols}`, `manage_strategy {operation: "score", strategy_id}`, `manage_formula {operation: "delete", formula_id}`, `get_formula {formula_id}`, `list_formulas {}`, `list_fundamental_metrics {}`, `list_templates {kind: "formula"}`, `instantiate_template {kind: "formula", template_id}`, `manage_signal_source {operation: "deactivate", slug}`, `set_strategy_live {strategy_id, live_enabled: True}`, `trigger_backfill {symbols}`, `run_fundamentals_scan {}`, `get_backfill_status {}`, `cancel_backfill {job_id}`, `test_formula {source}`, `list_strategies {}`, `list_opportunities {}`, `get_strategy {strategy_id}`, `get_config {namespace}`, `list_config_keys {namespace}`, `set_config _SET_CONFIG_ARGS`, `get_user_metadata {}`, `set_user_metadata {display_name}`, `manage_user {operation: "set_active", user_id, active: True}`, `list_users {}`, `get_user {user_id}`, `admin_get_user_metadata {user_id}`, `admin_set_user_metadata {user_id, display_name}`, `list_watchlists {}`, `get_watchlist {watchlist_id}`, `manage_watchlist {operation: "delete", watchlist_id}`, `manage_watchlist_symbols {operation: "remove", watchlist_id, symbols}`, `manage_offline_account {operation: "list_orders", account_id}`, `manage_account {operation: "deregister", account_id}`, `list_accounts {}`, `get_positions {}`, `get_positions_by_account_id {account_id}`. The test first asserts `set(_PROBES) == {t.name for t in await server.list_tools()}` (never a literal count — `fails.md` 2026-10-14), then `monkeypatch`es every public coroutine function of `app.client` (`inspect.getmembers(client, inspect.iscoroutinefunction)`, name not starting with `_`, `fn.__module__ == client.__name__`) to raise `_rpc_error(FAILED_PRECONDITION, f"probe refusal {tool}")` for the tool currently being probed, calls each tool through `dispatch_error`, and asserts `f"FAILED_PRECONDITION: probe refusal {name}" in str(raised)`.
   - `test_unconverted_exception_is_masked_by_sdk` (characterization, exempt from red-first): a throwaway `MCPServer` tool raising `RuntimeError("secret detail")`; `server.call_tool` raises `UnexpectedToolError` whose text is exactly `Error executing tool crash`.
5. Durable suite (C-16 CHANGE, operator sign-off 2026-11-07 in `context.md`): in `acceptance/agent-broker-account-tools.feature` append ` @feature-303` to the `:52` tag line (`@AC-7 @FR-5 @feature-164`) and reword `:57` to exactly `    Then the tool raises an error whose text contains "PERMISSION_DENIED" and conveys the permission denial` (byte-identical to the Then of `acceptance.feature` AC-9; the Given/When lines are untouched).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_errors.py tests/test_tool_deadlines.py tests/test_score_trailer_loopback.py -q \
 && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . \
 && grep -n "Then the tool raises an error whose text contains \"PERMISSION_DENIED\" and conveys the permission denial" acceptance/agent-broker-account-tools.feature
```
RED proof (executor, before Step 5): AC-1/2/3 dispatch tests and the sweep fail on `type(exc_info.value) is ToolError` (the SDK raises `UnexpectedToolError`).

---

### Step 7 — service: the 52 hand-written refusals become `ToolError`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -nE "^\s*raise\b" services/xstockstrat-agent/app/tools.py | wc -l` → 103 total raise lines = 47 mapper + 52 refusals + 4 internal. Refusal sites by type: 8 `RuntimeError` (`:127 _require_claims`, `:168 _caller_user_id`, `:571` and `:609` `_CREDENTIALS_UNSUPPORTED`, `:1271` and `:1453` "update requires at least one field to change", `:1928` set_user_metadata no field, `:2715` `_fetch_url` egress), 42 `ValueError` (tool bodies, nested `_validate_roles` `:1981/:1984`, `_get_source` `:2589`, `_extract_from_bytes` `:2609`, and `:2347` uuid `from None`) and 2 `PermissionError` (`:154 _require_admin`, `:2462 manage_account resume`). A single regex `\braise (RuntimeError|ValueError|PermissionError)\(` → `raise ToolError(` converted exactly 52 lines in the scratch run once the two allow-listed lines were excluded.
- Internal control flow that **stays**: `_extract_from_bytes` `:2600` (`raise ValueError("Failed to decrypt PDF: incorrect password")`) and `:2602` (`raise ValueError("PDF is password-protected but no credentials are configured")`), both caught by that function's own `except Exception as pdf_err:` at `:2604`; `_fetch_url` `:2684` (`raise egress.EgressBlocked("too many redirects")`) and `:2709` (`raise egress.EgressBlocked("response too large")`), caught at `:2712` which re-raises `RuntimeError("content fetch refused by egress policy") from None` at `:2715` (that final raise **does** convert).
- `:2347` is a caller refusal, not internal control flow: `raise ValueError(f"client_order_id must be a UUID, got {nonce!r}") from None` inside `except ValueError:` at `:2346` — it converts (design corrected recon here).
- `:2609` currently echoes the exception text: `raise ValueError(f"Cannot extract text from attachment: {e}") from e` → converts with fixed text, no `{e}`.
- Docstring mentions of the old classes are Step 9's, not this step's: `tools.py:1538` ("Client-side guards raise ValueError"), `:2581` ("Raises ValueError if slug…").

**Lands with**: `Step 8`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Replace `raise RuntimeError(`, `raise ValueError(`, `raise PermissionError(` with `raise ToolError(` on every line **except** the two `_extract_from_bytes` lines `raise ValueError("Failed to decrypt PDF: incorrect password")` and `raise ValueError("PDF is password-protected but no credentials are configured")`. Messages are unchanged (AC-7/8/10/11 and 283 `@AC-9` depend on their text), with exactly one exception below.
2. `_extract_from_bytes` (`:2609`): `raise ToolError("Cannot extract text from attachment") from e` (fixed text; the underlying exception stays chained but is not forwarded).
3. Leave `egress.EgressBlocked` raises (`:2684`, `:2709`) and every `except` clause untouched.

**Verification**:
```bash
cd services/xstockstrat-agent && test "$(grep -cE "raise (RuntimeError|ValueError|PermissionError)\(" app/tools.py)" -eq 2 \
 && test "$(grep -c "raise ToolError(" app/tools.py)" -eq 99
```
Exits non-zero unless exactly two such raises remain (the `_extract_from_bytes` password raises) and `raise ToolError(` totals 99 (47 from Step 5 + 52 from this step); plus the unit verification with Step 8.

---

### Step 8 — test: flip the 47 non-gRPC assertions; FR-1 AST guard; AC-7/8/10/11; durable edits

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_errors.py` — modify
- `services/xstockstrat-agent/tests/test_account_tools.py` — modify
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify
- `services/xstockstrat-agent/tests/test_position_tools.py` — modify
- `services/xstockstrat-agent/tests/test_query_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_user_tools.py` — modify
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify
- `services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature` — modify
- `services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Measured (scratch copy with Steps 1-7 applied; Step 2/6 test edits in place): exactly these 47 lines fail and flipping them returns the suite to green. **Rule**: every other `tools.py`-originated `pytest.raises` flips here; client-originated ones stay (they remain green because `ClientArgumentError` ⊂ `ValueError`). Lines are pre-Step-2 originals — locate by enclosing test:

| File | Lines (enclosing test) |
|---|---|
| `test_account_tools.py` | 76 `test_register_requires_broker_type`; 93 `test_register_rejects_offline_broker_type`; 124 `test_update_credentials_requires_account_id`; 188 `test_unknown_operation_rejected`; 215 `test_resume_requires_admin_scope`; 226 `test_resume_requires_account_id`; 286 `test_record_order_rejects_non_uuid_nonce_before_any_rpc` |
| `test_config_tools.py` | 125 `TestSetConfigSecretWrites::test_refuses_without_verified_claims`; 213 `TestManagementToolsForwardDerivedScope::test_refuses_without_verified_claims` |
| `test_position_tools.py` | 88 `test_get_positions_by_account_id_requires_account_id`; 192 `test_get_positions_no_claims_raises` |
| `test_query_tools.py` | 182 `test_query_fundamentals_rejects_unknown_mode` |
| `test_tools.py` | 44, 56, 64 `TestCallerIdentityHelpers::*`; 211 `test_extract_email_content_no_inputs_raises`; 220 `…_unknown_slug_raises`; 307 `test_extract_website_content_no_url_raises`; 324, 339 `…raises_when_credentials_required` (email, website); 529 `test_emit_alert_broadcast_false_without_claims_raises`; 1278, 1288, 1301 `TestManageStrategyScore::test_ac9_*`; 1367 `TestManageFormulaTool::test_refuses_without_verified_claims`; 1782 `TestManageStrategyPartialUpdate::test_empty_update_is_rejected_before_the_rpc`; 1939 `TestFormulaPartialUpdateTool::test_update_with_no_fields_raises`; 1986 `TestManageSignalSourceVerbsTool::test_update_with_no_fields_raises`; 2198, 2220, 2234, 2256, 2273, 2296, 2317 the egress tests (`test_extract_website_blocks_cloud_metadata`, `…rfc1918_and_loopback`, `test_extract_email_blocks_internal_url`, `…redirect_to_internal`, `test_blocked_fetch_does_not_leak_and_is_recorded`, `…enforces_config_max_bytes`, `…enforces_config_max_redirects`) |
| `test_user_tools.py` | 116 `test_set_active_requires_active_flag`; 124 `test_manage_user_unknown_operation_raises`; 130 `…unknown_role_raises`; 138 `…empty_roles_raises`; 195 `test_admin_set_user_metadata_requires_a_field`; 242 `test_non_admin_is_denied_with_no_backend_call` |
| `test_watchlist_tools.py` | 119 `test_manage_watchlist_create_requires_name`; 145 `…update_requires_watchlist_id`; 180 `test_manage_watchlist_unknown_operation`; 222 `test_manage_symbols_requires_watchlist_id`; 237 `test_manage_symbols_unknown_operation_no_rpc`; 303 `test_manage_symbols_assign_requires_symbols` |

- The 24 that **stay** (91 − 20 − 47; client- or SDK-originated): `test_broker_account_client.py:113,115`; `test_client.py:174,625,627,630,632,634,637,639,728,1699`; `test_header_propagation.py:143`; `test_mtls.py:119,121`; `test_mtls_backend_errors.py:81`; `test_offline_client.py:123,269,276`; `test_startup_snapshot.py:52`; `test_strategy_builders.py:168`; `test_template_tools.py:115`; `test_watchlist_client.py:433`; `test_tools.py:1629`. Do **not** flip these.
- Confirmed via: durable `agent-broker-account-tools.feature` tag lines `:16` (`@AC-2 @FR-1 @feature-164`), `:23` (`@AC-3 …`), `:59` (`@AC-8 @FR-6 @feature-164`) and Then lines `:20`, `:27`, `:63`; durable `mcp-watchlist-tools.feature` tag line `:68` (`  @AC-9 @FR-4 @feature-148`) and Then `:72` (`    Then the tool raises a value error naming the allowed operations`).
- Confirmed via: measured allow-list — in the converted `app/tools.py` the only raises that are not `ToolError(...)` are `("_extract_from_bytes", "ValueError")` × 2 and `("_fetch_url", "egress.EgressBlocked")` × 2 (validated: the guard below passes). There is no bare `raise` in `tools.py` today (`grep -nE "^\s*raise\s*$"` → none); a bare `raise` stays allowed.
- Messages for the tightened assertions: `register requires display_name, broker_type ('alpaca' or 'ibkr'), and credentials_json` (`tools.py:2440-2443`; `:2435-2437` is the offline-broker message that AC-8 matches); `unknown operation '…' (expected register/update_credentials/deregister/resume)`; `unknown operation '…' (expected add/remove/assign)` (`tools.py:2270`).

**Lands with**: `Step 7`

**TDD**: red-green required

**Covers**: AC-6, AC-7, AC-8, AC-10, AC-11

**Instructions**:
1. In each listed test file add `from mcp.server.mcpserver.exceptions import ToolError` (isort-ordered) and flip the listed `pytest.raises(RuntimeError|ValueError|PermissionError…)` to `pytest.raises(ToolError…)` (47 lines, table above). Keep `match=`.
2. Tighten the AC records (type-neutral; red-first signal is the flip): `test_account_tools.py:76` (**AC-7**) → `match=re.escape("broker_type ('alpaca' or 'ibkr')")` (add `import re`); `:93` (**AC-8**) keeps `match="manage_offline_account"`; `:188` (**AC-10**) keeps `match="register/update_credentials/deregister/resume"` (contains the durable text's three operations); `test_watchlist_tools.py:237` (**AC-11**) → `match=re.escape("expected add/remove/assign")` (add `import re` if absent).
3. `tests/test_tool_errors.py` — add the FR-1 regression guard (**AC-6**, second half), using the shared walker from Step 2:
   ```python
   _NON_TOOL_ERROR_RAISES_ALLOWED = Counter(
       {("_extract_from_bytes", "ValueError"): 2, ("_fetch_url", "egress.EgressBlocked"): 2}
   )

   def test_tools_py_raises_only_tool_error():
       found = Counter()
       for fn_name, node in tools_ast_nodes(ast.Raise):
           if node.exc is None:  # a bare `raise` re-raises
               continue
           callee = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
           name = ast.unparse(callee)
           if name != "ToolError":
               found[(fn_name, name)] += 1
       assert found == _NON_TOOL_ERROR_RAISES_ALLOWED
   ```
   An exact-count allow-list: a new `raise RuntimeError(...)` (e.g. feature 299's `query_logs`), a `raise exc_var`, or a dropped allow-listed raise all fail it. Add `import ast` and `from collections import Counter` as needed.
4. Durable suite (C-16 CHANGE, operator sign-off 2026-11-07 in `context.md`, edits tagged `@feature-303`): in `acceptance/agent-broker-account-tools.feature` append ` @feature-303` to the tag lines `:16`, `:23`, `:59` and set the Then lines to exactly — `:20` `    Then the tool raises an error whose text contains "broker_type ('alpaca' or 'ibkr')"`; `:27` `    Then the tool raises an error whose text contains "manage_offline_account"`; `:63` `    Then the tool raises an error whose text lists the expected operations register/update_credentials/deregister`. In `acceptance/mcp-watchlist-tools.feature` append ` @feature-303` to `:68` and set `:72` to `    Then the tool raises an error whose text names the allowed operations`. Each Then is byte-identical to `acceptance.feature` AC-7/AC-8/AC-10/AC-11 so launch-time promotion classifies them as duplicates; the `And no … call is made` lines are unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_errors.py -q \
 && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check . \
 && ! grep -rnE "raises an? (ValueError|RuntimeError)|raises a value error" acceptance/agent-broker-account-tools.feature acceptance/mcp-watchlist-tools.feature
```
Expect the final negated grep to print nothing. RED proof (executor, before Step 7): `test_tools_py_raises_only_tool_error` fails with a ~52-entry `found` Counter.

---

### Step 9 — docs: runbook, AGENT-5, agent CLAUDE.md, tool docstrings, strat-lab skill

**Status**: `pending`
**Service**: `docs/runbooks/` (+ `xstockstrat-agent` docs, `plugins/strat-lab`)
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (three docstrings only)
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: xstockstrat-agent owner — tool descriptions (docstrings) are MCP contract surface and `docs/runbooks/mcp-tools.md` / the strat-lab skill are read by parity tests; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -nE "RuntimeError|ValueError|PermissionError" docs/runbooks/mcp-tools.md` → `:163, :185, :186, :187, :188, :189, :197, :215, :216, :217, :218, :302, :344, :451, :509, :575, :580, :719, :816, :937, :970, :1006, :1143, :1275, :1298, :1319, :1340, :1391, :1427, :1486, :1523, :1526, :1540, :1561, :1580, :1607, :1608, :1637, :1643, :1660, :1661, :1669, :1679, :1680, :1692, :1708, :1709`.
- **Do not edit** `mcp-tools.md:344`, `plugins/strat-lab/skills/backtest/SKILL.md:202`, `plugins/strat-lab/skills/backtest/reference/backfill.md:41` (and `output-handling.md:37`, `self-grill.md:45`): they describe the analysis-side `type(e).__name__` warning (`<CODE>` or a Python exception name), which is still accurate — adversary R1. `mcp-tools.md:188` ("PDF is password-protected … `ValueError` from the PDF parser") describes a raise that `_extract_from_bytes` already catches (`tools.py:2604`) — pre-existing drift, left untouched here.
- Backend-message rows that are now wrong after Step 1: `mcp-tools.md:92-95` (deadline wording gains the `DEADLINE_EXCEEDED: ` prefix), `:584-586` (the `score` UNAVAILABLE rows: the store-down strings now collapse; the fundamentals-unknown string still passes through), `:938` ("gRPC error propagated (`UNAVAILABLE`)"), `:1145-1146` (`opportunities store unavailable; retry` now collapses; the deadline wording gains the prefix).
- Confirmed via: `services/xstockstrat-agent/docs/context-constitution.md:22` (AGENT-5 row: "`except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, deadline_s=…)) from e`"; its Example column cites `_grpc_error_message (~L223)`), `:31` (`_require_admin` / `manage_account resume` "`raise PermissionError`"); `services/xstockstrat-agent/CLAUDE.md:113` ("rejects a non-admin `PermissionError`") and `:210` (the `agent.opportunities.read_timeout_seconds` row quoting the deadline message).
- Docstring mentions of the old classes: `app/tools.py:1083-1089` (`manage_strategy` score docstring: "UNAVAILABLE (store down, or fundamentals availability unknown — grade unchanged)"), `:1538-1539` (`trigger_backfill`: "Client-side guards raise ValueError BEFORE anything is queued"), `:2579-2581` (`_get_source`: "Raises ValueError if slug is not found or source is inactive"). `:852` (analysis-side exception-name advice) stays.
- Confirmed via: `plugins/strat-lab/skills/backtest/SKILL.md:225-236` — "…`backtest exceeded` message only when the limit is below 60 s, and only once feature 273's error⏎pass-through lands." (the clause wraps across two lines) (wrong attribution: 303 is the pass-through); root `CLAUDE.md` requires the skill to change in the same PR for `run_backtest`/`manage_strategy`/`trigger_backfill`/`get_backfill_status`/`set_strategy_live` (`docs/patterns/strat-lab-plugin.md`). `python3 plugins/strat-lab/scripts/validate.py` passes on the current tree.
- Parity tests that read these docs/docstrings: `tests/test_tools_endpoint.py`, `test_ingest_signal_watchlist.py`, `test_watchlist_tools.py`, `test_score_strategy_parity.py`, `test_list_correlation_parity.py` — the full suite is part of this step's verification.

**TDD**: N/A (docs; the docstring edits change no behavior and are covered by the full suite)

**Covers**: —

**Instructions**:
1. `docs/runbooks/mcp-tools.md`:
   a. After the "Backend deadlines" subsection (`:86-97`) add an `### Error messages` subsection: every anticipated refusal reaches the caller as `isError=true` text `Error executing tool <name>: <GRPC_CODE>: <message>` (or the bare validation message for tool-side refusals); codes whose server detail passes through (`FAILED_PRECONDITION`, `PERMISSION_DENIED`, `INVALID_ARGUMENT`, `ALREADY_EXISTS`, `OUT_OF_RANGE`, `UNAUTHENTICATED`, `RESOURCE_EXHAUSTED`, `ABORTED`, a server-set `DEADLINE_EXCEEDED`); `NOT_FOUND` = the tool's literal plus the server hint; `UNAVAILABLE` passes only `fundamentals availability unknown — grade unchanged` (`manage_strategy` score) and `positions not published; re-confirm to retry` (`manage_offline_account`); every other `UNAVAILABLE`/`CANCELLED`/`INTERNAL`/`UNKNOWN`/unlisted code collapses to `upstream unavailable; retry shortly` / `upstream call cancelled; …` / `upstream error, details withheld; report it` (writes add `outcome unknown, verify before retrying`), with the detail logged at WARNING on the agent. State the still-masked cases (FR-4): an `httpx` status error from the extract tools and the implicit numeric casts in the client — those return only `Error executing tool <name>`.
   b. `:92`/`:94` and `:1145`: prefix the two deadline messages with `DEADLINE_EXCEEDED: `; `:586` likewise.
   c. `:585`: the store-down row becomes `UNAVAILABLE: upstream unavailable; outcome unknown, verify before retrying`; `:938`: `UNAVAILABLE: upstream unavailable; retry shortly`; `:1146`: same collapse text.
   d. Replace every remaining `RuntimeError` / `ValueError` / `PermissionError` token in an Errors line/row with `ToolError` (keep the surrounding meaning, e.g. `:1643` "rejected `PermissionError`" → "rejected with a `ToolError`"; `:937` "surfaced as the tool's `RuntimeError`" → "surfaced as `PERMISSION_DENIED: admin scope required`"; `:1143` "surfaces as a `RuntimeError` with the gRPC status message" → "surfaces as a `ToolError` `<CODE>: <message>`"; `:163`/`:189`/`:197` "raises `RuntimeError`" / `RuntimeError: …` → "raises a `ToolError`" / `ToolError: …`). Skip `:188` and `:344`. The line list above is a snapshot of the current file: re-derive it with the grep at execute time and rely on the catch-all in this item.
2. `services/xstockstrat-agent/docs/context-constitution.md`: rewrite AGENT-5 (`:22`) — the convention is now `except grpc.aio.AioRpcError as e: raise ToolError(_grpc_error_message(e, deadline_s=…)) from e`; every anticipated refusal in `app/tools.py` raises `ToolError` (a built-in exception is masked by the SDK to `Error executing tool <name>`); the mapper returns `CODE: body`, collapses internal detail with a WARNING, and allow-lists UNAVAILABLE strings per call site via `pass_messages`; a new tool must also be added to `_PROBES` in `tests/test_tool_errors.py`; guards `tests/test_tool_errors.py::test_tools_py_raises_only_tool_error` and `::test_every_tool_refusal_is_a_tool_error`; and refresh the Example column anchor. `:31`: `raise PermissionError` → `raise ToolError`, re-anchor the `_require_admin` / `manage_account` line references by symbol.
3. `services/xstockstrat-agent/CLAUDE.md`: `:113` "rejects a non-admin `PermissionError`" → "rejects a non-admin with a `ToolError`"; `:210` prefix the quoted deadline message with `DEADLINE_EXCEEDED: `. Add one sentence to the error-handling area (near the management-tool authorization paragraph) that tool refusals are `ToolError` with `CODE: body`, pointing at AGENT-5.
4. `app/tools.py` docstrings only: the `manage_strategy` score docstring UNAVAILABLE clause (`~:1083`) → "UNAVAILABLE ('fundamentals availability unknown — grade unchanged' is passed through verbatim; a store outage surfaces as 'UNAVAILABLE: upstream unavailable; outcome unknown, verify before retrying')"; `trigger_backfill` (`~:1538`) "raise ValueError" → "raise a ToolError"; `_get_source` (`~:2581`) "Raises ValueError" → "Raises ToolError". Do not touch `~:852`.
5. `plugins/strat-lab/skills/backtest/SKILL.md`: add exactly one sentence in the "Ownership (feature 133)" paragraph (`~:22-30`, locate by that bold lead-in; after "…pick an id you own or register a new one."): tool failures arrive as `isError` text `<GRPC_CODE>: <message>` (for example `PERMISSION_DENIED: …`), and an internal fault arrives as `<CODE>: upstream error, details withheld; report it`. Fix `~:234-236`: the clause wraps across two lines ("…and only once feature 273's error⏎pass-through lands."), so edit it as one multi-line match: replace "and only once feature 273's error\npass-through lands." with "(it arrives as `DEADLINE_EXCEEDED: backtest exceeded …`, passed through since feature 303)." (the preceding "…below 60 s, " stays; fix the comma/space so the sentence reads cleanly). Do not edit `:202` or the `reference/` files.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)" \
 && test "$(grep -cE 'RuntimeError|ValueError|PermissionError' docs/runbooks/mcp-tools.md)" -le 3 \
 && ! grep -nE "raise (RuntimeError|PermissionError)" services/xstockstrat-agent/docs/context-constitution.md \
 && ! tr '\n' ' ' < plugins/strat-lab/skills/backtest/SKILL.md | grep -q "feature 273's error  *pass-through" \
 && python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py \
 && cd services/xstockstrat-agent && uv run --no-sync pytest -q --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
The first check allows only the residual `:188` row, the analysis-side `:344` advice and at most one intentional mention in the new `### Error messages` section (the "still masked" sentence); the `tr … | grep -q` check joins the wrapped lines first, so it really fails while the stale clause exists.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
