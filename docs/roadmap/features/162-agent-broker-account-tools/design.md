# Design: agent-broker-account-tools

**Status at write:** design-approved (quick mode, 1 round). No Floor breach.

## Chosen Approach

Two new MCP tools in `services/xstockstrat-agent`, wrapping four **existing** trading RPCs. No
proto/config/DB change.

### Tool surface (`app/tools.py`)

- **`manage_account(ctx, operation, account_id="", display_name="", broker_type="", credentials_json="")`**
  — verb dispatch modeled byte-for-byte on `manage_offline_account` (`tools.py:1467-1546`): `ctx:
  Context` first, all-string/defaulted params, in-tool `ValueError` on bad args, one trailing
  `except grpc.aio.AioRpcError → RuntimeError(_grpc_error_message(e, not_found="broker account not
  found"))`. Identity from `_caller_user_id(ctx, "manage_account")` (`tools.py:116-131`); **no**
  `_caller_access_scope` (ownership-gated, not admin-gated).
  - `register` — requires `display_name`, `broker_type`, `credentials_json`. **Rejects
    `broker_type=offline`** with a `ValueError` steering to `manage_offline_account` (decided at the
    gate: one creation path per account kind). Wraps `RegisterBrokerAccount`.
  - `update_credentials` — requires `account_id`, `credentials_json`. Wraps
    `UpdateBrokerAccountCredentials`. **No client-side offline guard or JSON validation** — the
    backend already rejects offline accounts with `FailedPrecondition` (`trading.go:2267-2270`) and
    invalid JSON with `InvalidArgument` (`trading.go:2257`); both surface via `_grpc_error_message`'s
    default branch (`tools.py:194`).
  - `deregister` — requires `account_id`. Wraps `DeregisterBrokerAccount`. Intentionally the unified
    deregister path for broker **and** offline accounts — the backend built offline deregister on
    this RPC (`trading.go:2754-2761`, emits `account.deregistered`), so no offline guard here.
  - Unknown op → enumerated `ValueError`.
- **`list_accounts(ctx)`** — read-only, wraps `ListBrokerAccounts` (empty request; ownership from
  `x-user-id`). Returns the caller's broker **and** offline accounts together (offline rows carry
  `broker_type=BROKER_TYPE_OFFLINE`), each distinguishable by `broker_type`.

### Client layer (`app/client.py`)

