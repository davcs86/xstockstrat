# Feature: unify-admin-auth-gates

**Lifecycle Status**: `draft`
**Development Branch**: `feature/unify-admin-auth-gates`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-05 | `idea` → `draft` | backlog capture | Split out of the 047/048 admin-gate consistency work — analysis was aligned to the x-access-scope role-check model; ingest + indicators still use their own gates. Captured as a backlog feature for later alignment. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec unify-admin-auth-gates`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Unify the **admin authorization model** for the remaining mutating, admin-scoped operations so the
whole platform follows one pattern: **authentication/authorization happens at the entry points**
(UI BFF via JWT, MCP agent via its SSE auth layer), and **internal services do a role check at most**
on the propagated `x-access-scope` (ADMIN bit `0x04`) — they do not re-authenticate.

Feature **047/048 already aligned `xstockstrat-analysis`** (`ManageStrategy`, `SetStrategyLive`) to this
model (shared `_has_admin_scope` role check; agent validates admin at the entry via `client.validate_admin`).
This feature brings the two **remaining inconsistent gates** into line:

1. **`xstockstrat-ingest` `ManageSignalSource`** — currently re-authenticates inside the internal
   service via `_validate_admin_token` (reads `authorization: Bearer <key>`, calls identity
   `ValidateApiKey`, checks `"admin" in roles`). Should become an `x-access-scope` role check; the
   agent's `manage_signal_source` tool should validate admin at the entry and forward `x-access-scope`.
2. **`xstockstrat-indicators` formula management** (`RegisterFormula`/`UpdateFormula`/`DeleteFormula`)
   — currently authorizes via an **author-ownership** model (`user_id == author`, else
   `PERMISSION_DENIED`). Decide whether this stays as a (legitimately different) ownership model or is
   additionally gated by admin scope; the agent's `manage_formula` tool currently forwards only
   `authorization: Bearer`.

## Dependencies

- **Soft dependency on `047-strategy-engine` / `048-live-strategy-alert-engine`** — those establish the
  `_has_admin_scope` pattern (analysis) and `client.validate_admin` (agent) that this feature extends to
  ingest/indicators. Best done after 047/048 are merged so the shared pattern is on `main-dev`.
- Touches the **header-propagation trust model** (`docs/patterns/header-propagation.md`) and the agent
  admin-metadata helpers (`_admin_metadata`, `validate_admin`).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` (service owner) | `ManageSignalSource` gate change — role check vs re-auth; `credentials_ref` handling unchanged |
| `xstockstrat-indicators` (service owner) | Formula author-ownership vs admin-scope decision; sandbox/permission correctness |
| `xstockstrat-agent` (service owner) | Entry-point `validate_admin` for `manage_signal_source` / `manage_formula`; `x-access-scope` forwarding |
| Security | Trust-boundary correctness — internal services must not over-trust `x-access-scope` from untrusted callers; entry points strip/validate it |
| Platform Lead | Whether the author-ownership model for formulas should remain distinct from admin-scope gating |

## Next Action

`/sdd-review unify-admin-auth-gates product-spec` — AI review of the product spec before `/sdd-spec`.
