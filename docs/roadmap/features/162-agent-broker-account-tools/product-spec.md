# Product Spec: agent-broker-account-tools

**Created**: 2026-08-27

---

## Problem Statement

The MCP agent can create and reconcile **offline** accounts (`manage_offline_account`, feature 157)
but has no way to manage **broker** accounts (Alpaca / IBKR). A user driving the platform through the
Claude.ai remote connector cannot register a broker account, rotate its credentials, or deregister it,
and has no single call that lists every account they own. Those operations exist as trading-service
RPCs today but are reachable only from the `xstockstrat-ui` `/config-ui` segment, not the agent.

## User Story

As an authenticated agent user, I want MCP tools to register / update-credentials / deregister my
broker accounts and to list all of my accounts (broker and offline together), so that I can manage my
trading accounts conversationally without leaving the agent.

## Functional Requirements

FR-1. A new `manage_account` MCP tool supports a `register` operation that wraps
`TradingService.RegisterBrokerAccount`. It requires `display_name`, a `broker_type`
(`alpaca` | `ibkr`), and a `credentials_json` blob (broker-type-specific shape, passed through
verbatim to the backend). It returns the created account with `credential_status`; it never echoes
the submitted credentials back.

FR-2. `manage_account` supports an `update_credentials` operation that wraps
`TradingService.UpdateBrokerAccountCredentials`. It requires `account_id` and `credentials_json`,
and returns the updated account (credentials never echoed).

FR-3. `manage_account` supports a `deregister` operation that wraps
`TradingService.DeregisterBrokerAccount`. It requires `account_id` and returns a confirmation
(`{"deregistered": true, "account_id": …}`).

FR-4. A new `list_accounts` MCP tool wraps `TradingService.ListBrokerAccounts` and returns **all** of
the caller's registered accounts — broker and offline alike (offline accounts are `BrokerAccount`
rows with `broker_type=OFFLINE`), each distinguishable by its `broker_type`. Read-only. Credentials
are not part of `BrokerAccount` and so are never returned.

FR-5. All four operations are **ownership-gated** on the caller's own `x-user-id` (resolved via the
existing `_caller_user_id` helper and forwarded as `x-user-id` metadata), matching the
offline-account and watchlist tools. A caller acting on an account they do not own is rejected
`PERMISSION_DENIED` by the trading backend; no admin `x-access-scope` is required or forwarded.

FR-6. Unknown-operation and missing-required-argument inputs are rejected with a clear `ValueError`
naming the expected operations / fields, and backend `NOT_FOUND` / `PERMISSION_DENIED` gRPC errors
are surfaced as readable `RuntimeError`s (matching the existing tool error-handling convention).

## Out of Scope

- Creating **offline** accounts via `manage_account` — that stays in `manage_offline_account`
  (`create_account`). `manage_account register` requires a real broker type (`alpaca`/`ibkr`).
- Order placement / confirmation / position reads — already covered by
  `manage_offline_account` and the trading order tools.
- Halting / un-halting accounts, reconciliation, and credential *validation* triggering — no such
  RPCs are being added; `credential_status` is read as returned by the backend.
- Any UI (`/config-ui`) change — the broker-account UI already exists (feature 002).
- Any new trading-service RPC, proto message, config key, or DB migration.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — two new MCP tools (`manage_account`, `list_accounts`) + gRPC client methods
  wrapping the existing trading RPCs. This is the only service with code changes.
- `xstockstrat-trading` — **consumed only**, no change. Already exposes `RegisterBrokerAccount`,
  `UpdateBrokerAccountCredentials`, `DeregisterBrokerAccount`, `ListBrokerAccounts` and resolves
  ownership from the forwarded `x-user-id`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `manage_account` (new write tool), `list_accounts`
  (new read tool). This is the whole point of the feature — it makes the existing trading-service
  broker-account RPCs reachable from the agent.
- [ ] **UI** — no change; the broker-account UI already exists (`/config-ui`, feature 002).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — all four RPCs
  (`RegisterBrokerAccount`, `UpdateBrokerAccountCredentials`, `DeregisterBrokerAccount`,
  `ListBrokerAccounts`) already exist in `packages/proto/trading/v1/trading.proto`.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — the `broker_accounts` table and its ownership column already exist.

## Feature Workflow Notes

Branch to create: `feature/agent-broker-account-tools` (branch from `main-dev`).
_This session's harness branch is `claude/mcp-account-management-tools-zvbwdl`, PR'd into `main-dev`._
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval — `xstockstrat-agent` owner (MCP contract) is the only code change.
- [ ] No proto / schema / config gate (none of those change).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (Ledger F-12 / RC-1, 2026-08-01):** the agent's hand-written tool docstrings,
  `docs/runbooks/mcp-tools.md`, and the tool-count statements across the inventory surfaces drift
  from `app/client.py` + the protos. The only tool that never drifted (`run_backtest`) is the one
  with a **descriptor-parity test**. Design must update the runbook + every tool-count statement in
  the **same** PR, and should consider a `BrokerAccount`-field-parity assertion so a later proto
  field addition can't silently vanish from the tool's response mapping. Also note the F-related
  `mock-backend.ts` trap: `BrokerAccount`'s id field is `id`, not `accountId`.
- [ ] Should `manage_account register` accept `broker_type=offline` as an alias into the offline
  path, or reject it (forcing callers to `manage_offline_account`)? _Proposed: reject, to keep one
  creation path per account kind._ Confirm in design.
