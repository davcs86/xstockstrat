# Context: sysadmin-db-write-role

**Feature**: `docs/roadmap/features/193-sysadmin-db-write-role/feature.md`
**Product Spec**: `docs/roadmap/features/193-sysadmin-db-write-role/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/193-sysadmin-db-write-role/implementation-spec.md`

---

## Session 2026-09-17 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story. Feature number 193 (max existing 192 + 1).
- **Origin:** security-audit finding H-5 / DT-2 (`docs/reports/2026-09-16-trading-system-security-audit.md`).
  Operator chose the "systems-admin role" alternative over plain agent read-only, to preserve
  feature 169's FR-2 write capability behind a privilege no consumer can obtain.
- **Design intent recorded (to be debated in /sdd-design, full mode):** new SYSADMIN scope bit
  (`0x10`) mirrored in agent `app/scopes.py` + UI `src/lib/auth.ts`; a `sysadmin` role STRING mapped
  to that bit but deliberately kept OUT of the closed proto `Role` enum so consumer RPCs cannot
  express it; `manage-users.py` (direct DB write) the sole assignment path; `db_execute_sql` gates
  writes on SYSADMIN, reads stay at ADMIN (`0x04`).
- **No proto / migration / config-key changes** — a design strength (avoids the fails.md 2026-08-06
  C-10(a/d) enum-consumer trap entirely). Governance: 1 service owner + Security review focus.
- **Ledger traps noted in product-spec Open Questions:** fails.md 2026-08-06 (proto-enum append is
  never backend-only) and fails.md 2026-08-05 (never forward a blanket admin `x-access-scope` from an
  unauthenticated-for-admin entry point — derive the bit from verified JWT roles only).
- Open design questions captured: keep postgres-mcp `--unrestricted` vs restrict; superset vs
  orthogonal sysadmin; write/read classification (extend `_is_destructive`, gate INSERT too);
  enum-display gap in list_users/get_user; fate of the `confirm` flag.
- Next: `/sdd-review sysadmin-db-write-role product-spec`, then `/sdd-design sysadmin-db-write-role`
  (full mode, operator-requested).

## Session 2026-09-17 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`. Verdict: **PASS WITH WARNINGS** (0 blockers).
- First pass FAILed on two blockers, both fixed before this PASS:
  - **C-15 acceptance coverage** — FR-5/FR-6 had no covering scenario. Fixed: added `@AC-10`
    (FR-5 superset) and `@AC-11` (FR-6 auditable-via-script).
  - **Criterion 9 open questions** — 6 items were `- [ ]`. Fixed: all resolved to `- [x]`
    provisional decisions (each an explicit input to full `/sdd-design`, overturnable with rationale).
- **Warnings carried into `/sdd-design` (must be resolved/acknowledged there — P-03 no-silent-deviation):**
  - [ ] **C-10 / C-04 mirror enumeration** — FR-4's "no drift between mirrors" names only
    `app/scopes.py` (agent) + `src/lib/auth.ts` (UI), but the scope bitmap is ALSO
    defined/checked in `services/xstockstrat-config/src/grpc/authz.ts` (`ADMIN_SCOPE = 0x04`) and
    the Python servicers' `_has_admin_scope` (per `services/xstockstrat-agent/app/scopes.py:4-6`).
    Design MUST explicitly confirm whether those sites need the SYSADMIN bit or are correctly out
    of scope (the write-gate is tool-layer in the agent, so backend ADMIN-checkers may legitimately
    not need it) — so the "every site / no drift" parity claim is complete.
  - [ ] **AC-8 / AC-11 firm-up (NOTE-level)** — AC-8 uses "any write statement" (vs concrete SQL in
    siblings); AC-11's 2nd `Then` ("no admin surface presents … as non-privileged") is qualitative.
    Neither weakens the gate; pin exact values at `/sdd-spec` / test-design time.
- Overlap findings: only a rebase-only same-file overlap with feature 187 in `agent/app/tools.py`
  (no merge-order entry needed); no config-key / proto-field / migration-NNN collisions.
- Next: `/sdd-design sysadmin-db-write-role` (FULL mode, operator-requested).
