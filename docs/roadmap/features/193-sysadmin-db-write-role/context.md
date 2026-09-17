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
