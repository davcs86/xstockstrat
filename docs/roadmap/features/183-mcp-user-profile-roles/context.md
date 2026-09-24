# Context: mcp-user-profile-roles  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

> Note: this feature retains the number `183`; the `183` collision was resolved on 2026-09-16 by renumbering the *other* member (`opportunities-latency-fix`) to `191`. This feature's number is unchanged.

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped 5 admin-gated MCP tools on `xstockstrat-agent` (`manage_user` op-dispatch + `list_users`/`get_user` + `admin_get_user_metadata`/`admin_set_user_metadata`), tool count 35→40, over 2 additive identity RPCs (`AdminGetUserMetadata`/`AdminUpdateUserMetadata`) that reuse the existing self-metadata response messages. The only net-new backend work was cross-user profile access, because the pre-existing metadata RPCs were self-only (keyed off `x-user-id`). All 9 steps landed as designed — no behavioral shipped-vs-design divergence.

**Why (irrecoverable rationale)**:
- Admin profile access was built as new dedicated tools + new additive RPCs rather than adding a `target_user_id` arg to the shipped self-service tools, to keep two authz models (self vs admin) from mixing in one tool and to avoid regressing `@AC-1@feature-148` (self tools forward only `x-user-id`). DRY was deliberately paid *below* the tool boundary via shared identity helpers.
- Client-side role-string validation (`{admin,trader,viewer}`) is authoritative specifically because the identity backend silently drops unknown/`0` enums via `rolesToStrings` — an unvalidated bad role would vanish, not error.
- The self-path 8KB-metadata error leak was fixed in-scope (not deferred) because the metadata write is this feature's own primary write path, so a shared `mapDbError` keeping self and admin paths byte-consistent was cheaper than living with the inconsistency.

**Rejected alternatives**:
- `target_user_id` arg on the shipped self-service tools — DRYer (2 tools not 4) but mixes self+admin authz and risks regressing `@AC-1@feature-148`.
- Overloading self-only `GetUserMetadata`/`UpdateUserMetadata` with a body `user_id` — breaks C-03 (subject from `x-user-id`, never body); additive RPCs chosen instead.
- New dedicated `Admin*Response` messages — unnecessary; reused existing responses (accepting a documented shared-contract coupling).
- `manage_strategy`-style op→single-RPC-enum map for `manage_user` — the ops map to *different* RPCs, so used `manage_account` per-op dispatch.
- Auto-guarded cross-service tool-count parity (vitest over `copilot.ts`) — infeasible: the UI learns the catalog at runtime via `GET /api/tools`, so `copilot.ts` stays a manual-sync F-12 surface.
- Generated-password-returned-once for create — rejected; caller supplies plaintext, never echoed/logged.

**Scars & gotchas**:
- **Identity Vitest/tsc tests silently skip under Node 22, run only under Node 24.** The identity `test`/`test:coverage` scripts use `node --experimental-strip-types`, which on Node 22 (a) can't lower TS parameter properties and (b) doesn't resolve the tests' `../grpc/*.js` specifiers to `.ts`; the test file's `before()` try/catch swallows the import error, so every test vacuously passes with zero assertions. CI runs Node 24 where it works. The executor fell back to `tsc -p` → `node --test dist-test/**` + `c8` for a real red→green (12 red → 64 pass). This is a latent repo-wide trap (already logged at fails.md:2224-2226), not caused by this feature.
- Projection-parity test must use protobuf-es schema reflection (`UserMetadataSchema.fields`), NOT the ts-proto stub (ts-proto has no field reflection).
- Identity RPCs auto-wire via the single `addService(IdentityServiceService, identityImpl)` — implementing two same-named class methods is sufficient; NO `src/index.ts` edit.
- Real identity test file is `src/__tests__/identityServiceImpl.test.ts`, not the `src/grpc/` path the spec cited.
- buf toolchain absent on host — ran via the `xstockstrat-codegen` Docker image.

**Permanent deviations**: none behavioral — shipped matched design. Only toolchain fallbacks (Docker buf, tsc-compile tests) and a test-file path correction.

**Cross-feature signal**: The MCP tool inventory now spans 6 surfaces (`tools.py` docstring, `mcp-tools.md` ×2, agent `CLAUDE.md`, `test_tools_endpoint.py` guard, `copilot.ts`), of which `copilot.ts` alone has no executable guard and re-drifts on every tool add (it was already stale, 32 vs actual 35, on arrival). This is the recurring F-12/RC-1 (fails.md:308-310) pattern — a structural weakness, not a one-off.

**Deferred follow-ons**:
- Response-message coupling: `GetUserMetadataResponse`/`UpdateUserMetadataResponse` now serve both self and admin RPCs — a future self-only field change must reconsider the admin caller and vice-versa.
- Self-metadata C-16 gap: `get_user_metadata`/`set_user_metadata` still have no promoted `@AC-*` suite; only local identity tests pin their behavior.
- `copilot.ts` remains an unguarded manual-sync surface; the next tool add will re-drift it.

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-09-16 entries. (The Node-22 strip-types trap was a DUP of fails.md:2224-2226 and was NOT re-appended; two other TS/authz lessons were DUPs of fails.md:667-669/537-539/532/546-549; and the copilot.ts drift is a DUP of fails.md:308-310.)

**Runtime-invariant recommendations (→ /context-constitution)**: IDENTITY-*/PLAT-* — `xstockstrat-identity` tests via `node --experimental-strip-types` execute only under Node 24; under Node 22 they vacuously skip (import error swallowed by `before()`), giving a false green. Use the tsc-compile path or Node 24 locally. (Already captured in fails.md:2224-2226.)

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
