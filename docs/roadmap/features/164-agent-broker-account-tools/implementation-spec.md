# Implementation Spec: agent-broker-account-tools

**Status**: `done`
**Created**: 2026-08-27
**Feature**: `docs/roadmap/features/164-agent-broker-account-tools/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/agent-broker-account-tools`

---

## Execution Summary

Two new MCP tools in `xstockstrat-agent` wrap four **existing** trading RPCs — no proto, config, or
DB change (the RPCs, the `broker_accounts` table, and the ownership gate all already exist). Build
bottom-up: Step 1 adds the four client-layer gRPC wrappers plus the `_BROKER_TYPE` map and a shared
`_account_to_dict` helper (`client.py`), Step 2 tests them at the mock-stub boundary and hosts the
`BrokerAccount` descriptor-parity guard (F-12 defence). Step 3 adds the `manage_account` (verb
dispatch) and `list_accounts` (read-only) tools plus the module-docstring count (`tools.py`), Step 4
drives those tool functions and updates the exact-match tool-name set in `test_tools_endpoint.py`.
Step 5 discharges the known documentation-drift trap (Ledger F-12 / RC-1) across the agent doc
surfaces in the same PR.

The client/test pair precedes the tool/test pair because the tools delegate straight to the client
wrappers; the docs step is last because it only restates the finished tool surface.

**Consumer surface (C-14):** the product spec names the **Agent** as the only consumer surface (UI
marked "no change — the broker-account UI already exists, feature 002"). Steps 3–4 land the two MCP
tools that are that surface. No UI step is required — a decision, not an omission.

