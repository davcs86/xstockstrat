# Implementation Spec: fix-mcp-tools-page

**Status**: `pending`
**Created**: 2026-11-19
**Feature**: `docs/roadmap/features/360-fix-mcp-tools-page/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-mcp-tools-page`

---

## Execution Summary

The order follows `design.md` § Step shape (D-28): the `agent/v1` contract and its stubs first
(Steps 1+2), because both consumers import them; then the agent server with its tests (Steps 3+4);
then the UI BFF with its tests (Steps 5+6); then the deployment values behind two guards (Step 7);
docs last (Step 8). Three pairs are atomic units because neither member passes its own verification
alone. One squash reaches `main-dev`.

Evidence was read on `ccr-a72ccc3e-9kr7yq@6916759` and re-read on `ccr-a72ccc3e-9kr7yq@4fdea96`
(both = `origin/main-dev@5142fc5` plus docs-only commits under `docs/`); every `path:line` below is
from that tree. Re-check anchors after any `main-dev` merge into the feature branch
(`fails.md:3926`).

Steps 3, 7 and 8 each list more than five files. The step shape is fixed by `design.md` § Step
shape (D-28): each of them is one red-green cycle or one sweep, and splitting it would leave a
commit that fails its own verification.

**Consumer surface (C-14).** UI `/accounts/mcp-tools` is reached by Step 6: the page
(`src/app/accounts/mcp-tools/page.tsx:69`) already calls the BFF route, so only the route changes.
Agent MCP tools: none change (product spec § Consumer Surface(s)); the catalog only lists them.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` catalog fetched from the internal endpoint | Step 5 |
| `@AC-2` no fallback to the public URL | Step 5 (route rows 2a/2b and the "unset ⇒ `null`" client case) |
| `@AC-3` catalog stays behind the UI session | Step 5 (characterization) |
| `@AC-4` public port no longer serves the catalog | Step 3 |
| `@AC-5` only the UI may read the internal catalog | Step 3 |
| `@AC-6` internal catalog lists every registered tool | Step 3 |

Step 7 is a `test` step with `Covers: —`: it adds platform guards for the deployment values, not
an acceptance scenario (D-16, D-25).

## Step Dependencies

- Steps 1+2 land together: a `.proto` edit needs its `proto-gen` step (`step-constraints.md` §C);
  `proto-freshness` fails on uncommitted stubs (`.github/workflows/ci.yml:255-313`).
- Steps 3+4 land together: the Step 3 tests reference symbols Step 4 creates (§C "test references a
  symbol a later step creates"), and Step 4 deletes the route the old tests read (§C "deletes a
  referenced resource").
- Steps 5+6 land together: `tsconfig.json` includes `**/*.ts`, so `tsc --noEmit` compiles the Step 5
  tests, which reference `agentClient` created in Step 6.
- Steps 3–6 require Steps 1+2: the agent imports `gen.agent.v1`, the UI imports
  `@xstockstrat/proto/agent/v1/agent_pb`.
- Step 7 requires Steps 4 and 6. The deployment files for the new port (`GRPC_PORT`, Step 4) and the
  new env var (`AGENT_ENDPOINT`, Step 6) live in Step 7, so that the guards go red before the values
  are added (D-28). Until Step 7 the agent listens on its code default `50061` and the UI answers
  `reachable: false`; nothing deploys before the single squash.
- Step 8 requires Steps 4, 6 and 7 (it documents what they shipped).
- Operator gate before the feature PR merges (D-36): render the DO dev spec and run
  `doctl apps spec validate <file>` without `--schema-only` (confirm the subcommand with `--help`;
  fallback `doctl apps propose --spec <file> --app <id>`; if neither exists, stop). Record date, head
  SHA, command and exit status in `context.md` — never spec content.
- Operator gate after merge (D-26): the DO dev-app `/accounts/mcp-tools` check passes before
  `main-dev` → `main`. If either gate fails: revert the single squash on `main-dev` and return to
  the operator.
- Homelab acceptance after the staging deploy (D-8), recorded in `context.md`.
- The integration PR text must state: a local agent without dev certificates no longer starts in
  HTTP mode (D-27).
- Cross-feature: `345-authelia-sso` (`implementation-ready`) cites the agent route table at
  `app/main.py:250-267`; Step 4 removes one line there. Whichever merges second re-anchors by symbol.
  Its `.github/workflows/ci.yml` path-filter edit is on a line next to the one Step 7 edits
  (rebase only).
- Cross-feature: `337-metrics-host-provider-label` (`in-progress`) edits other functions in
  `services/xstockstrat-agent/app/telemetry.py`, and `docs/patterns/observability.md` and
  `docs/sdd/business-rules/platform.feature` (rebase only; re-read the Step 4 and Step 8 anchors in
  those files after it merges).
- Feature branch: `feature/fix-mcp-tools-page` is not on origin
  (`git ls-remote --heads origin feature/fix-mcp-tools-page` → no output). `/sdd-execute` BRANCH SYNC
  creates it from `main-dev` (`.claude/skills/sdd-execute/templates/branch-sync.md` step 3), which
  needs the feature directory on `main-dev` first (PR #1588). Step 1's `buf breaking` baseline is
  that local branch.

---

### Step 1 — proto: Add package agent/v1 with AgentService.ListTools

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/agent/v1/agent.proto` — create

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf lint` and `buf breaking`
pass; `packages/proto` owner — naming conventions, backward compatibility; `xstockstrat-agent`
owner — MCP tool contract stability (name, parameters, return shape); `xstockstrat-ui` owner —
Connect-RPC call safety

**Codebase Evidence**:
- `ls packages/proto` → no `agent/` directory (**Not found** — created from scratch).
- Header form: `packages/proto/config/v1/config.proto:1-9` (`syntax = "proto3";`,
  `package xstockstrat.config.v1;`,
  `option go_package = "github.com/xstockstrat/contracts/gen/go/config/v1;configv1";`, imports).
- JSON as `google.protobuf.Struct`: `packages/proto/ledger/v1/ledger.proto:8,31`,
  `packages/proto/notify/v1/notify.proto:8,55`.
- Lint profile: `packages/proto/buf.yaml:7-12` (STANDARD minus three rules).
- `scripts/check-otel-produced-signals.py:197-231` reads every `packages/proto/<svc>/v1/*.proto` and
  fails if a stream RPC shares a name with a unary one; `ListTools` is unary and the name is unused.
- `buf breaking` baseline: the local branch `feature/fix-mcp-tools-page`, created by BRANCH SYNC
  before this step (§ Step Dependencies); it is not on origin at spec time.

**Lands with**: `Step 2`

**TDD**: `N/A (proto contract; verified by buf lint/breaking)`

**Covers**: —

**Instructions**:
1. Toolchain preflight, before any `.proto` edit (`insights.md` 2026-07-09 ordering entry): run
   `./scripts/buf-gen.sh` on the untouched tree and confirm `git diff --exit-code packages/proto/gen/`
   is empty. If `buf` or a plugin is missing, provision per
   `docs/runbooks/codegen-toolchain-host-setup.md`. A non-empty diff here is a toolchain mismatch —
   stop and report it; do not commit it.
2. Create `packages/proto/agent/v1/agent.proto` (D-20), following the `config.proto:1-9` header:
   - `syntax = "proto3";`
   - `package xstockstrat.agent.v1;`
   - `option go_package = "github.com/xstockstrat/contracts/gen/go/agent/v1;agentv1";`
   - `import "google/protobuf/struct.proto";` (the only import)
   - `service AgentService { rpc ListTools(ListToolsRequest) returns (ListToolsResponse); }` with a
     comment stating the caller contract: internal only, mutual TLS, `xstockstrat-ui` peer
     certificate only.
   - `message ListToolsRequest {}`
   - `message ListToolsResponse { repeated McpTool tools = 1; }`
   - `message McpTool { string name = 1; string description = 2; google.protobuf.Struct input_schema = 3; }`
3. No enum (C-04: no closed value set). No other package is edited.

**Verification**:
```bash
git rev-parse --verify --quiet feature/fix-mcp-tools-page   # must print a sha; the baseline branch exists locally
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/fix-mcp-tools-page,subdir=packages/proto"
cd ../.. && python3 scripts/check-otel-produced-signals.py
```
If the first command prints nothing, stop: BRANCH SYNC did not create the feature branch. Do not
substitute another baseline.

---

### Step 2 — proto-gen: Regenerate stubs for agent/v1

**Status**: `pending`
**Service**: `packages/proto`
**Files** (names follow the committed `ledger/v1` trees — `git ls-files packages/proto/gen | grep ledger`):
- `packages/proto/gen/go/agent/v1/agent.pb.go` — create
- `packages/proto/gen/go/agent/v1/agent_grpc.pb.go` — create
- `packages/proto/gen/go/agent/v1/agentv1connect/agent.connect.go` — create
- `packages/proto/gen/python/agent/__init__.py` — create
- `packages/proto/gen/python/agent/v1/__init__.py` — create
- `packages/proto/gen/python/agent/v1/agent_pb2.py` — create
- `packages/proto/gen/python/agent/v1/agent_pb2_grpc.py` — create
- `packages/proto/gen/ts/agent/v1/agent.ts` — create
- `packages/proto/gen/ts/agent/v1/agent_pb.ts` — create
- `packages/proto/gen/ts/agent/v1/agent_connect.ts` — create
- `packages/proto/gen/ts/dist/agent/v1/agent.js` — create
- `packages/proto/gen/ts/dist/agent/v1/agent.d.ts` — create
- `packages/proto/gen/ts/dist/agent/v1/agent_pb.js` — create
- `packages/proto/gen/ts/dist/agent/v1/agent_pb.d.ts` — create
- The twelve committed well-known-type files — modify, each only if `buf-gen.sh` rewrites it with
  a comment-only refresh (`insights.md:895-897` says commit it):
  - `packages/proto/gen/ts/google/protobuf/field_mask.ts`
  - `packages/proto/gen/ts/google/protobuf/struct.ts`
  - `packages/proto/gen/ts/google/protobuf/timestamp.ts`
  - `packages/proto/gen/ts/google/protobuf/wrappers.ts`
  - `packages/proto/gen/ts/dist/google/protobuf/field_mask.js`
  - `packages/proto/gen/ts/dist/google/protobuf/field_mask.d.ts`
  - `packages/proto/gen/ts/dist/google/protobuf/struct.js`
  - `packages/proto/gen/ts/dist/google/protobuf/struct.d.ts`
  - `packages/proto/gen/ts/dist/google/protobuf/timestamp.js`
  - `packages/proto/gen/ts/dist/google/protobuf/timestamp.d.ts`
  - `packages/proto/gen/ts/dist/google/protobuf/wrappers.js`
  - `packages/proto/gen/ts/dist/google/protobuf/wrappers.d.ts`

**Reviewers**: inherited from Step 1

**Codebase Evidence**:
- Generators: `packages/proto/buf.gen.yaml` (Go ×3, ts-proto, protoc-gen-es, connect-es);
  Python via `scripts/buf-gen.sh:53-71`, which discovers every `.proto` (`:58`) — no per-package
  registration.
- `dist/` is committed and holds no `_connect` output: `packages/proto/gen/ts/tsconfig.json`
  excludes `**/*_connect.ts`; `git ls-files` shows `dist/ledger/v1/{ledger,ledger_pb}.{js,d.ts}` only.
- TS exports are a wildcard: `packages/proto/gen/ts/package.json:5-7` (`"./*": "./dist/*.js"`).
- Well-known types are generated for TypeScript only:
  `git ls-files packages/proto/gen | grep google/protobuf` → the twelve paths listed above.
- No top-level Python module named `agent` exists in any service
  (`grep -rnE "^(import|from) agent" services --include=*.py` → no hits), so the generated
  top-level `agent` package collides with nothing.
- No descriptor-parity guard covers the new messages (new package; nothing enumerates proto
  packages except `scripts/check-otel-produced-signals.py:200`, covered in Step 1).

**Lands with**: `Step 1`

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage every file it created or changed under `packages/proto/gen/` that is in `**Files**`. Do
   not hand-edit generated files. If any path outside `**Files**` changes, or a well-known-type
   file changes by more than a comment refresh, stop and record a deviation that names each path
   exactly (F-08) — do not stage it.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/
# every path printed must be in this step's Files list; after staging:
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
ls packages/proto/gen/python/agent/v1/agent_pb2_grpc.py packages/proto/gen/ts/dist/agent/v1/agent_pb.js
```

