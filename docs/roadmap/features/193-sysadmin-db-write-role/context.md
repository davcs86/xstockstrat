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

## Session 2026-09-17 — sdd-design (Phase 0 recon + Phase 1 round 1, then OPERATOR PIVOT)

- **Phase 0 Recon** (full mode): wrote `recon.md` from 5 read-only discovery passes (agent, identity +
  manage-users.py, ui, config cross-repo scope-mirror enumeration, scenario-recon C-16 guard). Committed
  `dea933d`. Key grounded facts: exactly 2 roles→bitmap DERIVE sites; superset would leave every `& 0x04`
  CHECK site admitting sysadmin unchanged; no migration/config-key/proto-enum change; the ADMIN→SYSADMIN
  write move CHANGES launched `@AC-12`/`@AC-13` (feature 169); last-admin guard keyed on the `admin` role
  STRING vs a bit-superset is a correctness fork.
- **Phase 1 Round 1** debate ran (proposer + adversary, mediated). Proposer: 5-layer design (SYSADMIN=0x10
  in the 2 derivers, superset; `db_execute_sql` read-allowlist gate on `& 0x10`; `manage-users.py VALID_ROLES
  += sysadmin`; additive `bool is_sysadmin = 6` on `User`; drop `confirm`). Adversary verdict NEEDS WORK
  (no Floor breach): the load-bearing residual is that a **read-SHAPED statement can still perform writes via
  side-effect functions** (`SELECT dblink_exec('INSERT …')`, `nextval`, `pg_terminate_backend`) — parses as
  pure read nodes, so a tool-layer classifier structurally cannot catch it; an admin-only injected session
  keeps that narrow write vector. Also flagged: last-admin-guard string-vs-bit inconsistency; drop-`confirm`
  as unnecessary API churn.

- **>>> OPERATOR PIVOT (this session, authoritative WHAT change) <<<**
  At the round-1 gate the operator steered away from the in-ACL SYSADMIN-bit approach entirely:
  > "Separate the MCPs. Xstockstrat keeps trader/admin. Psql MCP is purely a system admin tool, with the
  > existing manual user setup but independent from xstockstrat auth login and ACL."
  Follow-up decisions (via design-gate clarification):
  1. **Move ALL `db_*` tools out** of `xstockstrat-agent` (all 9 + the postgres-mcp co-process) into a
     standalone **psql MCP** service → the prompt-injectable xstockstrat-agent has ZERO direct SQL access.
     This closes H-5 at the trust boundary (no route to SQL) rather than in a syntactic classifier, and
     resolves the round-1 read-shaped-write residual by construction.
  2. **Auth mechanism = deferred to the psql-MCP server library's capabilities** — the operator was unsure;
     the design MUST ground the auth model in what the actual library (postgres-mcp / crystaldba) supports,
     independent of xstockstrat's OAuth/JWT + access-scope ACL.
  3. **Separate authenticated endpoint** — its own path/port on the DO ingress, gated solely by its own
     credential (not the xstockstrat login).
- **Consequence (spec re-baseline required):** the sysadmin-role/`0x10`-bit/superset/`is_sysadmin`-field
  design (product-spec FR-1/FR-4/FR-5/FR-6) is **superseded**; the `@AC-12`/`@AC-13` ADMIN→SYSADMIN sign-off
  question is mooted (operator marked it "superseded"). The `sysadmin` scope bit no longer exists in this
  direction. Feature number 193 + branch `feature/sysadmin-db-write-role` retained (number immutable; slug
  kept as a broad "lock down privileged DB access" label though the mechanism changed).
- **Plan:** (a) targeted recon addendum on the psql-MCP extraction — library transport/auth capabilities
  (item the auth choice hinges on), deployment topology (docker-compose / supervisord / Dockerfile /
  `.do/app*.yaml` routing), and the feature-169 acceptance scenarios affected (tool-count invariant + the
  `db_*` scenarios that move); (b) re-baseline `product-spec.md` + `acceptance.feature` to the new WHAT;
  (c) re-run `/sdd-review product-spec`; (d) resume the FULL design debate against the new spec.
- This is the operator's explicit authority over the feature's WHAT (recorded here per C-11 / C-16 —
  the launched feature-169 `db_*` scenarios that this pivot changes/relocates are re-baselined with
  operator sign-off, not silently altered).
