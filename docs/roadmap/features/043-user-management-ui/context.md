# Context: user-management-ui

**Feature**: `docs/roadmap/features/043-user-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/043-user-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/043-user-management-ui/implementation-spec.md`

---

## Session 2026-05-28T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Confirmed `identity.users` table already has `roles TEXT[]` and `is_active` — no DB migration required.
- Identified 6 new additive-only RPCs needed on `xstockstrat-identity`; all proto changes are non-breaking.
- UI will be a new "Users" section in `xstockstrat-config-ui` (not a new frontend).

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (kept feature number **043** and directory; status stays `draft`). Preserved all scope: FR-1..FR-10 verbatim, the six additive identity RPCs, and the `/config-ui` Users section. Corrected the affected-service name from `xstockstrat-config-ui` to the registry name `xstockstrat-ui` (config-ui is a segment, not a service); added the `## Consumer Surface(s)` (C-14, UI) section.
- Authored `acceptance.feature` (`@AC-1`..`@AC-10`, each tagged to its `@FR-*`); moved the previously inlined Acceptance Criteria list into it and left `## Acceptance Criteria` as a C-15 pointer.
- Folded three ledger traps into `## Open Questions` as one-line "Known trap" notes: admin authz must be enforced at every RPC write path via the `x-access-scope` admin bit, not UI-only (unify-admin-auth-gates / C-10(c)); backends are gRPC-only so no HTTP-header identity assumptions (formula-management-ui); and register the new Users section into the shared nav with a reachability test (060 / C-10(a)).
- Updated `feature.md`: added the acceptance.feature artifact link, bumped `**Last Updated**` to 2026-08-31, appended the regenerated Status History row.
