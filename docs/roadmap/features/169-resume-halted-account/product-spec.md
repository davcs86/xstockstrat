# Product Spec: resume-halted-account

**Created**: 2026-09-02

---

## Problem Statement

When the broker-state reconciliation poller (feature 102) detects a mismatch — or when the bracket-protection mechanism (feature 030) detects a flatten failure — it persistently halts the broker account (`broker_accounts.halted = true`). There is currently no RPC or MCP tool operation to clear this halt; recovery requires a manual `UPDATE` on the database and a service restart to refresh in-memory state. This makes incident recovery slow, error-prone, and unauditable.

## User Story

As an operator, I want to clear a reconciliation or bracket-protection halt on a broker account through an RPC or MCP tool call, so that halt recovery is a first-class product capability — auditable, authorized, and requiring no DBA intervention or service restart.

## Functional Requirements

FR-1. A new `ResumeAccount` RPC on `xstockstrat-trading` clears the persistent halt on a broker account: sets `halted = false`, clears `halt_reason`, `halted_at`, and `halt_source` in the `trading.broker_accounts` table.

FR-2. The `ResumeAccount` RPC also clears the in-memory halt state held by the `TradingService` (the `brokerPool` entry's halt fields), so the reconciliation poller and order placement resume for that account without a service restart.

FR-3. The `ResumeAccount` RPC emits a ledger event (`account.halt.resumed`) recording the account ID, the operator who cleared the halt (from `x-user-id`), the prior `halt_reason` and `halt_source` that were cleared, and a caller-supplied `reason` string.

FR-4. The `ResumeAccount` RPC emits an INFO-level alert (via `xstockstrat-notify`) so the un-halt is visible in the alert stream and auditable.

FR-5. Only operator- or admin-scoped callers may invoke `ResumeAccount`. The RPC checks `x-access-scope` for `operator` or `admin`; unauthorized callers receive `PERMISSION_DENIED`.

FR-6. The `manage_account` MCP agent tool gains a `resume` operation that invokes the `ResumeAccount` RPC, forwarding `account_id` and an optional `reason` string. The operation is gated on the caller's admin scope (existing pattern for management tools in the agent).

FR-7. Calling `ResumeAccount` on an account that is not currently halted is a no-op: the RPC returns success with no state change, no ledger event, and no alert.

FR-8. The `docs/runbooks/mcp-tools.md` documentation is updated to include the new `resume` operation on `manage_account`.

## Out of Scope

- Automatic halt-and-resume cycles (auto-recovery) — this is an operator-initiated capability only.
- Clearing the `is_active = false` deactivation state — `is_active` and `halted` are orthogonal (feature 030/100 insight); this feature touches only `halted`.
- UI for resuming accounts — the `/trader` account management page may surface this later; the initial consumer surfaces are the RPC and the MCP tool.
- Changing the halt detection logic itself — the root cause of false halts (terminal-order misclassification) is addressed by PR #1067 (feature-independent fix); this feature adds the recovery path.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — new `ResumeAccount` RPC, proto additions, in-memory + DB halt clearing
- `xstockstrat-agent` — new `resume` operation on the `manage_account` MCP tool
- `xstockstrat-ledger` — receives the `account.halt.resumed` event (no code change — existing `AppendEvent` RPC)

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `manage_account` (new `resume` operation with `account_id` and optional `reason` parameters)
- [ ] **UI** — not in this feature; `/trader` account page may add a "Resume" button in a follow-up
- [ ] **None**

## Proto Contract Changes

- New RPC: `ResumeAccount(ResumeAccountRequest) returns (ResumeAccountResponse)` on `TradingService`
- New messages: `ResumeAccountRequest` (fields: `account_id`, `reason`), `ResumeAccountResponse` (fields: `account` — the updated `BrokerAccount`)
- Non-breaking additive change (new RPC + new messages, no field changes to existing messages)

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — the `broker_accounts` table already has the `halted`, `halted_at`, `halt_reason`, `halt_source` columns (feature 030/102). This feature only writes to them.

## Feature Workflow Notes

Branch to create: `feature/resume-halted-account` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change — additive RPC)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Known trap (ledger — feature 100):** The `fails.md` entry for feature 100 documents that widening a config key's `value_type` in place causes a fail-open bug via proto3 oneof zero-value semantics. Not directly applicable here (no config key changes), but the orthogonality of `halted` vs `is_active` vs `platform.maintenance_mode` (feature 100 insight) must be respected — `ResumeAccount` touches only `halted`, never `is_active` or the platform-wide kill switch.
- [x] **Known trap (ledger — feature 102):** Feature 102's design insight records that `broker_accounts.halted` (030) and `platform.maintenance_mode` (100) are orthogonal gates. ResumeAccount clears only the per-account automated halt; the platform-wide gate remains independent.
