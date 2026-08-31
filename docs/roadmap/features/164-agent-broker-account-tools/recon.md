# Recon: agent-broker-account-tools

**Phase 0 dossier** — grounded facts for `/sdd-design` and `/sdd-spec`. Evidence is `path:line`.

## Objective

Expose broker-account management through the MCP agent by wrapping four **existing** trading RPCs in
two new tools: `manage_account` (register / update_credentials / deregister) and `list_accounts`
(list broker + offline accounts). No proto/config/DB change — the RPCs, table, and ownership gate all
already exist. The only service touched is `xstockstrat-agent`.

## Codebase Map

### xstockstrat-agent (only service with code changes)

- **Tool layer** — `services/xstockstrat-agent/app/tools.py`
  - `manage_offline_account` — the closest mirror: `@server.tool()`, `ctx: Context` first param, verb
    dispatch, `ValueError` on bad args, one `except grpc.aio.AioRpcError` → `RuntimeError(_grpc_error_message(...))` — `tools.py:1467-1546`.
  - `manage_watchlist` — verb-dispatch + read-modify-write example — `tools.py:1359-1425`.
  - `_caller_user_id(ctx, tool)` — derives caller identity, raises if empty — `tools.py:116-131`.
  - `_grpc_error_message(exc, not_found=...)` — gRPC code → caller string — `tools.py:184-195`.
  - `_caller_access_scope(ctx, tool)` — admin-gate helper, **NOT needed here** (ownership-gated) — `tools.py:104-113`.
  - Module docstring "Thirty tools:" list — `tools.py:4` (list body 5-34).
- **Client layer** — `services/xstockstrat-agent/app/client.py`
  - `_metadata(*extra)` — reads caller contextvar, dedups; `set_caller`/`reset_caller` at 41-51 — `client.py:59-69`.
  - `register_offline_account` — canonical trading-RPC wrapper: lazy `from gen.trading.v1 import trading_pb2, trading_pb2_grpc` (1630), `insecure_channel(TRADING_ENDPOINT)` (1632), `stub.RegisterBrokerAccount(...)` (1634), `metadata=_metadata(("x-user-id", user_id))` (1640), returns `{"account": MessageToDict(resp.account, preserving_proto_field_name=True)}` (1642) — `client.py:1624-1642`.
  - `list_account_orders` / `list_account_positions` — list-comprehension MessageToDict form to mirror for `list_accounts` — `client.py:1729-1739`, `1742-1754`.
  - Enum string→int map idiom: `_OFFLINE_SIDE = {"buy": 1, "sell": 2}`, `_OFFLINE_ORDER_TYPE = {...}` with `.get()` + `ValueError` on miss — `client.py:1615-1616`, usage `1661-1666`.

### xstockstrat-trading (consumed only — no change)

- Handler resolves ownership from trusted `x-user-id` metadata via `extractUserID(ctx)` and rejects
  non-owners at the service layer — `services/xstockstrat-trading/internal/handler/trading.go`:
  `RegisterBrokerAccount` (246-251), `ListBrokerAccounts` (258-263, takes `userID`), `DeregisterBrokerAccount` (270-275), `UpdateBrokerAccountCredentials` (281-289). Ownership comment: `trading.go:73-75`.

### Proto contracts (read-only reference)

- `packages/proto/trading/v1/trading.proto`: RPCs `RegisterBrokerAccount` (26), `ListBrokerAccounts`
  (27), `DeregisterBrokerAccount` (28), `UpdateBrokerAccountCredentials` (31). `message BrokerAccount`
  fields `id=1, display_name=2, broker_type=3, is_paper=4, user_id=5, is_active=6, credential_status=7,
  credential_checked_at=8, halted=9, halted_at=10, halt_reason=11, halt_source=12` — `217-237`.
  Requests: `RegisterBrokerAccountRequest{display_name=1, broker_type=2, is_paper=3[deprecated], credentials_json=4}` (239-250);
  `UpdateBrokerAccountCredentialsRequest{account_id=1, credentials_json=2}` (256-261);
  `ListBrokerAccountsRequest{}` (276)→`{repeated accounts=1}` (278-280);
  `DeregisterBrokerAccountRequest{account_id=1}` (282-284)→empty (286).
- `packages/proto/common/v1/common.proto:68-74`: `BROKER_TYPE_UNSPECIFIED=0`, `BROKER_TYPE_ALPACA=1`,
  `BROKER_TYPE_IBKR=2`, `BROKER_TYPE_OFFLINE=3`.

## Patterns to REUSE (anti-duplication core)

