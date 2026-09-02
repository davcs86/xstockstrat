# Recon: resume-halted-account

**Created**: 2026-09-02
**From**: product-spec.md
**Affected services**: `xstockstrat-trading`, `xstockstrat-agent`, `xstockstrat-ledger` (event write), `xstockstrat-notify` (alert emission)

---

## Objective

Build a `ResumeAccount` RPC on `xstockstrat-trading` and a corresponding `resume` operation on the
`manage_account` MCP agent tool so that when the reconciliation poller falsely halts a broker account,
the halt can be cleared through the product (an RPC or MCP tool call) rather than requiring a manual
DB edit + service restart. The resume must clear both persistent (DB) and in-memory halt state, emit
an auditable ledger event and INFO alert, and be restricted to operator/admin-scoped callers.

## Codebase Map

### `xstockstrat-trading` (Go)

- **In-memory halt maps**: `services/xstockstrat-trading/internal/service/trading.go:134-147` — `halted map[string]bool`, `haltReasons map[string]string`, `haltedLastPolled map[string]time.Time`, `haltedMu sync.Mutex`
- **`haltAccount` (existing halt writer)**: `trading.go:2678-2710` — sets in-memory (line 2685), then DB (line 2695), then CRITICAL alert (line 2699-2705); short-circuits if already halted (line 2681-2683)
- **`isAccountHalted`**: `trading.go:2628-2633`
- **`haltReason`**: `trading.go:2657-2662`
- **`UpdateHaltStatus` (DB write)**: `services/xstockstrat-trading/internal/repository/account_repo.go:167-173` — `UPDATE trading.broker_accounts SET halted=$2, halt_reason=$3, halted_at=$4, halt_source=$5 WHERE id=$1`
- **`BrokerAccountRecord` struct**: `account_repo.go:35-41` — `Halted bool`, `HaltedAt *time.Time`, `HaltReason string`, `HaltSource int32`
- **`AccountRepository` interface**: `account_repo.go:58` — includes `UpdateHaltStatus`
- **`LoadBrokerPool` hydrates halt from DB**: `trading.go:262-268`
- **`recordToProtoAccount`**: `trading.go:2875-2895`
- **`emitLedgerEvent` helper**: `trading.go:3616-3630`
- **Alert emission patterns**: `emitApprovalAlert` (`trading.go:3632-3644`, WARNING), `emitFillAlert` (`trading.go:3646-3660`, INFO), `haltAccount` alert (`trading.go:2699-2705`, CRITICAL)
- **Existing account RPCs**: `RegisterBrokerAccount` (`trading.go:2438`, handler `handler/trading.go:267-277`), `DeregisterBrokerAccountSvc` (`trading.go:2985-3019`), `UpdateBrokerAccountCredentials` (`trading.go:2501-2547`)
- **Handler propagation**: `services/xstockstrat-trading/internal/middleware/propagation.go:15,31` — `PropagationData.AccessScope`
- **`NewTradingService` constructor**: `trading.go:175-238`
- **Latest migration**: `009` (next would be `010`)
- **Proto**: `TradingService` RPCs at `packages/proto/trading/v1/trading.proto:10-39`, last RPC = `SnapshotOfflinePositions` (line 38); `BrokerAccount` message at `trading.proto:221-241`, last field = `halt_source = 12`; `HaltSource` enum at `trading.proto:214-218`

### `xstockstrat-agent` (Python)

- **`manage_account` tool registration**: `services/xstockstrat-agent/app/tools.py:1620`
- **Handler dispatch**: `tools.py:1650-1680` — dispatches on `operation`: "register" (1652), "update_credentials" (1666), "deregister" (1672), unknown ValueError (1676-1678)
- **Ownership gating**: `_caller_user_id` at `tools.py:119-134`
- **Admin-scope gating**: `_caller_access_scope` at `tools.py:107-116` — used by `trigger_backfill` etc., NOT currently by `manage_account`
- **Client wrappers**: `register_broker_account` (`app/client.py:1904-1929`), `update_broker_account_credentials` (`client.py:1932-1952`), `deregister_broker_account` (`client.py:1955-1969`), `list_broker_accounts` (`client.py:1972-1987`)
- **`_account_to_dict`**: `client.py:1698-1711` — `MessageToDict` + AGENT-7 bool-pinning for `halted`
- **`_metadata` helper**: `client.py:59-84`
- **`TRADING_ENDPOINT`**: `client.py:26`
- **Proto import pattern**: `from gen.trading.v1 import trading_pb2, trading_pb2_grpc` (lazy import inside function body)
- **Test files**: `tests/test_account_tools.py` (186 lines), `tests/test_broker_account_client.py` (248 lines)
- **`docs/runbooks/mcp-tools.md`**: `manage_account` section at `mcp-tools.md:1179-1207`

## Patterns to REUSE

