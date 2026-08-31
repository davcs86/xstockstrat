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

## Session 2026-08-31 — sdd-review fixes (product-spec)

Product-spec review returned **PASS WITH WARNINGS**; addressed all three warnings (status stays `draft`,
number/slug unchanged, all FR-1..FR-10 and the six additive identity RPCs preserved).

- **Open Questions reorganized (review criterion 9).** `## Open Questions` no longer holds any unchecked
  genuine-unknown `- [ ]`; it now reads "None — moved to Design-Phase Decisions / Design Guardrails below."
  - New `## Design Guardrails` section (plain bullets): the three known-trap reminders — server-side authz
    at every RPC write path via `x-access-scope` (C-10(c)); gRPC-only identity plumbing (no HTTP-header
    identity); shared-nav `PLATFORM_SUBNAV` reachability with a nav test (C-10(a)) — plus the new
    ledger-audit-plumbing note (below).
  - New `## Design-Phase Decisions (owned by /sdd-design)` section (plain bullets): the three genuine forks
    — roles as a closed enum vs. open `TEXT[]` strings; a Next.js middleware admin route-guard as
    defense-in-depth; whether `UpdatePassword`/`SetUserActive` should invalidate existing refresh tokens.
- **Last-admin lockout guard added (warning 2).** Added **FR-11**: `SetUserActive(active=false)` and
  `SetUserRoles` must refuse to deactivate/demote the final active admin (incl. seeded `admin@localhost`),
  returning gRPC `FAILED_PRECONDITION` "cannot remove last admin", enforced server-side in identity.
  Added covering scenario **@AC-11 @FR-11** in `acceptance.feature` with concrete values (deactivating the
  only remaining active admin, and stripping its `admin` role, are both rejected with `FAILED_PRECONDITION`
  "cannot remove last admin"). Noted the guard in the identity Affected-Services entry.
- **Identity→ledger audit = new plumbing (warning 3).** Added a Design Guardrails note that FR-8/AC-8's
  per-action ledger audit is NOT an existing capability to reuse: identity has no ledger-write client today
  — the fictional `xstockstrat-ledger` dep + `LEDGER_ENDPOINT` were removed and auth events are only
  `log.info` lines (grounded in `services/xstockstrat-identity/docs/context-constitution-findings.md`). The
  gRPC ledger client + `LEDGER_ENDPOINT` wiring + `AppendEvent` calls + password/hash redaction are new
  plumbing to build and verify at design.
- Verified: NO unchecked `- [ ]` remains under `## Open Questions`.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.
