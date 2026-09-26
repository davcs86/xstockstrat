# Product Spec: psql-db-role-grant-hardening

**Created**: 2026-09-25 (rescoped 2026-09-26)

---

## Problem Statement

Feature 211 (`remove-agent-postgres-mcp`) removes the postgres-mcp co-process from `xstockstrat-agent`.
postgres-mcp was the **only** consumer of the `xstockstrat_agent` database role (it connected as that
role — see the connection-pool budget table in the root `CLAUDE.md`). Once 211 lands, that role is a
**dormant privileged identity**: a DML-capable login with cross-schema write reach and no legitimate
user. A dormant privileged role is pure attack surface — a credential to leak, a login to abuse — and
must be removed, not left behind.

Separately, the 2026-09-16 security audit (DT-2 §149) flagged that DB roles have broader write reach
than they need. With the `xstockstrat_agent` role gone, the residual concern is the **remaining** roles:
none should be able to write the integrity- or secrecy-critical relations beyond what it legitimately
requires — the ledger append-only event store, the identity credential/api-key/refresh-token tables,
and the config secret ciphertext (`value_encrypted`).

_(This spec was originally scoped as least-privilege grants for feature 193's psql-MCP role plus
protection of that MCP's audit sink. Feature 193 was demoted and postgres-mcp removed outright, so
that scope is void — there is no psql-MCP and no audit sink. Rescoped 2026-09-26; see `context.md`.)_

## User Story

As a platform operator, I want the orphaned `xstockstrat_agent` DB role removed at the database once
its consumer is gone, and every remaining DB role restricted so it cannot write the ledger, identity
secrets, or config secret ciphertext beyond its legitimate need, so that no dormant privileged identity
lingers and no role can corrupt integrity-critical data.

## Functional Requirements

FR-1. After feature 211 removes the agent's use of the `xstockstrat_agent` role, that role MUST be
torn down at the database: all privileges revoked and the role **dropped**; if owned objects or
dependencies make a clean `DROP ROLE` unsafe, it MUST instead be reduced to **zero privileges +
`NOLOGIN`** and documented as such. Delivered as an idempotent numbered migration and/or the role
provisioning in `scripts/db-migrate.sh`.

FR-2. No **remaining** DB role (after the teardown) may hold INSERT/UPDATE/DELETE on the
integrity-critical relations beyond what it legitimately requires: the ledger append-only event store,
the identity credential/api-key/refresh-token tables, and the config secret ciphertext; and no role
but the intended owner may hold SELECT on the `value_encrypted` ciphertext column. Any privilege found
beyond intent is revoked.

FR-3. The teardown and the grant tightening MUST be idempotent and re-runnable, and verifiable by an
introspection query (`pg_catalog` / `information_schema.role_table_grants`) asserting (a) the
`xstockstrat_agent` role no longer exists — or has zero privileges and `NOLOGIN` — and (b) the
integrity-critical write matrix for the remaining roles matches the intended least-privilege set.

FR-4. No live service loses required DB access. The teardown targets **only** the orphaned role; every
still-active service role (per the root `CLAUDE.md` connection-pool inventory) retains exactly the
access it needs, verified after the change.

## Out of Scope

- The tool/co-process removal and the agent's DB-connection removal — **feature 211**. This feature
  acts at the DB grant/role layer only, after 211 has removed the role's consumer.
- Row-level security (RLS) / multi-tenant per-user row scoping — a separate, larger data-model change.
- Rotating or re-issuing any other service's DB credential — an operational task, not this feature.
- Any psql-MCP, audit sink, or DB tooling (all void with feature 193's demotion).

## Affected Services

Exact service names from CLAUDE.md Service Registry (schema owners whose grant surface is audited; the
roles are provisioned centrally in `scripts/db-migrate.sh`, not owned by one service):
- `xstockstrat-ledger` — append-only event store stays non-writable/non-deletable by non-owner roles.
- `xstockstrat-identity` — credential / api-key / refresh-token tables stay non-writable by non-owners.
- `xstockstrat-config` — secret ciphertext column (`value_encrypted`) stays non-readable/writable by
  non-owners.
- (Platform DB provisioning) — `scripts/db-migrate.sh` role setup / a new grants+teardown migration.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none.
- [ ] **Agent** — none (the agent no longer connects to the DB after feature 211).
- [x] **None** — internal/platform-only. The change is a Postgres role/grant operation with no
  end-user-reachable surface; its observable effect is a removed role and privilege denials enforced by
  Postgres. No C-14 override needed — there is genuinely no user-facing surface.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- **Yes** — `REVOKE` + `DROP ROLE` (or `NOLOGIN` + zero-privilege) for `xstockstrat_agent`, plus any
  `REVOKE` needed to bring remaining roles to the intended integrity-critical write matrix, delivered
  as a numbered migration (`NNN_*.up.sql`/`.down.sql`) and/or the `scripts/db-migrate.sh` role block.
  No table/column data-model change; role/grant surface only.

## Feature Workflow Notes

Branch to create: `feature/psql-db-role-grant-hardening` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] DBA review + service owner (role/grant change) + Security review
- [ ] 2 service owners + platform lead (breaking proto change) — N/A

**Dependency:** **hard — lands after feature 211** (`remove-agent-postgres-mcp`). Dropping the
`xstockstrat_agent` role while the agent still connects as it would break the running agent, so 211
(which removes that connection) must merge and deploy first. Record the `211 → 208` ordering in
`merge-order.md` at `/sdd-spec` time.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Clean `DROP ROLE` vs `NOLOGIN` + zero-privilege: does `xstockstrat_agent` own any objects /
  default privileges that block a drop? Confirm at `/sdd-design` against the live role.
- [ ] Enumerate the remaining roles and their legitimate write set (FR-2/FR-4), grounded against
  `docs/patterns/database.md` (schema map) and each service's actual queries — which role, if any,
  currently holds write on ledger/identity-secret/config-ciphertext beyond need?
- [ ] Ciphertext column (FR-2): revoke SELECT on `value_encrypted` at the **column** level, or is
  non-owner access already absent? Confirm against the current grant surface.
- [ ] Exact relation names (`ledger.events`, `identity.api_keys`, `config.config_entries`, …) are
  illustrative here — pin them at `/sdd-design` against the real schema.
