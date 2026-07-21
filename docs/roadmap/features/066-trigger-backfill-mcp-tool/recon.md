# Recon: trigger-backfill-mcp-tool

**Created**: 2026-07-20
**From**: product-spec.md
**Affected services**: xstockstrat-agent

---

## Objective

Add two MCP tools to `xstockstrat-agent` — `trigger_backfill` (write; admin-scoped) and
`get_backfill_status` (read-only) — wrapping the existing ingest RPCs `TriggerBackfill`,
`GetBackfillStatus`, and `ListBackfillJobs`, so AI agents can fill OHLCV history gaps and monitor
the jobs without the browser UI or private-network access. No proto, config, or DB changes.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.12, FastMCP)
  - Tool registration: `register_tools(server: FastMCP)` with `@server.tool()` decorators —
    `services/xstockstrat-agent/app/tools.py:58-60`; module docstring tool count "Eleven tools:"
    at `app/tools.py:4` (enumeration lines 5–15)
  - Client layer: `services/xstockstrat-agent/app/client.py` — per-call
    `grpc.aio.insecure_channel` + stub; `INGEST_ENDPOINT` const at `app/client.py:15`
  - gRPC error mapping for tools: `_grpc_error_message(exc, not_found=...)` —
    `app/tools.py:32-43`; raised as `RuntimeError` (`app/tools.py:378-379`)
  - `/api/tools` catalog: `app/main.py:180` route → `server.list_tools()` (`app/main.py:84`) —
    fully automatic from FastMCP registration; only the test name-set needs updating
  - No migrations dir (no DB). No backfill code exists in the agent today (grep: zero hits).

## Patterns to REUSE

- **Write-path ingest call (admin-scoped)** → `manage_signal_source` at `app/client.py:431-474`:
  `async with grpc.aio.insecure_channel(INGEST_ENDPOINT)`, `IngestServiceStub`,
  `meta = list(_metadata()) + [("x-access-scope", "7")]` (`app/client.py:461`; same inline shape
  at :293, :603 — no named helper exists)
- **Read-path ingest call (secret only)** → `list_signal_sources` at `app/client.py:47-66`
  (`metadata=_metadata()`; `_metadata()` at `app/client.py:24-27`)
- **ISO date string → `Timestamp`** → `_iso_to_timestamp` at `app/client.py:30-36` (used by
  `ingest_signal` at `app/client.py:87,92`)
- **`TimeRange` composition** → first use in the agent; build
  `common_pb2.TimeRange(start=..., end=...)` per `packages/proto/common/v1/common.proto:42-45`
  from two `_iso_to_timestamp` results
- **Timeframe string → enum** → server accepts `{"15m": 5, "1h": 3, "1d": 4}`
  (`services/xstockstrat-ingest/app/handlers/servicer.py:35` `_STR_TO_ENUM`); dual-field send
  pattern (`timeframe="1d"` + `timeframe_enum=TIMEFRAME_1DAY`) per
  `services/xstockstrat-analysis/app/handlers/servicer.py:509-510`; enum values at
  `packages/proto/common/v1/common.proto:77-83` (`TIMEFRAME_1DAY = 4`; 1MIN/5MIN deprecated)
- **Enum name ↔ value mapping** → `analysis_pb2.ScreenKind.Value(str)` pattern at
  `app/client.py:196-199`; enum → name for outputs via `.Name(...)` at `app/client.py:235`
- **Proto → dict tool return** → `MessageToDict(resp, preserving_proto_field_name=True,
  always_print_fields_with_no_presence=True)` per `run_backtest` at `app/client.py:166-170`
  (rationale comment :161-165)
- **Client tests** → `_channel_cm()` mock recipe `tests/test_client.py:71-75`;
  `patch("app.client.grpc")` + `patch.object(<pb2_grpc>, "<Service>Stub")` `:86-88`;
  admin-scope capture assertion `:100-103`; read-path negative assertion `:172-174`;
  request-field assertions via `call_args[0][0]` `:185-188`
