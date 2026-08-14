# Context: user-metadata-management

**Feature**: `docs/roadmap/features/130-user-metadata-management/feature.md`
**Product Spec**: `docs/roadmap/features/130-user-metadata-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/130-user-metadata-management/implementation-spec.md`

---

## Session 2026-08-14T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Scanned ledger: noted TS camelCase proto field trap (fix-mcp-config-key-registry), migration NNN collision risk (multiple entries), UI nav registration requirement (C-10(a), 060-screener-engine), and config-ui environment gating pattern (fix-config-ui-env).
- Next migration number: 006 (after 005_drop_api_keys in identity service).
- Reviewer roles: identity service owner, UI service owner, agent service owner, Proto Reviewer, DBA.

## Session 2026-08-14T05:00:00Z — sdd-design (quick, 3 rounds)

### Phase 0 — Recon
- Spawned 3 codebase-discovery agents (identity, UI, agent services).
- Key finding: `users.email` already exists (`TEXT NOT NULL UNIQUE` from migration 001) — migration 006 adds only phone, display_name, metadata, metadata_updated_at.
- Wrote `recon.md` with full codebase map, 12 reuse patterns, dependencies, risks.

### Phase 1 — Grilling (3 rounds)

**User steers (applied from round 1 onward):**
1. Self-only enforcement must use **x-user-id header propagation** (C-03), NOT request body fields.
2. **Email must NOT be editable** in any consumer (UI, agent, gRPC).

**Round 1:** Proposer used request-body userId + editable email. Adversary found 5 objections including BFF segment mismatch (`/config-ui` BFF router serves only ConfigService + IngestService), nav model error (PLATFORM_SUBNAV is legacy; NAV_GROUPS is active). User steered on both x-user-id and email.

**Round 2:** Proposer addressed all R1 objections: moved to `/accounts/profile`, NAV_GROUPS primary, email read-only, metadata extraction via `call.metadata`. Adversary found 4 objections: agent `_metadata()` returns empty (x-user-id forwarding is genuinely new), dual user_id sourcing in identity, backendHeaders DRY issue in /accounts, agent tool interface underspecified. User requested another round.

**Round 3:** Proposer addressed all R2 objections: agent uses `[*_metadata(), ("x-user-id", user_id)]` spread (same shape as 6 existing x-access-scope sites), identity gets `authz.ts` module (replicating config's pattern), `restBackendHeaders` shared helper extracted, tool interface fully specified (2 tools, email excluded from write). Adversary confirmed no Floor breaches, found 2 remaining: identity has zero existing `call.metadata` uses (runtime guard needed), email exclusion from proto confirmed correct (credential-change security gap). Both addressed in final synthesis.

**Approved design (key decisions):**
- `/accounts/profile` placement (deviation from product spec FR-6's `/config-ui/profile`)
- Email excluded from `UpdateUserMetadataRequest` proto entirely — read-only like user_id
- Identity handler reads x-user-id from gRPC metadata via new `src/grpc/authz.ts`
- Runtime guard on `call.metadata?.get` (first-in-service pattern)
- `restBackendHeaders` shared helper (fixes existing DRY finding)
- Two agent tools: `get_user_metadata`, `set_user_metadata` (tool count 22→24)

### Open Threads
- [ ] Dual user_id sourcing in identity (old=request body, new=metadata) — documented via JSDoc; consider follow-up migration.
- [ ] `call: any` typing in identity — runtime guard added; future improvement could narrow to `ServerUnaryCall`.
- [x] Product spec FR-6 deviation (`/config-ui/profile` → `/accounts/profile`) — **resolved**: product spec updated at impl-spec time (FR-6, acceptance criterion 4-5, affected services, consumer surfaces).
- [ ] Recon BFF guidance at `recon.md:63` superseded by `/accounts` REST route pattern.

## Session 2026-08-14T10:00:00Z — sdd-spec

- Generated `implementation-spec.md` with 13 steps across 4 services + proto + docs.
- Updated `feature.md` status: `design-approved` → `implementation-ready`.
- Updated `product-spec.md`: applied design deviations (FR-6: `/config-ui/profile` → `/accounts/profile`, FR-9: email excluded from `set_user_metadata`, consumer surfaces, affected services, acceptance criteria).
- Step order: proto → proto-gen → migration → identity authz → identity handlers → identity tests → UI route + DRY extraction → UI page + nav → UI E2E → agent client → agent tools + tool count → agent tests → docs.
- Key spec decisions:
  - Identity `authz.ts` is Step 4 (before handlers in Step 5) — handlers import from it.
  - `restBackendHeaders` extraction (DRY fix) is bundled in Step 7 with the profile API route — same commit touches `authorized-apps/route.ts` refactor.
  - Tool count bump (5 prose + 1 numeric) consolidated into Step 11 with tool registration.
  - Product spec FR-6 deviation from design (open thread) resolved — product spec updated in this session.
  - Migration verification is offline (no DB spinup) per spec template constraint.
  - All `service` steps carry TDD red-green required; non-code steps (proto, proto-gen, migration, docs) are N/A.
  - C-12/C-13 test data compliance documented per step (reuses `TEST_USER_ID`/`TEST_USER_EMAIL`, inline fixtures are single-consumer).

## Session 2026-08-14T15:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings (advisory — did not block).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 4: authz.ts module has no directly paired test step (C-08) — [x] addressed: added dedicated `userIdFrom`/`first` unit tests to Step 6 instructions
  - Step 10: agent client.py wrapper methods have no directly paired test step (C-08) — [x] addressed: added client method smoke tests to Step 12 instructions
- Step Dependencies annotations updated: Step 6 now documents coverage of Steps 4+5; Step 12 covers Steps 10+11.
- Overlap findings: CLEAN — no blocking collisions. File-level overlaps with features 085, 094, 125 in disjoint line regions (rebase risk only).

## Session 2026-08-14T20:00:00Z — sdd-execute

### Step 1 — proto: Add UserMetadata messages and RPCs to identity.proto [done]
- Added `import "google/protobuf/struct.proto"`, two RPCs (`GetUserMetadata`, `UpdateUserMetadata`), and 5 messages (`UserMetadata`, `Get*Request/Response`, `Update*Request/Response`) to `identity.proto`.
- Files modified: `packages/proto/identity/v1/identity.proto`
- Deviations: none
- TDD: N/A (proto — non-code-bearing)
- Tooling: buf 1.72.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, ts-proto 2.11.8, protoc-gen-es 2.12.0, protoc-gen-connect-es 1.7.0, grpcio-tools 1.80.0 — all installed from host codegen toolchain; stub-diff validated empty before proto edit.
