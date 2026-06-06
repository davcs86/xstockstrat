# Product Spec: unify-admin-auth-gates

**Feature**: `049-unify-admin-auth-gates`
**Status**: `draft` (backlog)
**Owner**: Platform / Security

---

## Problem Statement

The platform has **three different admin-authorization mechanisms** for mutating, admin-scoped
operations. Features 047/048 standardized `xstockstrat-analysis` on a single model, but two services
were intentionally left out of that scope (changing them means touching services 047 didn't own).
This feature captures the remaining divergence so it can be aligned deliberately.

## User Story

As a **platform/security engineer**, I want every mutating, admin-scoped operation to follow one
authorization model — *entry points authenticate, internal services do an `x-access-scope` role
check at most* — so that the trust boundary is consistent, auditable, and cheap to reason about,
with the one deliberate exception (formula author-ownership) documented as intentional rather than
accidental.

### Current state (verified against `main-dev`, post-047/048, 2026-06-06)

| Operation | Service | Gate today | Evidence | Model |
|---|---|---|---|---|
| `ManageStrategy` | analysis | `_has_admin_scope(context)` → role check on `x-access-scope` ADMIN bit `0x04` | `xstockstrat-analysis/app/handlers/servicer.py:58,655` | **Aligned** (target) |
| `SetStrategyLive` | analysis | `_has_admin_scope(context)` (shared helper) | `…/servicer.py:726-727` | **Aligned** (target) |
| `ManageSignalSource` | **ingest** | `_validate_admin_token` → reads `authorization: Bearer`, calls identity `ValidateApiKey`, checks `"admin" in roles` | `xstockstrat-ingest/app/handlers/servicer.py:47-58,427` | **Re-auth inside internal service** |
| `UpdateFormula` / `DeleteFormula` | **indicators** | author-ownership: `row["author"] != request.user_id` → `PERMISSION_DENIED` | `xstockstrat-indicators/app/handlers/servicer.py:211-213,236-238` | **Ownership model (different concern)** |
| `RegisterFormula` | **indicators** | **effectively ungated** — `author` defaults to `"dev-user"` when unset; no admin or ownership check | `xstockstrat-indicators/app/handlers/servicer.py:135-150` | **Gap (no gate)** |

Agent side (`xstockstrat-agent`):

- `manage_strategy` tool — validates admin **at the entry** (`client.validate_admin`) and forwards
  `x-access-scope: 7`. **Aligned.** (`app/tools.py:265`, `app/client.py:225-227`)
- `set_strategy_live` tool — validates admin at the entry, forwards `x-access-scope`. **Aligned.**
  (`app/tools.py:364`, `app/client.py:405`)
- `manage_signal_source` tool — forwards only `authorization: Bearer <admin_api_key>` via
  `_admin_metadata`; **no entry validation, no `x-access-scope`**. (`app/tools.py:320-351`,
  `app/client.py:361`)
- `manage_formula` tool — forwards `authorization: Bearer <admin_api_key>` and a
  `formula_author_user_id` (ownership), no entry validation. (`app/tools.py:284-317`)

### Why it matters

- **Inconsistency / maintainability:** two different auth idioms in internal services for the same
  conceptual gate ("admin can mutate") make the trust model harder to reason about and review.
- **Trust-model clarity:** the platform convention (`docs/patterns/header-propagation.md`) is that
  entry points authenticate and set `x-user-id` / `x-access-scope`, and internal services trust those.
  ingest's `ManageSignalSource` re-authenticating is heavier than that convention requires.
- **Security review surface:** a single, well-understood gate is easier to audit than three.
- **Latent gap:** `RegisterFormula` carries no authorization check at all today — surfaced during this
  audit. Whatever decision OQ-1 reaches for formulas must close (or consciously accept) this gap.

## Goals

1. **`xstockstrat-ingest` `ManageSignalSource`**: replace `_validate_admin_token` re-auth with the
   `x-access-scope` ADMIN-bit role check (mirror analysis `_has_admin_scope`). Update the agent
   `manage_signal_source` tool to validate admin at the entry (`client.validate_admin`) and forward
   `x-access-scope`. `credentials_ref` handling (never echoed) stays unchanged.
2. **`xstockstrat-indicators` formula management**: **decide** (OQ-1) whether the author-ownership
   model stays as-is (a legitimately different concern — "only the author may edit their formula"), or
   is additionally combined with an admin-scope override. If kept as ownership, document it explicitly
   as an intentional exception rather than an inconsistency, and address the `RegisterFormula` gap.
3. **No behavior change for legitimate admin callers** — UI BFF (JWT-derived scope) and the MCP agent
   (admin-validated at entry) continue to work; non-admin callers are rejected consistently with
   `PERMISSION_DENIED`.

## Non-Goals

- Re-architecting the JWT/identity system or the SSE auth layer.
- Changing how the UI BFF derives `x-access-scope` from JWT claims.
- Touching the trading/portfolio/config/ledger/notify services (their gates are out of scope unless a
  later audit finds a similar divergence).
- Adding new admin operations or roles — this is a gate-alignment feature, not a capability feature.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-ingest` (Python) — `ManageSignalSource` gate swap; likely removal of the
  `identity_channel`/`_identity` wiring (`app/main.py:60,67`, `app/handlers/servicer.py:36,41-58`),
  since `_validate_admin_token` is its **only** caller (`servicer.py:427`).
- `xstockstrat-indicators` (Python) — formula-management gate decision (OQ-1) and the `RegisterFormula`
  gap (`app/handlers/servicer.py:135-238`).
- `xstockstrat-agent` (Python) — entry-point `validate_admin` + `x-access-scope` forwarding for
  `manage_signal_source` (`app/tools.py:320-351`, `app/client.py:344-361`); `manage_formula` adjusted
  per OQ-1.
- `xstockstrat-ui` (Next.js) — **no code change expected**; the BFF already derives `x-access-scope`
  from JWT and forwards it. Callers exist (`src/app/config-ui/hooks/useSignalSourceMutations.ts`,
  `src/hooks/useFormulas.ts`) and must keep working — covered by acceptance, not by new code.

## Proto Contract Changes

- [x] No proto changes required — gate logic only; no RPC signatures, messages, or fields change.
      (Re-confirm at `/sdd-spec`.)

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — authorization is request-scoped; no new tables/columns/migrations.

## Functional Requirements

- **FR-1** ingest `ManageSignalSource` authorizes via an `x-access-scope` ADMIN-bit (`0x04`) role check
  mirroring analysis `_has_admin_scope`; returns `PERMISSION_DENIED` when the bit is absent. No identity
  `ValidateApiKey` call inside ingest for this RPC.
- **FR-2** agent `manage_signal_source` tool calls `client.validate_admin(admin_api_key)` at the entry
  and forwards `x-access-scope` to ingest (mirrors `manage_strategy`/`set_strategy_live`).
- **FR-3** ingest removes the `identity_channel`/`_identity` wiring if it is unused after FR-1.
  Verified during this spec: `_validate_admin_token` (→ `_identity`) has a **single** call site
  (`servicer.py:427`), so removal is expected to be clean. Re-verify at `/sdd-spec`/implementation.
- **FR-4** indicators formula-management gate decision (OQ-1) is implemented and documented: either
  (a) keep author-ownership and document it as an intentional model, or (b) add an admin-scope path
  (e.g. admin scope overrides ownership). The decision must also resolve the **`RegisterFormula` gap**
  (it has no gate today).
- **FR-5** `credentials_ref` is still never echoed by `manage_signal_source` (unchanged from FR-12 of
  047) — neither in the agent tool response nor the ingest response.
- **FR-6** Docs updated: `docs/patterns/header-propagation.md` (or a short auth-model note) describes the
  single "entry authenticates, internal role-checks" model and lists the indicators ownership exception.
- **FR-7** No behavior change for legitimate admin callers: UI BFF (JWT-derived `x-access-scope`) and the
  MCP agent (admin-validated at entry) continue to succeed for admins and are rejected for non-admins.

## Governance Gates

- **Security review** — trust-boundary change in ingest; confirm entry points strip/validate
  `x-access-scope` from external requests so internal callers can trust it (per
  `docs/patterns/header-propagation.md`: nginx/ingress strips client-supplied trust headers).
- **Service owners** — `xstockstrat-ingest` and `xstockstrat-indicators` (and `xstockstrat-agent` for
  the tool-layer change).
- **Platform Lead** — owns the OQ-1 decision (ownership vs. admin-scope for formulas).
- No new proto, config key, or DB migration is anticipated (gate logic only). Confirm at `/sdd-spec`.

## Feature Workflow Notes

Branch to create: `feature/unify-admin-auth-gates` (branch from `main-dev`).
Dependency: **047 + 048 merged to `main-dev`** (satisfied — PRs #581, #596) — the `_has_admin_scope`
(analysis) and `validate_admin` (agent) patterns this feature extends are present on `main-dev`.

Approval gates required (per `docs/runbooks/feature-workflow.md`):

- [x] 1 service owner approval per affected service (non-breaking, gate-logic change) — ingest,
      indicators, agent.
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (no proto change).
- [ ] DBA review + service owner (schema migration) — N/A (no migration).
- [x] Security review (trust-boundary change).

## Acceptance Criteria

- **AC-1** A non-admin `x-access-scope` to ingest `ManageSignalSource` returns `PERMISSION_DENIED`; an
  admin scope succeeds; no identity `ValidateApiKey` call is made by ingest for the gate.
- **AC-2** The agent `manage_signal_source` tool rejects a non-admin key at the entry and forwards
  admin scope (`x-access-scope`) for an admin key.
- **AC-3** The indicators formula-management authorization decision (OQ-1) is implemented and
  documented, including the disposition of the `RegisterFormula` gap.
- **AC-4** UI BFF flows for signal sources and formulas continue to work unchanged for admin users.
- **AC-5** Existing ingest/indicators/agent tests pass; new tests cover the gate change (admin allow /
  non-admin deny for `ManageSignalSource`; entry-validation for the agent tool).
- **AC-6** `identity_channel`/`_identity` removed from ingest if FR-3's unused-verification holds.

## Open Questions

- **OQ-1 (key decision):** Should indicators formula management keep its **author-ownership** model
  (only the author may edit/delete their own formula) as an intentional, distinct concern — or be
  unified under admin-scope? Ownership and admin-scope are arguably *different* authorization questions;
  the most likely answer is "keep ownership, document it as an exception, and optionally allow an admin
  override." This decision must also resolve the **`RegisterFormula` gap**. Platform Lead + Security to
  decide.
- **OQ-2:** Does any external (non-entry-point) caller reach ingest `ManageSignalSource` directly? If
  so, removing re-auth requires confirming those callers are inside the trusted boundary. (Known callers
  today: UI BFF via JWT-derived scope, and the MCP agent. Confirm none bypass an entry point.)
- **OQ-3:** Should `_has_admin_scope` be promoted to a shared helper module (instead of duplicated per
  service) once a third service (ingest) adopts it? Three Python services would then carry the same
  10-line helper.

## Open Questions — Review & Recommendations (2026-06-06)

Advisory analysis; final calls belong to the owners named per question.

- **OQ-1 → Recommended: keep author-ownership, add an admin override, and close the `RegisterFormula`
  gap.** Ownership and admin-scope answer different questions ("is this *your* formula?" vs. "are you an
  admin?"); collapsing them would weaken the per-author model the indicators service was built around.
  Recommended shape: `UpdateFormula`/`DeleteFormula` succeed if `user_id == author` **OR**
  `x-access-scope` has the ADMIN bit; document the ownership rule as an intentional exception in
  header-propagation.md. Separately, `RegisterFormula` should gain a minimal gate (at least an
  authenticated `x-user-id`; default `author` to that id instead of the literal `"dev-user"`) so the
  "anyone can register" gap is closed. **Owner: Platform Lead + Security.**
- **OQ-2 → Low risk, must still verify at `/sdd-spec`.** Evidence so far shows only entry-point callers
  (UI BFF, MCP agent) reach `ManageSignalSource`; no service-to-service caller invokes it. The trust
  model holds **only if** ingress strips client-supplied `x-access-scope` from external requests —
  re-confirm that header-stripping is in force for the ingest path before removing the in-service
  re-auth. **Owner: Security + ingest owner.**
- **OQ-3 → Defer (do it in this feature only if cheap).** Promoting `_has_admin_scope` to a shared
  module is reasonable once ingest becomes the third adopter, but a shared Python util across three
  services needs a home (e.g. a small internal package) and crosses service boundaries — scope risk for
  a gate-alignment feature. Recommendation: **duplicate the 10-line helper in ingest now**, and capture
  "extract shared admin-scope helper" as a follow-up backlog item. Revisit if a fourth adopter appears.
  **Owner: Platform Lead.**
