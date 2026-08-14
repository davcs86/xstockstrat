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
- [ ] Product spec FR-6 deviation (`/config-ui/profile` → `/accounts/profile`) — update product spec at impl-spec time.
- [ ] Recon BFF guidance at `recon.md:63` superseded by `/accounts` REST route pattern.
