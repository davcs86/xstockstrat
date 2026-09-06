# Context: mcp-user-profile-roles

**Feature**: `docs/roadmap/features/182-mcp-user-profile-roles/feature.md`
**Product Spec**: `docs/roadmap/features/182-mcp-user-profile-roles/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/182-mcp-user-profile-roles/implementation-spec.md`

---

## Session 2026-09-06 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Pre-story recon (two Explore subagents) established the reuse baseline:
  - identity already has admin RPCs `CreateUser`/`ListUsers`/`GetUser`/`SetUserRoles`/`SetUserActive`/
    `UpdatePassword` (feature 043), ADMIN-gated via `adminGate()` on the `x-access-scope` 0x04 bit
    (`src/grpc/authz.ts`, `src/grpc/identityServiceImpl.ts`). Roles = closed enum admin/trader/viewer.
  - self-service profile RPCs `GetUserMetadata`/`UpdateUserMetadata` are **self-only** (keyed off
    `x-user-id`), already exposed as MCP tools `get_user_metadata`/`set_user_metadata` — so admin
    cross-user profile needs NEW identity RPCs.
  - agent tools register via `@server.tool()` in `app/tools.py`; gRPC via `app/client.py` (lazy stub
    import + ephemeral channel + `_metadata()`); caller identity from verified OAuth claims propagated
    by `CallerPropagationMiddleware`; `roles_to_access_scope` maps admin→0x0F (incl. ADMIN 0x04).
- Operator decisions captured via AskUserQuestion:
  - Scope = **full user-admin + roles** (all six admin RPCs surfaced).
  - Tool shape = **consolidated `manage_user` + `list_users`/`get_user` readers**.
  - Admin profile = **yes**, admin view/edit of any user's profile (accepted the new-proto-RPC cost;
    "no longer a pure quick feature" tradeoff was shown and accepted).
- Governance: additive/non-breaking proto (new admin metadata RPCs); no config keys; no DB migration
  (metadata columns from `006_user_metadata` reused). Reviewers: Proto + identity owner + agent owner
  + Security.
- Known traps folded into product-spec Open Questions: F-12/RC-1 six-surface MCP drift + parity test;
  admin scope only from verified claims (fails.md:532, 546-549); TS camelCase proto reads + row→proto
  mapper lockstep (fails.md:667-669, 537-539).
- Note: harness assigned single dev branch `claude/mcp-user-profile-roles-3zdmww` (PR → main-dev); the
  per-step `feature/<slug>` PR machinery does not apply to this harness session — work lands on the
  assigned branch.

## Session 2026-09-06 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-identity, xstockstrat-agent;
  key reuse: manage_account op-dispatch, adminGate + auditSafe, UserMetadata message, _metadata()
  scope propagation, extracted metadata helpers).
- Phase 1 Grilling: 4 rounds (quick mode extended by operator, who chose "run another round" at
  gates R1/R2/R3). Chosen approach: 5 dedicated admin MCP tools (manage_user op-dispatch +
  list_users/get_user + admin_get_user_metadata/admin_set_user_metadata) over 2 additive identity
  RPCs (AdminGetUserMetadata/AdminUpdateUserMetadata reusing UserMetadata + existing responses),
  backend adminGate sole authority, count 35→40. Rejected: target_user_id arg on shipped
  self-service tools (mixes authz, risks @AC-1@feature-148); new Admin*Response messages; vitest
  cross-service tool-count auto-guard (infeasible — UI learns catalog at runtime).
- Operator decisions at gates: (R1) copilot.ts corrected in-scope; caller-supplied plaintext
  password; no audit on admin profile reads. (R4) fix the self-path 8KB-CHECK error leak in-scope
  via a shared mapDbError helper (23505→ALREADY_EXISTS, 23514→INVALID_ARGUMENT, else INTERNAL),
  applied to createUser + self updateUserMetadata + new adminUpdateUserMetadata (C-10 consistency).
- Mechanism corrections banked from the debate: identity RPCs auto-wire via the single
  addService(IdentityServiceService, identityImpl) — NO src/index.ts edit; implement two same-named
  class methods. Projection-parity test must use protobuf-es v2 schema reflection
  (UserMetadataSchema.fields), NOT the ts-proto stub (no field reflection). rowToUserMetadata emits
  all 6 keys unconditionally. copilot.ts stays a manual-sync F-12 surface (no auto-guard feasible).
- Constitution rules touched: C-03, C-04, C-08, C-09, C-10, C-14, F-01, F-04, F-07. Floor breaches:
  none across all 4 rounds.
- Business rules (C-16): PRESERVE identity @AC-1..6/@AC-10/@AC-11 + agent @AC-8@feature-156 /
  @AC-1@feature-148; EXTEND identity @AC-7 (new RPCs join adminGate denial set) and @AC-8 (admin
  metadata write audits `identity.user.metadata_updated`).
- Open threads (carry to /sdd-spec): response-message coupling (shared-contract constraint);
  dual proto-flavor parity indirection; copilot.ts manual-sync residual; self-metadata C-16 gap
  (pinned by local identity tests :493-582).
- Status: draft → design-approved.
