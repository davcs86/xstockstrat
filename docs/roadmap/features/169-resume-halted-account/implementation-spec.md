# Implementation Spec: resume-halted-account

**Status**: `pending`
**Created**: 2026-09-02
**Feature**: `docs/roadmap/features/169-resume-halted-account/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/resume-halted-account`

---

## Execution Summary

The implementation proceeds proto-first (Step 1–2), then builds the Go service layer bottom-up
(middleware authz → service method → handler twin — Steps 3–5), tests the Go layer (Step 6),
extends the Python agent client + tool dispatch (Step 7), tests the Python layer (Step 8), and
finishes with docs (Step 9). DB-first resume ordering is the critical design invariant: Step 4's
`ResumeAccountSvc` clears the DB halt columns before the in-memory maps, inverting `haltAccount`'s
memory-first order so that "stay halted" remains the fail-safe in both directions (design.md §
Ordering rationale). The TRADING-1 dual-handler invariant (Connect handler + `grpcTradingAdapter`
twin) is honored in Step 5 — without the adapter twin, the RPC is unreachable on the wire.

**Consumer surface (C-14)**: Agent — `manage_account` MCP tool gains `resume` operation (Step 7).

## Scenario Coverage

| Scenario | Step(s) |
|---|---|
| AC-1 (clear halt state) | Step 6 |
| AC-2 (ledger event) | Step 6 |
| AC-3 (INFO alert) | Step 6 |
| AC-4 (PERMISSION_DENIED) | Step 6 |
| AC-5 (manage_account resume) | Step 8 |
| AC-6 (no-op non-halted) | Step 6 |
| AC-7 (poller resumes after resume) | Step 6 |
| AC-8 (docs updated) | Step 9 |

## Step Dependencies

- Step 2 requires Step 1: proto-gen depends on proto definitions
- Step 4 requires Step 3: `ResumeAccountSvc` calls `requireAdminScope`
- Step 5 requires Step 4: handler delegates to `ResumeAccountSvc`
- Step 5 requires Step 2: handler references generated `ResumeAccountRequest`/`ResumeAccountResponse` types
- Step 6 covers Steps 3–5: Go unit tests for `requireAdminScope` + `ResumeAccountSvc` + handler wiring
- Step 7 requires Step 2: Python client imports generated `ResumeAccountRequest` stub
- Step 8 covers Step 7: Python tool + client tests

---

### Step 1 — proto: Add ResumeAccount RPC and messages to trading.proto

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint` passes, `buf breaking` passes; `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `service TradingService` block at `trading.proto:10-39`; last RPC is `SnapshotOfflinePositions` at line 38
- `message BrokerAccount` at `trading.proto:221-241`; last field `halt_source = 12`
- `enum HaltSource` at `trading.proto:214-218`
- `DeregisterBrokerAccountRequest` at line 286, `DeregisterBrokerAccountResponse` at line 290 — pattern for the new messages
- Confirmed via: `grep -n "rpc SnapshotOfflinePositions\|DeregisterBrokerAccount" packages/proto/trading/v1/trading.proto`

**TDD**: N/A (proto step — non-code-bearing)

**Covers**: —

**Instructions**:
1. Add a new RPC to `TradingService` after `SnapshotOfflinePositions` (line 38):
   ```protobuf
   rpc ResumeAccount(ResumeAccountRequest) returns (ResumeAccountResponse);
   ```
2. Add new messages after the existing `DeregisterBrokerAccountResponse` block (after line 291):
   ```protobuf
   message ResumeAccountRequest {
     string account_id = 1;
     string reason = 2;
   }

   message ResumeAccountResponse {
     BrokerAccount account = 1;
   }
   ```
   The response wraps `BrokerAccount` so the caller sees post-resume state without a second RPC
   (mirrors `DeregisterBrokerAccountResponse` which returns nothing — here we return the cleared
   account per FR-1/design.md).

**Verification**:
```bash
cd packages/proto && buf lint
```

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/` — regenerated
- `packages/proto/gen/python/trading/v1/` — regenerated
- `packages/proto/gen/ts/src/trading/v1/` — regenerated

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint` passes, `buf breaking` passes; `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the canonical codegen script (root CLAUDE.md § Generating Proto Stubs)
- CI `proto-freshness` job enforces generated code matches `.proto` source

**TDD**: N/A (proto-gen step — non-code-bearing)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Verify no diff beyond the new `ResumeAccount*` types — the generated code should add the new
   request, response, and RPC stub without modifying any existing message.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/
# Confirm only trading/v1 files changed, and changes are additive (new types only)
```