---

### Step 3 — test: Agent catalog RPC, public-route removal, mTLS peer gate, telemetry and parity guard

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify
- `services/xstockstrat-agent/tests/test_mtls.py` — modify
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify
- `services/xstockstrat-agent/tests/test_peer_identity_parity.py` — create
- `services/xstockstrat-agent/tests/test_account_tools.py` — modify
- `services/xstockstrat-agent/tests/test_user_tools.py` — modify
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify (comment only)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, tool-count statements in
sync, no secret values in the catalog; Platform Lead — port uniqueness, inter-service dependency
graph correctness

**Codebase Evidence**:
- Tests that read the catalog over HTTP today: `tests/test_tools_endpoint.py:24-27,80-82,166-169`,
  `:181-185` (`test_list_tools_does_not_require_auth`), `tests/test_account_tools.py:43-50`,
  `tests/test_user_tools.py:47-54`, `tests/test_watchlist_tools.py:49-56`. Comment only:
  `tests/test_config_tools.py:488`. File docstring: `tests/test_tools_endpoint.py:1-6`.
- `_catalog()` (`tests/test_tools_endpoint.py:80-82`) also feeds `:126,144,149`; `_TOOL_COUNT = 45`
  at `:15`. `src/lib/copilot.ts` in the UI names the test
  `test_list_tools_returns_all_registered_tools` — keep that name.