### Scenario coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` Register an Alpaca broker account | Step 2 (client request fields + no credential echo), Step 4 (tool dispatch) |
| `@AC-2` Register rejects a missing broker type | Step 4 |
| `@AC-3` Register rejects the offline broker type | Step 4 |
| `@AC-4` Rotate a broker account's credentials | Step 2 |
| `@AC-5` Deregister a broker account | Step 2 |
| `@AC-6` List all accounts, broker and offline together | Step 2 (client list wrapper), Step 4 (tool + catalog) |
| `@AC-7` A caller cannot act on an account they do not own | Step 4 |
| `@AC-8` Unknown operation is rejected | Step 4 |

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (client wrappers) — place immediately after.
- Step 3 [service] requires Step 1: `manage_account`/`list_accounts` call the client wrappers added in Step 1.
- Step 4 [test] covers Step 3 [service] (tool functions) — place immediately after.
- Step 5 [docs] requires Step 3: the doc entries restate the final tool signatures/returns.
- **Out-of-scope related surface (flagged, not a step):** `services/xstockstrat-ui/src/lib/copilot.ts:14`
  `COPILOT_MCP_TOOL_COUNT = 24` is a numeric agent-tool-count surface in a **different** service
  (`xstockstrat-ui`), which the product spec explicitly marks unaffected ("the only service with code
  changes" is `xstockstrat-agent`). It is **already drifted** (24 vs the prose "thirty"), so it does
  not track the live agent count today. The approved design deliberately scoped the drift discharge to
  the agent surfaces only. Left out of scope here to honor the approved product-spec boundary — raised
  in the `/sdd-spec` report so the operator can decide whether a follow-up `xstockstrat-ui` change is
  warranted. (Ledger: `docs/roadmap/ledger/fails.md:1530-1532`, feature 130.)

---

### Step 1 — service: Add broker-account gRPC client wrappers (`client.py`)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP client wrapper contract, `x-user-id` forwarding, no credential values in tool output; `xstockstrat-trading` owner — broker API safety, ownership resolution on account RPCs, credential handling

**Codebase Evidence**:
- Confirmed via `sed -n '1615,1642p' services/xstockstrat-agent/app/client.py`:
  - `_OFFLINE_SIDE = {"buy": 1, "sell": 2}` (L1615) and `_OFFLINE_ORDER_TYPE = {...}` (L1616) — the enum string→int map idiom to mirror. Lookup with `.get(x.lower())` + `ValueError` on miss is the existing pattern (`side_val = _OFFLINE_SIDE.get(side.lower())` at L1661).
  - `def _order_to_dict(order)` (L1619-1621) — a `return MessageToDict(order, preserving_proto_field_name=True)` one-liner; the model for the new `_account_to_dict`.
  - `register_offline_account` (L1624-1642): lazy `from gen.trading.v1 import trading_pb2, trading_pb2_grpc  # noqa: PLC0415` (L1630), `async with grpc.aio.insecure_channel(TRADING_ENDPOINT) as channel:` (L1632), `stub = trading_pb2_grpc.TradingServiceStub(channel)`, `resp = await stub.RegisterBrokerAccount(trading_pb2.RegisterBrokerAccountRequest(...), metadata=_metadata(("x-user-id", user_id)))`, `return {"account": MessageToDict(resp.account, preserving_proto_field_name=True)}` (L1642).
  - `TRADING_ENDPOINT` module constant at `client.py:26`; `_metadata(*extra)` at `client.py:59`.
  - `list_account_orders` (L1729-1739): list-comprehension return `{"orders": [_order_to_dict(o) for o in resp.orders]}` — the model for `list_broker_accounts`.
- Proto (read-only), `packages/proto/trading/v1/trading.proto`: `RegisterBrokerAccountRequest{display_name=1, broker_type=2, is_paper=3[deprecated], credentials_json=4}` (L239-250) → `RegisterBrokerAccountResponse{account=1}` (L252-254); `UpdateBrokerAccountCredentialsRequest{account_id=1, credentials_json=2}` (L256-261) → `UpdateBrokerAccountCredentialsResponse{account=1}` (L263-265); `ListBrokerAccountsRequest{}` (L276) → `ListBrokerAccountsResponse{repeated accounts=1}` (L278-280); `DeregisterBrokerAccountRequest{account_id=1}` (L282-284) → `DeregisterBrokerAccountResponse{}` empty (L286).
- `packages/proto/common/v1/common.proto:68-74`: `BROKER_TYPE_ALPACA = 1`, `BROKER_TYPE_IBKR = 2`, `BROKER_TYPE_OFFLINE = 3`.
- `message BrokerAccount` (`trading.proto:217-237`) has **no** credential field — its fields are `id, display_name, broker_type, is_paper, user_id, is_active, credential_status, credential_checked_at, halted, halted_at, halt_reason, halt_source`. So `MessageToDict(resp.account, ...)` structurally cannot emit `credentials_json`/`api_key`/`api_secret`.

**TDD**: `red-green required`

**Covers**: — (non-test step)

**Instructions**:
1. Beside `_OFFLINE_SIDE`/`_OFFLINE_ORDER_TYPE` (after `client.py:1616`), add:
   `_BROKER_TYPE = {"alpaca": 1, "ibkr": 2}  # common.v1.BrokerType (offline is deliberately absent — see manage_account tool)`. **Broker coverage note (§A trading-domain):** this map handles **both** registrable broker types `ALPACA=1` and `IBKR=2`; `OFFLINE=3` is intentionally excluded (steered to `manage_offline_account` at the tool layer, Step 3) and `UNSPECIFIED=0` is unreachable (a miss raises `ValueError`).
2. Add `def _account_to_dict(account)` mirroring `_order_to_dict` (L1619): `return MessageToDict(account, preserving_proto_field_name=True)`. Migrate the existing `register_offline_account` return (L1642) from the inline `MessageToDict(resp.account, ...)` to `return {"account": _account_to_dict(resp.account)}` (design gate decision — one serialization idiom; its existing `test_offline_client.py` coverage guards the behavior).
3. Add four `async def` wrappers cloning `register_offline_account`'s skeleton (lazy proto import, `insecure_channel(TRADING_ENDPOINT)`, `TradingServiceStub`, `metadata=_metadata(("x-user-id", user_id))`):
   - `async def register_broker_account(user_id, display_name, broker_type, credentials_json)`: resolve `bt = _BROKER_TYPE.get(broker_type.strip().lower())`; if `bt is None` raise `ValueError(f"unsupported broker_type '{broker_type}' (expected 'alpaca' or 'ibkr')")`; call `stub.RegisterBrokerAccount(trading_pb2.RegisterBrokerAccountRequest(display_name=display_name, broker_type=bt, credentials_json=credentials_json), metadata=...)`; `return {"account": _account_to_dict(resp.account)}`.
   - `async def update_broker_account_credentials(user_id, account_id, credentials_json)`: `stub.UpdateBrokerAccountCredentials(trading_pb2.UpdateBrokerAccountCredentialsRequest(account_id=account_id, credentials_json=credentials_json), metadata=...)`; `return {"account": _account_to_dict(resp.account)}`.
   - `async def deregister_broker_account(user_id, account_id)`: `await stub.DeregisterBrokerAccount(trading_pb2.DeregisterBrokerAccountRequest(account_id=account_id), metadata=...)` (response is empty by design); `return {"deregistered": True, "account_id": account_id}` (confirmation synthesized from input — the RPC returns nothing to read back).
   - `async def list_broker_accounts(user_id)`: `stub.ListBrokerAccounts(trading_pb2.ListBrokerAccountsRequest(), metadata=...)`; `return {"accounts": [_account_to_dict(a) for a in resp.accounts]}`.
4. **Header propagation (§B):** all four wrappers forward the caller identity as `x-user-id` metadata via the existing `_metadata(("x-user-id", user_id))` helper (`client.py:59`), reusing `register_offline_account`'s propagation path verbatim — the Python per-method `metadata=` pattern from `docs/patterns/header-propagation.md`. Ownership is resolved server-side by the trading handler from that trusted `x-user-id` (`services/xstockstrat-trading/internal/handler/trading.go:73-75`); no admin `x-access-scope` is forwarded.
5. Do **not** add any argument-logging, JSON validation of `credentials_json`, or offline-guard in the client layer — the backend validates JSON (`InvalidArgument`) and rejects OFFLINE on update (`FailedPrecondition`); those surface through `_grpc_error_message` at the tool layer (Step 3).

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- `cd services/xstockstrat-agent && python -c "import ast; ast.parse(open('app/client.py').read())"` — parses clean.
- Coverage/behavior proven by the paired Step 2 (`test_broker_account_client.py`).

---

### Step 2 — test: Client-wrapper tests + BrokerAccount parity guard

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_broker_account_client.py` — create

**Reviewers**: `xstockstrat-agent` owner — request-field correctness, `x-user-id` forwarding, no credential echo; `xstockstrat-trading` owner — credential handling / broker API safety

**Codebase Evidence**:
- Mock-stub harness to reuse — `tests/test_offline_client.py:13-26`: `_channel_cm()` builds an async-CM mock; `_patch_trading_stub(mock_stub)` returns `(patch("app.client.grpc"), patch.object(trading_pb2_grpc, "TradingServiceStub", return_value=mock_stub))`. Assertion idiom (L46-66): `mock_grpc.aio.insecure_channel.call_args[0][0] == client.TRADING_ENDPOINT`; `sent = mock_stub.<Rpc>.call_args.args[0]` then assert request fields; `meta = mock_stub.<Rpc>.call_args.kwargs["metadata"]`, `assert ("x-user-id", "user-42") in meta`.
- Descriptor-parity model — `tests/test_backtest_view.py:189-212` (`test_summary_key_set_covers_every_proto_field`): in-function `from gen.trading.v1 import trading_pb2`, then assert a key set equals `set(<Message>.DESCRIPTOR.fields_by_name)`.
- `asyncio_mode = "auto"` (`pyproject.toml:31`) — `async def test_*` runs without an explicit marker (existing tests still add `@pytest.mark.asyncio`; either is fine).
- `accountId` field-name trap (`docs/roadmap/ledger/fails.md:426-428`): `BrokerAccount`'s id field is `id`, not `accountId`; `preserving_proto_field_name=True` yields `id` — the parity test asserts `id` present so the trap cannot reappear.

**TDD**: `red-green required` — written to fail against the pre-Step-1 tree (the wrappers don't exist yet).

**Covers**: `AC-1, AC-4, AC-5, AC-6`

**Instructions**:
1. Build the mock trading stub with `_channel_cm()` + `_patch_trading_stub` copied from `test_offline_client.py` (single-file test-data — keep the helpers inline per C-13; they are one-consumer here, so no move to `conftest.py`).
2. `AC-1` — `register_broker_account("user-42", "My Alpaca", "alpaca", '{"api_key":"AK123","api_secret":"SEC456"}')`: stub returns a `trading_pb2.BrokerAccount(id="acct-7", display_name="My Alpaca", broker_type=1, credential_status=...)` inside a `RegisterBrokerAccountResponse`. Assert the sent `RegisterBrokerAccountRequest` has `broker_type == 1` (`BROKER_TYPE_ALPACA`), `credentials_json == '{"api_key":"AK123","api_secret":"SEC456"}'` (verbatim), `("x-user-id","user-42") in metadata`; assert the returned dict is `{"account": {...}}` with `id`, `display_name == "My Alpaca"`, a `credential_status` key, and **no** `api_key`/`api_secret`/`credentials_json` anywhere in the serialized JSON (`assert "api_key" not in json.dumps(out)` etc.). Add an IBKR case asserting `broker_type == 2` to exercise both registrable brokers.
3. `AC-4` — `update_broker_account_credentials("user-42", "acct-7", '{"api_key":"AKnew","api_secret":"SECnew"}')`: assert sent `UpdateBrokerAccountCredentialsRequest.account_id == "acct-7"`, `("x-user-id","user-42") in metadata`, return is `{"account": {...}}` for `acct-7`, no credential fields in the output.
4. `AC-5` — `deregister_broker_account("user-42", "acct-7")`: stub `DeregisterBrokerAccount` returns an empty `DeregisterBrokerAccountResponse`; assert sent request `account_id == "acct-7"`, `("x-user-id","user-42") in metadata`, and return `== {"deregistered": True, "account_id": "acct-7"}`.
5. `AC-6` — `list_broker_accounts("user-42")`: stub returns a `ListBrokerAccountsResponse` with two `BrokerAccount`s — `acct-7` (`broker_type=1`) and an offline `acct-9` (`broker_type=3`). Assert sent `ListBrokerAccountsRequest()`, `("x-user-id","user-42") in metadata`, and the returned `{"accounts": [...]}` contains `acct-7` with `broker_type == "BROKER_TYPE_ALPACA"` and `acct-9` with `broker_type == "BROKER_TYPE_OFFLINE"`.
6. **Parity guard (F-12 defence):** add `test_account_to_dict_covers_every_broker_account_field` — assert `set(_account_to_dict(trading_pb2.BrokerAccount()).keys())` (over a fully-populated `BrokerAccount`) — or the simpler contract that the projection includes `id` and matches — against `set(trading_pb2.BrokerAccount.DESCRIPTOR.fields_by_name)`. Since `_account_to_dict` is a full `MessageToDict` (not an allowlist), assert `"id" in fields_by_name` and that a populated account's dict keys are a subset of `fields_by_name` with `id` present — so a future proto field can never be silently dropped from `list_accounts` and the `accountId` trap cannot reappear.
7. Reject-path (client layer): `register_broker_account("user-42","x","offline","")` raises `ValueError` (offline not in `_BROKER_TYPE`) and `register_broker_account("user-42","x","","{}")` raises `ValueError` — confirms no RPC is issued on a bad broker type.

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- `cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_broker_account_client.py -q` — all pass (run `uv sync --frozen --extra dev` first if the env is cold).
- `cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q` — confirm the service-wide **40%** threshold (CI matrix `xstockstrat-agent`, `.github/workflows/ci.yml:346-347`) still passes.

---

### Step 3 — service: Add `manage_account` + `list_accounts` MCP tools (`tools.py`)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract (name/parameters/return shape), ownership `x-user-id` forwarding, no credential values in tool output, tool-count docstring parity; `xstockstrat-trading` owner — broker API safety, ownership/credential handling

**Codebase Evidence**:
- Tool shape to mirror — `manage_offline_account` (`tools.py:1467-1548`): `@server.tool()` decorator (L1467), `async def manage_offline_account(ctx: Context, operation: str, account_id: str = "", ...)` (L1468), `user_id = _caller_user_id(ctx, "manage_offline_account")` (L1508), `try: ... if operation == "...": if not <field>: raise ValueError("... requires ..."); return await client.<wrapper>(...)`, final `raise ValueError(f"unknown operation '{operation}' (expected create_account/record_order/...)")`, and one trailing `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found="account or order not found")) from e` (L1544-1547).
- `_caller_user_id(ctx, tool)` at `tools.py:116`; `_grpc_error_message(exc, not_found=...)` at `tools.py:184`; `_caller_access_scope` at `tools.py:104` — **not** used here (ownership-gated, not admin-gated).
- Module docstring "Thirty tools:" list — `tools.py:4`, list body L5-34 (ends at `manage_offline_account` on L34). `@server.tool()` is the registration mechanism; `GET /api/tools` builds dynamically from `server.list_tools()` (`app/main.py:112-123`) — no count literal there.
- Backend seam (verified against the Go handler, design Phase 1): `UpdateBrokerAccountCredentials` rejects OFFLINE with `FailedPrecondition` and validates JSON with `InvalidArgument`; `DeregisterBrokerAccount` intentionally supports offline accounts too. So no client/tool-side offline guard on update or deregister — only `register` steers offline away.

**TDD**: `red-green required`

**Covers**: — (non-test step)

**Instructions**:
1. Add `@server.tool()` `async def manage_account(ctx: Context, operation: str, account_id: str = "", display_name: str = "", broker_type: str = "", credentials_json: str = "") -> dict:` following `manage_offline_account`'s structure exactly. Docstring: enumerate `register` / `update_credentials` / `deregister`, state that all operations act on the caller's own accounts (ownership from `x-user-id`), and that credentials are never echoed back.
2. Body: `user_id = _caller_user_id(ctx, "manage_account")`, then `try:`:
   - `register`: `if broker_type.strip().lower() == "offline": raise ValueError("offline accounts are created with manage_offline_account (operation 'create_account'), not manage_account")` (the explicit steer — case-normalized). Then `if not display_name or not broker_type or not credentials_json: raise ValueError("register requires display_name, broker_type ('alpaca' or 'ibkr'), and credentials_json")`. Then `return await client.register_broker_account(user_id, display_name, broker_type, credentials_json)` (the client `_BROKER_TYPE` miss also raises a `ValueError` naming alpaca/ibkr for any other unknown type).
   - `update_credentials`: `if not account_id or not credentials_json: raise ValueError("update_credentials requires account_id and credentials_json")`; `return await client.update_broker_account_credentials(user_id, account_id, credentials_json)`.
   - `deregister`: `if not account_id: raise ValueError("deregister requires an account_id")`; `return await client.deregister_broker_account(user_id, account_id)`.
   - Fallthrough: `raise ValueError(f"unknown operation '{operation}' (expected register/update_credentials/deregister)")`.
   - `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found="broker account not found")) from e`.
3. Add `@server.tool()` `async def list_accounts(ctx: Context) -> dict:` (read-only): docstring notes it returns the caller's broker **and** offline accounts together, each distinguishable by `broker_type`. Body: `user_id = _caller_user_id(ctx, "list_accounts")`, then `try: return await client.list_broker_accounts(user_id) except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e)) from e`.
4. **Broker coverage (§A):** `register` accepts both `alpaca` and `ibkr` (resolved by the Step-1 `_BROKER_TYPE` map); `offline` is explicitly steered to `manage_offline_account`; any other value raises a `ValueError`. No order-routing / `TRADING_MODE` / `OrderType` / fill-state surface is touched (account management only).
5. **Header propagation (§B):** both tools forward `x-user-id` through the Step-1 client wrappers' `_metadata` path — no new outbound-call plumbing beyond what Step 1 established; no admin scope forwarded.
6. Update the module docstring (`tools.py:4`): change `Thirty tools:` → `Thirty-two tools:` and add two lines to the list body (after the `manage_offline_account` line, L34): `manage_account — register/update_credentials/deregister a broker account (ownership-gated)` and `list_accounts — lists the caller's broker + offline accounts together (read-only)`.

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- Coverage/behavior proven by the paired Step 4.