---

### Step 3 — service: Create requireAdminScope helper in trading middleware

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/middleware/authz.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety; Security — auth scope gating

**Codebase Evidence**:
- `PropagationData` struct at `middleware/propagation.go:13`; `AccessScope` field at `:15`
- Python equivalent: `_caller_access_scope` at `services/xstockstrat-agent/app/tools.py:107-116` — `ADMIN_SCOPE = 0x04` bitmask
- Node equivalent: `services/xstockstrat-config/src/middleware/authz.ts:22` — same `0x04` constant
- No Go-native access-scope authorization check exists anywhere in the trading service (recon.md § Risks)
- Confirmed via: `grep -rn "AccessScope\|access.scope\|0x04" services/xstockstrat-trading/` — only `propagation.go:15` propagates it, never reads it for auth

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-trading/internal/middleware/authz.go` with package `middleware`.
2. Define a constant `AdminScope = 0x04` (matching the platform-wide admin bitmask).
3. Implement `RequireAdminScope(ctx context.Context) error`:
   - Extract `PropagationData` from context via `FromContext(ctx)` (the existing extraction function
     in `propagation.go`).
   - Parse `AccessScope` string → int via `strconv.Atoi`; default to `0` on parse failure (empty
     string or non-numeric).
   - If `scope & AdminScope == 0`, return `connect.NewError(connect.CodePermissionDenied, fmt.Errorf("admin scope required"))`.
   - Otherwise return `nil`.
4. The function is exported so it can be reused by future Go RPCs that need admin gating.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./internal/middleware/
```

---

### Step 4 — service: Add ResumeAccountSvc method to TradingService

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety; `xstockstrat-ledger` owner — append-only invariant, event ordering; Security — auth scope gating