- 401 path for an unauthenticated request: `app/main.py:164-166,179-190,227-233`.
- Shared helpers live in `tests/conftest.py` as plain functions (`_ctx` `:23`, `_rpc_error` `:36`);
  `HANG_GUARD_S` `:20`; dummy `MTLS_*` env `:99-101`; `otel_reset` `:301-333` neutralises only
  `GrpcAioInstrumentorClient` (`:308,320`); `metric_reader` `:336-345`.
- Existing agent PKI fixture: `tests/test_mtls.py:25-82` (inline openssl calls, CA key not
  returned); `SVC = "xstockstrat-trading"` `:17`; `_set_env` `:85-88`; fail-closed test `:115-122`.
- Handshake harness to copy: `services/xstockstrat-ingest/tests/test_mtls.py:27-60` (`_leaf`),
  `:117-167` (server, `_call`, foreign CA); peer-SAN proof
  `services/xstockstrat-ingest/tests/test_peer_identity_spike.py:50-90`.
- Telemetry tests to port: `services/xstockstrat-ingest/tests/test_telemetry.py:113-115` (`VECTORS`),
  `:166` (`_duration_points`), `:287-315` (status vectors), `:318` (non-server spans);
  server-instrumentor neutralising in `services/xstockstrat-ingest/tests/conftest.py:118,130`.
- Cross-service file guard precedent: `tests/test_tool_errors.py:25` (`_ROOT`), `:179-192`;
  byte-identity precedent `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts:101-107`.
- The three copies today: `services/xstockstrat-ingest/app/peer_identity.py` and
  `services/xstockstrat-indicators/app/peer_identity.py` are identical (`diff` → no output); the
  agent has none.
- `pyproject.toml:31-33` (`asyncio_mode = "auto"`), `:22` (dev deps; no new one needed).
- **Not found** (created by Step 4): `app/catalog_service.py`, `app/peer_identity.py`,
  `mtls.server_credentials`, `telemetry._make_rpc_duration_processor`.

**Lands with**: `Step 4`

**TDD**: `red-green required` — red is captured against a behaviour-free skeleton written first
inside this unit (D-34), never against an import error: `app/catalog_service.py` with
`UI_PEER_SAN`, a `CatalogServicer.ListTools` that returns an empty `ListToolsResponse` with no peer
check, and `build_catalog_server`; `mtls.server_credentials()` with server TLS only (no client
auth); `telemetry.RPC_DURATION_BUCKETS_MS` and a `_make_rpc_duration_processor()` that returns a
no-op span processor. The skeleton leaves `app/main.py` untouched and does not create
`app/peer_identity.py`, so that file is absent during the red and the parity test fails on its
existence assertion (it reads the three files by path; it imports none of them). The skeleton is
an uncommitted working-tree stage of this unit: its three files (`app/catalog_service.py`,
`app/mtls.py`, `app/telemetry.py`) are in Step 4's `**Files**`, nothing is committed under Step 3
alone, and Step 4 replaces the skeleton before the unit's single commit (F-08, F-05). The PR lists
the skeleton files beside the red output. Expected reds: empty
catalog (`@AC-6` and every migrated catalog test), "DID NOT RAISE" for the three denial rows
(`@AC-5`), status 200 instead of 401 (`@AC-4`), "DID NOT RAISE" for `_run_http`, zero duration
points, instrumentor not called, agent `peer_identity.py` missing.

**Covers**: `AC-4, AC-5, AC-6`

**Instructions**:
1. `tests/conftest.py`:
   - Add a sync helper `catalog_tools() -> list[dict]` beside `_ctx`. It builds
     `app.main.create_server()`, instantiates `CatalogServicer` over it, and runs `ListTools` with
     a fake peer context through `asyncio.run`. The fake context reports
     `peer_identity_key() == "x509_subject_alternative_name"`, `peer_identities()` =
     `[UI_PEER_SAN.encode()]`, and its `abort(code, details)` **raises** (D-24, O-28). Each entry is
     `{"name", "description", "inputSchema"}` with the schema projected by
     `google.protobuf.json_format.MessageToDict`. Import `app.catalog_service` and `gen.agent.v1`
     inside the function body with no fallback (AGENT-2, D-34). It is for sync tests only.
   - In `otel_reset` (`:301-333`), also neutralise
     `GrpcAioInstrumentorServer.instrument`, as `services/xstockstrat-ingest/tests/conftest.py:130` does.
2. `tests/test_tools_endpoint.py`:
   - Rewrite the docstring (`:1-6`): the file tests the internal catalog and the removed public route.
   - `_catalog()` returns `{t["name"]: t for t in catalog_tools()}`.
   - `test_list_tools_returns_all_registered_tools` (name kept) and
     `test_list_tools_entries_have_description_and_input_schema` read `catalog_tools()` instead of
     `tc.get("/api/tools")`; assertions unchanged.
   - Replace `test_list_tools_does_not_require_auth` with the `@AC-4` test: `GET /api/tools` on
     `TestClient(build_http_app())` with no `Authorization` header returns 401, carries
     `WWW-Authenticate`, and the body is not a catalog (`"tools"` absent).
3. `tests/test_account_tools.py:43-50`, `tests/test_user_tools.py:47-54`,
   `tests/test_watchlist_tools.py:49-56`: take the names from `catalog_tools()`; drop the
   `TestClient`/`build_http_app` imports those functions no longer use.
4. `tests/test_config_tools.py:488`: reword the comment — the schema is the one the catalog serves;
   no route name.
5. `tests/test_mtls.py`:
   - Add `_ca(tmp, name)` and `_leaf(tmp, name, ca, cakey)` helpers on the ingest model and express
     the existing `agent_pki` fixture through them (second consumer of the openssl recipe, C-13).
   - Add a fixture minting, off one test CA: a server leaf `xstockstrat-agent`, a client leaf
     `xstockstrat-ui`, a client leaf for another service (`SVC`); and, off a second (foreign) CA, a
     leaf that also carries `xstockstrat-ui`.
   - Start the real server with `build_catalog_server(create_server(), "127.0.0.1:0")` under the
     agent leaf's `MTLS_*`; clients dial with `grpc.ssl_target_name_override` =
     `xstockstrat-agent` and call `AgentServiceStub.ListTools` with a deadline (`HANG_GUARD_S`).
   - `@AC-5` rows, each after a UI-leaf baseline call on the **same** server succeeds, with the
     status code pinned (D-34, O-39): other-service leaf → `PERMISSION_DENIED`; no client
     certificate → `UNAVAILABLE`; foreign-CA leaf carrying the UI name → `UNAVAILABLE`.
   - `@AC-6`: with the UI leaf, the returned names equal the names of
     `await mcp_server.list_tools()`, and per tool `description == (t.description or "")` and
     `MessageToDict(tool.input_schema) == t.input_schema`. One extra unit case passes a stub server
     whose `list_tools()` yields a tool with `description=None` and asserts `""` (single consumer,
     inline is C-13 compliant).
   - Extend `test_fail_closed_when_env_absent` (`:115-122`) with `mtls.server_credentials()`.
   - `_run_http` fail-closed: with `MTLS_*` deleted and `uvicorn.Server.serve` replaced by a
     recording coroutine, `await main._run_http()` raises `RuntimeError` and `serve` was never
     awaited (port 9000 never listens).