- **Tool tests** → `_make_server()` + `_tool_fn(server, name)` recipe `tests/test_tools.py:15-22`;
  client patched with `patch.object(client, "<fn>", AsyncMock(...))` (`:57`)
- **Catalog test** → exact tool-name set asserted in
  `tests/test_tools_endpoint.py:23-35` (`test_list_tools_returns_all_registered_tools`)

## Dependencies

- Proto/RPC: reuse only — `TriggerBackfill`/`GetBackfillStatus`/`ListBackfillJobs` on
  `xstockstrat.ingest.v1.IngestService` (`packages/proto/ingest/v1/ingest.proto:12-14`);
  `TriggerBackfillRequest` fields `symbols=1, timeframe=2 [deprecated], range=3, overwrite=4,
  timeframe_enum=5, fill_mode=6` (`ingest.proto:61-69`); `TriggerBackfillResponse {job_id=1,
  status=2}` (`:71-74`); `BackfillJob` incl. `failed_symbols=11, chunks_total=13,
  chunks_completed=14` (`:26-42`); `BackfillStatus` 0–6 (`:44-52`); `FillMode` 0–2 (`:54-58`)
- Migration: none (agent has no DB)
- Config keys: none
- Inter-service edges: existing `xstockstrat-agent → xstockstrat-ingest` (gRPC) edge, two new RPC
  methods used on it
- New env vars / ports: none — `INGEST_ENDPOINT` already in `docker-compose.yml:352,466,508`,
  `.do/app.yaml:228,255,441`, `.do/app.dev.yaml`, agent `CLAUDE.md:93`

## Risks / Not-found

- No `TimeRange` construction exists in the agent (first use) — compose per common.proto; risk is
  low but the pattern is new to this service.
- No named admin-metadata helper — three inline `list(_metadata()) + [("x-access-scope", "7")]`
  sites exist (client.py:293, :461, :603); adding a fourth inline copy grows duplication the DRY
  guard rail flags. Design question: extract a tiny `_admin_metadata()` helper (DRY) vs. copy the
  established inline shape (consistency).
- Ingest `TriggerBackfill` performs no synchronous input validation (queues unconditionally,
  `services/xstockstrat-ingest/app/handlers/servicer.py:142-167`); bad input surfaces as terminal
  `FAILED` job. Tests must not expect synchronous `INVALID_ARGUMENT` (product-spec FR-6).
- Ingest `TriggerBackfill` has no `_has_admin_scope` gate today (only `CancelBackfill` at
  servicer.py:551 and `ManageSignalSource` at :859 enforce it) — the tool still sends the admin
  bit defensively (FR-4); do not add a server-side gate in this feature (ingest out of scope).
- Docs count updates span **four** locations (fails.md C-10(a) analog): `app/tools.py:4`,
  agent `CLAUDE.md:22`, `docs/runbooks/mcp-tools.md:3,29`, and `docs/runbooks/CLAUDE.md:17`
  ("all eleven agent tools") — the product spec's FR-5 names only the first three; include the
  fourth.
- `tests/test_tools_endpoint.py:23-35` asserts the exact tool-name set — will fail if not updated
  (built-in reachability test; a feature, not a risk, once accounted for).

## Recommended Scope

1. **service step** — `app/client.py`: `trigger_backfill(...)` + `get_backfill_status(...)`
   client functions (channel/stub/metadata/TimeRange/timeframe mapping/MessageToDict), plus
   `app/tools.py`: two `@server.tool()` wrappers with docstrings and error mapping; update
   `app/tools.py:4` count docstring.
2. **test step** — `tests/test_client.py` (endpoint, metadata split, request-field mapping,
   NOT_FOUND propagation), `tests/test_tools.py` (tool→client delegation), and
   `tests/test_tools_endpoint.py` name-set update; coverage ≥ 40%.
3. **docs step** — `docs/runbooks/mcp-tools.md` (two tool sections + counts),
   `docs/runbooks/CLAUDE.md:17`, agent `CLAUDE.md` (tool table + count).
