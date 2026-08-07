# Defect: MCP agent tools accept a caller-supplied "target user" instead of deriving it from the authenticated caller

**Recorded**: 2026-08-07
**Severity**: SEV-2
**Impact type**: other
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-agent
**Config-only fix possible**: no

## Observed

Two `xstockstrat-agent` MCP tools accept a caller-supplied user-identity parameter that is never
validated against the OAuth-authenticated caller, so the effective "user" a call acts on is
whatever string the model/caller passes — not the identity the OAuth 2.1 edge actually verified
(`services/xstockstrat-agent/app/main.py:146-175` `_authorized`;
`services/xstockstrat-agent/app/auth.py:50-86` `validate_bearer_claims`).

- `emit_alert` (`services/xstockstrat-agent/app/tools.py:305,316,329`) — `target_user_id: str = ""`
  is forwarded verbatim to `EmitAlertRequest.target_user_id`
  (`services/xstockstrat-agent/app/client.py:195,212`;
  `packages/proto/notify/v1/notify.proto:56`). Any authenticated caller can address (or
  broadcast, via `""`) an alert to an arbitrary user id, with no check that it matches their own
  claims.
- `manage_formula` (`services/xstockstrat-agent/app/tools.py:574,585,629`) —
  `formula_author_user_id` is a caller-supplied ownership token forwarded as the formula's
  `user_id` (`app/client.py:605,624`), asking the caller to assert an identity the server already
  knows from OAuth claims instead of deriving it there.

The agent's OAuth claims carry a verified `user_id` (`app/auth.py:76`) that no tool currently
reads for this purpose — outbound metadata is built by `_metadata()`, which unconditionally
returns `[]` (`app/client.py:29-30`); only the four admin-gated write tools forward a derived
`x-access-scope` (feature 092, `docs/roadmap/features/092-fix-mcp-writepath-authz/`). No tool
forwards a caller-identity header, and two tools accept the caller's own claim of who they are as
free-form input instead.

## Expected

MCP tool calls and any permission/ownership checks they perform should be tied to the
OAuth-authenticated caller's own verified identity, not a caller-supplied "target user" parameter.

## Reproduction

1. Authenticate to the agent as user A.
2. Call `emit_alert` with `target_user_id` set to user B's id (or a nonexistent id) — the alert is
   addressed to that id with no check against the caller's own claims.
3. Call `manage_formula` with an `formula_author_user_id` the caller does not actually hold — the
   indicators backend does independently reject a mismatch against the real stored author, but the
   agent tool still solicits and forwards the assertion rather than deriving it from claims.

## Evidence

`services/xstockstrat-agent/app/tools.py:305,316,329` (emit_alert `target_user_id`)
`services/xstockstrat-agent/app/tools.py:574,585,629` (manage_formula `formula_author_user_id`)
`services/xstockstrat-agent/app/client.py:29-30` (`_metadata()` always `[]`)
`services/xstockstrat-agent/app/auth.py:76` (verified `user_id` available in claims, unused)

## Root cause hypothesis

The agent never derives a per-call caller identity from OAuth claims; feature 092 added
claims-derived `x-access-scope` for admin-gated write tools but never a claims-derived user id.
Two tools fill that gap by asking the caller to supply their own identity as a plain parameter
instead.

**Note on scope**: `notify.EmitAlert` is also called by unauthenticated internal services
(analysis loops) with no per-user context at all — feature 092 deliberately left the RPC itself
ungated as an "explicit internal-service-caller contract"
(`docs/roadmap/ledger/insights.md`, 2026-08-02 092 entry). This defect is scoped to the **agent's
MCP tool layer** (the model-facing tool contract), not the underlying proto/RPC or its non-MCP
callers.

## Confidence

high
