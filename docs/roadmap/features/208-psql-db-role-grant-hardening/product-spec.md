# Product Spec: psql-db-role-grant-hardening

**Created**: 2026-09-25

---

## Problem Statement

The `xstockstrat_agent` database role is provisioned DML-only (SELECT/INSERT/UPDATE/DELETE, no DDL —
`scripts/db-migrate.sh` role-setup block) but with **blanket cross-schema** reach: it can write to
every schema, including relations that must be tamper-evident or secret. The
2026-09-16 security audit (DT-2 §149) recommends narrowing those grants "to only the schemas the
analytics tools need." Today a legitimately-authenticated DB-tool session — or a leak of the role's
credential — could corrupt the append-only event ledger, forge identity credentials/api-keys, or
delete its own audit trail. Feature 193 separates the DB tooling behind an independent credential at
the **tool layer**; this feature adds the **grant layer** so the database itself enforces
least-privilege regardless of what the tool layer allows.

## User Story

As a platform operator, I want the DB role behind the database tooling restricted at the Postgres
grant level to only the relations it legitimately needs — with write denied on the event ledger,
identity secrets, and config secret ciphertext, and modify/delete denied on the audit sink — so that
an authenticated DB-tool session or a credential leak cannot corrupt integrity-critical data or erase
its own audit record.

## Functional Requirements

FR-1. The `xstockstrat_agent` role's write privileges (INSERT/UPDATE/DELETE) MUST be narrowed to only
the schemas/relations the DB tooling legitimately operates on; blanket cross-schema DML is revoked.
(The precise legitimate set is a design decision, grounded against the tools' actual queries.)

FR-2. The role MUST hold no INSERT/UPDATE/DELETE on the integrity- and secrecy-critical relations: the
ledger append-only event store, the identity credential / api-key / refresh-token tables, and the
config secret ciphertext (`value_encrypted`); and, by least-privilege, no SELECT on the
`value_encrypted` ciphertext column.

FR-3. The role MUST NOT be able to modify or delete rows in the psql-MCP durable audit sink (feature
193, `@AC-11` — "stored where the DML role cannot modify or delete it"), so the audit record is
tamper-evident against the very role whose statements it captures. _(Depends on feature 193 defining
the sink; see § Feature Workflow Notes.)_

FR-4. The role remains DDL-denied (retained), `NOINHERIT`, without `CREATEROLE`/`SUPERUSER`, and
cannot grant itself additional privileges.

FR-5. All grants/revokes are declared **idempotently** — a numbered migration and/or the role
provisioning in `scripts/db-migrate.sh` — re-runnable without error, and verifiable by an
introspection query (`information_schema.role_table_grants` / `pg_catalog`) asserting the effective
privilege set matches the intended least-privilege matrix.

## Out of Scope

- The tool-layer privilege separation itself (feature 193) — this feature is the DB-grant complement,
  not a substitute.
- Row-level security (RLS) / multi-tenant per-user row scoping — a separate, larger data-model change.
- Any change to the connection-pool budget or the role the direct/pooled services use for their own
  runtime queries — this feature governs only the DB-tooling role's grant surface.
- Rotating or re-issuing the role's credential — an operational task, not this feature.

## Affected Services

Exact service names from CLAUDE.md Service Registry (schema owners whose grant surface is tightened;
the role itself is provisioned centrally in `scripts/db-migrate.sh`, not owned by one service):
- `xstockstrat-ledger` — append-only event store must stay non-writable/non-deletable by the role.
- `xstockstrat-identity` — credential / api-key / refresh-token tables must stay non-writable.
- `xstockstrat-config` — secret ciphertext column (`value_encrypted`) must stay non-readable/writable.
- (Platform DB provisioning) — `scripts/db-migrate.sh` role-setup / a new grants migration.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none.
- [ ] **Agent** — none (the agent no longer holds the DB tools after feature 193; this governs the DB
  role the psql-MCP consumes).
- [x] **None** — internal/platform-only. The change is a Postgres grant surface consumed by the
  psql-MCP's DB connection (feature 193) at the database layer, not an end-user-reachable capability.
  Its observable effect is a privilege denial enforced by Postgres; there is no UI or tool surface to
  add. No C-14 override needed — there is genuinely no user-facing surface.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- **Yes** — GRANT/REVOKE statements narrowing the `xstockstrat_agent` role, delivered as a numbered
  migration (`NNN_*.up.sql`/`.down.sql`) under the owning migration set and/or the role-provisioning
  block in `scripts/db-migrate.sh`. No table/column data-model change; grant surface only. Exact
  placement (per-schema migration vs central role setup) is a design decision.

## Feature Workflow Notes

Branch to create: `feature/psql-db-role-grant-hardening` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] DBA review + service owner (privilege/grant change on the shared role) + Security review
- [ ] 2 service owners + platform lead (breaking proto change) — N/A

**Dependency note:** FR-1/FR-2/FR-4/FR-5 apply to the **existing** role and can land independent of
feature 193. FR-3 (audit-sink protection) requires feature 193 to have defined the audit sink — sequence
FR-3 with/after 193, or land FR-1/FR-2/FR-4/FR-5 first and fold FR-3 in once 193's sink exists. Record
the chosen sequencing in `merge-order.md` at `/sdd-spec` time.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] What is the exact least-privilege write set (FR-1)? Enumerate the schemas/tables the DB tooling
  actually writes vs only reads, grounded against the tools' queries.
- [ ] Ciphertext column (FR-2): revoke SELECT on `value_encrypted` at the **column** level, or is
  table-level access already absent? Confirm against the current grant surface.
- [ ] Placement (FR-5): a dedicated grants migration vs the central `scripts/db-migrate.sh` role
  block — which is the idempotent, verifiable home?
- [ ] Sequencing of FR-3 against feature 193's audit-sink definition (see Feature Workflow Notes).
