# Implementation Spec: trigger-backfill-mcp-tool

**Status**: `in-progress`
**Created**: 2026-07-20
**Feature**: `docs/roadmap/features/066-trigger-backfill-mcp-tool/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/trigger-backfill-mcp-tool`
_(Session note: per context.md, work is carried on the harness-assigned branch
`claude/custom-indicators-strategies-g38b18` (PR #769 → main-dev) with user approval.)_

---

## Execution Summary

Bottom-up through the agent's two established layers (design.md § Chosen Approach): first the
`app/client.py` gRPC functions (`trigger_backfill`, `get_backfill_status`) plus the
`_admin_metadata()` DRY extraction, with their client tests; then the two thin `@server.tool()`
wrappers in `app/tools.py` with tool + catalog tests; finally the five documentation surfaces.
No proto, config, DB, or env-var changes — the feature only adds two new RPC usages on the
existing `xstockstrat-agent → xstockstrat-ingest` gRPC edge.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (C-08 pairing; red-before-green per P-06).
- Step 3 requires Step 1: the tools delegate to `client.trigger_backfill` / `client.get_backfill_status`.
- Step 4 [test] covers Step 3 [service] (C-08 pairing; red-before-green per P-06).
- Step 5 requires Step 3: docs describe the registered tool surface (counts go 11 → 13).
- Design Open Risk 1 (alias-table drift vs ingest) lands in Step 1's mirrored-map comment + Step 3's docstrings.
- Design Open Risk 2 (admin `"7"` scope on a cost-incurring op) is mitigated by Step 1's 50-symbol cap.
- Design Open Risk 3 (stale 8055 webhook block in `historical-backfill.md`) is resolved in Step 5.

---

### Step 1 — service: `app/client.py` backfill client functions + `_admin_metadata()` extraction

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool surface consistency, `x-mcp-secret` on outbound calls, admin `x-access-scope` only on write ops (no registry row — inline focus per feature.md); `xstockstrat-ingest` owner — correct use of `TriggerBackfill`/`GetBackfillStatus`/`ListBackfillJobs` (timeframe_enum not the deprecated string alone; job semantics untouched)

**Codebase Evidence**:
- `_metadata()` at `services/xstockstrat-agent/app/client.py:24-27`; `MCP_AGENT_SECRET` const at `:18`; `INGEST_ENDPOINT` const at `:15`.
- Three inline admin-metadata sites to refactor — `meta = list(_metadata()) + [("x-access-scope", "7")]` at `app/client.py:293` (`manage_strategy`), `:461` (`manage_signal_source`), `:603` (`set_strategy_live`). No named helper exists (recon.md § Risks).
- Write-path ingest call pattern: `manage_signal_source` at `app/client.py:431-474` — `async with grpc.aio.insecure_channel(INGEST_ENDPOINT) as channel:` + `ingest_pb2_grpc.IngestServiceStub(channel)`; function-local import `from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: PLC0415` at `:49`, `:81`, `:440`.
- Read-path pattern (`metadata=_metadata()` only): `list_signal_sources` at `app/client.py:47-66`.
- `_iso_to_timestamp` at `app/client.py:30-36`.
- Proto→dict variant: `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)` in `run_backtest` at `app/client.py:166-170` (rationale comment `:161-165`).
- Enum value→name: `analysis_pb2.ScreenResultStatus.Name(r.status)` at `app/client.py:235`; friendly-`ValueError` style: `raise ValueError(f"unknown operation '{operation}' (expected register/update/deactivate)")` at `:257`.
- RPCs + messages (reuse only, no proto change): `TriggerBackfill`/`GetBackfillStatus`/`ListBackfillJobs` at `packages/proto/ingest/v1/ingest.proto:12-14`; `TriggerBackfillRequest{symbols=1, timeframe=2 [deprecated], range=3, overwrite=4, timeframe_enum=5, fill_mode=6}` `:61-69`; `TriggerBackfillResponse{job_id=1, status=2}` `:71-74`; `GetBackfillStatusRequest{job_id=1}` `:76`; `ListBackfillJobsRequest{status_filter=1, page=2, symbol=3}` `:78-82`; `ListBackfillJobsResponse{jobs=1, page=2}` `:88-91`; `BackfillJob` incl. `failed_symbols=11`, `chunks_total=13`, `chunks_completed=14` `:26-42`; `BackfillStatus` values 0–6 `:44-52`; `FillMode{UNSPECIFIED=0 (server treats as FULL), FULL=1, GAPS_ONLY=2}` `:54-59`.
- `common_pb2`: `TimeRange{start=1, end=2}` at `packages/proto/common/v1/common.proto:42-45`; `PageRequest{page_size=1, page_token=2}` `:10-13`; `Timeframe` enum (`TIMEFRAME_1HOUR=3`, `TIMEFRAME_1DAY=4`, `TIMEFRAME_15MIN=5`) `:77-84`. **Not currently imported anywhere in `app/client.py`** (first `TimeRange` use in the agent — recon.md § Risks); `ingest_pb2` itself imports `common/v1/common.proto` (`ingest.proto:8`), so the generated `gen.common.v1` module is available in the same stub package.
- Server-side maps to mirror: `_STR_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}` and `_TF_ALIASES` (`15m/15Min`, `1h/1Hour`, `1d/1Day`) at `services/xstockstrat-ingest/app/handlers/servicer.py:35-44`; dual-field send precedent (string + enum) at `services/xstockstrat-analysis/app/handlers/servicer.py:509-510` (per recon.md).
- Ingest semantics the client relies on: `_ts_to_dt` treats `ts.seconds == 0` as unset (`servicer.py:57-61`) — omitting `range=` entirely is safe; `TriggerBackfill` queues unconditionally with **no synchronous input validation** (`servicer.py:142-167`); `GetBackfillStatus` aborts `NOT_FOUND` for unknown `job_id` (`servicer.py:504-512`); `ListBackfillJobs` maps `status_filter == BACKFILL_STATUS_UNSPECIFIED` → no filter, `page.page_size <= 0` → 100, `page.page_token` = offset string, and returns a real `next_page_token` (`servicer.py:514-540`).
- Ingest has **no** admin-scope gate on `TriggerBackfill` today (only `CancelBackfill` at `servicer.py:551` and `ManageSignalSource` enforce `_has_admin_scope`) — the admin bit is sent defensively per FR-4; do not add a server-side gate (ingest out of scope).

**TDD**: `red-green required`

**Instructions**:
1. Directly below `_metadata()` (`app/client.py:27`), add:
   ```python
   def _admin_metadata() -> list[tuple[str, str]]:
       """x-mcp-secret plus the hardcoded admin x-access-scope for write/management RPCs."""
       return [*_metadata(), ("x-access-scope", "7")]
   ```
   Refactor the three inline sites (`:293`, `:461`, `:603`) to `meta = _admin_metadata()`, keeping each site's explanatory comment. (Design decision — DRY guard rail over a fourth inline copy; existing metadata-capture tests at `tests/test_client.py:100-103` cover the refactor.)
2. Near `_SEVERITY_MAP` (`app/client.py:39-44`), add module-level maps with a comment noting they mirror ingest `servicer.py:35-44` (design Open Risk 1 — drift is accepted and documented here):
   ```python
   _TF_ALIASES = {"15m": "15m", "15Min": "15m", "1h": "1h", "1Hour": "1h", "1d": "1d", "1Day": "1d"}
   _TF_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}  # common.v1.Timeframe values
   _FILL_MODE_MAP = {"full": 1, "gaps_only": 2}  # ingest.v1.FillMode; None → UNSPECIFIED (server FULL)
   _BACKFILL_MAX_SYMBOLS = 50  # client-side cost-sanity cap on a paid-fetch operation
   ```
3. Add `async def trigger_backfill(symbols: list[str], timeframe: str = "1d", start: str | None = None, end: str | None = None, overwrite: bool = False, fill_mode: str | None = None) -> dict[str, Any]:` following the `manage_signal_source` write-path shape (`:431-474`):
   - **Fail-fast validation** (client `ValueError` is the only immediate feedback — ingest queues unconditionally), each message enumerating accepted values in the `:257` style: empty `symbols`; `len(symbols) > _BACKFILL_MAX_SYMBOLS`; `timeframe not in _TF_ALIASES`; `fill_mode is not None and fill_mode not in _FILL_MODE_MAP`; both bounds set and `_iso_to_timestamp(start).ToDatetime() > _iso_to_timestamp(end).ToDatetime()` (equivalently compare `.seconds`/`.nanos`).
   - Canonicalize: `canonical = _TF_ALIASES[timeframe]`; build `ingest_pb2.TriggerBackfillRequest(symbols=list(symbols), timeframe=canonical, timeframe_enum=_TF_TO_ENUM[canonical], overwrite=overwrite, fill_mode=_FILL_MODE_MAP.get(fill_mode, 0) if fill_mode else 0)` — dual-field send per FR-2.
   - Range: function-local `from gen.common.v1 import common_pb2  # noqa: PLC0415`; when at least one bound is supplied, build `common_pb2.TimeRange()` setting only the supplied bounds via `_iso_to_timestamp` and `req.range.CopyFrom(tr)`; when both absent, leave `range` unset entirely (ingest `_ts_to_dt` treats `seconds==0` as unset).
   - Call `stub.TriggerBackfill(req, metadata=_admin_metadata())` on `IngestServiceStub` over `grpc.aio.insecure_channel(INGEST_ENDPOINT)`.
   - Return `{"job_id": resp.job_id, "status": ingest_pb2.BackfillStatus.Name(resp.status)}`.
4. Add `async def get_backfill_status(job_id: str = "", status_filter: str | None = None, symbol: str = "", limit: int = 0, page_token: str = "") -> dict[str, Any]:` — dual-mode, read-path (`metadata=_metadata()` only, per `list_signal_sources` `:47-66`):
   - `job_id` non-empty → `stub.GetBackfillStatus(ingest_pb2.GetBackfillStatusRequest(job_id=job_id), ...)`; return `{"job": MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)}` (the `run_backtest` variant — keeps zero-valued `bars_processed` visible while polling). Let `grpc.aio.AioRpcError` (incl. NOT_FOUND) propagate — mapping happens in the tool layer.
   - `job_id` empty → map `status_filter`: `None` or `"unspecified"` → `0`; otherwise `ingest_pb2.BackfillStatus.Value("BACKFILL_STATUS_" + status_filter.upper())` wrapped so a `ValueError` re-raises with a friendly message enumerating `queued/running/completed/failed/partial/canceled/unspecified`. Call `stub.ListBackfillJobs(ingest_pb2.ListBackfillJobsRequest(status_filter=<mapped>, symbol=symbol, page=common_pb2.PageRequest(page_size=limit, page_token=page_token)), ...)`; return `{"jobs": [MessageToDict(j, preserving_proto_field_name=True, always_print_fields_with_no_presence=True) for j in resp.jobs], "next_page_token": resp.page.next_page_token}` — the discriminated one-key envelopes per design.md § Return shapes.
5. Header-propagation note (step-constraints §B): the agent is a request **originator**, not a propagator — outbound calls carry `x-mcp-secret` (+ admin `x-access-scope` on writes) per the established agent pattern; there is no inbound `x-user-id`/`x-trace-id` context to forward (design.md C-03 note; same as every existing `app/client.py` function).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run python -c "import app.client" && uv run ruff check app/client.py && uv run ruff format --check app/client.py
```
Behavioral verification is Step 2 (paired test step).

---

### Step 2 — test: client tests for `trigger_backfill` / `get_backfill_status`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — captured-metadata assertions mirror FR-4 (admin scope on trigger only)

**Codebase Evidence**:
- Mock recipe: `_channel_cm()` at `tests/test_client.py:71-75`; `patch("app.client.grpc")` + `patch.object(<pb2_grpc>, "<Service>Stub", return_value=mock_stub)` at `:86-88`.
- Admin-scope capture assertion pattern at `:100-103` (`("x-access-scope", "7") in meta`); read-path negative assertion at `:172-174` (`not any(k == "x-access-scope" ...)`); request-field assertions via `mock_stub.<RPC>.call_args[0][0]` at `:185-188`.
- `MCP_AGENT_SECRET` is `"test-secret"` in the test env (asserted at `tests/test_client.py:10-12`).
- Real response messages built from `ingest_pb2` (pattern: `analysis_pb2.StrategyDefinition(...)` as mock return at `:83`).
- File currently 271 lines — append a new section at the end.

**TDD**: `red-green required`

**Instructions**:
Append a `# ── backfill client (feature 066) ──` section with a `TestBackfillClient` class (or two classes, trigger/status) covering, per design.md § Tests:
1. **Trigger happy path**: mock `TriggerBackfill` returning `ingest_pb2.TriggerBackfillResponse(job_id="j-1", status=ingest_pb2.BACKFILL_STATUS_QUEUED)`; assert channel opened against `client.INGEST_ENDPOINT`; metadata contains **both** `("x-mcp-secret", "test-secret")` and `("x-access-scope", "7")` (FR-4 / AC-4); result `== {"job_id": "j-1", "status": "BACKFILL_STATUS_QUEUED"}`.
2. **Request field mapping**: `sent_req = mock_stub.TriggerBackfill.call_args[0][0]` — `symbols`, `timeframe == "1d"` **and** `timeframe_enum == 4` (dual-field, FR-2); alias case: `timeframe="1Day"` canonicalizes to the same pair; `overwrite` carried; `fill_mode == 0` when omitted and `== 2` for `"gaps_only"`.
3. **Range handling**: no bounds → `sent_req.HasField("range") is False`; one-sided `start` only → `range.start.seconds > 0` and `range.end.seconds == 0`; both bounds → both set.
4. **Validation `ValueError`s** (no channel needed): empty `symbols`; 51 symbols; `start > end`; unknown `timeframe`; unknown `fill_mode`; unknown `status_filter` on the list branch — assert messages enumerate accepted values.
5. **Status single-job branch**: `job_id="j-1"` → `GetBackfillStatus` called, `ListBackfillJobs` not called; metadata contains `x-mcp-secret` and **no** `x-access-scope` (read path); result is the `{"job": {...}}` envelope with `preserving_proto_field_name` keys (e.g. `bars_processed` present even at 0).
6. **NOT_FOUND propagation**: stub `GetBackfillStatus` raising a `grpc.aio.AioRpcError` (NOT_FOUND) → `pytest.raises(grpc.aio.AioRpcError)` from `client.get_backfill_status` (mapping is the tool layer's job). Per design, assert generic `AioRpcError` pass-through — do not enumerate status codes as exhaustive.
7. **List branch**: empty `job_id`, `status_filter="completed"`, `symbol="AAPL"`, `limit=5`, `page_token="10"` → `sent_req.status_filter == 3`, `sent_req.symbol == "AAPL"`, `sent_req.page.page_size == 5`, `sent_req.page.page_token == "10"`; `"unspecified"` → `status_filter == 0`; result `{"jobs": [...], "next_page_token": ...}` from a mocked `ListBackfillJobsResponse` with a `common_pb2.PageResponse(next_page_token="20")`.

Red-before-green: written against the pre-Step-1 tree these tests fail with `AttributeError: module 'app.client' has no attribute 'trigger_backfill'` (proven by `/sdd-execute` per tdd-gate).

**Verification**:
```bash
cd services/xstockstrat-agent && uv sync --extra dev && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
(CI threshold 40% per agent `CLAUDE.md` § Running Tests and spec-template coverage table.)

---

### Step 3 — service: `app/tools.py` — `trigger_backfill` + `get_backfill_status` MCP tools

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — tool docstrings enumerate accepted values/shapes; error mapping via `_grpc_error_message`

**Codebase Evidence**:
- `register_tools(server: FastMCP)` at `services/xstockstrat-agent/app/tools.py:58`; last registered tool `set_strategy_live` at `:381-395` — new tools go after it, still inside `register_tools`.
- Error-mapping helper `_grpc_error_message(exc, not_found=...)` at `app/tools.py:32-43`; wrap pattern `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found="signal source not found")) from e` at `:378-379` (also `:309-310`, `:394-395`).
- Module docstring tool count `"Eleven tools:"` at `app/tools.py:4`, enumeration `:5-15`.
- Thin-delegation precedent: `screen_symbols` tool at `:254-279` (docstring documents params + read-only auth, then a single `client.<fn>` call).
- `/api/tools` catalog is automatic from FastMCP registration (`app/main.py:180` → `server.list_tools()` at `app/main.py:84` per recon.md) — no route change needed.

**TDD**: `red-green required`

**Instructions**:
1. Update the module docstring: `"Eleven tools:"` → `"Thirteen tools:"` (`app/tools.py:4`) and append two enumeration lines after `set_strategy_live` (`:15`):
   `trigger_backfill    — triggers an OHLCV history backfill via gRPC TriggerBackfill (admin-scoped)` and
   `get_backfill_status — checks a backfill job / lists recent jobs via GetBackfillStatus / ListBackfillJobs (read-only)`.
2. After the `set_strategy_live` tool (`:395`), add inside `register_tools`:
   ```python
   @server.tool()
   async def trigger_backfill(
       symbols: list[str],
       timeframe: str = "1d",
       start: str | None = None,
       end: str | None = None,
       overwrite: bool = False,
       fill_mode: str | None = None,
   ) -> dict:
   ```
   Docstring must state: triggers a historical OHLCV backfill in `xstockstrat-ingest`; `symbols` explicit ticker list (max 50); `timeframe` one of `15m`/`15Min`/`1h`/`1Hour`/`1d`/`1Day` (canonicalized); `start`/`end` optional ISO 8601 datetimes (one-sided allowed; omitted = service default range); `overwrite` re-fetches existing bars; `fill_mode` `'full'` | `'gaps_only'` (omitted → server default FULL — cheaper: `gaps_only` fetches only missing ranges); returns `{job_id, status}`; **ingest performs no synchronous input validation — bad input surfaces as a terminal FAILED/PARTIAL job; poll `get_backfill_status` with the returned `job_id`** (FR-6). Body: `try: return await client.trigger_backfill(...)` / `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e)) from e` — **default** `not_found` message (trigger can never NOT_FOUND, per design). Pre-RPC `ValueError`s surface natively as FastMCP tool errors.
3. Add:
   ```python
   @server.tool()
   async def get_backfill_status(
       job_id: str = "",
       status_filter: str | None = None,
       symbol: str = "",
       limit: int = 0,
       page_token: str = "",
   ) -> dict:
   ```
   Docstring must state both modes and both return shapes: with `job_id` → `{"job": {...BackfillJob fields: status, bars_processed, bars_total, chunks_completed, chunks_total, failed_symbols, error...}}`; without → `{"jobs": [...], "next_page_token": ...}` filtered by `status_filter` (`queued`/`running`/`completed`/`failed`/`partial`/`canceled`; omit or `'unspecified'` = all) and `symbol`; `limit` 0 = server default (100); pass `next_page_token` back as `page_token` to paginate. Read-only — no admin scope. Body: `try: return await client.get_backfill_status(...)` / `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found="backfill job not found")) from e` (custom not_found **only** on this path, per design).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run python -c "import app.tools" && uv run ruff check app/tools.py && uv run ruff format --check app/tools.py
```
Behavioral verification is Step 4 (paired test step).

