# Design: resume-halted-account

**Created**: 2026-09-02
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-09-02
**Grounded in**: recon.md

---

## Chosen Approach

Add a `ResumeAccount` RPC to `xstockstrat-trading` that inverts `haltAccount`: admin-scope check →
DB halt clear → in-memory halt map clear → ledger event → INFO alert → return cleared account.
On the agent side, extend `manage_account`'s dispatch with a `"resume"` branch gated by
`_caller_access_scope` (ADMIN bit `0x04`), calling a new `resume_broker_account` client wrapper.
The consumer surface is the `manage_account` MCP agent tool (C-14).

### Proto

- New `rpc ResumeAccount` added to `TradingService` after `SnapshotOfflinePositions`
  (`packages/proto/trading/v1/trading.proto:38`).
- New messages: `ResumeAccountRequest` (`account_id string = 1`, `reason string = 2`) and
  `ResumeAccountResponse` (`account BrokerAccount = 1`). Response includes the cleared account so
  the caller sees post-resume state without a second RPC.

### Go — Trading Service

- **`requireAdminScope` helper** in `services/xstockstrat-trading/internal/middleware/` — ports the
  `ADMIN_SCOPE = 0x04` bitmask check from Python (`services/xstockstrat-ingest/app/handlers/servicer.py:206-219`)
  and Node (`services/xstockstrat-config/src/middleware/authz.ts:22`). Parses
  `PropagationData.AccessScope` string → int via `strconv.Atoi`, defaults to `0` on failure.
  Returns `codes.PermissionDenied` if bit `0x04` not set. This is the first Go-native access-scope
  check (recon.md § Risks).

- **Handler** in `handler/trading.go`: both a Connect handler method AND a `grpcTradingAdapter`
  twin (per TRADING-1 invariant — every RPC needs both; only the adapter is registered on the wire).
  Handler calls `extractUserID(ctx)` for the ledger event's operator field AND
  `requireAdminScope(ctx)` for authorization.