6. `tests/test_telemetry.py`: port `VECTORS`, `_duration_points`, the status-vector test and the
   non-server/non-gRPC span test from the ingest file (anchors above) against the agent's
   `_make_rpc_duration_processor`; add a test that, with `OTEL_ENABLED=true`, `init_telemetry()`
   calls `GrpcAioInstrumentorServer.instrument` (replace the neutralised method with a recorder).
7. `tests/test_peer_identity_parity.py` (D-35): the three files
   `services/xstockstrat-{ingest,indicators,agent}/app/peer_identity.py` exist and are
   byte-identical.
8. Test data (C-13): the only new shared helper is `catalog_tools()` in `tests/conftest.py`; no
   other domain literal gains a second consumer.

**Verification**:
```bash
cd services/xstockstrat-agent && uv sync --extra dev
uv run pytest tests/test_tools_endpoint.py tests/test_mtls.py tests/test_telemetry.py tests/test_peer_identity_parity.py tests/test_account_tools.py tests/test_user_tools.py tests/test_watchlist_tools.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -rn "api/tools" tests/   # expect only the @AC-4 request in tests/test_tools_endpoint.py
```
Confirm the handshake cases executed (not skipped): the `pytest -q` summary must count them.

---

### Step 4 — service: Agent internal catalog server on port 50061; remove public GET /api/tools

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/catalog_service.py` — create
- `services/xstockstrat-agent/app/peer_identity.py` — create
- `services/xstockstrat-agent/app/mtls.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/telemetry.py` — modify
- `services/xstockstrat-agent/app/tool_metrics.py` — modify

(The new port's deployment files — `docker-compose.yml`, `deploy/homelab/compose.yml`,
`.do/app.dev.yaml`, `.do/app.yaml` — are in Step 7; see § Step Dependencies. `GRPC_PORT` is absent
from the agent block in all four today.)

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness, no
secret values in the catalog; Platform Lead — port uniqueness (50061 is free; 50051–50060 taken),
service registry consistency

**Codebase Evidence**:
- Catalog source and route to delete: `app/main.py:124-143` (`list_tools_metadata`), `:263` (Route).
- `build_http_app()` builds its own server at `app/main.py:122`; `create_server()` `:78-83`;
  `_run_http` `:270-278`; `_run_stdio` `:86-96` (untouched); port resolver pattern
  `resolve_http_port()` `:67-70`; `main()` calls `init_telemetry()` before the transport `:281-286`.
- `app/mtls.py`: docstring `:1-10` ("gRPC CLIENT only"), `_load()` `:20-28` (fail-closed
  `RuntimeError`), `channel_credentials()` `:31-36`; no `server_credentials`.
- Pattern to copy: `services/xstockstrat-ingest/app/mtls.py:28-33` (`server_credentials`,
  `require_client_auth=True`); `services/xstockstrat-ingest/app/main.py:104-115` (server, secure
  port, start); `services/xstockstrat-ingest/app/peer_identity.py` (whole file, 16 lines);
  denial form `services/xstockstrat-ingest/app/handlers/servicer.py:493-497`.
- `GRPC_PORT` env with a code default is the platform form:
  `services/xstockstrat-ingest/app/main.py:31`, `services/xstockstrat-indicators/app/main.py:35`.
- Struct from a dict: `app/client.py:1003,1040-1041` (`Struct().update(...)`), `:290,304` (`ParseDict`).
- Lazy `gen.*` imports: agent constitution AGENT-2 (`docs/context-constitution.md`).
- Telemetry: `app/telemetry.py:6-8` (client-only docstring), `:111,151`
  (`GrpcAioInstrumentorClient`), `:126-128` (tracer provider); source to copy
  `services/xstockstrat-ingest/app/telemetry.py:18` (buckets), `:105-116` (`grpc_status_code`),
  `:119-152` (`_make_rpc_duration_processor`), `:255` (registration), `:274` (server instrumentor).
- `app/tool_metrics.py:1` ("the agent has no gRPC server"), `:16-17` (`_BUCKETS_MS`), `:114` (its
  one use).
- Dependencies already present: `pyproject.toml:11` (`grpcio`), `:16`
  (`opentelemetry-instrumentation-grpc`). No `pyproject.toml` or `uv.lock` change.
- Header propagation: the new RPC is inbound and reads no header; the agent adds no outbound call.

**Lands with**: `Step 3`

**TDD**: `red-green required` (green = the Step 3 suite passing against this step)

**Covers**: —

**Instructions**:
1. `app/peer_identity.py`: byte-for-byte copy of
   `services/xstockstrat-ingest/app/peer_identity.py`.
2. `app/mtls.py`: add `server_credentials()` exactly as ingest `app/mtls.py:28-33`; rewrite the
   module docstring so it no longer says the agent is a client only (keep the env and
   authority-pinning facts).
3. `app/catalog_service.py` (D-21):
   - `UI_PEER_SAN = "xstockstrat-ui"`.
   - `CatalogServicer`, a plain class holding the `MCPServer` (no generated base class: that would
     need a module-top `gen.*` import, AGENT-2). `async def ListTools(self, request, context)`:
     first, if `not peer_san_matches(context, UI_PEER_SAN)`,
     `return await context.abort(grpc.StatusCode.PERMISSION_DENIED, ...)` with fixed text; then
     build one `McpTool` per `await self._server.list_tools()` entry — `name`,
     `description or ""`, `input_schema` filled from the tool's schema dict.
   - `build_catalog_server(mcp_server, address)`: creates `grpc.aio.server()`, registers the
     servicer with `add_AgentServiceServicer_to_server`, binds
     `add_secure_port(address, mtls.server_credentials())`, and returns `(server, bound_port)`
     without starting it. No reflection. Missing `MTLS_*` raises here (`mtls._load`).
   - `gen.agent.v1` imports stay inside function bodies (`# noqa: PLC0415`).
4. `app/main.py`:
   - Delete `list_tools_metadata` (`:124-143`) and its Route (`:263`). An unauthenticated
     `GET /api/tools` then reaches `handle_mcp` and gets 401 (D-22).
   - `build_http_app(server=None)`: use the passed server, else `create_server()`.
   - Add `resolve_grpc_port()` beside `resolve_http_port()`: `int(os.environ.get("GRPC_PORT") or "50061")`.
   - `_run_http`: build ONE server with `create_server()`; build and `start()` the catalog server
     on `[::]:<grpc port>` **before** constructing uvicorn; pass the same server to
     `build_http_app`; stop the gRPC server best-effort after `srv.serve()` returns (no custom
     signal handler, no graceful-stop claim). `_run_stdio` is not changed — no gRPC server in stdio
     mode.
   - Add `GRPC_PORT` to the module docstring's transport notes in one line.
