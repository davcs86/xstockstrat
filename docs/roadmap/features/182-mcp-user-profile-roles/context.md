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

## Session 2026-09-06 — sdd-review product-spec (advisory re-run)

- Ran at status design-approved (past spec-ready); did NOT regress status.md.
- Criteria pass: FAIL on criterion 9 only (unchecked `- [ ]` Open Questions) — all other criteria OK,
  all code-checkable claims verified (proto RPCs, ADMIN_SCOPE=0x04, adminGate, migration 006, service
  names). Resolved by reconciling Open Questions with the design decisions already made: OQ-1 (dedicated
  admin tools), OQ-2 (caller-supplied plaintext), and the three known-traps folded into design.md steps.
- Overlap scan: CLEAN — no proto-name/field, migration, config-key, or source-file collisions. In-flight
  175 (identity) and 171 (agent) share the service dirs but touch disjoint files. No merge-order entry
  required.
- Net: product-spec review PASS after Open-Questions reconciliation. Next: /sdd-spec.

## Session 2026-09-06 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Step shape (from design.md's 5 ordered boundaries, C-08-paired): 1 proto, 2 proto-gen,
  3 identity service + 4 identity test, 5 agent client + 6 agent client test, 7 agent tools +
  8 agent tools test (incl. the 40-name `test_tools_endpoint.py` guard), 9 docs/F-12 inventory sync.
- Codebase findings verified against source (all anchors confirmed accurate):
  - Proto: self-metadata RPCs `identity.proto:30-31`, service block closes `:41`; `UserMetadata`
    `:130-137`, `GetUserMetadataResponse` `:139`, `UpdateUserMetadataResponse` `:145`. New RPCs append
    after `:31`, new request messages after `:145`; reuse existing responses (no `Admin*Response`).
    `import struct.proto` already at `:7`.
  - identity `identityServiceImpl.ts`: `adminGate` `:638-649`, `auditSafe` `:625-636`, self
    `getUserMetadata` `:536-566` / `updateUserMetadata` `:572-615`, role maps `:15-24`. Confirmed the
    pre-existing 8KB-error leak — self `updateUserMetadata` catch at `:611-614` maps ALL errors to
    code 13; migration `006_user_metadata.up.sql:7-8` CHECK raises SQLSTATE 23514. `setUserRoles` audit
    example `:768` (`identity.user.roles_updated`). Auto-wire: `src/index.ts:49-52` single `addService`
    — NO index.ts edit; name two class methods.
  - agent: `_metadata()` `client.py:56-75`; self helpers `get_user_metadata` `:1270-1290` /
    `update_user_metadata` `:1293-1330`. `manage_account` op-dispatch `tools.py:1601-1685` (friendly
    admin early check `:1667`, `_caller_access_scope` `:106`, `_caller_user_id` `:118`). Test template
    `test_account_tools.py:168-181`; conftest `ADMIN/TRADER/VIEWER`+`_ctx` `:12-27`; tool-name guard
    `test_tools_endpoint.py:17-58` currently 35 names. Agent coverage threshold = 40% (`ci.yml`,
    `--cov=app`).
  - F-12 surfaces: `tools.py:4` "Thirty-five tools", `mcp-tools.md:3`/`:37`/`:946`, agent `CLAUDE.md:43`,
    `copilot.ts` `COPILOT_MCP_TOOL_COUNT = 32` (stale → 40, operator-approved in-scope).
- Scenario coverage (C-15): all 10 @AC-* mapped — @AC-7/@AC-8/@AC-10 to identity test (step 4),
  @AC-1..6/@AC-9 to agent tools test (step 8), @AC-4 also to agent client test (step 6, caplog).
- Reviewers snapshot finalized in feature.md: Proto Reviewer, xstockstrat-identity owner,
  xstockstrat-agent owner, Security.

## Session 2026-09-06 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings + 1 note (advisory — did not block). PASS WITH WARNINGS.
  All path:line anchors verified; C-08 pairing (3→4, 5→6, 7→8) and C-15 coverage (AC-1..AC-10 → RED
  assertions) fully satisfied. B3 ordering clean.
- Warnings addressed in the spec before execution:
  - [x] Step 9 / Execution Summary / Step Dependencies cited "F-12" as a Constitution ID — the Floor
    stops at F-11. "F-12" is a triage-report finding / ledger RC-1 (fails.md:308-310), not a rule.
    Corrected all three occurrences to reference RC-1/fails.md:308-310 (C-01).
  - [x] adminGate doc comment "shared by all six admin RPCs" (identityServiceImpl.ts:638) goes stale
    at eight callers — added Step 3 item 6 to fix the comment in the same file.
  - [x] Step 2 `**Files**` listed gen/{go,python,ts} directories rather than files — replaced with the
    exact regenerated file set (identity.pb.go, identity_grpc.pb.go, identityv1connect/identity.connect.go,
    identity_pb2.py, identity_pb2_grpc.py, identity.ts, identity_connect.ts, identity_pb.ts, + dist/),
    with a note that the whole identity/v1 package is regenerated wholesale by buf-gen.sh.
- Overlap scan: CLEAN — no migration/proto-field/config-key/file collisions with any non-launched
  feature; shared agent surfaces touched only by already-launched features (rebase-only). No merge-order
  row required.

## Session 2026-09-06 — sdd-execute (sequential)

- Tooling setup (steps 1–9): node ✓ v22.22.2 · pnpm ✓ 9.15.9 (identity deps installed) · uv ✓ 0.8.17 · ruff ✓ 0.15.8 · agent deps installed (uv sync --extra dev) · buf ✗ host → Docker codegen image `xstockstrat-codegen` built (dockerd started) · migration N/A. Host python 3.11 (uv fetches pinned 3.13 for agent).
- §5.3 re-spec gate: merged origin/main-dev (only unrelated config-ui audit files); all step anchors validated against live code; directive none, no mismatch → no re-spec.

### Step 1 — proto: add AdminGetUserMetadata/AdminUpdateUserMetadata RPCs + request messages [done]
- Added 2 additive RPCs (reusing GetUserMetadataResponse/UpdateUserMetadataResponse) + AdminGetUserMetadataRequest/AdminUpdateUserMetadataRequest messages to identity.proto.
- Verified via Docker codegen image: `buf lint` OK, `buf breaking` against main-dev non-breaking.
- Files modified: `packages/proto/identity/v1/identity.proto`
- Deviations: buf run inside the `xstockstrat-codegen` Docker image (host buf absent) — CI-equivalent; recorded in Deviation Log.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran buf-gen.sh in the xstockstrat-codegen Docker image; regenerated Go/Python/TS stubs (12 files) with the 2 new admin RPCs. Confirmed AdminGetUserMetadata/AdminUpdateUserMetadata in identity_pb2_grpc.py; freshness re-run gave empty `git diff` (C-09).
- Files modified: `packages/proto/gen/{go,python,ts}/identity/v1/*` (+ ts/dist)
- Deviations: buf-gen via Docker image (host buf absent) — CI-equivalent (Deviation Log).