---

### Step 4 — test: tool delegation, error mapping, and `/api/tools` catalog name-set

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: `xstockstrat-agent` owner — catalog name-set test is the C-10 reachability proof

**Codebase Evidence**:
- Tool-test recipe: `_make_server()` + `_tool_fn(server, name)` at `tests/test_tools.py:15-22`; client patched via `patch.object(client, "<fn>", AsyncMock(...))` (`:57`, `:310`).
- gRPC error fake: `_rpc_error(code, details="")` helper at `tests/test_tools.py:299-302` (`AioRpcError(code, Metadata(), Metadata(), details=details)`); RuntimeError-mapping test pattern at `:324-332`.
- Catalog name-set asserted exactly at `tests/test_tools_endpoint.py:23-35` (`test_list_tools_returns_all_registered_tools`) — fails until updated (built-in reachability proof, recon.md).
- Description-surfacing pattern at `tests/test_tools_endpoint.py:38-46`.
- Stale module docstring `"all six MCP tool definitions"` at `tests/test_tools.py:1` (predates features 047–066).

**TDD**: `red-green required`

**Instructions**:
1. In `tests/test_tools.py`, append a `# ── backfill tools (feature 066) ──` section:
   - `trigger_backfill` delegation: `patch.object(client, "trigger_backfill", AsyncMock(return_value={"job_id": "j-1", "status": "BACKFILL_STATUS_QUEUED"}))`; call `_tool_fn(server, "trigger_backfill")(symbols=["AAPL"], timeframe="1d", start="2020-01-01T00:00:00Z", end="2024-12-31T00:00:00Z")`; assert kwargs forwarded and result passed through unchanged (AC-1 shape).
   - `trigger_backfill` error mapping: `AsyncMock(side_effect=_rpc_error(grpc.StatusCode.UNAVAILABLE, "boom"))` → `pytest.raises(RuntimeError, match="boom")` — asserts *any* `AioRpcError` maps through `_grpc_error_message`; never enumerate UNAVAILABLE as exhaustive (design § Tests).
   - `get_backfill_status` delegation (both modes' kwargs forwarded) and NOT_FOUND mapping: `_rpc_error(grpc.StatusCode.NOT_FOUND, "nope")` → `pytest.raises(RuntimeError, match="backfill job not found")` (mirrors `:325-332`).
   - While editing the file, fix the stale module docstring at `tests/test_tools.py:1` to the countless form `"""Tests for app/tools.py — MCP tool definitions."""` (avoids recurring count drift; file already in this step's `**Files**`).
2. In `tests/test_tools_endpoint.py`, add `"trigger_backfill"` and `"get_backfill_status"` to the exact name-set at `:23-35`; extend `test_list_tools_entries_have_description_and_input_schema` (or add a sibling assert) that `by_name["trigger_backfill"]["inputSchema"]["properties"]` contains `"symbols"` — proving the docstring/schema surfaced in the catalog (C-10 reachability, AC-5-adjacent).

Red-before-green: against the pre-Step-3 tree, the name-set test fails (missing names) and `_tool_fn(server, "trigger_backfill")` raises `KeyError`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
(AC-6: full agent suite, coverage ≥ 40%, ruff clean.)

---

### Step 5 — docs: register the tools on all five discovery surfaces

**Status**: `pending`
**Service**: `docs/runbooks/` + `services/xstockstrat-agent/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/CLAUDE.md` — modify
- `docs/runbooks/historical-backfill.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:3` — "the eleven tools"; `:29` — "the same eleven tools'"; last per-tool section `### \`manage_signal_source\`` ends at `:399-401` before `## Usage Patterns` at `:403`; section format (intro + auth note, **Parameters** table, **Return** JSON, **Errors** table) per `screen_symbols` at `:268-306`. **Pre-existing gap, out of scope**: `set_strategy_live` has no `###` section despite the "eleven" count (grep: zero hits) — feature-048 debt; flag, do not fix here.
- `services/xstockstrat-agent/CLAUDE.md:22` — "The agent registers eleven tools"; tool table rows end with `set_strategy_live`; "### Management-tool authorization" section lists the admin-scoped tools.
- `docs/runbooks/CLAUDE.md:17` — mcp-tools.md index row: "all eleven agent tools".
- `docs/runbooks/historical-backfill.md`: `## Step 1 — Trigger a Backfill` at `:73`; `### Via gRPC` `:75-101`; **stale** `### Via Webhook` block at `:103-115` (`http://xstockstrat-ingest:8055/webhooks/trigger-backfill` — the 8055 HTTP server was removed per ingest `CLAUDE.md` § Ports and root `CLAUDE.md` § Service-to-Service Calls); `## Step 2 — Monitor Progress` at `:119`.
- Fifth-surface rationale: ledger `insights.md` 2026-07-20 entry (operational runbooks are discovery surfaces — C-10(a) analog).

**TDD**: `N/A (docs step)`

**Instructions**:
1. `docs/runbooks/mcp-tools.md`: change "eleven" → "thirteen" at `:3` and `:29`. After the `manage_signal_source` section's closing `---` (`:401`), add two sections in the `screen_symbols`/`manage_strategy` format:
   - `### \`trigger_backfill\`` — intro: triggers a historical OHLCV backfill via `xstockstrat-ingest` `TriggerBackfill` (feature 066); **write/management op** — sends `x-mcp-secret` **and** the hardcoded admin `x-access-scope`. Parameters table: `symbols` (`string[]`, Yes, max 50), `timeframe` (`string`, No, `"1d"` default; accepts `15m/15Min/1h/1Hour/1d/1Day`), `start`/`end` (`string` ISO 8601, No, one-sided allowed), `overwrite` (`bool`, No, default `false`), `fill_mode` (`string`, No, `"full"` \| `"gaps_only"`, omitted → server FULL). Return: `{ "job_id": "…", "status": "BACKFILL_STATUS_QUEUED" }`. Errors table: invalid params (empty/oversized symbols, bad timeframe/fill_mode/date order) → tool `ValueError` **before** any RPC; ingest performs **no synchronous input validation** — bad symbols surface as a terminal `FAILED`/`PARTIAL` job via `get_backfill_status` (FR-6); ingest unreachable → gRPC error propagated.
   - `### \`get_backfill_status\`` — intro: checks one job or lists recent jobs via `GetBackfillStatus`/`ListBackfillJobs`; **read-only** — `x-mcp-secret` only, no admin scope. Parameters table: `job_id` (No — empty ⇒ list mode), `status_filter` (`queued`/`running`/`completed`/`failed`/`partial`/`canceled`; omit or `unspecified` = all), `symbol`, `limit` (0 ⇒ server default 100), `page_token`. Return: both envelopes — `{ "job": {…} }` (fields incl. `status`, `bars_processed`, `bars_total`, `chunks_completed`, `chunks_total`, `failed_symbols`, `error`) and `{ "jobs": […], "next_page_token": "…" }`. Errors table: unknown `job_id` → `backfill job not found` (NOT_FOUND); unknown `status_filter` → `ValueError`.
2. `services/xstockstrat-agent/CLAUDE.md`: `:22` "eleven" → "thirteen"; add two tool-table rows after `set_strategy_live` (`trigger_backfill` — Trigger an OHLCV history backfill via xstockstrat-ingest (admin-scoped write); `get_backfill_status` — Check/list backfill jobs (read-only)); in "### Management-tool authorization", add `trigger_backfill` to the list of tools forwarding the hardcoded admin `x-access-scope`.
3. `docs/runbooks/CLAUDE.md:17`: "all eleven agent tools" → "all thirteen agent tools".
4. `docs/runbooks/historical-backfill.md`: replace the stale `### Via Webhook` block (`:103-115`) with `### Via MCP tool (AI agents)` documenting a `trigger_backfill` call (same AAPL/MSFT/2020–2024 example as the gRPC block, JSON-ish arg form) with a pointer to `docs/runbooks/mcp-tools.md` — this resolves design Open Risk 3 (the 8055 webhook path no longer exists). Under `## Step 2 — Monitor Progress` (`:119`), add one line noting agents poll via the `get_backfill_status` MCP tool.

**Verification**:
```bash
grep -rn "eleven" docs/runbooks/mcp-tools.md docs/runbooks/CLAUDE.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py   # expect no matches
grep -n "trigger_backfill\|get_backfill_status" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md docs/runbooks/historical-backfill.md   # expect sections/rows present
grep -n "8055" docs/runbooks/historical-backfill.md   # expect no matches
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