| Need | Reuse | Evidence |
|---|---|---|
| New management tool shape | `manage_offline_account` verb-dispatch tool | `tools.py:1467-1546` |
| Caller identity + ownership gate | `_caller_user_id(ctx, tool)` + `_metadata(("x-user-id", user_id))` | `tools.py:116-131`, `client.py:59-69` |
| gRPC error → caller message | `_grpc_error_message(e, not_found=...)` | `tools.py:184-195` |
| Trading-RPC client wrapper | `register_offline_account` (channel/import/stub/metadata) | `client.py:1624-1642` |
| List-RPC → list-of-dicts | `list_account_orders` MessageToDict comprehension | `client.py:1729-1739` |
| broker_type string→enum | `_OFFLINE_SIDE` map idiom (new `_BROKER_TYPE` map, `.get()`+ValueError) | `client.py:1615-1616` |
| BrokerAccount→dict | inline `MessageToDict(resp.account, preserving_proto_field_name=True)` (no dedicated helper exists) | `client.py:1642` |
| Field-parity guard (F-12 defence) | `test_backtest_view.py` descriptor-parity assert against `.DESCRIPTOR.fields_by_name` | `tests/test_backtest_view.py:189-212` |
| Client-layer test (mock trading stub) | `_patch_trading_stub` + assert request fields + `("x-user-id",…) in meta` | `tests/test_offline_client.py:15-67` |
| Tool-layer test (drive `.fn`) | `_tool_fn(server, name).fn` + `_ctx(TRADER)` + `/api/tools` catalog check | `tests/test_watchlist_tools.py:28-67`; `conftest.py:12-17` |

## Dependencies

- **Proto/RPC**: all four RPCs already exist and are wired in the agent's generated stubs. **No proto change.**
- **Migration chain**: none — `broker_accounts` table + ownership column already exist (feature 001/157).
- **Config keys**: none.
- **Env vars**: `TRADING_ENDPOINT` already consumed by `register_offline_account` — no new env var.
- **Inter-service edge**: agent → trading gRPC (existing).

## Existing Business Rules (C-16 read side)

**Empty.** No `docs/sdd/business-rules/` dir and no `services/xstockstrat-agent/acceptance/` or
`services/xstockstrat-trading/acceptance/` suites exist (verified: dirs absent). This feature
introduces net-new agent-tool behavior with no existing `@AC-*` guarantee to preserve, extend, or
change.

## Risks / Not-found

- **Ledger F-12 / RC-1 (known trap):** agent tool docstrings + `docs/runbooks/mcp-tools.md` + the
  tool-count statements drift from code. Adding two tools must move the count **thirty → thirty-two**
  in **all** inventory surfaces in the same PR:
  1. `services/xstockstrat-agent/CLAUDE.md:36` ("registers thirty tools") + tool table (rows 41-70, add two).
  2. `services/xstockstrat-agent/app/tools.py:4` ("Thirty tools:") module-docstring list (5-34, add two).
  3. `docs/runbooks/mcp-tools.md:3` ("thirty tools").
  4. `docs/runbooks/mcp-tools.md:37` ("GET /api/tools returns the same thirty tools").
  `GET /api/tools` catalog is built dynamically from `server.list_tools()` (`app/main.py:112-121`) — **no
  hardcoded count literal there**, self-updates.
- **F-12 defence:** add a `BrokerAccount`-descriptor-parity test so a later proto field addition can't
  silently vanish from `list_accounts`' response (model: `test_backtest_view.py:189-212`).
- **`mock-backend.ts` field-name trap (fails.md):** `BrokerAccount`'s id field is `id`, not
  `accountId`; `MessageToDict(preserving_proto_field_name=True)` already yields `id` — no risk in the
  agent path, but a reminder for any test assertions.
- **No dedicated `_account_to_dict` helper** — conversion is inline; optionally add one mirroring
  `_order_to_dict` (`client.py:1619`) for the two new wrappers (DRY).
- **`strat-lab` plugin**: does NOT reference account/broker tools (grep: no matches). **No update
  needed** — confirmed.
- **Open design fork:** should `manage_account register` reject `broker_type=offline` (steer to
  `manage_offline_account`)? Proposed: reject. Decide in Phase 1.

## Recommended Scope (advisory step boundaries)

1. `client.py`: add `_BROKER_TYPE` map + four wrappers (`register_broker_account`,
   `update_broker_account_credentials`, `deregister_broker_account`, `list_broker_accounts`) +
   optional `_account_to_dict` helper.
2. `tools.py`: add `manage_account` (register/update_credentials/deregister verb dispatch) and
   `list_accounts`; update the module docstring count/list.
3. Tests: client-layer (mock trading stub, assert request fields + `x-user-id` metadata + no
   credential echo), tool-layer (drive `.fn`, `/api/tools` catalog lists both new tools), and the
   `BrokerAccount` descriptor-parity test.
4. Docs/inventory: `mcp-tools.md` two new entries + all four count surfaces → thirty-two;
   `services/xstockstrat-agent/CLAUDE.md` tool table.