5. `app/telemetry.py` (D-30, D-37): add `RPC_DURATION_BUCKETS_MS`, `grpc_status_code` and
   `_make_rpc_duration_processor` as in the ingest file; register the processor on the tracer
   provider and call `GrpcAioInstrumentorServer().instrument()` beside the client instrumentor;
   rewrite the docstring at `:6-8`. Do **not** copy `_CancelStatusInterceptor` (R-13).
6. `app/tool_metrics.py`: delete `_BUCKETS_MS` (`:16-17`) and use
   `telemetry.RPC_DURATION_BUCKETS_MS` at `:114`; fix the `:1` docstring.
7. Not changed: `Dockerfile` (`EXPOSE 9000` stays, D-25), `supervisord.conf`, `pyproject.toml`.

**Verification**:
```bash
cd services/xstockstrat-agent
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
cmp app/peer_identity.py ../xstockstrat-ingest/app/peer_identity.py
grep -rn "list_tools_metadata\|api/tools" app/   # expect no output
grep -rn "CLIENT only\|has no gRPC server\|rather than a gRPC server" app/   # expect no output
```

---

### Step 5 — test: UI route and client tests for the internal catalog; centralize the MCP tool fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.test.ts` — create
- `services/xstockstrat-ui/src/lib/connectClients.test.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/mcpTools.ts` — create
- `services/xstockstrat-ui/e2e/accounts/mcp-tools.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- Route under test: `src/app/accounts/api/mcp-tools/route.ts:13-30` (session gate `:14-15`,
  `AGENT_PUBLIC_URL` read `:17`, `fetch` `:21`, bare `catch` `:25`).
- Mock precedents: `vi.mock('@/lib/auth', async (importOriginal) => …)` with an outer `vi.fn()` —
  `src/lib/__tests__/bffAuthMetrics.test.ts:13,20-24`; `vi.mock('@/lib/connectClients', …)` —
  `src/lib/identity.test.ts:10-12`; `NextRequest` construction —
  `src/app/config-ui/api/audit/route.test.ts:25-29`; env stubs `:40-44,48-51`.
- Header constant: `src/lib/headers.ts:5` (`HEADER_USER_ID`); headers built by
  `src/lib/restBackendHeaders.ts:9-15` (needs the real `rolesToAccessScope`/`generateTraceId`, hence
  `importOriginal`).
- `src/lib/connectClients.test.ts:6-24` (hoisted `createGrpcTransport` mock), `:26-35` (one import in
  `beforeAll`); `makeTransport` builds lazily with `baseUrl: https://<endpoint>` and
  `checkServerIdentity(targetService, peer)` — `src/lib/connectClients.ts:49-66`.
- Fixture today: `e2e/accounts/mcp-tools.spec.ts:12-30` (`SAMPLE_TOOLS`), used at `:47,57`; listed as
  not centralized at `e2e/fixtures/INVENTORY.md:108`; stale comment `mcp-tools.spec.ts:5-7`.
- Vitest reaching `e2e/fixtures` by relative path: `src/lib/backtestBackfill.test.ts:6-7`; user
  fixture `TEST_USER_ID` — `src/lib/__tests__/bffAuthMetrics.test.ts:10`.
- Specs import fixture modules by path (`e2e/accounts/notifications.spec.ts:3-4`);
  `e2e/fixtures/index.ts` does not re-export every module, so no index edit.
- `vitest.config.ts:20` (`include: ['src/**/*.test.ts']`), `:25-33` (coverage scoped to `src/lib/**`,
  `connectClients.ts` excluded, 40% thresholds); `tsconfig.json` `include` has `**/*.ts`.
- A Struct field arrives as a plain JSON object in the UI: `src/lib/performanceMetrics.ts:61`.
- **Not found** (created by Step 6): `agentClient` in `src/lib/connectClients.ts`.

**Lands with**: `Step 6`

**TDD**: `red-green required`. Reds on today's code: `@AC-1` wrong body (`reachable: false`);
`@AC-2a`/`@AC-2b` the throwing `fetch` stub was called; client block `agentClient` is `undefined`
(assertion failure, not an import error). `@AC-3` is "red N/A — characterization test" (the session
gate exists today).

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. `e2e/fixtures/mcpTools.ts`: move `SAMPLE_TOOLS` here unchanged (D-5) and export it.
   `e2e/accounts/mcp-tools.spec.ts`: import it from `../fixtures/mcpTools`, delete the inline
   literal, and reword the header comment (`:5-7`) so it no longer names `GET /api/tools`.
   `e2e/fixtures/INVENTORY.md`: add a canonical row (symbol `SAMPLE_TOOLS`, module
   `e2e/fixtures/mcpTools.ts`, shape `xstockstrat.agent.v1.McpTool` Connect-JSON, consumers: the
   e2e spec and the route test) and remove the `:108` "Not yet centralized" row.
2. `src/app/accounts/api/mcp-tools/route.test.ts` (D-32), static `import { GET } from './route'`:
   - `@/lib/auth` mocked through `importOriginal` with a hoisted session `vi.fn()` defaulting to a
     session for `TEST_USER_ID` and reset in `beforeEach`.
   - `@/lib/connectClients` mocked as `{ get agentClient() { return holder.client; } }` over a
     hoisted holder (O-32) whose default client has a `listTools` `vi.fn()`.
   - Fallback, allowed by this spec (design.md § Open Risks: the getter mock is unexecuted): if
     the getter does not hand each case its own client, mock per case with
     `vi.doMock('@/lib/connectClients', …)`, `vi.resetModules()` and `await import('./route')`
     (the form at `src/app/config-ui/api/audit/route.test.ts:32,40`). The cases and assertions
     below do not change. Record which form was used in `context.md`.
   - In **every** case: `fetch` stubbed with a `vi.fn()` that throws, and `AGENT_PUBLIC_URL`
     stubbed to a public URL (O-34). Every "`fetch` not called" below is an assertion on that
     stub's call count — the route's `catch` hides the throw (`fails.md:4231-4234`). `afterEach`
     calls `vi.unstubAllGlobals()` and `vi.unstubAllEnvs()`.
   - `@AC-1`: `listTools` resolves `{ tools: SAMPLE_TOOLS }` → status 200, body
     `{ tools: SAMPLE_TOOLS, reachable: true }`; `listTools` called once with `{}` and headers
     whose `HEADER_USER_ID` is the session user; `fetch` not called.
   - `@AC-2a`: `listTools` rejects with `ConnectError(…, Code.Unavailable)` → body
     `{ tools: [], reachable: false }`; `listTools` called once; `fetch` not called.
   - `@AC-2b`: holder client `null` → same body; `listTools` not called; `fetch` not called.
   - `@AC-3`: session `null` → 401; neither `listTools` nor `fetch` called.
   - Do not stub `AGENT_ENDPOINT` here: it is inert once the module is mocked (O-43).
3. `src/lib/connectClients.test.ts` (D-33): add a `describe` for `agentClient` that resets modules,
   stubs env, clears the transport mock, then imports dynamically:
   - `AGENT_ENDPOINT` unset ⇒ `agentClient` is `null`.
   - `AGENT_ENDPOINT` set ⇒ non-null; no transport at import; on the first `listTools` call one
     transport is built with `baseUrl` `https://<endpoint>`; the captured `checkServerIdentity`
     accepts a fake peer whose SAN is `xstockstrat-agent` and rejects one for another service.