- `_BROKER_TYPE = {"alpaca": 1, "ibkr": 2}` beside `_OFFLINE_SIDE` (`client.py:1615`). Lookup via
  `.get(broker_type.strip().lower())` + `ValueError` on miss (case-normalized — mirrors
  `_OFFLINE_SIDE`'s `.lower()` at `client.py:1661`). `offline` is deliberately absent; the tool-layer
  explicit steer (case-normalized too) is the single, clearly-messaged source of the offline
  decision — the map's would-be `offline` miss is unreachable for `register` and never reached by the
  other verbs.
- `_account_to_dict(account)` helper mirroring `_order_to_dict` (`client.py:1619-1621`) — a
  `MessageToDict(account, preserving_proto_field_name=True)` one-liner. Used by all three
  account-returning wrappers, **and** the existing `register_offline_account` inline call
  (`client.py:1642`) is migrated to it too (decided at the gate — one serialization idiom).
- Four wrappers cloning `register_offline_account`'s skeleton (lazy `from gen.trading.v1 import
  trading_pb2, trading_pb2_grpc`, `insecure_channel(TRADING_ENDPOINT)`,
  `metadata=_metadata(("x-user-id", user_id))`):
  - `register_broker_account(user_id, display_name, broker_type, credentials_json)` → `{"account": …}`
  - `update_broker_account_credentials(user_id, account_id, credentials_json)` → `{"account": …}`
    (`UpdateBrokerAccountCredentialsResponse.account` — `trading.proto:263-265`, verified)
  - `deregister_broker_account(user_id, account_id)` → `{"deregistered": True, "account_id": account_id}`
    (RPC response is empty — `trading.proto:286`; confirmation synthesized from input)
  - `list_broker_accounts(user_id)` → `{"accounts": [_account_to_dict(a) for a in resp.accounts]}`

### Credential safety (FR-1/FR-2)

Guaranteed **structurally**: every account-returning wrapper serializes only `resp.account`, and
`message BrokerAccount` (`trading.proto:217-237`) has **no credential field** — so
`MessageToDict` cannot emit `credentials_json`/`api_key`/`api_secret`. Inbound plaintext credentials
are safe too: `CallerPropagationMiddleware` (`tools.py:151-171`) forwards only the OAuth-verified
propagation trio — it does **not** log tool-call arguments — and the agent has no OTel span-attribute
capture of tool arguments (verified: no arg/body logging in `app/main.py` or `app/tools.py`;
`/api/tools` at `main.py:112-121` returns name/description/inputSchema only, never call args).

### Tests

- **New** `tests/test_broker_account_client.py` — mock trading stub (`_patch_trading_stub` pattern
  from `tests/test_offline_client.py:15-67`); assert request fields (`broker_type=BROKER_TYPE_ALPACA`,
  `credentials_json` verbatim, `account_id`), `("x-user-id", …)` in metadata, `deregister` returns the
  confirmation dict, credentials absent from every returned dict. **Hosts the `BrokerAccount`
  descriptor-parity test** (`.DESCRIPTOR.fields_by_name`, model `tests/test_backtest_view.py:189-212`;
  asserts `id` present so the `accountId` field-name trap — `fails.md:426-428` — can't reappear).
- **New** `tests/test_account_tools.py` — drive `_tool_fn(server,"manage_account").fn` /
  `list_accounts` with `_ctx(TRADER)` (`tests/test_watchlist_tools.py:28-67`). Cover AC-2 (missing
  broker_type), AC-3 (offline steer message), AC-6 (list broker+offline), AC-7 (PERMISSION_DENIED →
  RuntimeError), AC-8 (unknown op), and assert `/api/tools` lists both new tools. Each `@AC-*` traces
  to a case (C-15).

### Doc-drift discharge (ledger RC-1, `fails.md:305-308`)

Six edits in the same PR — not just the count literals:
1. `docs/runbooks/mcp-tools.md:3` count `thirty→thirty-two` **+ two full reference entries** (params/returns/errors, mirroring `manage_offline_account` at `mcp-tools.md:1087-1121`).
2. `docs/runbooks/mcp-tools.md:37` count `thirty→thirty-two`.
3. `services/xstockstrat-agent/CLAUDE.md:36` count `thirty→thirty-two` **+ two rows** in the tool table.
4. `services/xstockstrat-agent/app/tools.py:4` docstring count **+ two lines** in the list body.
`GET /api/tools` self-updates from `server.list_tools()` — no literal there. `strat-lab` plugin
unaffected (grep: no account/broker refs).

## Rejected Alternatives

- **`manage_account register` also creates offline accounts** — rejected at the gate: duplicates
  `register_offline_account` (`client.py:1624`) and muddies the credentials contract (offline is
  credential-less). One creation path per account kind.
- **Generated enum symbols (`common_pb2.BROKER_TYPE_ALPACA`) instead of literal ints** — rejected:
  breaks DRY-consistency with the entrenched `_OFFLINE_SIDE` literal-int idiom the recon says to
  mirror. (Wins on rename-robustness; not worth the inconsistency.)
- **`deregister` reads the account back before returning** — rejected: the RPC response is empty by
  design; a synthesized `{"deregistered": True, "account_id": …}` is honest and avoids an extra RPC.
- **Skip `_account_to_dict`, inline `MessageToDict`** — rejected: three consumers clear the DRY
  centralization bar; a named helper also gives the parity test a target.

## Open Risks

- None blocking. The `_account_to_dict` migration of `register_offline_account` is a one-line touch
  into feature-157 code (operator-approved at the gate) — keep it surgical; its existing
  `test_offline_client.py` coverage guards the behavior.

## Constitution Rules Touched

- **C-11** — this design-phase ledger touch is recorded (insights entry on the ownership-gated
  agent-tool-over-existing-RPC pattern).
- **C-14** — consumer surface is the Agent (`manage_account`, `list_accounts`); named in product-spec.
- **C-15** — every `@AC-*` in `acceptance.feature` maps to a planned test case.
- **P-03 / behavior #1** — the offline/broker seam across all three verbs was resolved against the Go
  backend (verified rejection/support), not guessed.
- **C-13 / DRY** — `_account_to_dict` centralizes the repeated serialization; `_BROKER_TYPE` reuses
  the existing enum-map idiom.
- **No Floor (`F-*`) breach** — no migration edit, no direct push, no hardcoded config, no invented
  paths (all symbols discovery-confirmed).

## Business Rules Touched (C-16)

Empty — net-new agent-tool behavior; no existing `@AC-*` guarantee to preserve/extend/change.

## Rounds

1 (quick mode, mandated). Termination: user approved after round 1; no unresolved Floor.