- **`ResumeAccountSvc`** on `TradingService` — modeled on `DeregisterBrokerAccountSvc`
  (`services/xstockstrat-trading/internal/service/trading.go:2985-3019`):
  1. `requireAdminScope(ctx)` — reject with `PERMISSION_DENIED` if not admin.
  2. `accountRepo.GetBrokerAccount(ctx, accountID)` — verify account exists.
  3. **No-op check**: if `!record.Halted`, return `recordToProtoAccount(record)` with no event/alert
     (FR-7/AC-6, mirrors `haltAccount`'s already-halted short-circuit).
  4. **DB clear first** (fail-safe ordering — adversary objection accepted): call
     `accountRepo.UpdateHaltStatus(ctx, accountID, false, "", nil, 0)`. On failure, return error —
     both DB and memory stay halted (fail-safe toward "keep halted").
  5. **In-memory clear** under `haltedMu` lock: `delete(s.halted, accountID)`,
     `delete(s.haltReasons, accountID)`, `delete(s.haltedLastPolled, accountID)`. Only reached after
     DB success. Releasing the `halted` map entry also unblocks the reconciliation poller's next tick
     for this account (AC-7).
  6. **Ledger event**: `emitLedgerEvent(ctx, "account.halt.resumed", "account:"+accountID, callerUserID, payload)`
     where payload includes `account_id`, `reason`, and `operator` (the caller's `x-user-id`).
  7. **INFO alert**: emit via `s.notify.EmitAlert(ctx, ...)` with severity INFO, category "account",
     message indicating which account was resumed and by whom.
  8. **Return**: `recordToProtoAccount` of the re-fetched (cleared) account.

  **Ordering rationale (DB-first)**: `haltAccount` is memory-first because its fail-safe is "stay
  halted" — a DB failure after memory-set means the account is halted in memory (safe) and
  `LoadBrokerPool` re-hydrates from the still-unhalted DB on restart (temporary miss, acceptable).
  Resume's fail-safe is also "stay halted," so the ordering inverts: DB-first means a DB failure
  leaves both paths halted; a crash after DB-success-but-before-memory-clear restarts with the
  correct `halted=false` from DB via `LoadBrokerPool` (`trading.go:262-268`). Memory-first would
  risk silent re-halt on restart if DB write failed.

### Python — Agent Service

- **`resume_broker_account` client wrapper** in `app/client.py` — follows `deregister_broker_account`
  pattern (`client.py:1955-1969`): ephemeral channel, lazy proto import, `_metadata`. Returns the
  cleared account via `_account_to_dict` (`client.py:1698-1711`).

- **`manage_account` dispatch extension** in `app/tools.py`: new `"resume"` branch between
  `"deregister"` and the `ValueError`. Gated by `_caller_access_scope(ctx, "manage_account")`
  (ADMIN bit `0x04` check at `tools.py:107-116`), unlike other operations which use ownership gating
  via `_caller_user_id`.

- **Tool schema update**: add `reason: str = ""` parameter to the `manage_account` function
  signature. Forwarded to `ResumeAccountRequest.reason`. Default empty string — the reason is
  optional (AC-5 says "with reason 'False positive from reconciliation poller'" as an example).

- **Docstring update**: the `manage_account` docstring (`tools.py:1629-1649`) currently says
  "Manage the CALLER's own BROKER accounts" with ownership-gated semantics. Update to note the
  conditional auth model: resume requires admin scope and can act on any account, while register/
  update_credentials/deregister remain ownership-gated.

- **`ValueError` message update**: extend the valid-operations list from
  `register/update_credentials/deregister` to include `resume` (EXTEND of @AC-8).

### Docs

- **`docs/runbooks/mcp-tools.md`**: update `manage_account` section (`mcp-tools.md:1179-1207`) to
  document the `resume` operation, its admin-scope requirement, and the `reason` parameter.

### Tests

- **Go unit tests**: `ResumeAccountSvc` — admin-scope rejection, non-existent account, non-halted
  no-op, successful resume (DB + memory cleared + ledger + alert), DB-failure leaves memory halted.
- **Agent tool tests**: `test_account_tools.py` — resume dispatches correctly, admin-scope required,
  reason forwarded. Extend the unknown-operation test to verify `resume` is in the valid list.
- **Agent client tests**: `test_broker_account_client.py` — `resume_broker_account` wrapper calls
  the correct RPC with the correct request fields and returns `_account_to_dict` output.

## Rejected Alternatives

- **Separate `resume_account` MCP tool** — would have cleaner admin-only contract without auth-model
  mixing. Rejected because: product spec FR-6 explicitly requires `manage_account`, adding a 34th
  tool has discoverability and complexity cost, and the docstring update + conditional auth model
  note adequately addresses the P-03 concern.
- **Memory-first resume ordering (mirror `haltAccount`)** — simpler symmetry with the halt path.
  Rejected because: fail-safe reasoning inverts for resume direction. A DB failure after memory-clear
  would let the account trade freely until restart, when `LoadBrokerPool` re-hydrates `halted=true`
  from the still-halted DB — a silent, unexpected re-halt. DB-first keeps "stay halted" as the
  failure mode for both directions.
- **`FailedPrecondition` on non-halted account** — explicit error instead of silent no-op. Rejected
  because: consistency with `haltAccount`'s already-halted short-circuit (silent return), and the
  caller (operator) doesn't need to guard against "was it already resumed?" — the idempotent no-op
  is safer for retry/automation.

## Open Risks

- [ ] **First Go-native access-scope check** — `requireAdminScope` is new code with no precedent in
  any Go service. The `x-access-scope` propagation chain (agent `_metadata` → trading
  `UnaryServerInterceptor` → `PropagationData.AccessScope`) is wired but untested for authorization.
  To be addressed at: implementation step (unit test for `requireAdminScope` + integration-level
  verification that agent → trading scope propagation works).
- [ ] **Stale line citations** — adversary found proposer citations off by ~44 lines. All `path:line`
  references must be re-grounded at `/sdd-spec` time against current HEAD. To be addressed at:
  `/sdd-spec` discovery pass.

## Constitution Rules Touched

- `C-01` — honored by: all architectural claims cite recon.md evidence (line citations to be
  re-grounded at spec time).
- `C-04` — honored by: `ResumeAccountRequest` uses proto enum `HaltSource` zero-value for clearing;
  response wraps `BrokerAccount` message.
- `C-08` — honored by: reusing `UpdateHaltStatus`, `emitLedgerEvent`, `recordToProtoAccount`,
  `_caller_access_scope`, `_account_to_dict` instead of creating parallel implementations.
- `C-14` — honored by: consumer surface (`manage_account` MCP tool) is explicitly scoped; the agent
  dispatch, client wrapper, docstring, and mcp-tools.md doc are all in scope.
- `C-16` — honored by: 7 PRESERVE scenarios unaffected; 1 EXTEND (@AC-8) acknowledged with
  promotion note.
- `P-03` — honored by: auth-model mixing in `manage_account` explicitly acknowledged and documented
  (docstring update, conditional gating note in design).
- `F-04` — honored by: no invented paths — all evidence from codebase-discovery digests.
- `F-06` — honored by: no new DB connection pools — reuses existing `accountRepo`.
- `F-11` — honored by: no Floor breaches flagged by adversary.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @feature-164` "Register Alpaca account" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — not regressed by: dispatch routing unchanged; new branch added alongside existing ones.
- PRESERVE `@AC-2 @FR-1 @feature-164` "Register rejects missing broker_type" — not regressed by: register validation path untouched.
- PRESERVE `@AC-3 @FR-1 @feature-164` "Register rejects offline broker_type" — not regressed by: register validation path untouched.
- PRESERVE `@AC-4 @FR-2 @feature-164` "Credential rotation" — not regressed by: update_credentials path untouched.
- PRESERVE `@AC-5 @FR-3 @feature-164` "Deregister account" — not regressed by: deregister path untouched.
- PRESERVE `@AC-6 @FR-4 @feature-164` "list_accounts returns broker + offline" — not regressed by: list path untouched.
- PRESERVE `@AC-7 @FR-5 @feature-164` "PERMISSION_DENIED for non-owner" — not regressed by: ownership gate preserved; resume uses admin-scope gating (different auth model, coexists).
- EXTEND `@AC-8 @FR-6 @feature-164` "Unknown operation rejected" — new case added: valid-operations list grows from `register/update_credentials/deregister` to include `resume`; error-message substring match in existing test still passes; durable suite text updates at promotion.
