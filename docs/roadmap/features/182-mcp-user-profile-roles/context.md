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
