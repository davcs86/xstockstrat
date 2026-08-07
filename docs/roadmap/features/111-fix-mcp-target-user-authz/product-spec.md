# Product Spec: fix-mcp-target-user-authz

**Type**: bug
**Source Report**: docs/reports/2026-08-07-mcp-target-user-authz.md
**Severity**: SEV-2
**Created**: 2026-08-07

---

## Problem Statement

Two `xstockstrat-agent` MCP tools accept a caller-supplied user-identity parameter that is never
validated against the OAuth-authenticated caller:

- `emit_alert`'s `target_user_id` (`services/xstockstrat-agent/app/tools.py:305,316,329`) is
  forwarded verbatim to `EmitAlertRequest.target_user_id`
  (`services/xstockstrat-agent/app/client.py:195,212`). Any authenticated caller can address (or
  broadcast, via `""`) an alert to an arbitrary user id, with no check that it matches their own
  verified claims.
- `manage_formula`'s `formula_author_user_id` (`services/xstockstrat-agent/app/tools.py:574,585,629`)
  is forwarded as the formula's `user_id` (`app/client.py:605,624`), asking the caller to assert an
  identity the server already knows from OAuth claims instead of deriving it.

Expected: MCP tool calls and any permission/ownership checks they perform should be tied to the
OAuth-authenticated caller's own verified identity (`app/auth.py:76` `claims["user_id"]`), not a
caller-supplied "target user" parameter. No tool currently reads `claims["user_id"]` for this
purpose — outbound metadata is built by `_metadata()`, which unconditionally returns `[]`
(`app/client.py:29-30`); only the four admin-gated write tools forward a derived `x-access-scope`
(feature 092).

## Root Cause

The agent never derives a per-call caller identity from OAuth claims. Feature 092 added
claims-derived `x-access-scope` for admin-gated write tools but never a claims-derived user id.
`emit_alert` and `manage_formula` fill that gap by asking the caller to supply their own identity
as a plain parameter instead of the server deriving it.

## Affected Services

- `xstockstrat-agent` (Python MCP server) — `app/tools.py`, `app/client.py`
- No other service's code changes; the two RPCs (`notify.EmitAlert`, indicators'
  `Register/UpdateFormula`) already accept/validate a `user_id`/`target_user_id` field — only the
  agent's *source* for that field changes, from a caller parameter to derived OAuth claims.

## Fix Scope

- [x] No proto changes anticipated (both fields being repurposed already exist on the wire)
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Explicitly Out of Scope

- `notify.EmitAlert`'s RPC-level gating. Feature 092 deliberately left the RPC itself ungated as an
  explicit internal-service-caller contract, because it's also called by unauthenticated internal
  services (analysis loops) with no per-user context at all
  (`docs/roadmap/ledger/insights.md`, 2026-08-02 092 entry). This fix only changes what the
  **agent's MCP tool** sends as the identity — not the RPC's authorization model or its non-MCP
  callers.
- `ingest_signal`'s internal auto-alert path, which already hardcodes `target_user_id=""`
  (system-decided broadcast, not caller-supplied) — unaffected by this fix unless the design phase
  determines otherwise.

## Design Question For `/sdd-design quick`

Removing `emit_alert`'s caller-supplied `target_user_id` and always tying the call to the
authenticated caller's own id removes the tool's ability to broadcast or address another user
through the MCP surface. Confirm/settle during design whether that capability loss is intended, or
whether a non-identity-bearing `broadcast: bool` flag (still always scoped to "all", never to a
specific *other* user) should be preserved.

## Acceptance Criteria

- [ ] `emit_alert` no longer accepts a caller-supplied `target_user_id`/other-user parameter; the
      alert's recipient is derived from the authenticated caller's own claims (or a defined
      system-broadcast semantic, per the design decision above).
- [ ] `manage_formula` no longer accepts `formula_author_user_id` as caller input; the value sent
      to the backend is derived from the authenticated caller's own claims.
- [ ] Existing tests updated/passing; new tests cover the claims-derivation path and reject
      attempts to supply an identity parameter.
- [ ] `docs/runbooks/mcp-tools.md` and any other doc describing these parameters updated.
- [ ] Teardown: `/context-scrubber scan` run over any touched context docs (root CLAUDE.md Teardown
      rule), since this changes documented tool behavior.

## Out of Scope

- Refactoring unrelated to this authz fix.
- Changing `notify.EmitAlert`'s or the indicators service's server-side authorization model.