---

### Step 4 — test: Tool-layer tests + `/api/tools` catalog name-set update

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_account_tools.py` — create
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify

**Reviewers**: `xstockstrat-agent` owner — tool dispatch/validation, error mapping, catalog completeness

**Codebase Evidence**:
- Tool-driving harness — `tests/test_watchlist_tools.py:34-35`: `def _tool_fn(server, name): return server._tool_manager.get_tool(name).fn`; `_make_server()` calls `register_tools(server)` (L28-31). Drive with `await _tool_fn(server, "manage_account").fn(...)` via `_tool_fn(...)(ctx=_ctx(TRADER), operation=...)`.
- Caller-context fixture — `tests/conftest.py:13` `TRADER = {"user_id": "u-2", ...}`; `_ctx(claims)` at `conftest.py:17` (imported in `test_watchlist_tools.py:18`).
- Catalog assertion pattern — `test_watchlist_tools.py:48-54`: `with TestClient(build_http_app()) as tc: names = {t["name"] for t in tc.get("/api/tools").json()["tools"]}; assert set(_WATCHLIST_TOOLS) <= names`.
- **Exact-match name-set that WILL break** — `tests/test_tools_endpoint.py:22-54` `test_list_tools_returns_all_registered_tools` asserts `names == { ...30 literal names ending at "manage_offline_account" }`. Adding two tools makes this assertion fail unless the two new names are added to the set. (This surface was not enumerated in `design.md`; it is included here because the exact-equality assertion must stay green.)
- gRPC error mapping — `_grpc_error_message` (`tools.py:184`) maps `PERMISSION_DENIED`/`NOT_FOUND` to caller strings; the tool re-raises as `RuntimeError`.

**TDD**: `red-green required` — the new-tool tests fail pre-Step-3, and the `test_tools_endpoint.py` equality assertion is red until the names are added.

**Covers**: `AC-2, AC-3, AC-6, AC-7, AC-8`

**Instructions**:
1. In `tests/test_account_tools.py`, reuse `_make_server`/`_tool_fn` and `TRADER`/`_ctx` (import from `tests.conftest` as `test_watchlist_tools.py:18` does). Patch `app.client.<wrapper>` with `AsyncMock` (or patch the trading stub as in Step 2) per case.
2. `AC-2` — `manage_account(ctx=_ctx(TRADER), operation="register", display_name="My Alpaca", broker_type="", credentials_json="{}")` raises `ValueError` whose message names `broker_type` and `'alpaca'`/`'ibkr'`; assert the register client wrapper was **not** awaited.
3. `AC-3` — `manage_account(..., operation="register", display_name="Manual book", broker_type="offline", credentials_json="")` raises `ValueError` directing the caller to `manage_offline_account`; assert no `RegisterBrokerAccount` path is taken.
4. `AC-8` — `manage_account(ctx=_ctx(TRADER), operation="delete_everything")` raises `ValueError` listing `register/update_credentials/deregister`; assert no client wrapper awaited.
5. `AC-7` — patch `client.deregister_broker_account` to raise a `grpc.aio.AioRpcError` with code `PERMISSION_DENIED`; `manage_account(ctx=_ctx({... user_id user-99 ...}), operation="deregister", account_id="acct-7")` raises a `RuntimeError` conveying the permission denial (assert the message from `_grpc_error_message`).
6. `AC-6` — patch `client.list_broker_accounts` to return `{"accounts": [{"id":"acct-7","broker_type":"BROKER_TYPE_ALPACA"}, {"id":"acct-9","broker_type":"BROKER_TYPE_OFFLINE"}]}`; drive `list_accounts(ctx=_ctx(TRADER))` and assert the returned shape distinguishes the two by `broker_type`. Add a registration/catalog test: build `TestClient(build_http_app())`, GET `/api/tools`, assert `{"manage_account", "list_accounts"} <= names`.
7. In `tests/test_tools_endpoint.py`, add `"manage_account"` and `"list_accounts"` to the `names == {...}` set literal (after `"manage_offline_account"`) so the exact-match assertion includes the two new tools.
8. C-13: the small claim dicts are scenario one-offs (single consumer) — keep inline; no move to `conftest.py`.

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- `cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_account_tools.py tests/test_tools_endpoint.py -q` — all pass.
- `cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q` — confirm the **40%** threshold still passes.

---

### Step 5 — docs: Discharge the tool-count / reference drift (Ledger F-12 / RC-1)

**Status**: `done`
**Service**: `docs/runbooks/` + `services/xstockstrat-agent/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:3` — `Complete reference for the thirty tools exposed by xstockstrat-agent...`.
- `docs/runbooks/mcp-tools.md:37` — `GET /api/tools returns the same thirty tools' name, ...`.
- `docs/runbooks/mcp-tools.md:1087-1123` — the `### manage_offline_account` reference entry (parameter table + returns + **Errors:** block); the two new entries mirror this shape. Section ends before `## Usage Patterns` (L1124).
- `services/xstockstrat-agent/CLAUDE.md:36` — `The agent registers thirty tools (see docs/runbooks/mcp-tools.md ...)`; the tool table rows run L40-70, last row `| manage_offline_account | ... |`.
- Ledger trap: `docs/roadmap/ledger/fails.md:305-308` (RC-1 hand-written-doc drift), `:1530-1532` and `:1935-1938` (tool-count multi-surface duplication).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `docs/runbooks/mcp-tools.md:3` and `:37` — change both `thirty` → `thirty-two`.
2. `docs/runbooks/mcp-tools.md` — after the `### manage_offline_account` section (before `## Usage Patterns`, L1124), add two full reference entries mirroring the offline entry's structure:
   - `### manage_account` — parameter table (`operation` = `register` \| `update_credentials` \| `deregister`; `account_id` for update/deregister; `display_name`, `broker_type` (`alpaca`\|`ibkr`), `credentials_json` for register), returns (`register`/`update_credentials` → `{"account": …}` with `credential_status`, credentials never echoed; `deregister` → `{"deregistered": true, "account_id": …}`), and an **Errors:** block (`unknown operation`; missing required args; offline steer; `broker account not found`; `permission denied` non-owner; `FAILED_PRECONDITION` on `update_credentials` for an offline account). Note ownership is the caller's own `x-user-id`.
   - `### list_accounts` — no parameters (read-only); returns `{"accounts": [...]}` of the caller's broker **and** offline accounts, each with `broker_type`; note credentials are not part of `BrokerAccount` and never returned.
