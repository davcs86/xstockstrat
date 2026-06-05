# Product Spec: unify-admin-auth-gates

**Feature**: `049-unify-admin-auth-gates`
**Status**: `draft` (backlog)
**Owner**: Platform / Security

---

## Problem

The platform has **three different admin-authorization mechanisms** for mutating, admin-scoped
operations. Features 047/048 standardized `xstockstrat-analysis` on a single model, but two services
were intentionally left out of that scope (changing them means touching services 047 didn't own).
This backlog feature captures the remaining divergence so it can be aligned deliberately.

### Current state (as of features 047 + 048, 2026-06-05)

| Operation | Service | Gate today | Model |
|---|---|---|---|
| `ManageStrategy` | analysis | `_has_admin_scope(context)` → role check on `x-access-scope` ADMIN bit `0x04` | **Aligned** (target) |
| `SetStrategyLive` | analysis | `_has_admin_scope(context)` (shared helper) | **Aligned** (target) |
| `ManageSignalSource` | **ingest** | `_validate_admin_token` → reads `authorization: Bearer`, calls identity `ValidateApiKey`, checks `"admin" in roles` | **Re-auth inside internal service** |
| `RegisterFormula` / `UpdateFormula` / `DeleteFormula` | **indicators** | author-ownership: `user_id == author` else `PERMISSION_DENIED` | **Ownership model (different concern)** |

Agent side (`xstockstrat-agent`):

- `manage_strategy` tool — validates admin **at the entry** (`client.validate_admin`) and forwards
  `x-access-scope: 7`. **Aligned.**
- `set_strategy_live` tool — validates admin at the entry, forwards `x-access-scope`. **Aligned.**
- `manage_signal_source` tool — forwards only `authorization: Bearer <admin_api_key>` (no entry
  validation, no `x-access-scope`).
- `manage_formula` tool — forwards `authorization: Bearer <admin_api_key>` and a
  `formula_author_user_id` (ownership), no entry validation.

### Why it matters

- **Inconsistency / maintainability:** two different auth idioms in internal services for the same
  conceptual gate ("admin can mutate") make the trust model harder to reason about and review.
- **Trust-model clarity:** the platform convention (`docs/patterns/header-propagation.md`) is that
  entry points authenticate and set `x-user-id` / `x-access-scope`, and internal services trust those.
  ingest's `ManageSignalSource` re-authenticating is heavier than that convention requires.
- **Security review surface:** a single, well-understood gate is easier to audit than three.

## Goals

1. **`xstockstrat-ingest` `ManageSignalSource`**: replace `_validate_admin_token` re-auth with the
   `x-access-scope` ADMIN-bit role check (mirror analysis `_has_admin_scope`). Update the agent
   `manage_signal_source` tool to validate admin at the entry (`client.validate_admin`) and forward
   `x-access-scope`. `credentials_ref` handling (never echoed) stays unchanged.
2. **`xstockstrat-indicators` formula management**: **decide** (Open Question OQ-1) whether the
   author-ownership model stays as-is (a legitimately different concern — "only the author may edit
   their formula"), or is additionally combined with an admin-scope override. If kept as ownership,
   document it explicitly as an intentional exception rather than an inconsistency.
3. **No behavior change for legitimate admin callers** — UI BFF (JWT-derived scope) and the MCP agent
   (admin-validated at entry) continue to work; non-admin callers are rejected consistently with
   `PERMISSION_DENIED`.

## Non-Goals

- Re-architecting the JWT/identity system or the SSE auth layer.
- Changing how the UI BFF derives `x-access-scope` from JWT claims.
- Touching the trading/portfolio/config/ledger/notify services (their gates are out of scope unless a
  later audit finds a similar divergence).

## Functional Requirements

- **FR-1** ingest `ManageSignalSource` authorizes via an `x-access-scope` ADMIN-bit role check; returns
  `PERMISSION_DENIED` when the bit is absent. No identity `ValidateApiKey` call inside ingest for this
  RPC.
- **FR-2** agent `manage_signal_source` tool calls `client.validate_admin(admin_api_key)` at the entry
  and forwards `x-access-scope` to ingest (mirrors `manage_strategy`).
- **FR-3** ingest no longer needs `identity_channel` solely for this gate — remove if unused after the
  change (mirror the analysis identity-removal in 047 consistency work). Verify no other ingest RPC
  depends on it before removing.
- **FR-4** indicators formula-management gate decision (OQ-1) is implemented and documented: either
  (a) keep author-ownership and document it as an intentional model, or (b) add an admin-scope path.
- **FR-5** `credentials_ref` is still never echoed by `manage_signal_source` (unchanged from FR-12 of 047).
- **FR-6** Docs updated: `docs/patterns/header-propagation.md` (or a short auth-model note) describes the
  single "entry authenticates, internal role-checks" model and lists the indicators ownership exception.

## Governance Gates

- **Security review** — trust-boundary change in ingest; confirm entry points strip/validate
  `x-access-scope` from external requests so internal callers can trust it.
- **Service owners** — `xstockstrat-ingest` and `xstockstrat-indicators`.
- No new proto, config key, or DB migration is anticipated (gate logic only). Confirm at `/sdd-spec`.

## Open Questions

- **OQ-1 (key decision):** Should indicators formula management keep its **author-ownership** model
  (only the author may edit/delete their own formula) as an intentional, distinct concern — or be
  unified under admin-scope? Ownership and admin-scope are arguably *different* authorization questions;
  the most likely answer is "keep ownership, document it as an exception, and optionally allow an admin
  override." Platform Lead + Security to decide.
- **OQ-2:** Does any external (non-entry-point) caller reach ingest `ManageSignalSource` directly? If
  so, removing re-auth requires confirming those callers are inside the trusted boundary.
- **OQ-3:** Should `_has_admin_scope` be promoted to a shared helper module (instead of duplicated per
  service) once a third service adopts it?

## Acceptance Criteria

- **AC-1** A non-admin `x-access-scope` to ingest `ManageSignalSource` returns `PERMISSION_DENIED`; an
  admin scope succeeds; no identity call is made by ingest for the gate.
- **AC-2** The agent `manage_signal_source` tool rejects a non-admin key at the entry and forwards
  admin scope for an admin key.
- **AC-3** The indicators formula-management authorization decision (OQ-1) is implemented and documented.
- **AC-4** Existing ingest/indicators/agent tests pass; new tests cover the gate change.
