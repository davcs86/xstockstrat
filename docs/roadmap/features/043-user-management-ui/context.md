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

## Session 2026-08-31 — sdd-design (FULL)

Wrote `recon.md` (Phase 0) + `design.md` (Phase 1). Did NOT flip `status.md` (left `spec-ready`);
no code/other files changed.

**Grounded recon findings (evidence-cited in recon.md):**
- Admin gate to reuse: the config service's `authz.ts` is the canonical Node role check —
  `ADMIN_SCOPE=0x04`, `hasAdminAccessScope(md)` (reads `x-access-scope`, fails closed), `ADMIN_SCOPE_ERROR`
  (`services/xstockstrat-config/src/grpc/authz.ts:22,44-48,56-59`). Port it into identity; gate all six RPCs
  (reads too, per AC-7).
- Identity→ledger is genuinely new **code**, but the **endpoint env is already wired**: `LEDGER_ENDPOINT`
  + `depends_on`/`WAIT_FOR` on ledger exist in `docker-compose.yml:185-186`, `.do/app.yaml:351-356`,
  `.do/app.dev.yaml:16,20`. (The findings-doc "ledger dep removed from identity" is accurate only for the
  CLAUDE.md deps table, not the deploy specs.) `LedgerServiceClient` (grpc-js) export confirmed at
  `packages/proto/gen/ts/ledger/v1/ledger.ts:1389` (existence via grep; `/sdd-spec` pins the specifier, F-04).
- No DB migration (users table already has roles/is_active/timestamps, `001:6-14`). No new config keys.
- Nav: `NAV_GROUPS` (not `PLATFORM_SUBNAV`) is the live shell; `NavItem.adminOnly` + `Backfills`
  precedent (`navGroups.tsx:67`) + `visibleItems` filter (`PlatformHeader.tsx:203`) give admin-hide for free.
- `middleware.ts` is authN-only today (has `claims.roles`, no route-level authZ).
- C-03 now binds identity (its first outbound per-request call).

**Resolved the four Design-Phase Decisions (recommendations; see design.md § Process note):**
- **Roles enum vs strings** → **closed `Role` enum** (`ROLE_UNSPECIFIED=0`,ADMIN,TRADER,VIEWER) on write
  inputs + `User` view; `TokenClaims.roles` stays `repeated string`. C-04 (closed deployment-time set) wins
  over the strings alternative; the enum obliges an exhaustive TS `Record<Role,…>` in the same PR (C-10(a/d),
  ledger 2026-07-21). Rejected: open strings + server allow-list.
- **Middleware admin route-guard** → **do NOT add one**. Load-bearing authz = BFF `forwardAdmin` + identity
  server gate (both fail-closed); nav hides via `adminOnly`. A third Edge authZ site is UX-only scope creep.
- **Refresh-token invalidation on mutate** → **revoke on `UpdatePassword` and `SetUserActive(false)`** (reuse
  `UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1`, `identityServiceImpl.ts:209-212`, keyed on
  the *target* user_id — sidesteps the `revokeToken` unsigned-decode finding). Leave `SetUserRoles` eventual
  (≤ access-TTL 15 min). Access-token deactivation lag (≤15 min) accepted as open risk.
- **Last-admin guard** → **atomic conditional UPDATE** guarded by `EXISTS(other active active-admin)` (or a
  row-locking tx), NOT count-then-write (TOCTOU on concurrent demotions). `FAILED_PRECONDITION "cannot remove
  last admin"` when 0 rows affected and the target is the final active admin.
- **Ledger audit client** → best-effort **after** the DB commit, awaited + try/catch (log on failure, don't
  roll back), `idempotency_key` for safe retry, payload built from an explicit safe-field allow-list (never
  spread the request → no password/hash), C-03 headers forwarded. Residual "ledger down ⇒ audit lost" risk
  accepted (platform norm).

**Floor check:** no unresolved F-* breach. F-01 (no migration), F-06 (reuse single Pool, gRPC not a new DB
pool), F-07 (endpoint is env, TTLs from config), F-04 (client specifier pinned by grep at spec).

**Process caveat (P-04 / ledger 2026-08-08):** run in a subagent without `Task`/`AskUserQuestion`; the
proposer/adversary debate and the approval gate were self-run and are **provisional**. The four forks above
must be confirmed by the operator before/at `/sdd-spec`. Status intentionally NOT advanced to
`design-approved` by this subagent.