**Codebase Evidence**:
- `DeregisterBrokerAccountSvc` at `trading.go:2986` — lifecycle model (scope check → DB op → ledger event → return)
- `haltAccount` at `trading.go:2722` — memory-first write order (inverted for resume: DB-first — design.md § Ordering rationale)
- In-memory maps: `halted` at `:150`, `haltReasons` at `:151` (inferred), `haltedLastPolled` at `:153` (inferred), `haltedMu` at `:161`
- `UpdateHaltStatus` at `account_repo.go:167` — `UPDATE trading.broker_accounts SET halted=$2, halt_reason=$3, halted_at=$4, halt_source=$5`
- `GetBrokerAccount` at `account_repo.go:104`
- `recordToProtoAccount` at `trading.go:2919`
- `emitLedgerEvent` at `trading.go:3660`
- `emitFillAlert` INFO pattern at `trading.go:3690-3692` (severity INFO, category, message format)
- `isAccountHalted` at `trading.go:2673` — short-circuit pattern (mirrors `haltAccount`'s already-halted check at `:2724`)
- `LoadBrokerPool` at `trading.go:245` — hydrates `halted` from DB on restart; DB-first resume ensures restart correctness

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add method `ResumeAccountSvc(ctx context.Context, accountID, reason, callerUserID string) (*tradingv1.BrokerAccount, error)` to `TradingService`, placed near `DeregisterBrokerAccountSvc` (after line ~3019).
2. Implementation order (DB-first — critical invariant):
   a. **Admin scope check**: `middleware.RequireAdminScope(ctx)` — return `PERMISSION_DENIED` on failure.
   b. **Fetch account**: `s.accountRepo.GetBrokerAccount(ctx, accountID)` — return `NOT_FOUND` if nil/error.
   c. **No-op check**: if `!record.Halted`, return `recordToProtoAccount(record), nil` with no event/alert (FR-7/AC-6).
   d. **Capture prior state** before clearing: save `record.HaltReason` and `record.HaltSource` for the ledger event payload.
   e. **DB clear (first)**: `s.accountRepo.UpdateHaltStatus(ctx, accountID, false, "", nil, 0)` — on error, return it (both DB and memory stay halted = fail-safe).
   f. **In-memory clear (second)**: under `s.haltedMu.Lock()`: `delete(s.halted, accountID)`, `delete(s.haltReasons, accountID)`, `delete(s.haltedLastPolled, accountID)`. Only reached after DB success. Releasing the `halted` map entry unblocks the reconciliation poller's next tick (AC-7).
   g. **Ledger event**: `s.emitLedgerEvent(ctx, "account.halt.resumed", "account:"+accountID, callerUserID, payload)` where `payload` is `map[string]interface{}{"account_id": accountID, "reason": reason, "operator": callerUserID, "prior_halt_reason": priorReason, "prior_halt_source": priorSource}`.
   h. **INFO alert**: emit via `s.notify.EmitAlert(ctx, ...)` with severity `ALERT_SEVERITY_INFO`, category `"account"`, message `fmt.Sprintf("Broker account %s resumed by %s: %s", accountID, callerUserID, reason)`.
   i. **Re-fetch and return**: `s.accountRepo.GetBrokerAccount(ctx, accountID)` → `recordToProtoAccount(refreshed)`.
3. No new DB connection pools — reuses existing `s.accountRepo` (F-06).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./internal/service/
```

---

### Step 5 — service: Add ResumeAccount handler + grpcTradingAdapter twin

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- `DeregisterBrokerAccount` Connect handler at `handler/trading.go:291` — pattern for the new handler
- `grpcTradingAdapter.DeregisterBrokerAccount` at `handler/trading.go:340` — pattern for the adapter twin
- `extractUserID` at `handler/trading.go:255` — extracts caller `x-user-id` for ledger/audit
- `grpcTradingAdapter` struct at `handler/trading.go:142`
- TRADING-1 invariant: every RPC needs both a Connect handler AND a `grpcTradingAdapter` twin; only the adapter is registered on the wire (recon.md, design.md)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add Connect handler method on `TradingHandler`, following `DeregisterBrokerAccount` (line 291):
   ```go
   func (h *TradingHandler) ResumeAccount(
       ctx context.Context,
       req *connect.Request[tradingv1.ResumeAccountRequest],
   ) (*connect.Response[tradingv1.ResumeAccountResponse], error) {
       callerUserID := extractUserID(ctx)
       account, err := h.svc.ResumeAccountSvc(ctx, req.Msg.AccountId, req.Msg.Reason, callerUserID)
       if err != nil {
           return nil, err
       }
       return connect.NewResponse(&tradingv1.ResumeAccountResponse{Account: account}), nil
   }
   ```
2. Add `grpcTradingAdapter` twin method, following the `DeregisterBrokerAccount` adapter (line 340):
   ```go
   func (a *grpcTradingAdapter) ResumeAccount(
       ctx context.Context,
       req *tradingv1.ResumeAccountRequest,
   ) (*tradingv1.ResumeAccountResponse, error) {
       resp, err := a.handler.ResumeAccount(ctx, connect.NewRequest(req))
       if err != nil {
           return nil, err
       }
       return resp.Msg, nil
   }
   ```
   **Critical**: without this adapter twin, `ResumeAccount` is unreachable on the gRPC wire
   (TRADING-1 invariant from design.md).
3. Register the adapter method — verify `grpcTradingAdapter` already satisfies the generated
   `TradingServiceServer` interface via the proto-gen step. If Go compilation shows a missing
   method error on `grpcTradingAdapter`, that confirms the adapter twin is correctly required.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
```

---

### Step 6 — test: Go unit tests for ResumeAccountSvc and requireAdminScope

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_resume_account_test.go` — create
- `services/xstockstrat-trading/internal/middleware/authz_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- Existing test pattern: `services/xstockstrat-trading/internal/service/` contains `*_test.go` files using `pgxmock` for repository mocking and `testify` assertions
- `internal/testdata/order_rows.go` — `OrderRowColumns` at `:11`, `NewOrderRow` at `:24` — existing test data pattern (C-13: single consumer → inline is compliant for new halt-related test data since no second consumer exists yet)
- Alert emission mock: tests mock the `notify` client interface
- Ledger emission mock: tests mock the `ledger` client interface

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6, AC-7`

**Instructions**:

**`authz_test.go`** — test `RequireAdminScope`:
1. `TestRequireAdminScope_AdminAllowed` — context with `AccessScope = "4"` (0x04) → returns nil.
2. `TestRequireAdminScope_AdminWithOtherBits` — context with `AccessScope = "7"` (0x07 includes 0x04) → returns nil.
3. `TestRequireAdminScope_TraderDenied` — context with `AccessScope = "2"` → returns `PermissionDenied`.
4. `TestRequireAdminScope_EmptyDenied` — context with `AccessScope = ""` → returns `PermissionDenied`.
5. `TestRequireAdminScope_NonNumericDenied` — context with `AccessScope = "abc"` → returns `PermissionDenied`.

**`trading_resume_account_test.go`** — test `ResumeAccountSvc`:
1. **AC-4** `TestResumeAccount_PermissionDenied` — context with non-admin scope → error is `PermissionDenied`, no DB calls.
2. **AC-1** `TestResumeAccount_Success` — halted account → DB `UpdateHaltStatus(false, "", nil, 0)` called, in-memory maps cleared (`halted`, `haltReasons`, `haltedLastPolled`), returned `BrokerAccount` has `halted=false`.
3. **AC-2** `TestResumeAccount_LedgerEvent` — successful resume → `emitLedgerEvent` called with type `"account.halt.resumed"`, payload contains `account_id`, `operator`, `prior_halt_reason`, `prior_halt_source`, `reason`.
4. **AC-3** `TestResumeAccount_InfoAlert` — successful resume → `EmitAlert` called with severity INFO, message contains account ID and operator.
5. **AC-6** `TestResumeAccount_NonHalted_NoOp` — non-halted account → returns account with `halted=false`, no `UpdateHaltStatus` call, no ledger event, no alert.
6. `TestResumeAccount_AccountNotFound` — unknown account ID → returns `NotFound` error.
7. `TestResumeAccount_DBFailure_StaysHalted` — `UpdateHaltStatus` returns error → error propagated, in-memory maps still contain the account (fail-safe: both paths halted).
8. **AC-7** `TestResumeAccount_ClearsHaltedMap` — after successful resume, verify `s.halted[accountID]` is false/absent, confirming the reconciliation poller's `isAccountHalted` check will return false on the next tick.

Test data: inline halt-related constants (`accountID = "test-acct-1"`, `haltReason = "unknown_broker_order: bo-xyz"`, etc.) — single consumer, compliant with C-13.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/middleware/ -run "TestRequireAdminScope" -v -count=1
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run "TestResumeAccount" -v -count=1
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# Confirm ≥ 40% coverage; note: ResumeAccountSvc is in the excluded `service/` package — integration test verification is sufficient for that package; requireAdminScope in `middleware/` IS measured.
```

---

### Step 7 — service: Add resume_broker_account client wrapper and manage_account dispatch

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output

**Codebase Evidence**:
- `deregister_broker_account` at `client.py:1948` — ephemeral channel, lazy proto import, `_metadata`, returns `_account_to_dict` result; pattern for the new wrapper
- `_account_to_dict` at `client.py:1698` — `MessageToDict` + AGENT-7 bool-pinning for `halted`
- `_metadata` at `client.py:59` — header propagation helper
- `TRADING_ENDPOINT` at `client.py:26`
- `manage_account` dispatch at `tools.py:1652-1676` — `operation` routing: register/update_credentials/deregister
- `_caller_access_scope` at `tools.py:107` — admin-scope gating (ADMIN_SCOPE = 0x04), already used by `trigger_backfill` etc.
- ValueError at `tools.py:1676`: `"unknown operation '{operation}' (expected register/update_credentials/deregister)"` — must be extended to include `resume`
- Header propagation: `_metadata` in client.py forwards `x-user-id`, `x-access-scope`, `x-trace-id` via gRPC metadata — existing pattern, no new propagation needed (step-constraints §B)
- Confirmed via: `grep -n "def deregister_broker_account\|_caller_access_scope\|expected register" services/xstockstrat-agent/app/client.py services/xstockstrat-agent/app/tools.py`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

**`client.py`** — add `resume_broker_account`:
1. After `deregister_broker_account` (line ~1948), add:
   ```python
   async def resume_broker_account(user_id: str, account_id: str, reason: str = "") -> dict[str, Any]:
       from gen.trading.v1 import trading_pb2, trading_pb2_grpc
       async with grpc.aio.insecure_channel(TRADING_ENDPOINT) as channel:
           stub = trading_pb2_grpc.TradingServiceStub(channel)
           resp = await stub.ResumeAccount(
               trading_pb2.ResumeAccountRequest(account_id=account_id, reason=reason),
               metadata=_metadata(("x-user-id", user_id)),
           )
           return _account_to_dict(resp.account)
   ```
   Follows `deregister_broker_account` pattern exactly: ephemeral channel, lazy import, `_metadata`
   for header propagation, `_account_to_dict` for response mapping.

**`tools.py`** — extend `manage_account` dispatch:
1. Add `reason: str = ""` parameter to the `manage_account` function signature (alongside existing
   `operation`, `account_id`, etc.).
2. Add a `"resume"` branch in the dispatch block, between `"deregister"` (line 1672) and the
   `ValueError` (line 1676):
   ```python
   if operation == "resume":
       scope = _caller_access_scope(ctx, "manage_account")
       if not (scope & 0x04):
           raise PermissionError("manage_account resume requires admin scope")
       return await client.resume_broker_account(
           user_id=_caller_user_id(ctx, "manage_account"),
           account_id=account_id,
           reason=reason,
       )
   ```
3. Update the `ValueError` message from
   `"expected register/update_credentials/deregister"` to
   `"expected register/update_credentials/deregister/resume"` (EXTEND of @AC-8).
4. Update the `manage_account` docstring (around line 1629) to note the conditional auth model:
   resume requires admin scope and can act on any account, while register/update_credentials/deregister
   remain ownership-gated.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && python -c "from app.client import resume_broker_account; print('import OK')"
```

---

### Step 8 — test: Agent tool and client tests for resume operation

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_account_tools.py` — modify
- `services/xstockstrat-agent/tests/test_broker_account_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape)

**Codebase Evidence**:
- `tests/test_account_tools.py` (186 lines) — existing manage_account tool-level tests
- `tests/test_broker_account_client.py` (248 lines) — existing client wrapper tests
- Confirmed via: `wc -l services/xstockstrat-agent/tests/test_account_tools.py services/xstockstrat-agent/tests/test_broker_account_client.py`

**TDD**: `red-green required`

**Covers**: `AC-5, AC-8`

**Instructions**:

**`test_account_tools.py`** — tool-layer tests:
1. **AC-5** `test_manage_account_resume_success` — mock `client.resume_broker_account` → call
   `manage_account(operation="resume", account_id="acct-1", reason="false positive")` with admin
   scope context → assert `resume_broker_account` called with correct args, result returned.
2. `test_manage_account_resume_requires_admin_scope` — call with non-admin scope → assert
   `PermissionError` raised.
3. `test_manage_account_resume_forwards_reason` — call with `reason="test reason"` → assert
   `resume_broker_account` receives `reason="test reason"`.
4. **AC-8** Update the existing unknown-operation test: verify the error message now includes
   `resume` in the valid operations list (`"expected register/update_credentials/deregister/resume"`).

**`test_broker_account_client.py`** — client-layer tests:
1. `test_resume_broker_account_calls_rpc` — mock gRPC channel + stub → call
   `resume_broker_account("user-1", "acct-1", "reason text")` → assert `ResumeAccount` RPC called
   with `ResumeAccountRequest(account_id="acct-1", reason="reason text")` and metadata includes
   `("x-user-id", "user-1")`.
2. `test_resume_broker_account_returns_account_dict` — mock response with a `BrokerAccount` →
   assert return value matches `_account_to_dict` output shape (includes `halted: False`).

Test data: inline string constants — single consumer, C-13 compliant.

**Verification**:
```bash
cd services/xstockstrat-agent && pytest tests/test_account_tools.py tests/test_broker_account_client.py -v
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
```

---

### Step 9 — docs: Update mcp-tools.md with resume operation

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `manage_account` section at `mcp-tools.md:1179-1207`
- Confirmed via: `grep -n "### .manage_account." docs/runbooks/mcp-tools.md`

**TDD**: N/A (docs step — non-code-bearing)

**Covers**: `AC-8`

**Instructions**:
1. In the `manage_account` section (line 1179), add a `resume` operation row to the operation table
   (or a new subsection, matching the existing format for register/update_credentials/deregister):
   - **Operation**: `resume`
   - **Parameters**: `account_id` (required, string) — the broker account to resume; `reason`
     (optional, string, default `""`) — operator-supplied context for the un-halt
   - **Auth**: requires admin scope (`x-access-scope` bit `0x04`); unlike other operations which
     use ownership gating
   - **Behavior**: Clears the persistent and in-memory halt on the specified broker account. If the
     account is not halted, returns success with no state change. Emits a `account.halt.resumed`
     ledger event and an INFO-level alert.
   - **Returns**: the updated `BrokerAccount` object with `halted: false`

**Verification**:
```bash
grep -A 20 "resume" docs/runbooks/mcp-tools.md | head -25
# Confirm the resume operation is documented with account_id, reason, auth requirement
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