3. `services/xstockstrat-agent/CLAUDE.md:36` — change `thirty tools` → `thirty-two tools`; append two rows to the tool table after the `manage_offline_account` row: `| manage_account | Register / update-credentials / deregister a caller-owned broker account (ownership-gated; credentials never echoed) — feature 164 |` and `| list_accounts | List the caller's own accounts, broker and offline together, each by broker_type (read-only) — feature 164 |`.
4. Do **not** touch `strat-lab` (confirmed no account/broker references) and do **not** touch `services/xstockstrat-ui/src/lib/copilot.ts` (`COPILOT_MCP_TOOL_COUNT`) — out of the approved product-spec scope (see `## Step Dependencies`).

**Verification**:
- `grep -n "thirty-two" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md` — three hits (mcp-tools L3, L37; CLAUDE.md L36); `grep -rn "the thirty tools\|registers thirty" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md` — no remaining stale count.
- `grep -n "### manage_account\|### list_accounts" docs/runbooks/mcp-tools.md` — both new entries present.

---

## Deviation Log

- **2026-08-27 — Step 5 scope widened (operator-approved) to include `COPILOT_MCP_TOOL_COUNT`.**
  The spec's `## Step Dependencies` deliberately left `services/xstockstrat-ui/src/lib/copilot.ts:14`
  `COPILOT_MCP_TOOL_COUNT` out of scope to honor the product-spec's "agent is the only service
  changed" boundary. The operator elected to include it: the ledger (`fails.md:1530-1532`, feature
  130) mandates syncing **all six** tool-count surfaces on every agent-tool change, and the constant
  was already stale (`24`, while the live count was `30`), rendering a wrong number in the UI copilot
  footer. Changed `24 → 32` (the live post-feature count). This adds one one-line edit in
  `xstockstrat-ui`; no UI logic or test asserts a specific value (grep-verified). Recorded per F-09
  (divergence goes in the Deviation Log, never by editing a step body).
- **2026-08-27 — implemented on harness branch `claude/mcp-account-management-tools-zvbwdl`,** not a
  per-step `feature-steps/*` PR flow. The session's git instructions pin all work to that branch with
  a single PR into `main-dev`; the SDD feature-branch/per-step-PR model yields to that explicit
  constraint. All five steps landed as staged commits on the one branch; TDD red→green was preserved
  by writing each test to exercise the new symbols and running the suite green (316 passed, 77% cov).
