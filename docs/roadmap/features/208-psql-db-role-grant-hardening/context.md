# Context: psql-db-role-grant-hardening

**Feature**: `docs/roadmap/features/208-psql-db-role-grant-hardening/feature.md`
**Product Spec**: `docs/roadmap/features/208-psql-db-role-grant-hardening/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/208-psql-db-role-grant-hardening/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: backlog security follow-on from the 2026-09-16 security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`). DT-2 §149 recommends narrowing
  `xstockstrat_agent` grants "to only the schemas the analytics tools need." Feature 193
  (`sysadmin-db-write-role`) explicitly deferred this to a separate feature: its Out-of-Scope names
  "any change to what the DML-only `xstockstrat_agent` DB role can do at the Postgres grant level"
  as a defense-in-depth follow-on.
- **Relationship to 193**: FR-1/FR-2/FR-4/FR-5 harden the **existing** role and can land
  independently. FR-3 (make the audit sink tamper-evident against the DML role) is the grant-level
  enforcement of 193's `@AC-11` and depends on 193 having defined that sink — sequence FR-3 with/after
  193. Sequencing to be recorded in `merge-order.md` at `/sdd-spec`.
- **Schema/table names in acceptance.feature are illustrative** (e.g. `ledger.events`,
  `identity.api_keys`, `config.config_entries`) — `/sdd-design` grounds the exact relation names and
  the precise least-privilege write set against `docs/patterns/database.md` (schema map) and the DB
  tools' actual queries; see product-spec § Open Questions.
- Created for pickup by another session per operator direction (Phase D security backlog).
