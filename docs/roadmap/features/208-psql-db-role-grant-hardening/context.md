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

## Session 2026-09-26 — RESCOPED (193 demoted, postgres-mcp removed)

- **Rescope, not new feature** (status stays `draft`). The 2026-09-25 session above scoped this as
  least-privilege grants for feature 193's psql-MCP role plus protection of that MCP's durable audit
  sink. That premise is **void**: the operator directive "remove all postgres MCP, they are inherently
  insecure" demoted feature 193 and replaced it with feature 211 (`remove-agent-postgres-mcp`), which
  removes postgres-mcp outright. There is **no psql-MCP and no audit sink**.
- **New scope:** (1) tear down the now-**orphaned** `xstockstrat_agent` DB role at the database
  (postgres-mcp was its only consumer per the root CLAUDE.md pool table) — revoke + `DROP ROLE`, or
  zero-privilege `NOLOGIN` if a clean drop is blocked; (2) audit that no **remaining** DB role can
  write the integrity-/secrecy-critical relations (ledger append-only, identity credential/api-key/
  refresh-token, config `value_encrypted`) beyond legitimate need, and no non-owner can read the
  ciphertext.
- **Dependency changed:** previously "FR-3 sequences with/after 193's audit sink." Now a **hard**
  dependency on **feature 211** — the role cannot be dropped while the agent still connects as it, so
  211 (which removes that connection) must land first. `211 → 208` to be recorded in `merge-order.md`.
- product-spec.md, feature.md, and acceptance.feature rewritten to the new scope; all psql-MCP /
  audit-sink / per-operator-token references removed. Illustrative relation names retained pending
  `/sdd-design` grounding.