- **`ResumeAccount` RPC handler** → follow `DeregisterBrokerAccountSvc` pattern at `trading.go:2985-3019` (access-scope check + DB write + ledger event + alert — same lifecycle)
- **In-memory halt clear** → mirror `haltAccount` at `trading.go:2678-2710` but invert: delete from `halted`, `haltReasons`, `haltedLastPolled` maps under `haltedMu` lock
- **DB halt clear** → reuse `UpdateHaltStatus` at `account_repo.go:167-173` with `halted=false, halt_reason="", halted_at=nil, halt_source=UNSPECIFIED`
- **Ledger event emission** → reuse `emitLedgerEvent` helper at `trading.go:3616-3630`
- **Alert emission** → reuse `emitFillAlert` pattern at `trading.go:3646-3660` (INFO severity, category "halt" or "account")
- **Proto account mapping** → reuse `recordToProtoAccount` at `trading.go:2875-2895` to return the cleared account in the response
- **MCP tool dispatch** → extend `manage_account` dispatch at `tools.py:1650-1680` with new `"resume"` branch
- **Admin-scope gating (agent side)** → reuse `_caller_access_scope` at `tools.py:107-116` (already used by other tools)
- **Client wrapper** → follow `deregister_broker_account` pattern at `client.py:1955-1969` (ephemeral channel, lazy import, `_metadata`)
- **Access-scope bitmask** → port `ADMIN_SCOPE = 0x04` from Node (`services/xstockstrat-config/src/middleware/authz.ts:22`) / Python (`services/xstockstrat-ingest/app/handlers/servicer.py:206-219`) into a Go helper — first Go-native access-scope check

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @feature-164` "Register Alpaca account" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — new resume op must not break dispatch
- **PRESERVE** `@AC-2 @FR-1 @feature-164` "Register rejects missing broker_type" — validation path unchanged
- **PRESERVE** `@AC-3 @FR-1 @feature-164` "Register rejects offline broker_type" — validation path unchanged
- **PRESERVE** `@AC-4 @FR-2 @feature-164` "Credential rotation" — update_credentials path unchanged
- **PRESERVE** `@AC-5 @FR-3 @feature-164` "Deregister account" — deregister path unchanged
- **PRESERVE** `@AC-6 @FR-4 @feature-164` "list_accounts returns broker + offline" — list path unchanged
- **PRESERVE** `@AC-7 @FR-5 @feature-164` "PERMISSION_DENIED for non-owner" — ownership gate preserved; resume uses admin-scope gating (different pattern, coexists)
- **EXTEND** `@AC-8 @FR-6 @feature-164` "Unknown operation rejected" — valid-operations list grows to include `resume`; rejection-before-RPC rule preserved
- No existing acceptance suite for halt-mechanism behavior in `xstockstrat-trading`

## Dependencies

- **Proto/RPC**: New `ResumeAccount` RPC (next after `SnapshotOfflinePositions` at line 38), new `ResumeAccountRequest` / `ResumeAccountResponse` messages (next field numbers after `BrokerAccount.halt_source = 12`); new messages in `trading.proto`
- **Migration**: none — no schema changes; `UpdateHaltStatus` already supports clearing all halt columns
- **Config keys**: none
- **Inter-service edges**: `xstockstrat-trading` → `xstockstrat-ledger` (event write, existing), `xstockstrat-trading` → `xstockstrat-notify` (alert emission, existing), `xstockstrat-agent` → `xstockstrat-trading` (new `ResumeAccount` RPC call)
- **New env vars / ports**: none — all endpoints already wired

## Risks / Not-found

- **No Go-native access-scope check exists.** The trading service propagates `x-access-scope` via `PropagationData.AccessScope` but never reads it for authorization. `ResumeAccount` will be the first Go RPC to gate on scope. Must create a helper (bitmask check `scope & 0x04 != 0`) — keep it in `middleware/` or an `authz` package so other Go services can reuse it.
- **No "operator" scope bit distinct from "admin"** — only `ADMIN_SCOPE = 0x04` exists platform-wide. The product-spec's "operator or admin" translates to `ADMIN_SCOPE` check only; no new scope bit needed.
- **Applicable `fails.md` trap (2026-07-01 — 056-open-positions-ui)**: two read paths for the same value can silently diverge. Here the halt state has a DB path and an in-memory path — the resume must clear **both** atomically (in-memory first, then DB, mirroring `haltAccount`'s write order) and `LoadBrokerPool` boot hydration already handles restart. The `persist-strategy-scores` insight (write-through+hydrate) confirms this dual-path pattern is sound.

## Recommended Scope

1. **Proto**: Add `ResumeAccount` RPC + request/response messages to `trading.proto`; run `buf-gen.sh`
2. **Go authz helper**: Create `requireAdminScope` in trading service middleware (portable to other Go services later)
3. **Go service method**: `ResumeAccountSvc` on `TradingService` — scope check → in-memory clear → DB clear → ledger event → INFO alert → return cleared account
4. **Go handler**: Wire `ResumeAccount` in `handler/trading.go`
5. **Go tests**: Unit tests for the new method (pgxmock for repo, mock service deps)
6. **Agent client wrapper**: `resume_broker_account` in `client.py`
7. **Agent tool dispatch**: Add `"resume"` branch to `manage_account` in `tools.py` with admin-scope gate
8. **Agent tests**: Tool-layer + client-layer tests
9. **Docs**: Update `mcp-tools.md` manage_account section with `resume` operation