4. Test data (C-12): `SAMPLE_TOOLS` and `TEST_USER_ID` come from `e2e/fixtures/`; the error payload
   and fake peers are scenario one-offs and stay inline.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec vitest run src/app/accounts/api/mcp-tools/route.test.ts src/lib/connectClients.test.ts
pnpm run test:coverage        # vitest thresholds: ≥ 40% lines/functions/statements on src/lib/**
pnpm run lint && pnpm exec tsc --noEmit
pnpm exec playwright test e2e/accounts/mcp-tools.spec.ts
grep -n "fixtures/mcpTools" e2e/accounts/mcp-tools.spec.ts src/app/accounts/api/mcp-tools/route.test.ts
grep -n "mcpTools\|SAMPLE_TOOLS" e2e/fixtures/INVENTORY.md
```
The route test is outside the coverage scope (`src/lib/**`); its proof is the first command.

---

### Step 6 — service: UI BFF reads the catalog over AgentService.ListTools

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts` — modify
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify (comment only)

(The new env var's deployment files — `docker-compose.yml`, `deploy/homelab/compose.yml`,
`.do/app.dev.yaml`, `.do/app.yaml`, `playwright.config.ts` — are in Step 7; see § Step
Dependencies. `AGENT_ENDPOINT` is absent from all five today: `grep -n AGENT_ENDPOINT` → no hits.)

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- `src/lib/connectClients.ts:4-13` (service imports from `@xstockstrat/proto/<svc>/v1/<svc>_pb`),
  `:17-26` (ten endpoint constants, each with a default host), `:49-82` (`makeTransport`, default
  unary deadline `:72`), `:85-124` (client exports).
- Call-shape template: `src/app/accounts/api/authorized-apps/route.ts:15-19`
  (`restBackendHeaders(req, claims.user_id, claims.roles)` then `client.method(…, { headers })`).
- Route today: `src/app/accounts/api/mcp-tools/route.ts:5-9` (`AgentTool`), `:11-12` (comment naming
  the public catalog), `:17-27`, `:30` (`withBffMetrics`, kept).
- Page contract: `src/app/accounts/mcp-tools/page.tsx:69,105-110` (`reachable === false` message) —
  unchanged.
- `grep -rn "process\.env\.AGENT_PUBLIC_URL" src` → six reads today: this route (`:17`) and five
  that are not touched — `src/app/accounts/api/agent-health/route.ts:11`,
  `src/app/accounts/layout.tsx:19`, `src/app/api/oauth/authorization-server/route.ts:9`,
  `src/app/api/oauth/protected-resource/route.ts:9`, `src/app/auth/oauth-login/page.tsx:15`.
  (The bare name also appears in comments and in `src/lib/oauthCallback*.ts`; those are not reads.)
- Stale comment: `src/lib/copilot.ts:14` ("at runtime (GET /api/tools)").
- Header propagation (C-03, PLAT-4): `restBackendHeaders` sends `x-user-id`, `x-access-scope` and
  `x-trace-id` (`src/lib/restBackendHeaders.ts:9-15`).

**Lands with**: `Step 5`

**TDD**: `red-green required` (green = the Step 5 tests passing against this step)

**Covers**: —

**Instructions**:
1. `src/lib/connectClients.ts` (D-23):
   - Import `AgentService` from `@xstockstrat/proto/agent/v1/agent_pb`.
   - `const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT ?? '';` with a ≤2-line comment: no default
     host, because unset must mean "catalog unavailable" (R-11).
   - `export const agentClient = AGENT_ENDPOINT ? createClient(AgentService, makeTransport(AGENT_ENDPOINT, 'xstockstrat-agent')) : null;`
2. `src/app/accounts/api/mcp-tools/route.ts`:
   - Keep the session gate first (`:14-15`) and the `withBffMetrics` export (`:30`).
   - `if (!agentClient)` → `{ tools: [], reachable: false }`.
   - Otherwise `agentClient.listTools({}, { headers: restBackendHeaders(req, claims.user_id, claims.roles) })`,
     mapped to `{ name, description, inputSchema }` with `reachable: true`; any throw →
     `{ tools: [], reachable: false }` (HTTP 200, as today).
   - Remove the `AGENT_PUBLIC_URL` read and the `fetch`. No fallback (R-2), no warn log (R-5).
   - Rewrite the header comment (≤2 lines): the catalog comes from the agent's internal RPC via
     `AGENT_ENDPOINT`; unset or any failure answers `reachable: false`; never `AGENT_PUBLIC_URL`.
3. `src/lib/copilot.ts:14`: replace "(GET /api/tools)" with the internal catalog RPC; nothing else.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec vitest run src/app/accounts/api/mcp-tools/route.test.ts src/lib/connectClients.test.ts
pnpm run test:coverage
pnpm run lint && pnpm exec tsc --noEmit
grep -n "restBackendHeaders" src/app/accounts/api/mcp-tools/route.ts          # header trio forwarded
grep -n "process\.env\.AGENT_PUBLIC_URL\|api/tools\|fetch(" src/app/accounts/api/mcp-tools/route.ts   # expect no output (the header comment may name AGENT_PUBLIC_URL)
grep -rn "process\.env\.AGENT_PUBLIC_URL" src --include=*.ts --include=*.tsx   # exactly the five reads listed in Codebase Evidence
git diff --quiet HEAD -- src/app/accounts/api/agent-health/route.ts src/app/accounts/layout.tsx \
  src/app/api/oauth/authorization-server/route.ts src/app/api/oauth/protected-resource/route.ts \
  src/app/auth/oauth-login/page.tsx && echo "five readers unchanged"
```

---

### Step 7 — test: Deployment guards, then GRPC_PORT and AGENT_ENDPOINT in every run site

**Status**: `pending`
**Service**: deployment specs (`xstockstrat-agent`, `xstockstrat-ui`); guard housed in the
`xstockstrat-ui` Vitest suite and the homelab render test
**Files**:
- `deploy/homelab/render-assert.jq` — modify
- `scripts/homelab-render.test.sh` — modify
- `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts` — modify
- `deploy/homelab/compose.yml` — modify
- `docker-compose.yml` — modify
- `.do/app.yaml` — modify
- `.do/app.dev.yaml` — modify
- `services/xstockstrat-ui/playwright.config.ts` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — port uniqueness, service registry consistency, dependency graph
correctness; `xstockstrat-ui` owner — Connect-RPC call safety; `xstockstrat-agent` owner — OAuth 2.1
edge-auth correctness and statelessness (`instance_count > 1` stays safe)

**Codebase Evidence**:
- Homelab oracle: `deploy/homelab/render-assert.jq:15-26` (`project`; only the named env keys
  survive, `:23-25`), `:52-54` (agent/UI checks; `:54` pins published ports to agent=9000, ui=3000).
- Render test: `scripts/homelab-render.test.sh:56` (`envv`), `:70-71` (staging check + render),
  `:92` (rendered-value assertion form), `:179` (unmodified production baseline), `:180-184`
  (`mutate`), `:185-214` (mutation rows). Tools it requires: `:13-16`.
- DO guard file: `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts:1-2` (header),
  `:47-48` (`Env`, `Component` — no `internal_ports` yet), `:62-64` (`readSpec`), `:87-98`
  (positive `it.each` on both specs, then a clone mutation).
- Homelab compose: UI endpoints `deploy/homelab/compose.yml:273-282`, `AGENT_PUBLIC_URL` `:284`;
  agent `MCP_HTTP_PORT` `:319`, ports `:323-324`, healthcheck `:325-327`.
- Local compose: UI "gRPC endpoints" block `docker-compose.yml:502-512`, `AGENT_PUBLIC_URL` `:520`;
  agent `MCP_HTTP_PORT` `:572`, ports `:578-579`. `GRPC_PORT: "50055"` form at `:346`.
- DO prod: agent `http_port: 9000` `.do/app.yaml:342`, `MCP_HTTP_PORT` `:383-384`;
  `internal_ports` form `:53-54`; `GRPC_PORT` form `:71-72`; UI endpoints `:630-649`
  (`${xstockstrat-ingest.PRIVATE_DOMAIN}:50055` at `:648-649`), `AGENT_PUBLIC_URL` `:652-653`.
- DO dev: agent `http_port: 9000` `.do/app.dev.yaml:344`, `MCP_HTTP_PORT` `:385-386`; UI
  `INGEST_ENDPOINT` `:645-646`, `AGENT_PUBLIC_URL` `:649-650`.
- No DO component has both `http_port` and `internal_ports` today (design.md § Open Risks).
- Playwright: endpoint env `services/xstockstrat-ui/playwright.config.ts:147-160`, dead-port
  `AGENT_PUBLIC_URL` `:168`; ports in use 9091–9093 and 9099 → 9094 is free.
- CI: agent path filter `.github/workflows/ci.yml:59`; the UI filter already includes `.do/**`
  (`:64`); `homelab` filter `:98-103`; jobs `homelab-render` `:1240-1251`, `sops-secrets`
  `:1253-1271` (triggered by `.do/**`), shell lint `:834-838`.
- `MTLS_*` for the agent is already wired in all four specs (`docker-compose.yml:557-558`,
  `deploy/homelab/compose.yml:305-306`, `.do/app.yaml:349-358`) — no new secret or placeholder
  (`fails.md:2833`).
- `AGENT_ENDPOINT` and an agent `GRPC_PORT` are absent from all of the above (`grep` → no hits).

**TDD**: `red-green required`, inside this one step: write the guards first and capture red on the
current specs (homelab: `check` reports `agent-endpoint`; Vitest: the positive case returns a
reason for both DO specs), then add the values and capture green. Mutation rows are "red N/A —
guard self-check" and are valid only after their baseline assertion passes (O-15, O-19).

**Covers**: — (platform guard for the deployment values; no `@AC-*` scenario — D-16)

**Instructions**:
1. Tool preflight (D-17): `docker compose`, `jq`, `openssl`, `python3`, `yq`, `sops`, `shellcheck`,
   `shfmt`. A missing tool is installed, or logged as a deviation naming the CI job that is the
   green proof — never skipped silently.
2. Guards first.
   - `deploy/homelab/render-assert.jq`: add `AGENT_ENDPOINT` and `GRPC_PORT` to the env projection
     (`:23`). Add one check with label `agent-endpoint`: it fires unless the agent's `GRPC_PORT`
     is a non-empty string **and** the UI's `AGENT_ENDPOINT` equals
     `"xstockstrat-agent:" + <that GRPC_PORT>`. No literal port (R-7).
   - `scripts/homelab-render.test.sh`: in case 1, assert the rendered staging UI value equals
     `xstockstrat-agent:` plus the rendered agent `GRPC_PORT` (via `envv`). In case 7 add three
     `mutate agent-endpoint` rows: UI variable deleted; UI value with an `http://` scheme; agent
     `GRPC_PORT` changed alone.
   - `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts`: extend the file-local
     `Component` type with `internal_ports`; add ONE file-local predicate
     `agentEndpointDrift(spec): string | null` that fails closed (returns a reason) unless the
     `xstockstrat-agent` service has a `GRPC_PORT` env, that port is listed in its
     `internal_ports`, and the `xstockstrat-ui` service's `AGENT_ENDPOINT` equals
     `${xstockstrat-agent.PRIVATE_DOMAIN}:<GRPC_PORT>`. New `describe` (no `AC-n` prefix): `null`
     on `.do/app.yaml` and `.do/app.dev.yaml`; then on a clone, baseline `null` first, then
     non-null after each of: UI env deleted; UI value with a scheme; agent `GRPC_PORT` env deleted;
     port removed from `internal_ports`. Rewrite the file header (≤2 lines) to cover the agent
     endpoint. Do not rename the file or extract helpers (R-8).
3. Capture red (commands below), then add the values (D-25). Beside each `AGENT_ENDPOINT` line put a
   ≤2-line comment: `host:port, no scheme` (D-10).
   - `deploy/homelab/compose.yml`: agent `GRPC_PORT: "50061"` after `MCP_HTTP_PORT` (`:319`); UI
     `AGENT_ENDPOINT: xstockstrat-agent:50061` after `INGEST_ENDPOINT` (`:282`). `ports:` unchanged.
   - `docker-compose.yml`: agent `GRPC_PORT: "50061"` after `:572`; UI
     `AGENT_ENDPOINT: xstockstrat-agent:50061` in the gRPC endpoint block after `:512`. Do **not**
     publish 50061 (the agent's `ports:` stays `9000:9000`).
   - `.do/app.yaml` and `.do/app.dev.yaml`: agent `internal_ports: [50061]` (list form of
     `.do/app.yaml:53-54`) directly after `http_port: 9000`; agent env `GRPC_PORT` = `"50061"`
     after `MCP_HTTP_PORT`; UI env `AGENT_ENDPOINT` =
     `${xstockstrat-agent.PRIVATE_DOMAIN}:50061` after `INGEST_ENDPOINT`.
   - `services/xstockstrat-ui/playwright.config.ts`: `AGENT_ENDPOINT: '127.0.0.1:9094'` beside
     `AGENT_PUBLIC_URL` (`:168`) with a ≤2-line comment (dead port; no mock agent).
   - `.github/workflows/ci.yml:59`: append
     `'services/xstockstrat-ingest/app/peer_identity.py'` and
     `'services/xstockstrat-indicators/app/peer_identity.py'` to the `xstockstrat-agent` filter
     (D-35).
4. `EXPOSE`, healthchecks and published ports are not changed.

**Verification**:
```bash
bash scripts/homelab-render.test.sh
bash scripts/sops-secrets.test.sh
shellcheck scripts/homelab-render.test.sh && shfmt -d -i 2 scripts/homelab-render.test.sh
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/dbTlsPlatformGuard.test.ts \
  && pnpm run test:coverage \
  && pnpm run lint && pnpm exec tsc --noEmit \
  && pnpm exec playwright test e2e/accounts/mcp-tools.spec.ts && cd ../..
grep -n "AGENT_ENDPOINT" docker-compose.yml deploy/homelab/compose.yml .do/app.yaml .do/app.dev.yaml services/xstockstrat-ui/playwright.config.ts   # one hit per file
grep -n "50061" docker-compose.yml deploy/homelab/compose.yml .do/app.yaml .do/app.dev.yaml   # GRPC_PORT + AGENT_ENDPOINT (+ internal_ports on DO); never under ports:
python3 scripts/check-otel-produced-signals.py
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"
grep -n "^ *xstockstrat-agent: " .github/workflows/ci.yml \
  | grep -F "services/xstockstrat-ingest/app/peer_identity.py" \
  | grep -F "services/xstockstrat-indicators/app/peer_identity.py"   # one line: the agent filter carries both paths
```
`pnpm run test:coverage` keeps the UI's ≥ 40% `src/lib/**` thresholds; the guard file itself adds
no production code.

---

### Step 8 — docs: Document the internal catalog endpoint and retire GET /api/tools mentions

**Status**: `pending`
**Service**: `docs/`, root and service `CLAUDE.md` files, durable business-rule suites
**Files**:
- `CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/oauth.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-agent/acceptance/private-by-default-templates.feature` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/reviewer-registry.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `docs/patterns/observability.md` — modify
- `docs/sdd/business-rules/platform.feature` — modify

**Reviewers**: none

**Codebase Evidence** (each anchor read on the stamped tree):
- Root `CLAUDE.md:109` (agent registry row: gRPC Port `—`), dependency tree `:286-305`.
- Agent `CLAUDE.md` § Role ("port 9000"), § Observability, § Environment Variables (mTLS note says
  "client dials"; env block has no `GRPC_PORT`).
- `services/xstockstrat-agent/docs/oauth.md:27` (`GET /api/tools` row).
- `services/xstockstrat-agent/docs/context-constitution.md:5` ("the only backend that speaks HTTP
  and the only one that calls backends as a gRPC client"), `:39` (Pointers row: OTel instruments
  the client channel, not a server).
- `services/xstockstrat-agent/docs/context-constitution-findings.md:48` (open item on the
  unauthenticated route).
- `services/xstockstrat-agent/acceptance/private-by-default-templates.feature:9`
  (`Given the agent MCP tool catalog at GET /api/tools`).
- `services/xstockstrat-ui/CLAUDE.md:15-18` (BFF-only sentence, "backends"), `:138` (Dependencies
  intro and table), `:215-217` (env list).
- `docs/runbooks/mcp-tools.md:45-49` (Tool catalog paragraph);
  `services/xstockstrat-agent/tests/test_tools_endpoint.py:147-163` requires the phrase
  `forty-five tools` to stay in that file.
- `docs/runbooks/reviewer-registry.md:24` ("the unauthenticated `GET /api/tools` catalog").
- `docs/patterns/inter-service-mtls.md:52-74` (SAN-gated grants list).
- `docs/patterns/observability.md:19-20` ("10 gRPC services"; the agent "is a gRPC client").
- `docs/sdd/business-rules/platform.feature:795-798` ("and the /api/tools catalog").
- C-16 sign-offs for the two rule changes: `context.md` (run 2 steer; gate 5).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (D-27):
1. Root `CLAUDE.md`: agent registry row gains gRPC port `50061` (internal tool catalog, UI
   certificate only); add the edge `xstockstrat-ui → xstockstrat-agent (gRPC ListTools, internal
   tool catalog)` to the dependency tree. No naming-convention exception — `AGENT_ENDPOINT` is an
   ordinary gRPC `host:port`.
2. Agent `CLAUDE.md`: Role names the second listener (gRPC 50061, mTLS, `xstockstrat-ui` peer
   only, HTTP mode only); env block gains `GRPC_PORT=50061`; the mTLS note covers the server
   (missing `MTLS_*` now stops the process at boot in HTTP mode); Observability names
   `rpc.server.duration` for the catalog RPC. Keep the phrase `registers forty-five tools`.
3. `docs/oauth.md`: delete the `GET /api/tools` row (`:27`).
4. Agent `docs/context-constitution.md`: correct `:5` and the `:39` Pointers row (server
   instrumentation and `rpc.server.duration` now exist beside `mcp.tool.duration`).
5. Agent findings: mark `:48` closed by this feature; add one open entry — a cancelled or expired
   `ListTools` records status 0 in `rpc.server.duration` because the cancel-status interceptor was
   not copied (D-37, R-13).
6. `private-by-default-templates.feature:9`: the Given reads the catalog through the internal
   catalog RPC (signed off, C-16). `platform.feature:797`: replace "the /api/tools catalog" with
   the internal catalog RPC; the count 45 is unchanged (signed off, C-16).
7. UI `CLAUDE.md`: widen the BFF-only sentence to "the backends or the agent" — the durable home
   of the operator's rule; Dependencies gains the agent row (gRPC 50061, `/accounts/mcp-tools`);
   env list gains `AGENT_ENDPOINT` — "host:port, no scheme; unset ⇒ the MCP Tools page reports the
   agent unreachable; never falls back to `AGENT_PUBLIC_URL`".
8. `docs/runbooks/mcp-tools.md:45-49`: the catalog is served by the internal `ListTools` RPC to the
   UI BFF; the public `GET /api/tools` was removed and now answers 401. Keep `forty-five tools`.
9. `docs/runbooks/reviewer-registry.md:24`: "no secret values in tool output or the internal tool
   catalog".
10. `docs/patterns/inter-service-mtls.md`: add to the SAN-gated list — agent `ListTools` ←
    `xstockstrat-ui` (`UI_PEER_SAN` in `services/xstockstrat-agent/app/catalog_service.py`); the
    SAN is the only check.
11. `docs/patterns/observability.md:19-20`: the agent joins the `rpc_server_duration` producers
    (one unary RPC) and still records `mcp_tool_duration`.

**Verification**:
```bash
npx --yes markdownlint-cli2 --config .markdownlint.yaml CLAUDE.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-ui/CLAUDE.md
python3 scripts/check-context-map.py
python3 scripts/check-otel-produced-signals.py
cd services/xstockstrat-agent && uv run pytest tests/test_tools_endpoint.py -q && cd ../..
grep -rn "api/tools" --include='*.py' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.feature' --include='*.yml' --include='*.yaml' . \
  | grep -v node_modules | grep -v '/\.venv/' | grep -v '^\./docs/roadmap/' | grep -v '^\./docs/reports/' | grep -v '^\./packages/proto/gen/'
```
Expected survivors of the last command (run at spec time: 20 hits in 15 files today): the `@AC-4`
request in `services/xstockstrat-agent/tests/test_tools_endpoint.py`, the closed entry in
`services/xstockstrat-agent/docs/context-constitution-findings.md`, and the removal note in
`docs/runbooks/mcp-tools.md`. Anything else is a miss.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
